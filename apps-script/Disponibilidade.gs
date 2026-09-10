// Ausências privadas por unidade. Nunca espelhar motivos ou matrículas no KPI.
function _ausDataValida_(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}
function _ausValidar_(lista, equipe) {
  if (!Array.isArray(lista) || lista.length > 500) throw new Error('Agenda inválida (máximo 500 períodos).');
  var mats = {}; equipe.forEach(function(s) { mats[String(s.matricula)] = true; });
  var out = lista.map(function(a) {
    var r = { matricula: String(a.matricula || ''), tipo: String(a.tipo || ''), inicio: String(a.inicio || ''), fim: String(a.fim || '') };
    if (!mats[r.matricula]) throw new Error('Servidor não pertence à unidade.');
    if (['ferias', 'afastamento'].indexOf(r.tipo) < 0) throw new Error('Tipo inválido.');
    if (!_ausDataValida_(r.inicio) || (r.fim && !_ausDataValida_(r.fim)) || (r.fim && r.fim < r.inicio)) throw new Error('Período inválido.');
    if (r.tipo === 'ferias' && !r.fim) throw new Error('Informe o último dia das férias.');
    return r;
  }).sort(function(a,b) { return a.inicio.localeCompare(b.inicio); });
  out.forEach(function(a,i) { out.slice(0,i).forEach(function(b) {
    if (a.matricula === b.matricula && a.inicio <= (b.fim || '9999-12-31')) throw new Error('Períodos sobrepostos para o mesmo servidor.');
  }); });
  return out;
}
function _ausResumo_(lista, equipe) {
  var mats = {}; equipe.forEach(function(s) { mats[String(s.matricula)] = true; });
  var eventos = {};
  lista.forEach(function(a) {
    if (!mats[a.matricula]) return;
    eventos[a.inicio] = (eventos[a.inicio] || 0) + 1;
    if (a.fim) {
      var d = new Date(a.fim + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
      var fim = d.toISOString().slice(0,10);
      eventos[fim] = (eventos[fim] || 0) - 1;
    }
  });
  var ausentes = 0;
  return { versao: 1, fuso: 'America/Sao_Paulo', transicoes: Object.keys(eventos).sort().map(function(data) {
    ausentes += eventos[data]; return { data: data, ausentes: ausentes };
  }) };
}
function _ausLer_() {
  var d = _fsGet_('disponibilidade/agenda') || {};
  d.revisao = Number(d.revisao) || 0;
  // A primeira versão do encoder REST transformava arrays de objetos em
  // "[object Object]". JSON válido ainda pode ser recuperado; a string antiga
  // não contém os campos originais, então é sinalizada para recadastro em vez
  // de quebrar o cliente num carregamento infinito.
  if (typeof d.periodos === 'string') {
    try {
      var legado = JSON.parse(d.periodos);
      d.periodos = Array.isArray(legado) ? legado : [];
      d.incompativel = !Array.isArray(legado);
    } catch (e) {
      d.periodos = [];
      d.incompativel = true;
    }
  } else if (!Array.isArray(d.periodos)) {
    d.periodos = [];
    d.incompativel = true;
  }
  return d;
}
function getDisponibilidadeApp(token) {
  _authRequire_(token, false);
  var d = _ausLer_();
  return { ok: true, revisao: d.revisao, periodos: d.periodos || [], pendente: !!d.pendente,
    incompativel: !!d.incompativel };
}
function _ausPublicar_(d, equipe) {
  _fsSet_('config/capacidadeDisponivel', _ausResumo_(d.periodos || [], equipe));
  _fsUpdate_('disponibilidade/agenda', { pendente: false });
}
function salvarDisponibilidadeApp(lista, revisao, token) {
  return _withAppLockResult_('salvar disponibilidade', function() {
    var sess = _authRequire_(token, true);
    var equipe = _getServidoresApp_();
    var antes = _ausLer_();
    if (Number(revisao) !== Number(antes.revisao)) throw new Error('Agenda alterada por outra pessoa. Recarregue antes de salvar.');
    // Registros de pessoas removidas permanecem como histórico imutável.
    var mats = {}; equipe.forEach(function(s) { mats[String(s.matricula)] = true; });
    if (!Array.isArray(lista)) throw new Error('Agenda inválida.');
    var historicos = (antes.periodos || []).filter(function(a) { return !mats[a.matricula]; });
    var periodos = _ausValidar_(lista.filter(function(a) { return !historicos.some(function(h) { return JSON.stringify(h) === JSON.stringify(a); }); }), equipe).concat(historicos);
    var d = { revisao: Number(antes.revisao) + 1, periodos: periodos, pendente: true,
      atualizadoEm: new Date().toISOString(), atualizadoPor: sess.matricula || sess.nome };
    // Auditoria privada antes da alteração: registra a tentativa e o estado anterior.
    _fsCreate_('disponibilidadeHistorico', { antes: antes, depois: d });
    _fsSet_('disponibilidade/agenda', d);
    try { _ausPublicar_(d, equipe); d.pendente = false; } catch(e) { /* retry explícito, nunca silêncio no cliente */ }
    return { ok: true, revisao: d.revisao, periodos: periodos, pendente: d.pendente };
  });
}
function republicarDisponibilidadeApp(token) {
  return _withAppLockResult_('sincronizar disponibilidade', function() {
    _authRequire_(token, true);
    var agenda = _ausLer_();
    if (agenda.incompativel) throw new Error('O período salvo pela versão anterior precisa ser recadastrado antes da sincronização.');
    _ausPublicar_(agenda, _getServidoresApp_());
    return getDisponibilidadeApp(token);
  });
}
