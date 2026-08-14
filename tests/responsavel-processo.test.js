'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes do RESPONSÁVEL exibido no topo do processo.
//
// Caso real: em processo concluído, o app mostrava ora o responsável da fase
// interna (quem iniciou), ora um rótulo de setor ("DIAD/DECOF"), ora ninguém.
// A causa está na leitura: concluído não tem etapa atual, então a tela sempre
// caía no fallback `servidor || servidorExt` — e esse fallback aceitava
// qualquer texto do campo Agente da etapa, inclusive nome de setor.
//
// Aqui ficam as duas metades verificáveis:
//   1) nomeRespGenerico — quais nomes NÃO identificam pessoa;
//   2) o efeito em construir(): srvInt/srvExt nunca recebem rótulo de setor, e
//      o processo informa se a fase externa existe.
// A montagem das tags (responsaveisExibidos_/tagsResponsaveisHtml_, no
// index.html) espelha esta regra — se mudar uma, mude a outra.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');
const { construir, nomeRespGenerico } = require('../appsel-firestore.js');
const { carga, etapa, processo } = require('./helpers.js');

test('Rótulos de setor/equipe não valem como responsável', () => {
  ['DIAD', 'DECOF', 'DIAD/DECOF', 'SEL/SEPMA', 'SEL', 'SEL SEPMA', 'sel/sepma',
   'Equipe de Planejamento', 'Setor de licitações', 'Seção de Licitações',
   'Coordenação de Compras', 'Gabinete', '', '   ']
    .forEach(function (n) {
      assert.equal(nomeRespGenerico(n), true, 'deveria ser genérico: ' + JSON.stringify(n));
    });
});

test('Nome de pessoa vale como responsável', () => {
  ['Amanda', 'Beatriz Souza', 'Jean-Pierre', 'Ana Paula'].forEach(function (n) {
    assert.equal(nomeRespGenerico(n), false, 'não deveria ser genérico: ' + n);
  });
});

// A regra anterior casava as siglas como SUBSTRING. Ampliar a lista sem mudar
// isso apagaria pessoas reais da tela — "sel" está dentro de vários nomes
// comuns, e sumir com o responsável é pior do que mostrar uma sigla.
test('Sigla dentro de nome de pessoa não torna o nome genérico', () => {
  ['Selma', 'Selma Diadorim', 'Anselmo', 'Marisel', 'Giselle Proença', 'Celso Reitoria Neto']
    .forEach(function (n) {
      assert.equal(nomeRespGenerico(n), false, 'não deveria ser genérico: ' + n);
    });
});

test('Sigla acompanhada de nome continua sendo a pessoa', () => {
  assert.equal(nomeRespGenerico('Amanda SEL'), false);
  assert.equal(nomeRespGenerico('SEL Amanda'), false);
});

test('Processo antigo com Agente "SEL/SEPMA" fica sem responsável, não com a sigla', () => {
  const p = processoConcluido({
    cargas: [],
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Concluída', agente: 'SEL/SEPMA' }),
      etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Concluída', agente: 'SEL/SEPMA' })
    ]
  });
  assert.equal(p.servidor, '');
  assert.equal(p.servidorExt, '');
});

// Processo concluído nas duas fases, com responsáveis diferentes por fase.
function processoConcluido(over) {
  over = over || {};
  return construir(
    [processo({ id: 'P1', objeto: 'Agenciamento de viagem', d0: '2026-01-05' })],
    over.etapas || [
      etapa({ processoId: 'P1', ordem: 1, etapa: 'DFD', fase: 'Interna', status: 'Concluída', agente: 'Amanda' }),
      etapa({ processoId: 'P1', ordem: 8, etapa: 'Fase externa — Pregão Eletrônico', fase: 'Externa', status: 'Concluída', agente: 'Samuel' })
    ],
    over.cargas !== undefined ? over.cargas : [
      carga({ processoId: 'P1', servidor: 'amanda', fase: 'Interna' }),
      carga({ processoId: 'P1', servidor: 'samuel', fase: 'Externa' })
    ],
    { isChefe: true }
  ).processos[0];
}

test('Concluído carrega os responsáveis das DUAS fases', () => {
  const p = processoConcluido();
  assert.equal(p.status, 'ok');
  assert.equal(p.servidor, 'Amanda');
  assert.equal(p.servidorExt, 'Samuel');
  assert.equal(p.temFaseExterna, true);
});

test('Sem cargas, o fallback usa o Agente da etapa — mas só nome de pessoa', () => {
  const p = processoConcluido({ cargas: [] });
  assert.equal(p.servidor, 'Amanda');
  assert.equal(p.servidorExt, 'Samuel');
});

test('Agente genérico não vira responsável (era a origem do "DIAD/DECOF" na tela)', () => {
  const p = processoConcluido({
    cargas: [],
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Concluída', agente: 'DIAD/DECOF' }),
      etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Concluída', agente: 'Equipe de Planejamento' })
    ]
  });
  assert.equal(p.servidor, '');
  assert.equal(p.servidorExt, '');
});

test('Agente genérico numa etapa não impede achar a pessoa em outra da mesma fase', () => {
  const p = processoConcluido({
    cargas: [],
    etapas: [
      etapa({ processoId: 'P1', ordem: 1, fase: 'Interna', status: 'Concluída', agente: 'DECOF' }),
      etapa({ processoId: 'P1', ordem: 2, fase: 'Interna', status: 'Concluída', agente: 'Beatriz' }),
      etapa({ processoId: 'P1', ordem: 8, fase: 'Externa', status: 'Concluída', agente: 'Samuel' })
    ]
  });
  assert.equal(p.servidor, 'Beatriz');
});

test('Contratação direta sem fase externa aplicável é sinalizada', () => {
  const p = construir(
    [processo({ id: 'P2', objeto: 'Contratação direta', modalidade: 'Contratação Direta', tipoCD: 'Sem disputa', d0: '2026-02-01' })],
    [
      etapa({ processoId: 'P2', ordem: 1, fase: 'Interna', status: 'Concluída', agente: 'Amanda' }),
      etapa({ processoId: 'P2', ordem: 8, etapa: 'Fase externa — Contratação Direta', fase: 'Externa', status: 'Não se aplica' })
    ],
    [carga({ processoId: 'P2', servidor: 'amanda', fase: 'Interna' })],
    { isChefe: true }
  ).processos[0];
  assert.equal(p.temFaseExterna, false);
  assert.equal(p.servidorExt, '');
});
