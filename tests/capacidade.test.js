'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes simulados da Capacidade (App Gestão) — buscam bugs e inconsistências
// na aba "Capacidade", reproduzindo cenários reais com dados de mentira.
//
// Alvo: construirCapacidade() de appsel-firestore.js — a MESMA função que o
// navegador usa para montar os cards e a lista de processos da aba Capacidade.
// Por isso os testes pegam exatamente o que o usuário vê na tela.
//
// Rodar: npm test   (ou: node --test tests/)
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construirCapacidade } = require('../appsel-firestore.js');
const { carga, etapa, processo, servidor, byNome, nomes } = require('./helpers.js');

// ────────────────────────────────────────────────────────────────────────
// BUG DO "SERVIDOR FANTASMA" (caso relatado: Bruno na Capacidade após exclusão)
//
// A aba Capacidade monta um card por servidor da coleção `servidores`. Logo,
// quem decide quem aparece é o conteúdo dessa coleção. Estes testes fixam o
// contrato: removeu da lista → some da Capacidade. O fix correspondente está em
// fs_espelharServidores_ (FirestoreSync.gs), que agora PODA os docs removidos.
// ────────────────────────────────────────────────────────────────────────
test('Capacidade lista exatamente os servidores da coleção (sem fantasmas)', () => {
  const servidores = [
    servidor({ nome: 'Beatriz', matricula: 'beatriz' }),
    servidor({ nome: 'Samuel', matricula: 'samuel' })
  ];
  const r = construirCapacidade([], [], [], servidores);

  assert.deepEqual(nomes(r.resumoInt), ['Beatriz', 'Samuel']);
  assert.deepEqual(nomes(r.resumoExt), ['Beatriz', 'Samuel']);
  assert.equal(byNome(r.resumoInt, 'Bruno'), undefined, 'Bruno não pode aparecer');
});

test('Servidor removido da coleção NÃO reaparece como card (regressão Bruno)', () => {
  // Antes do fix: o doc do Bruno permanecia na coleção `servidores` do Firestore
  // mesmo após a exclusão na aba Config → ressurgia aqui como card fantasma.
  const antesDoFix = [
    servidor({ nome: 'Bruno', matricula: 'bruno' }), // doc órfão deixado no FS
    servidor({ nome: 'Beatriz', matricula: 'beatriz' }),
    servidor({ nome: 'Samuel', matricula: 'samuel' })
  ];
  assert.ok(byNome(construirCapacidade([], [], [], antesDoFix).resumoInt, 'Bruno'),
    'sanidade: enquanto o doc existir na coleção, o fantasma aparece');

  // Depois do fix (fs_espelharServidores_ poda o doc): a coleção não tem mais Bruno.
  const depoisDoFix = antesDoFix.filter(function (s) { return s.matricula !== 'bruno'; });
  assert.equal(byNome(construirCapacidade([], [], [], depoisDoFix).resumoInt, 'Bruno'), undefined);
});

test('Carga órfã de servidor removido não cria card de resumo', () => {
  // Mesmo que sobre uma carga apontando para um servidor já removido, o resumo
  // (cards) só considera a coleção `servidores` — então nenhum card fantasma é
  // criado a partir de cargas soltas.
  const servidores = [servidor({ nome: 'Samuel', matricula: 'samuel' })];
  const cargas = [carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: true, p1: 5 })];
  const procs = [processo({ id: 'P1' })];
  const etapas = [etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento' })];

  const r = construirCapacidade(cargas, procs, etapas, servidores);
  assert.deepEqual(nomes(r.resumoInt), ['Samuel']);
  assert.equal(byNome(r.resumoInt, 'Bruno'), undefined);
});

// ────────────────────────────────────────────────────────────────────────
// TROCA AUTOMÁTICA DE SERVIDOR (fim da fase interna → fase externa)
//
// Quando a fase interna conclui, _fsTransicaoFase_ (FirestoreSync.gs) inativa a
// carga interna e ativa a externa. Estes testes validam o RESULTADO observável
// na Capacidade depois da troca.
// ────────────────────────────────────────────────────────────────────────
test('Fase interna concluída: carga interna some e externa fica ativa', () => {
  const servidores = [
    servidor({ nome: 'Bruno', matricula: 'bruno' }),
    servidor({ nome: 'Beatriz', matricula: 'beatriz' })
  ];
  const procs = [processo({ id: 'P1', objeto: 'Aquisição X' })];
  // Todas as etapas internas concluídas; externa em andamento → fase corrente = ext.
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Concluída', ordem: 1 }),
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Concluída', ordem: 2 }),
    etapa({ processoId: 'P1', fase: 'Externa', status: 'Em andamento', ordem: 3 })
  ];
  // Estado pós-troca: interna inativa, externa ativa (como _fsTransicaoFase_ grava).
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: false, p1: 5 }),
    carga({ processoId: 'P1', servidor: 'Beatriz', fase: 'Externa', ativo: true, p1: 4 })
  ];

  const r = construirCapacidade(cargas, procs, etapas, servidores);

  // A linha interna é escondida quando a fase corrente já é externa.
  assert.equal(r.registrosInt.length, 0, 'linha interna não deve mais aparecer');
  assert.equal(r.registrosExt.length, 1);
  assert.equal(r.registrosExt[0].servidor, 'Beatriz');
  assert.equal(r.registrosExt[0].ativo, 'Sim', 'externo deve estar ativo');

  // Carga sai do servidor interno e entra no externo.
  assert.equal(byNome(r.resumoInt, 'Bruno').processos, 0, 'Bruno não carrega mais o processo');
  assert.equal(byNome(r.resumoExt, 'Beatriz').processos, 4, 'Beatriz assume a carga externa');
});

test('Fase interna em andamento: carga interna ativa, externa apenas projetada', () => {
  const servidores = [
    servidor({ nome: 'Bruno', matricula: 'bruno' }),
    servidor({ nome: 'Beatriz', matricula: 'beatriz' })
  ];
  const procs = [processo({ id: 'P1' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', ordem: 1 }),
    etapa({ processoId: 'P1', fase: 'Externa', status: 'Não iniciada', ordem: 2 })
  ];
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: true, p1: 6 }),
    carga({ processoId: 'P1', servidor: 'Beatriz', fase: 'Externa', ativo: false, p1: 4 })
  ];

  const r = construirCapacidade(cargas, procs, etapas, servidores);

  // Interno ativo conta como carga atual.
  assert.equal(byNome(r.resumoInt, 'Bruno').processos, 6);
  // Externo ainda não iniciado: não conta na carga atual, conta como "futuro".
  const bea = byNome(r.resumoExt, 'Beatriz');
  assert.equal(bea.processos, 0, 'externo não inicia carga antes da troca');
  assert.equal(bea.futuros, 4, 'externo aparece como projeção futura');
  assert.equal(bea.futurosQtd, 1);
});

// ────────────────────────────────────────────────────────────────────────
// ATIVAÇÃO DAS CARGAS (flag `ativo`) → carga atual vs. projeção futura
// ────────────────────────────────────────────────────────────────────────
test('Carga ativa entra na carga atual; inativa entra em "futuros"', () => {
  const servidores = [servidor({ nome: 'Samuel', matricula: 'samuel' })];
  const procs = [processo({ id: 'P1' }), processo({ id: 'P2' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento' }),
    etapa({ processoId: 'P2', fase: 'Interna', status: 'Em andamento' })
  ];
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Samuel', fase: 'Interna', ativo: true, p1: 3 }),
    carga({ processoId: 'P2', servidor: 'Samuel', fase: 'Interna', ativo: false, p1: 2 })
  ];

  const r = construirCapacidade(cargas, procs, etapas, servidores);
  const sam = byNome(r.resumoInt, 'Samuel');
  assert.equal(sam.processos, 3, 'só a carga ativa conta como atual');
  assert.equal(sam.futuros, 2, 'a inativa vira projeção futura');
  assert.equal(sam.total, 3, 'total = processos ativos + outros(0)');
});

test('outrosFixo entra no total da fase interna (e não na externa)', () => {
  const servidores = [servidor({ nome: 'Samuel', matricula: 'samuel', outrosFixo: 2 })];
  const r = construirCapacidade([], [], [], servidores);
  assert.equal(byNome(r.resumoInt, 'Samuel').outros, 2);
  assert.equal(byNome(r.resumoInt, 'Samuel').total, 2);
  assert.equal(byNome(r.resumoExt, 'Samuel').outros, 0, 'outrosFixo é carga só da fase interna');
});

// ────────────────────────────────────────────────────────────────────────
// EXCLUSÕES — processos que NÃO devem pesar na capacidade
// ────────────────────────────────────────────────────────────────────────
test('Processo totalmente concluído sai da capacidade', () => {
  const servidores = [servidor({ nome: 'Bruno', matricula: 'bruno' })];
  const procs = [processo({ id: 'P1' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Concluída', ordem: 1 }),
    etapa({ processoId: 'P1', fase: 'Externa', status: 'Concluída', ordem: 2 })
  ];
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: true, p1: 5 }),
    carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Externa', ativo: true, p1: 4 })
  ];

  const r = construirCapacidade(cargas, procs, etapas, servidores);
  assert.equal(r.registrosInt.length, 0);
  assert.equal(r.registrosExt.length, 0);
  assert.equal(byNome(r.resumoInt, 'Bruno').processos, 0);
  assert.equal(byNome(r.resumoExt, 'Bruno').processos, 0);
});

test('Processo devolvido à fila (retornado) sai da capacidade', () => {
  const servidores = [servidor({ nome: 'Bruno', matricula: 'bruno' })];
  const procs = [processo({ id: 'P1' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', motivoAtraso: 'RETORNO PARA FILA: repriorizado' })
  ];
  const cargas = [carga({ processoId: 'P1', servidor: 'Bruno', fase: 'Interna', ativo: true, p1: 7 })];

  const r = construirCapacidade(cargas, procs, etapas, servidores);
  assert.equal(r.registrosInt.length, 0, 'processo retornado não conta');
  assert.equal(byNome(r.resumoInt, 'Bruno').processos, 0);
});

// ────────────────────────────────────────────────────────────────────────
// PERCENTUAL / STATUS — coerência do semáforo de capacidade
// ────────────────────────────────────────────────────────────────────────
test('Status do servidor acompanha o percentual de ocupação (teto interno = 10)', () => {
  const servidores = [
    servidor({ nome: 'Disp', matricula: 'disp' }),
    servidor({ nome: 'Aten', matricula: 'aten' }),
    servidor({ nome: 'Crit', matricula: 'crit' })
  ];
  const procs = [processo({ id: 'P1' }), processo({ id: 'P2' }), processo({ id: 'P3' })];
  const etapas = [
    etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento' }),
    etapa({ processoId: 'P2', fase: 'Interna', status: 'Em andamento' }),
    etapa({ processoId: 'P3', fase: 'Interna', status: 'Em andamento' })
  ];
  const cargas = [
    carga({ processoId: 'P1', servidor: 'Disp', fase: 'Interna', ativo: true, p1: 3 }),  // 30%
    carga({ processoId: 'P2', servidor: 'Aten', fase: 'Interna', ativo: true, p1: 7 }),  // 70%
    carga({ processoId: 'P3', servidor: 'Crit', fase: 'Interna', ativo: true, p1: 10 })  // 100%
  ];

  const r = construirCapacidade(cargas, procs, etapas, servidores);
  assert.equal(byNome(r.resumoInt, 'Disp').status, 'Disponível');
  assert.equal(byNome(r.resumoInt, 'Aten').status, 'Atenção');
  assert.equal(byNome(r.resumoInt, 'Crit').status, 'Crítico');
  assert.equal(byNome(r.resumoInt, 'Disp').pct, 30);
});
