const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');

test('notificações de processos mostram somente próximos e vencidos', () => {
  assert.match(html, /id="notif-tab-venc"[^>]*>\s*Vencidos/);
  assert.match(html, /id="notif-tab-prox"[^>]*>\s*Prazos próximos/);
  assert.doesNotMatch(html, /id="notif-tab-pont"/);
  assert.match(html, /NOTIF\.prox\.length \+ NOTIF\.venc\.length \+ nAtas/);
});

test('e-mail faz parte do formulário do servidor e a lista duplicada foi removida', () => {
  const matricula = html.indexOf('id="edit-serv-mat"');
  const email = html.indexOf('id="edit-serv-email"');
  assert.ok(matricula >= 0 && email > matricula);
  assert.doesNotMatch(html, /id="cfg-emails-card"/);
  assert.match(html, /id="cfg-planejamento-card"/);
});

test('backend salva o e-mail antes de criar o primeiro acesso', () => {
  const salvarEmail = code.indexOf("props.setProperty(_emailKey_(s.nome), s.email)");
  const criarAcesso = code.indexOf('_authSyncServidores_(listaPersistida, criados)');
  assert.ok(salvarEmail >= 0 && criarAcesso > salvarEmail);
});

test('automação de avisos aparece somente como modal obrigatório quando ausente', () => {
  assert.match(html, /id="trigger-required-card"[^>]*role="alertdialog"[^>]*aria-modal="true"/);
  const modal = html.match(/<section id="trigger-required-card"[\s\S]*?<\/section>/);
  assert.ok(modal);
  assert.doesNotMatch(modal[0], /fechar|onclick="[^\"]*close/i);
  assert.doesNotMatch(html, /<h3>Automação de avisos<\/h3>/);
  assert.match(html, /classList\.toggle\('open', podeInstalar\)/);
  assert.match(html, /if \(instalado\)[\s\S]*?classList\.remove\('open'\)/);
  assert.match(html, /withFailureHandler\(function\(e\) \{\s*aplicarTriggerStatus_\(\{ instalado: null/);
});

test('menu principal evita destinos duplicados no desktop', () => {
  const css = fs.readFileSync(path.join(root, 'atas.css'), 'utf8');
  assert.doesNotMatch(html, /id="desktop-equipe"/);
  assert.match(html, /id="desktop-visaogeral"[^>]*>Visão Geral<\/button>/);
  assert.match(html, /id="desktop-tour"[^>]*>Tour de ajuda<\/button>/);
  assert.match(html, /hdr-menu-item hdr-menu-main-link/);
  assert.match(css, /@media\(min-width:1120px\)\{\.atas-desktop-nav\{display:flex\}\.hdr-menu-main-link,\.hdr-menu-main-sep\{display:none\}\}/);
  assert.match(html, /'hdr-visaogeral-item', 'hdr-visaogeral-sep', 'desktop-visaogeral'/);
});
