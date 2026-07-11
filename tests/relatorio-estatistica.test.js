'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes de estatEtapa() — a estatística completa de uma amostra de prazos:
// quartis, DIQ, cerca de outliers (LS = Q3+1,5·DIQ / LI = Q1−1,5·DIQ),
// bigodes (extremos DENTRO da cerca) e classificação de outliers.
//
// Alvo: estatEtapa() de relatorio-prazos.js.
// Rodar: npm test
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { estatEtapa } = require('../relatorio-prazos.js');

function perto(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-9, msg + ' (=' + a + ', esperado ' + b + ')'); }

test('caso com outlier alto — [1..9, 100]', () => {
  const e = estatEtapa([1, 2, 3, 4, 5, 6, 7, 8, 9, 100]);
  assert.equal(e.n, 10);
  assert.equal(e.min, 1);
  assert.equal(e.max, 100);
  perto(e.q1, 3.25, 'Q1');
  perto(e.mediana, 5.5, 'mediana');
  perto(e.q3, 7.75, 'Q3');
  perto(e.diq, 4.5, 'DIQ');
  perto(e.ls, 14.5, 'LS = Q3 + 1,5·DIQ');
  perto(e.li, -3.5, 'LI = Q1 − 1,5·DIQ');
  assert.deepEqual(e.outliers, [100], 'só o 100 estoura a cerca');
  assert.equal(e.whiskerHi, 9, 'bigode superior é o maior valor dentro da cerca');
  assert.equal(e.whiskerLo, 1, 'bigode inferior é o menor valor dentro da cerca');
  assert.equal(e.amostraPequena, false);
});

test('sem outliers — [5,6,7,8]', () => {
  const e = estatEtapa([5, 6, 7, 8]);
  assert.deepEqual(e.outliers, []);
  assert.equal(e.whiskerLo, 5);
  assert.equal(e.whiskerHi, 8);
  perto(e.ls, 9.5, 'LS');
  perto(e.li, 3.5, 'LI');
});

test('outlier baixo (valor negativo estoura o LI)', () => {
  const e = estatEtapa([-50, 5, 6, 7, 8, 9]);
  assert.ok(e.outliers.indexOf(-50) >= 0, '-50 deve ser outlier inferior');
  assert.ok(e.whiskerLo > -50, 'o bigode inferior não é o outlier');
});

test('média e mediana convivem (Felipe quer "prazo médio" e o boxplot)', () => {
  const e = estatEtapa([2, 4, 4, 4, 5, 5, 7, 9]);
  perto(e.media, (2 + 4 + 4 + 4 + 5 + 5 + 7 + 9) / 8, 'média aritmética');
  assert.ok(e.mediana != null, 'mediana presente');
});

test('amostra pequena (n<4) é sinalizada', () => {
  assert.equal(estatEtapa([10, 20, 30]).amostraPequena, true, 'n=3 é pequena');
  assert.equal(estatEtapa([10, 20, 30, 40]).amostraPequena, false, 'n=4 já não é');
});

test('amostra vazia devolve n=0 e campos nulos, sem quebrar', () => {
  const e = estatEtapa([]);
  assert.equal(e.n, 0);
  assert.equal(e.mediana, null);
  assert.equal(e.ls, null);
  assert.deepEqual(e.outliers, []);
  assert.equal(e.amostraPequena, true);
});

test('formato de saída é estável (chaves esperadas pela UI)', () => {
  const e = estatEtapa([1, 2, 3, 4, 5]);
  ['n', 'min', 'max', 'q1', 'mediana', 'q3', 'diq', 'ls', 'li', 'media',
    'whiskerLo', 'whiskerHi', 'outliers', 'amostraPequena'].forEach(function (k) {
    assert.ok(Object.prototype.hasOwnProperty.call(e, k), 'falta a chave ' + k);
  });
});
