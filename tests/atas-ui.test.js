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
      querySelector() { return {}; },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
    });
    return elementos.get(id);
  };
  const window = {
    AtasDomain: Domain, SERVIDOR: 'Gestora',
    toast() {}, confirm() { return false; }
  };
  const contexto = {
    window, document: { getElementById: elemento, addEventListener() {}, querySelectorAll() {return [];} },
    location: { hostname: 'exemplo.test', search: '' }, setTimeout
  };
  vm.createContext(contexto);
  vm.runInContext(fs.readFileSync('atas.js', 'utf8'), contexto);
  return { window, elemento };
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
  window.SERVIDOR = 'Outro integrante';
  window.SERV_DATA = [{nome:'Gestora'}, {nome:'Outro integrante'}];
  window.abrirDetalheAta_('a2');
  assert.equal(elemento('ata-det-save').hidden, false);
  assert.doesNotMatch(elemento('ata-det-body').innerHTML, /disabled/);
  assert.match(elemento('ata-det-body').innerHTML, /<select id="ata-det-resp"/);
  assert.match(elemento('ata-det-body').innerHTML, /value="Gestora" selected/);
  assert.match(elemento('ata-det-body').innerHTML, /value="Outro integrante"/);
  elemento('ata-det-resp-tipo').value = 'externo';
  elemento('ata-det-resp').value = 'Outro integrante';
  window.alternarResponsavelDetalheAta_();
  assert.match(elemento('ata-det-resp-campo').innerHTML, /<input id="ata-det-resp"/);
  elemento('ata-det-resp-tipo').value = 'equipe';
  elemento('ata-det-resp').value = 'Responsável externo';
  window.alternarResponsavelDetalheAta_();
  assert.match(elemento('ata-det-resp-campo').innerHTML, /value="Outro integrante" selected/);
  assert.equal(elemento('ata-det-archive').hidden, true);
});

test('cadastro com dados preenchidos preserva o usuário do acompanhamento', () => {
  const {window, elemento} = montarTela();
  window.SERVIDOR = '';
  window.GESTAO_ATAS.usuario = 'Samuel';
  window.GESTAO_ATAS.podeGerirTodas = false;
  const processo = {id:'SEL-2026-005', num:'23040.003024/2023-44', servidorExt:'Beatriz', nome:'Vigilância'};
  window.abrirCadastroAta_(processo);
  assert.equal(elemento('ata-responsavel').value, 'Samuel');
  assert.equal(elemento('ata-responsavel').readOnly, true);
  assert.equal(elemento('ata-processo').value, processo.num);
  window.GESTAO_ATAS.podeGerirTodas = true;
  window.abrirCadastroAta_(processo);
  assert.equal(elemento('ata-responsavel').value, 'Beatriz');
  assert.equal(elemento('ata-responsavel').readOnly, false);
});
