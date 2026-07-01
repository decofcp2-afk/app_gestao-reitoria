'use strict';
// ════════════════════════════════════════════════════════════════════════
// Regressão: nomes de servidor COMPOSTOS apareciam errados na tela.
//
// `construir()` (cards de processo) e `construirCapacidade()` (aba Capacidade)
// recapitalizavam o nome do servidor a partir de `cargas.servidor` usando
// "1ª letra maiúscula, resto minúsculo" — correto só para nomes de UMA palavra.
// Nomes brasileiros compostos são a norma ("Maria Eduarda", "Ana Paula Souza",
// "João Pedro"), não a exceção: "Maria Eduarda" virava "Maria eduarda" em
// TODA carga digitada com mais de uma palavra — inclusive quando o nome já
// estava gravado com a capitalização certa no Firestore.
//
// O fix espelha `_fsNomeServ_` (apps-script/FirestoreSync.gs): Title Case por
// PALAVRA (separador espaço/hífen/apóstrofo), a mesma regra já usada ao
// GRAVAR o nome do servidor. Os testes anteriores (processo-troca.test.js,
// capacidade.test.js) usavam só nomes de uma palavra ("Bruno", "Beatriz") e
// por isso nunca pegaram esse bug.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construir, construirCapacidade } = require('../appsel-firestore.js');
const { carga, etapa, processo, servidor } = require('./helpers.js');

test('Cards de processo: nome composto do servidor sai em Title Case, não só a 1ª letra', () => {
  const procs = [processo({ id: 'P1', d0: '2026-01-02' })];
  const etapas = [etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', ordem: 1 })];
  const cargas = [carga({ processoId: 'P1', servidor: 'Maria Eduarda', fase: 'Interna', ativo: true })];

  const r = construir(procs, etapas, cargas, { isChefe: true });
  const p = r.processos.find(function (x) { return x.id === 'P1'; });
  assert.equal(p.servidor, 'Maria Eduarda', 'regressão: virava "Maria eduarda"');
});

test('Cards de processo: nome digitado TUDO EM MAIÚSCULAS (comum no dia a dia) também sai certo', () => {
  const procs = [processo({ id: 'P1', d0: '2026-01-02' })];
  const etapas = [etapa({ processoId: 'P1', fase: 'Externa', status: 'Em andamento', ordem: 1 })];
  const cargas = [carga({ processoId: 'P1', servidor: 'ANA PAULA SOUZA', fase: 'Externa', ativo: true })];

  const r = construir(procs, etapas, cargas, { isChefe: true });
  const p = r.processos.find(function (x) { return x.id === 'P1'; });
  assert.equal(p.servidorExt, 'Ana Paula Souza');
});

test('Cards de processo: acento e hífen não quebram a capitalização (João Pedro, Jean-Pierre)', () => {
  const procs = [
    processo({ id: 'P1', d0: '2026-01-02' }),
    processo({ id: 'P2', d0: '2026-01-02' })
  ];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', ordem: 1 }),
    etapa({ processoId: 'P2', fase: 'Interna', status: 'Em andamento', ordem: 1 })
  ];
  const cargas = [
    carga({ processoId: 'P1', servidor: 'joão pedro', fase: 'Interna', ativo: true }),
    carga({ processoId: 'P2', servidor: 'jean-pierre', fase: 'Interna', ativo: true })
  ];

  const r = construir(procs, etapas, cargas, { isChefe: true });
  assert.equal(r.processos.find(function (x) { return x.id === 'P1'; }).servidor, 'João Pedro');
  assert.equal(r.processos.find(function (x) { return x.id === 'P2'; }).servidor, 'Jean-Pierre');
});

test('Capacidade: registros também mostram o nome composto certo (não só a 1ª letra)', () => {
  const servidores = [servidor({ nome: 'Maria Eduarda', matricula: 'mariaeduarda' })];
  const cargas = [carga({ processoId: 'P1', servidor: 'maria eduarda', fase: 'Interna', ativo: true, p1: 2 })];
  const processos = [processo({ id: 'P1' })];
  const etapas = [etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento' })];

  const r = construirCapacidade(cargas, processos, etapas, servidores);
  const rec = r.registrosInt.find(function (x) { return x.pid === 'P1'; });
  assert.equal(rec.servidor, 'Maria Eduarda', 'regressão: virava "Maria eduarda"');
});
