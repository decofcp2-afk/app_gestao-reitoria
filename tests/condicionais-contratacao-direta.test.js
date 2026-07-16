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

test('Adesão: fila/detalhe pulam etapas por derivação, mesmo sem status "na" gravado', () => {
  // Processo de adesão cujas etapas ainda estão com status NORMAL (não foram
  // reprocessadas). A leitura deve derivar na a partir do tipoCD do processo.
  const procs = [processo({ id: 'PA', d0: '2026-06-02', modalidade: 'Contratação Direta', tipoCD: 'Adesão', temIrp: true })];
  const etapas = [
    etapa({ processoId: 'PA', etapa: 'ETP + Mapa de Riscos + Pesquisa de Preços', ordem: 2, status: 'Concluída', prazoDias: 45 }),
    etapa({ processoId: 'PA', etapa: 'Minuta do Termo de Referência', ordem: 3, status: 'Concluída', prazoDias: 10 }),
    etapa({ processoId: 'PA', etapa: 'IRP — Intenção de Registro de Preços', ordem: 4, status: 'Em andamento', prazoDias: 15 }),
    etapa({ processoId: 'PA', etapa: 'Versão final do TR e demais documentos aprovados', ordem: 6, status: 'Não iniciada', prazoDias: 10 }),
    etapa({ processoId: 'PA', etapa: 'Fase externa — Contratação Direta', fase: 'Externa', ordem: 8, status: 'Não iniciada', prazoDias: 30 })
  ];
  const r = construir(procs, etapas, [], { isChefe: true });
  const p = r.processos.find((x) => x.id === 'PA');
  const visiveis = p.etapas.filter((e) => e.status !== 'na').map((e) => e.nome);
  // IRP, Versão final e Fase externa somem do prazo (derivados na).
  assert.ok(!visiveis.some((n) => /IRP/.test(n)), 'IRP deve virar na em adesão');
  assert.ok(!visiveis.some((n) => /Versão final/.test(n)), 'Versão final do TR deve virar na em adesão');
  assert.ok(!visiveis.some((n) => /Fase externa/.test(n)), 'Fase externa deve virar na em adesão');
  // ETP (concluída) permanece — derivação nunca mexe em etapa concluída.
  assert.ok(visiveis.some((n) => /ETP/.test(n)), 'ETP concluída deve permanecer');
});

test('Retorno para fila não some quando o marcador cai em etapa derivada "na"', () => {
  // Adesão: a IRP derivaria para "na", mas carrega o marcador de retorno.
  // A leitura deve mantê-la visível para o processo ser detectado como retornado.
  const procs = [processo({ id: 'PR', d0: '2026-06-02', modalidade: 'Contratação Direta', tipoCD: 'Adesão', temIrp: true })];
  const etapas = [
    etapa({ processoId: 'PR', etapa: 'ETP + Mapa de Riscos + Pesquisa de Preços', ordem: 2, status: 'Concluída' }),
    etapa({ processoId: 'PR', etapa: 'IRP — Intenção de Registro de Preços', ordem: 4, status: 'Em andamento', motivoAtraso: 'RETORNO PARA FILA: testando' })
  ];
  const r = construir(procs, etapas, [], { isChefe: true });
  const p = r.processos.find((x) => x.id === 'PR');
  assert.equal(p.retornoFila, true, 'processo deve ser detectado como retornado');
  assert.ok(p.etapas.some((e) => /IRP/.test(e.nome) && e.status !== 'na'), 'etapa com marcador de retorno fica visível');
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
