'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes da CORREÇÃO RETROATIVA de responsável (processo concluído).
//
// Processos antigos foram importados sem o nome de quem respondeu por eles, ou
// com a sigla do setor no lugar da pessoa. A chefia passou a poder corrigir
// isso depois de o processo estar encerrado — e mexer no registro de um
// processo já fechado tem dois riscos que estes testes fixam:
//
//   1. Ressuscitar carga na Capacidade. A atribuição ativa a carga da "fase
//      corrente"; num processo concluído não existe fase corrente, então nada
//      pode ser ativado. Aqui isso é verificado pelo efeito observável:
//      depois da correção, o processo continua fora da Capacidade.
//   2. Reescrever histórico sem rastro. A correção gera uma linha de histórico
//      com quem mudou e de quem para quem — e só em processo concluído, para
//      não poluir o histórico com a troca rotineira de responsável.
//
// A escrita vive em atribuirResponsaveisApp / fs_atribuirResponsaveisApp, que
// não rodam aqui. Este arquivo cobre as regras puras (espelho do GS) e o efeito
// em construir()/construirCapacidade() depois que a correção gravou.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construir, construirCapacidade } = require('../appsel-firestore.js');
const { carga, etapa, processo, servidor } = require('./helpers.js');

// ── Espelho de _motivoCorrecaoResponsavel_ (Code.gs) ───────────────────
function motivoCorrecao(antesInt, depoisInt, antesExt, depoisExt, ehPE) {
  function trecho(rotulo, antes, depois) {
    antes = String(antes || '').trim();
    depois = String(depois || '').trim();
    if (antes === depois) return '';
    return rotulo + ': ' + (antes || '(sem responsável)') + ' → ' + (depois || '(sem responsável)');
  }
  let partes = [trecho('fase interna', antesInt, depoisInt)];
  if (ehPE) partes.push(trecho('fase externa', antesExt, depoisExt));
  partes = partes.filter(t => !!t);
  return 'CORRECAO DE RESPONSAVEL (processo concluído): '
    + (partes.length ? partes.join('; ') : 'sem alteração de nomes');
}

// ── Espelho da detecção "processo concluído" usada na auditoria ────────
function normText(s) {
  return String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function ehContratual(fase, nome) {
  const f = normText(fase), n = normText(nome);
  return f.indexOf('contrat') >= 0 || n.indexOf('assinatura contrato') >= 0
    || n.indexOf('ata (arp)') >= 0 || n.indexOf('gestao contratual') >= 0;
}
function processoConcluido(etapas) {
  let aplicaveis = 0, concluidas = 0;
  (etapas || []).forEach(function (e) {
    const st = normText(e.status);
    if (st.indexOf('nao se aplica') >= 0) return;
    if (ehContratual(e.fase, e.etapa)) return;
    aplicaveis++;
    if (st.indexOf('conclu') >= 0) concluidas++;
  });
  return aplicaveis > 0 && concluidas >= aplicaveis;
}

test('Motivo mostra "de → para" da fase que mudou', () => {
  assert.equal(
    motivoCorrecao('', 'Amanda', '', '', false),
    'CORRECAO DE RESPONSAVEL (processo concluído): fase interna: (sem responsável) → Amanda'
  );
});

test('Motivo cobre as duas fases em pregão', () => {
  assert.equal(
    motivoCorrecao('Amanda', 'Beatriz', 'Samuel', 'Bruno', true),
    'CORRECAO DE RESPONSAVEL (processo concluído): fase interna: Amanda → Beatriz; fase externa: Samuel → Bruno'
  );
});

test('Fase sem alteração fica fora do registro', () => {
  assert.equal(
    motivoCorrecao('Amanda', 'Amanda', 'Samuel', 'Bruno', true),
    'CORRECAO DE RESPONSAVEL (processo concluído): fase externa: Samuel → Bruno'
  );
});

test('Fase externa não aparece quando a modalidade não a separa', () => {
  const m = motivoCorrecao('Amanda', 'Beatriz', 'Amanda', 'Beatriz', false);
  assert.equal(m.indexOf('fase externa'), -1);
});

test('Remoção do responsável fica explícita', () => {
  assert.equal(
    motivoCorrecao('SEL/SEPMA', '', '', '', false),
    'CORRECAO DE RESPONSAVEL (processo concluído): fase interna: SEL/SEPMA → (sem responsável)'
  );
});

test('Confirmação sem mudar nome nenhum ainda registra a ação', () => {
  assert.equal(
    motivoCorrecao('Amanda', 'Amanda', '', '', false),
    'CORRECAO DE RESPONSAVEL (processo concluído): sem alteração de nomes'
  );
});

// ── Quando a auditoria dispara ─────────────────────────────────────────
test('Só processo com TODAS as etapas aplicáveis concluídas conta como concluído', () => {
  assert.equal(processoConcluido([
    etapa({ fase: 'Interna', status: 'Concluída' }),
    etapa({ fase: 'Externa', status: 'Concluída' })
  ]), true);

  assert.equal(processoConcluido([
    etapa({ fase: 'Interna', status: 'Concluída' }),
    etapa({ fase: 'Externa', status: 'Em andamento' })
  ]), false, 'processo em andamento não deve gerar linha de histórico');
});

test('Etapas "Não se aplica" e contratuais não impedem o processo de contar como concluído', () => {
  assert.equal(processoConcluido([
    etapa({ fase: 'Interna', status: 'Concluída' }),
    etapa({ fase: 'Externa', status: 'Não se aplica' }),
    etapa({ fase: 'Contratual', etapa: 'Assinatura contrato', status: 'Não iniciada' })
  ]), true);
});

test('Processo sem etapa aplicável nenhuma não vira registro', () => {
  assert.equal(processoConcluido([]), false);
  assert.equal(processoConcluido([etapa({ fase: 'Externa', status: 'Não se aplica' })]), false);
});

// ── Efeito observável depois que a correção gravou ─────────────────────
test('Corrigir o responsável de processo concluído não o traz de volta à Capacidade', () => {
  const etapas = [
    etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Concluída', agente: 'Amanda' }),
    etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Concluída', agente: 'Samuel' })
  ];
  // Estado após a correção: cargas com o nome novo, e — o ponto do teste —
  // ainda inativas, porque processo concluído não tem fase corrente a ativar.
  const cargas = [
    carga({ processoId: 'P1', servidor: 'amanda', fase: 'Interna', ativo: false, p1: 2 }),
    carga({ processoId: 'P1', servidor: 'samuel', fase: 'Externa', ativo: false, p1: 2 })
  ];
  const cap = construirCapacidade(
    cargas,
    [processo({ id: 'P1', objeto: 'Medição de decibéis' })],
    etapas,
    [servidor({ nome: 'Amanda', matricula: '1' }), servidor({ nome: 'Samuel', matricula: '2' })]
  );
  assert.deepEqual(cap.registrosInt, [], 'processo concluído não entra na lista da Capacidade');
  assert.deepEqual(cap.registrosExt, []);
  cap.resumoInt.forEach(s => assert.equal(s.total, 0, s.servidor + ' não deveria receber carga'));
  cap.resumoExt.forEach(s => assert.equal(s.total, 0, s.servidor + ' não deveria receber carga'));
});

test('Depois da correção, o concluído exibe o responsável de cada fase', () => {
  const r = construir(
    [processo({ id: 'P1', objeto: 'Medição de decibéis', d0: '2026-01-05' })],
    [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Concluída', agente: 'Amanda' }),
      etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Concluída', agente: 'Samuel' })
    ],
    [
      carga({ processoId: 'P1', servidor: 'amanda', fase: 'Interna' }),
      carga({ processoId: 'P1', servidor: 'samuel', fase: 'Externa' })
    ],
    { isChefe: true }
  );
  const p = r.processos[0];
  assert.equal(p.status, 'ok');
  assert.equal(p.servidor, 'Amanda');
  assert.equal(p.servidorExt, 'Samuel');
});
