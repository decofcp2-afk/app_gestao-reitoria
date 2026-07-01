'use strict';
// ════════════════════════════════════════════════════════════════════════
// Testes de criação de unidade (`fs_criarUnidade`, apps-script/FirestoreSync.gs).
//
// fs_criarUnidade fala com o Firestore e com o Apps Script (PropertiesService,
// MailApp, LockService), então não é carregável aqui. Este arquivo espelha as
// regras PURAS usadas pela função — geração do id (slug), validação de entrada,
// checagem de duplicidade e escolha do login do 1º chefe — como guarda de
// regressão para o cadastro das unidades do CPII. Se mudar a regra lá,
// atualize aqui também.
//
// AUTOCADASTRO ABERTO: o cadastro sai da tela de login ("Cadastre aqui"), onde
// quem cadastra ainda não tem sessão — por isso fs_criarUnidade NÃO exige admin.
// A guarda é o e-mail institucional (@...g12.br) + a trava anti-sobrescrita.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');

// Espelho de _slugUnidade_ (FirestoreSync.gs): id da unidade = nome "slugificado".
function slugUnidade(s) {
  s = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Espelho de _authNorm_ (Code.gs), usado para derivar o login do 1º chefe.
function authNorm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// Espelho das validações no início de fs_criarUnidade (até a checagem de
// duplicidade, que depende do Firestore e está coberta à parte abaixo).
// AUTOCADASTRO ABERTO: nao exige admin — o cadastro sai da tela de login, onde
// quem cadastra ainda nao tem sessao. A guarda e o e-mail institucional.
function validarCriarUnidade(params) {
  params = params || {};
  var nome = String(params.nome || '').trim();
  var email = String(params.email || '').trim().toLowerCase();
  if (nome.length < 3) return { ok: false, erro: 'Informe o nome da unidade.' };
  if (!/@.*g12\.br$/.test(email)) return { ok: false, erro: 'Use um e-mail institucional (@...g12.br).' };
  var uid = slugUnidade(nome);
  if (!uid) return { ok: false, erro: 'Nome inválido.' };
  return { ok: true, uid: uid, nome: nome, email: email };
}

// Espelho da escolha do login do 1º chefe dentro de fs_criarUnidade:
// parte local do e-mail → sigla → "gestor-<id>".
function loginParaUnidade(email, sigla, uid) {
  return authNorm(String(email || '').split('@')[0]) || authNorm(sigla) || ('gestor-' + uid);
}

// Espelho da checagem de duplicidade (pós-correção): só 404 significa
// "unidade não existe ainda"; qualquer outro erro deve abortar a criação em
// vez de assumir que está livre e sobrescrever uma unidade existente.
function podeCriar(getExistenteResult) {
  if (getExistenteResult.httpCode === 404) return { podeCriar: true };
  if (getExistenteResult.httpCode) return { podeCriar: false, erro: 'falha ao checar duplicidade (HTTP ' + getExistenteResult.httpCode + ')' };
  return { podeCriar: false, erro: 'Já existe uma unidade com esse nome.' };
}

function gerarSenhaTemp() {
  var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 7; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

test('Slug: nomes reais das unidades do CPII viram ids válidos e sem colisão entre si', () => {
  const unidades = [
    'Centro', 'Engenho Novo I', 'Engenho Novo II', 'Humaitá I', 'Humaitá II',
    'Humaitá III', 'Realengo I', 'Realengo II', 'São Cristóvão I',
    'São Cristóvão II', 'São Cristóvão III', 'Tijuca I', 'Tijuca II', 'Niterói'
  ];
  const ids = unidades.map(slugUnidade);
  ids.forEach(function (id, i) {
    assert.ok(id.length > 0, 'slug vazio para "' + unidades[i] + '"');
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug fora do formato esperado: ' + id);
  });
  assert.equal(new Set(ids).size, ids.length, 'duas unidades do CPII geraram o mesmo id');
});

test('Slug: acento/caixa não importam — mesma unidade sempre vira o mesmo id', () => {
  assert.equal(slugUnidade('São Cristóvão II'), slugUnidade('  são cristóvão ii  '));
  assert.equal(slugUnidade('Humaitá I'), 'humaita-i');
});

test('Slug: nome só com espaços/símbolos gera id vazio (cai na checagem de "Nome inválido")', () => {
  assert.equal(slugUnidade('   '), '');
  assert.equal(slugUnidade('---'), '');
});

test('Autocadastro aberto: cadastro válido pela tela de login (SEM sessão/admin) é aceito', () => {
  // Regressão do "Sessão expirada" ao cadastrar: fs_criarUnidade exigia admin,
  // mas o cadastro sai da tela de login, onde ninguém está logado. Agora passa
  // só com dados válidos + e-mail institucional, sem token de sessão.
  const r = validarCriarUnidade({ nome: 'Tijuca I', email: 'chefe@cp2.g12.br' });
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'tijuca-i');
});

test('Validação: exige nome com 3+ caracteres', () => {
  const r = validarCriarUnidade({ nome: 'CT', email: 'chefe@cp2.g12.br' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /nome/i);
});

test('Validação: exige e-mail institucional (...g12.br)', () => {
  const r = validarCriarUnidade({ nome: 'Tijuca I', email: 'chefe@gmail.com' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /institucional/i);
});

test('Validação: aceita e-mail institucional em qualquer caixa/subdomínio g12.br (ex.: cp2.g12.br)', () => {
  const r = validarCriarUnidade({ nome: 'Tijuca I', email: 'CHEFE@CP2.G12.BR' });
  assert.equal(r.ok, true);
  assert.equal(r.uid, 'tijuca-i');
});

test('Validação: nome com 3+ caracteres mas só símbolos passa na 1ª checagem e falha no slug', () => {
  // Regressão: "###" tem 3 caracteres (passa em nome.length<3) mas vira id vazio.
  const r = validarCriarUnidade({ nome: '###', email: 'chefe@cp2.g12.br' });
  assert.equal(r.ok, false);
  assert.match(r.erro, /inválido/i);
});

test('Duplicidade: GET 404 (unidade não existe) libera a criação', () => {
  assert.deepEqual(podeCriar({ httpCode: 404 }), { podeCriar: true });
});

test('Duplicidade: unidade existente bloqueia a criação', () => {
  const r = podeCriar({ name: 'projects/x/databases/(default)/documents/unidades/tijuca-i' });
  assert.equal(r.podeCriar, false);
  assert.match(r.erro, /já existe/i);
});

test('Duplicidade: erro que NÃO é 404 (ex.: 5xx/403/rede) aborta em vez de assumir "não existe"', () => {
  // Regressão do bug corrigido em fs_criarUnidade: antes, qualquer erro na
  // checagem (não só 404) era tratado como "unidade livre" e o patch (sem
  // updateMask) sobrescrevia uma unidade existente, apagando seus campos.
  [500, 503, 403, 429].forEach(function (code) {
    const r = podeCriar({ httpCode: code });
    assert.equal(r.podeCriar, false, 'HTTP ' + code + ' deveria abortar, não criar');
  });
});

test('Login do 1º chefe: usa a parte local do e-mail quando ela normaliza para algo', () => {
  assert.equal(loginParaUnidade('joao.silva@cp2.g12.br', 'TJ1', 'tijuca-i'), 'joaosilva');
});

test('Login do 1º chefe: cai para a sigla quando a parte local do e-mail fica vazia', () => {
  assert.equal(loginParaUnidade('...@cp2.g12.br', 'TJ1', 'tijuca-i'), 'tj1');
});

test('Login do 1º chefe: cai para "gestor-<id>" quando e-mail e sigla normalizam para vazio', () => {
  assert.equal(loginParaUnidade('...@cp2.g12.br', '---', 'tijuca-i'), 'gestor-tijuca-i');
});

test('Senha temporária: 7 caracteres, sem ambíguos (sem 0/O, 1/I/L)', () => {
  for (let i = 0; i < 200; i++) {
    const senha = gerarSenhaTemp();
    assert.equal(senha.length, 7);
    assert.match(senha, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/);
  }
});
