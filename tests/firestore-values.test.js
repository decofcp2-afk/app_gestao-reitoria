'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../apps-script/FirestoreSync.gs'), 'utf8');
function fnSource(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Função não encontrada: ' + name);
  let depth = 0, opened = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') depth--;
    if (opened && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('Função incompleta: ' + name);
}
const ctx = vm.createContext({});
vm.runInContext(fnSource('_fsToVal_') + '\n' + fnSource('_fsFromVal_') + '\n' + fnSource('_fsToFields_'), ctx);

test('encoder REST preserva arrays e objetos aninhados do Firestore', () => {
  const original = { versao: 1, transicoes: [{ data: '2026-09-15', ausentes: 1 }, { data: '2026-10-01', ausentes: 0 }] };
  const encoded = ctx._fsToVal_(original);
  assert.ok(encoded.mapValue);
  assert.ok(encoded.mapValue.fields.transicoes.arrayValue);
  const decoded = ctx._fsFromVal_(encoded);
  assert.deepEqual(JSON.parse(JSON.stringify(decoded)), original);
});
