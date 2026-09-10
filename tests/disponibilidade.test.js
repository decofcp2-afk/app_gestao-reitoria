'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../apps-script/Disponibilidade.gs'), 'utf8');
function runtime(extra = {}) { const c = vm.createContext({ ...extra }); vm.runInContext(source, c); return c; }
const equipe = [{ matricula: '1' }, { matricula: '2' }];
const periodo = (o = {}) => ({ matricula: '1', tipo: 'ferias', inicio: '2026-09-15', fim: '2026-09-30', ...o });
test('Valida datas reais, ordem, tipo, servidor e férias sem fim', () => {
  const c = runtime();
  for (const o of [{ inicio: '2026-02-30' }, { fim: '2026-09-10' }, { fim: '' }, { tipo: 'medica' }, { matricula: '3' }]) assert.throws(() => c._ausValidar_([periodo(o)], equipe));
});
test('Impede sobreposição inclusive último dia e licença aberta; permite períodos contíguos', () => {
  const c = runtime();
  assert.throws(() => c._ausValidar_([periodo(), periodo({ inicio: '2026-09-30', fim: '2026-10-05' })], equipe));
  assert.throws(() => c._ausValidar_([periodo({ tipo: 'afastamento', fim: '' }), periodo({ inicio: '2027-01-01', fim: '2027-01-10' })], equipe));
  assert.equal(c._ausValidar_([periodo(), periodo({ inicio: '2026-10-01', fim: '2026-10-05' })], equipe).length, 2);
});
test('Resumo público contém apenas contagem e datas; inclui retorno e ausência aberta', () => {
  const c = runtime();
  const r = c._ausResumo_([periodo(), periodo({ matricula: '2', tipo: 'afastamento', inicio: '2026-09-20', fim: '' })], equipe);
  assert.deepEqual(JSON.parse(JSON.stringify(r.transicoes)), [{ data: '2026-09-15', ausentes: 1 }, { data: '2026-09-20', ausentes: 2 }, { data: '2026-10-01', ausentes: 1 }]);
  assert.doesNotMatch(JSON.stringify(r), /matricula|tipo|ferias|afastamento|nome/);
  assert.equal(c._ausResumo_([periodo()], []).transicoes.length, 0);
});
test('Gravação exige chefia e revisão atual; falha pública fica pendente e auditada', () => {
  const writes = [], audits = [];
  const c = runtime({ _withAppLockResult_: (_, f) => f(), _authRequire_: (_, chefe) => { assert.equal(chefe, true); return { matricula: 'chefia' }; },
    _getServidoresApp_: () => equipe, _fsGet_: () => null, _fsCreate_: (p,d) => audits.push([p,d]),
    _fsSet_: (p,d) => { if (p.startsWith('config/')) throw new Error('Falha'); writes.push([p,d]); }, _fsUpdate_: () => {} });
  assert.throws(() => c.salvarDisponibilidadeApp([periodo()], 2, 'token'), /Agenda alterada/);
  const r = c.salvarDisponibilidadeApp([periodo()], 0, 'token');
  assert.equal(r.pendente, true); assert.equal(audits.length, 1); assert.equal(writes[0][0], 'disponibilidade/agenda');
});
