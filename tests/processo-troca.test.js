'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes da troca de servidor responsável NO PROCESSO (aba Etapas/Fila).
//
// Alvo: construir() de appsel-firestore.js — monta os cards de processo. O
// responsável por fase (servidor interno / servidor externo) é derivado das
// cargas, dando preferência à carga ATIVA. Estes testes garantem que, ao virar
// a fase, o card aponta o responsável certo.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construir } = require('../appsel-firestore.js');
const { carga, etapa, processo } = require('./helpers.js');

function montar(cargas, etapas, procs) {
  const r = construir(procs, etapas, cargas, { isChefe: true });
  return r.processos.concat(r.filaPrevisao);
}

test('Responsável interno e externo vêm das cargas (ativa tem preferência)', () => {
  const procs = [processo({ id: 'P1', d0: '2026-01-02', objeto: 'Compra Y' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', ordem: 1 }),
    etapa({ processoId: 'P1', fase: 'Externa', status: 'Não iniciada', ordem: 2 })
  ];
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: true }),
    carga({ processoId: 'P1', servidor: 'Beatriz', fase: 'Externa', ativo: false })
  ];

  const p = montar(cargas, etapas, procs).find(function (x) { return x.id === 'P1'; });
  assert.equal(p.servidor, 'Bruno', 'responsável interno');
  assert.equal(p.servidorExt, 'Beatriz', 'responsável externo');
});

test('Após a troca de fase, externo ativo é o responsável corrente do card', () => {
  const procs = [processo({ id: 'P1', d0: '2026-01-02' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Concluída', ordem: 1 }),
    etapa({ processoId: 'P1', fase: 'Externa', status: 'Em andamento', ordem: 2 })
  ];
  // Estado pós-troca: carga interna inativa, externa ativa.
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: false }),
    carga({ processoId: 'P1', servidor: 'Beatriz', fase: 'Externa', ativo: true })
  ];

  const p = montar(cargas, etapas, procs).find(function (x) { return x.id === 'P1'; });
  assert.equal(p.servidorExt, 'Beatriz');
  // A etapa corrente é externa → a tela usa servidorExt como responsável atual.
  const etapaAtual = p.etapas[p.etapaAtualIdx];
  assert.ok(etapaAtual && etapaAtual.fase.toLowerCase().indexOf('ext') >= 0,
    'a etapa atual deve ser a externa em andamento');
});

test('Sem carga, o responsável cai no agente da etapa (fallback)', () => {
  const procs = [processo({ id: 'P1', d0: '2026-01-02' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', agente: 'Samuel', ordem: 1 })
  ];
  const p = montar([], etapas, procs).find(function (x) { return x.id === 'P1'; });
  assert.equal(p.servidor, 'Samuel');
});
