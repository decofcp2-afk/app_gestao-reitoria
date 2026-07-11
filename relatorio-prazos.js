/* ════════════════════════════════════════════════════════════════════════
 * relatorio-prazos.js — Núcleo estatístico da aba "Visão Geral" (perfil Admin)
 *
 * Funções PURAS (sem DOM, sem Firestore) que sustentam o relatório de prazos
 * por etapa pedido pelo Felipe. Ficam isoladas aqui para serem testadas no Node
 * (pasta tests/) com o MESMO código que o navegador roda — o padrão de export
 * dual (browser + CommonJS) espelha appsel-firestore.js.
 *
 * Conteúdo (ver PLANO_RELATORIO_PRAZOS_ADMIN.md):
 *   Fase 1 — estatística: quartil(), estatEtapa(), boxplotSVG().
 *     Q1/Q2/Q3 = percentis 25/50/75 por interpolação linear tipo 7 (bate com
 *     QUARTILE.INC do Excel/Sheets). DIQ = Q3−Q1 ; LS = Q3+1,5·DIQ ;
 *     LI = Q1−1,5·DIQ ; outlier = >LS ou <LI ; bigodes = extremos em [LI, LS].
 *   Fase 2 — pipeline: agregarPrazos(), mesclarGeral().
 *     Prazo real = início real (conclusão da etapa anterior, ou D0 na 1ª) até a
 *     conclusão real (DataRealizacao). D1: ano da conclusão. D2: dias corridos.
 *     D3: sem descontar fila/paralisação.
 *
 * A aba/UI "Visão Geral" (só Admin), que consome estas funções, entra na Fase 3.
 * ════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  function _ehNum(v) { return typeof v === 'number' && isFinite(v); }

  // Ordena uma cópia numérica ascendente, descartando não-números.
  function _ordenar(vals) {
    return (vals || []).filter(_ehNum).slice().sort(function (a, b) { return a - b; });
  }

  // Quartil/percentil por interpolação linear tipo 7 (Excel/Sheets INC).
  // p ∈ [0,1]. Aceita array já ordenado ou não. Retorna null se vazio.
  function quartil(vals, p) {
    var xs = _ordenar(vals);
    var n = xs.length;
    if (!n) return null;
    if (n === 1) return xs[0];
    var h = (n - 1) * p;         // posição 0-based no vetor ordenado
    var lo = Math.floor(h);
    var hi = Math.ceil(h);
    if (lo === hi) return xs[lo];
    return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
  }

  function media(vals) {
    var xs = _ordenar(vals);
    if (!xs.length) return null;
    var s = 0;
    xs.forEach(function (v) { s += v; });
    return s / xs.length;
  }

  // Estatística completa de uma amostra de prazos (em dias) de uma etapa.
  // Retorna sempre o mesmo formato; com amostra vazia devolve n=0 e nulos.
  function estatEtapa(vals) {
    var xs = _ordenar(vals);
    var n = xs.length;
    if (!n) {
      return {
        n: 0, min: null, max: null,
        q1: null, mediana: null, q3: null, diq: null, ls: null, li: null,
        media: null, whiskerLo: null, whiskerHi: null,
        outliers: [], amostraPequena: true
      };
    }
    var q1 = quartil(xs, 0.25);
    var q2 = quartil(xs, 0.50);
    var q3 = quartil(xs, 0.75);
    var diq = q3 - q1;
    var ls = q3 + 1.5 * diq;
    var li = q1 - 1.5 * diq;
    // Bigodes: menor/maior valor que ainda está DENTRO da cerca [LI, LS].
    var dentro = xs.filter(function (v) { return v >= li && v <= ls; });
    var whiskerLo = dentro.length ? dentro[0] : xs[0];
    var whiskerHi = dentro.length ? dentro[dentro.length - 1] : xs[n - 1];
    var outliers = xs.filter(function (v) { return v < li || v > ls; });
    return {
      n: n, min: xs[0], max: xs[n - 1],
      q1: q1, mediana: q2, q3: q3, diq: diq, ls: ls, li: li,
      media: media(xs), whiskerLo: whiskerLo, whiskerHi: whiskerHi,
      outliers: outliers, amostraPequena: n < 4
    };
  }

  // ── Desenho do boxplot (SVG inline, sem biblioteca) ────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // Arredonda p/ 2 casas só para não poluir o SVG com dízimas.
  function _px(v) { return Math.round(v * 100) / 100; }
  // Rótulo numérico de dias (1 casa quando precisa).
  function _fmt(v) {
    if (v == null) return '';
    var r = Math.round(v * 10) / 10;
    return (Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1));
  }

  // series: [{ rotulo, estat }] — estat vindo de estatEtapa().
  // opts: { largura, altura, cor, corOutlier, unidade } (todos opcionais).
  // Boxplots verticais lado a lado, com eixo numérico compartilhado.
  // Retorna uma string SVG (pura — o chamador injeta no DOM).
  function boxplotSVG(series, opts) {
    opts = opts || {};
    series = (series || []).filter(function (s) { return s && s.estat; });
    var unidade = opts.unidade || 'd';
    var cor = opts.cor || '#2563eb';
    var corBox = opts.corBox || '#dbeafe';
    var corOut = opts.corOutlier || '#dc2626';
    var padL = 46, padR = 14, padT = 16, padB = 52;
    var W = opts.largura || Math.max(160, series.length * 96 + padL + padR);
    var H = opts.altura || 320;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;

    if (!series.length) {
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Sem dados">'
        + '<text x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle" '
        + 'fill="#94a3b8" font-size="13" font-family="sans-serif">Sem dados no período</text></svg>';
    }

    // Domínio numérico (inclui outliers).
    var vals = [];
    series.forEach(function (s) {
      var e = s.estat;
      if (!e || !e.n) return;
      [e.min, e.max, e.whiskerLo, e.whiskerHi, e.q1, e.q3, e.mediana].forEach(function (v) {
        if (_ehNum(v)) vals.push(v);
      });
      (e.outliers || []).forEach(function (o) { if (_ehNum(o)) vals.push(o); });
    });
    var dmin = vals.length ? Math.min.apply(null, vals) : 0;
    var dmax = vals.length ? Math.max.apply(null, vals) : 1;
    if (dmin === dmax) { dmax = dmin + 1; }
    var folga = (dmax - dmin) * 0.08 || 1;
    dmin -= folga; dmax += folga;
    function y(v) { return padT + plotH * (1 - (v - dmin) / (dmax - dmin)); }

    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" '
      + 'font-family="sans-serif" role="img" aria-label="Boxplot de prazos por etapa">');

    // Eixo Y + grade (5 marcas).
    var nT = 4;
    for (var t = 0; t <= nT; t++) {
      var val = dmin + (dmax - dmin) * t / nT;
      var yy = _px(y(val));
      parts.push('<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy
        + '" stroke="#eef2f7" stroke-width="1"/>');
      parts.push('<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" '
        + 'fill="#64748b" font-size="10">' + _fmt(val) + '</text>');
    }

    var band = plotW / series.length;
    var boxW = Math.min(48, band * 0.52);

    series.forEach(function (s, i) {
      var e = s.estat;
      var cx = _px(padL + band * (i + 0.5));
      parts.push('<g class="bp-box" data-rotulo="' + _esc(s.rotulo) + '">');

      if (e && e.n) {
        var x0 = _px(cx - boxW / 2), x1 = _px(cx + boxW / 2);

        if (e.amostraPequena) {
          // n<4: sem caixa/cerca — só os pontos e a mediana (evita conclusão frágil).
          var xs = [e.min].concat(e.outliers).concat([e.max]);
          parts.push('<line class="bp-mediana" x1="' + x0 + '" y1="' + _px(y(e.mediana))
            + '" x2="' + x1 + '" y2="' + _px(y(e.mediana)) + '" stroke="' + cor + '" stroke-width="2.5"/>');
          parts.push('<line x1="' + cx + '" y1="' + _px(y(e.min)) + '" x2="' + cx + '" y2="'
            + _px(y(e.max)) + '" stroke="#cbd5e1" stroke-width="1" stroke-dasharray="3 3"/>');
        } else {
          var yQ1 = _px(y(e.q1)), yQ3 = _px(y(e.q3)), yMed = _px(y(e.mediana));
          var yWlo = _px(y(e.whiskerLo)), yWhi = _px(y(e.whiskerHi));
          // Haste (bigodes) + caps.
          parts.push('<line x1="' + cx + '" y1="' + yWhi + '" x2="' + cx + '" y2="' + yQ3
            + '" stroke="' + cor + '" stroke-width="1.5"/>');
          parts.push('<line x1="' + cx + '" y1="' + yQ1 + '" x2="' + cx + '" y2="' + yWlo
            + '" stroke="' + cor + '" stroke-width="1.5"/>');
          parts.push('<line x1="' + x0 + '" y1="' + yWhi + '" x2="' + x1 + '" y2="' + yWhi
            + '" stroke="' + cor + '" stroke-width="1.5"/>');
          parts.push('<line x1="' + x0 + '" y1="' + yWlo + '" x2="' + x1 + '" y2="' + yWlo
            + '" stroke="' + cor + '" stroke-width="1.5"/>');
          // Caixa Q1–Q3.
          parts.push('<rect x="' + x0 + '" y="' + Math.min(yQ1, yQ3) + '" width="' + _px(boxW)
            + '" height="' + _px(Math.abs(yQ1 - yQ3)) + '" fill="' + corBox + '" stroke="' + cor
            + '" stroke-width="1.5"/>');
          // Mediana.
          parts.push('<line class="bp-mediana" x1="' + x0 + '" y1="' + yMed + '" x2="' + x1
            + '" y2="' + yMed + '" stroke="' + cor + '" stroke-width="2.5"/>');
        }

        // Outliers (pontos vermelhos).
        (e.outliers || []).forEach(function (o) {
          parts.push('<circle class="bp-outlier" cx="' + cx + '" cy="' + _px(y(o))
            + '" r="3" fill="' + corOut + '"/>');
        });

        // Rótulo da mediana.
        parts.push('<text x="' + cx + '" y="' + _px(y(e.mediana) - 6) + '" text-anchor="middle" '
          + 'fill="' + cor + '" font-size="10" font-weight="700">' + _fmt(e.mediana) + '</text>');
      } else {
        parts.push('<text x="' + cx + '" y="' + _px(padT + plotH / 2) + '" text-anchor="middle" '
          + 'fill="#cbd5e1" font-size="10">—</text>');
      }

      // Rótulo da categoria (n embaixo).
      var rot = String(s.rotulo == null ? '' : s.rotulo);
      var rotCurto = rot.length > 16 ? rot.slice(0, 15) + '…' : rot;
      parts.push('<text x="' + cx + '" y="' + (H - padB + 16) + '" text-anchor="middle" '
        + 'fill="#334155" font-size="10">' + _esc(rotCurto) + '</text>');
      parts.push('<text x="' + cx + '" y="' + (H - padB + 30) + '" text-anchor="middle" '
        + 'fill="#94a3b8" font-size="9">n=' + ((e && e.n) || 0) + (unidade ? ' · ' + unidade : '') + '</text>');

      parts.push('</g>');
    });

    parts.push('</svg>');
    return parts.join('');
  }

  // ── Pipeline: prazo REAL de cada etapa (início real → conclusão real) ──
  // Decisões do PLANO_RELATORIO_PRAZOS_ADMIN.md:
  //   D1 — o "ano" é o ano da CONCLUSÃO real da etapa (DataRealizacao).
  //   D2 — dias CORRIDOS (tempo de calendário), independentemente do modo das telas.
  //   D3 — NÃO se desconta tempo em fila/paralisação: mede-se o literal
  //        início→conclusão (é o que revela os outliers/piores prazos).
  // Início real de uma etapa concluída = conclusão real da etapa concluída
  // anterior do mesmo processo (o "cursor"); na 1ª etapa, é o D0 do processo.
  function _normText(s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim().replace(/\s+/g, ' ');
  }
  // Só precisamos distinguir concluída ('ok') e não-se-aplica ('na'); o resto
  // é "ainda não concluída" e não entra no cálculo.
  function _statusEtapa(s) {
    var n = _normText(s);
    if (!n) return 'pendente';
    if (n.indexOf('conclu') >= 0) return 'ok';
    if (n === 'nao se aplica' || n === 'n/a') return 'na';
    return 'pendente';
  }
  // Espelha isEtapaContratual de appsel-firestore.js/Code.gs.
  function _ehContratual(fase, nome) {
    var f = _normText(fase), n = _normText(nome);
    return f.indexOf('contrat') >= 0 || n.indexOf('assinatura contrato') >= 0 ||
      n.indexOf('ata (arp)') >= 0 || n.indexOf('gestao contratual') >= 0;
  }
  // Aceita Date, Timestamp do Firestore ({toDate}/{seconds}), ISO ou 'YYYY-MM-DD'.
  // Normaliza para a data de calendário (meia-noite local), como parseTs().
  function _parseData(v) {
    if (!v) return null;
    var d = null;
    if (v instanceof Date) d = v;
    else if (typeof v.toDate === 'function') d = v.toDate();
    else if (typeof v === 'object' && (typeof v.seconds === 'number' || typeof v._seconds === 'number')) {
      d = new Date((typeof v.seconds === 'number' ? v.seconds : v._seconds) * 1000);
    } else {
      d = new Date(String(v));
    }
    if (!d || isNaN(d.getTime())) return null;
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function _diasCorridos(ini, fim) {
    if (!ini || !fim) return null;
    var a = new Date(ini.getTime()); a.setHours(0, 0, 0, 0);
    var b = new Date(fim.getTime()); b.setHours(0, 0, 0, 0);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  function _toIsoLocal(d) {
    if (!d) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
  function _ordenarGrupos(map) {
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      if (a.etapaChave !== b.etapaChave) return a.etapaChave < b.etapaChave ? -1 : 1;
      return a.ano - b.ano;
    });
  }

  // processos: [{ id (ou _id), d0 }]  — d0 em Date/Timestamp/ISO.
  // etapas:    [{ processoId, etapa, fase, status, dataRealizacao, ordem }].
  // opts:      { unidade, ano } — ano (opcional) filtra pela conclusão.
  // Retorna { unidade, grupos:[{etapa, etapaChave, unidade, ano, dias:[], itens:[]}],
  //           anosDisponiveis:[], descartados:{ semData, inconsistentes } }.
  function agregarPrazos(processos, etapas, opts) {
    opts = opts || {};
    var unidade = opts.unidade || '';
    var anoFiltro = (opts.ano != null && opts.ano !== '') ? Number(opts.ano) : null;

    var d0Por = {};
    (processos || []).forEach(function (p) {
      var pid = String((p && (p.id || p._id)) || '').trim();
      if (pid) d0Por[pid] = _parseData(p.d0);
    });

    var etpPor = {};
    (etapas || []).forEach(function (e) {
      var pid = String((e && e.processoId) || '').trim();
      var nome = String((e && e.etapa) || '').trim();
      if (!pid || !nome) return;
      (etpPor[pid] = etpPor[pid] || []).push(e);
    });
    Object.keys(etpPor).forEach(function (pid) {
      etpPor[pid].sort(function (a, b) { return Number(a.ordem || 0) - Number(b.ordem || 0); });
    });

    var gruposMap = {};
    var descartados = { semData: 0, inconsistentes: 0 };
    var anosSet = {};

    Object.keys(etpPor).forEach(function (pid) {
      var d0 = d0Por[pid];
      if (!d0) return;                       // sem D0: processo ainda na fila
      var cursor = d0;                       // última conclusão real (começa no D0)
      etpPor[pid].forEach(function (e) {
        var nome = String(e.etapa || '').trim();
        if (_ehContratual(e.fase, nome)) return;     // contratual: responsabilidade de Contratos
        var st = _statusEtapa(e.status);
        if (st === 'na') return;                     // não se aplica
        if (st !== 'ok') return;                     // ainda não concluída
        var fim = _parseData(e.dataRealizacao);
        if (!fim) { descartados.semData++; return; } // concluída sem data válida
        var ini = cursor;
        var dias = _diasCorridos(ini, fim);
        if (dias == null || dias < 0) {              // fim antes do início: inconsistente
          descartados.inconsistentes++;
          cursor = fim;                              // ainda assim é uma conclusão real
          return;
        }
        var ano = fim.getFullYear();
        anosSet[ano] = true;
        cursor = fim;                                // avança para a conclusão real
        if (anoFiltro != null && ano !== anoFiltro) return;
        var chave = _normText(nome) + '¬' + ano;
        var g = gruposMap[chave] || (gruposMap[chave] = {
          etapa: nome, etapaChave: _normText(nome), unidade: unidade, ano: ano, dias: [], itens: []
        });
        g.dias.push(dias);
        g.itens.push({ processoId: pid, ini: _toIsoLocal(ini), fim: _toIsoLocal(fim), dias: dias });
      });
    });

    return {
      unidade: unidade,
      grupos: _ordenarGrupos(gruposMap),
      anosDisponiveis: Object.keys(anosSet).map(Number).sort(function (a, b) { return a - b; }),
      descartados: descartados
    };
  }

  // Mescla vários resultados de agregarPrazos (um por unidade) na visão "Geral",
  // agrupando por etapa × ano. Cada item guarda a unidade de origem (p/ ranking).
  function mesclarGeral(resultados) {
    var gruposMap = {};
    var anosSet = {};
    var descartados = { semData: 0, inconsistentes: 0 };
    (resultados || []).forEach(function (r) {
      if (!r) return;
      (r.anosDisponiveis || []).forEach(function (a) { anosSet[a] = true; });
      if (r.descartados) {
        descartados.semData += r.descartados.semData || 0;
        descartados.inconsistentes += r.descartados.inconsistentes || 0;
      }
      (r.grupos || []).forEach(function (g) {
        var chave = g.etapaChave + '¬' + g.ano;
        var m = gruposMap[chave] || (gruposMap[chave] = {
          etapa: g.etapa, etapaChave: g.etapaChave, unidade: '(geral)', ano: g.ano, dias: [], itens: []
        });
        g.dias.forEach(function (d) { m.dias.push(d); });
        (g.itens || []).forEach(function (it) {
          m.itens.push({ processoId: it.processoId, ini: it.ini, fim: it.fim, dias: it.dias, unidade: r.unidade || g.unidade });
        });
      });
    });
    return {
      unidade: '(geral)',
      grupos: _ordenarGrupos(gruposMap),
      anosDisponiveis: Object.keys(anosSet).map(Number).sort(function (a, b) { return a - b; }),
      descartados: descartados
    };
  }

  // ── Modelo do relatório (o que a aba "Visão Geral" desenha) ────────────
  // porUnidade: [ resultado de agregarPrazos, ... ] (um por unidade).
  // opts: { unidadeSel, nomesUnidade } — unidadeSel '' ou '(geral)' = todas.
  // Retorna { unidadeSel, etapas:[{etapa, ano, estat, porUnidade:[{unidade,nome,estat}]}],
  //   ranking:{melhorUnidade, piorUnidade, unidades:[...]}, kpis:{...}, descartados }.
  function montarRelatorio(porUnidade, opts) {
    opts = opts || {};
    var nomes = opts.nomesUnidade || {};
    var unidadeSel = opts.unidadeSel || '';
    var ehGeral = !unidadeSel || unidadeSel === '(geral)';
    porUnidade = (porUnidade || []).filter(Boolean);

    var descartados = { semData: 0, inconsistentes: 0 };
    porUnidade.forEach(function (r) {
      if (r.descartados) {
        descartados.semData += r.descartados.semData || 0;
        descartados.inconsistentes += r.descartados.inconsistentes || 0;
      }
    });

    var fonte = ehGeral ? porUnidade : porUnidade.filter(function (r) { return r.unidade === unidadeSel; });

    // Agrupa por etapa: dias combinados + dias por unidade (p/ comparação e ranking).
    var etapasMap = {};
    fonte.forEach(function (r) {
      (r.grupos || []).forEach(function (g) {
        var m = etapasMap[g.etapaChave] || (etapasMap[g.etapaChave] = {
          etapa: g.etapa, etapaChave: g.etapaChave, ano: g.ano, diasTodos: [], porUni: {}
        });
        var alvo = (m.porUni[r.unidade] = m.porUni[r.unidade] || []);
        g.dias.forEach(function (d) { m.diasTodos.push(d); alvo.push(d); });
      });
    });

    var etapas = Object.keys(etapasMap).sort().map(function (k) {
      var m = etapasMap[k];
      var porUni = Object.keys(m.porUni).map(function (uni) {
        return { unidade: uni, nome: nomes[uni] || uni, estat: estatEtapa(m.porUni[uni]) };
      }).sort(function (a, b) { return (a.estat.mediana || 0) - (b.estat.mediana || 0); });
      return { etapa: m.etapa, etapaChave: k, ano: m.ano, estat: estatEtapa(m.diasTodos), porUnidade: porUni };
    });

    // Ranking geral de unidades (mediana de todos os prazos da unidade no escopo).
    var uniDias = {};
    fonte.forEach(function (r) {
      (r.grupos || []).forEach(function (g) {
        var alvo = (uniDias[r.unidade] = uniDias[r.unidade] || []);
        g.dias.forEach(function (d) { alvo.push(d); });
      });
    });
    var unidades = Object.keys(uniDias).map(function (uni) {
      var e = estatEtapa(uniDias[uni]);
      return { unidade: uni, nome: nomes[uni] || uni, mediana: e.mediana, n: e.n };
    }).filter(function (u) { return u.n > 0; })
      .sort(function (a, b) { return a.mediana - b.mediana; });

    // KPIs sobre todo o escopo.
    var todosDias = [];
    Object.keys(uniDias).forEach(function (uni) { todosDias.push.apply(todosDias, uniDias[uni]); });
    var estGeral = estatEtapa(todosDias);
    var nOutliers = etapas.reduce(function (acc, e) { return acc + (e.estat.outliers ? e.estat.outliers.length : 0); }, 0);

    return {
      unidadeSel: ehGeral ? '(geral)' : unidadeSel,
      etapas: etapas,
      ranking: {
        unidades: unidades,
        melhorUnidade: unidades.length ? unidades[0] : null,
        piorUnidade: unidades.length > 1 ? unidades[unidades.length - 1] : null
      },
      kpis: {
        nAmostra: estGeral.n,
        mediana: estGeral.mediana,
        nOutliers: nOutliers,
        nEtapas: etapas.length
      },
      descartados: descartados
    };
  }

  root.RelatorioPrazos = {
    quartil: quartil,
    media: media,
    estatEtapa: estatEtapa,
    boxplotSVG: boxplotSVG,
    agregarPrazos: agregarPrazos,
    mesclarGeral: mesclarGeral,
    montarRelatorio: montarRelatorio
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RelatorioPrazos;
})(typeof window !== 'undefined' ? window : globalThis);
