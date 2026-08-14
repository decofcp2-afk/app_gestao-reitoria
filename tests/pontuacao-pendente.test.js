'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes da varredura de PONTUAÇÃO PENDENTE (pontuacoesPendentes).
//
// Caso real: a pontuação de carga é lançada num segundo passo, depois do
// cadastro, e é o passo que mais escapa. Enquanto ela não sai, o processo não
// entra no cálculo da Capacidade — o setor aparece com folga que não tem e a
// distribuição de novos processos é feita sobre um número subestimado.
//
// A varredura alimenta dois consumidores: a aba "Pontuação" do sino e a
// cobrança diária por e-mail (_pontuacoesPendentes_, no Code.gs — espelho).
// O risco desta regra não é deixar de cobrar: é cobrar o que NUNCA vai ser
// pontuado, porque aí a cobrança diária vira ruído permanente. Por isso a
// maioria dos testes abaixo fixa as exclusões.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { pontuacoesPendentes } = require('../appsel-firestore.js');
const { carga, etapa, processo } = require('./helpers.js');

// Cenário-base: um processo em andamento, com as duas fases aplicáveis.
function cenario(over) {
  over = over || {};
  return {
    cargas: over.cargas || [
      carga({ processoId: 'P1', servidor: 'amanda', fase: 'Interna', ativo: true }),
      carga({ processoId: 'P1', servidor: 'bruno', fase: 'Externa' })
    ],
    processos: over.processos || [processo({ id: 'P1', objeto: 'Aquisição de livros', d0: '2026-03-02' })],
    etapas: over.etapas || [
      etapa({ processoId: 'P1', ordem: 1, etapa: 'DFD', fase: 'Interna', status: 'Concluída' }),
      etapa({ processoId: 'P1', ordem: 2, etapa: 'ETP', fase: 'Interna', status: 'Em andamento' }),
      etapa({ processoId: 'P1', ordem: 8, etapa: 'Fase externa — Pregão Eletrônico', fase: 'Externa', status: 'Não iniciada' })
    ]
  };
}

function rodar(c) { return pontuacoesPendentes(c.cargas, c.processos, c.etapas); }

test('Aponta as duas fases quando nenhuma foi pontuada', () => {
  const pend = rodar(cenario());
  assert.equal(pend.length, 2);
  assert.deepEqual(pend.map(p => p.fase).sort(), ['ext', 'int']);
  assert.equal(pend[0].objeto, 'Aquisição de livros');
});

test('Some da lista assim que a carga é pontuada', () => {
  const c = cenario();
  c.cargas[0].p1 = 1; c.cargas[0].p2 = 0.5;   // fase interna pontuada
  const pend = rodar(c);
  assert.equal(pend.length, 1);
  assert.equal(pend[0].fase, 'ext');
});

test('Pontuação fracionada em qualquer critério já conta como pontuada', () => {
  const c = cenario();
  c.cargas[1].p3 = 0.5;
  assert.deepEqual(rodar(c).map(p => p.fase), ['int']);
});

test('Processo recém-cadastrado (sem D0) é cobrado e vem primeiro', () => {
  const c = cenario({
    cargas: [
      carga({ processoId: 'P1', servidor: 'amanda', fase: 'Interna', ativo: true }),
      carga({ processoId: 'P2', servidor: 'beatriz', fase: 'Interna' })
    ],
    processos: [
      processo({ id: 'P1', objeto: 'Em andamento', d0: '2026-03-02' }),
      processo({ id: 'P2', objeto: 'Recém-cadastrado' })   // sem D0: ainda na fila
    ],
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Em andamento' }),
      etapa({ processoId: 'P2', ordem: 1, fase: 'Interna', status: 'Não iniciada' })
    ]
  });
  const pend = rodar(c);
  assert.equal(pend.length, 2);
  assert.equal(pend[0].pid, 'P2');            // não iniciado primeiro
  assert.equal(pend[0].iniciado, false);
  assert.equal(pend[1].iniciado, true);
});

// ── EXCLUSÕES: o que nunca deve ser cobrado ────────────────────────────
test('Processo concluído não é cobrado', () => {
  const c = cenario({
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Concluída' }),
      etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Concluída' })
    ]
  });
  assert.deepEqual(rodar(c), []);
});

test('Processo devolvido para a fila não é cobrado enquanto estiver retornado', () => {
  const c = cenario();
  c.etapas[1].motivoAtraso = 'RETORNO PARA FILA: Suspensão por decisão da Administração — aguardando parecer';
  assert.deepEqual(rodar(c), []);
});

test('Fase inteira "Não se aplica" não é cobrada (CD sem disputa tem carga externa órfã)', () => {
  // O cadastro cria SEMPRE as duas cargas; numa contratação direta sem disputa
  // a fase externa nasce "Não se aplica" e nunca seria pontuada. Sem esta
  // exclusão, a cobrança diária nunca cessaria para esses processos.
  const c = cenario({
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Em andamento' }),
      etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Não se aplica' })
    ]
  });
  assert.deepEqual(rodar(c).map(p => p.fase), ['int']);
});

test('Etapa contratual não torna a fase cobrável (fora do escopo do SEL)', () => {
  const c = cenario({
    cargas: [carga({ processoId: 'P1', servidor: 'bruno', fase: 'Externa' })],
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Em andamento' }),
      etapa({ processoId: 'P1', ordem: 9, etapa: 'Assinatura contrato', fase: 'Contratual', status: 'Não iniciada' })
    ]
  });
  assert.deepEqual(rodar(c), []);
});

test('Carga órfã (processo excluído) não é cobrada', () => {
  const c = cenario({
    cargas: [carga({ processoId: 'P9', servidor: 'amanda', fase: 'Interna' })]
  });
  assert.deepEqual(rodar(c), []);
});

test('Coleções vazias não geram cobrança', () => {
  assert.deepEqual(pontuacoesPendentes([], [], []), []);
  assert.deepEqual(pontuacoesPendentes(null, null, null), []);
});

test('Nome do servidor sai normalizado, como na Capacidade', () => {
  const pend = rodar(cenario());
  assert.deepEqual(pend.map(p => p.servidor).sort(), ['Amanda', 'Bruno']);
  assert.deepEqual(pend.map(p => p.faseLabel).sort(), ['Fase Externa', 'Fase Interna']);
});
