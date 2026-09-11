'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Atas = require('../atas-domain.js');

const hoje = '2026-09-11';

test('situação da ata respeita ativa, 90 dias, vencida e aguardando dados', () => {
  assert.equal(Atas.situacaoAta({ vigenciaFim: '2027-01-11' }, hoje).codigo, 'ativa');
  assert.deepEqual(Atas.situacaoAta({ vigenciaFim: '2026-10-11' }, hoje), { codigo: 'vencendo', rotulo: 'Vence em 30 dias', dias: 30 });
  assert.equal(Atas.situacaoAta({ vigenciaFim: '2026-09-10' }, hoje).codigo, 'vencida');
  assert.equal(Atas.situacaoAta({}, hoje).codigo, 'aguardando');
});

test('datas brasileiras são válidas e não sofrem deslocamento de fuso', () => {
  assert.equal(Atas.isoData('14/08/2027'), '2027-08-14');
  assert.equal(Atas.formatarDataBR('2027-08-14T00:00:00.000Z'), '14/08/2027');
  assert.equal(Atas.isoData('31/02/2027'), '');
});

test('avisos ficam limitados a vencida e marcos 30, 60 e 90', () => {
  assert.deepEqual(Atas.marcosPendentes({ numeroAta: '1/2026', uasg: '153167', vigenciaFim: '2026-10-11', responsavel: 'Bruno' }, hoje), [30, 60, 90]);
  assert.deepEqual(Atas.marcosPendentes({ numeroAta: '1/2026', uasg: '153167', vigenciaFim: '2026-09-10', responsavel: 'Bruno' }, hoje), [0]);
  assert.deepEqual(Atas.MARCOS, [30, 60, 90]);
});

test('deduplicação oficial prefere o identificador PNCP', () => {
  const a = { idAtaPNCP: '42414284000102-1-000148/2026-000001', numeroAta: '01126/2026', uasg: '153167' };
  const b = { ...a, numeroAta: 'outro' };
  assert.equal(Atas.chaveOficial(a), Atas.chaveOficial(b));
});

test('normalização oficial aceita os campos reais do módulo ARP', () => {
  const a = Atas.normalizarAtaOficial({
    numeroAtaRegistroPreco: '90032/2025', codigoUnidadeGerenciadora: '153167', numeroCompra: '90021', anoCompra: 2025,
    dataAssinatura: '2026-01-09', dataVigenciaInicial: '2026-01-10', dataVigenciaFinal: '2027-01-11'
  });
  assert.equal(a.numeroAta, '90032/2025');
  assert.equal(a.anoAta, '2025');
  assert.equal(a.uasg, '153167');
  assert.equal(a.vigenciaFim, '2027-01-11');
});

test('uma compra pode manter várias atas sem colisão', () => {
  const base = { uasg: '153167', numeroCompra: '90021', anoCompra: 2025 };
  assert.notEqual(
    Atas.chaveOficial({ ...base, numeroAta: '90032/2025' }),
    Atas.chaveOficial({ ...base, numeroAta: '90033/2025' })
  );
});

test('mescla dados oficiais sem apagar responsável e observação internos', () => {
  const r = Atas.mesclarOficial(
    { origem: 'manual', responsavel: 'Bruno Alves', observacao: 'Acompanhar renovação' },
    { numeroAta: '01126/2026', vigenciaFim: '2027-08-14' }
  );
  assert.equal(r.origem, 'compras');
  assert.equal(r.responsavel, 'Bruno Alves');
  assert.equal(r.observacao, 'Acompanhar renovação');
});

test('filtros pesquisam ata, processo, compra, objeto e responsável', () => {
  const atas = [{ numeroAta: '01126/2026', processo: '23040.000201/2026-83', objeto: 'Materiais esportivos', responsavel: 'Bruno Alves', vigenciaFim: '2027-08-14' }];
  assert.equal(Atas.filtrarAtas(atas, { busca: 'esportivos' }, hoje).length, 1);
  assert.equal(Atas.filtrarAtas(atas, { busca: 'Amanda' }, hoje).length, 0);
});

test('KPIs separam ativas, vencendo, aguardando e vencidas', () => {
  assert.deepEqual(Atas.kpis([
    { vigenciaFim: '2027-01-11' }, { vigenciaFim: '2026-10-11' }, {}, { vigenciaFim: '2026-09-10' }
  ], hoje), { ativas: 1, vencendo90: 1, aguardando: 1, vencidas: 1 });
});
