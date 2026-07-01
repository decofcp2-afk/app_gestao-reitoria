'use strict';
// ════════════════════════════════════════════════════════════════════════
// Regressão de `fs_excluirUnidade` (apps-script/FirestoreSync.gs).
//
// fs_excluirUnidade fala com o Firestore (GET/DELETE via REST) e não é
// carregável aqui. Este arquivo espelha a regra pura de PAGINAÇÃO: antes do
// fix, cada coleção era lida com uma única página (`pageSize=300`) e o
// `nextPageToken` era ignorado. Coleções que crescem sem limite ao longo da
// vida de uma unidade (`etapas`, `historico`) facilmente passam de 300 docs —
// a exclusão reportava sucesso, mas deixava sobras órfãs para trás.
//
// Guarda também as trava de segurança que já existiam: só admin, e a unidade
// base "reitoria-sel" nunca pode ser excluída.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');

// Espelho do loop de paginação corrigido em fs_excluirUnidade: busca todas as
// páginas de uma coleção (segue nextPageToken até esgotar) e devolve os ids.
function listarTodosOsDocs(fetchPage, colecao) {
  var ids = [];
  var pageToken = '';
  do {
    var data = fetchPage(colecao, pageToken) || {};
    (data.documents || []).forEach(function (d) { ids.push(d.id); });
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return ids;
}

test('Paginação: coleção com mais de 300 docs (etapas de uma unidade antiga) é toda percorrida', () => {
  // Simula 3 páginas de uma coleção `etapas` grande: 300 + 300 + 47 docs.
  const paginas = {
    '': { documents: Array.from({ length: 300 }, (_, i) => ({ id: 'e' + i })), nextPageToken: 'p2' },
    p2: { documents: Array.from({ length: 300 }, (_, i) => ({ id: 'e' + (300 + i) })), nextPageToken: 'p3' },
    p3: { documents: Array.from({ length: 47 }, (_, i) => ({ id: 'e' + (600 + i) })) } // sem nextPageToken: última página
  };
  const fetchPage = (colecao, token) => paginas[token || ''];

  const ids = listarTodosOsDocs(fetchPage, 'etapas');
  assert.equal(ids.length, 647, 'regressão: parava nos primeiros 300 e ignorava o resto');
  assert.equal(new Set(ids).size, 647, 'sem duplicatas ao longo das páginas');
});

test('Paginação: coleção pequena (1 página, sem nextPageToken) não entra em loop', () => {
  const paginas = { '': { documents: [{ id: 'c1' }, { id: 'c2' }] } };
  const fetchPage = (colecao, token) => paginas[token || ''];

  const ids = listarTodosOsDocs(fetchPage, 'calendario');
  assert.deepEqual(ids, ['c1', 'c2']);
});

test('Paginação: coleção vazia devolve lista vazia (não deleta nada, não quebra)', () => {
  const fetchPage = () => ({});
  assert.deepEqual(listarTodosOsDocs(fetchPage, 'cargas'), []);
});

// Espelho das travas de fs_excluirUnidade que não dependem do Firestore.
function podeExcluirUnidade(uid, sess) {
  if (!sess || !sess.isAdmin) return { ok: false, erro: 'Ação restrita ao administrador geral.' };
  if (!uid) return { ok: false, erro: 'Unidade não informada.' };
  if (uid === 'reitoria-sel') return { ok: false, erro: 'A Reitoria não pode ser excluída.' };
  return { ok: true };
}

test('Trava: usuário não-admin não pode excluir nenhuma unidade', () => {
  const r = podeExcluirUnidade('tijuca-i', { isAdmin: false });
  assert.equal(r.ok, false);
  assert.match(r.erro, /administrador/i);
});

test('Trava: a unidade base "reitoria-sel" nunca pode ser excluída, mesmo por admin', () => {
  const r = podeExcluirUnidade('reitoria-sel', { isAdmin: true });
  assert.equal(r.ok, false);
  assert.match(r.erro, /reitoria/i);
});

test('Admin pode excluir qualquer outra unidade válida', () => {
  const r = podeExcluirUnidade('tijuca-i', { isAdmin: true });
  assert.equal(r.ok, true);
});
