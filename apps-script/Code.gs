// ═══════════════════════════════════════════════════════════════════════════
// AppSEL — App de Gestão de Etapas · SEL / Colégio Pedro II
// Versão 1.0 — Maio 2026
//
// ── PASSOS PARA PUBLICAR ─────────────────────────────────────────────────
// 1. Crie um novo projeto em script.google.com
// 2. Cole este arquivo como "AppSEL_Codigo.gs"
// 3. Cole o arquivo "AppSEL_index.html"
// 4. Preencha SS_ID. CHEFIA_EMAIL/EMAILS_SEL são fallback; o app também usa os e-mails salvos na Config.
// 5. Implantar → Novo → App da Web
//    • Executar como: Eu
//    • Quem pode acessar: Qualquer pessoa com o link
// 6. Copie a URL gerada e distribua para a equipe SEL/SEPMA
//
// ── COMO OBTER O SS_ID ───────────────────────────────────────────────────
// Abra a planilha CronogramaContratacoes no Google Sheets.
// URL: https://docs.google.com/spreadsheets/d/ID_AQUI/edit
// Copie o trecho entre /d/ e /edit.
// ═══════════════════════════════════════════════════════════════════════════

// ─── CONFIGURAÇÃO OBRIGATÓRIA ─────────────────────────────────────────────
var SS_ID        = 'COLE_AQUI_O_ID_DA_PLANILHA'; // prefira configurar SEL_SS_ID nas propriedades do script
var CHEFIA_EMAIL = 'COLE_AQUI_O_EMAIL_DA_CHEFIA';  // fallback opcional
var EMAILS_SEL   = {
  'Amanda':  'COLE_EMAIL_AMANDA',   // ← preencher
  'Beatriz': 'COLE_EMAIL_BEATRIZ',  // ← preencher
  'Bruno':   'COLE_EMAIL_BRUNO',    // ← preencher
  'Samuel':  'COLE_EMAIL_SAMUEL'
};
var DIAS_AVISO = 3; // dias de antecedência para enviar aviso de prazo (contagem conforme MODO_CONTAGEM_PRAZOS)
var AVISO_PROXIMOS_HORA = 10;
var AVISO_PROXIMOS_MINUTO = 30;
var AVISO_PROXIMOS_LABEL = '10h30';
var AVISO_VENCIDOS_HORA = 14;
var AVISO_VENCIDOS_MINUTO = 0;
var AVISO_VENCIDOS_LABEL = '14h';
var AVISO_HORARIOS_LABEL = AVISO_PROXIMOS_LABEL + ' prazos proximos; ' + AVISO_VENCIDOS_LABEL + ' etapas vencidas';
var CALENDARIO_MUNICIPIO_FALLBACK = 'Rio de Janeiro';
var AVISOS_DIAS_LABEL = 'segunda a sexta-feira';
// ─────────────────────────────────────────────────────────────────────────

// Configuração sustentável:
// - Se existir no PropertiesService, usa o valor configurado no projeto.
// - Se não existir, mantém os fallbacks acima para não quebrar a versão atual.
// Chaves úteis: SEL_SS_ID, SEL_CHEFIA_EMAIL e email_fallback_<servidor_normalizado>.
function _configProp_(chave, fallback) {
  try {
    var val = PropertiesService.getScriptProperties().getProperty(chave);
    return val !== null && val !== undefined && String(val).trim() !== '' ? val : fallback;
  } catch(e) {
    return fallback;
  }
}

function _emailServidorFallback_(servidor) {
  return _configProp_(_propKeyServidor_('email_fallback', servidor), EMAILS_SEL[servidor] || '');
}

function _chefiaEmailFallback_() {
  // O fallback global de chefia (SEL_CHEFIA_EMAIL) é da Reitoria. Em rotina
  // multiunidade ele só deve valer para a Reitoria — senão a chefia da Reitoria
  // receberia os avisos de prazo de TODOS os campi. Cada unidade já tem a
  // própria chefia via CHEFES_LISTA + e-mails por unidade.
  if (!_ehReitoria_()) return '';
  return _configProp_('SEL_CHEFIA_EMAIL', CHEFIA_EMAIL);
}

// URL pública do Painel de Contratações (GitHub Pages), usada nos e-mails ao
// setor requisitante. Pode ser sobrescrita via propriedade SEL_PAINEL_URL.
function _painelUrl_() {
  return _configProp_('SEL_PAINEL_URL', 'https://decofcp2-afk.github.io/painel-contratacoes-reitoria/');
}

function _withAppLock_(acao, fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Sistema ocupado: outra alteração está sendo salva. Aguarde alguns segundos e tente novamente.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function _withAppLockResult_(acao, fn) {
  try {
    return _withAppLock_(acao, fn);
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

function _limparCacheCapacidade_() {
  try { CacheService.getScriptCache().remove('dados_capacidade'); } catch(e) {}
}

function _authNorm_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function _authMatriculaPadrao_(nome) {
  return _authNorm_(nome);
}

function _authSalt_() {
  return Utilities.getUuid().replace(/-/g, '');
}

// Senha temporária aleatória e legível (sem caracteres ambíguos como 0/O, 1/I).
// Substitui a antiga senha padrão fixa "123456": como as matrículas são
// visíveis publicamente (coleção `servidores` do Firestore), uma senha padrão
// conhecida permitia que qualquer pessoa entrasse antes do titular.
function _senhaTempAleatoria_() {
  var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 8; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

function _authHash_(senha, salt) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || '') + '::' + String(senha || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(bytes);
}

// Conta ADMIN global (não pertence a nenhuma unidade; não aparece nas equipes).
// Acesso global (isChefe) para configurações específicas e exclusão de unidades.
//
// SEGURANÇA (Fase 2 do PLANO_SEGURANCA): a senha do admin NÃO fica mais no
// código-fonte. Vem da Script Property SEL_ADMIN_CRED_JSON ({salt, hash,
// mustChange}). Defina/redefina uma vez rodando no editor:
//     definirSenhaAdmin('umaSenhaTemporaria')
// O admin entra com ela e é FORÇADO a trocar por uma definitiva (mustChange:true).
// Enquanto a Property não existir, o login do admin fica indisponível (sem
// credencial fraca padrão). E-mail p/ redefinição: decof.cp2@gmail.com.
var ADMIN_CRED_KEY = 'SEL_ADMIN_CRED_JSON';
function _isAdminMat_(mat) { return _authNorm_(mat) === 'admin'; }

function _adminCred_() {
  var raw = PropertiesService.getScriptProperties().getProperty(ADMIN_CRED_KEY);
  if (!raw) return null;
  try { var c = JSON.parse(raw); return (c && c.salt && c.hash) ? c : null; } catch (e) { return null; }
}

// Define (ou redefine) a senha do administrador geral. RODAR MANUALMENTE no
// editor do Apps Script: definirSenhaAdmin('suaSenhaTemporaria'). Marca
// mustChange:true para exigir a troca por uma senha definitiva no 1º login.
function definirSenhaAdmin(senha) {
  senha = String(senha || '').trim();
  if (!senha) {
    // Sem argumento (o botão ▶ Executar não passa parâmetros): gera uma senha
    // temporária aleatória, define-a e MOSTRA no log de execução para você usar
    // no 1º login do admin (o sistema exigirá a troca por uma definitiva).
    senha = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
    Logger.log('Senha temporária do admin: ' + senha);
    Logger.log('Faça login com "admin" + essa senha; o sistema exigirá a troca por uma definitiva.');
  }
  if (senha.length < 4) {
    throw new Error('Senha muito curta (mín. 4 caracteres).');
  }
  var salt = _authSalt_();
  PropertiesService.getScriptProperties().setProperty(ADMIN_CRED_KEY, JSON.stringify({
    salt: salt, hash: _authHash_(senha, salt), mustChange: true
  }));
  return 'Senha do admin definida (mustChange). Se foi gerada automaticamente, veja no log acima.';
}

function _adminUser_() {
  var cred = _adminCred_();
  if (!cred) return null; // admin não configurado → rodar definirSenhaAdmin no editor
  return { nome: 'Administrador Geral', matricula: 'admin', salt: cred.salt,
           hash: cred.hash, isChefe: true, mustChange: !!cred.mustChange,
           isAdmin: true, email: 'decof.cp2@gmail.com' };
}

// ── Parte 3: equipe/login POR UNIDADE ──────────────────────────────────────
// Chaves por unidade (request-scoped via _FS_UNIDADE_REQ). Para reitoria-sel há
// FALLBACK às chaves globais legadas, então a Reitoria não muda até o 1º salvar.
function _reqUni_() {
  return (typeof _FS_UNIDADE_REQ === 'string' && _FS_UNIDADE_REQ) ? _FS_UNIDADE_REQ : 'reitoria-sel';
}
function _servKey_()  { return 'SEL_SERVIDORES_JSON__' + _reqUni_(); }
function _usersKey_() { return 'SEL_AUTH_USERS_JSON__' + _reqUni_(); }
function _emailKey_(nome) { return 'email__' + _reqUni_() + '__' + String(nome || ''); }
function _ehReitoria_() { return _reqUni_() === 'reitoria-sel'; }

function _authUsers_() {
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(_usersKey_());
  if (!raw && _ehReitoria_()) raw = props.getProperty('SEL_AUTH_USERS_JSON'); // legado
  if (!raw) return {};
  try { return JSON.parse(raw) || {}; } catch(e) { return {}; }
}

function _authSaveUsers_(users) {
  PropertiesService.getScriptProperties()
    .setProperty(_usersKey_(), JSON.stringify(users || {}));
}

// Sincroniza a lista de servidores com o mapa de usuários (auth).
// criadosOut (opcional): array que recebe {nome, matricula, senhaTemp} de cada
// usuário NOVO criado nesta chamada — usado por salvarServidoresApp para
// enviar a senha temporária por e-mail e informar a chefia. Nos demais pontos
// de chamada (login/challenge) o parâmetro é omitido e a senha aleatória fica
// desconhecida de propósito: o titular usa "Esqueci minha senha" para receber
// uma temporária por e-mail.
function _authSyncServidores_(lista, criadosOut) {
  var users = _authUsers_();
  var changed = false;
  var validos = {};
  (lista || []).forEach(function(s) {
    var matricula = _authNorm_(s.matricula || _authMatriculaPadrao_(s.nome));
    if (!matricula) return;
    validos[matricula] = true;
    if (!users[matricula]) {
      var salt = _authSalt_();
      var senhaTemp = _senhaTempAleatoria_();
      users[matricula] = {
        nome: s.nome,
        matricula: matricula,
        salt: salt,
        hash: _authHash_(senhaTemp, salt),
        isChefe: !!s.isChefe,
        mustChange: true
      };
      if (criadosOut) criadosOut.push({ nome: s.nome, matricula: matricula, senhaTemp: senhaTemp });
      changed = true;
    } else {
      if (users[matricula].nome !== s.nome) { users[matricula].nome = s.nome; changed = true; }
      if (!!users[matricula].isChefe !== !!s.isChefe) { users[matricula].isChefe = !!s.isChefe; changed = true; }
    }
  });
  Object.keys(users).forEach(function(matricula) {
    if (!validos[_authNorm_(matricula)]) {
      delete users[matricula];
      changed = true;
    }
  });
  if (changed) _authSaveUsers_(users);
  return users;
}

function _authSessionKey_(token) {
  return 'SEL_AUTH_SESSION_' + String(token || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

// Remove sessões já expiradas do PropertiesService. Uma sessão só era apagada
// quando alguém tentava usá-la depois de expirar (ou no logout explícito):
// fechar o navegador (comum no celular/PWA) deixava a property para sempre.
// Com o crescimento multiunidade isso aproximaria a quota (~500 KB/500 chaves)
// e um dia impediria novos logins. Chamado no login (melhor esforço, nunca
// bloqueia). Limita a varredura para não estourar o tempo em bases grandes.
function _limparSessoesExpiradas_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var todos = props.getProperties();
    var agora = Date.now();
    Object.keys(todos).forEach(function(k) {
      if (k.indexOf('SEL_AUTH_SESSION_') !== 0) return;
      try {
        var s = JSON.parse(todos[k]);
        if (!s || (s.exp && agora > s.exp)) props.deleteProperty(k);
      } catch(e) {
        props.deleteProperty(k); // conteúdo corrompido — remove
      }
    });
  } catch(e) { /* limpeza é melhor esforço; nunca bloqueia o login */ }
}

function _authCreateSession_(user) {
  _limparSessoesExpiradas_();
  var token = Utilities.getUuid();
  // Fase 2: expiração absoluta de 24h. Antes era 0 (sessão nunca expirava no
  // servidor — token vazado/restaurado valia para sempre). _authGetSession_ já
  // rejeita e apaga a sessão quando Date.now() > exp; o cliente também checa exp
  // na restauração (sessionStorage), então a sessão morre por inatividade/24h.
  var exp = Date.now() + 24 * 60 * 60 * 1000;
  PropertiesService.getScriptProperties().setProperty(_authSessionKey_(token), JSON.stringify({
    nome: user.nome,
    matricula: user.matricula,
    isChefe: !!user.isChefe,
    isAdmin: !!user.isAdmin,
    unidade: _reqUni_(),
    exp: exp
  }));
  return { token: token, exp: exp };
}

function _authGetSession_(token) {
  // Fase 1 (data-gateway): se a função não recebeu o token posicional, usa o
  // token anexado no topo da requisição pelo cliente (_AUTH_TOKEN_REQ).
  if (!token && typeof _AUTH_TOKEN_REQ === 'string' && _AUTH_TOKEN_REQ) {
    token = _AUTH_TOKEN_REQ;
  }
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(_authSessionKey_(token));
  if (!raw) throw new Error('Sessão expirada. Faça login novamente.');
  var sess;
  try { sess = JSON.parse(raw); } catch(e) { sess = null; }
  if (!sess || (sess.exp && Date.now() > sess.exp)) {
    props.deleteProperty(_authSessionKey_(token));
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  var isAdminSess = _isAdminMat_(sess.matricula);
  // Trava multiunidade: a sessão foi criada para a unidade sess.unidade (Parte
  // 3). A unidade da REQUISIÇÃO ATUAL vem de localStorage no cliente — sem essa
  // conferência, trocar de unidade sem deslogar reaproveitava o mesmo token
  // contra a lista de usuários de OUTRA unidade, podendo casar por coincidência
  // com uma matrícula de outra pessoa (herdando o nível de acesso dela lá). O
  // admin geral não é afetado: ele resolve fora de _authUsers_() por unidade.
  if (!isAdminSess && sess.unidade && sess.unidade !== _reqUni_()) {
    props.deleteProperty(_authSessionKey_(token));
    throw new Error('Sessão de outra unidade. Faça login novamente.');
  }
  var user = isAdminSess ? _adminUser_() : _authUsers_()[_authNorm_(sess.matricula)];
  if (!user) {
    props.deleteProperty(_authSessionKey_(token));
    throw new Error('Usuário removido da equipe. Faça login novamente.');
  }
  sess.mustChange = !!user.mustChange;
  sess.isChefe = !!user.isChefe;
  sess.isAdmin = !!user.isAdmin;
  sess.nome = user.nome || sess.nome;
  return sess;
}

function _authRequire_(token, chefe, allowMustChange) {
  var sess = _authGetSession_(token);
  if (sess.mustChange && !allowMustChange) {
    throw new Error('Troque a senha temporária antes de continuar.');
  }
  if (chefe && !sess.isChefe) throw new Error('Ação restrita à chefia.');
  return sess;
}

var ABA_PROC = '🏛 Processos';
var ABA_ETP  = '🗓 Etapas';
var ABA_HIST = '__historico_motivos'; // aba oculta, append-only
var ABA_CAL  = 'Calendario';

// ── Contagem de prazos ────────────────────────────────────────────────────
// 'corridos' = dias corridos puros: conta TODOS os dias (fins de semana e
//              feriados incluídos). Modo atual, definido pela gestão.
// 'uteis'    = dias úteis: pula sábados, domingos e feriados (fixos + aba
//              Calendario). Os feriados continuam definidos abaixo e voltam
//              a valer automaticamente se este modo for reativado.
var MODO_CONTAGEM_PRAZOS = 'corridos';

// ── Feriados nacionais fixos (MM-DD) ─────────────────────────────────────
var _FERIADOS = ['01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25'];
var _CALENDARIO_CACHE = null;
var _CALENDARIO_CACHE_MS = 5 * 60 * 1000;

function _calNorm_(s) {
  return String(s || '').trim().toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ');
}

function _calKey_(s) {
  return _calNorm_(s).replace(/\s+/g, '');
}

var _CALENDARIO_MUNICIPIO_MEMO = null;
function _calMunicipio_() {
  // Memoiza o município por execução. Sem isso, este getProperty do
  // PropertiesService era disparado a CADA chamada de _isFer_() — dezenas de
  // milhares de vezes ao montar a cascata de etapas —, estourando o tempo de
  // execução ("Tempo esgotado ao comunicar com o Apps Script").
  if (_CALENDARIO_MUNICIPIO_MEMO !== null) return _CALENDARIO_MUNICIPIO_MEMO;
  _CALENDARIO_MUNICIPIO_MEMO = _configProp_('SEL_MUNICIPIO_CALENDARIO', CALENDARIO_MUNICIPIO_FALLBACK);
  return _CALENDARIO_MUNICIPIO_MEMO;
}

function _calFindCol_(header, nomes) {
  var alvo = {};
  nomes.forEach(function(n) { alvo[_calKey_(n)] = true; });
  for (var i = 0; i < header.length; i++) {
    if (alvo[_calKey_(header[i])]) return i;
  }
  return -1;
}

function _calTipoFeriado_(tipo) {
  var n = _calNorm_(tipo);
  return n.indexOf('FERIADO') >= 0 &&
    n.indexOf('FACULTATIVO') < 0 &&
    n.indexOf('PONTO') < 0;
}

function _calAfetaPrazo_(valor) {
  var n = _calNorm_(valor);
  return n === 'SIM' || n === 'S' || n === 'TRUE' || n === '1';
}

function _calMunicipioOk_(valor, municipioAlvo) {
  var m = _calNorm_(valor);
  return !m || m === 'TODOS' || m === _calNorm_(municipioAlvo);
}

function _calSheet_() {
  var ss = _ss_();
  var sh = ss.getSheetByName(ABA_CAL);
  if (sh) return sh;
  var alvo = _calKey_(ABA_CAL);
  var achada = null;
  ss.getSheets().forEach(function(s) {
    if (!achada && _calKey_(s.getName()) === alvo) achada = s;
  });
  return achada;
}

function _calendarioFeriadosMap_() {
  var municipio = _calMunicipio_();
  var agora = Date.now();
  if (_CALENDARIO_CACHE &&
      _CALENDARIO_CACHE.municipio === municipio &&
      (agora - _CALENDARIO_CACHE.ts) < _CALENDARIO_CACHE_MS) {
    return _CALENDARIO_CACHE.datas;
  }

  var datas = {};
  try {
    var sh = _calSheet_();
    if (!sh || sh.getLastRow() < 2) {
      _CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
      return datas;
    }
    var values = sh.getDataRange().getValues();
    var headerRow = -1;
    for (var r = 0; r < values.length; r++) {
      if (_calFindCol_(values[r], ['Data']) >= 0) { headerRow = r; break; }
    }
    if (headerRow < 0) {
      _CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
      return datas;
    }
    var h = values[headerRow];
    var iData = _calFindCol_(h, ['Data']);
    var iTipo = _calFindCol_(h, ['Tipo']);
    var iMun  = _calFindCol_(h, ['Municipio', 'Município']);
    var iAfeta = _calFindCol_(h, ['AfetaPrazo', 'Afeta Prazo']);
    if (iData < 0 || iTipo < 0 || iAfeta < 0) {
      _CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
      return datas;
    }
    for (var linha = headerRow + 1; linha < values.length; linha++) {
      var row = values[linha];
      var d = _parseDate_(row[iData]);
      if (!d) continue;
      if (!_calTipoFeriado_(row[iTipo])) continue;
      if (!_calAfetaPrazo_(row[iAfeta])) continue;
      if (!_calMunicipioOk_(iMun >= 0 ? row[iMun] : 'TODOS', municipio)) continue;
      datas[_toIso_(d)] = true;
    }
  } catch(e) {
    datas = {};
  }

  _CALENDARIO_CACHE = { municipio: municipio, ts: agora, datas: datas };
  return datas;
}

function _calendarioPayload_() {
  var mapa = _calendarioFeriadosMap_();
  return {
    municipio: _calMunicipio_(),
    feriados: Object.keys(mapa).sort(),
    modoContagem: MODO_CONTAGEM_PRAZOS // mantém o front em sincronia com o back
  };
}

function _isFerFixo_(d) {
  return _FERIADOS.indexOf(
    String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
  ) >= 0;
}

function _isFer_(d) {
  return _isFerFixo_(d) || !!_calendarioFeriadosMap_()[_toIso_(d)];
}

// Diz se uma data conta para o prazo, conforme MODO_CONTAGEM_PRAZOS.
// 'corridos' → todo dia conta. 'uteis' → pula sáb/dom e feriados.
function _contaDiaPrazo_(d) {
  if (MODO_CONTAGEM_PRAZOS !== 'uteis') return true;
  return d.getDay() !== 0 && d.getDay() !== 6 && !_isFer_(d);
}

function _addDU_(data, dias) {
  if (dias <= 0) return new Date(data.getTime());
  if (MODO_CONTAGEM_PRAZOS !== 'uteis') {
    var dc = new Date(data.getTime());
    dc.setDate(dc.getDate() + dias);
    return dc;
  }
  var d = new Date(data.getTime()), n = 0;
  while (n < dias) {
    d.setDate(d.getDate() + 1);
    if (_contaDiaPrazo_(d)) n++;
  }
  return d;
}

function _contDU_(ini, fim) {
  if (!ini || !fim) return 0;
  var a = new Date(ini); a.setHours(0,0,0,0);
  var b = new Date(fim); b.setHours(0,0,0,0);
  if (b.getTime() === a.getTime()) return 0;
  if (MODO_CONTAGEM_PRAZOS !== 'uteis') {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }
  var sinal = b > a ? 1 : -1;
  var c = 0, d = new Date(a);
  while ((sinal > 0 && d < b) || (sinal < 0 && d > b)) {
    d.setDate(d.getDate() + sinal);
    if (_contaDiaPrazo_(d)) c++;
  }
  return c * sinal;
}

function _parseDate_(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1]);
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  return null;
}

function _toIso_(d) {
  if (!d) return null;
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

function _normStatus_(s) {
  if (!s) return 'pendente';
  var n = String(s).trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.indexOf('conclu')   >= 0)             return 'ok';
  if (n.indexOf('andament') >= 0)             return 'andamento';
  if (n.indexOf('atras')    >= 0)             return 'atrasado';
  if (n.startsWith('aguard'))                 return 'aguardando';
  if (n.startsWith('parali') || n.startsWith('suspen')) return 'paralisado';
  if (n.indexOf('retornado') >= 0 && n.indexOf('fila') >= 0) return 'retornado';
  if (n === 'nao se aplica' || n === 'n/a')   return 'na';
  return 'pendente';
}

function _normText_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function _isRetornoFilaMotivo_(motivo) {
  return _normText_(motivo).indexOf('retorno para fila:') === 0;
}

function _isEtapaContratual_(fase, nome) {
  var f = _normText_(fase);
  var n = _normText_(nome);
  return f.indexOf('contrat') >= 0 ||
    n.indexOf('assinatura contrato') >= 0 ||
    n.indexOf('ata (arp)') >= 0 ||
    n.indexOf('gestao contratual') >= 0;
}

// Deriva, a partir das condicionais salvas no PROCESSO (tipo de contratação
// direta, IRP, Procuradoria), quais etapas não se aplicam — e aplica em tempo
// de leitura sobre os objetos de etapa (status já normalizado). Assim a
// fila/detalhe refletem a condição mesmo em processos antigos ou antes de o
// backend reprocessar o status de cada etapa. Trata os dois sentidos e NUNCA
// altera etapas concluídas. Espelha _aplicarCondicionaisEtapas_ / a versão do
// appsel-firestore.js.
function _derivarCondicionaisLeitura_(proc, etapas) {
  if (!etapas || !etapas.length) return;
  var ehCD       = _normText_(proc.modal).indexOf('direta') >= 0;
  var tipo       = _normText_(proc.tipoCD);
  var ehAdesao   = ehCD && tipo.indexOf('adesao') >= 0;
  var temDisputa = ehCD && tipo.indexOf('com disputa') >= 0;
  var semIRP     = !proc.temIRP || ehAdesao;
  var semProc    = ehCD && proc.procuradoria === false;
  etapas.forEach(function(et) {
    var n = _normText_(et.nome);
    var ehIRP    = n.indexOf('irp') >= 0;
    var ehMinuta = n.indexOf('minuta') >= 0;
    var ehVersao = n.indexOf('versao final') >= 0;
    var ehFaseE  = n.indexOf('fase externa') >= 0;
    var gerenciada = ehIRP || ehMinuta || ehVersao || ehFaseE;
    var deveNA = (ehIRP && semIRP)
      || (ehAdesao && (ehMinuta || ehVersao))
      || (ehFaseE && ehCD && !temDisputa);
    // Nunca ocultar uma etapa que carrega o marcador de retorno para fila —
    // senão o retorno "some" e o processo não reaparece na fila. Se já estiver
    // gravada como 'na', reexibe (senão o filtro de leitura a remove).
    if (_isRetornoFilaMotivo_(et.motivo)) { if (et.status === 'na') et.status = 'pendente'; }
    else if (et.status === 'ok') { /* concluída: mantém */ }
    else if (deveNA) et.status = 'na';
    else if (gerenciada && et.status === 'na') et.status = 'pendente';
    if (ehCD && (n.indexOf('adequac') >= 0 || n.indexOf('procuradoria') >= 0)) {
      et.nome = semProc ? 'Adequações finais dos documentos'
                        : 'Adequações finais dos documentos e envio à Procuradoria';
    }
  });
}

function _isSim_(v) {
  if (v === true) return true;
  var n = String(v || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  return n === 'sim' || n === 's' || n === 'true' || n === '1';
}

function _statusPlanilha_(s) {
  var n = _normStatus_(s);
  var map = {
    ok: 'Concluída',
    andamento: 'Em andamento',
    aguardando: 'Aguardando requisitante',
    paralisado: 'Paralisado',
    retornado: 'Retornado para fila',
    na: 'Não se aplica',
    pendente: 'Não iniciada',
    atrasado: 'Atrasado'
  };
  return map[n] || s;
}

function _setValorPreservandoValidacao_(range, value) {
  var dv = range.getDataValidation();
  if (dv) range.clearDataValidations();
  range.setValue(value);
  if (dv) range.setDataValidation(dv);
  return range;
}

function _isModalidadeExtSegregada_(modalidade) {
  var m = _normText_(modalidade);
  return m.indexOf('pregao') >= 0 || m.indexOf('concorr') >= 0;
}

function _garantirColunas_(sh, chave, colunas) {
  var l = _lerAba_(sh, chave);
  var header = l.header.slice();
  var lastCol = sh.getLastColumn();
  var criadas = false;
  colunas.forEach(function(nome) {
    if (header.indexOf(nome) >= 0) return;
    lastCol++;
    sh.getRange(l.hIdx + 1, lastCol).setValue(nome).setFontWeight('bold');
    header.push(nome);
    criadas = true;
  });
  return criadas ? _lerAba_(sh, chave) : l;
}

function _servidoresValidosMap_() {
  var map = {};
  try {
    _getServidoresApp_().forEach(function(s) {
      if (s.nome) map[_normServidorNome_(s.nome)] = s.nome;
    });
  } catch(e) {
    ['Amanda','Beatriz','Bruno','Samuel'].forEach(function(n) {
      map[_normServidorNome_(n)] = n;
    });
  }
  return map;
}

function _normServidorNome_(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function _propKeyServidor_(prefixo, servidor) {
  return prefixo + '_' + _normServidorNome_(servidor).replace(/[^a-z0-9]+/g, '_');
}

function _servidorTemVinculosAtivos_(nome) {
  var alvo = _normServidorNome_(nome);
  if (!alvo) return { tem: false, total: 0 };
  var total = 0;
  try {
    var ss = _ss_();
    var shE = ss.getSheetByName(ABA_ETP);
    if (shE) {
      var lE = _lerAba_(shE, 'ProcessoID');
      var hE = lE.header;
      var iAg = hE.indexOf('Agente Responsável');
      var iSt = hE.indexOf('StatusEtapa ◄ EDITAR');
      if (iAg >= 0) {
        for (var r = lE.hIdx + 1; r < lE.values.length; r++) {
          var row = lE.values[r];
          if (_normServidorNome_(row[iAg]) !== alvo) continue;
          var st = iSt >= 0 ? _normStatus_(row[iSt]) : 'pendente';
          if (st !== 'ok' && st !== 'na') total++;
        }
      }
    }

    var shC = ss.getSheetByName('📊 Capacidade');
    if (shC) {
      var data = shC.getRange(1, 1, shC.getLastRow(), shC.getLastColumn()).getValues();
      var regHdr = -1;
      for (var i = 0; i < data.length; i++) {
        var rr = data[i].map(function(c){ return String(c).trim(); });
        if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = i; break; }
      }
      if (regHdr >= 0) {
        var hC = data[regHdr].map(function(c){ return String(c).trim(); });
        var iAt = hC.indexOf('Ativo');
        for (var c = regHdr + 1; c < data.length; c++) {
          if (_normServidorNome_(data[c][0]) !== alvo) continue;
          if (iAt < 0 || _isSim_(data[c][iAt])) total++;
        }
      }
    }
  } catch(e) {}
  return { tem: total > 0, total: total };
}

function _renomearServidorNasAbas_(antigo, novo) {
  var alvo = _normServidorNome_(antigo);
  if (!alvo || alvo === _normServidorNome_(novo)) return 0;
  var alterados = 0;
  var ss = _ss_();

  var shE = ss.getSheetByName(ABA_ETP);
  if (shE) {
    var lE = _lerAba_(shE, 'ProcessoID');
    var hE = lE.header;
    var iAg = hE.indexOf('Agente Responsável');
    if (iAg >= 0) {
      for (var r = lE.hIdx + 1; r < lE.values.length; r++) {
        if (_normServidorNome_(lE.values[r][iAg]) === alvo) {
          shE.getRange(r + 1, iAg + 1).setValue(novo);
          alterados++;
        }
      }
    }
  }

  var shC = ss.getSheetByName('📊 Capacidade');
  if (shC) {
    var data = shC.getRange(1, 1, shC.getLastRow(), shC.getLastColumn()).getValues();
    var regHdr = -1;
    for (var i = 0; i < data.length; i++) {
      var rr = data[i].map(function(c){ return String(c).trim(); });
      if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = i; break; }
    }
    if (regHdr >= 0) {
      for (var c = regHdr + 1; c < data.length; c++) {
        if (_normServidorNome_(data[c][0]) === alvo) {
          var cell = shC.getRange(c + 1, 1);
          cell.clearDataValidations().setValue(novo);
          alterados++;
        }
      }
    }
  }

  return alterados;
}

function _lerServidoresConfigSheet_() {
  try {
    var sh = _ss_().getSheetByName('⚙️ ConfigSEL') || _ss_().getSheetByName('ConfigSEL');
    if (!sh || sh.getLastRow() < 2) return null;
    var vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 5)).getValues();
    var h = vals[0].map(function(c){ return String(c || '').trim(); });
    var iNome = h.indexOf('Nome');
    var iMat = h.indexOf('Matricula');
    var iCor = h.indexOf('Cor');
    var iChefe = h.indexOf('Chefe');
    if (iNome < 0) return null;
    var out = [];
    for (var r = 1; r < vals.length; r++) {
      var nome = String(vals[r][iNome] || '').trim();
      if (!nome) continue;
      out.push({
        nome: nome,
        matricula: iMat >= 0 ? String(vals[r][iMat] || '').trim() : _authMatriculaPadrao_(nome),
        cor: iCor >= 0 ? String(vals[r][iCor] || '#64748b').trim() : '#64748b',
        isChefe: iChefe >= 0 && _isSim_(vals[r][iChefe])
      });
    }
    return out.length ? out : null;
  } catch(e) {
    return null;
  }
}

function _salvarServidoresConfigSheet_(lista) {
  try {
    var ss = _ss_();
    var sh = ss.getSheetByName('⚙️ ConfigSEL') || ss.getSheetByName('ConfigSEL');
    if (!sh) sh = ss.insertSheet('⚙️ ConfigSEL');
    var props = PropertiesService.getScriptProperties();
    var values = [['Nome', 'Matricula', 'Cor', 'Chefe', 'Email']];
    lista.forEach(function(s) {
      values.push([
        s.nome,
        s.matricula || _authMatriculaPadrao_(s.nome),
        s.cor || '#64748b',
        s.isChefe ? 'Sim' : 'Não',
        props.getProperty('email_' + s.nome) || _emailServidorFallback_(s.nome) || ''
      ]);
    });
    sh.clearContents();
    sh.getRange(1, 1, values.length, values[0].length).setValues(values);
    try { sh.hideSheet(); } catch(eHide) {}
  } catch(e) {}
}

function _ss_() { return SpreadsheetApp.openById(_configProp_('SEL_SS_ID', SS_ID)); }

function _setCapacidadeAtivo_(pid, faseTipo, ativo) {
  var shCap = _ss_().getSheetByName('📊 Capacidade');
  if (!shCap) return false;
  var data = shCap.getRange(1, 1, shCap.getLastRow(), shCap.getLastColumn()).getValues();
  var regHdr = -1;
  for (var r = 0; r < data.length; r++) {
    var rr = data[r].map(function(c){ return String(c).trim(); });
    if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = r; break; }
  }
  if (regHdr < 0) return false;
  var hCap = data[regHdr].map(function(c){ return String(c).trim(); });
  var iAtivo = hCap.indexOf('Ativo');
  if (iAtivo < 0) return false;

  var alvoExt = String(faseTipo || '').toLowerCase().indexOf('ext') >= 0;
  var changed = false;
  for (var i = regHdr + 1; i < data.length; i++) {
    var cpid = String(data[i][2] || '').trim();
    if (cpid !== pid) continue;
    var cfase = String(data[i][5] || '').trim().toLowerCase();
    var isExt = cfase.indexOf('ext') >= 0;
    if (isExt === alvoExt) {
      shCap.getRange(i + 1, iAtivo + 1).setValue(ativo);
      changed = true;
    }
  }
  return changed;
}

function _corrigirProcessoIdsBlocosEtapas_() {
  try {
    var sh = _ss_().getSheetByName(ABA_ETP);
    if (!sh) return { corrigidos: 0 };
    var lE = _lerAba_(sh, 'ProcessoID');
    var h = lE.header;
    var iPid = h.indexOf('ProcessoID');
    var iEtapa = h.indexOf('Etapa');
    if (iPid < 0 || iEtapa < 0) return { corrigidos: 0 };

    function corrigirBloco_(bloco) {
      if (!bloco.length) return 0;
      var cont = {};
      bloco.forEach(function(item) {
        if (item.pid) cont[item.pid] = (cont[item.pid] || 0) + 1;
      });
      var alvo = '', maior = 0, empate = false;
      Object.keys(cont).forEach(function(pid) {
        if (cont[pid] > maior) { alvo = pid; maior = cont[pid]; empate = false; }
        else if (cont[pid] === maior) { empate = true; }
      });
      if (!alvo || empate || maior < 2) return 0;
      var n = 0;
      bloco.forEach(function(item) {
        if (item.pid && item.pid !== alvo) {
          sh.getRange(item.row, iPid + 1).setValue(alvo);
          n++;
        }
      });
      return n;
    }

    var bloco = [], corrigidos = 0;
    for (var r = lE.hIdx + 1; r < lE.values.length; r++) {
      var row = lE.values[r];
      var pid = String(row[iPid] || '').trim();
      var etapa = String(row[iEtapa] || '').trim();
      if (!etapa) {
        corrigidos += corrigirBloco_(bloco);
        bloco = [];
        continue;
      }
      if (etapa) bloco.push({ row: r + 1, pid: pid });
    }
    corrigidos += corrigirBloco_(bloco);
    return { corrigidos: corrigidos };
  } catch(e) {
    return { corrigidos: 0, erro: e.message };
  }
}

function _marcarEtapasContratuaisNA_() {
  try {
    var sh = _ss_().getSheetByName(ABA_ETP);
    if (!sh) return { atualizadas: 0 };
    var lE = _lerAba_(sh, 'ProcessoID');
    var h = lE.header;
    var iNome = h.indexOf('Etapa');
    var iFase = h.indexOf('Fase');
    var iStat = h.indexOf('StatusEtapa ◄ EDITAR');
    if (iNome < 0 || iStat < 0) return { atualizadas: 0 };
    var atualizadas = 0;
    for (var r = lE.hIdx + 1; r < lE.values.length; r++) {
      var nome = String(lE.values[r][iNome] || '').trim();
      var fase = iFase >= 0 ? String(lE.values[r][iFase] || '').trim() : '';
      if (!_isEtapaContratual_(fase, nome)) continue;
      if (_normStatus_(lE.values[r][iStat]) === 'na') continue;
      sh.getRange(r + 1, iStat + 1).setValue('Não se aplica');
      atualizadas++;
    }
    return { atualizadas: atualizadas };
  } catch(e) {
    return { atualizadas: 0, erro: e.message };
  }
}

// ── _lerAba_ ──────────────────────────────────────────────────────────────
// Lê uma aba e encontra o cabeçalho real dinamicamente (ignora linhas de
// título decorativas acima). Retorna {header, hIdx, values, startRow}.
// hIdx   = índice da linha do cabeçalho em values[] (0-based)
// startRow = linha real na planilha onde os dados começam (1-based)
function _lerAba_(sh, chave) {
  var nCols  = sh.getLastColumn();
  var nRows  = Math.max(sh.getLastRow(), 3);
  var values = sh.getRange(1, 1, nRows, nCols).getValues();
  for (var r = 0; r < values.length; r++) {
    var row = values[r].map(function(c){ return String(c).trim(); });
    if (row.indexOf(chave) >= 0) {
      return { header: row, hIdx: r, values: values, startRow: r + 2 };
    }
  }
  throw new Error('Cabeçalho com "' + chave + '" não encontrado na aba ' + sh.getName());
}

// API publica para o GitHub Pages. O Apps Script fica como back-end do AppSEL.
// Unidade-alvo desta requisição (parte 2: escrita por unidade). Por-execução.
var _FS_UNIDADE_REQ = '';
// Token de sessão anexado no topo da requisição (Fase 1 data-gateway). Por-execução.
var _AUTH_TOKEN_REQ = '';

function doGet(e) {
  var params = (e && e.parameter) || {};
  var route = String(params.route || '').trim();
  // Escopo de unidade vindo do frontend (sanitizado). Vazio => fallback p/ FS_UNIDADE.
  _FS_UNIDADE_REQ = String(params.unidade || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  // Fase 1 (data-gateway): token de sessão anexado no topo da requisição pelo
  // cliente. Serve de fallback quando a função não recebe o token posicional.
  _AUTH_TOKEN_REQ = String(params.token || '').trim();

  try {
    var payload;
    if (route === 'appsel.challenge') {
      payload = loginChallengeApp(params.matricula || params.mat || '');
    } else if (route === 'appsel.loginProof') {
      payload = loginProofApp(params.matricula || params.mat || '', params.challengeId || '', params.proof || '');
    } else if (route === 'appsel.changePasswordHash') {
      payload = trocarSenhaHashApp(params.token || '', params.novaSalt || params.salt || '', params.novoHash || '');
    } else if (route === 'appsel.call') {
      payload = _apiCallAppSEL_(params.method || '', _apiParseArgs_(params.args));
    } else {
      payload = { ok: false, erro: 'Rota nao encontrada.', __apiError: true };
    }
    return _apiResponderAppSEL_(payload, params);
  } catch(err) {
    return _apiResponderAppSEL_({
      ok: false,
      erro: err && err.message ? err.message : String(err),
      __apiError: true
    }, params);
  }
}

function _apiResponderAppSEL_(payload, params) {
  params = params || {};
  var callback = String(params.callback || params.cb || '').trim();
  var json = JSON.stringify(payload === undefined ? null : payload)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  if (callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*(\.[A-Za-z_$][0-9A-Za-z_$]*)*$/.test(callback)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, erro: 'Callback invalido.', __apiError: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function _apiParseArgs_(raw) {
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch(e) {
    throw new Error('Argumentos invalidos.');
  }
}

function _apiCallAppSEL_(method, args) {
  method = String(method || '').trim();
  args = Array.isArray(args) ? args : [];
  var fns = {
    getServidoresApp: getServidoresApp,
    salvarServidoresApp: salvarServidoresApp,
    resetarSenhaServidorApp: resetarSenhaServidorApp,
    solicitarResetSenhaApp: solicitarResetSenhaApp,
    validarSessaoApp: validarSessaoApp,
    logoutApp: logoutApp,
    verificarTriggerAvisos: verificarTriggerAvisos,
    getEtapasParaApp: getEtapasParaApp,
    getHistorico: getHistorico,
    getCapacidadeApp: getCapacidadeApp,
    atribuirResponsaveisApp: atribuirResponsaveisApp,
    atualizarStatusEtapa: atualizarStatusEtapa,
    salvarEmailProcesso: salvarEmailProcesso,
    salvarLinkSuapProcessoApp: salvarLinkSuapProcessoApp,
    salvarNomeProcessoFilaApp: salvarNomeProcessoFilaApp,
    editarProcessoFilaApp: editarProcessoFilaApp,
    excluirProcessoApp: excluirProcessoApp,
    salvarOrdemFilaApp: salvarOrdemFilaApp,
    regredirEtapa: regredirEtapa,
    devolverProcessoFilaApp: devolverProcessoFilaApp,
    concluirEtapa: concluirEtapa,
    iniciarProcessos: iniciarProcessos,
    instalarTriggerAvisos: instalarTriggerAvisos,
    enviarEmailTesteServidor: enviarEmailTesteServidor,
    enviarAvisosPrazoApp: enviarAvisosPrazoApp,
    getAlertasApp: getAlertasApp,
    cadastrarProcesso: cadastrarProcesso,
    salvarOutrosCap: salvarOutrosCap,
    salvarPontuacaoCap: salvarPontuacaoCap,
    getEmails: getEmails,
    salvarEmail: salvarEmail
  };
  // Fase 3 (corte): versões Firestore (FirestoreSync.gs). Aditivo — só são
  // chamadas quando o frontend está com firestoreAtivo=true.
  if (typeof fs_atualizarStatusEtapa === 'function') {
    fns.fs_atualizarStatusEtapa   = fs_atualizarStatusEtapa;
    fns.fs_concluirEtapa          = fs_concluirEtapa;
    fns.fs_regredirEtapa          = fs_regredirEtapa;
    fns.fs_reabrirProcessoConcluido = fs_reabrirProcessoConcluido;
    fns.fs_devolverProcessoFilaApp= fs_devolverProcessoFilaApp;
    fns.fs_iniciarProcessos       = fs_iniciarProcessos;
    fns.fs_salvarEmailProcesso    = fs_salvarEmailProcesso;
    fns.fs_salvarLinkSuapProcessoApp = fs_salvarLinkSuapProcessoApp;
    fns.fs_salvarNomeProcessoFilaApp = fs_salvarNomeProcessoFilaApp;
    fns.fs_editarProcessoFilaApp  = fs_editarProcessoFilaApp;
    fns.fs_excluirProcessoApp     = fs_excluirProcessoApp;
    fns.fs_salvarOrdemFilaApp     = fs_salvarOrdemFilaApp;
    fns.fs_cadastrarProcesso      = fs_cadastrarProcesso;
    fns.fs_atribuirResponsaveisApp= fs_atribuirResponsaveisApp;
    fns.fs_salvarOutros           = fs_salvarOutros;
    fns.fs_salvarPontuacaoCap     = fs_salvarPontuacaoCap;
    if (typeof fs_getHistorico === 'function') fns.fs_getHistorico = fs_getHistorico;
    if (typeof fs_excluirUnidade === 'function') fns.fs_excluirUnidade = fs_excluirUnidade;
    if (typeof fs_criarUnidade === 'function') fns.fs_criarUnidade = fs_criarUnidade;
    if (typeof fs_getDadosUnidade === 'function') fns.fs_getDadosUnidade = fs_getDadosUnidade;
    if (typeof fs_salvarDadosUnidade === 'function') fns.fs_salvarDadosUnidade = fs_salvarDadosUnidade;
  }
  if (!fns[method]) throw new Error('Funcao nao permitida pela API publica.');
  return fns[method].apply(null, args);
}

function _sha256Base64_(texto) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(texto || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64Encode(bytes);
}

function _loginChallengeKey_(challengeId) {
  return 'SEL_LOGIN_CHALLENGE_' + String(challengeId || '').replace(/[^a-zA-Z0-9_-]/g, '');
}

// Remove challenges de login abandonados (criados mas nunca confirmados).
// Sem isso, cada tentativa de login abandonada deixaria uma propriedade
// SEL_LOGIN_CHALLENGE_* para sempre no PropertiesService (quota de 500 KB).
function _limparChallengesExpirados_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var todos = props.getProperties();
    var agora = Date.now();
    Object.keys(todos).forEach(function(k) {
      if (k.indexOf('SEL_LOGIN_CHALLENGE_') !== 0) return;
      try {
        var ch = JSON.parse(todos[k]);
        if (!ch || !ch.exp || ch.exp < agora) props.deleteProperty(k);
      } catch(e) {
        props.deleteProperty(k); // conteúdo corrompido — remove
      }
    });
  } catch(e) { /* limpeza é melhor esforço; nunca bloqueia o login */ }
}

function loginChallengeApp(matricula) {
  try {
    _limparChallengesExpirados_();
    var mat = _authNorm_(matricula);
    var users = {};
    if (_isAdminMat_(mat)) {
      users[mat] = _adminUser_();
    } else {
      var lista = _getServidoresApp_();
      users = _authSyncServidores_(lista);
    }
    var challengeId = Utilities.getUuid();
    var nonce = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');

    // Anti-enumeração de matrículas: para matrícula INEXISTENTE devolvemos um
    // challenge FALSO (salt determinístico, não armazenado) em vez de erro.
    // Antes, a resposta diferente aqui confirmava quais matrículas existiam —
    // dado que combinava mal com o login público. A prova desse challenge
    // falha no loginProofApp (não há registro) com a MESMA mensagem genérica.
    // O salt falso é derivado por HMAC-like da matrícula + segredo persistente,
    // para ser estável entre chamadas (um salt aleatório a cada chamada também
    // denunciaria a inexistência).
    if (!mat || !users[mat]) {
      var props = PropertiesService.getScriptProperties();
      var segredo = props.getProperty('SEL_FAKE_SALT_SECRET');
      if (!segredo) { segredo = Utilities.getUuid().replace(/-/g, ''); props.setProperty('SEL_FAKE_SALT_SECRET', segredo); }
      var fakeSalt = _sha256Base64_(segredo + '::' + mat).replace(/[^a-f0-9]/gi, '0').toLowerCase().slice(0, 32);
      return { ok: true, challengeId: challengeId, nonce: nonce, salt: fakeSalt };
    }

    PropertiesService.getScriptProperties().setProperty(_loginChallengeKey_(challengeId), JSON.stringify({
      matricula: mat,
      nonce: nonce,
      exp: Date.now() + 5 * 60 * 1000
    }));

    return {
      ok: true,
      challengeId: challengeId,
      nonce: nonce,
      salt: users[mat].salt
    };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

function loginProofApp(matricula, challengeId, proof) {
  try {
    var props = PropertiesService.getScriptProperties();
    var key = _loginChallengeKey_(challengeId);
    var raw = props.getProperty(key);
    props.deleteProperty(key);
    if (!raw) return { ok: false, erro: 'Matricula ou senha invalida.' };

    var ch;
    try { ch = JSON.parse(raw); } catch(e) { ch = null; }
    var mat = _authNorm_(matricula);
    if (!ch || ch.exp < Date.now() || ch.matricula !== mat) {
      return { ok: false, erro: 'Matricula ou senha invalida.' };
    }

    var lista, user;
    if (_isAdminMat_(mat)) {
      user = _adminUser_();
      // O admin global não pertence a nenhuma equipe, mas administra a unidade
      // que está acessando (escopo vindo em params.unidade → _FS_UNIDADE_REQ).
      // Antes retornávamos lista vazia aqui, então o admin via "Nenhum servidor
      // cadastrado" mesmo quando a unidade tinha equipe (e-mails e responsáveis
      // dos processos apareciam por virem de outras fontes). Carregamos a equipe
      // da unidade atual para que a gestão de servidores funcione para o admin.
      lista = _getServidoresApp_();
    } else {
      lista = _getServidoresApp_();
      user = _authSyncServidores_(lista)[mat];
    }
    if (!user) return { ok: false, erro: 'Matricula ou senha invalida.' };

    var esperado = _sha256Base64_(String(user.hash || '') + '::' + String(ch.nonce || ''));
    if (String(proof || '') !== esperado) {
      return { ok: false, erro: 'Matricula ou senha invalida.' };
    }

    var sess = _authCreateSession_(user);
    return {
      ok: true,
      token: sess.token,
      exp: sess.exp,
      nome: user.nome,
      matricula: user.matricula,
      isChefe: !!user.isChefe,
      isAdmin: !!user.isAdmin,
      mustChange: !!user.mustChange,
      servidores: lista
    };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

function trocarSenhaHashApp(token, novaSalt, novoHash) {
  return _withAppLockResult_('trocar senha via GitHub Pages', function() {
    var sess = _authRequire_(token, false, true);
    if (!/^[a-fA-F0-9]{32,128}$/.test(String(novaSalt || ''))) throw new Error('Salt de senha invalido.');
    if (!/^[A-Za-z0-9+/=]{40,80}$/.test(String(novoHash || ''))) throw new Error('Hash de senha invalido.');

    // Admin global: credencial fica na Script Property dedicada (não no mapa de
    // usuários por unidade). Persiste a nova senha e zera o mustChange.
    if (_isAdminMat_(sess.matricula)) {
      var cred = _adminCred_();
      if (!cred) throw new Error('Admin nao configurado.');
      if (!cred.mustChange) throw new Error('Troca de senha disponivel apenas para senha temporaria.');
      PropertiesService.getScriptProperties().setProperty(ADMIN_CRED_KEY, JSON.stringify({
        salt: String(novaSalt), hash: String(novoHash), mustChange: false
      }));
      return { ok: true };
    }

    var users = _authSyncServidores_(_getServidoresApp_());
    var user = users[_authNorm_(sess.matricula)];
    if (!user) throw new Error('Usuario nao encontrado.');
    if (!user.mustChange) throw new Error('Troca de senha disponivel apenas para senha temporaria.');
    user.salt = String(novaSalt);
    user.hash = String(novoHash);
    user.mustChange = false;
    users[_authNorm_(sess.matricula)] = user;
    _authSaveUsers_(users);
    return { ok: true };
  });
}

// LEGADO — usado apenas quando o app roda DENTRO do Apps Script (HtmlService,
// google.script.run nativo). No fluxo via GitHub Pages a senha NUNCA passa por
// aqui: o front intercepta 'loginApp' e usa challenge-response
// (appsel.challenge + appsel.loginProof). Esta função NÃO está na allowlist
// de _apiCallAppSEL_, portanto não é acessível pela API pública.
function loginApp(matricula, senha) {
  try {
    var lista = _getServidoresApp_();
    var users = _authSyncServidores_(lista);
    var mat = _authNorm_(matricula);
    if (!mat || !users[mat]) return { ok: false, erro: 'Matrícula ou senha inválida.' };
    var user = users[mat];
    if (user.hash !== _authHash_(senha, user.salt)) {
      return { ok: false, erro: 'Matrícula ou senha inválida.' };
    }
    var sess = _authCreateSession_(user);
    return {
      ok: true,
      token: sess.token,
      exp: sess.exp,
      nome: user.nome,
      matricula: user.matricula,
      isChefe: !!user.isChefe,
      isAdmin: !!user.isAdmin,
      mustChange: !!user.mustChange,
      servidores: lista
    };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

function validarSessaoApp(token) {
  try {
    var sess = _authGetSession_(token);
    var lista = _getServidoresApp_();
    return {
      ok: true,
      token: token,
      exp: sess.exp,
      nome: sess.nome,
      matricula: sess.matricula,
      isChefe: !!sess.isChefe,
      isAdmin: !!sess.isAdmin,
      mustChange: !!sess.mustChange,
      servidores: lista
    };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

function logoutApp(token) {
  try {
    if (token) PropertiesService.getScriptProperties().deleteProperty(_authSessionKey_(token));
  } catch(e) {}
  return { ok: true };
}

// LEGADO — mesmo caso de loginApp acima: só é usada no modo google.script.run
// nativo. Via GitHub Pages o front intercepta 'trocarSenhaApp' e chama
// appsel.changePasswordHash (trocarSenhaHashApp), sem enviar a senha em claro.
// Não está na allowlist de _apiCallAppSEL_.
function trocarSenhaApp(token, senhaAtual, novaSenha) {
  return _withAppLockResult_('trocar senha', function() {
    var sess = _authRequire_(token, false, true);
    if (!novaSenha || String(novaSenha).length < 4) throw new Error('A nova senha precisa ter ao menos 4 caracteres.');
    var users = _authSyncServidores_(_getServidoresApp_());
    var user = users[_authNorm_(sess.matricula)];
    if (!user) throw new Error('Usuário não encontrado.');
    if (!user.mustChange && user.hash !== _authHash_(senhaAtual, user.salt)) throw new Error('Senha atual inválida.');
    var salt = _authSalt_();
    user.salt = salt;
    user.hash = _authHash_(novaSenha, salt);
    user.mustChange = false;
    users[_authNorm_(sess.matricula)] = user;
    _authSaveUsers_(users);
    return { ok: true };
  });
}

function resetarSenhaServidorApp(token, matricula) {
  return _withAppLockResult_('resetar senha', function() {
    _authRequire_(token, true);
    var lista = _getServidoresApp_();
    var users = _authSyncServidores_(lista);
    var mat = _authNorm_(matricula);
    if (!mat || !users[mat]) throw new Error('Usuário não encontrado.');
    // Senha aleatória (não mais a padrão fixa "123456"): enviada por e-mail ao
    // titular quando houver e-mail cadastrado; sempre retornada à chefia para
    // repasse manual quando não houver.
    var senhaTemp = _senhaTempAleatoria_();
    var salt = _authSalt_();
    users[mat].salt = salt;
    users[mat].hash = _authHash_(senhaTemp, salt);
    users[mat].mustChange = true;
    _authSaveUsers_(users);
    var emailEnviado = false;
    var emailDest = '';
    try {
      var servidor = lista.find(function(s) { return _authNorm_(s.matricula) === mat; });
      var nome = (servidor && servidor.nome) || users[mat].nome || '';
      emailDest = _emailServidorPorNome_(nome);
      if (emailDest) {
        _enviarEmailSenhaTemp_(emailDest, nome, mat, senhaTemp,
          'Sua senha do AppSEL foi resetada pela chefia.');
        emailEnviado = true;
      }
    } catch(e) { /* e-mail é best-effort; a senha volta na resposta */ }
    return { ok: true, senhaTemporaria: senhaTemp, emailEnviado: emailEnviado,
             email: emailEnviado ? emailDest : '' };
  });
}

// E-mail cadastrado de um servidor (PropertiesService, com fallback legado).
function _emailServidorPorNome_(nome) {
  if (!nome) return '';
  var props = PropertiesService.getScriptProperties();
  var email = props.getProperty(_emailKey_(nome)) || '';
  if (!email && _ehReitoria_()) email = props.getProperty('email_' + nome) || _emailServidorFallback_(nome) || '';
  if (!email || email.indexOf('@') < 0 || email.indexOf('COLE_') === 0) return '';
  return email;
}

// Envia a senha temporária por e-mail com instruções claras de primeiro acesso.
function _enviarEmailSenhaTemp_(email, nome, matricula, senhaTemp, contexto) {
  var appUrl = 'https://decofcp2-afk.github.io/app_gestao-reitoria/';
  var html = '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">'
    + '<h2 style="font-size:18px;color:#1a3a5c;">Acesso ao AppSEL — Sistema de Gestão de Etapas</h2>'
    + '<p>Olá, <b>' + nome + '</b>. ' + (contexto || 'Seu acesso ao AppSEL foi criado.') + '</p>'
    + '<p><b>Acesse:</b> <a href="' + appUrl + '">' + appUrl + '</a></p>'
    + '<p><b>Matrícula (login):</b> ' + matricula + '<br><b>Senha temporária:</b></p>'
    + '<div style="font-size:24px;font-weight:800;letter-spacing:3px;background:#f1f5f9;border-radius:8px;padding:12px 16px;display:inline-block;">' + senhaTemp + '</div>'
    + '<p>No primeiro acesso o sistema pedirá que você crie uma senha definitiva.</p>'
    + '<p style="font-size:12px;color:#64748b;">Se você não esperava este e-mail, avise a chefia do seu setor. Mensagem automática — não responda.</p>'
    + '</div>';
  MailApp.sendEmail(email, 'Acesso ao AppSEL — senha temporária', '', { htmlBody: html });
}

// ── Recuperação de senha ──────────────────────────────────────────────────
function solicitarResetSenhaApp(matricula) {
  return _withAppLockResult_('recuperar senha', function() {
    var lista = _getServidoresApp_();
    var users = _authSyncServidores_(lista);
    var mat = _authNorm_(matricula);
    // Anti-enumeração: matrícula inexistente recebe a MESMA resposta de
    // sucesso (nada é enviado). Antes, "Matrícula não cadastrada" confirmava
    // publicamente quais matrículas existem. O caso "existe mas sem e-mail"
    // continua orientando o usuário real (ele conhece a própria matrícula).
    var servidor = (mat && users[mat]) ? lista.find(function(s) { return _authNorm_(s.matricula) === mat; }) : null;
    if (!servidor) return { ok: true, email: 'o e-mail cadastrado (se houver)' };

    var email = servidor.email || _emailServidorFallback_(servidor.nome) || '';
    if (!email || email.indexOf('@') < 0 || email.indexOf('COLE_') === 0) {
      throw new Error('Não há e-mail cadastrado para essa matrícula. Peça a outro chefe para resetar pela Config.');
    }

    var props = PropertiesService.getScriptProperties();
    var rateKey = 'SEL_RESET_TS_' + mat;
    var lastReset = Number(props.getProperty(rateKey) || 0);
    if (Date.now() - lastReset < 5 * 60 * 1000) {
      throw new Error('Aguarde alguns minutos antes de pedir outro reset.');
    }

    var temp = String(Math.floor(100000 + Math.random() * 900000));
    var salt = _authSalt_();
    users[mat].salt = salt;
    users[mat].hash = _authHash_(temp, salt);
    users[mat].mustChange = true;

    var html = '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">'
      + '<h2 style="font-size:18px;color:#1a3a5c;">Recuperação de senha - AppSEL</h2>'
      + '<p>Olá, <b>' + servidor.nome + '</b>.</p>'
      + '<p>Sua senha temporária é:</p>'
      + '<div style="font-size:24px;font-weight:800;letter-spacing:3px;background:#f1f5f9;border-radius:8px;padding:12px 16px;display:inline-block;">' + temp + '</div>'
      + '<p>Ao entrar, o AppSEL pedirá a troca dessa senha.</p>'
      + '<p style="font-size:12px;color:#64748b;">Se você não solicitou isso, avise a chefia do SEL/SEPMA.</p>'
      + '</div>';
    MailApp.sendEmail(email, 'Recuperação de senha - AppSEL', '', { htmlBody: html });
    _authSaveUsers_(users);
    props.setProperty(rateKey, String(Date.now()));
    return { ok: true, email: email.replace(/^(.{2}).*(@.*)$/, '$1***$2') };
  });
}

// ── getEtapasParaApp ──────────────────────────────────────────────────────
// Retorna todos os processos com etapas calculadas em cascata (contagem conforme MODO_CONTAGEM_PRAZOS).
// Inclui referência ao histórico de motivos para exibir o cadeado no app.
function getEtapasParaApp(authToken) {
  return _getEtapasParaApp_(_authRequire_(authToken, false));
}

function _getEtapasParaApp_(sess) {
  var ss = _ss_();

  // ── Processos ──────────────────────────────────────────────────────────
  var shP  = ss.getSheetByName(ABA_PROC);
  var lP   = _lerAba_(shP, 'ProcessoID');
  var hP   = lP.header;
  var iP   = {
    id:    hP.indexOf('ProcessoID'),
    num:   hP.indexOf('N° SUAP'),
    nome:  hP.indexOf('Objeto'),
    modal: hP.indexOf('Modalidade'),
    d0:    hP.indexOf('D0 (Data Abertura)'),
    irp:   hP.indexOf('Tem IRP?'),
    tipoCD: hP.indexOf('Tipo Contratação Direta'),
    proc:  hP.indexOf('Envio à Procuradoria?'),
    req:   hP.indexOf('Setor Requisitante'),
    suap:  hP.indexOf('Link SUAP'),
    emailR: hP.indexOf('EmailRequisitante'),
    ordem: hP.indexOf('OrdemFila')   // opcional: ordem manual da fila (chefia)
  };

  var procs = [];
  var filaPrevisao = []; // processos sem D0 (aguardando entrada na fila)
  var ordemFilaMap = {}; // pid → número de ordem manual (quando coluna existe)
  for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
    var r   = lP.values[i];
    var pid = String(r[iP.id] || '').trim();
    if (!pid) continue;
    if (iP.ordem >= 0) {
      var ordVal = parseFloat(r[iP.ordem]);
      if (!isNaN(ordVal)) ordemFilaMap[pid] = ordVal;
    }
    var d0 = _parseDate_(r[iP.d0]);
    if (!d0) {
      filaPrevisao.push({
        id:    pid,
        num:   String(r[iP.num]  || '').trim(),
        nome:  String(r[iP.nome] || '').trim(),
        modal: String(r[iP.modal]|| '').trim(),
        temIRP: iP.irp >= 0 ? String(r[iP.irp] || '').trim().toLowerCase() === 'sim' : false,
        tipoCD: iP.tipoCD >= 0 ? String(r[iP.tipoCD] || '').trim() : '',
        procuradoria: iP.proc >= 0 ? (String(r[iP.proc] || '').trim().toLowerCase() !== 'não' && String(r[iP.proc] || '').trim().toLowerCase() !== 'nao') : true,
        req:   iP.req >= 0 ? String(r[iP.req] || '').trim() : '',
        emailR: iP.emailR >= 0 ? String(r[iP.emailR] || '').trim() : '',
        suap:  String(r[iP.suap] || '#').trim()
      });
      continue;
    }
    procs.push({
      id:     pid,
      num:    String(r[iP.num]  || '').trim(),
      nome:   String(r[iP.nome] || '').trim(),
      modal:  String(r[iP.modal]|| '').trim(),
      d0:     d0,
      temIRP: String(r[iP.irp] || '').trim().toLowerCase() === 'sim',
      tipoCD: iP.tipoCD >= 0 ? String(r[iP.tipoCD] || '').trim() : '',
      procuradoria: iP.proc >= 0 ? (String(r[iP.proc] || '').trim().toLowerCase() !== 'não' && String(r[iP.proc] || '').trim().toLowerCase() !== 'nao') : true,
      req:    iP.req  >= 0 ? String(r[iP.req]  || '').trim() : '',
      emailR: iP.emailR >= 0 ? String(r[iP.emailR] || '').trim() : '',
      suap:   String(r[iP.suap] || '#').trim()
    });
  }

  // ── Etapas ─────────────────────────────────────────────────────────────
  var shE  = ss.getSheetByName(ABA_ETP);
  var lE   = _lerAba_(shE, 'ProcessoID');
  var hE   = lE.header;
  var iE   = {
    pid:    hE.indexOf('ProcessoID'),
    nome:   hE.indexOf('Etapa'),
    prazo:  hE.indexOf('Prazo (dias)'),
    status: hE.indexOf('StatusEtapa ◄ EDITAR'),
    motivo: hE.indexOf('MotivoAtraso ◄ EDITAR'),
    realiz: hE.indexOf('DataRealizacao◄ EDITAR'),
    agente: hE.indexOf('Agente Responsável'),
    fase:   hE.indexOf('Fase')
  };

  var etpPorProc = {};
  for (var j = lE.hIdx + 1; j < lE.values.length; j++) {
    var er    = lE.values[j];
    var epid  = String(er[iE.pid]  || '').trim();
    var enome = String(er[iE.nome] || '').trim();
    if (!epid || !enome) continue;
    if (!etpPorProc[epid]) etpPorProc[epid] = [];
    var faseEt = String(er[iE.fase] || '').trim();
    var statusEt = _normStatus_(er[iE.status]);
    if (_isEtapaContratual_(faseEt, enome)) statusEt = 'na';
    var realizEt = statusEt === 'ok' ? _parseDate_(er[iE.realiz]) : null;
    etpPorProc[epid].push({
      linha:  j + 1,  // linha real na planilha (1-based)
      nome:   enome,
      prazo:  parseInt(er[iE.prazo]) || 0,
      status: statusEt,
      motivo: String(er[iE.motivo] || '').trim(),
      realiz: realizEt,
      agente: String(er[iE.agente] || '').trim(),
      fase:   faseEt
    });
  }

  // ── Mapa ProcessoID → servidor por fase. Mantém o responsável cadastrado
  // mesmo quando a fase está inativa, pois regressões precisam desse vínculo.
  var shCap = ss.getSheetByName('📊 Capacidade');
  var servMap = {};
  if (shCap) {
    try {
      var capData = shCap.getRange(1,1,shCap.getLastRow(),shCap.getLastColumn()).getValues();
      var regHdr = -1;
      for (var ci = 0; ci < capData.length; ci++) {
        var cr = capData[ci].map(function(c){ return String(c).trim(); });
        if (cr[0].indexOf('Servidor') >= 0 && cr[2] === 'ProcessoID') { regHdr = ci; break; }
      }
      if (regHdr >= 0) {
        for (var ci2 = regHdr+1; ci2 < capData.length; ci2++) {
          var cr2 = capData[ci2];
          var cpid = String(cr2[2]||'').trim();
          var cserv = String(cr2[0]||'').trim();
          var cativo = cr2[3];
          var cfase = String(cr2[5]||'').trim().toLowerCase();
          if (cpid && cserv) {
            var nomeNorm = _fsNomeServ_(cserv);
            if (!servMap[cpid]) servMap[cpid] = { int: '', ext: '', hasInt: false, hasExt: false };
            if (cfase.indexOf('ext') >= 0) {
              servMap[cpid].hasExt = true;
              if (!servMap[cpid].ext || _isSim_(cativo)) servMap[cpid].ext = nomeNorm;
            } else {
              // fase interna ou sem fase especificada
              servMap[cpid].hasInt = true;
              if (!servMap[cpid].int || _isSim_(cativo)) servMap[cpid].int = nomeNorm;
            }
          }
        }
      }
    } catch(e2) {}
  }

  // ── Histórico de motivos (para exibir cadeado no app) ─────────────────
  var histMap = _histMap_();

  // ── Cascata de datas + montagem do resultado ───────────────────────────
  var resultado = procs.map(function(p) {
    // Etapas 'na' (Não se aplica — ex.: IRP sem SRP — e etapas contratuais,
    // forçadas a 'na' acima) ficam FORA do app: não são atribuição do SEL.
    // Filtrar antes da cascata mantém os índices (etapaAtualIdx) coerentes
    // com a lista exibida; o cursor já não avançava em etapas 'na'.
    _derivarCondicionaisLeitura_(p, etpPorProc[p.id] || []);
    var etapas = (etpPorProc[p.id] || []).filter(function(et) {
      return et.status !== 'na';
    });
    var cursor = new Date(p.d0.getTime());
    var etapaAtualIdx = -1;

    var etCalc = etapas.map(function(et, idx) {
      var ini     = new Date(cursor.getTime());
      var fimPrev = _addDU_(ini, et.prazo);
      var atraso  = 0;

      if (et.realiz) {
        atraso = Math.max(0, _contDU_(fimPrev, et.realiz));
        cursor = new Date(et.realiz.getTime());
      } else if (et.status !== 'na') {
        cursor = new Date(fimPrev.getTime());
      }

      if (etapaAtualIdx < 0 && et.status !== 'ok' && et.status !== 'na') {
        etapaAtualIdx = idx;
      }

      var histKey = p.id + '||' + et.nome;
      var retornoFilaEt = et.status === 'retornado' || _isRetornoFilaMotivo_(et.motivo);
      return {
        linha:         et.linha,
        prazo:         et.prazo,
        nome:          et.nome,
        agente:        et.agente,
        fase:          et.fase,
        status:        et.status,
        retornoFila:   retornoFilaEt,
        motivo:        et.motivo,
        dias:          atraso,
        ini_iso:       _toIso_(ini),
        fim_iso:       _toIso_(fimPrev),
        realizacao_iso: et.realiz ? _toIso_(et.realiz) : null,
        historico:     histMap[histKey] || null  // {tsStr, servidor, motivo, dias}
      };
    });

    // Status geral e percentual
    var semNA    = etCalc.filter(function(e) { return e.status !== 'na'; });
    var concl    = semNA.filter(function(e) { return e.status === 'ok'; }).length;
    var execucao = semNA.length ? Math.round(concl / semNA.length * 100) : 0;

    var retornoFila = etCalc.some(function(e){ return e.retornoFila; });
    var st = 'planejamento';
    if (execucao === 100)                                          st = 'ok';
    else if (etCalc.some(function(e){ return e.status==='atrasado';  })) st = 'atrasado';
    else if (etCalc.some(function(e){ return e.status==='aguardando';})) st = 'aguardando';
    else if (etCalc.some(function(e){ return e.status==='paralisado';})) st = 'paralisado';
    else if (etCalc.some(function(e){ return e.status==='andamento'; })) st = 'andamento';
    else if (concl > 0)                                                 st = 'andamento';
    else if (etCalc.some(function(e){ return e.status==='retornado'; })) st = 'retornado';

    // modalAbrev: 'PE' para Pregão/Concorrência, 'CD' para Contratação Direta/Dispensa
    var mNorm = p.modal.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    var mAbrev = (mNorm.indexOf('pregao') >= 0 || mNorm.indexOf('concorr') >= 0) ? 'PE' : 'CD';

    // Badge fallback: se o processo não está na Capacidade, usa o Agente da aba Etapas
    var srvInt = servMap[p.id] ? (servMap[p.id].int || '') : '';
    var srvExt = servMap[p.id] ? (servMap[p.id].ext || '') : '';
    if (!srvInt && (!servMap[p.id] || !servMap[p.id].hasInt)) {
      for (var fi = 0; fi < etapas.length; fi++) {
        if ((etapas[fi].fase||'').toLowerCase().indexOf('ext') < 0 && etapas[fi].agente) {
          srvInt = etapas[fi].agente; break;
        }
      }
    }
    if (!srvExt && (!servMap[p.id] || !servMap[p.id].hasExt)) {
      for (var fe = 0; fe < etapas.length; fe++) {
        if ((etapas[fe].fase||'').toLowerCase().indexOf('ext') >= 0 && etapas[fe].agente) {
          srvExt = etapas[fe].agente; break;
        }
      }
    }

    var etapaRetornada = etCalc.find(function(e){ return e.retornoFila; }) || null;

    return {
      id: p.id, num: p.num || p.id, nome: p.nome, modal: p.modal, modalAbrev: mAbrev,
      temIRP: p.temIRP, tipoCD: p.tipoCD, procuradoria: p.procuradoria,
      req: p.req, emailR: p.emailR, suap: p.suap, d0_iso: _toIso_(p.d0),
      execucao: execucao, status: st,
      retornoFila: retornoFila,
      motivoFila: etapaRetornada ? etapaRetornada.motivo : '',
      servidor:    srvInt,
      servidorExt: srvExt,
      etapaAtualIdx: etapaAtualIdx,
      etapas: etCalc
    };
  });

  // Ordena: atrasado → aguardando → paralisado → retornado → andamento → planejamento → ok
  var ORD = { atrasado:0, aguardando:1, paralisado:2, retornado:3, andamento:4, planejamento:5, ok:6 };
  resultado.sort(function(a, b) {
    var oa = Object.prototype.hasOwnProperty.call(ORD, a.status) ? ORD[a.status] : 6;
    var ob = Object.prototype.hasOwnProperty.call(ORD, b.status) ? ORD[b.status] : 6;
    return oa - ob;
  });

  // Enriquece filaPrevisao com prazos das etapas (para simulação no app)
  filaPrevisao = filaPrevisao.map(function(fp) {
    var ets = etpPorProc[fp.id] || [];
    _derivarCondicionaisLeitura_(fp, ets);
    fp.etapasPrazos = ets.map(function(e) {
      return { nome: e.nome, prazo: e.prazo, fase: e.fase, status: e.status };
    });
    fp.servidor    = servMap[fp.id] ? (servMap[fp.id].int || '') : '';
    fp.servidorExt = servMap[fp.id] ? (servMap[fp.id].ext || '') : '';
    fp.ordemFila   = ordemFilaMap.hasOwnProperty(fp.id) ? ordemFilaMap[fp.id] : null;
    return fp;
  });

  // Anexa a ordem manual também aos processos (retornados/planejamento entram na fila)
  resultado.forEach(function(p) {
    p.ordemFila = ordemFilaMap.hasOwnProperty(p.id) ? ordemFilaMap[p.id] : null;
  });

  // Ordena a fila de previsão pela ordem manual quando definida (nulos ao fim, ordem estável)
  filaPrevisao = _ordenarPorFila_(filaPrevisao);

  return {
    processos: resultado,
    filaPrevisao: sess.isChefe ? filaPrevisao : [],
    ordemFilaDisponivel: iP.ordem >= 0,
    calendario: _calendarioPayload_()
  };
}

// Ordena uma lista de processos pela ordem manual da fila (campo ordemFila).
// Itens com ordem definida vêm primeiro (crescente); os sem ordem mantêm a
// posição relativa original ao fim. Estável.
function _ordenarPorFila_(lista) {
  return lista
    .map(function(item, idx) { return { item: item, idx: idx }; })
    .sort(function(a, b) {
      var oa = (a.item.ordemFila === null || a.item.ordemFila === undefined) ? Infinity : a.item.ordemFila;
      var ob = (b.item.ordemFila === null || b.item.ordemFila === undefined) ? Infinity : b.item.ordemFila;
      if (oa !== ob) return oa - ob;
      return a.idx - b.idx;
    })
    .map(function(w) { return w.item; });
}

// ── iniciarProcessos ──────────────────────────────────────────────────────
// Define D0 para processos da fila, tornando-os ativos na aba Etapas.
// params: [{pid, d0 (YYYY-MM-DD), servidor, servidorExt}]
function iniciarProcessos(params, authToken) {
  return _withAppLockResult_('iniciar processos', function() {
    try {
    _authRequire_(authToken || (params && params.authToken), true);
    var ss  = _ss_();
    var shP = ss.getSheetByName(ABA_PROC);
    var shE = ss.getSheetByName(ABA_ETP);
    var lP  = _lerAba_(shP, 'ProcessoID');
    var hP  = lP.header;
    var iId = hP.indexOf('ProcessoID');
    var iD0 = hP.indexOf('D0 (Data Abertura)');
    var iModal = hP.indexOf('Modalidade');
    var iStatusProc = hP.indexOf('Status');
    if (iId < 0 || iD0 < 0) throw new Error('Colunas não encontradas na aba Processos.');

    var lE   = _lerAba_(shE, 'ProcessoID');
    var hE   = lE.header;
    var iPid = hE.indexOf('ProcessoID');
    var iAg  = hE.indexOf('Agente Responsável');
    var iFas = hE.indexOf('Fase');
    var iNom = hE.indexOf('Etapa');
    var iSta = hE.indexOf('StatusEtapa ◄ EDITAR');
    var iMot = hE.indexOf('MotivoAtraso ◄ EDITAR');
    var iDat = hE.indexOf('DataRealizacao◄ EDITAR');

    var modalPorPid = {};
    for (var mp = lP.hIdx + 1; mp < lP.values.length; mp++) {
      var mpid = String(lP.values[mp][iId] || '').trim();
      if (mpid) modalPorPid[mpid] = iModal >= 0 ? String(lP.values[mp][iModal] || '').trim() : '';
    }

    var iniciados = 0;
    params.forEach(function(item) {
      var d0Obj = new Date(item.d0 + 'T12:00:00');
      var modalidadeProc = modalPorPid[item.pid] || item.modal || '';
      var extSegregada = _isModalidadeExtSegregada_(modalidadeProc);
      if (extSegregada && item.servidor && item.servidorExt && item.servidor === item.servidorExt) {
        throw new Error('Fase interna e fase externa precisam ter responsáveis diferentes em Pregão/Concorrência.');
      }
      // Grava o D0 escolhido na fila.
      for (var r = lP.hIdx + 1; r < lP.values.length; r++) {
        if (String(lP.values[r][iId]||'').trim() === item.pid) {
          if (item.d0) {
            shP.getRange(r + 1, iD0 + 1).setValue(d0Obj).setNumberFormat('DD/MM/YYYY');
          }
          if (iStatusProc >= 0) _setValorPreservandoValidacao_(shP.getRange(r + 1, iStatusProc + 1), 'Em andamento');
          iniciados++;
          break;
        }
      }

      var primeiraEtapa = 0;
      for (var j = lE.hIdx + 1; j < lE.values.length; j++) {
        var epid = String(lE.values[j][iPid]||'').trim();
        if (epid !== item.pid) continue;
        var efaseRaw = String(iFas >= 0 ? lE.values[j][iFas] : '').trim();
        var efase = efaseRaw.toLowerCase();
        var enome = iNom >= 0 ? String(lE.values[j][iNom] || '').trim() : '';
        var isExt = efase.indexOf('ext') >= 0;
        var agente = isExt
          ? (extSegregada ? (item.servidorExt || '') : (item.servidorExt || item.servidor || ''))
          : (item.servidor || '');
        if (iAg >= 0) shE.getRange(j + 1, iAg + 1).setValue(agente);
        // Limpa qualquer marcador de retorno preso (inclusive em etapas 'na'):
        // senão o processo continua detectado como retornado e não sai da fila.
        if (iMot >= 0 && _isRetornoFilaMotivo_(lE.values[j][iMot])) {
          shE.getRange(j + 1, iMot + 1).clearContent();
        }
        if (!primeiraEtapa && !_isEtapaContratual_(efaseRaw, enome)) {
          var stEt = iSta >= 0 ? _normStatus_(lE.values[j][iSta]) : 'pendente';
          if (stEt !== 'ok' && stEt !== 'na') primeiraEtapa = j + 1;
        }
      }
      if (primeiraEtapa && iSta >= 0) {
        _setValorPreservandoValidacao_(shE.getRange(primeiraEtapa, iSta + 1), 'Em andamento');
        if (iMot >= 0) shE.getRange(primeiraEtapa, iMot + 1).clearContent();
        if (iDat >= 0) shE.getRange(primeiraEtapa, iDat + 1).clearContent();
      }
      _setCapacidadeAtivo_(item.pid, 'interna', 'Sim');
      _setCapacidadeAtivo_(item.pid, 'externa', 'Não');
    });
    _sincronizarCapacidadeComEtapas_();
    _limparCacheCapacidade_();
    return { ok: true, iniciados: iniciados };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── concluirEtapa ─────────────────────────────────────────────────────────
// Chamada pelo app ao confirmar a conclusão de uma etapa.
// params: {linhaEtapa, processoId, nomeEtapa, dataRealizacao (YYYY-MM-DD),
//          motivo, servidor, diasAtraso}
// Grava na planilha E appenda no histórico (append-only).
// ── _d0DoProcesso_: retorna a D0 (Date) do processo, ou null ──
function _d0DoProcesso_(pid) {
  var shP = _ss_().getSheetByName(ABA_PROC);
  var lP  = _lerAba_(shP, 'ProcessoID');
  var iId = lP.header.indexOf('ProcessoID');
  var iD0 = lP.header.indexOf('D0 (Data Abertura)');
  if (iId < 0 || iD0 < 0) return null;
  var alvo = String(pid || '').trim();
  for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
    if (String(lP.values[i][iId] || '').trim() === alvo) return _parseDate_(lP.values[i][iD0]);
  }
  return null;
}

function concluirEtapa(params) {
  return _withAppLockResult_('concluir etapa', function() {
    try {
    _authRequire_(params && params.authToken, false);
    var sh  = _ss_().getSheetByName(ABA_ETP);
    var lEt = _lerAba_(sh, 'ProcessoID');
    var hdr = lEt.header;

    var cR = hdr.indexOf('DataRealizacao◄ EDITAR') + 1; // sem espaço antes do ◄
    var cM = hdr.indexOf('MotivoAtraso ◄ EDITAR')  + 1; // com espaço
    var cS = hdr.indexOf('StatusEtapa ◄ EDITAR')   + 1;

    if (!cR || !cS) throw new Error('Colunas não encontradas. Verifique o cabeçalho da aba Etapas.');

    // TRAVA 1: data obrigatória ao concluir
    if (!params.dataRealizacao) return { ok: false, erro: 'Informe a data de conclusão da etapa antes de concluir.' };
    var dataObj = new Date(params.dataRealizacao + 'T12:00:00');
    if (isNaN(dataObj.getTime())) return { ok: false, erro: 'Data de conclusão inválida.' };

    // TRAVA 2: data não pode ser anterior à abertura (D0)
    var d0Proc = _d0DoProcesso_(params.processoId);
    if (d0Proc && dataObj < d0Proc) {
      return { ok: false, erro: 'A data de conclusão (' + _toIso_(dataObj).split('-').reverse().join('/') +
        ') é anterior à abertura do processo (' + _toIso_(d0Proc).split('-').reverse().join('/') + '). Verifique a data informada.' };
    }

    sh.getRange(params.linhaEtapa, cR).setValue(dataObj).setNumberFormat('DD/MM/YYYY');
    sh.getRange(params.linhaEtapa, cS).setValue('Concluída');

    if (params.motivo && params.motivo.trim() && cM) {
      sh.getRange(params.linhaEtapa, cM).setValue(params.motivo.trim());
    }

    // Appenda no histórico imutável
    _appendHist_({
      ts:         new Date(),
      pid:        params.processoId,
      etapa:      params.nomeEtapa,
      servidor:   params.servidor || '—',
      motivo:     params.motivo   || '',
      dias:       params.diasAtraso || 0,
      dataRealiz: params.dataRealizacao
    });

    // ── Verifica transição de fase interna → externa ───────────────
    // Detecta se esta era a última etapa da fase interna ainda não concluída.
    // Se sim: desativa a linha de fase interna na Capacidade (Ativo = Não),
    // sinalizando que aquele servidor concluiu sua parte e a carga deixa de contar.
    var transicao = _verificarTransicaoFase_(params.processoId, params.linhaEtapa, sh, lEt, hdr);
    _sincronizarCapacidadeComEtapas_();
    _limparCacheCapacidade_();
    return { ok: true, transicaoFase: transicao.feita, servidorExt: transicao.servidorExt };

  } catch(e) {
    return { ok: false, erro: e.message };
  }
  });
}

// ── _verificarTransicaoFase_ ──────────────────────────────────────────────
// Verifica se, após a conclusão da etapa indicada, todas as etapas de
// Fase Interna do processo estão concluídas. Se sim, inativa a linha de
// fase interna na Capacidade (Ativo = Não), preservando os pontos para
// possível retorno de fase.
// Retorna { feita: bool, servidorExt: string }.
function _verificarTransicaoFase_(pid, linhaConcluidaBase1, shEtapas, lEt, hdr) {
  var iPid = hdr.indexOf('ProcessoID');
  var iFas = hdr.indexOf('Fase');
  var iNom = hdr.indexOf('Etapa');
  var iStat = hdr.indexOf('StatusEtapa ◄ EDITAR');
  if (iPid < 0 || iFas < 0 || iStat < 0) return { feita: false, servidorExt: '' };

  var hasInterna = false, allIntOk = true, hasExterna = false;

  for (var j = lEt.hIdx + 1; j < lEt.values.length; j++) {
    var er    = lEt.values[j];
    var epid  = String(er[iPid] || '').trim();
    if (epid !== pid) continue;
    var efase = String(iFas >= 0 ? er[iFas] : '').trim().toLowerCase();
    var enome = iNom >= 0 ? String(er[iNom] || '').trim() : '';
    if (_isEtapaContratual_(efase, enome)) continue;
    var estat = _normStatus_(String(er[iStat] || '').trim());
    var elinha = j + 1; // 1-based

    if (efase.indexOf('ext') >= 0) {
      // Só conta como "tem fase externa" se ela realmente se aplica. Em
      // Contratação Direta sem disputa / inexigibilidade / adesão a etapa de
      // fase externa existe mas fica 'na' (não se aplica) — nesses casos não há
      // transição de fase nem atribuição de pontos ao próximo servidor.
      if (estat !== 'na') hasExterna = true;
    } else {
      hasInterna = true;
      // A etapa que acabamos de concluir (linhaConcluidaBase1) é tratada como ok
      if (elinha !== linhaConcluidaBase1 && estat !== 'ok' && estat !== 'na') {
        allIntOk = false;
      }
    }
  }

  // CD sem fase externa aplicável: a fase interna concluída encerra o processo.
  // Não há transição (nem mensagem/pontos ao próximo servidor), mas as cargas
  // devem ser inativadas na origem — sem isso o dado fica "Sim" para sempre e
  // só a leitura da Capacidade (que exclui concluídos) compensa.
  var concluiuSemExterna = hasInterna && allIntOk && !hasExterna;

  // Só há transição se havia fase interna, ela está toda concluída E há fase externa
  if (!concluiuSemExterna && (!hasInterna || !allIntOk || !hasExterna)) {
    return { feita: false, servidorExt: '' };
  }

  // Atualiza as linhas do processo na Capacidade:
  //  - transição: interna → 'Não', externa → 'Sim' (assume a fase externa)
  //  - concluiuSemExterna: todas → 'Não' (processo encerrado)
  var servidorExt = '';
  try {
    var shCap = _ss_().getSheetByName('📊 Capacidade');
    if (!shCap) return { feita: !concluiuSemExterna, servidorExt: '' };

    var capData = shCap.getRange(1, 1, shCap.getLastRow(), shCap.getLastColumn()).getValues();
    var regHdr = -1;
    for (var ci = 0; ci < capData.length; ci++) {
      var cr = capData[ci].map(function(c){ return String(c).trim(); });
      if (cr[0].indexOf('Servidor') >= 0 && cr[2] === 'ProcessoID') { regHdr = ci; break; }
    }
    if (regHdr < 0) return { feita: !concluiuSemExterna, servidorExt: '' };

    var hCap  = capData[regHdr].map(function(c){ return String(c).trim(); });
    var iAtivo = hCap.indexOf('Ativo');
    if (iAtivo < 0) return { feita: !concluiuSemExterna, servidorExt: '' };

    for (var r = regHdr + 1; r < capData.length; r++) {
      var cpid  = String(capData[r][2] || '').trim();
      if (cpid !== pid) continue;
      var cfase = String(capData[r][5] || '').trim().toLowerCase();
      var cserv = String(capData[r][0] || '').trim();
      if (!concluiuSemExterna && cfase.indexOf('ext') >= 0) {
        servidorExt = _fsNomeServ_(cserv);
        shCap.getRange(r + 1, iAtivo + 1).setValue('Sim');
      } else {
        // Fase interna (ou processo encerrado sem externa): inativa
        shCap.getRange(r + 1, iAtivo + 1).setValue('Não');
      }
    }
  } catch(e2) { /* silencioso — a conclusão em si já foi salva */ }

  return { feita: !concluiuSemExterna, servidorExt: servidorExt };
}

// ── getHistorico ──────────────────────────────────────────────────────────
// Retorna todos os registros do histórico, ordenados do mais recente.
function getHistorico(authToken) {
  _authRequire_(authToken, true);
  var ss = _ss_();
  var sh = ss.getSheetByName(ABA_HIST);
  if (!sh || sh.getLastRow() < 2) return [];

  // Mapa pid -> { objeto, suap } para exibir o NOME do processo (e link SUAP)
  // no lugar do ProcessoID, que nao diz nada ao usuario.
  var procInfo = {};
  (function() {
    var shP = ss.getSheetByName(ABA_PROC);
    if (!shP) return;
    var lP = _lerAba_(shP, 'ProcessoID');
    var iId  = lP.header.indexOf('ProcessoID');
    var iObj = lP.header.indexOf('Objeto');
    var iSua = lP.header.indexOf('Link SUAP');
    if (iId < 0) return;
    for (var k = lP.hIdx + 1; k < lP.values.length; k++) {
      var p = String(lP.values[k][iId] || '').trim();
      if (!p) continue;
      procInfo[p] = {
        objeto: iObj >= 0 ? String(lP.values[k][iObj] || '').trim() : '',
        suap:   iSua >= 0 ? String(lP.values[k][iSua] || '').trim() : ''
      };
    }
  })();

  var data = sh.getDataRange().getValues();
  var r = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var pid = String(row[1] || '').trim();
    var etapa = String(row[2] || '').trim();
    var motivo = String(row[4] || '').trim();
    if (!pid || !etapa || !motivo) continue;
    var info = procInfo[pid] || {};
    var suap = info.suap || '';
    if (suap === '#') suap = '';
    r.push({
      ts: row[0] instanceof Date ? row[0].getTime() : 0,
      tsStr: row[0] instanceof Date ? row[0].toLocaleDateString('pt-BR') : String(row[0]),
      pid: pid,
      objeto: info.objeto || '',
      suap: suap,
      etapa: etapa,
      servidor: String(row[3] || '').trim(),
      motivo: motivo,
      dias: parseInt(row[5]) || 0,
      dataRealiz: String(row[6] || '').trim()
    });
  }
  r.sort(function(a, b) { return (b.ts || 0) - (a.ts || 0); });
  return r;
}

// ── _histMap_ ─────────────────────────────────────────────────────────────
// Retorna mapa {processoId||nomeEtapa → primeiro motivo do CICLO ATUAL}.
// "Primeiro do ciclo" = registro imutável da conclusão vigente da etapa.
//
// Regras (corrige o bug de exibir servidor/data de um ciclo anterior):
//   • 'REGRESSAO:' reabre a etapa → descarta o registro anterior; o próximo
//     motivo registrado passa a ser o exibido no cadeado.
//   • 'RETORNO PARA FILA:' é marca operacional, não é motivo de atraso de
//     conclusão → nunca aparece no cadeado.
// Sem isso, uma etapa reconcluida pela Beatriz exibia o registro antigo da
// Amanda (entrada mais velha da aba de histórico).
function _histMap_() {
  var ss = _ss_();
  var sh = ss.getSheetByName(ABA_HIST);
  if (!sh || sh.getLastRow() < 2) return {};
  var data = sh.getDataRange().getValues();
  var mapa = {};
  // Colunas: Timestamp | ProcessoID | Etapa | Servidor | Motivo | DiasAtraso | DataRealizacao
  for (var i = 1; i < data.length; i++) {
    var r   = data[i];
    var pid = String(r[1] || '').trim();
    var nom = String(r[2] || '').trim();
    if (!pid || !nom) continue;
    var k   = pid + '||' + nom;
    var mot = String(r[4] || '').trim();
    var motNorm = _normText_(mot);
    if (motNorm.indexOf('regressao:') === 0) { delete mapa[k]; continue; } // etapa reaberta → novo ciclo
    if (motNorm.indexOf('retorno para fila:') === 0) continue;            // marca operacional, ignora
    if (mot && !mapa[k]) {   // guarda só o primeiro registro do ciclo (imutável)
      mapa[k] = {
        ts:        r[0] instanceof Date ? r[0].getTime() : 0,
        tsStr:     r[0] instanceof Date ? r[0].toLocaleDateString('pt-BR') : String(r[0]),
        pid:       pid,
        etapa:     nom,
        servidor:  String(r[3] || '').trim(),
        motivo:    mot,
        dias:      parseInt(r[5]) || 0,
        dataRealiz: String(r[6] || '').trim()
      };
    }
  }
  return mapa;
}

// ── _appendHist_ ─────────────────────────────────────────────────────────
// Cria a aba __historico_motivos se não existir e appenda uma linha.
// Esta aba é marcada como oculta — nunca deve ser editada manualmente.
function _appendHist_(e) {
  var ss = _ss_();
  var sh = ss.getSheetByName(ABA_HIST);
  if (!sh) {
    sh = ss.insertSheet(ABA_HIST);
    sh.getRange(1, 1, 1, 7).setValues([[
      'Timestamp','ProcessoID','Etapa','Servidor','Motivo','DiasAtraso','DataRealizacao'
    ]]);
    sh.getRange(1, 1, 1, 7).setFontWeight('bold').setBackground('#E8F0FE');
    sh.hideSheet();
  }
  sh.appendRow([e.ts, e.pid, e.etapa, e.servidor, e.motivo, e.dias, e.dataRealiz]);
}

// ── enviarAvisosPrazo ─────────────────────────────────────────────────────
// Triggers de segunda a sexta: prazos proximos as 10h30 e vencidos as 14h.
// REGRA: no máximo 2 e-mails por etapa/prazo (cota do Gmail ~100/dia):
//   1. Aviso antecipado — quando a etapa entra na janela de DIAS_AVISO dias
//   2. Aviso do vencimento — no dia D ("Vence hoje", 10h30); se o dia D cair
//      em fim de semana ou a execução falhar, sai no primeiro dia útil
//      seguinte pela rotina das 14h como "vencida há X dias" (recuperação,
//      debita a mesma cota — nunca há um 3º e-mail)
//
// Destinatários:
//   Processo suspenso/paralisado:
//     → não envia e-mail
//   Processo aguardando requisitante:
//     → somente Setor Requisitante, se houver EmailRequisitante cadastrado
//   Processo da chefia (servidor responsável = chefe ou sem servidor):
//     → Chefia do SEL + Setor Requisitante
//   Processo de servidor:
//     → Chefia do SEL + Servidor responsável + Setor Requisitante
//
// Não envia para processos concluídos (ok), planejamento/a iniciar, suspensos ou devolvidos para a fila.
function _avisosPodeEnviarHoje_(data) {
  var d = data || new Date();
  var dow = d.getDay();
  return dow !== 0 && dow !== 6;
}

// ── Estado "aviso já enviado" (deduplicação) ──────────────────────────────
// Estratégia conservadora de envio: cada etapa gera no MÁXIMO 1 e-mail de
// "prazo próximo" e 1 de "vencido" na sua vida — e não um por dia útil como
// antes. O estado é escopado por unidade (via _FS_UNIDADE_REQ): vai para o
// Firestore quando FS_ATIVO='true', senão para uma aba oculta da planilha.
// A chave inclui o fim_iso da etapa: se o prazo for remarcado, um novo aviso
// volta a ser permitido.
var ABA_AVISOS    = '__avisos_enviados'; // aba oculta, append-only (last-wins na leitura)
var FS_COL_AVISOS = 'avisosEnviados';    // coleção Firestore por unidade

function _avisoUsaFirestore_() {
  return typeof _fsServerAtivo_ === 'function' && _fsServerAtivo_();
}

// Chave estável da etapa: unidade | processo | índice da etapa | tipo.
// Usa o índice (e não o nome) para tolerar etapas com nomes repetidos.
function _chaveAvisoEtapa_(p, etIdx, tipo) {
  return _reqUni_() + '|' + String(p.id) + '|' + etIdx + '|' + tipo;
}

// Carrega o estado da unidade atual: { chave -> fim_iso já notificado }.
function _avisosCarregarEstado_() {
  var mapa = {};
  try {
    if (_avisoUsaFirestore_()) {
      _fs_().query(FS_COL_AVISOS).Execute().forEach(function(d) {
        var o = d.obj || {};
        if (o.chave) mapa[o.chave] = String(o.fimIso || '');
      });
    } else {
      var sh = _ss_().getSheetByName(ABA_AVISOS);
      if (sh && sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function(r) {
          var chave = String(r[0] || '');
          if (chave) mapa[chave] = String(r[1] || ''); // last-wins
        });
      }
    }
  } catch (e) {}
  return mapa;
}

// Marca a etapa/tipo como já avisada para o fim_iso informado.
function _avisoMarcar_(chave, fimIso) {
  try {
    if (_avisoUsaFirestore_()) {
      var docId = String(chave).replace(/[^A-Za-z0-9_-]/g, '_');
      _fsSet_(FS_COL_AVISOS + '/' + docId, {
        chave: String(chave), fimIso: String(fimIso || ''), enviadoEm: new Date()
      });
    } else {
      var ss = _ss_();
      var sh = ss.getSheetByName(ABA_AVISOS);
      if (!sh) {
        sh = ss.insertSheet(ABA_AVISOS);
        sh.getRange(1, 1, 1, 3).setValues([['Chave', 'FimIso', 'EnviadoEm']]);
        sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#E8F0FE');
        sh.hideSheet();
      }
      sh.appendRow([String(chave), String(fimIso || ''), new Date()]);
    }
  } catch (e) {}
}

function enviarAvisosPrazo(modo) {
  modo = String(modo || 'todos').toLowerCase();
  var enviarProximos = modo === 'todos' || modo === 'proximos';
  var enviarVencidos = modo === 'todos' || modo === 'vencidos';
  if (!enviarProximos && !enviarVencidos) {
    enviarProximos = true;
    enviarVencidos = true;
  }

  var agoraEnvio = new Date();
  if (!_avisosPodeEnviarHoje_(agoraEnvio)) {
    return 'Avisos nao enviados: rotina limitada a ' + AVISOS_DIAS_LABEL + '.';
  }

  var emailsConfig = _getEmails_({ isChefe: true, nome: 'Sistema' });
  // Fase 4: lê do Firestore quando FS_ATIVO='true'; senão da planilha.
  var dadosRaw = (typeof _dadosProcessosParaAvisos_ === 'function')
    ? _dadosProcessosParaAvisos_({ isChefe: true, nome: 'Sistema' })
    : _getEtapasParaApp_({ isChefe: true, nome: 'Sistema' });
  // Suporta tanto retorno antigo (array) quanto novo ({processos, filaPrevisao})
  var dados = (dadosRaw && dadosRaw.processos) ? dadosRaw.processos : (dadosRaw || []);

  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  // Servidores que são chefes do setor — processos deles não geram e-mail separado para agente
  var CHEFES_LISTA = _getServidoresApp_()
    .filter(function(s) { return s.isChefe; })
    .map(function(s) { return s.nome; });
  var chefiaEmails = [];
  CHEFES_LISTA.forEach(function(nome) {
    var em = emailsConfig[nome] || _emailServidorFallback_(nome) || '';
    if (isChefiaEmail(em) && chefiaEmails.indexOf(em) < 0) chefiaEmails.push(em);
  });
  var chefiaFallback = _chefiaEmailFallback_();
  if (isChefiaEmail(chefiaFallback) && chefiaEmails.indexOf(chefiaFallback) < 0) {
    chefiaEmails.push(chefiaFallback);
  }

  function isChefiaEmail(e) { return e && e.indexOf('@') > 0 && !e.startsWith('COLE'); }

  // Monta o cabeçalho HTML dos e-mails
  function htmlHeader_(titulo, subtitulo) {
    return '<div style="font-family:Arial,sans-serif;max-width:640px;color:#1e293b;line-height:1.45;">'
      + '<div style="background:#1a3a5c;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">'
      + (subtitulo ? '<p style="margin:0 0 5px;font-size:12px;opacity:.82;">' + subtitulo + '</p>' : '')
      + '<h2 style="margin:0;font-size:18px;">' + titulo + '</h2>'
      + '</div><div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:18px;">';
  }

  function enviar_(dest, assunto, htmlBody) {
    if (isChefiaEmail(dest)) {
      try {
        MailApp.sendEmail(dest, assunto, '', { htmlBody: htmlBody + '</div></div>' });
        return true;
      } catch(e) {}
    }
    return false;
  }

  function htmlEsc_(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function isoParaBR_(iso) {
    if (!iso) return '';
    var p = String(iso).substring(0, 10).split('-');
    return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : String(iso);
  }

  function linkValido_(url) {
    url = String(url || '').trim();
    return url && url !== '#' && /^https?:\/\//i.test(url);
  }

  function processoNomeHtml_(p) {
    return htmlEsc_(p.nome || 'Processo sem identificação');
  }

  function processoRefHtml_(p) {
    var nome = processoNomeHtml_(p);
    if (p.num) {
      var num = htmlEsc_(p.num);
      var suap = String(p.suap || '').trim();
      var suapHtml = linkValido_(suap)
        ? '<a href="' + htmlEsc_(suap) + '" style="color:#1d4ed8;text-decoration:none;font-weight:700;">' + num + '</a>'
        : '<b>' + num + '</b>';
      return '<b>' + nome + '</b> (N° SUAP ' + suapHtml + ')';
    }
    return '<b>' + nome + '</b>';
  }

  function processoRefTexto_(p) {
    return p.num ? p.num : (p.nome || 'Processo');
  }

  function respGenerico_(nome) {
    var n = String(nome || '').toLowerCase();
    return !n
      || n.indexOf('equipe') >= 0
      || n.indexOf('planejamento') >= 0
      || n.indexOf('decof') >= 0
      || n.indexOf('diad') >= 0
      || n.indexOf('setor') >= 0;
  }

  // Classifica os avisos
  var avisosProximos = [];
  var avisosVencidos = [];

  dados.forEach(function(p) {
    // Pula apenas concluídos, processos ainda não iniciados e devolvidos para a fila.
    // Status como "em andamento", "aguardando" ou "paralisado" continuam avisando
    // até a etapa ser efetivamente concluída.
    if (p.status === 'ok' || p.status === 'planejamento' || p.retornoFila) return;

    p.etapas.forEach(function(et, etIdx) {
      if (et.status === 'ok' || et.status === 'na' || et.retornoFila || !et.fim_iso) return;
      var fim  = new Date(et.fim_iso + 'T00:00:00');
      var diff = _contDU_(hoje, fim); // positivo = dias até vencer; negativo = já venceu
      var aguardaReq = p.status === 'aguardando' || et.status === 'aguardando';

      if (diff >= 0 && diff <= DIAS_AVISO) {
        avisosProximos.push({ p: p, et: et, etIdx: etIdx, dias: diff, aguardandoReq: aguardaReq });
      } else if (diff < 0) {
        avisosVencidos.push({ p: p, et: et, etIdx: etIdx, diasAtraso: -diff, aguardandoReq: aguardaReq });
      }
    });
  });

  // REGRA DE ENVIO (máx. 2 e-mails por etapa, para poupar a cota diária do
  // Gmail): 1º aviso com DIAS_AVISO dias de antecedência ('proximo') e 2º
  // aviso no dia do VENCIMENTO ('vencimento'). Sem terceiro e-mail de
  // "vencida": o aviso de vencida só existe como RECUPERAÇÃO do 2º — quando o
  // dia D caiu em fim de semana (a rotina roda seg–sex) ou a execução falhou,
  // ele sai no primeiro dia útil seguinte como "vencida há X dias", debitando
  // a MESMA chave 'vencimento'. Uma etapa nunca recebe os dois.
  function _tipoDedupProximo_(av) { return av.dias === 0 ? 'vencimento' : 'proximo'; }

  // Deduplicação: remove avisos cuja etapa já foi notificada para este fim_iso
  // (com o tipo correspondente), em vez de reenvio diário. Se o prazo mudou, o
  // fim_iso difere e o aviso volta a ser permitido.
  var jaEnviado = _avisosCarregarEstado_();
  function _naoAvisado_(av, tipo) {
    var ch = _chaveAvisoEtapa_(av.p, av.etIdx, tipo);
    return jaEnviado[ch] !== String(av.et.fim_iso || '');
  }
  avisosProximos = avisosProximos.filter(function(av) { return _naoAvisado_(av, _tipoDedupProximo_(av)); });
  // Vencidos = só recuperação do aviso de vencimento perdido. Também respeita
  // a chave legada 'vencido' (enviada por versões anteriores), para não
  // reenviar em massa para etapas antigas já notificadas.
  avisosVencidos = avisosVencidos.filter(function(av) {
    return _naoAvisado_(av, 'vencimento') && _naoAvisado_(av, 'vencido');
  });

  var total = (enviarProximos ? avisosProximos.length : 0) + (enviarVencidos ? avisosVencidos.length : 0);
  if (!total) return 'Nenhum aviso para enviar hoje.';

  var enviados = 0;
  var appAssinatura = '<br><br>Atenciosamente,<br><b>Gestão de Etapas - SEL</b>'
    + '<br><span style="color:#64748b;font-size:12px;">Mensagem automática do Sistema.</span>';
  var contatoHtml = 'Em caso de dúvidas, entre em contato através do e-mail <a href="mailto:central@cp2.g12.br" style="color:#1d4ed8;text-decoration:none;font-weight:700;">central@cp2.g12.br</a>.';

  // Responsável de uma etapa (mesma regra do app): externo na fase externa,
  // senão interno; fallback ao Agente da etapa.
  function respDaEtapa_(p, et) {
    var faseEt = String(et.fase || '').toLowerCase();
    var respEtapa = String(et.agente || '').trim();
    var servidorFase = faseEt.indexOf('ext') >= 0
      ? (p.servidorExt || p.servidor || '')
      : (p.servidor || p.servidorExt || '');
    var respAtual = respGenerico_(respEtapa) ? servidorFase : respEtapa;
    if ((!respAtual || !(emailsConfig[respAtual] || _emailServidorFallback_(respAtual))) && servidorFase) {
      respAtual = servidorFase;
    }
    return { display: respEtapa || servidorFase || '', emailNome: respAtual, servidorFase: servidorFase };
  }

  // Nova data prevista de conclusão do processo dado o maior atraso entre as etapas vencidas.
  function novaDataConc_(p, maxAtraso) {
    var ultima = null;
    for (var ii = p.etapas.length - 1; ii >= 0; ii--) {
      if (p.etapas[ii].status !== 'na' && p.etapas[ii].fim_iso) { ultima = p.etapas[ii]; break; }
    }
    if (!ultima) return '';
    var base = new Date(ultima.fim_iso + 'T00:00:00');
    var nova = _addDU_(base, maxAtraso);
    return String(nova.getDate()).padStart(2,'0') + '/' + String(nova.getMonth()+1).padStart(2,'0') + '/' + nova.getFullYear();
  }

  // Linha (tr) de uma etapa na tabela do e-mail agrupado.
  // paraRequisitante: omite a célula de Responsável (nomes internos do SEL).
  function linhaEtapa_(av, tipo, paraRequisitante) {
    var et = av.et;
    var prazoTxt, cor;
    if (tipo === 'vencido') {
      cor = '#dc2626';
      prazoTxt = 'Vencida há ' + av.diasAtraso + ' dia' + (av.diasAtraso > 1 ? 's' : '');
    } else {
      cor = av.dias === 0 ? '#dc2626' : '#d97706';
      prazoTxt = av.dias === 0 ? 'Vence hoje' : 'Vence em ' + av.dias + ' dia' + (av.dias > 1 ? 's' : '');
    }
    var celulaResp = '';
    if (!paraRequisitante) {
      var resp = respDaEtapa_(av.p, et);
      var respTxt = resp.display ? htmlEsc_(resp.display) : '<span style="color:#94a3b8;">sem responsável cadastrado</span>';
      celulaResp = '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#475569;">' + respTxt + '</td>';
    }
    return '<tr>'
      + '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1e293b;">' + htmlEsc_(et.nome) + '</td>'
      + celulaResp
      + '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:' + cor + ';font-weight:700;white-space:nowrap;">' + htmlEsc_(prazoTxt) + '</td>'
      + '<td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;white-space:nowrap;">' + isoParaBR_(et.fim_iso) + '</td>'
      + '</tr>';
  }

  // Monta o corpo de um e-mail agrupado por processo, com a tabela das etapas passadas.
  // paraRequisitante: omite a coluna "Responsável" (nomes internos do SEL não
  // interessam ao setor requisitante) e usa um texto de cobrança focado no
  // impacto do atraso sobre o prazo final do processo.
  function corpoProcesso_(p, avisos, tipo, subtituloExtra, paraRequisitante) {
    var procRefHtml = processoRefHtml_(p);
    var n = avisos.length;
    var intro, novaDataStr = '';
    if (tipo === 'vencido') {
      var maxAtraso = 0;
      avisos.forEach(function(a){ if (a.diasAtraso > maxAtraso) maxAtraso = a.diasAtraso; });
      novaDataStr = novaDataConc_(p, maxAtraso);
      if (paraRequisitante) {
        intro = 'Prezado(a), o processo ' + procRefHtml + ' possui <b>' + n + ' etapa' + (n>1?'s vencidas':' vencida') + '</b> que dependem de providências do seu setor. '
          + 'Pedimos que regularize a pendência o quanto antes. '
          + (novaDataStr ? 'O atraso posterga a conclusão do processo: a nova previsão é <b>' + novaDataStr + '</b>. ' : '')
          + contatoHtml;
      } else {
        intro = 'Prezado(a), atenção! O processo ' + procRefHtml + ' possui <b>' + n + ' etapa' + (n>1?'s vencidas':' vencida') + '</b>. '
          + 'Veja abaixo as etapas e seus respectivos responsáveis. '
          + (novaDataStr ? 'Considerando o maior atraso, a previsão de conclusão do processo foi postergada para <b>' + novaDataStr + '</b>. ' : '')
          + contatoHtml;
      }
    } else {
      if (paraRequisitante) {
        intro = 'Prezado(a), o processo ' + procRefHtml + ' possui <b>' + n + ' etapa' + (n>1?'s com prazo próximo':' com prazo próximo') + '</b> que dependem de providências do seu setor. '
          + 'Pedimos atenção para evitar que o atraso postergue a conclusão do processo. ' + contatoHtml;
      } else {
        intro = 'Prezado(a), atenção! O processo ' + procRefHtml + ' possui <b>' + n + ' etapa' + (n>1?'s com prazo próximo':' com prazo próximo') + '</b>. '
          + 'Organize o que for necessário para evitar atrasos. ' + contatoHtml;
      }
    }
    var tabela = '<table style="width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;">'
      + '<thead><tr>'
      + '<th style="text-align:left;padding:8px 10px;background:#1a3a5c;color:#fff;border-radius:6px 0 0 0;">Etapa</th>'
      + (paraRequisitante ? '' : '<th style="text-align:left;padding:8px 10px;background:#1a3a5c;color:#fff;">Responsável</th>')
      + '<th style="text-align:left;padding:8px 10px;background:#1a3a5c;color:#fff;">Situação</th>'
      + '<th style="text-align:left;padding:8px 10px;background:#1a3a5c;color:#fff;border-radius:0 6px 0 0;">Prazo</th>'
      + '</tr></thead><tbody>';
    avisos.forEach(function(a){ tabela += linhaEtapa_(a, tipo, paraRequisitante); });
    tabela += '</tbody></table>';
    // Convite ao setor requisitante para acompanhar o processo no painel público
    var painelHtml = paraRequisitante
      ? '<p style="margin:14px 0 0;padding:12px 14px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;font-size:13px;">'
        + '💡 Para acompanhar as etapas e os prazos deste e dos demais processos de contratação, acesse o nosso '
        + '<a href="' + htmlEsc_(_painelUrl_()) + '" style="color:#1d4ed8;font-weight:700;">Painel de Contratações — Reitoria / SEL</a>.'
        + '</p>'
      : '';
    // Nota de recálculo: os prazos deste aviso são dinâmicos (cada etapa conta
    // a partir da conclusão REAL da anterior) e podem diferir do cronograma
    // emitido na abertura do processo — sem esta explicação, setores comparavam
    // com o PDF original e entendiam a diferença como erro do sistema.
    var notaRecalculo = '<p style="margin:12px 0 0;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:10px;">'
      + 'ℹ️ Os prazos deste aviso são <b>recalculados automaticamente</b>: cada etapa é contada, em dias corridos, '
      + 'a partir da conclusão efetiva da etapa anterior. Por isso, as datas podem diferir do cronograma emitido na abertura do processo — '
      + 'atrasos em etapas anteriores deslocam os prazos das etapas seguintes.'
      + '</p>';
    var subt = (tipo === 'vencido' ? '⚠️ Etapas vencidas' : '⏰ Prazos próximos') + (subtituloExtra ? ' · ' + subtituloExtra : '') + ' · Colégio Pedro II';
    return htmlHeader_('Gestão de Etapas - SEL', subt)
      + intro + tabela + painelHtml + notaRecalculo + appAssinatura;
  }

  // ── Processa um PROCESSO com todas as suas etapas de um tipo ───────────
  function processarProcesso(p, avisos, tipo) {
    var sentLocal = 0; // e-mails enviados nesta chamada (para confirmar a marcação)
    var procRefTexto = processoRefTexto_(p);
    var prefixoAssunto = tipo === 'vencido' ? '⚠️ Etapas vencidas' : '⏰ Prazos próximos';

    // Etapas "aguardando requisitante" nao geram e-mail para servidores comuns;
    // seguem para chefia e requisitante.
    var avisosSEL = avisos.filter(function(a){ return !a.aguardandoReq; });

    // 1. E-mail para cada SERVIDOR responsável — só com as etapas dele (exclui chefia).
    var porServidor = {}; // emailNome → { email, avisos: [] }
    avisosSEL.forEach(function(a) {
      var resp = respDaEtapa_(p, a.et);
      var nome = resp.emailNome;
      if (!nome || CHEFES_LISTA.indexOf(nome) >= 0) return; // chefia recebe no bloco 2
      var email = emailsConfig[nome] || _emailServidorFallback_(nome) || '';
      if (!isChefiaEmail(email)) return;
      if (!porServidor[nome]) porServidor[nome] = { email: email, avisos: [] };
      porServidor[nome].avisos.push(a);
    });
    Object.keys(porServidor).forEach(function(nome) {
      var grp = porServidor[nome];
      var body = corpoProcesso_(p, grp.avisos, tipo);
      if (enviar_(grp.email, prefixoAssunto + ': ' + procRefTexto + ' (' + grp.avisos.length + ' etapa' + (grp.avisos.length>1?'s':'') + ')', body)) { enviados++; sentLocal++; }
    });

    // 2. E-mail para a chefia — inclui também as etapas aguardando requisitante,
    // para a chefia poder acompanhar e cobrar o setor requisitante quando couber.
    if (chefiaEmails.length && avisos.length) {
      var nChef = avisos.length;
      var bodyChef = corpoProcesso_(p, avisos, tipo);
      var assuntoChef = prefixoAssunto + ': ' + procRefTexto + ' (' + nChef + ' etapa' + (nChef>1?'s':'') + ')';
      chefiaEmails.forEach(function(emailChef) {
        if (enviar_(emailChef, assuntoChef, bodyChef)) { enviados++; sentLocal++; }
      });
    }

    // 3. E-mail para o setor requisitante — TODAS as etapas do processo (inclui as
    // aguardando-req), SEM coluna de responsáveis e com texto de cobrança.
    if (p.emailR && p.emailR.indexOf('@') > 0) {
      var nReq = avisos.length;
      var bodyReq = corpoProcesso_(p, avisos, tipo, null, true);
      if (enviar_(p.emailR, prefixoAssunto + ' — ' + p.nome + ' (' + nReq + ' etapa' + (nReq>1?'s':'') + ')', bodyReq)) { enviados++; sentLocal++; }
    }
    return sentLocal;
  }

  // Agrupa os avisos por processo (preservando ordem) e processa cada processo de uma vez.
  function processarLista(lista, tipo) {
    var porProc = {};
    var ordem = [];
    lista.forEach(function(av) {
      var pid = av.p.id;
      if (!porProc[pid]) { porProc[pid] = { p: av.p, avisos: [] }; ordem.push(pid); }
      porProc[pid].avisos.push(av);
    });
    ordem.forEach(function(pid) {
      var grupo = porProc[pid];
      var enviadosProc = processarProcesso(grupo.p, grupo.avisos, tipo);
      // Só marca como avisado se ao menos um e-mail do processo saiu — assim,
      // falha de cota/configuração permite reenviar na próxima execução.
      if (enviadosProc > 0) {
        grupo.avisos.forEach(function(av) {
          // 'proximo' com dias===0 e 'vencido' (recuperação de fim de semana)
          // debitam a MESMA chave 'vencimento' — é o 2º e último e-mail da
          // etapa (regra: máx. 2 envios por etapa/prazo).
          var tipoDedup = tipo === 'proximo' ? _tipoDedupProximo_(av) : 'vencimento';
          _avisoMarcar_(_chaveAvisoEtapa_(av.p, av.etIdx, tipoDedup), av.et.fim_iso);
        });
      }
    });
  }

  if (enviarProximos) processarLista(avisosProximos, 'proximo');
  if (enviarVencidos) processarLista(avisosVencidos, 'vencido');

  return 'E-mails enviados: ' + enviados + ' (' + (enviarProximos ? avisosProximos.length : 0) + ' proximos + ' + (enviarVencidos ? avisosVencidos.length : 0) + ' vencidos), agrupados por processo.';
}

// Estes dois são chamados pelos TRIGGERS de tempo (sem contexto de unidade).
// Antes rodavam só a unidade padrão (reitoria-sel), então os demais campi nunca
// recebiam aviso automático de prazo. Agora percorrem TODAS as unidades ativas.
function enviarAvisosPrazoProximos() {
  return _enviarAvisosTodasUnidades_('proximos');
}

function enviarAvisosPrazoVencidos() {
  return _enviarAvisosTodasUnidades_('vencidos');
}

// Orquestrador multiunidade: para cada unidade ativa, fixa o escopo em
// _FS_UNIDADE_REQ e roda a varredura/envio (que já é unidade-aware). Mantém o
// comportamento antigo (uma unidade) quando o Firestore está desligado ou a
// lista de unidades não pôde ser obtida.
function _enviarAvisosTodasUnidades_(modo) {
  if (typeof _fsServerAtivo_ !== 'function' || !_fsServerAtivo_()) {
    return enviarAvisosPrazo(modo);
  }
  var unidades = (typeof _fsListarUnidadesAtivas_ === 'function') ? _fsListarUnidadesAtivas_() : [];
  if (!unidades.length) return enviarAvisosPrazo(modo);

  var prev = (typeof _FS_UNIDADE_REQ === 'string') ? _FS_UNIDADE_REQ : '';
  var resumo = [];
  unidades.forEach(function(uid) {
    _FS_UNIDADE_REQ = uid;
    try { resumo.push(uid + ' → ' + enviarAvisosPrazo(modo)); }
    catch (e) { resumo.push(uid + ' → ERRO: ' + (e && e.message ? e.message : e)); }
  });
  _FS_UNIDADE_REQ = prev;
  return resumo.join('\n');
}

function enviarAvisosPrazoApp(authToken) {
  _authRequire_(authToken, true);
  // Envio manual a partir do app: escopo da unidade do próprio chefe (já vem em
  // _FS_UNIDADE_REQ pela API), portanto não percorre as demais unidades.
  return enviarAvisosPrazo();
}

// ── Central de notificações (App) ─────────────────────────────────────────
// Reusa EXATAMENTE a mesma varredura de enviarAvisosPrazo (etapas próximas e
// vencidas), mas em vez de enviar e-mail, RETORNA a lista para o app exibir
// no sininho. Garante paridade com os e-mails sem duplicar a regra de prazo.
// filtroServidor: quando informado (perfil comum), só inclui etapas cujo
// responsável é esse servidor — mesmo critério do e-mail (externo na fase
// externa, senão interno; fallback ao Agente da etapa). Chefe passa '' (vê tudo).
function _coletarAvisosPrazo_(dados, hoje, filtroServidor, incluirAguardandoReq) {
  function _normNome_(s) {
    return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  var alvo = _normNome_(filtroServidor);
  function _respDaEtapa_(p, et) {
    var faseExt = String(et.fase || '').toLowerCase().indexOf('ext') >= 0;
    var resp = faseExt ? (p.servidorExt || p.servidor || '') : (p.servidor || p.servidorExt || '');
    if (!resp && et.agente) resp = et.agente; // fallback: agente da própria etapa
    return resp;
  }
  var proximos = [];
  var vencidos = [];
  (dados || []).forEach(function(p) {
    if (p.status === 'ok' || p.status === 'planejamento' || p.retornoFila) return;
    (p.etapas || []).forEach(function(et) {
      if (et.status === 'ok' || et.status === 'na' || et.retornoFila || !et.fim_iso) return;
      var aguardaReq = p.status === 'aguardando' || et.status === 'aguardando';
      if (aguardaReq && !incluirAguardandoReq) return;
      // Filtro por responsável (perfil comum)
      if (alvo && _normNome_(_respDaEtapa_(p, et)) !== alvo) return;
      var fim  = new Date(et.fim_iso + 'T00:00:00');
      var diff = _contDU_(hoje, fim); // positivo = dias até vencer; negativo = já venceu
      var item = {
        processoId: p.id,
        num:        p.num || '',
        nome:       p.nome || '',
        modal:      p.modal || '',
        etapa:      et.nome || '',
        fimIso:     et.fim_iso,
        retornoFila: !!p.retornoFila,
        aguardandoReq: aguardaReq
      };
      if (diff >= 0 && diff <= DIAS_AVISO) {
        item.dias = diff;
        proximos.push(item);
      } else if (diff < 0) {
        item.diasAtraso = -diff;
        vencidos.push(item);
      }
    });
  });
  // Ordena: vencidos por maior atraso; próximos por menor prazo (mais urgente primeiro)
  vencidos.sort(function(a, b) { return b.diasAtraso - a.diasAtraso; });
  proximos.sort(function(a, b) { return a.dias - b.dias; });
  return { proximos: proximos, vencidos: vencidos };
}

function getAlertasApp(authToken) {
  var sess = _authRequire_(authToken, false);
  var dadosRaw = (typeof _dadosProcessosParaAvisos_ === 'function')
    ? _dadosProcessosParaAvisos_(sess) : _getEtapasParaApp_(sess);
  var dados = (dadosRaw && dadosRaw.processos) ? dadosRaw.processos : (dadosRaw || []);
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var filtroServidor = sess.isChefe ? '' : (sess.nome || '');
  var col = _coletarAvisosPrazo_(dados, hoje, filtroServidor, !!sess.isChefe);
  return {
    ok: true,
    escopo: sess.isChefe ? 'chefia' : 'meus',
    proximos: col.proximos,
    vencidos: col.vencidos,
    totalProximos: col.proximos.length,
    totalVencidos: col.vencidos.length,
    diasAviso: DIAS_AVISO
  };
}

// ── cadastrarProcesso ─────────────────────────────────────────────────────
// Chamada pelo app ao confirmar um novo processo.
// params: {objeto, modalidade, d0 (YYYY-MM-DD), nroSuap, temIRP ('Sim'|'Não'),
//          setor, emailReq, linkSuap, respInterno, respExterno, servidor}
// Lógica espelha novoProcesso() do Codigo_v3.gs, sem prompts de UI.
function cadastrarProcesso(params) {
  return _withAppLockResult_('cadastrar processo', function() {
    try {
    _authRequire_(params && params.authToken, true);
    var ss  = _ss_();
    var shP = ss.getSheetByName(ABA_PROC);
    var shE = ss.getSheetByName(ABA_ETP);
    var modalidadeSegregada = _isModalidadeExtSegregada_(params.modalidade);
    if (modalidadeSegregada && params.respInterno && params.respExterno && params.respInterno === params.respExterno) {
      throw new Error('Fase interna e fase externa precisam ter responsáveis diferentes em Pregão/Concorrência.');
    }

    // ── Lê cabeçalho de Processos ─────────────────────────────────
    var lP   = _garantirColunas_(shP, 'ProcessoID', ['Setor Requisitante', 'EmailRequisitante', 'Tipo Contratação Direta', 'Envio à Procuradoria?']);
    var hP   = lP.header;
    var hMap = {};
    hP.forEach(function(h, i) { hMap[h] = i; });
    var colID = hMap['ProcessoID'];
    if (colID === undefined) throw new Error('Coluna ProcessoID não encontrada em Processos.');

    // ── Gera próximo ProcessoID: SEL-AAAA-NNN ─────────────────────
    var ano     = new Date().getFullYear();
    var prefixo = 'SEL-' + ano + '-';
    var maxSeq  = 0;
    for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
      var pid = String(lP.values[i][colID] || '').trim();
      if (pid.indexOf(prefixo) === 0) {
        var seq = parseInt(pid.substring(prefixo.length)) || 0;
        if (seq > maxSeq) maxSeq = seq;
      }
    }
    var novoPID = prefixo + String(maxSeq + 1).padStart(3, '0');

    // ── Encontra primeira linha vazia em Processos ─────────────────
    var primeiraP = lP.startRow;
    var limiteP   = Math.min(shP.getMaxRows() - primeiraP + 1, 150);
    var blocoP    = shP.getRange(primeiraP, 1, limiteP, hP.length).getValues();
    var linhaProc = -1;
    for (var pi = 0; pi < blocoP.length; pi++) {
      if (String(blocoP[pi][colID] || '').trim() === '') {
        linhaProc = primeiraP + pi; break;
      }
    }
    if (linhaProc < 0) throw new Error('Sem espaço disponível na aba Processos.');

    // ── Monta e grava linha do processo ───────────────────────────
    var d0Obj    = params.d0 ? new Date(params.d0 + 'T12:00:00') : null;
    var novaLinha = new Array(hP.length).fill('');
    function set_(col, val) { if (hMap[col] !== undefined) novaLinha[hMap[col]] = val; }
    set_('ProcessoID',         novoPID);
    set_('N° SUAP',            params.nroSuap  || '');
    set_('Objeto',             params.objeto);
    set_('Modalidade',         params.modalidade);
    set_('D0 (Data Abertura)', d0Obj || '');
    set_('Tem IRP?',           params.temIRP   || 'Não');
    // Condicionais de contratação direta (só relevantes quando a modalidade é
    // "Contratação Direta"; para as demais gravamos vazio).
    var ehCDcad = String(params.modalidade || '').toLowerCase().indexOf('direta') >= 0;
    set_('Tipo Contratação Direta', ehCDcad ? (params.tipoCD || '') : '');
    set_('Envio à Procuradoria?',   ehCDcad ? (params.procuradoria === 'Não' ? 'Não' : 'Sim') : '');
    set_('Setor Requisitante', params.setor    || '');
    set_('Link SUAP',          params.linkSuap || '#');
    set_('EmailRequisitante',  params.emailReq || '');
    set_('Status',             d0Obj ? 'Em planejamento' : 'Fila');

    shP.getRange(linhaProc, 1, 1, hP.length).setValues([novaLinha]);
    if (d0Obj && hMap['D0 (Data Abertura)'] !== undefined) {
      shP.getRange(linhaProc, hMap['D0 (Data Abertura)'] + 1).setNumberFormat('DD/MM/YYYY');
    }

    // ── Localiza primeiro bloco vazio na aba Etapas ───────────────
    var lE       = _lerAba_(shE, 'ProcessoID');
    var hE       = lE.header;
    var colProcE = hE.indexOf('ProcessoID');
    var colOrdE  = hE.indexOf('Ord.');
    if (colProcE < 0) throw new Error('Coluna ProcessoID não encontrada em Etapas.');

    var primeiraE = lE.startRow;
    var limiteE   = Math.min(shE.getMaxRows() - primeiraE + 1, 1100);
    var blocoE    = shE.getRange(primeiraE, 1, limiteE, hE.length).getValues();
    var sepRow    = -1;
    for (var ri = 0; ri < blocoE.length; ri++) {
      var ordV = String(blocoE[ri][colOrdE >= 0 ? colOrdE : 0] || '').trim();
      var pidV = String(blocoE[ri][colProcE] || '').trim();
      if (ordV === '' && pidV === '') { sepRow = primeiraE + ri; break; }
    }
    if (sepRow < 0) throw new Error('Sem blocos disponíveis na aba Etapas (todos os 100 slots usados).');

    // ── Preenche bloco ─────────────────────────────────────────────
    // Separador (1ª linha do bloco): nome do objeto
    shE.getRange(sepRow, 1).setValue(params.objeto);

    // ProcessoID nas 9 linhas de etapa abaixo do separador
    shE.getRange(sepRow + 1, colProcE + 1, 9, 1).setValue(novoPID);

    // Agentes responsáveis
    var colAg = hE.indexOf('Agente Responsável');
    var ehPE  = modalidadeSegregada;
    if (colAg >= 0) {
      shE.getRange(sepRow + 1, colAg + 1, 7, 1).setValue(params.respInterno || '');
      var agExt = (ehPE && params.respExterno) ? params.respExterno : (params.respInterno || '');
      shE.getRange(sepRow + 8, colAg + 1).setValue(agExt);
      // Etapa 9 (Assinatura contrato/ARP): agente do setor de contratos — deixa como está no modelo
    }

    // Etapa 8 — Fase externa: ajusta nome e prazo conforme modalidade
    // (bloco pré-formatado assume Pregão Eletrônico como padrão)
    if (params.modalidade !== 'Pregão Eletrônico') {
      var colNm = hE.indexOf('Etapa');
      var colPz = hE.indexOf('Prazo (dias)');
      var faseNome  = 'Fase externa — ' + params.modalidade;
      var fasePrazo = params.modalidade === 'Concorrência' ? 100 : 30;
      if (colNm >= 0) shE.getRange(sepRow + 8, colNm + 1).setValue(faseNome);
      if (colPz >= 0) shE.getRange(sepRow + 8, colPz + 1).setValue(fasePrazo);
    }

    // ── Nomes atualizados das etapas (sobrescreve o modelo da planilha) ───
    var colNm2 = hE.indexOf('Etapa');
    if (colNm2 >= 0) {
      shE.getRange(sepRow + 5, colNm2 + 1).setValue('Adequações finais dos documentos e envio à Procuradoria');
      shE.getRange(sepRow + 6, colNm2 + 1).setValue('Versão final do TR e demais documentos aprovados');
      shE.getRange(sepRow + 7, colNm2 + 1).setValue('Envio ao SEL/SEPMA (Recebimento de processo, cadastro e publicação da licitação)');
    }
    // ── Etapa 9 — Assinatura contrato: Não se aplica (responsabilidade de Contratos/Jurídico)
    var colStCad = hE.indexOf('StatusEtapa ◄ EDITAR');
    if (colStCad >= 0) {
      shE.getRange(sepRow + 9, colStCad + 1).setValue('Não se aplica');
    }

    // ── Condicionais (IRP, tipo de contratação direta, Procuradoria) ─────
    // Marca "Não se aplica" nas etapas que não se aplicam ao processo e ajusta
    // o nome da etapa de adequações conforme o envio à Procuradoria. Localiza as
    // etapas pelo NOME dentro do bloco, então roda após os nomes já definidos.
    _aplicarCondicionaisEtapas_(shE, sepRow, hE, {
      modalidade:   params.modalidade,
      temIRP:       params.temIRP,
      tipoCD:       ehCDcad ? params.tipoCD : '',
      procuradoria: ehCDcad ? params.procuradoria : 'Sim'
    }, { edicao: false });

    // ── Cria linhas iniciais na Capacidade para pontuação posterior ─────
    (function criarCapacidadeInicial_() {
      var shC = ss.getSheetByName('📊 Capacidade');
      if (!shC) return;
      var capData = shC.getRange(1, 1, shC.getLastRow(), shC.getLastColumn()).getValues();
      var regHdr = -1;
      for (var ch = 0; ch < capData.length; ch++) {
        var cr = capData[ch].map(function(c){ return String(c).trim(); });
        if (cr[0].indexOf('Servidor') >= 0 && cr[2] === 'ProcessoID') { regHdr = ch; break; }
      }
      if (regHdr < 0) return;
      var hC = capData[regHdr].map(function(c){ return String(c).trim(); });
      function col_(nomes, fallback) {
        for (var ci = 0; ci < hC.length; ci++) {
          var hn = hC[ci].toLowerCase();
          for (var ni = 0; ni < nomes.length; ni++) {
            if (hn === nomes[ni].toLowerCase() || hn.indexOf(nomes[ni].toLowerCase()) >= 0) return ci;
          }
        }
        return fallback;
      }
      var cServ = col_(['Servidor'], 0);
      var cObj  = col_(['Processo / Objeto', 'Objeto', 'Processo'], 1);
      var cPid  = col_(['ProcessoID'], 2);
      var cAtv  = col_(['Ativo'], 3);
      var cMod  = col_(['Modalidade'], 4);
      var cFase = col_(['Fase da Carga', 'Fase Atual'], 5);
      var cP1   = col_(['Modalidade pts', 'Modalidade(pts)', 'Mod pts', 'Mod (pts)'], 6);
      var cP2   = col_(['Natureza pts', 'Natureza(pts)', 'Nat pts', 'Nat (pts)'], 7);
      var cP3   = col_(['Sessao pts', 'Sessao(pts)', 'Sessão pts', 'Sess pts', 'Sess (pts)'], 8);
      var cTotal = col_(['Total'], -1);
      var cargas = [{
        servidor: params.respInterno || '',
        fase: 'Fase Interna'
      }];
      if (ehPE) cargas.push({
        servidor: params.respExterno || '',
        fase: 'Fase Externa'
      });
      cargas.forEach(function(carga) {
        if (!carga.servidor) return;
        var faseBusca = carga.fase.toLowerCase().indexOf('ext') >= 0 ? 'ext' : 'int';
        for (var ex = regHdr + 1; ex < capData.length; ex++) {
          if (String(capData[ex][cPid] || '').trim() === novoPID &&
              String(capData[ex][cFase] || '').toLowerCase().indexOf(faseBusca) >= 0) {
            return;
          }
        }
        var targetRow = -1;
        for (var er = regHdr + 1; er < capData.length; er++) {
          if (!String(capData[er][cServ] || '').trim() && !String(capData[er][cPid] || '').trim()) {
            targetRow = er + 1; break;
          }
        }
        if (targetRow < 0) targetRow = shC.getLastRow() + 1;
        var nova = new Array(Math.max(hC.length, 10)).fill('');
        nova[cServ] = carga.servidor;
        nova[cObj]  = params.objeto;
        nova[cPid]  = novoPID;
        nova[cAtv]  = 'Não';
        nova[cMod]  = params.modalidade;
        nova[cFase] = carga.fase;
        nova[cP1] = 0; nova[cP2] = 0; nova[cP3] = 0;
        if (cTotal >= 0) nova[cTotal] = 0;
        var rng = shC.getRange(targetRow, 1, 1, nova.length);
        var dvs = rng.getDataValidations();
        rng.clearDataValidations().setValues([nova]);
        rng.setDataValidations(dvs);
        capData[targetRow - 1] = nova;
      });
    })();

    _sincronizarCapacidadeComEtapas_();
    _limparCacheCapacidade_();

    return { ok: true, pid: novoPID };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
  });
}

// ── migrarNomesEtapas ─────────────────────────────────────────────────────
// Executa UMA VEZ para atualizar etapas já cadastradas na planilha:
//   • Renomeia "Adequações finais", "Versão final do TR" e "Envio ao SEL/SEPMA"
//   • Define "Assinatura contrato / Ata (ARP)" como Não se aplica
// Chamada pelo botão na aba Config do app.
function migrarNomesEtapas(authToken) {
  return _withAppLockResult_('migrar nomes de etapas', function() {
    try {
    _authRequire_(authToken, true);
    var sh  = _ss_().getSheetByName(ABA_ETP);
    var lE  = _lerAba_(sh, 'ProcessoID');
    var hdr = lE.header;
    var iNome = hdr.indexOf('Etapa');
    var iStat = hdr.indexOf('StatusEtapa ◄ EDITAR');
    if (iNome < 0) return { ok: false, erro: 'Coluna "Etapa" não encontrada.' };

    var RENOMES = {
      'Adequações finais':   'Adequações finais dos documentos e envio à Procuradoria',
      'Versão final do TR':  'Versão final do TR e demais documentos aprovados',
      'Envio ao SEL/SEPMA':  'Envio ao SEL/SEPMA (Recebimento de processo, cadastro e publicação da licitação)'
    };

    var renomeados = 0, naAplicados = 0;

    for (var j = lE.hIdx + 1; j < lE.values.length; j++) {
      var nome = String(lE.values[j][iNome] || '').trim();
      if (!nome) continue;

      // Renomear etapas
      for (var antigo in RENOMES) {
        if (nome === antigo || nome.indexOf(antigo) === 0) {
          sh.getRange(j + 1, iNome + 1).setValue(RENOMES[antigo]);
          renomeados++;
          break;
        }
      }

      // Assinatura → Não se aplica (salvo se já concluída)
      if (nome.toLowerCase().indexOf('assinatura') >= 0 && iStat >= 0) {
        var stAtual = _normStatus_(String(lE.values[j][iStat] || '').trim());
        if (stAtual !== 'ok') {
          sh.getRange(j + 1, iStat + 1).setValue('Não se aplica');
          naAplicados++;
        }
      }
    }

    return { ok: true, msg: renomeados + ' etapas renomeadas, ' + naAplicados + ' assinaturas marcadas como N/A.' };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
  });
}

function _sincronizarCapacidadeComEtapas_() {
  try {
    var ss = _ss_();
    var shP = ss.getSheetByName(ABA_PROC);
    var shE = ss.getSheetByName(ABA_ETP);
    var shC = ss.getSheetByName('📊 Capacidade');
    if (!shP || !shE || !shC) return { criados: 0, reativados: 0 };

    var lP = _garantirColunas_(shP, 'ProcessoID', ['Setor Requisitante', 'EmailRequisitante']);
    var hP = lP.header;
    var iP = {
      id: hP.indexOf('ProcessoID'),
      nome: hP.indexOf('Objeto'),
      modal: hP.indexOf('Modalidade'),
      d0: hP.indexOf('D0 (Data Abertura)')
    };
    if (iP.id < 0) return { criados: 0, reativados: 0 };

    var procMap = {};
    for (var p = lP.hIdx + 1; p < lP.values.length; p++) {
      var pr = lP.values[p];
      var pidP = String(pr[iP.id] || '').trim();
      if (!pidP) continue;
      procMap[pidP] = {
        nome: iP.nome >= 0 ? String(pr[iP.nome] || '').trim() : '',
        modal: iP.modal >= 0 ? String(pr[iP.modal] || '').trim() : '',
        temD0: iP.d0 >= 0 && !!_parseDate_(pr[iP.d0])
      };
    }

    var lE = _lerAba_(shE, 'ProcessoID');
    var hE = lE.header;
    var iE = {
      pid: hE.indexOf('ProcessoID'),
      nome: hE.indexOf('Etapa'),
      agente: hE.indexOf('Agente Responsável'),
      fase: hE.indexOf('Fase'),
      status: hE.indexOf('StatusEtapa ◄ EDITAR'),
      motivo: hE.indexOf('MotivoAtraso ◄ EDITAR')
    };
    if (iE.pid < 0 || iE.agente < 0 || iE.status < 0) return { criados: 0, reativados: 0 };

    var etapas = {};
    for (var e = lE.hIdx + 1; e < lE.values.length; e++) {
      var er = lE.values[e];
      var pidE = String(er[iE.pid] || '').trim();
      if (!pidE) continue;
      var nomeE = iE.nome >= 0 ? String(er[iE.nome] || '').trim() : '';
      var faseE = iE.fase >= 0 ? String(er[iE.fase] || '').trim() : '';
      if (_isEtapaContratual_(faseE, nomeE)) continue;
      if (!etapas[pidE]) etapas[pidE] = [];
      etapas[pidE].push({
        agente: String(er[iE.agente] || '').trim(),
        fase: faseE,
        status: _normStatus_(er[iE.status]),
        retornoFila: iE.motivo >= 0 && _isRetornoFilaMotivo_(er[iE.motivo])
      });
    }

    var capData = shC.getRange(1, 1, shC.getLastRow(), shC.getLastColumn()).getValues();
    var regHdr = -1;
    for (var c = 0; c < capData.length; c++) {
      var cr = capData[c].map(function(v){ return String(v).trim(); });
      if (cr[0].indexOf('Servidor') >= 0 && cr[2] === 'ProcessoID') { regHdr = c; break; }
    }
    if (regHdr < 0) return { criados: 0, reativados: 0 };
    var hC = capData[regHdr].map(function(v){ return String(v).trim(); });
    var iAtivo = hC.indexOf('Ativo');
    var iObjC = hC.indexOf('Processo / Objeto');
    if (iObjC < 0) iObjC = hC.indexOf('Objeto');
    if (iAtivo < 0) return { criados: 0, reativados: 0 };

    var capMap = {};
    var firstEmpty = -1;
    var servValidos = _servidoresValidosMap_();
    for (var r = regHdr + 1; r < capData.length; r++) {
      var row = capData[r];
      var serv = String(row[0] || '').trim();
      var pid = String(row[2] || '').trim();
      if (!serv && !pid && firstEmpty < 0) firstEmpty = r + 1;
      if (!pid) continue;
      var fase = String(row[5] || '').trim().toLowerCase();
      var kind = fase.indexOf('ext') >= 0 ? 'ext' : 'int';
      capMap[pid + '|' + kind] = {
        row: r + 1,
        ativo: row[3],
        servidor: serv,
        objeto: iObjC >= 0 ? String(row[iObjC] || '').trim() : ''
      };
    }

    var criados = 0, reativados = 0;
    function servidorValidoCap_(nome) {
      return servValidos[_normServidorNome_(nome)] || '';
    }
    Object.keys(etapas).forEach(function(pid) {
      var proc = procMap[pid];
      if (!proc || !proc.temD0) return;
      var lista = etapas[pid];
      var concl = 0, aplicaveis = 0, atual = null, primeiraPendente = null;
      for (var i = 0; i < lista.length; i++) {
        var st = lista[i].status;
        if (st !== 'na') aplicaveis++;
        if (st === 'ok') concl++;
        if (!atual && ['andamento','aguardando','paralisado','atrasado'].indexOf(st) >= 0) atual = lista[i];
        if (!primeiraPendente && st === 'pendente') primeiraPendente = lista[i];
      }
      if (lista.some(function(item){ return item.retornoFila || item.status === 'retornado'; })) {
        ['int','ext'].forEach(function(k) {
          var filaKey = pid + '|' + k;
          if (capMap[filaKey] && _isSim_(capMap[filaKey].ativo)) {
            shC.getRange(capMap[filaKey].row, iAtivo + 1).setValue('Não');
          }
        });
        return;
      }
      var concluido = aplicaveis > 0 && concl >= aplicaveis;
      if (concluido) {
        ['int','ext'].forEach(function(k) {
          var doneKey = pid + '|' + k;
          if (capMap[doneKey] && _isSim_(capMap[doneKey].ativo)) {
            shC.getRange(capMap[doneKey].row, iAtivo + 1).setValue('Não');
          }
        });
        return;
      }
      if (!atual && concl > 0) atual = primeiraPendente;
      if (!atual) return;

      var isExt = String(atual.fase || '').toLowerCase().indexOf('ext') >= 0;
      var kind = isExt ? 'ext' : 'int';
      var key = pid + '|' + kind;
      var outroKey = pid + '|' + (isExt ? 'int' : 'ext');
      var agenteValido = servidorValidoCap_(atual.agente);
      if (!agenteValido && capMap[key]) agenteValido = servidorValidoCap_(capMap[key].servidor);
      if (!agenteValido) return;
      var agenteKey = _normServidorNome_(agenteValido);
      if (capMap[outroKey]) {
        if (_isSim_(capMap[outroKey].ativo)) {
          shC.getRange(capMap[outroKey].row, iAtivo + 1).setValue('Não');
        }
      }

      if (capMap[key]) {
        if (iObjC >= 0 && proc.nome && capMap[key].objeto !== proc.nome) {
          shC.getRange(capMap[key].row, iObjC + 1).setValue(proc.nome);
          capMap[key].objeto = proc.nome;
        }
        if (_normServidorNome_(capMap[key].servidor) !== agenteKey) {
          var cellServ = shC.getRange(capMap[key].row, 1);
          var dvServ = cellServ.getDataValidation();
          cellServ.clearDataValidations().setValue(agenteValido);
          if (dvServ) cellServ.setDataValidation(dvServ);
        }
        if (!_isSim_(capMap[key].ativo)) {
          shC.getRange(capMap[key].row, iAtivo + 1).setValue('Sim');
          reativados++;
        }
        return;
      }

      var targetRow = firstEmpty > 0 ? firstEmpty : shC.getLastRow() + 1;
      var values = [[
        agenteValido,
        proc.nome,
        pid,
        'Sim',
        proc.modal,
        isExt ? 'Fase Externa' : 'Fase Interna',
        0, 0, 0, ''
      ]];
      var rng = shC.getRange(targetRow, 1, 1, 10);
      var dvs = rng.getDataValidations();
      rng.clearDataValidations().setValues(values);
      rng.setDataValidations(dvs);
      shC.getRange(targetRow, 10).setFormula('=SUM(G' + targetRow + ':I' + targetRow + ')');
      capMap[key] = { row: targetRow, ativo: 'Sim' };
      firstEmpty = -1;
      criados++;
    });

    return { criados: criados, reativados: reativados };
  } catch(e) {
    return { criados: 0, reativados: 0, erro: e.message };
  }
}

// ── getCapacidadeApp ──────────────────────────────────────────────────────
// Lê a aba 📊 Capacidade e retorna:
//   resumoInt / resumoExt  — resumo por servidor (Fase Interna / Externa)
//   registrosInt / registrosExt — processos separados por fase
function getCapacidadeApp(authToken) {
  _authRequire_(authToken, false);
  var sh = _ss_().getSheetByName('📊 Capacidade');
  if (!sh) return null;
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();

  function titleCase_(s) {
    return _fsNomeServ_(s);
  }
  function parseNum_(v) {
    if (typeof v === 'number') return v;
    return parseFloat(String(v || '0').replace(',', '.')) || 0;
  }
  function round1_(n) {
    return Math.round((n || 0) * 10) / 10;
  }
  // Sheets retorna percentagem como decimal (1.5 = 150%). Converte.
  function parsePct_(v) {
    if (typeof v === 'number') return v > 2 ? v : Math.round(v * 100);
    return parseNum_(String(v||'0').replace('%',''));
  }
  function recalcularResumo_(resumo, registros) {
    var soma = {};
    var futuro = {};
    var futuroQtd = {};
    registros.forEach(function(r) {
      if (r.concluido) return;
      var key = _normServidorNome_(r.servidor);
      if (r.ativo === 'Sim') {
        soma[key] = (soma[key] || 0) + r.total;
      } else {
        futuro[key] = (futuro[key] || 0) + r.total;
        futuroQtd[key] = (futuroQtd[key] || 0) + 1;
      }
    });
    resumo.forEach(function(s) {
      var key = _normServidorNome_(s.servidor);
      var processos = soma[key] || 0;
      var futuros = futuro[key] || 0;
      s.processos = round1_(processos);
      s.total = round1_(s.processos + s.outros);
      s.pct = s.teto ? round1_(s.total / s.teto * 100) : 0;
      s.status = s.pct >= 90 ? 'Crítico' : (s.pct >= 60 ? 'Atenção' : 'Disponível');
      s.futuros = round1_(futuros);
      s.futurosQtd = futuroQtd[key] || 0;
      s.projetado = round1_(s.total + s.futuros);
      s.pctProjetado = s.teto ? round1_(s.projetado / s.teto * 100) : 0;
    });
  }

  // Mapa pid → emailR lido de fProcessos para enriquecer os registros de capacidade
  var procInfoMapCap = {};
  (function() {
    var ss2 = _ss_();
    var shP = ss2.getSheetByName(ABA_PROC);
    if (!shP) return;
    var lP2 = _lerAba_(shP, 'ProcessoID');
    var hP2 = lP2.header;
    var iId = hP2.indexOf('ProcessoID');
    var iEm = hP2.indexOf('EmailRequisitante');
    var iObj = hP2.indexOf('Objeto');
    if (iId < 0) return;
    for (var rr2 = lP2.hIdx + 1; rr2 < lP2.values.length; rr2++) {
      var rowP = lP2.values[rr2];
      var pid2 = String(rowP[iId]||'').trim();
      if (pid2) {
        procInfoMapCap[pid2] = {
          emailR: iEm >= 0 ? String(rowP[iEm]||'').trim() : '',
          objeto: iObj >= 0 ? String(rowP[iObj]||'').trim() : ''
        };
      }
    }
  })();

  var procConcluidoCap = {};
  var faseCorrenteCap = {};
  (function() {
    var ss3 = _ss_();
    var shE3 = ss3.getSheetByName(ABA_ETP);
    if (!shE3) return;
    var lE3 = _lerAba_(shE3, 'ProcessoID');
    var hE3 = lE3.header;
    var iPid3 = hE3.indexOf('ProcessoID');
    var iNome3 = hE3.indexOf('Etapa');
    var iFase3 = hE3.indexOf('Fase');
    var iStatus3 = hE3.indexOf('StatusEtapa ◄ EDITAR');
    if (iPid3 < 0 || iStatus3 < 0) return;
    var accConcl = {};
    for (var e3 = lE3.hIdx + 1; e3 < lE3.values.length; e3++) {
      var rowE3 = lE3.values[e3];
      var pid3 = String(rowE3[iPid3] || '').trim();
      if (!pid3) continue;
      var nome3 = iNome3 >= 0 ? String(rowE3[iNome3] || '').trim() : '';
      var fase3 = iFase3 >= 0 ? String(rowE3[iFase3] || '').trim() : '';
      if (_isEtapaContratual_(fase3, nome3)) continue;
      var st3 = _normStatus_(rowE3[iStatus3]);
      if (st3 === 'na') continue;
      var faseKind3 = fase3.toLowerCase().indexOf('ext') >= 0 ? 'ext' : 'int';
      if (!accConcl[pid3]) accConcl[pid3] = { total: 0, ok: 0, ativa: '', primeiraPendente: '', primeiraPendentePosOk: '' };
      accConcl[pid3].total++;
      if (st3 === 'ok') accConcl[pid3].ok++;
      else if (['andamento','aguardando','paralisado','atrasado'].indexOf(st3) >= 0 && !accConcl[pid3].ativa) accConcl[pid3].ativa = faseKind3;
      else if (st3 === 'pendente') {
        if (!accConcl[pid3].primeiraPendente) accConcl[pid3].primeiraPendente = faseKind3;
        if (accConcl[pid3].ok > 0 && !accConcl[pid3].primeiraPendentePosOk) accConcl[pid3].primeiraPendentePosOk = faseKind3;
      }
    }
    Object.keys(accConcl).forEach(function(pid3) {
      procConcluidoCap[pid3] = accConcl[pid3].total > 0 && accConcl[pid3].ok >= accConcl[pid3].total;
      if (!procConcluidoCap[pid3]) {
        faseCorrenteCap[pid3] = accConcl[pid3].ativa
          || accConcl[pid3].primeiraPendentePosOk
          || accConcl[pid3].primeiraPendente
          || '';
      }
    });
  })();

  var resumoInt = [], resumoExt = [], registrosInt = [], registrosExt = [];
  var sumHdrRow = -1, regHdrRow = -1;

  for (var r = 0; r < data.length; r++) {
    var rr = data[r].map(function(c){ return String(c).trim(); });
    if (sumHdrRow < 0 && rr[0] === 'Servidor' && rr[1].indexOf('Outros') >= 0) sumHdrRow = r;
    if (regHdrRow < 0 && rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') regHdrRow = r;
    if (sumHdrRow >= 0 && regHdrRow >= 0) break;
  }

  var propsCap = PropertiesService.getScriptProperties();
  var resumoRowsInt = {};
  var resumoRowsExt = {};
  if (sumHdrRow >= 0) {
    var limiteResumo = regHdrRow > sumHdrRow ? regHdrRow : data.length;
    for (var s = sumHdrRow + 1; s < limiteResumo; s++) {
      var row = data[s] || [];
      var nome = String(row[0]||'').trim();
      if (nome && nome.toUpperCase().indexOf('TOTAL') < 0) {
        resumoRowsInt[_normServidorNome_(nome)] = {
          servidor:  titleCase_(nome),
          outros:    parseNum_(row[1]),
          linhaSum:  s + 1,
          colOutros: 2,
          total:     parseNum_(row[3]),
          teto:      parseNum_(row[4]) || 8,
          pct:       parsePct_(row[6]),
          status:    String(row[7]||'').replace(/[⛔⚠✅🟢🟡🔴]/g,'').trim()
        };
      }
      var nomeExt = String(row[9]||'').trim();
      if (nomeExt && nomeExt.toUpperCase().indexOf('TOTAL') < 0) {
        resumoRowsExt[_normServidorNome_(nomeExt)] = {
          servidor:  titleCase_(nomeExt),
          outros:    parseNum_(row[10]),
          linhaSum:  s + 1,
          colOutros: 11,
          total:     parseNum_(row[12]),
          teto:      parseNum_(row[13]) || 8,
          pct:       parsePct_(row[15]),
          status:    String(row[16]||'').replace(/[⛔⚠✅🟢🟡🔴]/g,'').trim()
        };
      }
    }
  }

  function montarResumoDinamico_(fase, mapa) {
    var listaServ = _getServidoresApp_();
    var tetoPadrao = fase === 'int' ? 10 : 6;
    return listaServ.map(function(srv) {
      var key = _normServidorNome_(srv.nome);
      var base = mapa[key] || {};
      var propKey = _propKeyServidor_('cap_outros_' + fase, srv.nome);
      var outrosProp = propsCap.getProperty(propKey);
      return {
        servidor:  srv.nome,
        outros:    base.linhaSum ? base.outros : parseNum_(outrosProp),
        linhaSum:  base.linhaSum || '',
        colOutros: fase === 'int' ? 2 : 11,
        total:     base.total || 0,
        teto:      tetoPadrao,
        pct:       base.pct || 0,
        status:    base.status || 'Disponível',
        futuros:   0,
        futurosQtd: 0,
        projetado: 0,
        pctProjetado: 0
      };
    });
  }

  resumoInt = montarResumoDinamico_('int', resumoRowsInt);
  resumoExt = montarResumoDinamico_('ext', resumoRowsExt);

  // Registro de processos (separado por fase)
  if (regHdrRow >= 0) {
    for (var r2 = regHdrRow + 1; r2 < data.length; r2++) {
      var row2 = data[r2];
      var serv = String(row2[0]||'').trim();
      var pid  = String(row2[2]||'').trim();
      if (!serv || !pid) continue;
      if (procConcluidoCap[pid]) continue;
      var fase = String(row2[5]||'').trim();
      var faseKind = fase.toLowerCase().indexOf('ext') >= 0 ? 'ext' : 'int';
      // Esconde apenas a linha INTERNA depois que a fase corrente virou externa
      // (o servidor interno já saiu). A linha EXTERNA "por vir" permanece visível
      // enquanto a fase corrente ainda é interna, para o gestor planejar a próxima fase.
      if (faseCorrenteCap[pid] === 'ext' && faseKind === 'int') continue;
      var pts11 = parseNum_(row2[6]);
      var pts12 = parseNum_(row2[7]);
      var pts23 = parseNum_(row2[8]);
      var procInfo = procInfoMapCap[pid] || {};
      var rec  = {
        linha:    r2 + 1,
        pid:      pid,
        servidor: titleCase_(serv),
        objeto:   procInfo.objeto || String(row2[1]||'').trim(),
        modal:    String(row2[4]||'').trim(),
        fase:     fase,
        ativo:    _isSim_(row2[3]) ? 'Sim' : 'Não',
        pts11:    pts11,
        pts12:    pts12,
        pts23:    pts23,
        total:    round1_(pts11 + pts12 + pts23),
        emailR:   procInfo.emailR || '',
        concluido: !!procConcluidoCap[pid]
      };
      if (faseKind === 'ext') registrosExt.push(rec);
      else registrosInt.push(rec);
    }
  }

  recalcularResumo_(resumoInt, registrosInt);
  recalcularResumo_(resumoExt, registrosExt);

  return { resumoInt: resumoInt, resumoExt: resumoExt,
           registrosInt: registrosInt, registrosExt: registrosExt };
}

// ── salvarEmailProcesso ───────────────────────────────────────────────────────
// Grava o EmailRequisitante de um processo na aba fProcessos.
// params: pid (ProcessoID), email (string)
function salvarEmailProcesso(pid, email, authToken) {
  return _withAppLockResult_('salvar email do requisitante', function() {
    try {
    _authRequire_(authToken, false);
    var shP = _ss_().getSheetByName(ABA_PROC);
    if (!shP) throw new Error('Aba Processos não encontrada.');
    var lP = _garantirColunas_(shP, 'ProcessoID', ['Setor Requisitante', 'EmailRequisitante']);
    var hP = lP.header;
    var iId = hP.indexOf('ProcessoID');
    var iEm = hP.indexOf('EmailRequisitante');
    if (iId < 0 || iEm < 0) throw new Error('Coluna ProcessoID ou EmailRequisitante não encontrada.');
    for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
      if (String(lP.values[i][iId]||'').trim() === pid) {
        shP.getRange(i + 1, iEm + 1).setValue(email.trim());
        return { ok: true };
      }
    }
    throw new Error('Processo ' + pid + ' não encontrado.');
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function salvarLinkSuapProcessoApp(params) {
  return _withAppLockResult_('salvar link SUAP do processo', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, false);
      var pid = String(params.processoId || '').trim();
      var link = String(params.linkSuap || '').trim();
      if (!pid) throw new Error('Processo não informado.');
      if (!/^https?:\/\/\S+$/i.test(link)) {
        throw new Error('Informe uma URL completa do SUAP, começando com http:// ou https://.');
      }
      if (link.length > 500) throw new Error('Link SUAP muito longo.');

      var shP = _ss_().getSheetByName(ABA_PROC);
      if (!shP) throw new Error('Aba Processos não encontrada.');
      var lP = _garantirColunas_(shP, 'ProcessoID', ['Link SUAP']);
      var hP = lP.header;
      var iId = hP.indexOf('ProcessoID');
      var iLink = hP.indexOf('Link SUAP');
      if (iId < 0 || iLink < 0) throw new Error('Coluna ProcessoID ou Link SUAP não encontrada.');

      for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
        if (String(lP.values[i][iId] || '').trim() === pid) {
          shP.getRange(i + 1, iLink + 1).setValue(link);
          return { ok: true, linkSuap: link };
        }
      }
      throw new Error('Processo ' + pid + ' não encontrado.');
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── trocarServidor ────────────────────────────────────────────────────────────
// Atualiza o servidor responsável de um processo na aba 📊 Capacidade (col A).
// pid: ProcessoID; novoServidor: nome ou '' para remover.
function _atualizarObjetoCapacidade_(pid, nome) {
  var ss = _ss_();
  var sh = null;
  ss.getSheets().forEach(function(s) {
    if (/capacidade/i.test(s.getName())) sh = s;
  });
  if (!sh) return 0;
  var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var regHdr = -1;
  for (var r = 0; r < data.length; r++) {
    var rr = data[r].map(function(c){ return String(c).trim(); });
    if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = r; break; }
  }
  if (regHdr < 0) return 0;
  var h = data[regHdr].map(function(c){ return String(c).trim(); });
  var iPid = h.indexOf('ProcessoID');
  var iObj = h.indexOf('Processo / Objeto');
  if (iObj < 0) iObj = h.indexOf('Objeto');
  if (iPid < 0 || iObj < 0) return 0;
  var atualizados = 0;
  for (var i = regHdr + 1; i < data.length; i++) {
    if (String(data[i][iPid] || '').trim() === pid) {
      sh.getRange(i + 1, iObj + 1).setValue(nome);
      atualizados++;
    }
  }
  return atualizados;
}

function salvarNomeProcessoFilaApp(params) {
  return _withAppLockResult_('editar nome do processo na fila', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || '').trim();
      var nome = String(params.nome || '').trim();
      if (!pid) throw new Error('Processo não informado.');
      if (nome.length < 4) throw new Error('Informe um nome mais completo.');
      if (nome.length > 200) nome = nome.substring(0, 200).trim();

      var shP = _ss_().getSheetByName(ABA_PROC);
      if (!shP) throw new Error('Aba Processos não encontrada.');
      var lP = _lerAba_(shP, 'ProcessoID');
      var hP = lP.header;
      var iId = hP.indexOf('ProcessoID');
      var iObj = hP.indexOf('Objeto');
      var iD0 = hP.indexOf('D0 (Data Abertura)');
      if (iId < 0 || iObj < 0) throw new Error('Colunas ProcessoID/Objeto não encontradas.');

      var dados = _getEtapasParaApp_({ isChefe: true, nome: 'Sistema' });
      var todos = (dados.processos || []).concat(dados.filaPrevisao || []);
      var proc = todos.find(function(p) { return p.id === pid; });
      for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
        if (String(lP.values[i][iId] || '').trim() !== pid) continue;
        var d0 = iD0 >= 0 ? _parseDate_(lP.values[i][iD0]) : null;
        var podeEditar = !d0 || !proc || proc.status === 'planejamento' || proc.retornoFila;
        if (!podeEditar) throw new Error('O nome só pode ser editado pela Fila.');
        shP.getRange(i + 1, iObj + 1).setValue(nome);
        _atualizarObjetoCapacidade_(pid, nome);
        _limparCacheCapacidade_();
        return { ok: true, nome: nome };
      }
      throw new Error('Processo ' + pid + ' não encontrado.');
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── editarProcessoFilaApp ──────────────────────────────────────────────────
// Edita os dados cadastrais de um processo direto pela Fila (sem ir à planilha).
// Espelha os campos do cadastro, EXCETO responsáveis (que continuam pelo
// botão "Atribuir"). Só chefia.
// params: { processoId, objeto, modalidade, d0 (YYYY-MM-DD ou ''),
//           nroSuap, temIRP ('Sim'|'Não'), setor, emailReq, linkSuap, authToken }
function editarProcessoFilaApp(params) {
  return _withAppLockResult_('editar processo na fila', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || '').trim();
      if (!pid) throw new Error('Processo não informado.');

      var objeto = String(params.objeto || '').trim();
      if (objeto.length < 4) throw new Error('Informe um objeto/nome mais completo.');
      if (objeto.length > 200) objeto = objeto.substring(0, 200).trim();

      var shP = _ss_().getSheetByName(ABA_PROC);
      if (!shP) throw new Error('Aba Processos não encontrada.');
      var lP = _garantirColunas_(shP, 'ProcessoID', ['Tipo Contratação Direta', 'Envio à Procuradoria?']);
      var hP = lP.header;
      var iId    = hP.indexOf('ProcessoID');
      var iObj   = hP.indexOf('Objeto');
      var iModal = hP.indexOf('Modalidade');
      var iD0    = hP.indexOf('D0 (Data Abertura)');
      var iIrp   = hP.indexOf('Tem IRP?');
      var iTipo  = hP.indexOf('Tipo Contratação Direta');
      var iProc  = hP.indexOf('Envio à Procuradoria?');
      var iReq   = hP.indexOf('Setor Requisitante');
      var iSuap  = hP.indexOf('Link SUAP');
      var iNum   = hP.indexOf('N° SUAP');
      var iEmail = hP.indexOf('EmailRequisitante');
      if (iId < 0 || iObj < 0) throw new Error('Colunas ProcessoID/Objeto não encontradas.');

      // Só permite editar processos que estão na Fila (sem D0, em planejamento
      // ou retornados) — não processos em andamento normal.
      var dados = _getEtapasParaApp_({ isChefe: true, nome: 'Sistema' });
      var todos = (dados.processos || []).concat(dados.filaPrevisao || []);
      var proc = todos.find(function(p) { return p.id === pid; });

      for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
        if (String(lP.values[i][iId] || '').trim() !== pid) continue;
        var linha = i + 1;
        var d0Atual = iD0 >= 0 ? _parseDate_(lP.values[i][iD0]) : null;
        var podeEditar = !d0Atual || !proc || proc.status === 'planejamento' || proc.retornoFila;
        if (!podeEditar) throw new Error('Só é possível editar pela Fila processos que ainda não começaram ou que retornaram.');

        // Objeto / nome
        shP.getRange(linha, iObj + 1).setValue(objeto);
        // Modalidade
        if (iModal >= 0 && params.modalidade !== undefined) {
          shP.getRange(linha, iModal + 1).setValue(String(params.modalidade || '').trim());
        }
        // D0 (pode ser limpo para devolver à condição "sem D0")
        if (iD0 >= 0 && params.d0 !== undefined) {
          if (String(params.d0 || '').trim()) {
            var d0Obj = new Date(params.d0 + 'T12:00:00');
            shP.getRange(linha, iD0 + 1).setValue(d0Obj).setNumberFormat('DD/MM/YYYY');
          } else {
            shP.getRange(linha, iD0 + 1).setValue('');
          }
        }
        // Tem IRP?
        if (iIrp >= 0 && params.temIRP !== undefined) {
          shP.getRange(linha, iIrp + 1).setValue(params.temIRP === 'Sim' ? 'Sim' : 'Não');
        }
        // Condicionais de contratação direta (só relevantes quando a modalidade
        // efetiva for "Contratação Direta"; para as demais gravamos vazio).
        var modalEfetiva = (params.modalidade !== undefined)
          ? String(params.modalidade || '').trim()
          : String(lP.values[i][iModal] || '').trim();
        var ehCDedit = modalEfetiva.toLowerCase().indexOf('direta') >= 0;
        if (iTipo >= 0 && params.tipoCD !== undefined) {
          shP.getRange(linha, iTipo + 1).setValue(ehCDedit ? String(params.tipoCD || '').trim() : '');
        }
        if (iProc >= 0 && params.procuradoria !== undefined) {
          shP.getRange(linha, iProc + 1).setValue(ehCDedit ? (params.procuradoria === 'Não' ? 'Não' : 'Sim') : '');
        }
        // Setor requisitante
        if (iReq >= 0 && params.setor !== undefined) {
          shP.getRange(linha, iReq + 1).setValue(String(params.setor || '').trim());
        }
        // E-mail requisitante
        if (iEmail >= 0 && params.emailReq !== undefined) {
          shP.getRange(linha, iEmail + 1).setValue(String(params.emailReq || '').trim());
        }
        // N° SUAP
        if (iNum >= 0 && params.nroSuap !== undefined) {
          shP.getRange(linha, iNum + 1).setValue(String(params.nroSuap || '').trim());
        }
        // Link SUAP
        if (iSuap >= 0 && params.linkSuap !== undefined) {
          var lk = String(params.linkSuap || '').trim();
          shP.getRange(linha, iSuap + 1).setValue(lk || '#');
        }

        // Reaplica as condicionais das etapas (IRP, tipo de contratação direta,
        // Procuradoria) — marca/reverte "Não se aplica" sem tocar em concluídas.
        var temIRPef = (params.temIRP !== undefined)
          ? params.temIRP
          : (iIrp >= 0 ? String(lP.values[i][iIrp] || '') : 'Não');
        var tipoEf = ehCDedit
          ? ((params.tipoCD !== undefined) ? params.tipoCD : (iTipo >= 0 ? String(lP.values[i][iTipo] || '') : ''))
          : '';
        var procEf = ehCDedit
          ? ((params.procuradoria !== undefined) ? params.procuradoria : (iProc >= 0 ? String(lP.values[i][iProc] || '') : 'Sim'))
          : 'Sim';
        try {
          var bloco = _localizarBlocoEtapas_(pid);
          if (bloco) {
            _aplicarCondicionaisEtapas_(bloco.shE, bloco.sepRow, bloco.hE, {
              modalidade:   modalEfetiva,
              temIRP:       temIRPef,
              tipoCD:       tipoEf,
              procuradoria: procEf
            }, { edicao: true });
          }
        } catch(condErr) { /* não bloqueia a edição se o bloco não for localizado */ }

        // Propaga o objeto para a aba Capacidade e Etapas (separador do bloco)
        _atualizarObjetoCapacidade_(pid, objeto);
        _atualizarSeparadorEtapas_(pid, objeto);
        _limparCacheCapacidade_();
        return { ok: true, nome: objeto };
      }
      throw new Error('Processo ' + pid + ' não encontrado.');
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── excluirProcessoApp ─────────────────────────────────────────────────────
// Remove COMPLETAMENTE um processo: limpa a linha na aba Processos, o bloco de
// etapas correspondente na aba Etapas e os registros de Capacidade vinculados.
// Operação destrutiva e irreversível. Só chefia.
// params: { processoId, authToken }
function excluirProcessoApp(params) {
  return _withAppLockResult_('excluir processo', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || '').trim();
      if (!pid) throw new Error('Processo não informado.');

      var ss = _ss_();

      // ── 1) Aba Processos: limpa a linha do processo ────────────────────
      var shP = ss.getSheetByName(ABA_PROC);
      if (!shP) throw new Error('Aba Processos não encontrada.');
      var lP = _lerAba_(shP, 'ProcessoID');
      var iIdP = lP.header.indexOf('ProcessoID');
      if (iIdP < 0) throw new Error('Coluna ProcessoID não encontrada em Processos.');
      var linhaProc = -1;
      var objeto = '';
      for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
        if (String(lP.values[i][iIdP] || '').trim() === pid) {
          linhaProc = i + 1;
          var iObjP = lP.header.indexOf('Objeto');
          if (iObjP >= 0) objeto = String(lP.values[i][iObjP] || '').trim();
          break;
        }
      }
      if (linhaProc < 0) throw new Error('Processo ' + pid + ' não encontrado.');
      shP.getRange(linhaProc, 1, 1, shP.getLastColumn()).clearContent();

      // ── 2) Aba Etapas: limpa o bloco (separador + linhas) do processo ──
      var shE = ss.getSheetByName(ABA_ETP);
      if (shE) {
        var lE = _lerAba_(shE, 'ProcessoID');
        var iPidE = lE.header.indexOf('ProcessoID');
        if (iPidE >= 0) {
          var linhasEtapa = [];
          var minRow = Infinity;
          for (var e = lE.hIdx + 1; e < lE.values.length; e++) {
            if (String(lE.values[e][iPidE] || '').trim() === pid) {
              var rowReal = e + 1;
              linhasEtapa.push(rowReal);
              if (rowReal < minRow) minRow = rowReal;
            }
          }
          if (linhasEtapa.length) {
            // Limpa cada linha de etapa
            linhasEtapa.forEach(function(rw) {
              shE.getRange(rw, 1, 1, shE.getLastColumn()).clearContent();
            });
            // Limpa o separador (linha imediatamente acima do bloco), se for
            // o título do objeto e não pertencer a outro processo.
            var sepRow = minRow - 1;
            if (sepRow > lE.hIdx + 1) {
              var sepVal = String(shE.getRange(sepRow, 1).getValue() || '').trim();
              var sepPid = String(shE.getRange(sepRow, iPidE + 1).getValue() || '').trim();
              if (sepVal && !sepPid) {
                shE.getRange(sepRow, 1, 1, shE.getLastColumn()).clearContent();
              }
            }
          }
        }
      }

      // ── 3) Aba Capacidade: limpa os registros do processo ──────────────
      var shC = null;
      ss.getSheets().forEach(function(s) { if (/capacidade/i.test(s.getName())) shC = s; });
      if (shC) {
        var dataC = shC.getRange(1, 1, shC.getLastRow(), shC.getLastColumn()).getValues();
        var regHdr = -1;
        for (var r = 0; r < dataC.length; r++) {
          var rr = dataC[r].map(function(c){ return String(c).trim(); });
          if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = r; break; }
        }
        if (regHdr >= 0) {
          var iPidC = dataC[regHdr].map(function(c){ return String(c).trim(); }).indexOf('ProcessoID');
          if (iPidC >= 0) {
            for (var c = regHdr + 1; c < dataC.length; c++) {
              if (String(dataC[c][iPidC] || '').trim() === pid) {
                shC.getRange(c + 1, 1, 1, shC.getLastColumn()).clearContent();
              }
            }
          }
        }
      }

      _limparCacheCapacidade_();
      return { ok: true, pid: pid, objeto: objeto };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// Atualiza o separador (título do bloco) do processo na aba Etapas.
function _atualizarSeparadorEtapas_(pid, objeto) {
  try {
    var shE = _ss_().getSheetByName(ABA_ETP);
    if (!shE) return;
    var lE = _lerAba_(shE, 'ProcessoID');
    var iPidE = lE.header.indexOf('ProcessoID');
    if (iPidE < 0) return;
    var minRow = Infinity;
    for (var e = lE.hIdx + 1; e < lE.values.length; e++) {
      if (String(lE.values[e][iPidE] || '').trim() === pid) {
        var rw = e + 1; if (rw < minRow) minRow = rw;
      }
    }
    if (minRow === Infinity) return;
    var sepRow = minRow - 1;
    if (sepRow > lE.hIdx + 1) {
      var sepPid = String(shE.getRange(sepRow, iPidE + 1).getValue() || '').trim();
      if (!sepPid) shE.getRange(sepRow, 1).setValue(objeto);
    }
  } catch(e) { /* silencioso: separador é cosmético */ }
}

// ── _localizarBlocoEtapas_ ─────────────────────────────────────────────────
// Localiza o bloco de etapas de um processo na aba Etapas. Retorna
// { shE, hE, sepRow } ou null se não encontrar. sepRow é a linha do separador
// (imediatamente acima da 1ª etapa); as 9 etapas ficam em sepRow+1 .. sepRow+9.
function _localizarBlocoEtapas_(pid) {
  var shE = _ss_().getSheetByName(ABA_ETP);
  if (!shE) return null;
  var lE = _lerAba_(shE, 'ProcessoID');
  var iPidE = lE.header.indexOf('ProcessoID');
  if (iPidE < 0) return null;
  var minRow = Infinity;
  for (var e = lE.hIdx + 1; e < lE.values.length; e++) {
    if (String(lE.values[e][iPidE] || '').trim() === pid) {
      var rw = e + 1; if (rw < minRow) minRow = rw;
    }
  }
  if (minRow === Infinity) return null;
  return { shE: shE, hE: lE.header, sepRow: minRow - 1 };
}

// ── _aplicarCondicionaisEtapas_ ────────────────────────────────────────────
// Aplica as condicionais das etapas de um processo, marcando "Não se aplica"
// nas etapas que não se aplicam e ajustando o nome da etapa de adequações
// conforme o envio à Procuradoria. Espelha o padrão já usado para o IRP.
//
// cfg:  { modalidade, temIRP('Sim'|'Não'), tipoCD, procuradoria('Sim'|'Não') }
// opts: { edicao: bool } — na edição, também REVERTE de "Não se aplica" para
//        pendente (vazio) as etapas que voltaram a se aplicar. NUNCA altera
//        etapas já concluídas.
//
// Regras (contratação direta):
//  - Adesão            → Minuta do TR, Versão Final do TR, IRP e Fase externa = na
//  - Dispensa s/ disputa / Inexigibilidade → Fase externa = na
//  - Dispensa c/ disputa → mantém a Fase externa
//  - Sem IRP           → etapa IRP = na (Art. 35 §único; minuta do TR permanece)
//  - Procuradoria = Não → renomeia a etapa de adequações (mantém prazo, Art. 37)
function _aplicarCondicionaisEtapas_(shE, sepRow, hE, cfg, opts) {
  cfg  = cfg  || {};
  opts = opts || {};
  var N = 9;
  var colNm = hE.indexOf('Etapa');
  var colSt = hE.indexOf('StatusEtapa ◄ EDITAR');
  if (colNm < 0 || colSt < 0) return;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  var nomes = shE.getRange(sepRow + 1, colNm + 1, N, 1).getValues().map(function(r){ return r[0]; });
  var stats = shE.getRange(sepRow + 1, colSt + 1, N, 1).getValues().map(function(r){ return String(r[0] || ''); });
  var colMot = hE.indexOf('MotivoAtraso ◄ EDITAR');
  var motivos = colMot >= 0
    ? shE.getRange(sepRow + 1, colMot + 1, N, 1).getValues().map(function(r){ return String(r[0] || ''); })
    : [];

  function achaIdx(sub) {
    for (var k = 0; k < N; k++) { if (norm(nomes[k]).indexOf(sub) >= 0) return k; }
    return -1;
  }
  var idxMinuta = achaIdx('minuta');
  var idxIRP    = achaIdx('irp');
  var idxProc   = achaIdx('procuradoria');
  if (idxProc < 0) idxProc = achaIdx('adequac');
  var idxVersao = achaIdx('versao final');
  if (idxVersao < 0) idxVersao = achaIdx('versao');
  var idxFaseE  = achaIdx('fase externa');

  var ehCD       = norm(cfg.modalidade).indexOf('direta') >= 0;
  var tipo       = norm(cfg.tipoCD);
  var ehAdesao   = ehCD && tipo.indexOf('adesao') >= 0;
  // "com disputa" (não apenas "disputa", que também aparece em "sem disputa")
  var temDisputa = ehCD && tipo.indexOf('com disputa') >= 0;
  var semIRP     = (cfg.temIRP !== 'Sim') || ehAdesao;
  var semProc    = ehCD && (cfg.procuradoria === 'Não');

  // "gerenciadas": etapas cujo status na/não-na é controlado por estas
  // condicionais. Só elas podem ser REVERTIDAS de "Não se aplica" na edição —
  // assim não reabrimos etapas marcadas na por outros motivos (ex.: Assinatura
  // do contrato, sempre na por ser responsabilidade de Contratos/Jurídico).
  var gerenciadas = {};
  [idxIRP, idxMinuta, idxVersao, idxFaseE].forEach(function(ix){ if (ix >= 0) gerenciadas[ix] = true; });

  var naSet = {};
  if (idxIRP >= 0 && semIRP) naSet[idxIRP] = true;
  if (ehAdesao) {
    if (idxMinuta >= 0) naSet[idxMinuta] = true;
    if (idxVersao >= 0) naSet[idxVersao] = true;
  }
  // Fase externa só se aplica: (a) modalidades com fase externa própria
  // (Pregão/Concorrência), ou (b) contratação direta COM disputa. Nos demais
  // casos de contratação direta (sem disputa, inexigibilidade, adesão) → na.
  if (idxFaseE >= 0 && ehCD && !temDisputa) naSet[idxFaseE] = true;

  for (var k = 0; k < N; k++) {
    if (norm(stats[k]).indexOf('conclu') >= 0) continue;     // nunca mexe em concluída
    // Nunca marcar 'na' uma etapa que carrega o marcador de retorno para fila —
    // senão o retorno fica enterrado e o processo não reaparece na fila.
    if (_isRetornoFilaMotivo_(motivos[k] || '')) continue;
    var jaNA = norm(stats[k]).indexOf('nao se aplica') >= 0;
    if (naSet[k]) {
      if (!jaNA) shE.getRange(sepRow + 1 + k, colSt + 1).setValue('Não se aplica');
    } else if (opts.edicao && jaNA && gerenciadas[k]) {
      shE.getRange(sepRow + 1 + k, colSt + 1).setValue('');  // voltou a se aplicar
    }
  }

  if (idxProc >= 0) {
    var nomeProc = semProc
      ? 'Adequações finais dos documentos'
      : 'Adequações finais dos documentos e envio à Procuradoria';
    if (norm(nomes[idxProc]) !== norm(nomeProc)) {
      shE.getRange(sepRow + 1 + idxProc, colNm + 1).setValue(nomeProc);
    }
  }
}

// Persiste a ordem manual da fila (drag-and-drop). Só chefia.
// params: { ordem: [pid1, pid2, ...] (ordem desejada), authToken }
// Grava 1,2,3,... na coluna 'OrdemFila' da aba Processos. Se a coluna não
// existir, retorna aviso pedindo que a chefia a crie (sem quebrar nada).
function salvarOrdemFilaApp(params) {
  return _withAppLockResult_('salvar ordem da fila', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var ordem = params.ordem;
      if (!ordem || !ordem.length || Object.prototype.toString.call(ordem) !== '[object Array]') {
        throw new Error('Ordem da fila não informada.');
      }

      var shP = _ss_().getSheetByName(ABA_PROC);
      if (!shP) throw new Error('Aba Processos não encontrada.');
      var lP = _lerAba_(shP, 'ProcessoID');
      var hP = lP.header;
      var iId = hP.indexOf('ProcessoID');
      var iOrd = hP.indexOf('OrdemFila');
      if (iId < 0) throw new Error('Coluna ProcessoID não encontrada.');
      if (iOrd < 0) {
        return { ok: false, semColuna: true,
          erro: 'A coluna "OrdemFila" não existe na aba Processos. Crie-a (cabeçalho exatamente "OrdemFila") para salvar a ordem da fila.' };
      }

      // Mapa pid → posição desejada (1-based)
      var posPorId = {};
      ordem.forEach(function(pid, idx) {
        pid = String(pid || '').trim();
        if (pid) posPorId[pid] = idx + 1;
      });

      // Grava célula a célula apenas nas linhas que mudam (preserva o resto)
      var gravados = 0;
      for (var i = lP.hIdx + 1; i < lP.values.length; i++) {
        var pid = String(lP.values[i][iId] || '').trim();
        if (!pid || !posPorId.hasOwnProperty(pid)) continue;
        var novo = posPorId[pid];
        var atual = parseFloat(lP.values[i][iOrd]);
        if (atual !== novo) {
          shP.getRange(i + 1, iOrd + 1).setValue(novo);
          gravados++;
        }
      }
      return { ok: true, gravados: gravados, total: ordem.length };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function trocarServidor(pid, novoServidor, authToken) {
  return _withAppLockResult_('trocar servidor', function() {
    try {
    _authRequire_(authToken, true);
    var sh = _ss_().getSheetByName('📊 Capacidade');
    if (!sh) throw new Error('Aba Capacidade não encontrada.');
    var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var regHdr = -1;
    for (var r = 0; r < data.length; r++) {
      var rr = data[r].map(function(c){ return String(c).trim(); });
      if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = r; break; }
    }
    if (regHdr < 0) throw new Error('Cabeçalho de processos não encontrado na aba Capacidade.');
    for (var r2 = regHdr + 1; r2 < data.length; r2++) {
      if (String(data[r2][2]||'').trim() === pid) {
        var cell = sh.getRange(r2 + 1, 1);
        // Remove validação temporariamente para aceitar qualquer valor, depois restaura
        var dv = cell.getDataValidation();
        cell.clearDataValidations().setValue(novoServidor || '');
        if (dv) cell.setDataValidation(dv);
        _limparCacheCapacidade_();
        return { ok: true };
      }
    }
    // Processo não encontrado na Capacidade — retorna ok sem erro (servidor mantido apenas localmente)
    return { ok: true, aviso: 'Processo não encontrado na aba Capacidade — servidor atualizado apenas localmente.' };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── atualizarStatusEtapa ──────────────────────────────────────────────────────
// Grava o novo status de uma etapa na aba fEtapas sem concluí-la.
// linha: número 1-based da linha na planilha; novoStatus: string do status.
function atualizarStatusEtapa(linha, novoStatus, authToken) {
  return _withAppLockResult_('atualizar status de etapa', function() {
    try {
    _authRequire_(authToken, false);
    var sh = _ss_().getSheetByName(ABA_ETP);
    if (!sh) throw new Error('Aba Etapas não encontrada.');
    var lE = _lerAba_(sh, 'ProcessoID');
    var iStatus = lE.header.indexOf('StatusEtapa ◄ EDITAR');
    var iPid = lE.header.indexOf('ProcessoID');
    var iFase = lE.header.indexOf('Fase');
    if (iStatus < 0) throw new Error('Coluna StatusEtapa não encontrada.');
    _setValorPreservandoValidacao_(sh.getRange(linha, iStatus + 1), _statusPlanilha_(novoStatus));
    var rowVals = lE.values[linha - 1] || [];
    var pid = iPid >= 0 ? String(rowVals[iPid] || '').trim() : '';
    var fase = iFase >= 0 ? String(rowVals[iFase] || '').trim() : '';
    var stNorm = _normStatus_(novoStatus);
    if (pid && fase && ['andamento','aguardando','paralisado','atrasado','pendente'].indexOf(stNorm) >= 0) {
      _setCapacidadeAtivo_(pid, fase, 'Sim');
    }
    _sincronizarCapacidadeComEtapas_();
    _limparCacheCapacidade_();
    return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── salvarOutrosCap ───────────────────────────────────────────────────────────
// Reabre a etapa concluída imediatamente anterior e registra justificativa.
function regredirEtapa(params) {
  return _withAppLockResult_('regredir etapa', function() {
    try {
    params = params || {};
    _authRequire_(params.authToken, false);
    var pid = String(params.processoId || '').trim();
    var linhaAtual = parseInt(params.linhaEtapaAtual, 10);
    var motivo = String(params.motivo || '').trim();
    var servidor = String(params.servidor || '').trim() || '—';
    if (!pid) throw new Error('Processo não informado.');
    if (!linhaAtual) throw new Error('Linha da etapa atual não informada.');
    if (motivo.length < 8) throw new Error('Informe uma justificativa para a regressão.');

    var sh = _ss_().getSheetByName(ABA_ETP);
    if (!sh) throw new Error('Aba Etapas não encontrada.');
    var lE = _lerAba_(sh, 'ProcessoID');
    var hdr = lE.header;
    var iPid = hdr.indexOf('ProcessoID');
    var iNome = hdr.indexOf('Etapa');
    var iFase = hdr.indexOf('Fase');
    var iStatus = hdr.indexOf('StatusEtapa ◄ EDITAR');
    var iMotivo = hdr.indexOf('MotivoAtraso ◄ EDITAR');
    var iData = hdr.indexOf('DataRealizacao◄ EDITAR');
    if (iPid < 0 || iNome < 0 || iStatus < 0) throw new Error('Colunas obrigatórias não encontradas na aba Etapas.');

    var idxAtual = linhaAtual - 1;
    var rowAtual = lE.values[idxAtual] || [];
    if (String(rowAtual[iPid] || '').trim() !== pid) throw new Error('A etapa atual não pertence ao processo informado.');

    var idxAnterior = -1;
    for (var i = idxAtual - 1; i > lE.hIdx; i--) {
      var r = lE.values[i] || [];
      if (String(r[iPid] || '').trim() !== pid) continue;
      var fase = iFase >= 0 ? String(r[iFase] || '').trim() : '';
      var nome = String(r[iNome] || '').trim();
      if (_isEtapaContratual_(fase, nome)) continue;
      if (_normStatus_(String(r[iStatus] || '').trim()) === 'na') continue;
      idxAnterior = i;
      break;
    }
    if (idxAnterior < 0) throw new Error('Não há etapa anterior aplicável para reabrir.');

    var linhaAnterior = idxAnterior + 1;
    var nomeAnterior = String(lE.values[idxAnterior][iNome] || '').trim();
    var nomeAtual = String(rowAtual[iNome] || params.etapaAtual || '').trim();

    _setValorPreservandoValidacao_(sh.getRange(linhaAnterior, iStatus + 1), 'Em andamento');
    if (iData >= 0) sh.getRange(linhaAnterior, iData + 1).clearContent();
    if (iMotivo >= 0) sh.getRange(linhaAnterior, iMotivo + 1).clearContent();

    if (linhaAtual !== linhaAnterior) {
      sh.getRange(linhaAtual, iStatus + 1).setValue('Não iniciada');
      if (iData >= 0) sh.getRange(linhaAtual, iData + 1).clearContent();
      if (iMotivo >= 0) sh.getRange(linhaAtual, iMotivo + 1).clearContent();
    }

    _appendHist_({
      ts: new Date(),
      pid: pid,
      etapa: nomeAnterior,
      servidor: servidor,
      motivo: 'REGRESSAO: ' + motivo + (nomeAtual ? ' | etapa atual: ' + nomeAtual : ''),
      dias: 0,
      dataRealiz: ''
    });

    _sincronizarCapacidadeComEtapas_();
    _limparCacheCapacidade_();
    return { ok: true, etapaReaberta: nomeAnterior, etapaAtual: nomeAtual };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
  });
}

function devolverProcessoFilaApp(params) {
  return _withAppLockResult_('devolver processo para fila', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || params.pid || '').trim();
      var motivo = String(params.motivo || '').trim();
      var servidor = String(params.servidor || '').trim() || '—';
      if (!pid) throw new Error('Processo não informado.');
      if (motivo.length < 8) throw new Error('Informe o motivo do retorno para a fila.');

      var ss = _ss_();
      var shP = ss.getSheetByName(ABA_PROC);
      var shE = ss.getSheetByName(ABA_ETP);
      if (!shP || !shE) throw new Error('Abas obrigatórias não encontradas.');

      var lP = _lerAba_(shP, 'ProcessoID');
      var hP = lP.header;
      var iPidP = hP.indexOf('ProcessoID');
      if (iPidP < 0) throw new Error('Coluna ProcessoID não encontrada em Processos.');
      var iModalP = hP.indexOf('Modalidade');
      var iIrpP   = hP.indexOf('Tem IRP?');
      var iTipoP  = hP.indexOf('Tipo Contratação Direta');
      var iProcP  = hP.indexOf('Envio à Procuradoria?');
      var existeProc = false;
      var procCond = { modal:'', temIRP:false, tipoCD:'', procuradoria:true };
      for (var rp = lP.hIdx + 1; rp < lP.values.length; rp++) {
        if (String(lP.values[rp][iPidP] || '').trim() === pid) {
          existeProc = true;
          procCond.modal        = iModalP >= 0 ? String(lP.values[rp][iModalP] || '').trim() : '';
          procCond.temIRP       = iIrpP  >= 0 && String(lP.values[rp][iIrpP] || '').trim().toLowerCase() === 'sim';
          procCond.tipoCD       = iTipoP >= 0 ? String(lP.values[rp][iTipoP] || '').trim() : '';
          procCond.procuradoria = iProcP < 0 || String(lP.values[rp][iProcP] || '').trim().toLowerCase() !== 'não';
          break;
        }
      }
      if (!existeProc) throw new Error('Processo não encontrado.');
      // Etapas que a leitura oculta como "Não se aplica" (IRP, TR em adesão,
      // fase externa) devem ser puladas ao escolher a etapa-alvo do retorno.
      var _naL = (function() {
        var eh = _normText_(procCond.modal).indexOf('direta') >= 0;
        var tp = _normText_(procCond.tipoCD);
        var ad = eh && tp.indexOf('adesao') >= 0;
        var dp = eh && tp.indexOf('com disputa') >= 0;
        var sIRP = !procCond.temIRP || ad;
        return function(nomeEt) {
          var n = _normText_(nomeEt);
          if (n.indexOf('irp') >= 0 && sIRP) return true;
          if (ad && (n.indexOf('minuta') >= 0 || n.indexOf('versao final') >= 0)) return true;
          if (n.indexOf('fase externa') >= 0 && eh && !dp) return true;
          return false;
        };
      })();

      var lE = _lerAba_(shE, 'ProcessoID');
      var hdr = lE.header;
      var iPid = hdr.indexOf('ProcessoID');
      var iNome = hdr.indexOf('Etapa');
      var iFase = hdr.indexOf('Fase');
      var iStatus = hdr.indexOf('StatusEtapa ◄ EDITAR');
      var iMotivo = hdr.indexOf('MotivoAtraso ◄ EDITAR');
      if (iPid < 0 || iNome < 0 || iStatus < 0) throw new Error('Colunas obrigatórias não encontradas na aba Etapas.');
      if (iMotivo < 0) throw new Error('Coluna MotivoAtraso não encontrada na aba Etapas.');

      var idxAlvo = -1;
      var idxPrimeiraPendente = -1;
      var idxRetornada = -1;
      var concluidas = 0;
      for (var i = lE.hIdx + 1; i < lE.values.length; i++) {
        var row = lE.values[i] || [];
        if (String(row[iPid] || '').trim() !== pid) continue;
        var fase = iFase >= 0 ? String(row[iFase] || '').trim() : '';
        var nome = String(row[iNome] || '').trim();
        if (!nome || _isEtapaContratual_(fase, nome)) continue;
        var st = _normStatus_(row[iStatus]);
        // Pula etapas 'na' (gravadas) e as derivadas 'na' pelas condicionais,
        // exceto se já carregam um marcador de retorno.
        if ((st === 'na' || _naL(nome)) && !_isRetornoFilaMotivo_(row[iMotivo])) continue;
        if (st === 'ok') { concluidas++; continue; }
        if ((st === 'retornado' || _isRetornoFilaMotivo_(row[iMotivo])) && idxRetornada < 0) idxRetornada = i;
        if (st === 'pendente' && idxPrimeiraPendente < 0) idxPrimeiraPendente = i;
        if (idxAlvo < 0 && ['andamento','aguardando','paralisado','atrasado','retornado'].indexOf(st) >= 0) idxAlvo = i;
      }
      if (idxAlvo < 0) idxAlvo = idxRetornada >= 0 ? idxRetornada : idxPrimeiraPendente;
      if (idxAlvo < 0) throw new Error('Não encontrei etapa aplicável para marcar o retorno à fila.');

      var linhaAlvo = idxAlvo + 1;
      var nomeAlvo = String(lE.values[idxAlvo][iNome] || '').trim();
      var statusPreservado = _normStatus_(lE.values[idxAlvo][iStatus]);
      var motivoAnterior = String(lE.values[idxAlvo][iMotivo] || '').trim();
      var motivoMarcado = 'RETORNO PARA FILA: ' + motivo;
      if (motivoAnterior && !_isRetornoFilaMotivo_(motivoAnterior)) {
        motivoMarcado += '\nMOTIVO ANTERIOR: ' + motivoAnterior;
      }
      shE.getRange(linhaAlvo, iMotivo + 1).setValue(motivoMarcado);

      _setCapacidadeAtivo_(pid, 'interna', 'Não');
      _setCapacidadeAtivo_(pid, 'externa', 'Não');
      _appendHist_({
        ts: new Date(),
        pid: pid,
        etapa: nomeAlvo,
        servidor: servidor,
        motivo: 'RETORNO PARA FILA: ' + motivo,
        dias: 0,
        dataRealiz: ''
      });
      _limparCacheCapacidade_();
      return { ok: true, etapa: nomeAlvo, statusPreservado: statusPreservado, concluidasPreservadas: concluidas };
    } catch(e) {
      return { ok: false, erro: e.message };
    }
  });
}

// params: {linha (1-based), valor, col (2=interna / 11=externa)}
function salvarOutrosCap(params) {
  return _withAppLockResult_('salvar outros pontos', function() {
    try {
    _authRequire_(params && params.authToken, true);
    var sh = _ss_().getSheetByName('📊 Capacidade');
    if (!sh) throw new Error('Aba Capacidade não encontrada.');
    var linha = parseInt(params.linha, 10);
    var col = parseInt(params.col || 2, 10);
    var valor = params.valor || 0;
    if (linha > 0 && col > 0) {
      sh.getRange(linha, col).setValue(valor);
    } else if (params.servidor) {
      var fase = String(params.fase || 'int').toLowerCase().indexOf('ext') >= 0 ? 'ext' : 'int';
      PropertiesService.getScriptProperties()
        .setProperty(_propKeyServidor_('cap_outros_' + fase, params.servidor), String(valor));
    } else {
      throw new Error('Servidor não informado para salvar Outros.');
    }
    _limparCacheCapacidade_();
    return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── salvarPontuacaoCap ────────────────────────────────────────────────────────
// Grava pontuação guiada de um processo na aba Capacidade.
// params: {linha (1-based), pts11, pts12, pts23}
//   cols 7,8,9 = "1.1 ou 2.1 (pts)", "1.2 ou 2.2 (pts)", "2.3 (pts)"
function salvarPontuacaoCap(params) {
  return _withAppLockResult_('salvar pontuação de capacidade', function() {
    try {
    _authRequire_(params && params.authToken, true);
    var sh = _ss_().getSheetByName('📊 Capacidade');
    if (!sh) throw new Error('Aba Capacidade não encontrada.');
    var p1 = parseFloat(params.pts11) || 0;
    var p2 = parseFloat(params.pts12) || 0;
    var p3 = parseFloat(params.pts23) || 0;
    sh.getRange(params.linha, 7).setValue(p1);
    sh.getRange(params.linha, 8).setValue(p2);
    sh.getRange(params.linha, 9).setValue(p3);
    var data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
    var regHdr = -1;
    for (var r = 0; r < data.length; r++) {
      var rr = data[r].map(function(c){ return String(c).trim(); });
      if (rr[0].indexOf('Servidor') >= 0 && rr[2] === 'ProcessoID') { regHdr = r; break; }
    }
    if (regHdr >= 0) {
      var h = data[regHdr].map(function(c){ return String(c).trim(); });
      var iTotal = h.indexOf('Total');
      if (iTotal >= 0) sh.getRange(params.linha, iTotal + 1).setValue(p1 + p2 + p3);
    } else if (sh.getLastColumn() >= 10) {
      sh.getRange(params.linha, 10).setValue(p1 + p2 + p3);
    }
    _limparCacheCapacidade_();
    return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── getEmails ─────────────────────────────────────────────────────────────
// ── getServidoresApp ──────────────────────────────────────────────────────────
// Retorna a lista de servidores do setor como array de objetos:
//   [{nome, cor, isChefe, email}]
// Lê de PropertiesService (chave SEL_SERVIDORES_JSON). Se não existir, usa padrão.
// ── getServidoresApp ───────────────────────────────────────────────────
// Retorna a lista de servidores do setor como array de objetos:
//   [{nome, cor, isChefe, email}]
// Lê de PropertiesService (chave SEL_SERVIDORES_JSON). Se não existir, usa padrão.
function _getServidoresApp_() {
  var props = PropertiesService.getScriptProperties();
  var ehRei = _ehReitoria_();
  var raw   = props.getProperty(_servKey_());
  if (!raw && ehRei) raw = props.getProperty('SEL_SERVIDORES_JSON'); // legado (Reitoria)
  var lista;
  if (raw) {
    try { lista = JSON.parse(raw); } catch(e) { lista = null; }
  }
  // Planilha e lista padrão só valem para a Reitoria; unidades novas começam vazias.
  if ((!lista || !lista.length) && ehRei) {
    lista = _lerServidoresConfigSheet_();
  }
  if ((!lista || !lista.length) && ehRei) {
    lista = [
      { nome:'Amanda',  matricula:'amanda',  cor:'#2563eb', isChefe:true  },
      { nome:'Beatriz', matricula:'beatriz', cor:'#db2777', isChefe:false },
      { nome:'Bruno',   matricula:'bruno',   cor:'#7c3aed', isChefe:false },
      { nome:'Samuel',  matricula:'samuel',  cor:'#d97706', isChefe:true  }
    ];
  }
  if (!lista) lista = [];
  // Enriquece com email por unidade (Reitoria mantém fallback ao legado/EMAILS_SEL).
  lista.forEach(function(s) {
    s.matricula = s.matricula || _authMatriculaPadrao_(s.nome);
    s.email = props.getProperty(_emailKey_(s.nome))
      || (ehRei ? (props.getProperty('email_' + s.nome) || _emailServidorFallback_(s.nome)) : '')
      || '';
  });
  _authSyncServidores_(lista);
  return lista;
}

// ── salvarServidoresApp ───────────────────────────────────────────────────────
// Persiste a lista completa de servidores no PropertiesService.
// lista: [{nome, cor, isChefe}] — e-mails são mantidos separadamente.
function getServidoresApp(authToken) {
  _authRequire_(authToken, false);
  var lista = _getServidoresApp_();
  // Poda fantasmas no Firestore ao carregar (best-effort): remove docs de
  // servidores já excluídos para que a Capacidade não os exiba, mesmo sem um
  // novo "salvar equipe". Escopado à unidade do request (mesma de _servKey_).
  // Não bloqueia o retorno em caso de erro.
  try {
    if (typeof _fsPodarServidoresOrfaos_ === 'function'
        && PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID')) {
      _fsPodarServidoresOrfaos_(lista.map(function(s){ return s.matricula; }));
    }
  } catch (e) {}
  return lista;
}

function salvarServidoresApp(lista, authToken) {
  return _withAppLockResult_('salvar equipe', function() {
    try {
    _authRequire_(authToken, true);
    if (!Array.isArray(lista)) throw new Error('Lista inválida.');
    var props = PropertiesService.getScriptProperties();
    var antiga = _getServidoresApp_().map(function(s) {
      return { nome: String(s.nome || '').trim(), matricula: String(s.matricula || '').trim(), cor: s.cor, isChefe: !!s.isChefe };
    });
    lista.forEach(function(s) {
      if (!s.nome || !s.nome.trim()) throw new Error('Nome em branco.');
    });
    var limpa = lista.map(function(s) {
      var nomeLimpo = s.nome.trim();
      return { nome: nomeLimpo, matricula: _authNorm_(s.matricula || _authMatriculaPadrao_(nomeLimpo)), cor: s.cor || '#64748b', isChefe: !!s.isChefe };
    });

    var vistos = {};
    limpa.forEach(function(s) {
      var k = _normServidorNome_(s.nome);
      if (vistos[k]) throw new Error('Servidor duplicado: ' + s.nome + '.');
      vistos[k] = true;
      var km = _authNorm_(s.matricula);
      if (!km) throw new Error('Matrícula em branco para ' + s.nome + '.');
      if (vistos['mat_' + km]) throw new Error('Matrícula duplicada: ' + s.matricula + '.');
      vistos['mat_' + km] = true;
    });

    if (!limpa.some(function(s) { return !!s.isChefe; })) {
      throw new Error('Mantenha ao menos um servidor marcado como chefia.');
    }

    var novos = {};
    limpa.forEach(function(s) { novos[_normServidorNome_(s.nome)] = true; });

    // Renomeação detectada pela MATRÍCULA (estável), nunca pela posição na
    // lista: parear por índice fazia a remoção de um servidor do meio da lista
    // ser lida como uma cadeia de renomeações (ex.: remover a 1ª pessoa virava
    // "Amanda"→"Beatriz"), reatribuindo os processos dela a outra pessoa e
    // pulando a trava de vínculos ativos abaixo.
    var renomes = [];
    var antigosRenomeados = {};
    var novaPorMat = {};
    limpa.forEach(function(s) { novaPorMat[_authNorm_(s.matricula)] = s; });
    antiga.forEach(function(s) {
      var mat = _authNorm_(s.matricula);
      var novo = mat ? novaPorMat[mat] : null;
      if (!novo) return;
      var oldN = _normServidorNome_(s.nome);
      var newN = _normServidorNome_(novo.nome);
      if (oldN && newN && oldN !== newN && !novos[oldN]) {
        renomes.push({ antigo: s.nome, novo: novo.nome });
        antigosRenomeados[oldN] = true;
      }
    });

    var bloqueados = [];
    antiga.forEach(function(s) {
      var k = _normServidorNome_(s.nome);
      if (!k || novos[k] || antigosRenomeados[k]) return;
      var vinc = _servidorTemVinculosAtivos_(s.nome);
      if (vinc.tem) bloqueados.push(s.nome + ' (' + vinc.total + ' vínculo(s) ativo(s))');
    });
    if (bloqueados.length) {
      throw new Error('Não removi servidor com processo ativo: ' + bloqueados.join(', ') + '. Reatribua os processos antes de remover.');
    }

    props.setProperty(_servKey_(), JSON.stringify(limpa));
    if (_ehReitoria_()) _salvarServidoresConfigSheet_(limpa); // planilha é só da Reitoria
    // Usuários NOVOS nascem com senha temporária ALEATÓRIA (não mais "123456").
    // Enviamos por e-mail quando o servidor tem e-mail cadastrado; quando não
    // tem, a senha volta em `novosAcessos` para a chefia repassar manualmente.
    var criados = [];
    _authSyncServidores_(limpa, criados);
    var novosAcessos = criados.map(function(c) {
      var emailDest = _emailServidorPorNome_(c.nome);
      var enviado = false;
      if (emailDest) {
        try {
          _enviarEmailSenhaTemp_(emailDest, c.nome, c.matricula, c.senhaTemp,
            'Você foi cadastrado(a) na equipe do AppSEL.');
          enviado = true;
        } catch(e) { enviado = false; }
      }
      return { nome: c.nome, matricula: c.matricula,
               senhaTemp: enviado ? '' : c.senhaTemp,   // só expõe se não foi possível enviar
               emailEnviado: enviado, email: enviado ? emailDest : '' };
    });

    // Limpa o e-mail dos servidores REMOVIDOS (não estão na nova lista e não foram
    // renomeados). Sem isso, o e-mail antigo permanecia no PropertiesService e o
    // servidor continuava aparecendo na lista de E-mails mesmo após a remoção.
    antiga.forEach(function(s) {
      var k = _normServidorNome_(s.nome);
      if (!k || novos[k] || antigosRenomeados[k]) return;
      try { props.deleteProperty(_emailKey_(s.nome)); } catch(e) {}
      if (_ehReitoria_()) { try { props.deleteProperty('email_' + s.nome); } catch(e) {} } // chave legada
    });

    var alterados = 0;
    renomes.forEach(function(rn) {
      var oldEmailKey = _emailKey_(rn.antigo);
      var newEmailKey = _emailKey_(rn.novo);
      var oldEmail = props.getProperty(oldEmailKey);
      if (oldEmail && !props.getProperty(newEmailKey)) props.setProperty(newEmailKey, oldEmail);
      alterados += _renomearServidorNasAbas_(rn.antigo, rn.novo);
    });
    if (renomes.length) _sincronizarCapacidadeComEtapas_();

    // Fase 3: espelha equipe/e-mails no Firestore (aditivo; auth continua aqui).
    try {
      if (typeof fs_espelharServidores_ === 'function'
          && PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID')) {
        var emailsMap = {};
        limpa.forEach(function(s) { emailsMap[s.nome] = props.getProperty(_emailKey_(s.nome)) || ''; });
        fs_espelharServidores_(limpa, emailsMap);
      }
    } catch(eMirror) { /* espelho é best-effort; não bloqueia o salvar */ }

    return { ok: true, renomes: renomes.length, alterados: alterados,
             servidores: _getServidoresApp_(), novosAcessos: novosAcessos };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// Retorna {Amanda: email, Beatriz: email, ...} do PropertiesService.
// Usa lista dinâmica de servidores.
function getEmails(authToken) {
  return _getEmails_(_authRequire_(authToken, false));
}

function _getEmails_(sess) {
  var lista = _getServidoresApp_();
  var props = PropertiesService.getScriptProperties();
  var emails = {};
  lista.forEach(function(s) {
    if (sess.isChefe || _normServidorNome_(sess.nome) === _normServidorNome_(s.nome)) {
      emails[s.nome] = props.getProperty(_emailKey_(s.nome))
        || (_ehReitoria_() ? (props.getProperty('email_' + s.nome) || _emailServidorFallback_(s.nome)) : '')
        || '';
    }
  });
  return emails;
}

// ── salvarEmail ───────────────────────────────────────────────────────────
// Salva/atualiza o e-mail de um servidor no PropertiesService.
function salvarEmail(servidor, email, authToken) {
  return _withAppLockResult_('salvar email de servidor', function() {
    try {
    var sess = _authRequire_(authToken, false);
    if (!servidor) throw new Error('Servidor não informado.');
    if (!sess.isChefe && _normServidorNome_(sess.nome) !== _normServidorNome_(servidor)) {
      throw new Error('Você só pode alterar o próprio e-mail.');
    }
    if (email && email.indexOf('@') < 0) throw new Error('E-mail inválido.');
    PropertiesService.getScriptProperties().setProperty(_emailKey_(servidor), String(email || '').trim());
    if (_ehReitoria_()) _salvarServidoresConfigSheet_(_getServidoresApp_());
    return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── instalarTriggerAvisos ─────────────────────────────────────────────────
// Chamada pelo botão "Instalar trigger" no app.
// Remove triggers anteriores (se existirem) e instala novos em dois horarios, de segunda a sexta.
function instalarTriggerAvisos(authToken) {
  return _withAppLock_('instalar trigger de avisos', function() {
    _authRequire_(authToken, true);
    var handlersAviso = ['enviarAvisosPrazo', 'enviarAvisosPrazoProximos', 'enviarAvisosPrazoVencidos'];
    ScriptApp.getProjectTriggers().forEach(function(t) {
      if (handlersAviso.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
    });
    var diasUteis = [
      ScriptApp.WeekDay.MONDAY,
      ScriptApp.WeekDay.TUESDAY,
      ScriptApp.WeekDay.WEDNESDAY,
      ScriptApp.WeekDay.THURSDAY,
      ScriptApp.WeekDay.FRIDAY
    ];
    diasUteis.forEach(function(dia) {
      ScriptApp.newTrigger('enviarAvisosPrazoProximos')
        .timeBased()
        .onWeekDay(dia)
        .atHour(AVISO_PROXIMOS_HORA)
        .nearMinute(AVISO_PROXIMOS_MINUTO)
        .create();
      ScriptApp.newTrigger('enviarAvisosPrazoVencidos')
        .timeBased()
        .onWeekDay(dia)
        .atHour(AVISO_VENCIDOS_HORA)
        .nearMinute(AVISO_VENCIDOS_MINUTO)
        .create();
    });
    PropertiesService.getScriptProperties().setProperties({
      SEL_TRIGGER_AVISOS_INSTALADO_EM: new Date().toISOString(),
      SEL_TRIGGER_AVISOS_HORA: AVISO_HORARIOS_LABEL,
      SEL_TRIGGER_AVISOS_PROXIMOS_HORA: AVISO_PROXIMOS_LABEL,
      SEL_TRIGGER_AVISOS_VENCIDOS_HORA: AVISO_VENCIDOS_LABEL,
      SEL_TRIGGER_AVISOS_TZ: Session.getScriptTimeZone(),
      SEL_TRIGGER_AVISOS_DIAS: AVISOS_DIAS_LABEL
    });
    return 'Triggers instalados. Prazos proximos: ' + AVISO_PROXIMOS_LABEL + '; etapas vencidas: ' + AVISO_VENCIDOS_LABEL + ', de ' + AVISOS_DIAS_LABEL + '.';
  });
}

// ── verificarTriggerAvisos ────────────────────────────────────────────────
// Informa se os triggers de avisos estao instalados.
function verificarTriggerAvisos(authToken) {
  try {
    _authRequire_(authToken, false);
    var triggers = ScriptApp.getProjectTriggers();
    var props = PropertiesService.getScriptProperties();
    var temProximos = false;
    var temVencidos = false;
    var temLegado = false;
    for (var i = 0; i < triggers.length; i++) {
      var handler = triggers[i].getHandlerFunction();
      if (handler === 'enviarAvisosPrazoProximos') temProximos = true;
      if (handler === 'enviarAvisosPrazoVencidos') temVencidos = true;
      if (handler === 'enviarAvisosPrazo') temLegado = true;
    }
    if (temProximos && temVencidos) {
      return {
        instalado: true,
        hora: props.getProperty('SEL_TRIGGER_AVISOS_HORA') || AVISO_HORARIOS_LABEL,
        dias: props.getProperty('SEL_TRIGGER_AVISOS_DIAS') || AVISOS_DIAS_LABEL,
        timezone: props.getProperty('SEL_TRIGGER_AVISOS_TZ') || Session.getScriptTimeZone(),
        instaladoEm: props.getProperty('SEL_TRIGGER_AVISOS_INSTALADO_EM') || ''
      };
    }
    if (temLegado || temProximos || temVencidos) {
      return {
        instalado: false,
        erro: 'Acionador antigo ou incompleto encontrado. Clique em Instalar/Reinstalar trigger.',
        timezone: Session.getScriptTimeZone()
      };
    }
    return { instalado: false, timezone: Session.getScriptTimeZone() };
  } catch(e) { return { instalado: false, erro: e.message }; }
}

// Envia um e-mail simples para validar permissões e configuração do MailApp.
function enviarEmailTesteServidor(servidor, authToken) {
  try {
    var sess = _authRequire_(authToken, false);
    servidor = String(servidor || '').trim();
    if (!servidor) throw new Error('Servidor não informado.');
    if (!sess.isChefe && _normServidorNome_(sess.nome) !== _normServidorNome_(servidor)) {
      throw new Error('Você só pode testar o próprio e-mail.');
    }
    var emails = _getEmails_(sess);
    var dest = emails[servidor] || _emailServidorFallback_(servidor) || '';
    if (!dest || dest.indexOf('@') < 0 || dest.indexOf('COLE_') === 0) {
      throw new Error('E-mail de ' + servidor + ' não está cadastrado na Config.');
    }
    var tz = Session.getScriptTimeZone();
    var agora = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy HH:mm');
    var html = '<div style="font-family:Arial,sans-serif;max-width:560px;color:#1e293b;">'
      + '<div style="background:#1a3a5c;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;">'
      + '<h2 style="margin:0;font-size:16px;">Teste de e-mail - SEL/CPII</h2>'
      + '<p style="margin:3px 0 0;font-size:12px;opacity:.85;">Envio automático de avisos de prazo</p>'
      + '</div>'
      + '<div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:16px;">'
      + 'Olá, <b>' + servidor + '</b>.<br><br>'
      + 'Este é um teste para confirmar que o Apps Script consegue enviar e-mail pela configuração atual.'
      + '<br><br><span style="color:#64748b;font-size:12px;">Horário do projeto: ' + agora + ' (' + tz + ').</span>'
      + '</div></div>';
    MailApp.sendEmail(dest, 'Teste de e-mail - App Gestão de Etapas SEL', '', { htmlBody: html });
    return { ok: true, email: dest };
  } catch(e) {
    return { ok: false, erro: e.message };
  }
}

// ── atribuirResponsaveisApp ───────────────────────────────────────────────
// Atribui até 2 responsáveis a um processo (fase interna + fase externa).
// Atualiza coluna "Agente Responsável" na aba Etapas e coluna Servidor na Capacidade.
// params: {pid, servInt, servExt, modal}
// Retorna: {ok, avisos: [{fase, msg}]}
function atribuirResponsaveisApp(params) {
  return _withAppLockResult_('atribuir responsáveis', function() {
    try {
    _authRequire_(params && params.authToken, true);
    var ss     = _ss_();
    var pid    = params.pid    || '';
    var servInt = params.servInt || '';
    var servExt = params.servExt || '';
    var mNorm  = (params.modal || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
    var ehPE   = mNorm.indexOf('pregao') >= 0 || mNorm.indexOf('concorr') >= 0;
    var avisos = [];
    if (ehPE && servInt && servExt && servInt === servExt) {
      throw new Error('Fase interna e fase externa precisam ter responsáveis diferentes em Pregão/Concorrência.');
    }

    // ── 1. Capacidade ─────────────────────────────────────────────
    var shCap = ss.getSheetByName('📊 Capacidade');
    if (shCap) {
      var capData = shCap.getRange(1, 1, shCap.getLastRow(), shCap.getLastColumn()).getValues();
      var regHdr = -1;
      for (var ci = 0; ci < capData.length; ci++) {
        var cr = capData[ci].map(function(c){ return String(c).trim(); });
        if (cr[0].indexOf('Servidor') >= 0 && cr[2] === 'ProcessoID') { regHdr = ci; break; }
      }
      var foundInt = false, foundExt = false;
      if (regHdr >= 0) {
        for (var r = regHdr + 1; r < capData.length; r++) {
          var cpid  = String(capData[r][2]||'').trim();
          if (cpid !== pid) continue;
          var cfase = String(capData[r][5]||'').trim().toLowerCase();
          if (cfase.indexOf('ext') >= 0) {
            foundExt = true;
            var ce = shCap.getRange(r + 1, 1);
            var dve = ce.getDataValidation();
            ce.clearDataValidations().setValue(ehPE ? servExt : (servExt || servInt || ''));
            if (dve) ce.setDataValidation(dve);
          } else {
            foundInt = true;
            var ci2 = shCap.getRange(r + 1, 1);
            var dvi = ci2.getDataValidation();
            ci2.clearDataValidations().setValue(servInt || '');
            if (dvi) ci2.setDataValidation(dvi);
          }
        }
      }
      if (servInt && !foundInt)
        avisos.push({ fase:'Interna', msg:'Processo não encontrado na Capacidade (fase interna). Vá à aba Capacidade e adicione a pontuação manualmente.' });
      if (ehPE && servExt && !foundExt)
        avisos.push({ fase:'Externa', msg:'Processo não encontrado na Capacidade (fase externa). Vá à aba Capacidade e adicione a pontuação manualmente.' });
    }

    // ── 2. Etapas — Agente Responsável ────────────────────────────
    var shE = ss.getSheetByName(ABA_ETP);
    if (shE) {
      var lE   = _lerAba_(shE, 'ProcessoID');
      var hdr  = lE.header;
      var iPid = hdr.indexOf('ProcessoID');
      var iAg  = hdr.indexOf('Agente Responsável');
      var iFas = hdr.indexOf('Fase');
      var iStat = hdr.indexOf('StatusEtapa ◄ EDITAR');
      var faseAtual = '';
      if (iAg >= 0) {
        for (var j = lE.hIdx + 1; j < lE.values.length; j++) {
          var epid  = String(lE.values[j][iPid]||'').trim();
          if (epid !== pid) continue;
          var efase = String(lE.values[j][iFas]||'').trim().toLowerCase();
          var estat = iStat >= 0 ? _normStatus_(lE.values[j][iStat]) : 'pendente';
          if (!faseAtual && estat !== 'ok' && estat !== 'na') faseAtual = efase;
          var novoAg = efase.indexOf('ext') >= 0
            ? (ehPE ? (servExt || '') : (servExt || servInt || ''))
            : (servInt || '');
          shE.getRange(j + 1, iAg + 1).setValue(novoAg);
        }
        if (faseAtual) _setCapacidadeAtivo_(pid, faseAtual, 'Sim');
      }
    }

    _sincronizarCapacidadeComEtapas_();
    _limparCacheCapacidade_();
    return { ok: true, avisos: avisos };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}
