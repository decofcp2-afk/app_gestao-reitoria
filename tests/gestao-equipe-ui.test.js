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

test('ação de voltar processo para a fila fica compacta junto ao título', () => {
  const footer = html.match(/<div class="sheet-footer" id="proc-footer"[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(footer);
  assert.doesNotMatch(footer[0], /id="btn-voltar-fila"/);
  assert.match(html, /class="proc-title-line"[\s\S]*?id="btn-voltar-fila" class="proc-return-btn"/);
  assert.match(html, /podeVoltarFila = isChefeAtual_\(\) && p\.status !== 'ok'/);
  assert.match(html, /\.proc-return-btn \{[^}]*padding:4px 8px;[^}]*font-size:10px/);
});

test('tour explica as novas funções de atas, avisos e planejamento da equipe', () => {
  assert.match(html, /t:'Gestão de Atas'/);
  assert.match(html, /t:'Consultar o Compras\.gov\.br'/);
  assert.match(html, /integração é <b>somente leitura<\/b>/);
  assert.match(html, /marcos de <b>90, 60 e 30 dias<\/b>/);
  assert.match(html, /t:'Planejamento da equipe'/);
});

test('novidades aparecem uma vez por usuário e versão e oferecem o tour atualizado', () => {
  assert.match(html, /id="novidades-modal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /var APP_RELEASE_VERSION = '2026\.09\.13-5'/);
  assert.match(html, /localStorage\.getItem\(_novidadesKey_\(\)\) === APP_RELEASE_VERSION/);
  assert.match(html, /localStorage\.setItem\(_novidadesKey_\(\), APP_RELEASE_VERSION\)/);
  assert.match(html, /fecharNovidades_\(true\)[^>]*>Ver tour atualizado<\/button>/);
  assert.match(html, /setTimeout\(function\(\)\{ try \{ maybeMostrarNovidades_\(\);/);
});

test('tour explica para quem são enviados os avisos de atas', () => {
  assert.match(html, /chefia recebe um resumo mensal/);
  assert.match(html, /cada responsável recebe os marcos/);
  assert.match(html, /Sem e-mail cadastrado, o aviso continua disponível no sino/);
});

test('responsável de outro setor não é cadastrado como membro da equipe', () => {
  const atas = fs.readFileSync(path.join(root, 'atas.js'), 'utf8');
  assert.match(html, /id="ata-responsavel-tipo"/);
  assert.match(html, /id="ata-responsavel-setor"/);
  assert.match(html, /id="ata-responsavel-email"[^>]*type="email"/);
  assert.match(atas, /responsavelTipo:val\('ata-responsavel-tipo'\)/);
  assert.doesNotMatch(html, /ata-responsavel-email[^>]*g12\.br/);
  assert.match(code, /onMonthDay\(1\)/);
  assert.match(code, /enviarResumoMensalAtasChefiaTodasUnidades/);
  assert.match(code, /temProximos && temVencidos && temAtasResponsaveis && temAtasChefiaMensal/);
});

test('pesquisa de atas preserva foco e cursor durante a filtragem', () => {
  const atas = fs.readFileSync(path.join(root, 'atas.js'), 'utf8');
  assert.match(atas, /oninput="buscarAtas_\(this\)"/);
  assert.match(atas, /var pos=input\.selectionStart, fim=input\.selectionEnd/);
  assert.match(atas, /novo\.focus\(\)/);
  assert.match(atas, /novo\.setSelectionRange\(pos,fim\)/);
});

test('gestão de atas distingue UASG de origem da unidade responsável', () => {
  const atas = fs.readFileSync(path.join(root, 'atas.js'), 'utf8');
  assert.match(html, /id="ata-uasg" value="153167"/);
  assert.match(atas, /id="ata-f-uasg"/);
  assert.match(atas, /uasg:uasg,numeroCompra/);
  assert.match(atas, /Selecione apenas as que ficarão sob controle desta unidade/);
  assert.doesNotMatch(atas, /consultarAtasComprasApp\(\{uasg:'153167'/);
});
