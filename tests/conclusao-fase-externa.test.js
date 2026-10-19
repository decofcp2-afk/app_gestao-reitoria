'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function func(file, name) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
function norm(s) {
  return /conclu/i.test(s) ? 'ok' : /aplica/i.test(s) ? 'na' : 'pendente';
}
function runBackend(tipo, atual, statusExt) {
  const etapas = [
    { fase: 'Interna', etapa: 'TR', status: 'Concluída' },
    { fase: 'Externa', etapa: 'Pregão', status: statusExt },
    { fase: 'Contratual', etapa: 'Contrato', status: 'Pendente' }
  ];
  const cargas = [{ fase: 'Interna', servidor: 'Amanda', ativo: true },
    { fase: 'Externa', servidor: 'Samuel', ativo: true }];
  const ctx = vm.createContext({
    _normStatus_: norm,
    _isEtapaContratual_: f => f.toLowerCase() === 'contratual',
    _fsNomeServ_: n => n,
    _fsEtapasDoProc_: () => etapas.map((obj, i) => ({ obj, path: 'etapas/e' + i })),
    _fsQueryEq_: () => cargas.map((obj, i) => ({ obj, path: 'cargas/c' + i })),
    _fsUpdate_: (p, patch) => Object.assign(cargas[Number(p.slice(-1))], patch),
    _ss_: () => ({ getSheetByName: () => ({
      getLastRow: () => 3, getLastColumn: () => 7,
      getRange: (row, col) => row === 1 && col === 1 ? {
        getValues: () => [['Servidor', '', 'ProcessoID', '', '', 'Fase', 'Ativo'],
          ...cargas.map(c => [c.servidor, '', 'P', '', '', c.fase, c.ativo ? 'Sim' : 'Não'])]
      } : { setValue: value => { cargas[row - 2].ativo = value === 'Sim'; } }
    }) })
  });
  let result;
  if (tipo === 'Firestore') {
    vm.runInContext(func('apps-script/FirestoreSync.gs', '_fsTransicaoFase_'), ctx);
    result = ctx._fsTransicaoFase_('P', 'e' + atual);
  } else {
    vm.runInContext(func('apps-script/Code.gs', '_verificarTransicaoFase_'), ctx);
    const header = ['ProcessoID', 'Fase', 'Etapa', 'StatusEtapa ◄ EDITAR'];
    const values = [header, ...etapas.map(e => ['P', e.fase, e.etapa, e.status])];
    result = ctx._verificarTransicaoFase_('P', atual + 2, null, { hIdx: 0, values }, header);
  }
  return { result, cargas };
}

for (const tipo of ['Firestore', 'Planilha']) {
  test(tipo + ': conclusão externa encerra cargas sem anunciar nova transição', () => {
    const { result, cargas } = runBackend(tipo, 1, 'Concluída');
    assert.equal(result.feita, false);
    assert.equal(result.servidorExt, '');
    assert.ok(cargas.every(c => !c.ativo));
  });
  test(tipo + ': fim da interna ainda transfere a carga para Samuel', () => {
    const { result, cargas } = runBackend(tipo, 0, 'Pendente');
    assert.equal(result.feita, true);
    assert.equal(result.servidorExt, 'Samuel');
    assert.equal(cargas[0].ativo, false);
    assert.equal(cargas[1].ativo, true);
  });
  test(tipo + ': conclusão parcial externa não repete a passagem de fase', () => {
    const { result } = runBackend(tipo, 2, 'Pendente');
    assert.equal(result.feita, false);
  });
}

test('Filtro histórico inclui Samuel e Amanda após concluir o processo', () => {
  const p = { nome: 'Iluminação e Sonorização', num: '23040.005462/2025-17',
    status: 'ok', servidor: 'Amanda', servidorExt: 'Samuel', etapaAtualIdx: -1, etapas: [] };
  const ctx = vm.createContext({ DATA: [p], FILA: [], F_MODAL: '', F_SERV: 'Samuel',
    document: { getElementById: () => ({ value: '' }) },
    renderEtapas: list => { ctx.resultado = list; }, _refreshFilaSeAtiva_() {} });
  vm.runInContext(func('index.html', 'aplicarFiltros'), ctx);
  for (const nome of ['Samuel', 'Amanda', '', 'Bruno']) {
    ctx.F_SERV = nome;
    ctx.aplicarFiltros();
    assert.equal(ctx.resultado.length, nome === 'Bruno' ? 0 : 1);
  }
  p.status = 'andamento'; p.etapaAtualIdx = 0; p.etapas = [{ fase: 'Externa' }];
  ctx.F_SERV = 'Samuel'; ctx.aplicarFiltros(); assert.equal(ctx.resultado.length, 1);
  ctx.F_SERV = 'Amanda'; ctx.aplicarFiltros(); assert.equal(ctx.resultado.length, 0);
});
