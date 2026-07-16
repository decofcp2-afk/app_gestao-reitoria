/* ════════════════════════════════════════════════════════════════════════
 * appsel-firestore.js — Fase 3 (App Gestão lê o Firestore)
 *
 * Reproduz no navegador o getEtapasParaApp() do Apps Script, lendo as coleções
 * processos, etapas, cargas, calendario e servidores do Firestore. A SAÍDA é
 * idêntica em forma à do método original, então as telas não mudam.
 *
 * O que NÃO muda nesta fase: login, escrita e os métodos getCapacidadeApp,
 * getHistorico, getServidoresApp, getAlertasApp continuam no Apps Script.
 *
 * Observação: o campo et.historico (cadeado de motivo) fica null aqui — depende
 * da coleção `historico`, que é privada. Recuperável depois sem mudar a tela.
 *
 * MODO_CONTAGEM_PRAZOS = 'corridos' (igual ao Code.gs): contagem de calendário.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function parseTs(v) {
    if (!v) return null;
    var d = null;
    if (v instanceof Date) d = v;
    else if (typeof v.toDate === 'function') d = v.toDate();
    else d = new Date(String(v));
    if (!d || isNaN(d.getTime())) return null;
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function toIso(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // corridos
  function addDU(base, dias) {
    var dc = new Date(base.getTime());
    if (dias > 0) dc.setDate(dc.getDate() + dias);
    return dc;
  }
  function contDU(a, b) {
    var x = new Date(a.getTime()); x.setHours(0, 0, 0, 0);
    var y = new Date(b.getTime()); y.setHours(0, 0, 0, 0);
    return Math.round((y.getTime() - x.getTime()) / 86400000);
  }

  function normText(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function normStatus(s) {
    if (!s) return 'pendente';
    var n = normText(s);
    if (n.indexOf('conclu') >= 0) return 'ok';
    if (n.indexOf('andament') >= 0) return 'andamento';
    if (n.indexOf('atras') >= 0) return 'atrasado';
    if (n.indexOf('aguard') === 0) return 'aguardando';
    if (n.indexOf('parali') === 0 || n.indexOf('suspen') === 0) return 'paralisado';
    if (n.indexOf('retornado') >= 0 && n.indexOf('fila') >= 0) return 'retornado';
    if (n === 'nao se aplica' || n === 'n/a') return 'na';
    return 'pendente';
  }
  function isRetornoFilaMotivo(m) { return normText(m).indexOf('retorno para fila:') === 0; }
  function isEtapaContratual(fase, nome) {
    var f = normText(fase), n = normText(nome);
    return f.indexOf('contrat') >= 0 || n.indexOf('assinatura contrato') >= 0 ||
      n.indexOf('ata (arp)') >= 0 || n.indexOf('gestao contratual') >= 0;
  }

  // Deriva, a partir das condicionais salvas no PROCESSO (tipo de contratação
  // direta, IRP, Procuradoria), quais etapas não se aplicam — e aplica em tempo
  // de leitura. Assim a fila/detalhe refletem a condição mesmo em processos
  // antigos ou antes de o backend reprocessar o status de cada etapa. Trata os
  // dois sentidos (marcar 'na' / reverter 'na' de volta) e NUNCA altera etapas
  // concluídas. Espelha _aplicarCondicionaisEtapas_ (Apps Script).
  function aplicarCondicionaisLeitura(base, etapas) {
    if (!etapas || !etapas.length) return;
    var ehCD       = normText(base.modal).indexOf('direta') >= 0;
    var tipo       = normText(base.tipoCD);
    var ehAdesao   = ehCD && tipo.indexOf('adesao') >= 0;
    var temDisputa = ehCD && tipo.indexOf('com disputa') >= 0;
    var semIRP     = !base.temIRP || ehAdesao;
    var semProc    = ehCD && base.procuradoria === false;
    etapas.forEach(function (et) {
      var n = normText(et.nome);
      var ehIRP    = n.indexOf('irp') >= 0;
      var ehMinuta = n.indexOf('minuta') >= 0;
      var ehVersao = n.indexOf('versao final') >= 0;
      var ehFaseE  = n.indexOf('fase externa') >= 0;
      var gerenciada = ehIRP || ehMinuta || ehVersao || ehFaseE;
      var deveNA = (ehIRP && semIRP)
        || (ehAdesao && (ehMinuta || ehVersao))
        || (ehFaseE && ehCD && !temDisputa);
      if (et.status === 'ok') { /* concluída: mantém */ }
      else if (deveNA) et.status = 'na';
      else if (gerenciada && et.status === 'na') et.status = 'pendente'; // reverte
      if (ehCD && (n.indexOf('adequac') >= 0 || n.indexOf('procuradoria') >= 0)) {
        et.nome = semProc ? 'Adequações finais dos documentos'
                          : 'Adequações finais dos documentos e envio à Procuradoria';
      }
    });
  }

  function ordenarPorFila(lista) {
    return lista
      .map(function (item, idx) { return { item: item, idx: idx }; })
      .sort(function (a, b) {
        var oa = a.item.ordemFila, ob = b.item.ordemFila;
        var na = (oa === null || oa === undefined), nb = (ob === null || ob === undefined);
        if (na && nb) return a.idx - b.idx;
        if (na) return 1;
        if (nb) return -1;
        if (oa !== ob) return oa - ob;
        return a.idx - b.idx;
      })
      .map(function (w) { return w.item; });
  }

  // servMap a partir de `cargas`: pid -> {int, ext, hasInt, hasExt}
  function montarServMap(cargasRaw) {
    var map = {};
    (cargasRaw || []).forEach(function (c) {
      var pid = String(c.processoId || '').trim();
      var serv = String(c.servidor || '').trim();
      if (!pid || !serv) return;
      var nomeNorm = titleCase(serv);
      var ativo = (c.ativo === true);
      if (!map[pid]) map[pid] = { int: '', ext: '', hasInt: false, hasExt: false };
      if (normText(c.fase).indexOf('ext') >= 0) {
        map[pid].hasExt = true;
        if (!map[pid].ext || ativo) map[pid].ext = nomeNorm;
      } else {
        map[pid].hasInt = true;
        if (!map[pid].int || ativo) map[pid].int = nomeNorm;
      }
    });
    return map;
  }

  function montarCalendario(calendarioRaw, municipio) {
    var feriados = [];
    (calendarioRaw || []).forEach(function (c) {
      if (c.afetaPrazo === true && c.data) {
        var d = parseTs(c.data);
        if (d) feriados.push(toIso(d));
      }
    });
    return { feriados: feriados, municipio: municipio || 'Rio de Janeiro', modoContagem: 'corridos' };
  }

  // Espelha _getEtapasParaApp_ do Code.gs.
  function construir(processosRaw, etapasRaw, cargasRaw, opts) {
    opts = opts || {};
    var isChefe = !!opts.isChefe;
    var servMap = montarServMap(cargasRaw);

    // agrupa e ordena etapas por processo
    var etpPorProc = {};
    (etapasRaw || []).forEach(function (e) {
      var pid = String(e.processoId || '').trim();
      var nome = String(e.etapa || '').trim();
      if (!pid || !nome) return;
      var fase = String(e.fase || '').trim();
      var status = normStatus(e.status);
      if (isEtapaContratual(fase, nome)) status = 'na';
      var realiz = status === 'ok' ? parseTs(e.dataRealizacao) : null;
      (etpPorProc[pid] = etpPorProc[pid] || []).push({
        docId: e._id || null,
        ordem: e.ordem,
        nome: nome,
        prazo: parseInt(e.prazoDias, 10) || 0,
        status: status,
        motivo: String(e.motivoAtraso || '').trim(),
        realiz: realiz,
        agente: String(e.agente || '').trim(),
        fase: fase
      });
    });
    Object.keys(etpPorProc).forEach(function (pid) {
      etpPorProc[pid].sort(function (a, b) { return Number(a.ordem || 0) - Number(b.ordem || 0); });
    });

    var procs = [];
    var filaPrevisao = [];
    var ordemFilaMap = {};
    var ordemFilaDisponivel = false;

    (processosRaw || []).forEach(function (p) {
      var pid = String(p.id || p._id || '').trim();
      if (!pid) return;
      if (p.ordemFila !== null && p.ordemFila !== undefined && p.ordemFila !== '') {
        var ov = parseFloat(p.ordemFila);
        if (!isNaN(ov)) { ordemFilaMap[pid] = ov; ordemFilaDisponivel = true; }
      }
      var base = {
        id: pid,
        num: String(p.suap || '').trim(),
        nome: String(p.objeto || '').trim(),
        modal: String(p.modalidade || '').trim(),
        temIRP: (p.temIrp === true || String(p.temIrp).trim().toLowerCase() === 'sim'),
        tipoCD: String(p.tipoCD || '').trim(),
        procuradoria: (String(p.procuradoria || '').trim().toLowerCase() !== 'não' && String(p.procuradoria || '').trim().toLowerCase() !== 'nao'),
        req: String(p.setorRequisitante || '').trim(),
        emailR: String(p.emailRequisitante || '').trim(),
        suap: String(p.linkSuap || '#').trim()
      };
      aplicarCondicionaisLeitura(base, etpPorProc[pid]);
      var d0 = parseTs(p.d0);
      if (!d0) { filaPrevisao.push(base); return; }
      base.d0 = d0;
      procs.push(base);
    });

    var resultado = procs.map(function (p) {
      var etapas = (etpPorProc[p.id] || []).filter(function (et) { return et.status !== 'na'; });
      var cursor = new Date(p.d0.getTime());
      var etapaAtualIdx = -1;

      var etCalc = etapas.map(function (et, idx) {
        var ini = new Date(cursor.getTime());
        var fimPrev = addDU(ini, et.prazo);
        var atraso = 0;
        if (et.realiz) {
          atraso = Math.max(0, contDU(fimPrev, et.realiz));
          cursor = new Date(et.realiz.getTime());
        } else if (et.status !== 'na') {
          cursor = new Date(fimPrev.getTime());
        }
        if (etapaAtualIdx < 0 && et.status !== 'ok' && et.status !== 'na') etapaAtualIdx = idx;
        var retornoFilaEt = et.status === 'retornado' || isRetornoFilaMotivo(et.motivo);
        return {
          docId: et.docId, ordem: et.ordem,
          prazo: et.prazo, nome: et.nome, agente: et.agente, fase: et.fase,
          status: et.status, retornoFila: retornoFilaEt, motivo: et.motivo,
          dias: atraso, ini_iso: toIso(ini), fim_iso: toIso(fimPrev),
          realizacao_iso: et.realiz ? toIso(et.realiz) : null,
          historico: null
        };
      });

      var semNA = etCalc.filter(function (e) { return e.status !== 'na'; });
      var concl = semNA.filter(function (e) { return e.status === 'ok'; }).length;
      var execucao = semNA.length ? Math.round(concl / semNA.length * 100) : 0;

      var retornoFila = etCalc.some(function (e) { return e.retornoFila; });
      var st = 'planejamento';
      if (execucao === 100) st = 'ok';
      else if (etCalc.some(function (e) { return e.status === 'atrasado'; })) st = 'atrasado';
      else if (etCalc.some(function (e) { return e.status === 'aguardando'; })) st = 'aguardando';
      else if (etCalc.some(function (e) { return e.status === 'paralisado'; })) st = 'paralisado';
      else if (etCalc.some(function (e) { return e.status === 'andamento'; })) st = 'andamento';
      else if (concl > 0) st = 'andamento';
      else if (etCalc.some(function (e) { return e.status === 'retornado'; })) st = 'retornado';

      var mNorm = normText(p.modal);
      var mAbrev = (mNorm.indexOf('pregao') >= 0 || mNorm.indexOf('concorr') >= 0) ? 'PE' : 'CD';

      var srvInt = servMap[p.id] ? (servMap[p.id].int || '') : '';
      var srvExt = servMap[p.id] ? (servMap[p.id].ext || '') : '';
      if (!srvInt && (!servMap[p.id] || !servMap[p.id].hasInt)) {
        for (var fi = 0; fi < etapas.length; fi++) {
          if (normText(etapas[fi].fase).indexOf('ext') < 0 && etapas[fi].agente) { srvInt = etapas[fi].agente; break; }
        }
      }
      if (!srvExt && (!servMap[p.id] || !servMap[p.id].hasExt)) {
        for (var fe = 0; fe < etapas.length; fe++) {
          if (normText(etapas[fe].fase).indexOf('ext') >= 0 && etapas[fe].agente) { srvExt = etapas[fe].agente; break; }
        }
      }

      var etapaRetornada = etCalc.find(function (e) { return e.retornoFila; }) || null;

      return {
        id: p.id, num: p.num || p.id, nome: p.nome, modal: p.modal, modalAbrev: mAbrev,
        temIRP: p.temIRP, tipoCD: p.tipoCD, procuradoria: p.procuradoria,
        req: p.req, emailR: p.emailR, suap: p.suap, d0_iso: toIso(p.d0),
        execucao: execucao, status: st,
        retornoFila: retornoFila,
        motivoFila: etapaRetornada ? etapaRetornada.motivo : '',
        servidor: srvInt, servidorExt: srvExt,
        etapaAtualIdx: etapaAtualIdx,
        etapas: etCalc
      };
    });

    var ORD = { atrasado: 0, aguardando: 1, paralisado: 2, retornado: 3, andamento: 4, planejamento: 5, ok: 6 };
    resultado.sort(function (a, b) {
      var oa = ORD.hasOwnProperty(a.status) ? ORD[a.status] : 6;
      var ob = ORD.hasOwnProperty(b.status) ? ORD[b.status] : 6;
      return oa - ob;
    });

    filaPrevisao = filaPrevisao.map(function (fp) {
      var ets = etpPorProc[fp.id] || [];
      fp.etapasPrazos = ets.map(function (e) { return { nome: e.nome, prazo: e.prazo, fase: e.fase, status: e.status }; });
      fp.servidor = servMap[fp.id] ? (servMap[fp.id].int || '') : '';
      fp.servidorExt = servMap[fp.id] ? (servMap[fp.id].ext || '') : '';
      fp.ordemFila = ordemFilaMap.hasOwnProperty(fp.id) ? ordemFilaMap[fp.id] : null;
      return fp;
    });
    resultado.forEach(function (p) { p.ordemFila = ordemFilaMap.hasOwnProperty(p.id) ? ordemFilaMap[p.id] : null; });
    filaPrevisao = ordenarPorFila(filaPrevisao);

    return {
      processos: resultado,
      filaPrevisao: isChefe ? filaPrevisao : [],
      ordemFilaDisponivel: ordemFilaDisponivel,
      calendario: opts.calendario || { feriados: [], municipio: 'Rio de Janeiro', modoContagem: 'corridos' }
    };
  }

  // Unidade alvo (multiunidade): última escolhida (localStorage) → config → reitoria-sel.
  // IDs são slugs; sanitizar evita que um valor contaminado (em especial com "/")
  // faça doc() lançar erro síncrono e quebre o app até limpar o localStorage.
  function _unidadeId() {
    try {
      var ls = String(root.localStorage.getItem('appsel_unidade') || '')
        .trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (ls) return ls;
    } catch (e) {}
    return (root.APPSEL_CONFIG && root.APPSEL_CONFIG.unidadeId) || 'reitoria-sel';
  }

  // Lista as unidades cadastradas (para o seletor do topo).
  function listarUnidades() {
    var cfg = (root.APPSEL_CONFIG && root.APPSEL_CONFIG.firebase) || null;
    if (!cfg || !root.firebase) return Promise.reject(new Error('Firebase nao configurado.'));
    if (!root.firebase.apps || !root.firebase.apps.length) root.firebase.initializeApp(cfg);
    return root.firebase.firestore().collection('unidades').get().then(function (snap) {
      return snap.docs.map(function (d) {
        var o = d.data();
        return { id: d.id, nome: o.nome || d.id, sigla: o.sigla || '', ativo: o.ativo !== false };
      }).sort(function (a, b) {
        if (a.id === 'reitoria-sel') return -1; if (b.id === 'reitoria-sel') return 1;
        return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
      });
    });
  }

  function carregar(opts) {
    opts = opts || {};
    var cfg = (root.APPSEL_CONFIG && root.APPSEL_CONFIG.firebase) || null;
    if (!cfg || !root.firebase) return Promise.reject(new Error('Firebase nao configurado.'));
    if (!root.firebase.apps || !root.firebase.apps.length) root.firebase.initializeApp(cfg);
    var db = root.firebase.firestore();
    var base = db.collection('unidades').doc(_unidadeId());
    var municipio = (root.APPSEL_CONFIG && root.APPSEL_CONFIG.municipioCalendario) || 'Rio de Janeiro';
    return Promise.all([
      base.collection('processos').get(),
      base.collection('etapas').get(),
      base.collection('cargas').get(),
      base.collection('calendario').get()
    ]).then(function (s) {
      var procs = s[0].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
      var etps = s[1].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
      var cgs = s[2].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
      var cal = s[3].docs.map(function (d) { var o = d.data(); o._id = d.id; return o; });
      return construir(procs, etps, cgs, {
        isChefe: !!opts.isChefe,
        calendario: montarCalendario(cal, municipio)
      });
    });
  }

  // Lê processos+etapas de TODAS as unidades ativas — insumo da aba "Visão Geral"
  // (relatório de prazos do Admin). Retorna [{ unidade, nome, processos, etapas }].
  // Uso pontual (só quando o Admin abre a aba); as coleções têm leitura pública.
  function carregarPrazosTodasUnidades() {
    var cfg = (root.APPSEL_CONFIG && root.APPSEL_CONFIG.firebase) || null;
    if (!cfg || !root.firebase) return Promise.reject(new Error('Firebase nao configurado.'));
    if (!root.firebase.apps || !root.firebase.apps.length) root.firebase.initializeApp(cfg);
    var db = root.firebase.firestore();
    var map = function (snap) { return snap.docs.map(function (d) { var o = d.data(); o._id = d.id; return o; }); };
    return listarUnidades().then(function (unis) {
      var ativas = unis.filter(function (u) { return u.ativo !== false; });
      return Promise.all(ativas.map(function (u) {
        var base = db.collection('unidades').doc(u.id);
        return Promise.all([
          base.collection('processos').get(),
          base.collection('etapas').get()
        ]).then(function (s) {
          return { unidade: u.id, nome: u.nome, processos: map(s[0]), etapas: map(s[1]) };
        });
      }));
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CAPACIDADE — espelha getCapacidadeApp() do Code.gs, calculando de `cargas`.
  // Retorno: { resumoInt, resumoExt, registrosInt, registrosExt } (mesma forma).
  // Diferenças do shape original: cada `rec` carrega `docId` (id da carga) no
  // lugar de `linha`; cada linha de resumo carrega `matricula` no lugar de
  // linhaSum/colOutros (a edição de "Outros" passa a ser em servidores.outrosFixo).
  // ════════════════════════════════════════════════════════════════════════
  function round1(n) { return Math.round((n || 0) * 10) / 10; }
  // Espelha _fsNomeServ_ (FirestoreSync.gs): Title Case por palavra (separadores
  // espaço/hífen/apóstrofo), não só a 1ª letra da string inteira — nomes
  // compostos ("Maria Eduarda", "Ana Paula Souza", "Jean-Pierre") são a norma,
  // não a exceção, entre os servidores.
  function titleCase(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return s;
    return s.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, function (m, sep, ch) {
      return sep + ch.toUpperCase();
    });
  }
  function num(v) { if (typeof v === 'number') return v; return parseFloat(String(v || '0').replace(',', '.')) || 0; }

  // procConcluido + faseCorrente por processo, a partir das etapas.
  function _capFasesProc(etapasRaw) {
    var acc = {};
    (etapasRaw || []).forEach(function (e) {
      var pid = String(e.processoId || '').trim();
      if (!pid) return;
      if (isEtapaContratual(e.fase, e.etapa)) return;
      var st = normStatus(e.status);
      if (st === 'na') return;
      var kind = String(e.fase || '').toLowerCase().indexOf('ext') >= 0 ? 'ext' : 'int';
      if (!acc[pid]) acc[pid] = { total: 0, ok: 0, ativa: '', pend: '', pendPosOk: '' };
      acc[pid].total++;
      if (st === 'ok') acc[pid].ok++;
      else if (['andamento', 'aguardando', 'paralisado', 'atrasado'].indexOf(st) >= 0 && !acc[pid].ativa) acc[pid].ativa = kind;
      else if (st === 'pendente') {
        if (!acc[pid].pend) acc[pid].pend = kind;
        if (acc[pid].ok > 0 && !acc[pid].pendPosOk) acc[pid].pendPosOk = kind;
      }
    });
    var concl = {}, fase = {};
    Object.keys(acc).forEach(function (pid) {
      concl[pid] = acc[pid].total > 0 && acc[pid].ok >= acc[pid].total;
      if (!concl[pid]) fase[pid] = acc[pid].ativa || acc[pid].pendPosOk || acc[pid].pend || '';
    });
    return { concl: concl, fase: fase };
  }

  function _capRecalc(resumo, registros) {
    var soma = {}, fut = {}, futQ = {};
    registros.forEach(function (r) {
      if (r.concluido) return;
      var k = normText(r.servidor);
      if (r.ativo === 'Sim') soma[k] = (soma[k] || 0) + r.total;
      else { fut[k] = (fut[k] || 0) + r.total; futQ[k] = (futQ[k] || 0) + 1; }
    });
    resumo.forEach(function (s) {
      var k = normText(s.servidor);
      s.processos = round1(soma[k] || 0);
      s.total = round1(s.processos + s.outros);
      s.pct = s.teto ? round1(s.total / s.teto * 100) : 0;
      s.status = s.pct >= 90 ? 'Crítico' : (s.pct >= 60 ? 'Atenção' : 'Disponível');
      s.futuros = round1(fut[k] || 0);
      s.futurosQtd = futQ[k] || 0;
      s.projetado = round1(s.total + s.futuros);
      s.pctProjetado = s.teto ? round1(s.projetado / s.teto * 100) : 0;
    });
  }

  // Processos devolvidos à fila (status 'retornado' OU motivo "retorno para fila:").
  // São excluídos da capacidade: não contam para nenhum servidor enquanto retornados.
  function _capRetornados(etapasRaw) {
    var ret = {};
    (etapasRaw || []).forEach(function (e) {
      var pid = String(e.processoId || '').trim();
      if (!pid) return;
      if (normStatus(e.status) === 'retornado' || isRetornoFilaMotivo(e.motivoAtraso)) ret[pid] = true;
    });
    return ret;
  }

  function construirCapacidade(cargasRaw, processosRaw, etapasRaw, servidoresRaw) {
    var fases = _capFasesProc(etapasRaw);
    var retornados = _capRetornados(etapasRaw);
    var procInfo = {};
    (processosRaw || []).forEach(function (p) {
      var pid = String(p.id || p._id || '').trim();
      procInfo[pid] = { emailR: String(p.emailRequisitante || '').trim(), objeto: String(p.objeto || '').trim() };
    });

    function montarResumo(faseKind) {
      var teto = faseKind === 'int' ? 10 : 6;
      return (servidoresRaw || []).map(function (srv) {
        return {
          servidor: srv.nome,
          matricula: String(srv.matricula || ''),
          outros: faseKind === 'int' ? num(srv.outrosFixo) : 0,
          teto: teto,
          total: 0, pct: 0, status: 'Disponível',
          futuros: 0, futurosQtd: 0, projetado: 0, pctProjetado: 0
        };
      });
    }
    var resumoInt = montarResumo('int');
    var resumoExt = montarResumo('ext');

    var registrosInt = [], registrosExt = [];
    (cargasRaw || []).forEach(function (c) {
      var serv = String(c.servidor || '').trim();
      var pid = String(c.processoId || '').trim();
      if (!serv || !pid) return;
      if (fases.concl[pid]) return;
      if (retornados[pid]) return; // retornado à fila: fora da capacidade
      var kind = String(c.fase || '').toLowerCase().indexOf('ext') >= 0 ? 'ext' : 'int';
      if (fases.fase[pid] === 'ext' && kind === 'int') return;
      var p1 = num(c.p1), p2 = num(c.p2), p3 = num(c.p3);
      var info = procInfo[pid] || {};
      var rec = {
        docId: c._id || null,
        pid: pid,
        servidor: titleCase(serv),
        objeto: info.objeto || String(c.objeto || '').trim(),
        modal: String(c.modalidade || '').trim(),
        fase: String(c.fase || '').trim(),
        ativo: (c.ativo === true) ? 'Sim' : 'Não',
        pts11: p1, pts12: p2, pts23: p3,
        total: round1(p1 + p2 + p3),
        emailR: info.emailR || '',
        concluido: !!fases.concl[pid]
      };
      if (kind === 'ext') registrosExt.push(rec); else registrosInt.push(rec);
    });

    _capRecalc(resumoInt, registrosInt);
    _capRecalc(resumoExt, registrosExt);
    return { resumoInt: resumoInt, resumoExt: resumoExt, registrosInt: registrosInt, registrosExt: registrosExt };
  }

  function carregarCapacidade() {
    var cfg = (root.APPSEL_CONFIG && root.APPSEL_CONFIG.firebase) || null;
    if (!cfg || !root.firebase) return Promise.reject(new Error('Firebase nao configurado.'));
    if (!root.firebase.apps || !root.firebase.apps.length) root.firebase.initializeApp(cfg);
    var db = root.firebase.firestore();
    var base = db.collection('unidades').doc(_unidadeId());
    return Promise.all([
      base.collection('cargas').get(),
      base.collection('processos').get(),
      base.collection('etapas').get(),
      base.collection('servidores').get()
    ]).then(function (s) {
      var map = function (snap) { return snap.docs.map(function (d) { var o = d.data(); o._id = d.id; return o; }); };
      return construirCapacidade(map(s[0]), map(s[1]), map(s[2]), map(s[3]));
    });
  }

  root.AppselFirestore = {
    construir: construir, carregar: carregar, montarCalendario: montarCalendario,
    construirCapacidade: construirCapacidade, carregarCapacidade: carregarCapacidade,
    listarUnidades: listarUnidades, unidadeAtual: _unidadeId,
    carregarPrazosTodasUnidades: carregarPrazosTodasUnidades
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AppselFirestore;
})(typeof window !== 'undefined' ? window : globalThis);
