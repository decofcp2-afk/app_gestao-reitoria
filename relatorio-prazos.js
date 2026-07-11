/* ════════════════════════════════════════════════════════════════════════
 * relatorio-prazos.js — Núcleo estatístico da aba "Visão Geral" (perfil Admin)
 *
 * Funções PURAS (sem DOM, sem Firestore) que sustentam o relatório de prazos
 * por etapa pedido pelo Felipe: quartis, cerca de outliers e desenho do
 * boxplot. Ficam isoladas aqui para serem testadas no Node (pasta tests/) com
 * o MESMO código que o navegador roda — o padrão de export dual (browser +
 * CommonJS) espelha appsel-firestore.js.
 *
 * Definições (ver PLANO_RELATORIO_PRAZOS_ADMIN.md, §2):
 *   Q1/Q2/Q3 = percentis 25/50/75 por interpolação linear tipo 7
 *              (bate com QUARTILE.INC/PERCENTIL.INC do Excel e Google Sheets).
 *   DIQ = Q3 − Q1 ; LS = Q3 + 1,5·DIQ ; LI = Q1 − 1,5·DIQ.
 *   outlier = valor > LS ou < LI ; bigodes = extremos DENTRO de [LI, LS].
 *
 * Fase 1 do plano: só o núcleo estatístico. A pipeline início→conclusão real
 * (Fase 2) e a aba/UI (Fase 3) entram em mudanças seguintes.
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

  root.RelatorioPrazos = {
    quartil: quartil,
    media: media,
    estatEtapa: estatEtapa,
    boxplotSVG: boxplotSVG
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.RelatorioPrazos;
})(typeof window !== 'undefined' ? window : globalThis);
