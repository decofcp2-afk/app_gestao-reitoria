'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes do quartil/percentil (núcleo estatístico da aba "Visão Geral").
//
// Alvo: quartil() de relatorio-prazos.js — MESMA função que o navegador usa
// para desenhar os boxplots. O método é interpolação linear tipo 7, que bate
// com QUARTILE.INC/PERCENTIL.INC do Excel e do Google Sheets — os valores
// abaixo são os que a equipe obtém conferindo na planilha.
//
// Rodar: npm test   (ou: node --test tests/)
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { quartil, media } = require('../relatorio-prazos.js');

function perto(a, b, msg) { assert.ok(Math.abs(a - b) < 1e-9, msg + ' (=' + a + ', esperado ' + b + ')'); }

test('quartil bate com QUARTILE.INC do Excel — [1,2,3,4]', () => {
  const v = [1, 2, 3, 4];
  perto(quartil(v, 0.25), 1.75, 'Q1');
  perto(quartil(v, 0.50), 2.50, 'Q2/mediana');
  perto(quartil(v, 0.75), 3.25, 'Q3');
});

test('quartil bate com QUARTILE.INC do Excel — [1..10]', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  perto(quartil(v, 0.25), 3.25, 'Q1');
  perto(quartil(v, 0.50), 5.50, 'Q2/mediana');
  perto(quartil(v, 0.75), 7.75, 'Q3');
});

test('p=0 devolve o mínimo e p=1 devolve o máximo', () => {
  const v = [9, 1, 5, 3, 7];
  assert.equal(quartil(v, 0), 1);
  assert.equal(quartil(v, 1), 9);
});

test('não depende da ordem de entrada (ordena internamente)', () => {
  assert.equal(quartil([4, 1, 3, 2], 0.5), quartil([1, 2, 3, 4], 0.5));
});

test('amostra de um único valor: todos os percentis são esse valor', () => {
  assert.equal(quartil([42], 0.25), 42);
  assert.equal(quartil([42], 0.50), 42);
  assert.equal(quartil([42], 0.75), 42);
});

test('valores repetidos: quartil é o próprio valor', () => {
  assert.equal(quartil([4, 4, 4, 4], 0.25), 4);
  assert.equal(quartil([4, 4, 4, 4], 0.75), 4);
});

test('amostra vazia devolve null (quartil e média)', () => {
  assert.equal(quartil([], 0.5), null);
  assert.equal(quartil(null, 0.5), null);
  assert.equal(media([]), null);
});

test('descarta entradas não numéricas (NaN, undefined, string)', () => {
  const v = [1, 2, NaN, undefined, '3', 4];  // conta só 1,2,4
  assert.equal(quartil(v, 0.5), 2);
  perto(media(v), (1 + 2 + 4) / 3, 'média ignora não-números');
});
