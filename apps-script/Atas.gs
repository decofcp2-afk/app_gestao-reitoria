// ═══════════════════════════════════════════════════════════════════════════
// Gestão de Atas — acompanhamento interno de ARPs.
// A integração com o Compras.gov.br é EXCLUSIVAMENTE de leitura.
// Habilitação: Script Property GESTAO_ATAS_UNIDADES, JSON ou CSV de ids.
// Ex.: ["reitoria-sel"]. Ausência da propriedade = feature desligada.
// ═══════════════════════════════════════════════════════════════════════════

var ATAS_API_BASE = 'https://dadosabertos.compras.gov.br/modulo-arp';
var ATAS_UASG_PADRAO = '153167';
var ATAS_MARCOS = [30, 60, 90];
var ATAS_EMAIL_MAX_DESTINATARIOS_PILOTO = 20;
var ATAS_EMAIL_RESERVA_OUTROS_FLUXOS = 50;
var ATAS_TRIGGER_HORA = 10;
var ATAS_TRIGGER_MINUTO = 45;

function _atasNorm_(v) {
  return String(v == null ? '' : v).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function _atasTexto_(v, max) {
  var s = String(v == null ? '' : v).trim();
  return max ? s.slice(0, max) : s;
}

function _atasIso_(v) {
  if (!v) return '';
  var s = String(v).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    var br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (br) m = [br[0], br[3], br[2], br[1]];
  }
  if (!m) return '';
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return '';
  return d.toISOString().slice(0, 10);
}

function _atasHojeIso_() {
  return Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
}

function _atasDiasAte_(fim, hoje) {
  var a = _atasIso_(hoje || _atasHojeIso_());
  var b = _atasIso_(fim);
  if (!a || !b) return null;
  return Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000);
}

function _atasMarcoAtual_(ata, hoje) {
  var dias = _atasDiasAte_(ata && ata.vigenciaFim, hoje);
  if (dias === null) return null;
  if (dias < 0) return 0;
  if (dias <= 30) return 30;
  if (dias <= 60) return 60;
  if (dias <= 90) return 90;
  return null;
}

function _atasUnidadesHabilitadas_() {
  var raw = PropertiesService.getScriptProperties().getProperty('GESTAO_ATAS_UNIDADES') || '';
  if (!raw) return [];
  try {
    var arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(function (v) { return _atasNorm_(v); }).filter(Boolean);
  } catch (e) {}
  return raw.split(',').map(function (v) { return _atasNorm_(v); }).filter(Boolean);
}

function _atasHabilitada_() {
  return _atasUnidadesHabilitadas_().indexOf(_atasNorm_(_fsUnidade_())) >= 0;
}

// Função administrativa para execução manual no editor do Apps Script.
function configurarGestaoAtasUnidade(unidade, ativa) {
  var id = _atasNorm_(unidade).replace(/[^a-z0-9-]/g, '');
  if (!id) throw new Error('Unidade inválida.');
  var lista = _atasUnidadesHabilitadas_();
  var pos = lista.indexOf(id);
  if (ativa && pos < 0) lista.push(id);
  if (!ativa && pos >= 0) lista.splice(pos, 1);
  PropertiesService.getScriptProperties().setProperty('GESTAO_ATAS_UNIDADES', JSON.stringify(lista));
  return { ok: true, unidades: lista };
}

// Atalhos sem argumentos para execução manual segura no editor do Apps Script.
// Não são expostos pela API pública e exigem acesso de editor ao projeto.
function habilitarGestaoAtasReitoriaSel() {
  return configurarGestaoAtasUnidade('reitoria-sel', true);
}

function desabilitarGestaoAtasReitoriaSel() {
  return configurarGestaoAtasUnidade('reitoria-sel', false);
}

function _atasRequireAtiva_() {
  if (!_atasHabilitada_()) throw new Error('Gestão de Atas ainda não está habilitada para esta unidade.');
}

function _atasDocId_(ata) {
  var pncp = _atasTexto_(ata.idAtaPNCP || ata.identificadorPncp);
  var base = pncp || [ata.uasg, ata.numeroAta, ata.anoAta].join('-');
  base = _atasNorm_(base).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (base || Utilities.getUuid()).slice(0, 180);
}

function _atasFormatarDoc_(row) {
  var o = row.obj || row || {};
  if (!o._id && row.path) o._id = String(row.path).split('/').pop();
  return o;
}

function _atasListar_() {
  var lista = _fs_().query('atas').Execute().map(_atasFormatarDoc_);
  lista.sort(function (a, b) {
    var da = _atasIso_(a.vigenciaFim) || '9999-12-31';
    var db = _atasIso_(b.vigenciaFim) || '9999-12-31';
    return da < db ? -1 : (da > db ? 1 : String(a.numeroAta || '').localeCompare(String(b.numeroAta || '')));
  });
  return lista;
}

function _atasRespExternoProcesso_(processoId, nome) {
  processoId = _atasTexto_(processoId, 120);
  if (!processoId || !nome) return false;
  var alvo = _atasNorm_(nome);
  return _fsQueryEq_('cargas', 'processoId', processoId).some(function (c) {
    var o = c.obj || {};
    return _atasNorm_(o.fase).indexOf('ext') >= 0 && o.ativo === true && _atasNorm_(o.servidor) === alvo;
  });
}

function _atasPodeCriar_(sess, dados) {
  if (sess.isChefe || sess.isAdmin) return true;
  return _atasNorm_(dados.responsavel) === _atasNorm_(sess.nome)
    && _atasRespExternoProcesso_(dados.processoId, sess.nome);
}

function _atasPodeEditar_(sess, ata) {
  return !!(sess.isChefe || sess.isAdmin || _atasNorm_(ata && ata.responsavel) === _atasNorm_(sess.nome));
}

function _atasSanitizarInterno_(d) {
  d = d || {};
  return {
    processoId: _atasTexto_(d.processoId, 120),
    processo: _atasTexto_(d.processo, 120),
    objeto: _atasTexto_(d.objeto, 300),
    responsavel: _atasTexto_(d.responsavel, 120),
    observacao: _atasTexto_(d.observacao, 1500),
    unidade: _fsUnidade_()
  };
}

function _atasNormalizarOficial_(r) {
  r = r || {};
  var numero = _atasTexto_(r.numeroAtaRegistroPreco || r.numeroAta || r.numero, 80);
  var partes = numero.split('/');
  return {
    origem: 'compras',
    numeroAta: numero,
    anoAta: _atasTexto_(r.anoAta || (partes.length > 1 ? partes[partes.length - 1] : r.anoCompra), 4),
    uasg: _atasTexto_(r.codigoUnidadeGerenciadora || r.codigoUnidade || r.uasg || r.codigoUasg, 12),
    nomeUasg: _atasTexto_(r.nomeUnidadeGerenciadora || r.nomeUnidade || r.nomeUasg, 180),
    numeroCompra: _atasTexto_(r.numeroCompra, 30),
    anoCompra: _atasTexto_(r.anoCompra, 4),
    modalidadeCompra: _atasTexto_(r.nomeModalidadeCompra || r.modalidadeCompra, 100),
    processo: _atasTexto_(r.numeroProcesso || r.processo, 120),
    objeto: _atasTexto_(r.objetoCompra || r.objeto, 500),
    dataAssinatura: _atasIso_(r.dataAssinatura || r.assinatura),
    vigenciaInicio: _atasIso_(r.dataVigenciaInicial || r.vigenciaInicial || r.vigenciaInicio),
    vigenciaFim: _atasIso_(r.dataVigenciaFinal || r.vigenciaFinal || r.vigenciaFim),
    idAtaPNCP: _atasTexto_(r.idAtaPNCP || r.identificadorPncp || r.numeroControlePncpAta || r.numeroControlePNCPAta, 180),
    linkPncp: _atasTexto_(r.linkAtaPNCP || r.linkPncp, 500),
    atualizadoOficialEm: new Date()
  };
}

function _atasExtrairListaApi_(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  var candidatos = [json.resultado, json.resultados, json.data, json.content, json.items];
  for (var i = 0; i < candidatos.length; i++) if (Array.isArray(candidatos[i])) return candidatos[i];
  return [];
}

function _atasBuscarOficiais_(params) {
  params = params || {};
  var uasg = String(params.uasg || ATAS_UASG_PADRAO).replace(/\D/g, '').slice(0, 12);
  var compra = String(params.numeroCompra || '').replace(/\D/g, '').slice(0, 30);
  var ano = String(params.anoCompra || '').replace(/\D/g, '').slice(0, 4);
  if (!compra) throw new Error('Informe o número da compra. A API oficial não oferece busca pelo número do processo.');
  var agoraAno = Number(Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy'));
  var baseAno = Number(ano || agoraAno);
  var anosConsulta = ano ? [baseAno, baseAno + 1, baseAno + 2] : [agoraAno - 1, agoraAno, agoraAno + 1];
  var porId = {};
  anosConsulta.forEach(function (anoVigencia) {
    var pagina = 1;
    var totalPaginas = 1;
    do {
      var query = [
        'pagina=' + pagina,
        'tamanhoPagina=500',
        'codigoUnidadeGerenciadora=' + encodeURIComponent(uasg),
        'dataVigenciaInicialMin=' + anoVigencia + '-01-01',
        'dataVigenciaInicialMax=' + anoVigencia + '-12-31'
      ];
      var url = ATAS_API_BASE + '/1_consultarARP?' + query.join('&');
      var resp = UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: { Accept: 'application/json' } });
      var code = resp.getResponseCode();
      if (code < 200 || code >= 300) throw new Error('Compras.gov.br indisponível no momento (HTTP ' + code + '). Tente novamente ou use o cadastro manual.');
      var json = JSON.parse(resp.getContentText() || '{}');
      totalPaginas = Math.max(1, Number(json.totalPaginas || 1));
      _atasExtrairListaApi_(json).map(_atasNormalizarOficial_).forEach(function (ata) {
        if (String(ata.numeroCompra).replace(/\D/g, '') !== compra) return;
        if (ano && String(ata.anoCompra) !== ano) return;
        porId[_atasDocId_(ata)] = ata;
      });
      pagina++;
    } while (pagina <= totalPaginas);
  });
  return Object.keys(porId).map(function (k) { return porId[k]; });
}

function consultarAtasComprasApp(params, authToken) {
  _authRequire_(authToken, false);
  _atasRequireAtiva_();
  return { ok: true, atas: _atasBuscarOficiais_(params), consultadoEm: new Date().toISOString(), somenteLeitura: true };
}

function _atasLocalizarOficial_(dados) {
  var lista = _atasBuscarOficiais_({ uasg: dados.uasg, numeroCompra: dados.numeroCompra, anoCompra: dados.anoCompra, processo: dados.processo });
  var id = _atasTexto_(dados.idAtaPNCP);
  var numero = _atasNorm_(dados.numeroAta);
  for (var i = 0; i < lista.length; i++) {
    if ((id && lista[i].idAtaPNCP === id) || (!id && _atasNorm_(lista[i].numeroAta) === numero)) return lista[i];
  }
  throw new Error('A ata selecionada não foi confirmada novamente no Compras.gov.br. Faça uma nova consulta.');
}

function _atasLocalizarManualCorrespondente_(ataOficial, interno) {
  var numero = _atasNorm_(ataOficial && ataOficial.numeroAta);
  var uasg = String(ataOficial && ataOficial.uasg || '').replace(/\D/g, '');
  var compra = String(ataOficial && ataOficial.numeroCompra || '').replace(/\D/g, '');
  var anoCompra = String(ataOficial && ataOficial.anoCompra || '');
  var processoId = _atasTexto_(interno && interno.processoId);
  var processo = _atasNorm_(interno && interno.processo);
  return _atasListar_().filter(function (a) {
    if (a.arquivada || a.origem !== 'manual') return false;
    var mesmoNumero = numero && _atasNorm_(a.numeroAta) === numero
      && (!uasg || String(a.uasg || '').replace(/\D/g, '') === uasg);
    var mesmaCompra = compra && String(a.numeroCompra || '').replace(/\D/g, '') === compra
      && (!anoCompra || String(a.anoCompra || '') === anoCompra);
    var mesmoProcesso = (processoId && a.processoId === processoId)
      || (processo && _atasNorm_(a.processo) === processo);
    return mesmoNumero || (mesmaCompra && mesmoProcesso);
  })[0] || null;
}

function salvarAtaApp(dados, authToken) {
  return _withAppLockResult_('salvar ata', function () {
    try {
      var sess = _authRequire_(authToken, false);
      _atasRequireAtiva_();
      dados = dados || {};
      var interno = _atasSanitizarInterno_(dados);
      var responsavelInformado = !!interno.responsavel;
      if (!interno.responsavel) interno.responsavel = sess.nome;
      if (!_atasPodeCriar_(sess, interno)) throw new Error('Você só pode cadastrar atas dos processos pelos quais responde na fase externa.');
      var oficial = null;
      if (_atasNorm_(dados.origem) === 'compras') oficial = _atasLocalizarOficial_(dados);
      var manualAnterior = oficial ? _atasLocalizarManualCorrespondente_(oficial, interno) : null;
      var ata = oficial || {
        origem: 'manual', numeroAta: _atasTexto_(dados.numeroAta, 80), anoAta: _atasTexto_(dados.anoAta, 4),
        uasg: String(dados.uasg || ATAS_UASG_PADRAO).replace(/\D/g, '').slice(0, 12),
        numeroCompra: _atasTexto_(dados.numeroCompra, 30), anoCompra: _atasTexto_(dados.anoCompra, 4),
        dataAssinatura: _atasIso_(dados.dataAssinatura), vigenciaInicio: _atasIso_(dados.vigenciaInicio),
        vigenciaFim: _atasIso_(dados.vigenciaFim)
      };
      if (manualAnterior) {
        if (!responsavelInformado) interno.responsavel = manualAnterior.responsavel || sess.nome;
        if (!interno.observacao) interno.observacao = manualAnterior.observacao || '';
        if (!interno.processoId) interno.processoId = manualAnterior.processoId || '';
        if (!interno.processo) interno.processo = manualAnterior.processo || '';
        if (!interno.objeto) interno.objeto = manualAnterior.objeto || '';
      }
      Object.keys(interno).forEach(function (k) { if (interno[k]) ata[k] = interno[k]; });
      if (!ata.numeroAta) throw new Error('Informe o número da ata.');
      if (ata.vigenciaInicio && ata.vigenciaFim && ata.vigenciaFim < ata.vigenciaInicio) throw new Error('A vigência final não pode ser anterior à inicial.');
      var idDoc = _atasDocId_(ata);
      var existente = _fsGet_('atas/' + idDoc);
      if (existente && !dados.confirmarAtualizacao) throw new Error('Esta ata já está no controle da unidade.');
      var agora = new Date();
      ata.criadoEm = existente && existente.criadoEm ? existente.criadoEm : (manualAnterior && manualAnterior.criadoEm || agora);
      ata.criadoPor = existente && existente.criadoPor ? existente.criadoPor : (manualAnterior && manualAnterior.criadoPor || sess.nome);
      ata.atualizadoEm = agora;
      ata.atualizadoPor = sess.nome;
      ata.arquivada = false;
      _fsSet_('atas/' + idDoc, ata);
      if (manualAnterior && manualAnterior._id !== idDoc) {
        _fsUpdate_('atas/' + manualAnterior._id, {
          arquivada: true, vinculadaOficialEm: agora, substituidaPor: idDoc, atualizadoPor: sess.nome
        });
      }
      return { ok: true, ata: Object.assign({ _id: idDoc }, ata), atualizada: !!existente, vinculouManual: !!manualAnterior };
    } catch (e) { return { ok: false, erro: e.message }; }
  });
}

function atualizarAtaInternaApp(dados, authToken) {
  return _withAppLockResult_('atualizar ata', function () {
    try {
      var sess = _authRequire_(authToken, false);
      _atasRequireAtiva_();
      dados = dados || {};
      var id = _atasTexto_(dados.id, 180).replace(/[^a-zA-Z0-9_-]/g, '');
      var ata = id ? _fsGet_('atas/' + id) : null;
      if (!ata) throw new Error('Ata não encontrada.');
      if (!_atasPodeEditar_(sess, ata)) throw new Error('Você não tem permissão para editar esta ata.');
      var campos = {
        responsavel: _atasTexto_(dados.responsavel || ata.responsavel, 120),
        observacao: _atasTexto_(dados.observacao, 1500), atualizadoEm: new Date(), atualizadoPor: sess.nome
      };
      if (ata.origem === 'manual') {
        campos.dataAssinatura = _atasIso_(dados.dataAssinatura || ata.dataAssinatura);
        campos.vigenciaInicio = _atasIso_(dados.vigenciaInicio || ata.vigenciaInicio);
        campos.vigenciaFim = _atasIso_(dados.vigenciaFim || ata.vigenciaFim);
        if (campos.vigenciaInicio && campos.vigenciaFim && campos.vigenciaFim < campos.vigenciaInicio) throw new Error('A vigência final não pode ser anterior à inicial.');
      }
      _fsUpdate_('atas/' + id, campos);
      return { ok: true };
    } catch (e) { return { ok: false, erro: e.message }; }
  });
}

function arquivarAtaApp(id, authToken) {
  return _withAppLockResult_('arquivar ata', function () {
    try {
      var sess = _authRequire_(authToken, true);
      _atasRequireAtiva_();
      id = _atasTexto_(id, 180).replace(/[^a-zA-Z0-9_-]/g, '');
      if (!_fsGet_('atas/' + id)) throw new Error('Ata não encontrada.');
      _fsUpdate_('atas/' + id, { arquivada: true, arquivadaEm: new Date(), arquivadaPor: sess.nome });
      return { ok: true };
    } catch (e) { return { ok: false, erro: e.message }; }
  });
}

function _atasAvisoId_(ata, marco) {
  return [_atasDocId_(ata), _atasIso_(ata.vigenciaFim) || 'sem-data', String(marco)].join('-').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 220);
}

function _atasGerarAvisos_() {
  var hoje = _atasHojeIso_();
  _atasListar_().forEach(function (ata) {
    if (ata.arquivada) return;
    var marco = _atasMarcoAtual_(ata, hoje);
    if (marco === null) return;
    var id = _atasAvisoId_(ata, marco);
    if (_fsGet_('avisosAtas/' + id)) return;
    _fsSet_('avisosAtas/' + id, {
      ataId: ata._id, numeroAta: ata.numeroAta || '', processo: ata.processo || '', objeto: ata.objeto || '',
      responsavel: ata.responsavel || '', vigenciaFim: ata.vigenciaFim || '', marcoDias: marco,
      criadoEm: new Date(), lidoPor: [], emailEnviadoPara: [], unidade: _fsUnidade_()
    });
  });
}

function _atasAvisosVisiveis_(sess) {
  _atasGerarAvisos_();
  var todos = _fs_().query('avisosAtas').Execute().map(_atasFormatarDoc_);
  if (!(sess.isChefe || sess.isAdmin)) {
    todos = todos.filter(function (a) { return _atasNorm_(a.responsavel) === _atasNorm_(sess.nome); });
  }
  todos = todos.filter(function (a) { return (a.lidoPor || []).indexOf(sess.matricula) < 0; });
  todos.sort(function (a, b) {
    var pa = a.marcoDias === 0 ? -1 : Number(a.marcoDias || 999);
    var pb = b.marcoDias === 0 ? -1 : Number(b.marcoDias || 999);
    return pa - pb;
  });
  return todos;
}

function getAlertasAtasApp(authToken) {
  var sess = _authRequire_(authToken, false);
  if (!_atasHabilitada_()) return { ok: true, enabled: false, alertas: [] };
  return { ok: true, enabled: true, alertas: _atasAvisosVisiveis_(sess) };
}

function marcarAlertaAtaLidoApp(id, authToken) {
  try {
    var sess = _authRequire_(authToken, false);
    _atasRequireAtiva_();
    id = _atasTexto_(id, 220).replace(/[^a-zA-Z0-9_-]/g, '');
    var aviso = _fsGet_('avisosAtas/' + id);
    if (!aviso) throw new Error('Aviso não encontrado.');
    if (!(sess.isChefe || sess.isAdmin) && _atasNorm_(aviso.responsavel) !== _atasNorm_(sess.nome)) throw new Error('Aviso não permitido.');
    var lidos = aviso.lidoPor || [];
    if (lidos.indexOf(sess.matricula) < 0) lidos.push(sess.matricula);
    _fsUpdate_('avisosAtas/' + id, { lidoPor: lidos, atualizadoEm: new Date() });
    return { ok: true };
  } catch (e) { return { ok: false, erro: e.message }; }
}

function getGestaoAtasApp(authToken) {
  var sess = _authRequire_(authToken, false);
  if (!_atasHabilitada_()) return { ok: true, enabled: false, atas: [], alertas: [] };
  var sync = _fsGet_('syncAtas/estado') || {};
  return {
    ok: true, enabled: true, somenteLeituraCompras: true, unidade: _fsUnidade_(),
    uasg: ATAS_UASG_PADRAO, podeGerirTodas: !!(sess.isChefe || sess.isAdmin),
    atas: _atasListar_(), alertas: _atasAvisosVisiveis_(sess),
    consultadoEm: sync.ultimoSucessoEm || sync.ultimaTentativaEm || ''
  };
}

function _atasSincronizarUnidade_() {
  if (!_atasHabilitada_()) return { atualizadas: 0, erros: 0 };
  var cache = {};
  var atualizadas = 0;
  var erros = 0;
  _fsUpdate_('syncAtas/estado', { ultimaTentativaEm: new Date(), status: 'executando' });
  _atasListar_().forEach(function (ata) {
    if (ata.arquivada || ata.origem !== 'compras' || !ata.numeroCompra || !ata.anoCompra) return;
    var chave = ata.numeroCompra + '/' + ata.anoCompra;
    try {
      if (!cache[chave]) cache[chave] = _atasBuscarOficiais_({ uasg: ata.uasg, numeroCompra: ata.numeroCompra, anoCompra: ata.anoCompra });
      var oficial = cache[chave].filter(function (o) {
        return (ata.idAtaPNCP && o.idAtaPNCP === ata.idAtaPNCP) || (!ata.idAtaPNCP && _atasNorm_(o.numeroAta) === _atasNorm_(ata.numeroAta));
      })[0];
      if (!oficial) { erros++; return; }
      // Atualiza somente campos oficiais; responsável e observação permanecem internos.
      _fsUpdate_('atas/' + ata._id, oficial);
      atualizadas++;
    } catch (e) { erros++; }
  });
  _fsUpdate_('syncAtas/estado', { ultimoSucessoEm: new Date(), status: erros ? 'parcial' : 'ok', atualizadas: atualizadas, erros: erros });
  return { atualizadas: atualizadas, erros: erros };
}

function sincronizarAtasApp(authToken) {
  _authRequire_(authToken, true);
  _atasRequireAtiva_();
  return Object.assign({ ok: true }, _atasSincronizarUnidade_());
}

function _atasEmailHtml_(nome, avisos, chefe) {
  var linhas = avisos.map(function (a) {
    var prazo = Number(a.marcoDias) === 0 ? 'Vencida' : 'Vence em até ' + a.marcoDias + ' dias';
    return '<tr><td style="padding:8px;border-bottom:1px solid #e2e8f0"><b>' + _atasEscHtml_(a.numeroAta) + '</b></td>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0">' + _atasEscHtml_(a.objeto || a.processo || '—') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0">' + _atasEscHtml_(a.responsavel || '—') + '</td>'
      + '<td style="padding:8px;border-bottom:1px solid #e2e8f0">' + _atasEscHtml_(prazo) + '</td></tr>';
  }).join('');
  return '<div style="font-family:Arial,sans-serif;color:#1e293b"><h2 style="color:#153a63">Gestão de Atas</h2>'
    + '<p>Olá, ' + _atasEscHtml_(nome) + '. ' + (chefe ? 'Este é o resumo da unidade.' : 'Estas são as atas sob sua responsabilidade.') + '</p>'
    + '<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr><th align="left">Ata</th><th align="left">Objeto/processo</th><th align="left">Responsável</th><th align="left">Situação</th></tr></thead><tbody>' + linhas + '</tbody></table>'
    + '<p style="font-size:12px;color:#64748b">O sino do aplicativo continua sendo a fonte persistente dos avisos.</p></div>';
}

function _atasEscHtml_(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; });
}

function _atasEnviarResumoUnidade_() {
  if (!_atasHabilitada_()) return { enviados: 0, pulados: 0 };
  _atasGerarAvisos_();
  var avisos = _fs_().query('avisosAtas').Execute().map(_atasFormatarDoc_);
  if (!avisos.length) return { enviados: 0, pulados: 0 };
  var servidores = _getServidoresApp_();
  var destinatarios = {};
  servidores.forEach(function (s) {
    var email = _emailServidorPorNome_(s.nome);
    if (!email) return;
    var elegiveis = avisos.filter(function (a) { return (a.emailEnviadoPara || []).indexOf(email) < 0; });
    var proprios = elegiveis.filter(function (a) { return _atasNorm_(a.responsavel) === _atasNorm_(s.nome); });
    var itens = s.isChefe ? elegiveis : proprios;
    if (itens.length) destinatarios[email] = { nome: s.nome, chefe: !!s.isChefe, avisos: itens };
  });
  var quota = Math.max(0, MailApp.getRemainingDailyQuota() - ATAS_EMAIL_RESERVA_OUTROS_FLUXOS);
  function urgencia(d) {
    var vals = d.avisos.map(function (a) { return Number(a.marcoDias) === 0 ? -1 : Number(a.marcoDias || 999); });
    return vals.length ? Math.min.apply(Math, vals) : 999;
  }
  var emails = Object.keys(destinatarios).sort(function (a, b) {
    return urgencia(destinatarios[a]) - urgencia(destinatarios[b]);
  }).slice(0, Math.min(quota, ATAS_EMAIL_MAX_DESTINATARIOS_PILOTO));
  var enviados = 0;
  var falhas = 0;
  emails.forEach(function (email) {
    var d = destinatarios[email];
    try {
      MailApp.sendEmail({
        to: email,
        subject: '[App Gestão] Resumo de Atas — ' + _fsUnidade_(),
        body: 'Há ' + d.avisos.length + ' aviso(s) de atas. Consulte a Gestão de Atas no aplicativo.',
        htmlBody: _atasEmailHtml_(d.nome, d.avisos, d.chefe)
      });
      enviados++;
      d.avisos.forEach(function (a) {
        var lista = a.emailEnviadoPara || [];
        if (lista.indexOf(email) < 0) lista.push(email);
        _fsUpdate_('avisosAtas/' + a._id, { emailEnviadoPara: lista, emailUltimoEnvioEm: new Date() });
      });
    } catch (e) {
      falhas++;
      d.avisos.forEach(function (a) {
        _fsUpdate_('avisosAtas/' + a._id, {
          emailUltimaFalhaEm: new Date(), emailUltimoErro: _atasTexto_(e && e.message || e, 300)
        });
      });
    }
  });
  var pulados = Math.max(0, Object.keys(destinatarios).length - emails.length);
  _fsUpdate_('syncAtas/estado', {
    ultimoResumoEm: new Date(), emailsEnviados: enviados, emailsFalhos: falhas, emailsPuladosPorCota: pulados
  });
  return { enviados: enviados, falhas: falhas, pulados: pulados };
}

function enviarResumoAtasTodasUnidades() {
  var anterior = typeof _FS_UNIDADE_REQ === 'string' ? _FS_UNIDADE_REQ : '';
  var total = { enviados: 0, falhas: 0, pulados: 0, unidades: 0 };
  try {
    _atasUnidadesHabilitadas_().forEach(function (unidade) {
      _FS_UNIDADE_REQ = unidade;
      try { _atasSincronizarUnidade_(); } catch (eSync) {}
      var r = _atasEnviarResumoUnidade_();
      total.enviados += r.enviados || 0;
      total.falhas += r.falhas || 0;
      total.pulados += r.pulados || 0;
      total.unidades++;
    });
  } finally { _FS_UNIDADE_REQ = anterior; }
  return total;
}
