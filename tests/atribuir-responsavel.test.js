'use strict';
// ════════════════════════════════════════════════════════════════════════
// Regressão: no modal "Responsável pelo processo", o servidor já atribuído
// NÃO aparecia marcado em unidades novas (aparecia normal nas antigas).
//
// Causa: o responsável do processo (p.servidor) vem em Title Case do
// construir/_fsNomeServ_ (ex.: "Amanda2", "Samuel"), enquanto a lista de
// servidores guarda o nome como foi DIGITADO (ex.: "amanda2", "SAMUEL"). A
// marcação usava "===" cru (sensível a caixa/acento), então só casava quando o
// nome do servidor já estava exatamente em Title Case — o caso das unidades
// antigas (Reitoria: "Bruno", "Samuel"). Nas unidades novas, com nomes
// digitados em minúsculo/maiúsculo, nada aparecia selecionado.
//
// Fix: comparar por _mesmoServ_ (index.html) — normaliza caixa e acento. Este
// arquivo espelha essa regra pura como guarda de regressão.
// ════════════════════════════════════════════════════════════════════════
const test = require('node:test');
const assert = require('node:assert/strict');

// Espelho de _mesmoServ_ (index.html): compara nome de servidor ignorando
// caixa e acentos.
function mesmoServ(a, b) {
  var na = String(a == null ? '' : a).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  var nb = String(b == null ? '' : b).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return na === nb;
}

test('Regressão: responsável Title Case casa com servidor digitado em minúsculo', () => {
  // p.servidor = "Amanda2" (do construir); lista de servidores tem "amanda2".
  assert.equal(mesmoServ('Amanda2', 'amanda2'), true);
});

test('Regressão: responsável casa com servidor digitado em MAIÚSCULO', () => {
  assert.equal(mesmoServ('Samuel', 'SAMUEL'), true);
});

test('Acento não impede o casamento (José ~ JOSE)', () => {
  assert.equal(mesmoServ('José', 'JOSE'), true);
  assert.equal(mesmoServ('João Pedro', 'joao pedro'), true);
});

test('Servidores diferentes não casam (não marca o errado)', () => {
  assert.equal(mesmoServ('Bruno', 'Beatriz'), false);
});

test('Responsável preenchido NÃO casa com a opção "Nenhum" (string vazia)', () => {
  // Evita marcar "Nenhum" quando há responsável atribuído.
  assert.equal(mesmoServ('Amanda2', ''), false);
});

test('Sem responsável (vazio) casa com "Nenhum" (vazio)', () => {
  assert.equal(mesmoServ('', ''), true);
  assert.equal(mesmoServ(null, ''), true);
});
