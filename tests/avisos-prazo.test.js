'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const code = fs.readFileSync(require.resolve('../apps-script/Code.gs'), 'utf8');
const firestore = fs.readFileSync(require.resolve('../apps-script/FirestoreSync.gs'), 'utf8');
const hoje = new Date(2026, 10, 24, 10, 38);

class DataDoDisparo extends Date {
  constructor(...args) {
    super(...(args.length ? args : [hoje]));
  }
}

function simular({ tipoCD, etapas, cargas = [], jaEnviados = {} }) {
  const registros = {
    processos: [{ id: 'P1', objeto: 'Sistema de biblioteca', d0: '2026-11-24', modalidade: 'Contratação Direta', tipoCD }],
    etapas,
    cargas
  };
  const enviados = [];
  const backend = vm.createContext({
    Date: DataDoDisparo,
    MailApp: { sendEmail(dest, assunto, _, { htmlBody }) { enviados.push({ dest, assunto, htmlBody }); } }
  });
  vm.runInContext(code, backend);
  vm.runInContext(firestore, backend);
  Object.assign(backend, {
    _fs_: () => ({ query: col => ({
      Execute: () => registros[col].map((obj, i) => ({ obj: { ...obj }, path: col + '/' + i }))
    }) }),
    _fsNomeServ_: nome => nome,
    _fsServerAtivo_: () => true,
    _getEmails_: () => ({ Interno: 'interno@example.invalid', Antigo: 'antigo@example.invalid', Atual: 'atual@example.invalid' }),
    _getServidoresApp_: () => [],
    _chefiaEmailFallback_: () => '',
    _reqUni_: () => 'reitoria-sel',
    _avisosCarregarEstado_: () => jaEnviados,
    _avisoMarcar_: () => {}
  });
  const { processos } = backend._dadosProcessosParaAvisos_({ isChefe: true });
  backend.enviarAvisosPrazo('todos');
  const central = backend._coletarAvisosPrazo_(processos, hoje, '', true);
  return { processo: processos[0], enviados, central };
}

function etapa(ordem, nome, fase, status, agente, campos = {}) {
  return { processoId: 'P1', ordem, etapa: nome, fase, status, agente, prazoDias: 3, ...campos };
}

const internaConcluida = etapa(1, 'Designação da equipe', 'Interna', 'Concluída', 'Interno', { dataRealizacao: '2026-11-24' });
const externaLegada = etapa(2, 'Fase externa — Pregão Eletrônico', 'Externa', 'Não iniciada', 'Antigo');
const cargaExterna = { processoId: 'P1', fase: 'Fase Externa', servidor: 'Antigo', ativo: false };

test('Contratação Direta legada sem subtipo ignora a fase externa e encerra com a interna completa', () => {
  const { processo, enviados, central } = simular({ etapas: [internaConcluida, externaLegada], cargas: [cargaExterna] });
  assert.equal(processo.status, 'ok');
  assert.equal(processo.etapas.length, 1);
  assert.equal(enviados.length, 0);
  assert.equal(central.proximos.length, 0);
});

test('Dispensa na fase interna não cobra a fase externa futura, mesmo com um prazo próximo', () => {
  const internaCorrente = { ...internaConcluida, status: 'Em andamento', prazoDias: 0 };
  const { enviados, central } = simular({
    tipoCD: 'Dispensa com disputa',
    etapas: [internaCorrente, externaLegada],
    cargas: [{ ...cargaExterna, ativo: true }]
  });
  assert.deepEqual(enviados.map(e => e.dest), ['interno@example.invalid']);
  assert.equal(central.proximos.length, 1);
  assert.equal(central.proximos[0].etapa, 'Designação da equipe');
});

test('Dispensa na fase externa ignora carga inativa e envia ao responsável ativo em vez do agente antigo', () => {
  const tipoCD = 'Dispensa com disputa';
  const etapas = [internaConcluida, externaLegada];
  assert.equal(simular({ tipoCD, etapas, cargas: [cargaExterna] }).enviados.length, 0);

  const cargas = [cargaExterna, { ...cargaExterna, servidor: 'Atual', ativo: true }];
  const { enviados, central } = simular({ tipoCD, etapas, cargas });
  assert.deepEqual(enviados.map(e => e.dest), ['atual@example.invalid']);
  assert.match(enviados[0].htmlBody, /Atual/);
  assert.equal(central.proximos.length, 1);
});

test('A retirada de uma etapa legada anterior preserva a chave de um prazo já avisado', () => {
  const irp = etapa(1, 'IRP', 'Interna', 'Não iniciada', 'Interno', { prazoDias: 0 });
  const internaCorrente = { ...internaConcluida, ordem: 2, status: 'Em andamento' };
  const jaEnviados = { 'reitoria-sel|P1|1|proximo': '2026-11-27' };
  const { processo, enviados } = simular({ etapas: [irp, internaCorrente], jaEnviados });
  assert.equal(processo.etapas.length, 1);
  assert.equal(processo.etapas[0].avisoIdx, 1);
  assert.equal(enviados.length, 0);
});
