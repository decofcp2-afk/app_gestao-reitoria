'use strict';
// ════════════════════════════════════════════════════════════════════════
// Spec da PODA de servidores fantasmas (`_fsPodarServidoresOrfaos_`).
//
// A poda em si roda no Apps Script (FirestoreSync.gs) e fala com o Firestore,
// então não é carregável aqui. Este arquivo fixa a REGRA pura de decisão —
// "quais ids apagar" — como espelho do GS. Se mudar a regra lá, atualize aqui.
//
// O que protege:
//  - remove docs de servidores que não estão mais na lista atual (fantasmas);
//  - mantém os que continuam na lista;
//  - TRAVA DE SEGURANÇA: lista atual vazia ⇒ não apaga NADA (lista vazia em
//    geral significa "não carregou", não "zero servidores").
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');

// Espelho puro de _fsPodarServidoresOrfaos_ (FirestoreSync.gs): dado o conjunto
// de ids existentes na coleção e as matrículas atuais, devolve os ids a apagar.
function orfaosParaRemover(idsExistentes, matriculasAtuais) {
  const atuais = {};
  (matriculasAtuais || []).forEach(function (m) {
    const k = String(m || '').trim();
    if (k) atuais[k] = true;
  });
  if (!Object.keys(atuais).length) return []; // trava de segurança
  return (idsExistentes || []).filter(function (id) { return !atuais[id]; });
}

test('Remove apenas os ids que não estão mais na lista atual', () => {
  const existentes = ['beatriz', 'samuel', 'bruno'];
  const atuais = ['beatriz', 'samuel'];
  assert.deepEqual(orfaosParaRemover(existentes, atuais), ['bruno']);
});

test('Não remove ninguém quando a coleção bate com a lista', () => {
  assert.deepEqual(orfaosParaRemover(['beatriz', 'samuel'], ['samuel', 'beatriz']), []);
});

test('TRAVA: lista atual vazia não apaga nada (evita perda de dados)', () => {
  assert.deepEqual(orfaosParaRemover(['beatriz', 'samuel', 'bruno'], []), []);
  assert.deepEqual(orfaosParaRemover(['beatriz'], null), []);
});

test('Matrículas em branco são ignoradas (não viram lista "válida")', () => {
  // Só matrículas vazias ⇒ conjunto atual fica vazio ⇒ trava de segurança.
  assert.deepEqual(orfaosParaRemover(['beatriz'], ['', '  ']), []);
});

test('Remove vários fantasmas de uma vez', () => {
  const existentes = ['a', 'b', 'c', 'd'];
  assert.deepEqual(orfaosParaRemover(existentes, ['b', 'd']).sort(), ['a', 'c']);
});
