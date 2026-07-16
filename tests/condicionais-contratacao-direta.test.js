'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes das condicionais de Contratação Direta expostas ao app.
//
// Cobre a camada de leitura (construir() de appsel-firestore.js):
//  - os campos tipoCD / procuradoria / temIRP são propagados para os cards de
//    processo e de fila, para o formulário de edição pré-selecioná-los;
//  - etapas com status "Não se aplica" continuam FORA do prazo total.
//
// A tabela-verdade da derivação (quais etapas viram "Não se aplica" conforme o
// tipo) é aplicada no backend GAS (Code.gs / FirestoreSync.gs). Aqui replicamos
// a mesma função pura para travar as regras contra regressão.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construir } = require('../appsel-firestore.js');
const { etapa, processo } = require('./helpers.js');

// ── Réplica da lógica de _fsCondicionais_ (backend) para travar as regras ──
// Ordens do template: 3=Minuta TR, 4=IRP, 5=Adequações/Procuradoria,
// 6=Versão Final TR, 8=Fase externa, 9=Assinatura (sempre na).
function condicionais(cfg) {
  cfg = cfg || {};
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const ehCD = norm(cfg.modalidade).indexOf('direta') >= 0;
  const tipo = norm(cfg.tipoCD);
  const ehAdesao = ehCD && tipo.indexOf('adesao') >= 0;
  const temDisputa = ehCD && tipo.indexOf('com disputa') >= 0;
  const semIRP = (cfg.temIRP !== 'Sim') || ehAdesao;
  const semProc = ehCD && (cfg.procuradoria === 'Não');
  const na = {};
  if (semIRP) na[4] = true;
  if (ehAdesao) { na[3] = true; na[6] = true; }
  if (ehCD && !temDisputa) na[8] = true;
  na[9] = true;
  return { na: Object.keys(na).map(Number).sort((a, b) => a - b), procuradoriaNao: semProc };
}

test('tipoCD e procuradoria são propagados ao card de processo (com D0)', () => {
  const procs = [processo({ id: 'P1', d0: '2026-01-02', modalidade: 'Contratação Direta', tipoCD: 'Adesão', procuradoria: 'Não', temIrp: false })];
  const etapas = [etapa({ processoId: 'P1', fase: 'Interna', status: 'Em andamento', ordem: 1 })];
  const r = construir(procs, etapas, [], { isChefe: true });
  const p = r.processos.find((x) => x.id === 'P1');
  assert.equal(p.tipoCD, 'Adesão');
  assert.equal(p.procuradoria, false); // "Não" → false
  assert.equal(p.temIRP, false);
});

test('procuradoria ausente/"Sim" resolve para true; fila também expõe os campos', () => {
  const procs = [processo({ id: 'P2', modalidade: 'Contratação Direta', tipoCD: 'Dispensa com disputa', temIrp: true })];
  const r = construir(procs, [], [], { isChefe: true });
  const p = r.filaPrevisao.find((x) => x.id === 'P2'); // sem D0 → fila
  assert.equal(p.tipoCD, 'Dispensa com disputa');
  assert.equal(p.procuradoria, true);
  assert.equal(p.temIRP, true);
});

test('Etapas "Não se aplica" ficam fora do prazo total do processo', () => {
  const procs = [processo({ id: 'P3', d0: '2026-01-02', modalidade: 'Contratação Direta' })];
  // Fase externa marcada "Não se aplica" não deve empurrar a data final.
  const etapas = [
    etapa({ processoId: 'P3', etapa: 'ETP', fase: 'Interna', status: 'Não iniciada', ordem: 1, prazoDias: 45 }),
    etapa({ processoId: 'P3', etapa: 'Fase externa', fase: 'Externa', status: 'Não se aplica', ordem: 2, prazoDias: 30 })
  ];
  const r = construir(procs, etapas, [], { isChefe: true });
  const p = r.processos.find((x) => x.id === 'P3');
  const nomesEtapasNoPrazo = p.etapas.filter((e) => e.status !== 'na').map((e) => e.nome);
  assert.ok(!nomesEtapasNoPrazo.includes('Fase externa'), 'Fase externa (na) não pode contar no prazo');
});

test('Tabela-verdade das condicionais (derivação de "Não se aplica")', () => {
  const casos = [
    ['Pregão sem IRP', { modalidade: 'Pregão Eletrônico', temIRP: 'Não' }, [4, 9]],
    ['Pregão com IRP', { modalidade: 'Pregão Eletrônico', temIRP: 'Sim' }, [9]],
    ['CD dispensa com disputa', { modalidade: 'Contratação Direta', tipoCD: 'Dispensa com disputa', temIRP: 'Sim' }, [9]],
    ['CD dispensa sem disputa', { modalidade: 'Contratação Direta', tipoCD: 'Dispensa sem disputa', temIRP: 'Não' }, [4, 8, 9]],
    ['CD inexigibilidade', { modalidade: 'Contratação Direta', tipoCD: 'Inexigibilidade', temIRP: 'Não' }, [4, 8, 9]],
    ['CD adesão', { modalidade: 'Contratação Direta', tipoCD: 'Adesão', temIRP: 'Sim' }, [3, 4, 6, 8, 9]]
  ];
  for (const [nome, cfg, esperado] of casos) {
    assert.deepEqual(condicionais(cfg).na, esperado, nome);
  }
  // Procuradoria facultativa só marca renome, nunca "na".
  assert.equal(condicionais({ modalidade: 'Contratação Direta', tipoCD: 'Dispensa sem disputa', procuradoria: 'Não' }).procuradoriaNao, true);
  assert.equal(condicionais({ modalidade: 'Contratação Direta', tipoCD: 'Dispensa sem disputa', procuradoria: 'Sim' }).procuradoriaNao, false);
});
