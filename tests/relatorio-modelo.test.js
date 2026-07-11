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
