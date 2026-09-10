// Agenda interna: leitura autenticada; escrita somente pela chefia.
var AUS = { periodos: [], revisao: 0 }, AUS_UNIDADE = '', AUS_EDIT = -1, AUS_SEQ = 0, AUS_SALVANDO = false;
function ausEscopo_() { return AUTH_TOKEN + ':' + ((window.AppselFirestore && window.AppselFirestore.unidadeAtual()) || 'reitoria-sel'); }
function ausHoje_() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date()); }
function ausAtual_(nome) {
  if (AUS_UNIDADE !== ausEscopo_()) return null;
  var s = SERV_DATA.find(function(s) { return _mesmoServ_(s.nome, nome); });
  var hoje = ausHoje_();
  return s && AUS.periodos.find(function(a) { return a.matricula === String(s.matricula) && a.inicio <= hoje && (!a.fim || a.fim >= hoje); });
}
function ausRotulo_(a) { return (a.tipo === 'ferias' ? 'Férias' : 'Afastamento') + (a.fim ? ' até ' + a.fim.split('-').reverse().join('/') : ' · sem previsão de retorno'); }
function carregarAusencias_() {
  AUS = { periodos: [], revisao: 0 }; AUS_UNIDADE = '';
  var token = AUTH_TOKEN, escopo = ausEscopo_(), seq = ++AUS_SEQ;
  google.script.run.withSuccessHandler(function(d) {
    if (ausEscopo_() !== escopo || seq !== AUS_SEQ) return;
    if (!d || !d.ok) { ausErro_(new Error((d && d.erro) || 'Não foi possível carregar a agenda.')); return; }
    AUS = d; AUS_UNIDADE = escopo; renderAusencias_();
    if (CAP_DATA) renderCapacidade_();
  }).withFailureHandler(function() {
    var el = document.getElementById('aus-lista');
    if (el) el.textContent = 'Não foi possível carregar a agenda. Recarregue antes de editar.';
  }).getDisponibilidadeApp(token);
}
function abrirAusencias_() {
  if (!document.getElementById('aus-modal')) {
    var el = document.createElement('div'); el.id = 'aus-modal'; el.className = 'overlay open';
    el.style.cssText = 'z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
    el.innerHTML = '<section role="dialog" aria-modal="true" aria-label="Disponibilidade da equipe" style="background:var(--surface,#fff);color:var(--text);padding:20px;border-radius:16px;width:560px;max-width:100%;max-height:90vh;overflow:auto">'
      + '<h2 style="font-size:18px">Disponibilidade da equipe</h2><p style="font-size:12px">Programe férias e afastamentos. O período inclui o último dia informado.</p>'
      + '<p id="aus-erro" role="alert"></p><div id="aus-lista">Carregando…</div><div id="aus-form"></div>'
      + '<button class="btn-sec" onclick="document.getElementById(\'aus-modal\').remove()">Fechar</button></section>';
    document.body.appendChild(el);
  }
  carregarAusencias_();
}
function renderAusencias_() {
  var el = document.getElementById('aus-lista'); if (!el) return;
  document.getElementById('aus-erro').textContent = '';
  var chefe = isChefeAtual_(), hoje = ausHoje_();
  el.innerHTML = (AUS.pendente ? '<p role="alert">Agenda salva, mas o painel ainda não foi sincronizado.</p>' + (chefe ? '<button class="btn-cfg" onclick="ausRepublicar_()">Tentar sincronizar</button>' : '') : '')
    + AUS.periodos.map(function(a,i) {
      var s = SERV_DATA.find(function(s) { return String(s.matricula) === a.matricula; });
      var estado = a.inicio > hoje ? 'Programado' : a.fim && a.fim < hoje ? 'Encerrado' : 'Em curso';
      return '<div style="padding:12px 0;border-bottom:1px solid var(--border)"><b>' + esc(s ? s.nome : 'Servidor fora da equipe') + '</b> · ' + esc(estado)
        + '<div>' + esc(a.inicio.split('-').reverse().join('/')) + ' — ' + esc(ausRotulo_(a)) + '</div>'
        + (chefe && s ? '<button class="btn-cfg" onclick="ausEditar_('+i+')">Editar / encerrar</button> <button class="btn-sec" onclick="ausCancelar_('+i+')">Cancelar período</button>' : '') + '</div>';
    }).join('') + (!AUS.periodos.length ? '<p>Nenhuma ausência registrada.</p>' : '')
    + (chefe ? '<p><button class="btn-cfg" onclick="ausEditar_(-1)">Registrar ausência</button></p>' : '');
  document.getElementById('aus-form').innerHTML = '';
}
function ausEditar_(i) {
  if (!isChefeAtual_()) return;
  AUS_EDIT = i;
  var a = AUS.periodos[i] || { inicio: ausHoje_(), fim: '', tipo: 'ferias', matricula: '' };
  document.getElementById('aus-form').innerHTML = '<form onsubmit="event.preventDefault();ausSalvar_()" style="display:grid;gap:10px;margin:16px 0">'
    + '<label>Servidor<select class="field-input" id="aus-serv" required>' + SERV_DATA.map(function(s) { return '<option value="'+esc(s.matricula)+'" '+(String(s.matricula)===a.matricula?'selected':'')+'>'+esc(s.nome)+'</option>'; }).join('') + '</select></label>'
    + '<label>Tipo<select class="field-input" id="aus-tipo"><option value="ferias">Férias</option><option value="afastamento" '+(a.tipo==='afastamento'?'selected':'')+'>Afastamento</option></select></label>'
    + '<label>Primeiro dia<input class="field-input" id="aus-inicio" type="date" required value="'+esc(a.inicio)+'"></label>'
    + '<label>Último dia (opcional para afastamento)<input class="field-input" id="aus-fim" type="date" value="'+esc(a.fim)+'"></label>'
    + '<button class="btn-prim" id="aus-save" type="submit">Salvar período</button></form>';
}
function ausSalvar_() {
  var a = { matricula: document.getElementById('aus-serv').value, tipo: document.getElementById('aus-tipo').value, inicio: document.getElementById('aus-inicio').value, fim: document.getElementById('aus-fim').value };
  if (!a.inicio || (a.tipo === 'ferias' && !a.fim) || (a.fim && a.fim < a.inicio)) { toast('Verifique as datas do período.', 'err'); return; }
  var lista = AUS.periodos.slice(); if (AUS_EDIT < 0) lista.push(a); else lista[AUS_EDIT] = a;
  ausPersistir_(lista);
}
function ausCancelar_(i) {
  var form = document.getElementById('aus-form');
  form.innerHTML = '<p>Cancelar este período? O histórico será preservado.</p><button class="btn-sec" onclick="renderAusencias_()">Voltar</button> <button class="btn-prim" onclick="ausPersistir_(AUS.periodos.filter(function(a,j){return j!=='+i+';}))">Confirmar cancelamento</button>';
}
function ausErro_(e) {
  AUS_SALVANDO = false;
  var btn = document.getElementById('aus-save'); if (btn) btn.disabled = false;
  var el = document.getElementById('aus-erro'); if (el) el.textContent = (e && e.message) || 'Não foi possível salvar. Recarregue a agenda e tente novamente.';
  toast((e && e.message) || 'Erro ao salvar.', 'err');
}
function ausReceber_(d) {
  AUS_SALVANDO = false;
  if (!d || !d.ok) { ausErro_(new Error((d && d.erro) || 'Não foi possível salvar.')); return; }
  AUS = d; renderAusencias_(); if (CAP_DATA) renderCapacidade_();
  toast(d.pendente ? 'Salvo. Sincronização do painel pendente.' : 'Disponibilidade atualizada.', d.pendente ? 'err' : 'ok');
}
function ausPersistir_(lista) {
  if (!isChefeAtual_() || AUS_UNIDADE !== ausEscopo_() || AUS_SALVANDO) return;
  AUS_SALVANDO = true;
  var escopo = ausEscopo_(), btn = document.getElementById('aus-save'); if (btn) btn.disabled = true;
  google.script.run.withSuccessHandler(function(d) { AUS_SALVANDO = false; if (ausEscopo_() === escopo) ausReceber_(d); }).withFailureHandler(ausErro_).salvarDisponibilidadeApp(lista, AUS.revisao, AUTH_TOKEN);
}
function ausRepublicar_() { var escopo = ausEscopo_(); google.script.run.withSuccessHandler(function(d) { if (ausEscopo_() === escopo) ausReceber_(d); }).withFailureHandler(ausErro_).republicarDisponibilidadeApp(AUTH_TOKEN); }
// Atualização de data também funciona em abas mantidas abertas durante a noite.
var AUS_DIA = ausHoje_();
setInterval(function() { var hoje = ausHoje_(); if (hoje !== AUS_DIA) { AUS_DIA = hoje; if (AUTH_TOKEN) carregarAusencias_(); } }, 60000);
if (typeof AUTH_TOKEN !== 'undefined' && AUTH_TOKEN) carregarAusencias_();
