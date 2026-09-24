'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Domain = require('../atas-domain.js');

function montarTela() {
  const elementos = new Map();
  const elemento = (id) => {
    if (!elementos.has(id)) elementos.set(id, {
      value: '', innerHTML: '', textContent: '', hidden: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    });
    return elementos.get(id);
  };
  const window = {
    AtasDomain: Domain, SERVIDOR: 'Gestora',
    toast() {}, confirm() { return false; }
  };
  const contexto = {
    window, document: { getElementById: elemento, addEventListener() {} },
    location: { hostname: 'exemplo.test', search: '' }, setTimeout
  };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync('atas.js', 'utf8'), contexto);
  return { window, elemento, contexto };
}

test('lista agrupa por objeto, preserva origem diversa e abre edição manual', () => {
  const { window, elemento } = montarTela();
  window.GESTAO_ATAS.enabled = true;
  window.GESTAO_ATAS.podeGerirTodas = true;
  window.GESTAO_ATAS.unidade = 'campus-centro';
  window.GESTAO_ATAS.atas = [
    { _id: 'a1', numeroAta: '1/2026', uasg: '123456', objeto: 'Livros', responsavel: 'Gestora', origem: 'manual', vigenciaFim: '2027-01-01' },
    { _id: 'a2', numeroAta: '2/2026', uasg: '789012', objeto: 'Livros', responsavel: 'Gestora', origem: 'compras', vigenciaFim: '2027-02-01' }
  ];
  window.renderGestaoAtas_();
  const html = elemento('tab-atas').innerHTML;
  assert.match(html, /2 ata\(s\) em 1 objeto\(s\)/);
  assert.match(html, /UASG 789012/);
  assert.match(html, /campus centro/);
  window.abrirDetalheAta_('a1');
  assert.match(elemento('ata-det-body').innerHTML, /ata-det-fim/);
  assert.equal(elemento('ata-det-archive').hidden, false);
  window.GESTAO_ATAS.podeGerirTodas = false;
  window.abrirDetalheAta_('a2');
  assert.equal(elemento('ata-det-archive').hidden, true);
});

test('formulário separa número e ano quando a compra é colada como no PNCP', () => {
  const { window, elemento, contexto } = montarTela();
  let consulta;
  const runner = {
    withSuccessHandler(fn) { this.sucesso = fn; return this; },
    withFailureHandler() { return this; },
    consultarAtasComprasApp(dados) { consulta = dados; this.sucesso({ atas: [] }); }
  };
  contexto.google = { script: { run: runner } };
  elemento('ata-uasg').value = '153167';
  elemento('ata-compra').value = '90007/2026';
  window.consultarAtasCompras_();
  assert.equal(consulta.numeroCompra, '90007');
  assert.equal(consulta.anoCompra, '2026');
  assert.equal(elemento('ata-compra').value, '90007/2026');
});
