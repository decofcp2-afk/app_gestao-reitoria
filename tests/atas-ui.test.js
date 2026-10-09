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

test('cadastro exige escolher um servidor sem presumir o usuário ou o responsável da licitação', () => {
  const {window, elemento} = montarTela();
  window.SERVIDOR = '';
  window.GESTAO_ATAS.usuario = 'Samuel';
  window.GESTAO_ATAS.podeGerirTodas = false;
  window.GESTAO_ATAS.enabled = true;
  window.SERV_DATA = [{nome:'Samuel'}, {nome:'Beatriz'}];
  const processo = {id:'SEL-2026-005', num:'23040.003024/2023-44', servidorExt:'Beatriz', nome:'Vigilância'};
  window.abrirCadastroAta_(processo);
  assert.match(elemento('ata-responsavel-campo').innerHTML, /<select id="ata-responsavel"/);
  assert.match(elemento('ata-responsavel-campo').innerHTML, /value="Beatriz"/);
  assert.doesNotMatch(elemento('ata-responsavel-campo').innerHTML, /selected|disabled/);
  assert.equal(elemento('ata-processo').value, processo.num);
  window.GESTAO_ATAS.podeGerirTodas = true;
  window.abrirCadastroAta_(processo);
  assert.doesNotMatch(elemento('ata-responsavel-campo').innerHTML, /selected|disabled/);
});

test('seleção do servidor preenche contatos e reabertura preserva ajustes específicos da ata', () => {
  const {window, elemento} = montarTela();
  Object.assign(window.GESTAO_ATAS, {enabled:true, unidade:'reitoria-sel', atas:[
    {_id:'a1', numeroAta:'10/2026', origem:'compras', responsavel:'Amanda', responsavelEmail:'ata@example.com', responsavelSetor:'Biblioteca'}
  ]});
  window.SERV_DATA = [{nome:'Amanda', email:'amanda@cp2.g12.br'}];
  ['ata-det-resp-tipo','ata-responsavel-tipo'].forEach(id => elemento(id).value='equipe');
  ['ata-det-resp','ata-responsavel'].forEach(id => elemento(id).value='Amanda');
  [false,true].forEach(cadastro => {
    window.preencherResponsavelAta_(cadastro);
    assert.equal(elemento(cadastro?'ata-responsavel-email':'ata-det-resp-email').value, 'amanda@cp2.g12.br');
    assert.equal(elemento(cadastro?'ata-responsavel-setor':'ata-det-resp-setor').value, 'Decof-LIC');
  });
  window.abrirDetalheAta_('a1');
  assert.match(elemento('ata-det-body').innerHTML, /value="ata@example.com"/);
  assert.match(elemento('ata-det-body').innerHTML, /value="Biblioteca"/);
  elemento('ata-det-resp-tipo').value='externo';
  elemento('ata-det-resp-email').value='outro@example.com';
  window.preencherResponsavelAta_(false);
  assert.equal(elemento('ata-det-resp-email').value, 'outro@example.com');
  assert.equal(window.SERV_DATA[0].email, 'amanda@cp2.g12.br');
});
