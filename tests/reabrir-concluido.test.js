'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes da REABERTURA de processo concluído (botão da chefia no modal).
//
// Caso real: um servidor concluiu sem querer a ÚLTIMA etapa de um processo.
// Como o status do processo é derivado das etapas, ele foi para "✓ Concluídos"
// e ficou travado — sem etapa atual (etapaAtualIdx = -1), o modal não desenha
// nenhum botão de etapa, nem o "↩ Voltar" da regressão comum.
//
// A escrita vive em fs_reabrirProcessoConcluido (apps-script/FirestoreSync.gs),
// que não roda aqui. Estes testes cobrem os dois lados que dá para verificar:
//   1) a REGRA de escolha do alvo (espelho do GS — mantenha em sincronia);
//   2) o EFEITO observável em construir()/construirCapacidade() depois que a
//      reabertura gravou — é o que o usuário vê na tela.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construir, construirCapacidade } = require('../appsel-firestore.js');
const { carga, etapa, processo, servidor, byNome } = require('./helpers.js');

// ────────────────────────────────────────────────────────────────────────
// 1) REGRA DE ESCOLHA DO ALVO — espelho de fs_reabrirProcessoConcluido.
// Etapas aplicáveis = nem contratuais, nem 'na'. O processo só é elegível se
// TODAS elas estiverem concluídas; o alvo é a última.
// ────────────────────────────────────────────────────────────────────────
function normText(s) {
  return String(s == null ? '' : s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function isEtapaContratual(fase, nome) {
  var f = normText(fase), n = normText(nome);
  return f.indexOf('contrat') >= 0 || n.indexOf('assinatura contrato') >= 0 ||
    n.indexOf('ata (arp)') >= 0 || n.indexOf('gestao contratual') >= 0;
}
function ehOk(st) { return normText(st).indexOf('conclu') >= 0; }
function ehNa(st) { return normText(st).indexOf('nao se aplica') >= 0; }

// Etapas derivadas "Não se aplica" pelas condicionais do PROCESSO — ficam
// gravadas como 'Pendente', mas a leitura as oculta. Espelho de _fsCondicionais_.
function naDerivadas(proc) {
  proc = proc || {};
  const ehCD = normText(proc.modalidade).indexOf('direta') >= 0;
  const tipo = normText(proc.tipoCD);
  const ehAdesao = ehCD && tipo.indexOf('adesao') >= 0;
  const temDisputa = ehCD && tipo.indexOf('com disputa') >= 0;
  const na = {};
  if (proc.temIrp !== true || ehAdesao) na[4] = true;
  if (ehAdesao) { na[3] = true; na[6] = true; }
  if (ehCD && !temDisputa) na[8] = true; // fase externa só em CD com disputa
  na[9] = true;                          // contratual (fora do SEL)
  return na;
}

// Devolve o nome da etapa a reabrir, ou lança — mesma decisão do Apps Script.
function alvoReabertura(etapas, proc) {
  const na = naDerivadas(proc);
  const aplicaveis = etapas.filter(function (e) {
    return !isEtapaContratual(e.fase, e.etapa) && !ehNa(e.status) && !na[Number(e.ordem || 0)];
  });
  if (!aplicaveis.length) throw new Error('Processo sem etapas aplicáveis.');
  if (!aplicaveis.every(function (e) { return ehOk(e.status); })) {
    throw new Error('Este processo não está concluído.');
  }
  return aplicaveis[aplicaveis.length - 1].etapa;
}

test('Alvo da reabertura é a última etapa aplicável concluída', () => {
  const etapas = [
    etapa({ etapa: 'DFD', status: 'Concluída', ordem: 1 }),
    etapa({ etapa: 'ETP', status: 'Concluída', ordem: 2 }),
    etapa({ etapa: 'Homologação', fase: 'Externa', status: 'Concluída', ordem: 3 })
  ];
  assert.equal(alvoReabertura(etapas), 'Homologação');
});

test('Etapas "Não se aplica" e contratuais são ignoradas na escolha do alvo', () => {
  // A última etapa gravada é uma contratual (responsabilidade de Contratos) e
  // logo antes há uma 'na' — o alvo tem de ser a última aplicável de verdade.
  const etapas = [
    etapa({ etapa: 'DFD', status: 'Concluída', ordem: 1 }),
    etapa({ etapa: 'Pesquisa de preços', status: 'Concluída', ordem: 2 }),
    etapa({ etapa: 'IRP', status: 'Não se aplica', ordem: 3 }),
    etapa({ etapa: 'Assinatura Contrato', fase: 'Contratual', status: 'Pendente', ordem: 4 })
  ];
  assert.equal(alvoReabertura(etapas), 'Pesquisa de preços');
});

test('CD sem disputa: fase externa derivada "na" não bloqueia a reabertura', () => {
  // Regressão do próprio fix: a fase externa (ordem 8) fica gravada como
  // 'Pendente' e só é ocultada em tempo de leitura. Sem aplicar as condicionais
  // do processo, este caso — que o app mostra como 100% concluído — seria
  // recusado com "Este processo não está concluído".
  const proc = { modalidade: 'Contratação Direta', tipoCD: 'Dispensa sem disputa', temIrp: false };
  const etapas = [
    etapa({ etapa: 'DFD', status: 'Concluída', ordem: 1 }),
    etapa({ etapa: 'ETP', status: 'Concluída', ordem: 2 }),
    etapa({ etapa: 'IRP', status: 'Pendente', ordem: 4 }),          // derivada 'na' (sem IRP)
    etapa({ etapa: 'Empenho', status: 'Concluída', ordem: 7 }),
    etapa({ etapa: 'Fase Externa', fase: 'Externa', status: 'Pendente', ordem: 8 }) // derivada 'na'
  ];
  assert.equal(alvoReabertura(etapas, proc), 'Empenho');
});

test('Processo com etapa em andamento NÃO é elegível para reabertura', () => {
  // Trava de estado do backend: protege contra dois chefes reabrindo ao mesmo
  // tempo e contra chamada fora do fluxo do botão.
  const etapas = [
    etapa({ etapa: 'DFD', status: 'Concluída', ordem: 1 }),
    etapa({ etapa: 'ETP', status: 'Em andamento', ordem: 2 })
  ];
  assert.throws(() => alvoReabertura(etapas), /não está concluído/);
});

// ────────────────────────────────────────────────────────────────────────
// 2) EFEITO NA TELA — o que construir()/construirCapacidade() passam a
// devolver depois que a reabertura gravou a etapa de volta em "Em andamento".
// ────────────────────────────────────────────────────────────────────────
const PROCS = [processo({ id: 'P1', d0: '2026-01-02', objeto: 'Compra de mobiliário' })];

function etapasConcluidas() {
  return [
    etapa({ processoId: 'P1', etapa: 'DFD', status: 'Concluída', ordem: 1, dataRealizacao: '2026-01-10' }),
    etapa({ processoId: 'P1', etapa: 'ETP', status: 'Concluída', ordem: 2, dataRealizacao: '2026-01-20' })
  ];
}

function cardP1(etapas) {
  const r = construir(PROCS, etapas, [], { isChefe: true });
  return r.processos.concat(r.filaPrevisao).find(function (p) { return p.id === 'P1'; });
}

test('Antes da reabertura o processo está concluído e sem etapa atual', () => {
  // Sanidade: é exatamente este estado que trava o processo hoje —
  // etapaAtualIdx = -1 faz o modal não desenhar botão de etapa nenhum.
  const p = cardP1(etapasConcluidas());
  assert.equal(p.status, 'ok');
  assert.equal(p.execucao, 100);
  assert.equal(p.etapaAtualIdx, -1);
});

test('Reabertura tira o processo de "Concluídos" e devolve a etapa atual', () => {
  const etapas = etapasConcluidas();
  // Efeito da gravação: última etapa volta a "Em andamento", sem data.
  etapas[1].status = 'Em andamento';
  etapas[1].dataRealizacao = null;

  const p = cardP1(etapas);
  assert.notEqual(p.status, 'ok', 'sai da seção "✓ Concluídos"');
  assert.equal(p.status, 'andamento');
  assert.ok(p.execucao < 100, 'a barra deixa de marcar 100%');
  assert.equal(p.etapaAtualIdx, 1, 'a etapa reaberta vira a atual (traz os botões de volta)');
  assert.equal(p.etapas[1].nome, 'ETP');
  assert.equal(p.etapas[1].realizacao_iso, null, 'a data de realização foi limpa');
});

test('Reabertura devolve os pontos como carga ATUAL do responsável', () => {
  // Ao concluir a última etapa, _fsTransicaoFase_ inativa as duas cargas. Se a
  // reabertura não reativasse a carga da fase reaberta, o processo voltaria a
  // contar — mas como projeção "futuros", não como carga atual do servidor.
  const servidores = [servidor({ nome: 'Samuel', matricula: 'samuel' })];
  const etapas = etapasConcluidas();

  const concluido = construirCapacidade(
    [carga({ processoId: 'P1', servidor: 'Samuel', fase: 'Interna', ativo: false, p1: 3 })],
    PROCS, etapas, servidores);
  assert.equal(byNome(concluido.resumoInt, 'Samuel').processos, 0, 'concluído não pesa na capacidade');

  etapas[1].status = 'Em andamento';
  etapas[1].dataRealizacao = null;
  const reaberto = construirCapacidade(
    [carga({ processoId: 'P1', servidor: 'Samuel', fase: 'Interna', ativo: true, p1: 3 })],
    PROCS, etapas, servidores);
  const sam = byNome(reaberto.resumoInt, 'Samuel');
  assert.equal(sam.processos, 3, 'volta como carga atual');
  assert.equal(sam.futuros, 0, 'e não como projeção futura');
});
