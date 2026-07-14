'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes de montarRelatorio() — o modelo que a aba "Visão Geral" desenha:
// estatística por etapa, comparação por unidade, ranking e KPIs.
//
// Alvo: montarRelatorio() de relatorio-prazos.js.
// Rodar: npm test
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarPrazos, montarRelatorio } = require('../relatorio-prazos.js');

// Helper: monta o resultado de uma unidade a partir de listas curtas.
function unidade(id, d0, concl) {
  const processos = concl.map(function (c, i) { return { id: id + '-P' + i, d0: d0 }; });
  const etapas = concl.map(function (c, i) {
    return { processoId: id + '-P' + i, etapa: c.etapa, ordem: 1, status: 'Concluída', dataRealizacao: c.fim };
  });
  return agregarPrazos(processos, etapas, { unidade: id, ano: 2026 });
}

test('modo geral: agrega etapas de todas as unidades e conta a amostra', () => {
  const uniA = unidade('tijuca', '2026-01-01', [
    { etapa: 'Instrução', fim: '2026-01-11' },   // 10
    { etapa: 'Instrução', fim: '2026-01-13' }    // 12
  ]);
  const uniB = unidade('reitoria-sel', '2026-01-01', [
    { etapa: 'Instrução', fim: '2026-01-06' }     // 5
  ]);
  const rel = montarRelatorio([uniA, uniB], { unidadeSel: '(geral)' });
  assert.equal(rel.etapas.length, 1, 'uma etapa: Instrução');
  assert.equal(rel.kpis.nAmostra, 3, '3 prazos no total');
  assert.deepEqual(rel.etapas[0].estat.n, 3);
});

test('filtro por unidade específica isola os dados daquela unidade', () => {
  const uniA = unidade('tijuca', '2026-01-01', [{ etapa: 'Instrução', fim: '2026-01-11' }]);
  const uniB = unidade('reitoria-sel', '2026-01-01', [{ etapa: 'Instrução', fim: '2026-01-06' }]);
  const rel = montarRelatorio([uniA, uniB], { unidadeSel: 'tijuca' });
  assert.equal(rel.kpis.nAmostra, 1);
  assert.equal(rel.etapas[0].estat.mediana, 10, 'só o prazo da Tijuca');
});

test('ranking: melhor unidade tem a menor mediana; pior a maior', () => {
  // Rápida: medianas menores. Lenta: medianas maiores.
  const rapida = unidade('rapida', '2026-01-01', [
    { etapa: 'Instrução', fim: '2026-01-06' },   // 5
    { etapa: 'Instrução', fim: '2026-01-08' }    // 7
  ]);
  const lenta = unidade('lenta', '2026-01-01', [
    { etapa: 'Instrução', fim: '2026-01-21' },   // 20
    { etapa: 'Instrução', fim: '2026-01-26' }    // 25
  ]);
  const rel = montarRelatorio([rapida, lenta], {
    unidadeSel: '(geral)', nomesUnidade: { rapida: 'Campus Rápido', lenta: 'Campus Lento' }
  });
  assert.equal(rel.ranking.melhorUnidade.unidade, 'rapida');
  assert.equal(rel.ranking.melhorUnidade.nome, 'Campus Rápido', 'usa o nome amigável');
  assert.equal(rel.ranking.piorUnidade.unidade, 'lenta');
  // dentro da etapa, as unidades vêm ordenadas por mediana (melhor primeiro)
  assert.equal(rel.etapas[0].porUnidade[0].unidade, 'rapida');
  assert.equal(rel.etapas[0].porUnidade[1].unidade, 'lenta');
});

test('KPIs contam outliers por etapa (cerca própria de cada etapa)', () => {
  const uni = unidade('u', '2026-01-01', [
    { etapa: 'Instrução', fim: '2026-01-11' },   // 10
    { etapa: 'Instrução', fim: '2026-01-13' },   // 12
    { etapa: 'Instrução', fim: '2026-01-12' },   // 11
    { etapa: 'Instrução', fim: '2026-01-10' },   // 9
    { etapa: 'Instrução', fim: '2026-04-01' }    // 90 (outlier)
  ]);
  const rel = montarRelatorio([uni], { unidadeSel: '(geral)' });
  assert.equal(rel.kpis.nOutliers, 1, 'um outlier na etapa Instrução');
  assert.ok(rel.etapas[0].estat.outliers.indexOf(90) >= 0);
});

test('propaga os descartados somados das unidades', () => {
  const processos = [{ id: 'P1', d0: '2026-01-01' }];
  const etapas = [
    { processoId: 'P1', etapa: 'A', ordem: 1, status: 'Concluída', dataRealizacao: '' } // semData
  ];
  const uni = agregarPrazos(processos, etapas, { unidade: 'u', ano: 2026 });
  const rel = montarRelatorio([uni], { unidadeSel: '(geral)' });
  assert.equal(rel.descartados.semData, 1);
});

test('escopo vazio não quebra (sem unidades / sem dados)', () => {
  const rel = montarRelatorio([], { unidadeSel: '(geral)' });
  assert.equal(rel.etapas.length, 0);
  assert.equal(rel.kpis.nAmostra, 0);
  assert.equal(rel.ranking.melhorUnidade, null);
  assert.equal(rel.ranking.piorUnidade, null);
});

// ── Filtro de etapa: KPIs/ranking dinâmicos (o problema relatado) ──────────
// dias em relação ao D0 fixo (2026-01-01): fim = D0 + dias.
function fimApos(dias) {
  var d = new Date(Date.UTC(2026, 0, 1)); d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
function uniDur(id, mapaEtapaDias) {
  var concl = [];
  Object.keys(mapaEtapaDias).forEach(function (etapa) {
    mapaEtapaDias[etapa].forEach(function (dias) { concl.push({ etapa: etapa, fim: fimApos(dias) }); });
  });
  return unidade(id, '2026-01-01', concl);
}

test('sem filtro de etapa: KPIs agregam todas as etapas (soma dos n por etapa)', () => {
  const A = uniDur('tijuca', { 'Instrução': [5, 7], 'Parecer': [20, 25] });
  const B = uniDur('reitoria', { 'Instrução': [10, 12], 'Parecer': [30] });
  const rel = montarRelatorio([A, B], { unidadeSel: '(geral)' });
  const somaN = rel.etapas.reduce(function (s, e) { return s + e.estat.n; }, 0);
  assert.equal(rel.kpis.nAmostra, somaN, 'nAmostra = soma dos n por etapa');
  assert.equal(rel.kpis.nAmostra, 7);            // 2+2 + 2+1
});

test('com filtro de etapa: KPIs refletem SÓ aquela etapa', () => {
  const A = uniDur('tijuca', { 'Instrução': [5, 7], 'Parecer': [20, 25] });
  const B = uniDur('reitoria', { 'Instrução': [10, 12], 'Parecer': [30] });
  const nomes = { tijuca: 'Tijuca', reitoria: 'Reitoria' };
  const full = montarRelatorio([A, B], { unidadeSel: '(geral)', nomesUnidade: nomes });
  const chaveInstr = full.etapas.find(function (e) { return e.etapa === 'Instrução'; }).etapaChave;

  const rel = montarRelatorio([A, B], { unidadeSel: '(geral)', etapaChave: chaveInstr, nomesUnidade: nomes });
  assert.equal(rel.etapas.length, 1, 'só a etapa filtrada');
  assert.equal(rel.kpis.nAmostra, 4, 'só as 4 conclusões de Instrução (5,7,10,12)');
  assert.equal(rel.kpis.mediana, 8.5, 'mediana de [5,7,10,12]');
  // nAmostra filtrado == n daquela etapa no relatório completo (coerência)
  const nInstrFull = full.etapas.find(function (e) { return e.etapa === 'Instrução'; }).estat.n;
  assert.equal(rel.kpis.nAmostra, nInstrFull);
  // Ranking passa a ser por-etapa: Tijuca (mediana 6) melhor; Reitoria (11) pior.
  assert.equal(rel.ranking.melhorUnidade.unidade, 'tijuca');
  assert.equal(rel.ranking.piorUnidade.unidade, 'reitoria');
});

test('filtro de etapa + unidade específica isola etapa E unidade', () => {
  const A = uniDur('tijuca', { 'Instrução': [5, 7], 'Parecer': [20, 25] });
  const B = uniDur('reitoria', { 'Instrução': [10, 12], 'Parecer': [30] });
  const full = montarRelatorio([A, B], { unidadeSel: '(geral)' });
  const chaveParecer = full.etapas.find(function (e) { return e.etapa === 'Parecer'; }).etapaChave;
  const rel = montarRelatorio([A, B], { unidadeSel: 'reitoria', etapaChave: chaveParecer });
  assert.equal(rel.kpis.nAmostra, 1, 'só o Parecer da Reitoria (30)');
  assert.equal(rel.kpis.mediana, 30);
});

test('outliers do KPI seguem a etapa filtrada', () => {
  // Instrução com um outlier alto; Parecer sem outlier.
  const A = uniDur('u', { 'Instrução': [10, 11, 12, 9, 300], 'Parecer': [5, 6, 7, 8] });
  const full = montarRelatorio([A], { unidadeSel: '(geral)' });
  const chaveInstr = full.etapas.find(function (e) { return e.etapa === 'Instrução'; }).etapaChave;
  const chaveParecer = full.etapas.find(function (e) { return e.etapa === 'Parecer'; }).etapaChave;
  assert.equal(montarRelatorio([A], { etapaChave: chaveInstr }).kpis.nOutliers, 1);
  assert.equal(montarRelatorio([A], { etapaChave: chaveParecer }).kpis.nOutliers, 0);
});
