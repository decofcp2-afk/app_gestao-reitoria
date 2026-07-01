'use strict';
// ════════════════════════════════════════════════════════════════════════
// Trava multiunidade em `_authGetSession_` (apps-script/Code.gs).
//
// A unidade "ativa" numa requisição vem de localStorage no CLIENTE (ver
// callApi() em index.html), não é amarrada ao token de sessão. Antes desta
// trava, `_authGetSession_` resolvia o usuário buscando a matrícula da sessão
// na lista de usuários da unidade DA REQUISIÇÃO ATUAL — não da unidade onde o
// login realmente aconteceu. Trocar de unidade sem deslogar (localStorage
// manual, ou um seletor de unidade reativado no futuro) reaproveitava o mesmo
// token contra o roster de OUTRA unidade: sem colisão de matrícula a sessão
// simplesmente caía ("Usuário removido da equipe"), mas COM colisão a pessoa
// passava a operar como o usuário homônimo de lá — inclusive com o nível de
// acesso (chefe/comum) dessa outra pessoa, sem novo login.
//
// _authGetSession_ fala com PropertiesService e não é carregável aqui. Este
// arquivo espelha só a regra de decisão adicionada: comparar sess.unidade
// (gravada no login) com a unidade da requisição atual.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');

// Espelho do trecho novo de _authGetSession_: decide se a sessão pode ser
// usada para a unidade da requisição atual, ou se deve ser invalidada.
function checarUnidadeDaSessao(sess, unidadeReq, isAdminSess) {
  if (isAdminSess) return { ok: true }; // admin geral não é escopado por unidade
  if (sess.unidade && sess.unidade !== unidadeReq) {
    return { ok: false, erro: 'Sessão de outra unidade. Faça login novamente.' };
  }
  return { ok: true };
}

test('Sessão criada na mesma unidade da requisição é aceita normalmente', () => {
  const sess = { matricula: 'anasilva', unidade: 'tijuca-i' };
  const r = checarUnidadeDaSessao(sess, 'tijuca-i', false);
  assert.equal(r.ok, true);
});

test('Regressão: sessão de uma unidade não pode ser reaproveitada em outra unidade', () => {
  // Cenário do relato: login em "tijuca-i", troca de unidade sem deslogar
  // (localStorage muda para "humaita-i") — mesmo que exista uma matrícula
  // "anasilva" nas duas unidades, a sessão da Tijuca não pode logar como a
  // Ana Silva de Humaitá.
  const sessDaTijuca = { matricula: 'anasilva', unidade: 'tijuca-i' };
  const r = checarUnidadeDaSessao(sessDaTijuca, 'humaita-i', false);
  assert.equal(r.ok, false);
  assert.match(r.erro, /outra unidade/i);
  assert.match(r.erro, /fa(ç|c)a login novamente/i, 'precisa disparar o guardiao de sessao do cliente');
});

test('Admin geral não é escopado por unidade: pode transitar entre unidades', () => {
  const sessAdmin = { matricula: 'admin', unidade: 'tijuca-i' };
  const r = checarUnidadeDaSessao(sessAdmin, 'humaita-i', true);
  assert.equal(r.ok, true);
});

test('Sessão sem unidade gravada (formato antigo) não quebra — trava só age quando há valor pra comparar', () => {
  const sessAntiga = { matricula: 'anasilva' }; // sem campo `unidade`
  const r = checarUnidadeDaSessao(sessAntiga, 'humaita-i', false);
  assert.equal(r.ok, true);
});
