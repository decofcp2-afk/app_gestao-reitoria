'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Domain = require('../atas-domain');

const numeroProcesso = '23040.003024/2023-44';
const processoId = 'SEL-2026-005';

function backend({sess = {nome:'Samuel'}, cargas, etapas = [], processos} = {}) {
  const docs = new Map();
  const writes = [];
  processos = processos || [{id:processoId, suap:numeroProcesso}];
  processos.forEach(p => docs.set('processos/' + p.id, p));
  cargas = cargas || [{processoId, fase:'Fase Externa', servidor:'Amanda', ativo:true},
    {processoId, fase:'Fase Externa', servidor:'Beatriz', ativo:true}];
  const c = {
    console, Date, JSON, Math, Object, Array, String, Number,
    Utilities:{getUuid:() => 'uuid-teste'},
    _withAppLockResult_:(_, fn) => fn(), _authRequire_:() => sess,
    _fsUnidade_:() => 'reitoria-sel', _fsGet_:path => docs.get(path) || null,
    _fsColecaoArray_:() => processos,
    _fsQueryEq_:(col, field, value) => (col === 'cargas' ? cargas : etapas)
      .filter(row => row[field] === value).map(obj => ({obj})),
    _fsSet_:(path, value) => {docs.set(path, value); writes.push({path, value});}
  };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync('apps-script/Atas.gs', 'utf8'), c);
  c._atasRequireAtiva_ = () => {};
  c._atasListar_ = () => [];
  c._atasLocalizarOficial_ = d => ({origem:'compras', numeroAta:d.numeroAta, anoAta:'2026',
    uasg:'153167', numeroCompra:'312', anoCompra:'2026', idAtaPNCP:d.idAtaPNCP,
    vigenciaInicio:'2026-10-08', vigenciaFim:'2027-10-08'});
  return {c, docs, writes};
}

function dados(extra = {}) {
  return {origem:'compras', processo:numeroProcesso, responsavelTipo:'equipe', responsavel:'Samuel',
    numeroAta:'01312/2026', idAtaPNCP:'42414284000102-1-000168/2026-000001', ...extra};
}

test('cadastro pelo número SUAP confirma o vínculo e aceita o responsável após conclusão', () => {
  const {c, writes} = backend();
  const result = c.salvarAtaApp(dados({processo:'23040003024202344'}), 'token');
  assert.equal(result.ok, true, result.erro);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].value.processoId, processoId);
  assert.equal(writes[0].value.processo, numeroProcesso);
  assert.equal(writes[0].value.responsavel, 'Samuel');
});

test('vínculo recebido da tela do processo funciona após a conclusão', () => {
  const {c} = backend({cargas:[{processoId, fase:'Fase Externa', servidor:'Samuel', ativo:false}]});
  const result = c.salvarAtaApp(dados({processoId, responsavel:'Samuel'}), 'token');
  assert.equal(result.ok, true, result.erro);
});

test('acompanhamento próprio independe do responsável pela licitação e da carga ativa', () => {
  for (const cargas of [
    [{processoId, fase:'Fase Externa', servidor:'Bruno', ativo:false}],
    [{processoId, fase:'Fase Interna', servidor:'Samuel', ativo:true}],
    [{processoId, fase:'Fase Externa', servidor:'Samuel', ativo:false},
      {processoId, fase:'Fase Externa', servidor:'Bruno', ativo:true}]
  ]) {
    const {c, writes} = backend({cargas});
    const result = c.salvarAtaApp(dados(), 'token');
    assert.equal(result.ok, true, result.erro);
    assert.equal(writes[0].value.responsavel, 'Samuel');
  }
  const {c, writes} = backend();
  assert.equal(c.salvarAtaApp(dados({responsavel:'Bruno'}), 'token').ok, true);
  assert.equal(writes[0].value.responsavel, 'Bruno');
});

test('número editado é vinculado ao novo processo, sem manter o id anterior', () => {
  const outro = {id:'SEL-2026-001', suap:'23040.000001/2026-00'};
  const {c, writes} = backend({processos:[{id:processoId, suap:numeroProcesso}, outro]});
  const result = c.salvarAtaApp(dados({processoId, processo:outro.suap}), 'token');
  assert.equal(result.ok, true, result.erro);
  assert.equal(writes[0].value.processoId, outro.id);
});

test('cadastro próprio admite ata manual ou processo de outro órgão sem vínculo interno', () => {
  const {c, writes} = backend();
  assert.equal(c.salvarAtaApp(dados({processo:'23040.999999/2026-00'}), 'token').ok, true);
  assert.equal(writes[0].value.processoId, undefined);
  assert.equal(writes[0].value.processo, '23040.999999/2026-00');
  const manual = c.salvarAtaApp(dados({origem:'manual', numeroAta:'10/2026', anoAta:'2026', uasg:'153167', processo:''}), 'token');
  assert.equal(manual.ok, true, manual.erro);
  assert.equal(writes[1].value.responsavel, 'Samuel');
});

test('chefia mantém cadastro sem processo interno; servidor pode indicar pessoa de outro setor', () => {
  const {c} = backend({sess:{nome:'Chefia', isChefe:true}});
  assert.equal(c.salvarAtaApp(dados({processo:'Processo de outro órgão'}), 'token').ok, true);
  assert.equal(backend().c.salvarAtaApp(dados({responsavelTipo:'externo', responsavel:'Maria', responsavelEmail:'maria@example.test'}), 'token').ok, true);
});

test('número duplicado exige escolher o processo correto e não grava um vínculo arbitrário', () => {
  const {c, writes} = backend({processos:[{id:processoId, suap:numeroProcesso}, {id:'SEL-2023-013', suap:numeroProcesso}]});
  assert.match(c.salvarAtaApp(dados(), 'token').erro, /Mais de um processo/);
  assert.equal(writes.length, 0);
});

test('cadastro não substitui uma ata de outro responsável, mesmo com confirmação', () => {
  for (const arquivada of [false, true]) {
    const {c, docs, writes} = backend();
    const id = c._atasDocId_({idAtaPNCP:dados().idAtaPNCP});
    docs.set('atas/' + id, {responsavel:'Bruno', arquivada});
    const result = c.salvarAtaApp(dados({confirmarAtualizacao:true}), 'token');
    assert.equal(result.ok, false);
    assert.match(result.erro, /outro responsável/);
    assert.equal(writes.length, 0);
  }
});

test('vínculo oficial não arquiva cadastro manual de outro responsável', () => {
  const {c, writes} = backend();
  c._atasListar_ = () => [{_id:'manual1', origem:'manual', numeroAta:'01312/2026', uasg:'153167', responsavel:'Bruno'}];
  assert.match(c.salvarAtaApp(dados(), 'token').erro, /vinculação à chefia/);
  assert.equal(writes.length, 0);
});

test('servidor transfere o acompanhamento da ata para outra pessoa ao editar', () => {
  const {c, docs} = backend();
  const updates = [];
  docs.set('atas/minha-ata', {responsavel:'Samuel', origem:'compras'});
  c._fsUpdate_ = (path, value) => updates.push({path, value});
  c._fs_ = () => ({query: () => ({Execute: () => []})});
  const result = c.atualizarAtaInternaApp({id:'minha-ata', responsavel:'Bruno'}, 'token');
  assert.equal(result.ok, true);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].value.responsavel, 'Bruno');
});

test('fluxo da tela exige responsável e salva as três atas para a pessoa escolhida', () => {
  const {c, writes} = backend();
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {value:'', textContent:'', innerHTML:'', hidden:false,
      classList:{add() {}, remove() {}, toggle() {}, contains() {return false;}}});
    return nodes.get(id);
  };
  const toasts = [];
  const window = {AtasDomain:Domain, AUTH_TOKEN:'token', SERVIDOR:'', toast:(msg, type) => toasts.push({msg, type})};
  const runner = {
    withSuccessHandler(cb) {this.success = cb; return this;},
    withFailureHandler(cb) {this.failure = cb; return this;},
    salvarAtaApp(d, token) {const cb = this.success; cb(c.salvarAtaApp(d, token));},
    getGestaoAtasApp() {this.success({ok:true, atas:[], alertas:[], uasg:'153167', unidade:'reitoria-sel'});}
  };
  const google = {script:{run:runner}};
  window.google = google;
  const context = {window, google, location:{hostname:'exemplo.test', search:''}, setTimeout,
    document:{getElementById:element, addEventListener() {},
      querySelectorAll:selector => selector === 'input[name="ata-oficial"]:checked'
        ? [0,1,2].map(value => ({value:String(value)})) : []}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('atas.js', 'utf8'), context);
  Object.assign(window.GESTAO_ATAS, {enabled:true, mode:'compras', prefill:null,
    resultados:['01312','02312','03312'].map((numero, i) => ({numeroAta:numero + '/2026',
      idAtaPNCP:'42414284000102-1-000168/2026-00000' + (i + 1)}))});
  element('ata-processo').value = numeroProcesso;
  element('ata-responsavel-tipo').value = 'equipe';
  window.salvarCadastroAta_();
  assert.equal(writes.length, 0);
  assert.match(toasts.pop().msg, /Selecione o responsável/);
  element('ata-responsavel').value = 'Bruno';
  window.salvarCadastroAta_();
  assert.equal(writes.length, 3, JSON.stringify(toasts));
  assert.ok(writes.every(write => write.value.processoId === processoId && write.value.responsavel === 'Bruno'));
  assert.equal(element('ata-modal-save').disabled, false);
  assert.equal(toasts.filter(t => t.type === 'err').length, 0);
  assert.match(toasts.at(-1).msg, /Ata adicionada ao controle/);
});
