'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes da pipeline de prazo REAL (início real → conclusão real) — o coração
// do pedido do Felipe. Alvo: agregarPrazos() e mesclarGeral() de
// relatorio-prazos.js.
//
// Regras exercitadas (PLANO_RELATORIO_PRAZOS_ADMIN.md):
//   • início real = conclusão real da etapa anterior; na 1ª etapa = D0.
//   • conclusão real = DataRealizacao (só etapa concluída).
//   • D1: agrupa/filtra pelo ANO DA CONCLUSÃO.
//   • D2: dias corridos.  D3: sem descontar fila/paralisação.
//   • fora: etapas 'na'/contratuais/não concluídas; processo sem D0;
//     conclusão sem data (semData) e fim < início (inconsistentes).
//
// Rodar: npm test
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { agregarPrazos, mesclarGeral } = require('../relatorio-prazos.js');

function grupo(res, etapa, ano) {
  return res.grupos.find(function (g) { return g.etapa === etapa && (ano == null || g.ano === ano); });
}

test('1ª etapa mede a partir do D0; a 2ª a partir da conclusão da 1ª', () => {
  const processos = [{ id: 'P1', d0: '2026-01-01' }];
  const etapas = [
    { processoId: 'P1', etapa: 'Elaboração TR', ordem: 1, status: 'Concluída', dataRealizacao: '2026-01-11' },
    { processoId: 'P1', etapa: 'Pesquisa de Preço', ordem: 2, status: 'Concluída', dataRealizacao: '2026-01-16' }
  ];
  const r = agregarPrazos(processos, etapas, { unidade: 'reitoria-sel' });
  assert.deepEqual(grupo(r, 'Elaboração TR').dias, [10], 'D0→11/01 = 10 dias');
  assert.deepEqual(grupo(r, 'Pesquisa de Preço').dias, [5], '11/01→16/01 = 5 dias');
});

test('etapa não concluída não entra e não avança o cursor', () => {
  // Etapa 2 pendente; etapa 3 concluída deve medir a partir da conclusão da 1.
  const processos = [{ id: 'P1', d0: '2026-03-01' }];
  const etapas = [
    { processoId: 'P1', etapa: 'A', ordem: 1, status: 'Concluída', dataRealizacao: '2026-03-06' },
    { processoId: 'P1', etapa: 'B', ordem: 2, status: 'Em andamento', dataRealizacao: '' },
    { processoId: 'P1', etapa: 'C', ordem: 3, status: 'Concluída', dataRealizacao: '2026-03-16' }
  ];
  const r = agregarPrazos(processos, etapas, {});
  assert.equal(grupo(r, 'B'), undefined, 'B pendente não vira grupo');
  assert.deepEqual(grupo(r, 'C').dias, [10], 'C mede da conclusão da A (06/03→16/03)');
});

test('etapas "não se aplica" e contratuais ficam de fora', () => {
  const processos = [{ id: 'P1', d0: '2026-01-01' }];
  const etapas = [
    { processoId: 'P1', etapa: 'IRP', ordem: 1, status: 'Não se aplica', dataRealizacao: '' },
    { processoId: 'P1', etapa: 'Instrução', ordem: 2, status: 'Concluída', dataRealizacao: '2026-01-11' },
    { processoId: 'P1', etapa: 'Assinatura contrato', fase: 'Contratual', ordem: 3, status: 'Concluída', dataRealizacao: '2026-02-01' }
  ];
  const r = agregarPrazos(processos, etapas, {});
  assert.equal(grupo(r, 'IRP'), undefined, 'na fora');
  assert.equal(grupo(r, 'Assinatura contrato'), undefined, 'contratual fora');
  assert.deepEqual(grupo(r, 'Instrução').dias, [10], 'Instrução mede do D0 (na anterior não avança)');
});

test('processo sem D0 é ignorado (ainda na fila)', () => {
  const processos = [{ id: 'P1', d0: null }];
  const etapas = [{ processoId: 'P1', etapa: 'A', ordem: 1, status: 'Concluída', dataRealizacao: '2026-01-10' }];
  const r = agregarPrazos(processos, etapas, {});
  assert.equal(r.grupos.length, 0);
});

test('conclusão sem data válida conta como descartado (semData)', () => {
  const processos = [{ id: 'P1', d0: '2026-01-01' }];
  const etapas = [{ processoId: 'P1', etapa: 'A', ordem: 1, status: 'Concluída', dataRealizacao: '' }];
  const r = agregarPrazos(processos, etapas, { unidade: 'reitoria-sel' });
  assert.equal(r.descartados.semData, 1);
  assert.equal(r.grupos.length, 0);
  // Drill-down: a lista identifica processo, etapa e unidade.
  assert.deepEqual(r.descartados.semDataItens,
    [{ processoId: 'P1', etapa: 'A', unidade: 'reitoria-sel' }]);
});

test('fim antes do início é inconsistente (descartado), mas o cursor avança', () => {
  const processos = [{ id: 'P1', d0: '2026-05-10' }];
  const etapas = [
    { processoId: 'P1', etapa: 'A', ordem: 1, status: 'Concluída', dataRealizacao: '2026-05-05' }, // antes do D0
    { processoId: 'P1', etapa: 'B', ordem: 2, status: 'Concluída', dataRealizacao: '2026-05-15' }
  ];
  const r = agregarPrazos(processos, etapas, {});
  assert.equal(r.descartados.inconsistentes, 1, 'A é inconsistente');
  assert.equal(grupo(r, 'A'), undefined);
  assert.deepEqual(grupo(r, 'B').dias, [10], 'B mede da conclusão real de A (05/05→15/05)');
  // Drill-down: o item traz as datas conflitantes para conferência.
  const it = r.descartados.inconsistentesItens[0];
  assert.equal(it.processoId, 'P1');
  assert.equal(it.etapa, 'A');
  assert.equal(it.ini, '2026-05-10');
  assert.equal(it.fim, '2026-05-05');
});

test('D1: agrupa pelo ANO da conclusão e o filtro de ano respeita isso', () => {
  const processos = [{ id: 'P1', d0: '2025-12-20' }, { id: 'P2', d0: '2026-06-01' }];
  const etapas = [
    { processoId: 'P1', etapa: 'Instrução', ordem: 1, status: 'Concluída', dataRealizacao: '2025-12-30' }, // 10d, ano 2025
    { processoId: 'P2', etapa: 'Instrução', ordem: 1, status: 'Concluída', dataRealizacao: '2026-06-21' }  // 20d, ano 2026
  ];
  const todos = agregarPrazos(processos, etapas, {});
  assert.deepEqual(todos.anosDisponiveis, [2025, 2026]);
  assert.deepEqual(grupo(todos, 'Instrução', 2025).dias, [10]);
  assert.deepEqual(grupo(todos, 'Instrução', 2026).dias, [20]);

  const so2026 = agregarPrazos(processos, etapas, { ano: 2026 });
  assert.deepEqual(so2026.anosDisponiveis, [2025, 2026], 'anos disponíveis não dependem do filtro');
  assert.equal(so2026.grupos.length, 1, 'só o grupo de 2026');
  assert.deepEqual(grupo(so2026, 'Instrução').dias, [20]);
});

test('nomes de etapa com acento/caixa diferentes caem no mesmo grupo', () => {
  const processos = [{ id: 'P1', d0: '2026-01-01' }, { id: 'P2', d0: '2026-01-01' }];
  const etapas = [
    { processoId: 'P1', etapa: 'Parecer Jurídico', ordem: 1, status: 'Concluída', dataRealizacao: '2026-01-06' },
    { processoId: 'P2', etapa: 'parecer juridico', ordem: 1, status: 'Concluída', dataRealizacao: '2026-01-11' }
  ];
  const r = agregarPrazos(processos, etapas, {});
  const gs = r.grupos.filter(function (g) { return g.ano === 2026; });
  assert.equal(gs.length, 1, 'um único grupo apesar de acento/caixa');
  assert.deepEqual(gs[0].dias.sort(function (a, b) { return a - b; }), [5, 10]);
});

test('mesclarGeral soma as unidades por etapa×ano e marca a origem nos itens', () => {
  const uniA = agregarPrazos(
    [{ id: 'A1', d0: '2026-01-01' }],
    [{ processoId: 'A1', etapa: 'Instrução', ordem: 1, status: 'Concluída', dataRealizacao: '2026-01-11' }],
    { unidade: 'campus-tijuca' }
  );
  const uniB = agregarPrazos(
    [{ id: 'B1', d0: '2026-02-01' }],
    [{ processoId: 'B1', etapa: 'Instrução', ordem: 1, status: 'Concluída', dataRealizacao: '2026-02-06' }],
    { unidade: 'reitoria-sel' }
  );
  const geral = mesclarGeral([uniA, uniB]);
  const g = grupo(geral, 'Instrução', 2026);
  assert.equal(g.unidade, '(geral)');
  assert.deepEqual(g.dias.sort(function (a, b) { return a - b; }), [5, 10]);
  const origens = g.itens.map(function (it) { return it.unidade; }).sort();
  assert.deepEqual(origens, ['campus-tijuca', 'reitoria-sel'], 'itens preservam a unidade de origem');
});

test('aceita Timestamp do Firestore ({seconds}) além de ISO', () => {
  const d0 = { seconds: Math.floor(Date.UTC(2026, 0, 1) / 1000) };      // 2026-01-01
  const fim = { seconds: Math.floor(Date.UTC(2026, 0, 11) / 1000) };    // 2026-01-11
  const r = agregarPrazos(
    [{ id: 'P1', d0: d0 }],
    [{ processoId: 'P1', etapa: 'A', ordem: 1, status: 'Concluída', dataRealizacao: fim }],
    {}
  );
  assert.deepEqual(grupo(r, 'A').dias, [10]);
});
