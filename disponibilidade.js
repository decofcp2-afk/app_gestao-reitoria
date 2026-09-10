// Agenda interna: leitura autenticada; escrita somente pela chefia.
var AUS = { periodos: [], revisao: 0 }, AUS_UNIDADE = '', AUS_EDIT = -1, AUS_SEQ = 0;
var AUS_SALVANDO = false, AUS_CARREGANDO = false, AUS_CARREGADO_EM = 0, AUS_TIMEOUT = null, AUS_ABRIDOR = null;

function ausEscopo_() { return AUTH_TOKEN + ':' + ((window.AppselFirestore && window.AppselFirestore.unidadeAtual()) || 'reitoria-sel'); }
function ausHoje_() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
function ausDataBr_(data) { return data ? data.split('-').reverse().join('/') : ''; }
function ausAtual_(nome) {
  if (AUS_UNIDADE !== ausEscopo_() || !Array.isArray(AUS.periodos)) return null;
  var s = SERV_DATA.find(function(s) { return _mesmoServ_(s.nome, nome); });
  var hoje = ausHoje_();
  return s && AUS.periodos.find(function(a) { return a.matricula === String(s.matricula) && a.inicio <= hoje && (!a.fim || a.fim >= hoje); });
}
function ausRotulo_(a) { return (a.tipo === 'ferias' ? 'Férias' : 'Afastamento') + (a.fim ? ' até ' + ausDataBr_(a.fim) : ' · sem previsão de retorno'); }
function ausDuracao_(a) {
  if (!a.fim) return 'Duração em aberto';
  var inicio = new Date(a.inicio + 'T12:00:00Z'), fim = new Date(a.fim + 'T12:00:00Z');
  var dias = Math.round((fim - inicio) / 86400000) + 1;
  return dias + ' dia' + (dias === 1 ? '' : 's');
}
function ausNormalizarResposta_(d) {
  d = d || {};
  var periodos = d.periodos;
  var incompativel = !!d.incompativel;
  if (typeof periodos === 'string') {
    try { periodos = JSON.parse(periodos); }
    catch (e) { periodos = []; incompativel = true; }
  }
  if (!Array.isArray(periodos)) { periodos = []; incompativel = true; }
  return { ok: d.ok !== false, revisao: Number(d.revisao) || 0, periodos: periodos,
    pendente: !!d.pendente, incompativel: incompativel, erro: d.erro || '' };
}
function ausSetSync_(texto, classe) {
  var el = document.getElementById('aus-sync');
  if (!el) return;
  el.className = 'aus-sync' + (classe ? ' ' + classe : '');
  el.textContent = texto || '';
}
function ausRenderCarregando_() {
  var el = document.getElementById('aus-lista');
  if (!el || (AUS_UNIDADE === ausEscopo_() && Array.isArray(AUS.periodos) && AUS_CARREGADO_EM)) return;
  el.innerHTML = '<div class="aus-skeleton" aria-label="Carregando agenda"><span></span><span></span><span></span></div>';
  ausSetSync_('Atualizando agenda…', 'is-loading');
}
function ausErroCarregamento_(e) {
  AUS_CARREGANDO = false;
  clearTimeout(AUS_TIMEOUT);
  var msg = (e && e.message) || 'Não foi possível carregar a agenda.';
  ausSetSync_('Falha ao atualizar', 'is-error');
  var erro = document.getElementById('aus-erro');
  if (erro) erro.innerHTML = '<div class="aus-alert is-error"><b>A agenda demorou mais que o esperado.</b>'
    + '<span>' + esc(msg) + '</span><button class="btn-cfg" onclick="carregarAusencias_({force:true})">Tentar novamente</button></div>';
  if (AUS_UNIDADE !== ausEscopo_() || !AUS_CARREGADO_EM) {
    var lista = document.getElementById('aus-lista');
    if (lista) lista.innerHTML = '<div class="aus-empty"><b>Não foi possível exibir os períodos.</b><span>Use “Tentar novamente” para refazer a consulta.</span></div>';
  }
}
function carregarAusencias_(opts) {
  opts = opts || {};
  var token = AUTH_TOKEN, escopo = ausEscopo_();
  var temCache = AUS_UNIDADE === escopo && Array.isArray(AUS.periodos) && AUS_CARREGADO_EM > 0;
  if (temCache) {
    renderAusencias_();
    if (!opts.force && Date.now() - AUS_CARREGADO_EM < 90000) return;
  } else if (!opts.silencioso) {
    ausRenderCarregando_();
  }
  if (AUS_CARREGANDO && !opts.force) return;
  var seq = ++AUS_SEQ;
  AUS_CARREGANDO = true;
  clearTimeout(AUS_TIMEOUT);
  ausSetSync_(temCache ? 'Verificando atualizações…' : 'Atualizando agenda…', 'is-loading');
  AUS_TIMEOUT = setTimeout(function() {
    if (seq === AUS_SEQ && AUS_CARREGANDO) ausErroCarregamento_(new Error('A resposta está levando muito tempo. Os dados já carregados continuam disponíveis.'));
  }, 12000);
  google.script.run.withSuccessHandler(function(d) {
    if (ausEscopo_() !== escopo || seq !== AUS_SEQ) return;
    AUS_CARREGANDO = false;
    clearTimeout(AUS_TIMEOUT);
    d = ausNormalizarResposta_(d);
    if (!d.ok) { ausErroCarregamento_(new Error(d.erro || 'Não foi possível carregar a agenda.')); return; }
    AUS = d; AUS_UNIDADE = escopo; AUS_CARREGADO_EM = Date.now();
    renderAusencias_();
    if (CAP_DATA) renderCapacidade_();
  }).withFailureHandler(function(e) {
    if (seq === AUS_SEQ) ausErroCarregamento_(e);
  }).getDisponibilidadeApp(token);
}

function abrirAusencias_() {
  AUS_ABRIDOR = document.activeElement;
  if (!document.getElementById('aus-modal')) {
    var el = document.createElement('div');
    el.id = 'aus-modal'; el.className = 'overlay open aus-overlay';
    el.onclick = function(ev) { if (ev.target === el) ausFechar_(); };
    el.innerHTML = '<section class="aus-dialog" role="dialog" aria-modal="true" aria-labelledby="aus-title">'
      + '<header class="aus-dialog-head"><div><span class="aus-eyebrow">Planejamento da equipe</span>'
      + '<h2 id="aus-title">Férias e afastamentos</h2><p>Organize os períodos da equipe. As datas incluem o primeiro e o último dia informados.</p></div>'
      + '<button class="aus-close" type="button" aria-label="Fechar" onclick="ausFechar_()">×</button></header>'
      + '<div class="aus-sync-row"><span id="aus-sync" class="aus-sync" aria-live="polite"></span></div>'
      + '<div id="aus-erro" role="alert"></div><div class="aus-layout"><main id="aus-lista"></main><aside id="aus-form" class="aus-form-panel"></aside></div>'
      + '</section>';
    document.body.appendChild(el);
  }
  if (AUS_UNIDADE === ausEscopo_() && AUS_CARREGADO_EM) renderAusencias_();
  else ausRenderCarregando_();
  carregarAusencias_();
  setTimeout(function() { var close = document.querySelector('#aus-modal .aus-close'); if (close) close.focus(); }, 0);
}
function ausFechar_() {
  var modal = document.getElementById('aus-modal');
  if (modal) modal.remove();
  if (AUS_ABRIDOR && AUS_ABRIDOR.focus) AUS_ABRIDOR.focus();
}
function ausItemHtml_(a, i, estado, chefe) {
  var s = SERV_DATA.find(function(s) { return String(s.matricula) === String(a.matricula); });
  var nome = s ? s.nome : 'Servidor fora da equipe';
  var tipo = a.tipo === 'ferias' ? 'Férias' : 'Afastamento';
  var periodo = a.fim ? ausDataBr_(a.inicio) + ' a ' + ausDataBr_(a.fim) : 'Desde ' + ausDataBr_(a.inicio) + ' · sem previsão de retorno';
  var classe = estado === 'Em curso' ? 'is-current' : estado === 'Programado' ? 'is-upcoming' : 'is-past';
  return '<article class="aus-item ' + classe + '"><div class="aus-item-main"><div class="aus-item-top">'
    + '<strong>' + esc(nome) + '</strong><span class="aus-type">' + esc(tipo) + '</span><span class="aus-state">' + esc(estado) + '</span></div>'
    + '<div class="aus-dates">' + esc(periodo) + '</div><small>' + esc(ausDuracao_(a)) + '</small></div>'
    + (chefe && s ? '<div class="aus-item-actions"><button class="btn-cfg" onclick="ausEditar_(' + i + ')">Editar</button>'
      + '<button class="aus-link-danger" onclick="ausCancelar_(' + i + ')">Cancelar</button></div>' : '') + '</article>';
}
function ausGrupoHtml_(titulo, itens, chefe, vazio) {
  var html = '<section class="aus-group"><div class="aus-group-head"><h3>' + esc(titulo) + '</h3><span>' + itens.length + '</span></div>';
  if (!itens.length) html += '<div class="aus-group-empty">' + esc(vazio) + '</div>';
  else html += itens.map(function(x) { return ausItemHtml_(x.a, x.i, x.estado, chefe); }).join('');
  return html + '</section>';
}
function ausRenderAside_() {
  var form = document.getElementById('aus-form'); if (!form) return;
  if (!isChefeAtual_()) {
    form.innerHTML = '<div class="aus-aside-copy"><h3>Consulta da equipe</h3><p>Os períodos são administrados pela chefia da unidade.</p></div>';
    return;
  }
  form.innerHTML = '<div class="aus-aside-copy"><h3>Planeje com antecedência</h3>'
    + '<p>Registre férias e afastamentos para que a capacidade interna e o painel público considerem quantas pessoas estarão disponíveis em cada período.</p></div>'
    + '<button class="btn-prim aus-add" onclick="ausEditar_(-1)">Registrar período</button>';
}
function renderAusencias_() {
  var el = document.getElementById('aus-lista'); if (!el) return;
  var erro = document.getElementById('aus-erro'); if (erro) erro.innerHTML = '';
  var chefe = isChefeAtual_(), hoje = ausHoje_();
  var periodos = Array.isArray(AUS.periodos) ? AUS.periodos : [];
  var atuais = [], futuros = [], passados = [];
  periodos.forEach(function(a, i) {
    var estado = a.inicio > hoje ? 'Programado' : a.fim && a.fim < hoje ? 'Encerrado' : 'Em curso';
    var item = { a: a, i: i, estado: estado };
    if (estado === 'Em curso') atuais.push(item); else if (estado === 'Programado') futuros.push(item); else passados.push(item);
  });
  futuros.sort(function(a,b){ return a.a.inicio.localeCompare(b.a.inicio); });
  passados.sort(function(a,b){ return b.a.inicio.localeCompare(a.a.inicio); });
  var disponiveis = Math.max(0, SERV_DATA.length - atuais.length);
  var resumoDisponiveis = AUS.incompativel ? '—' : disponiveis + ' de ' + SERV_DATA.length;
  var avisos = '';
  if (AUS.incompativel) avisos += '<div class="aus-alert is-error"><b>Um período antigo precisa ser recadastrado.</b>'
    + '<span>A versão anterior salvou esse registro em formato incompatível. Registre o período novamente para reparar a agenda e o KPI.</span></div>';
  if (AUS.pendente) avisos += '<div class="aus-alert is-warning"><b>Sincronização do painel pendente.</b><span>A agenda foi salva, mas o resumo público ainda não foi atualizado.</span>'
    + (chefe && !AUS.incompativel ? '<button class="btn-cfg" onclick="ausRepublicar_()">Tentar sincronizar</button>' : '') + '</div>';
  if (erro) erro.innerHTML = avisos;
  el.innerHTML = '<div class="aus-summary" aria-label="Resumo da disponibilidade"><div><span>Disponíveis hoje</span><b>' + resumoDisponiveis + '</b></div>'
    + '<div><span>Ausentes hoje</span><b>' + (AUS.incompativel ? '—' : atuais.length) + '</b></div><div><span>Próximos períodos</span><b>' + futuros.length + '</b></div></div>'
    + ausGrupoHtml_('Em curso', atuais, chefe, 'Toda a equipe está disponível hoje.')
    + ausGrupoHtml_('Programados', futuros, chefe, 'Nenhum período futuro registrado.')
    + (passados.length ? ausGrupoHtml_('Encerrados', passados, chefe, '') : '');
  ausSetSync_('Atualizado agora', 'is-ok');
  ausRenderAside_();
}

function ausEditar_(i) {
  if (!isChefeAtual_()) return;
  AUS_EDIT = i;
  var a = AUS.periodos[i] || { inicio: ausHoje_(), fim: '', tipo: 'ferias', matricula: '' };
  var form = document.getElementById('aus-form'); if (!form) return;
  form.innerHTML = '<form onsubmit="event.preventDefault();ausSalvar_()"><div class="aus-form-head"><span>' + (i < 0 ? 'Novo registro' : 'Editar registro') + '</span>'
    + '<h3>' + (i < 0 ? 'Registrar período' : 'Atualizar período') + '</h3></div>'
    + '<label><span>Servidor</span><select class="field-input" id="aus-serv" required>' + SERV_DATA.map(function(s) { return '<option value="'+esc(s.matricula)+'" '+(String(s.matricula)===String(a.matricula)?'selected':'')+'>'+esc(s.nome)+'</option>'; }).join('') + '</select></label>'
    + '<label><span>Tipo</span><select class="field-input" id="aus-tipo" onchange="ausTipoMudou_()"><option value="ferias">Férias</option><option value="afastamento" '+(a.tipo==='afastamento'?'selected':'')+'>Afastamento</option></select></label>'
    + '<div class="aus-date-grid"><label><span>Primeiro dia</span><input class="field-input" id="aus-inicio" type="date" required value="'+esc(a.inicio)+'"></label>'
    + '<label><span id="aus-fim-label">Último dia</span><input class="field-input" id="aus-fim" type="date" value="'+esc(a.fim)+'"></label></div>'
    + '<p class="aus-form-help" id="aus-form-help"></p><div class="aus-form-actions"><button class="btn-prim" id="aus-save" type="submit">Salvar período</button>'
    + '<button class="btn-sec" type="button" onclick="renderAusencias_()">Cancelar</button></div></form>';
  ausTipoMudou_();
  var serv = document.getElementById('aus-serv'); if (serv) serv.focus();
}
function ausTipoMudou_() {
  var tipo = document.getElementById('aus-tipo'), fim = document.getElementById('aus-fim');
  var label = document.getElementById('aus-fim-label'), help = document.getElementById('aus-form-help');
  if (!tipo || !fim) return;
  var ferias = tipo.value === 'ferias';
  fim.required = ferias;
  if (label) label.textContent = ferias ? 'Último dia' : 'Último dia (opcional)';
  if (help) help.textContent = ferias ? 'Nas férias, informe o período completo.' : 'Deixe o último dia vazio quando ainda não houver previsão de retorno.';
}
function ausSalvar_() {
  var a = { matricula: document.getElementById('aus-serv').value, tipo: document.getElementById('aus-tipo').value,
    inicio: document.getElementById('aus-inicio').value, fim: document.getElementById('aus-fim').value };
  if (!a.inicio || (a.tipo === 'ferias' && !a.fim) || (a.fim && a.fim < a.inicio)) { toast('Verifique as datas do período.', 'err'); return; }
  var lista = AUS.periodos.slice(); if (AUS_EDIT < 0) lista.push(a); else lista[AUS_EDIT] = a;
  ausPersistir_(lista);
}
function ausCancelar_(i) {
  var form = document.getElementById('aus-form'); if (!form) return;
  var a = AUS.periodos[i] || {}, s = SERV_DATA.find(function(x){ return String(x.matricula) === String(a.matricula); });
  form.innerHTML = '<div class="aus-confirm"><span>Cancelar período</span><h3>' + esc(s ? s.nome : 'Servidor') + '</h3>'
    + '<p>O período será retirado da agenda ativa. O histórico da alteração será preservado.</p><div class="aus-form-actions">'
    + '<button class="btn-prim" onclick="ausPersistir_(AUS.periodos.filter(function(a,j){return j!=='+i+';}))">Confirmar cancelamento</button>'
    + '<button class="btn-sec" onclick="renderAusencias_()">Voltar</button></div></div>';
}
function ausErro_(e) {
  AUS_SALVANDO = false;
  var btn = document.getElementById('aus-save'); if (btn) { btn.disabled = false; btn.textContent = 'Salvar período'; }
  var el = document.getElementById('aus-erro'); if (el) el.innerHTML = '<div class="aus-alert is-error"><b>Não foi possível salvar.</b><span>'
    + esc((e && e.message) || 'Recarregue a agenda e tente novamente.') + '</span></div>';
  ausSetSync_('Falha ao salvar', 'is-error');
  toast((e && e.message) || 'Erro ao salvar.', 'err');
}
function ausReceber_(d) {
  AUS_SALVANDO = false;
  d = ausNormalizarResposta_(d);
  if (!d.ok) { ausErro_(new Error(d.erro || 'Não foi possível salvar.')); return; }
  AUS = d; AUS_UNIDADE = ausEscopo_(); AUS_CARREGADO_EM = Date.now();
  renderAusencias_(); if (CAP_DATA) renderCapacidade_();
  toast(d.pendente ? 'Salvo. Sincronização do painel pendente.' : 'Disponibilidade atualizada.', d.pendente ? 'err' : 'ok');
}
function ausPersistir_(lista) {
  if (!isChefeAtual_() || AUS_UNIDADE !== ausEscopo_() || AUS_SALVANDO) return;
  AUS_SALVANDO = true;
  var escopo = ausEscopo_(), btn = document.getElementById('aus-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
  ausSetSync_('Salvando período…', 'is-loading');
  google.script.run.withSuccessHandler(function(d) { AUS_SALVANDO = false; if (ausEscopo_() === escopo) ausReceber_(d); })
    .withFailureHandler(ausErro_).salvarDisponibilidadeApp(lista, AUS.revisao, AUTH_TOKEN);
}
function ausRepublicar_() {
  var escopo = ausEscopo_(); ausSetSync_('Sincronizando painel…', 'is-loading');
  google.script.run.withSuccessHandler(function(d) { if (ausEscopo_() === escopo) ausReceber_(d); })
    .withFailureHandler(ausErro_).republicarDisponibilidadeApp(AUTH_TOKEN);
}

// Atualização de data também funciona em abas mantidas abertas durante a noite.
var AUS_DIA = ausHoje_();
setInterval(function() { var hoje = ausHoje_(); if (hoje !== AUS_DIA) { AUS_DIA = hoje; if (AUTH_TOKEN) carregarAusencias_({ force:true, silencioso:true }); } }, 60000);
if (typeof AUTH_TOKEN !== 'undefined' && AUTH_TOKEN) setTimeout(function(){ carregarAusencias_({ silencioso:true }); }, 0);
