/* ════════════════════════════════════════════════════════════════════════
 * FirestoreSync.gs — Fase 3/4: Apps Script ↔ Firestore via REST (sem biblioteca)
 *
 * NÃO precisa adicionar a biblioteca FirestoreApp. Fala com o Firestore pela
 * API REST (UrlFetchApp + JWT da conta de serviço). Reusa helpers do Code.gs:
 * _authRequire_, _withAppLockResult_, _normStatus_, _isEtapaContratual_,
 * _isRetornoFilaMotivo_, _statusPlanilha_, _toIso_, _isModalidadeExtSegregada_,
 * _addDU_, _contDU_.
 *
 * ATIVAÇÃO (uma vez): rodar `_setupFirestoreProps_` (grava as propriedades) e
 * depois `testarMigracao` para conferir. Não precisa de biblioteca nem mexer na
 * tela de propriedades (que fica read-only com +50 props).
 * ════════════════════════════════════════════════════════════════════════ */

// ── SETUP: roda UMA vez para gravar as propriedades do Firestore ───────────
// (sem underscore no nome para aparecer no menu Executar do editor)
function setupFirestoreProps() {
  var sa = {
    "project_id": "gestao-de-processos-a0099",
    "client_email": "firebase-adminsdk-fbsvc@gestao-de-processos-a0099.iam.gserviceaccount.com",
    // ⚠️ NÃO versionar a chave privada. Ela já está gravada nas Script Properties
    // (rode setupFirestoreProps UMA vez com a chave real colada aqui localmente,
    // depois remova). Baixe a chave em: Firebase Console → Configurações do projeto
    // → Contas de serviço → Gerar nova chave privada, e cole o campo private_key.
    "private_key": "-----BEGIN PRIVATE KEY-----\nCOLE_AQUI_A_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
  };
  var pr = PropertiesService.getScriptProperties();
  pr.setProperty('FS_PROJECT_ID', sa.project_id);
  pr.setProperty('FS_CLIENT_EMAIL', sa.client_email);
  pr.setProperty('FS_PRIVATE_KEY', sa.private_key);
  pr.setProperty('FS_ATIVO', 'true');
  Logger.log('OK! FS_* gravadas. Agora rode testarMigracao.');
}

// ── TESTE: confirma leitura + escrita no Firestore ────────────────────────
function testarMigracao() {
  var fs = _fs_();
  ['processos', 'etapas', 'cargas', 'servidores'].forEach(function (c) {
    Logger.log(c + ': ' + fs.query(c).Execute().length + ' documentos');
  });
  _fsSet_('_fsteste/ping', { ok: true, quando: new Date() });
  var lido = _fsGet_('_fsteste/ping');
  Logger.log('Escrita+leitura: ' + (lido && lido.ok ? 'OK ✓' : 'FALHOU'));
  _fsDelete_('_fsteste/ping');
  Logger.log('=== Se as contagens vieram > 0 e deu "OK", a migracao FUNCIONA. ===');
}

// ════════════════════════════════════════════════════════════════════════
// Conexão REST (sem biblioteca). _fs_() devolve um objeto com a MESMA API
// que o restante do arquivo usa (getDocument/updateDocument/createDocument/
// deleteDocument/query.Where.Execute), então a lógica abaixo não muda.
// ════════════════════════════════════════════════════════════════════════
function _fsToken_() {
  var pr = PropertiesService.getScriptProperties();
  var email = pr.getProperty('FS_CLIENT_EMAIL');
  var key = pr.getProperty('FS_PRIVATE_KEY');
  if (!email || !key) throw new Error('Firestore nao configurado (rode setupFirestoreProps).');
  key = key.replace(/\\n/g, '\n');
  var cache = CacheService.getScriptCache();
  var cached = cache.get('FS_TOKEN');
  if (cached) return cached;
  var now = Math.floor(Date.now() / 1000);
  var head = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claim = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', exp: now + 3600, iat: now
  }));
  var sig = Utilities.computeRsaSha256Signature(head + '.' + claim, key);
  var jwt = head + '.' + claim + '.' + Utilities.base64EncodeWebSafe(sig);
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
  });
  var tok = JSON.parse(resp.getContentText()).access_token;
  if (!tok) throw new Error('Falha ao autenticar no Firestore: ' + resp.getContentText());
  cache.put('FS_TOKEN', tok, 3000);
  return tok;
}

// Unidade alvo (multiunidade). Default reitoria-sel; pode vir da Script Property
// FS_UNIDADE (futuro: derivada da sessão do usuário no corte multiunidade real).
function _fsUnidade_() {
  // Parte 2: unidade vinda do request (global setado no doGet). Fallback p/ a
  // Script Property FS_UNIDADE (triggers/e-mails) e, por fim, reitoria-sel.
  if (typeof _FS_UNIDADE_REQ === 'string' && _FS_UNIDADE_REQ) return _FS_UNIDADE_REQ;
  return PropertiesService.getScriptProperties().getProperty('FS_UNIDADE') || 'reitoria-sel';
}

function _fsBase_() {
  return 'https://firestore.googleapis.com/v1/projects/'
    + PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID')
    + '/databases/(default)/documents/unidades/' + _fsUnidade_();
}

// Lista os ids das unidades ATIVAS (doc unidades/{id} com ativo != false).
// Usado pelo orquestrador de avisos por e-mail (triggers de tempo), que precisa
// percorrer todas as unidades — diferente de _fsBase_, que é escopado a uma só.
function _fsListarUnidadesAtivas_() {
  try {
    var rootBase = 'https://firestore.googleapis.com/v1/projects/'
      + PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID')
      + '/databases/(default)/documents';
    var res = _fsReq_('post', rootBase + ':runQuery', {
      structuredQuery: { from: [{ collectionId: 'unidades' }] }
    });
    var out = [];
    (res || []).forEach(function (row) {
      if (!row.document) return;
      var id = String(row.document.name || '').split('/').pop();
      if (!id) return;
      var o = _fsDocToObj_(row.document);
      if (o.ativo === false) return;          // pula unidades desativadas
      out.push(id);
    });
    return out;
  } catch (e) {
    return [];
  }
}

function _fsReq_(method, url, payload) {
  var opt = { method: method, headers: { Authorization: 'Bearer ' + _fsToken_() }, muteHttpExceptions: true, contentType: 'application/json' };
  if (payload) opt.payload = JSON.stringify(payload);
  var tentativas = 0;
  while (true) {
    var resp = UrlFetchApp.fetch(url, opt);
    var code = resp.getResponseCode();
    var txt = resp.getContentText();
    if (code < 300) return txt ? JSON.parse(txt) : {};
    if ((code === 429 || code === 503) && tentativas < 3) {
      tentativas++;
      Utilities.sleep(400 * tentativas);
      continue;
    }
    var err = new Error('Firestore HTTP ' + code + ': ' + txt);
    err.httpCode = code;
    throw err;
  }
}

function _fsToVal_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return (v % 1 === 0) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function _fsFromVal_(f) {
  if (!f) return null;
  if (f.nullValue !== undefined) return null;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return Number(f.doubleValue);
  if (f.timestampValue !== undefined) return f.timestampValue;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.mapValue !== undefined) { var o = {}, mf = f.mapValue.fields || {}; Object.keys(mf).forEach(function (k) { o[k] = _fsFromVal_(mf[k]); }); return o; }
  if (f.arrayValue !== undefined) return (f.arrayValue.values || []).map(_fsFromVal_);
  return null;
}
function _fsDocToObj_(doc) {
  var o = {}, fields = (doc && doc.fields) || {};
  Object.keys(fields).forEach(function (k) { o[k] = _fsFromVal_(fields[k]); });
  return o;
}
function _fsToFields_(obj) {
  var f = {}; Object.keys(obj).forEach(function (k) { f[k] = _fsToVal_(obj[k]); }); return f;
}

// Normaliza o nome do servidor para uma forma canônica (Title Case) antes de
// gravar nas cargas. Evita duplicatas de caixa ("BRUNO"/"Bruno", "AMANDA"/
// "Amanda") que fragilizam qualquer agrupamento por nome. Mesma regra já usada
// em _fsTransicaoFase_ e na Capacidade. Preserva nomes compostos.
function _fsNomeServ_(n) {
  var s = String(n == null ? '' : n).trim();
  if (!s) return s;
  return s.toLowerCase().replace(/(^|[\s'\-])([a-zà-ÿ])/g, function (m, sep, ch) {
    return sep + ch.toUpperCase();
  });
}

function _fs_() {
  var base = _fsBase_();
  return {
    getDocument: function (path) {
      try { var d = _fsReq_('get', base + '/' + path); return { obj: _fsDocToObj_(d), path: d.name }; }
      catch (e) {
        if (e && e.httpCode === 404) return { obj: null, path: null }; // 404 = não existe
        throw e; // 429/403/5xx: propaga em vez de virar "não encontrado"
      }
    },
    updateDocument: function (path, fields, merge) {
      var url = base + '/' + path;
      if (merge) {
        var qs = Object.keys(fields).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); });
        if (qs.length) url += '?' + qs.join('&');
      }
      return _fsReq_('patch', url, { fields: _fsToFields_(fields) });
    },
    createDocument: function (col, fields) { return _fsReq_('post', base + '/' + col, { fields: _fsToFields_(fields) }); },
    deleteDocument: function (path) { return _fsReq_('delete', base + '/' + path); },
    query: function (col) {
      var filters = [];
      var q = {
        Where: function (field, op, value) { filters.push({ field: field, value: value }); return q; },
        Execute: function () {
          var sq = { from: [{ collectionId: col }] };
          if (filters.length === 1) {
            sq.where = { fieldFilter: { field: { fieldPath: filters[0].field }, op: 'EQUAL', value: _fsToVal_(filters[0].value) } };
          } else if (filters.length > 1) {
            sq.where = { compositeFilter: { op: 'AND', filters: filters.map(function (fl) { return { fieldFilter: { field: { fieldPath: fl.field }, op: 'EQUAL', value: _fsToVal_(fl.value) } }; }) } };
          }
          var res = _fsReq_('post', base + ':runQuery', { structuredQuery: sq });
          var out = [];
          (res || []).forEach(function (row) { if (row.document) out.push({ obj: _fsDocToObj_(row.document), path: row.document.name }); });
          return out;
        }
      };
      return q;
    }
  };
}

// ── Helpers de baixo nível ────────────────────────────────────────────────
function _fsUpdate_(path, fields) { return _fs_().updateDocument(path, fields, true); }   // merge
function _fsSet_(path, fields)    { return _fs_().updateDocument(path, fields); }          // sobrescreve
function _fsCreate_(colecao, fields) { return _fs_().createDocument(colecao, fields); }    // id automático
function _fsDelete_(path)         { return _fs_().deleteDocument(path); }
// Nao engole o erro: 404 vem como obj=null (getDocument); 429/403/5xx propagam.
function _fsGet_(path)            { return _fs_().getDocument(path).obj || null; }

function _fsQueryEq_(colecao, campo, valor) {
  var pref = 'unidades/' + _fsUnidade_() + '/';
  return _fs_().query(colecao).Where(campo, '==', valor).Execute().map(function(d){
    var rel = d.path.split('/documents/')[1];          // unidades/<u>/<col>/<id>
    if (rel.indexOf(pref) === 0) rel = rel.slice(pref.length);  // <col>/<id> (relativo à unidade)
    return { path: rel, obj: d.obj || {} };
  });
}

function _fsEtapasDoProc_(pid) {
  var lista = _fsQueryEq_('etapas', 'processoId', pid);
  lista.sort(function(a, b){ return Number(a.obj.ordem || 0) - Number(b.obj.ordem || 0); });
  return lista;
}

function _fsAppendHist_(o) {
  _fsCreate_('historico', {
    timestamp: o.ts || new Date(),
    processoId: String(o.pid || ''),
    etapa: String(o.etapa || ''),
    servidor: String(o.servidor || '—'),
    motivo: String(o.motivo || ''),
    diasAtraso: Number(o.dias || 0),
    dataRealizacao: o.dataRealiz ? new Date(o.dataRealiz) : null
  });
}

// Sincroniza o "ativo" das cargas do processo conforme a fase.
// faseToken: 'interna' | 'externa'. ativo: boolean.
function _fsSetCargaAtivo_(pid, faseToken, ativo) {
  var querExt = String(faseToken || '').toLowerCase().indexOf('ext') >= 0;
  _fsQueryEq_('cargas', 'processoId', pid).forEach(function(c){
    var ehExt = String(c.obj.fase || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').indexOf('ext') >= 0;
    if (ehExt === querExt) _fsUpdate_(c.path, { ativo: !!ativo });
  });
}

// ════════════════════════════════════════════════════════════════════════
// ESCRITAS (fs_*) — frontend passa `docEtapa` (ex.: "SEL-2026-001_05") e `pid`.
// ════════════════════════════════════════════════════════════════════════

// Gera id (slug) da unidade a partir do nome.
function _slugUnidade_(s) {
  s = String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Senha temporária legível (sem caracteres ambíguos).
function _gerarSenhaTemp_() {
  var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var s = '';
  for (var i = 0; i < 7; i++) s += c.charAt(Math.floor(Math.random() * c.length));
  return s;
}

// Autocadastro de unidade (aberto, guardado por e-mail institucional). Cria o doc
// e semeia calendario + config a partir da reitoria-sel.
function fs_criarUnidade(params) {
  return _withAppLockResult_('criar unidade (fs)', function() {
    try {
      params = params || {};
      // Autocadastro ABERTO (sem login): a tela de login expõe "Cadastre aqui"
      // para unidades que ainda não existem — quem cadastra ainda NÃO tem sessão,
      // então exigir admin aqui derrubava o fluxo com "Sessão expirada". O acesso
      // fica guardado pelo e-mail institucional (@...g12.br) + a trava
      // anti-sobrescrita abaixo (só cria se a unidade não existir ainda).
      var nome = String(params.nome || '').trim();
      var sigla = String(params.sigla || '').trim();
      var email = String(params.email || '').trim().toLowerCase();
      if (nome.length < 3) throw new Error('Informe o nome da unidade.');
      if (!/@.*g12\.br$/.test(email)) throw new Error('Use um e-mail institucional (@...g12.br).');
      var uid = _slugUnidade_(nome);
      if (!uid) throw new Error('Nome inválido.');
      var proj = PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID');
      var projBase = 'https://firestore.googleapis.com/v1/projects/' + proj + '/databases/(default)/documents';
      // 404 = não existe ainda (ok criar). Qualquer outro erro (rede/permissão/
      // 5xx) propaga — sem isso, uma falha transitória na checagem fazia o
      // código assumir "não existe" e sobrescrever (patch sem updateMask) uma
      // unidade que já existia, perdendo os campos que não estão no payload.
      var ex; try { ex = _fsReq_('get', projBase + '/unidades/' + uid); } catch (e) { if (e && e.httpCode === 404) ex = null; else throw e; }
      if (ex && ex.name) throw new Error('Já existe uma unidade com esse nome.');
      _fsReq_('patch', projBase + '/unidades/' + uid, { fields: _fsToFields_({ nome: nome, sigla: sigla, emailInstitucional: email, ativo: true }) });
      ['calendario', 'config'].forEach(function(col) {
        var data; try { data = _fsReq_('get', projBase + '/unidades/reitoria-sel/' + col + '?pageSize=300'); } catch (e) { data = {}; }
        (data.documents || []).forEach(function(d) {
          var docId = String(d.name || '').split('/').pop();
          if (docId) _fsReq_('patch', projBase + '/unidades/' + uid + '/' + col + '/' + docId, { fields: d.fields || {} });
        });
      });

      // Cria o 1º chefe da unidade (auth por unidade — parte 3) com senha temporária.
      var login = _authNorm_(email.split('@')[0]) || _authNorm_(sigla) || ('gestor-' + uid);
      var nomeResp = String(params.responsavel || '').trim() || ('Gestor(a) ' + (sigla || nome));
      var senhaTemp = _gerarSenhaTemp_();
      var salt = _authSalt_();
      var props = PropertiesService.getScriptProperties();
      var servidores = [{ nome: nomeResp, matricula: login, cor: '#2563eb', isChefe: true }];
      var users = {}; users[login] = { nome: nomeResp, matricula: login, salt: salt,
        hash: _authHash_(senhaTemp, salt), isChefe: true, mustChange: true };
      props.setProperty('SEL_SERVIDORES_JSON__' + uid, JSON.stringify(servidores));
      props.setProperty('SEL_AUTH_USERS_JSON__' + uid, JSON.stringify(users));
      props.setProperty('email__' + uid + '__' + nomeResp, email);

      // Envia login + senha temporária por e-mail (best-effort, não bloqueia).
      var appUrl = 'https://decofcp2-afk.github.io/app_gestao-reitoria/';
      try {
        MailApp.sendEmail({
          to: email,
          subject: 'Acesso ao Sistema de Gestão de Etapas — ' + nome,
          htmlBody:
            '<p>Olá! A unidade <b>' + nome + '</b> foi cadastrada no Sistema de Gestão de Etapas (Licitações) do Colégio Pedro II.</p>' +
            '<p><b>Acesse:</b> <a href="' + appUrl + '">' + appUrl + '</a><br>' +
            'Na tela de login, selecione a unidade <b>' + nome + '</b> e use:</p>' +
            '<p style="font-size:16px"><b>Login:</b> ' + login + '<br><b>Senha temporária:</b> ' + senhaTemp + '</p>' +
            '<p>No <b>primeiro acesso</b> você será guiado por um tour com as <b>configurações iniciais</b> ' +
            '(cadastrar a equipe, e-mails e conferir o calendário). Troque a senha temporária quando solicitado.</p>' +
            '<p style="color:#888;font-size:12px">Mensagem automática — não responda.</p>'
        });
      } catch(eMail) { /* cota/erro de e-mail não bloqueia a criação */ }

      return { ok: true, id: uid, login: login };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── Dados cadastrais da unidade (endereço + e-mail institucional) ──────────
// Lidos/exibidos no rodapé do Painel público. Edição só por chefe/admin.
function fs_getDadosUnidade(params) {
  try {
    params = params || {};
    _authRequire_(params.authToken, false);
    var uid = _fsUnidade_();
    var proj = PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID');
    var projBase = 'https://firestore.googleapis.com/v1/projects/' + proj + '/databases/(default)/documents';
    var doc;
    try { doc = _fsReq_('get', projBase + '/unidades/' + uid); }
    catch (e) { if (e && e.httpCode === 404) doc = null; else throw e; }
    var o = (doc && doc.fields) ? _fsDocToObj_(doc) : {};
    return { ok: true, id: uid, nome: o.nome || '', sigla: o.sigla || '',
      emailInstitucional: o.emailInstitucional || '', endereco: o.endereco || '' };
  } catch (e) { return { ok: false, erro: e.message }; }
}

function fs_salvarDadosUnidade(params) {
  return _withAppLockResult_('salvar dados da unidade (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true); // só chefe/admin
      var uid = _fsUnidade_();
      var endereco = String(params.endereco || '').trim();
      var email = String(params.emailInstitucional || '').trim();
      if (email && email.indexOf('@') < 0) throw new Error('E-mail institucional inválido.');
      var proj = PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID');
      var projBase = 'https://firestore.googleapis.com/v1/projects/' + proj + '/databases/(default)/documents';
      // updateMask preserva os demais campos do doc (nome, sigla, ativo…).
      var url = projBase + '/unidades/' + uid
        + '?updateMask.fieldPaths=endereco&updateMask.fieldPaths=emailInstitucional';
      _fsReq_('patch', url, { fields: _fsToFields_({ endereco: endereco, emailInstitucional: email }) });
      return { ok: true, endereco: endereco, emailInstitucional: email };
    } catch (e) { return { ok: false, erro: e.message }; }
  });
}

// Exclui uma unidade inteira (doc + subcoleções). DESTRUTIVO. Recusa reitoria-sel.
function fs_excluirUnidade(params) {
  return _withAppLockResult_('excluir unidade (fs)', function() {
    try {
      params = params || {};
      var sess = _authRequire_(params.authToken, true);
      if (!sess.isAdmin) throw new Error('Ação restrita ao administrador geral.'); // só admin global exclui unidades
      var uid = String(params.unidade || '').trim();
      if (!uid) throw new Error('Unidade não informada.');
      if (uid === 'reitoria-sel') throw new Error('A Reitoria não pode ser excluída.');
      var proj = PropertiesService.getScriptProperties().getProperty('FS_PROJECT_ID');
      var projBase = 'https://firestore.googleapis.com/v1/projects/' + proj + '/databases/(default)/documents';
      var cols = ['processos','etapas','cargas','calendario','config','emails','historico','dispositivos','resumo'];
      var apagados = 0;
      cols.forEach(function(col) {
        // Pagina até esgotar (nextPageToken): sem isso, uma unidade com mais de
        // 300 docs numa coleção que cresce sem limite (etapas/historico) ficava
        // com "sobras" órfãs após uma exclusão reportada como bem-sucedida.
        var pageToken = '';
        do {
          var url = projBase + '/unidades/' + uid + '/' + col + '?pageSize=300' +
            (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
          var data; try { data = _fsReq_('get', url); } catch(e) { data = {}; }
          (data.documents || []).forEach(function(d) {
            var docId = String(d.name || '').split('/').pop();
            if (docId) { _fsReq_('delete', projBase + '/unidades/' + uid + '/' + col + '/' + docId); apagados++; }
          });
          pageToken = data.nextPageToken || '';
        } while (pageToken);
      });
      _fsReq_('delete', projBase + '/unidades/' + uid);
      return { ok: true, apagados: apagados };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_atualizarStatusEtapa(docEtapa, novoStatus, authToken) {
  return _withAppLockResult_('atualizar status de etapa (fs)', function() {
    try {
      _authRequire_(authToken, false);
      if (!docEtapa) throw new Error('Etapa nao informada.');
      var obj = _fsGet_('etapas/' + docEtapa) || {};
      _fsUpdate_('etapas/' + docEtapa, { status: _statusPlanilha_(novoStatus) });
      var stNorm = _normStatus_(novoStatus);
      if (obj.processoId && obj.fase && ['andamento','aguardando','paralisado','atrasado','pendente'].indexOf(stNorm) >= 0) {
        _fsSetCargaAtivo_(obj.processoId, obj.fase, true);
      }
      return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_concluirEtapa(params) {
  return _withAppLockResult_('concluir etapa (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, false);
      var docEtapa = String(params.docEtapa || '').trim();
      if (!docEtapa) throw new Error('Etapa nao informada.');
      if (!params.dataRealizacao) return { ok: false, erro: 'Informe a data de conclusão da etapa antes de concluir.' };
      var dataObj = new Date(params.dataRealizacao + 'T12:00:00');
      if (isNaN(dataObj.getTime())) return { ok: false, erro: 'Data de conclusão inválida.' };

      var et = _fsGet_('etapas/' + docEtapa) || {};
      var pid = String(params.processoId || et.processoId || '').trim();
      var proc = pid ? _fsGet_('processos/' + pid) : null;
      var d0 = proc && proc.d0 ? new Date(proc.d0) : null;
      if (d0 && dataObj < d0) {
        return { ok: false, erro: 'A data de conclusão é anterior à abertura do processo. Verifique a data informada.' };
      }

      _fsUpdate_('etapas/' + docEtapa, {
        status: 'Concluída',
        dataRealizacao: dataObj,
        motivoAtraso: params.motivo ? String(params.motivo).trim() : (et.motivoAtraso || '')
      });
      _fsAppendHist_({ pid: pid, etapa: params.nomeEtapa || et.etapa, servidor: params.servidor,
        motivo: params.motivo || '', dias: params.diasAtraso || 0, dataRealiz: params.dataRealizacao });

      // Transição de fase: se toda a fase interna concluiu e há fase externa,
      // inativa carga interna e ativa a externa.
      var transicao = _fsTransicaoFase_(pid, docEtapa);
      return { ok: true, transicaoFase: transicao.feita, servidorExt: transicao.servidorExt };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function _fsTransicaoFase_(pid, docEtapaConcluida) {
  if (!pid) return { feita: false, servidorExt: '' };
  var etapas = _fsEtapasDoProc_(pid);
  var hasInt = false, allIntOk = true, hasExt = false;
  etapas.forEach(function(e){
    var o = e.obj;
    if (_isEtapaContratual_(o.fase, o.etapa)) return;
    var ext = String(o.fase || '').toLowerCase().indexOf('ext') >= 0;
    var st = _normStatus_(o.status);
    var ehAtual = (e.path === 'etapas/' + docEtapaConcluida);
    if (ext) { hasExt = true; }
    else { hasInt = true; if (!ehAtual && st !== 'ok' && st !== 'na') allIntOk = false; }
  });
  if (!hasInt || !allIntOk || !hasExt) return { feita: false, servidorExt: '' };
  var servidorExt = '';
  _fsQueryEq_('cargas', 'processoId', pid).forEach(function(c){
    var ext = String(c.obj.fase || '').toLowerCase().indexOf('ext') >= 0;
    if (ext) { servidorExt = String(c.obj.servidor || ''); _fsUpdate_(c.path, { ativo: true }); }
    else _fsUpdate_(c.path, { ativo: false });
  });
  if (servidorExt) servidorExt = _fsNomeServ_(servidorExt);
  return { feita: true, servidorExt: servidorExt };
}

function fs_regredirEtapa(params) {
  return _withAppLockResult_('regredir etapa (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, false);
      var pid = String(params.processoId || '').trim();
      var docAtual = String(params.docEtapa || '').trim();
      var motivo = String(params.motivo || '').trim();
      var servidor = String(params.servidor || '').trim() || '—';
      if (!pid) throw new Error('Processo não informado.');
      if (!docAtual) throw new Error('Etapa atual não informada.');
      if (motivo.length < 8) throw new Error('Informe uma justificativa para a regressão.');

      var etapas = _fsEtapasDoProc_(pid);
      var idxAtual = -1;
      for (var i = 0; i < etapas.length; i++) if (etapas[i].path === 'etapas/' + docAtual) { idxAtual = i; break; }
      if (idxAtual < 0) throw new Error('A etapa atual não pertence ao processo informado.');
      var nomeAtual = String(etapas[idxAtual].obj.etapa || params.etapaAtual || '').trim();

      var idxAnterior = -1;
      for (var k = idxAtual - 1; k >= 0; k--) {
        var o = etapas[k].obj;
        if (_isEtapaContratual_(o.fase, o.etapa)) continue;
        if (_normStatus_(o.status) === 'na') continue;
        idxAnterior = k; break;
      }
      if (idxAnterior < 0) throw new Error('Não há etapa anterior aplicável para reabrir.');
      var nomeAnterior = String(etapas[idxAnterior].obj.etapa || '').trim();

      _fsUpdate_(etapas[idxAnterior].path, { status: 'Em andamento', dataRealizacao: null, motivoAtraso: '' });
      if (idxAtual !== idxAnterior) {
        _fsUpdate_(etapas[idxAtual].path, { status: 'Não iniciada', dataRealizacao: null, motivoAtraso: '' });
      }
      _fsAppendHist_({ pid: pid, etapa: nomeAnterior, servidor: servidor,
        motivo: 'REGRESSAO: ' + motivo + (nomeAtual ? ' | etapa atual: ' + nomeAtual : '') });
      return { ok: true, etapaReaberta: nomeAnterior, etapaAtual: nomeAtual };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_devolverProcessoFilaApp(params) {
  return _withAppLockResult_('devolver processo para fila (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || params.pid || '').trim();
      var motivo = String(params.motivo || '').trim();
      var servidor = String(params.servidor || '').trim() || '—';
      if (!pid) throw new Error('Processo não informado.');
      if (motivo.length < 8) throw new Error('Informe o motivo do retorno para a fila.');
      if (!_fsGet_('processos/' + pid)) throw new Error('Processo não encontrado.');

      var etapas = _fsEtapasDoProc_(pid);
      var alvo = null, primeiraPend = null, retornada = null, concluidas = 0;
      etapas.forEach(function(e){
        var o = e.obj;
        if (!o.etapa || _isEtapaContratual_(o.fase, o.etapa)) return;
        var st = _normStatus_(o.status);
        if (st === 'na') return;
        if (st === 'ok') { concluidas++; return; }
        if ((st === 'retornado' || _isRetornoFilaMotivo_(o.motivoAtraso)) && !retornada) retornada = e;
        if (st === 'pendente' && !primeiraPend) primeiraPend = e;
        if (!alvo && ['andamento','aguardando','paralisado','atrasado','retornado'].indexOf(st) >= 0) alvo = e;
      });
      alvo = alvo || retornada || primeiraPend;
      if (!alvo) throw new Error('Não encontrei etapa aplicável para marcar o retorno à fila.');

      var nomeAlvo = String(alvo.obj.etapa || '').trim();
      var statusPreservado = _normStatus_(alvo.obj.status);
      var motivoAnterior = String(alvo.obj.motivoAtraso || '').trim();
      var motivoMarcado = 'RETORNO PARA FILA: ' + motivo;
      if (motivoAnterior && !_isRetornoFilaMotivo_(motivoAnterior)) motivoMarcado += '\nMOTIVO ANTERIOR: ' + motivoAnterior;
      _fsUpdate_(alvo.path, { motivoAtraso: motivoMarcado });

      _fsSetCargaAtivo_(pid, 'interna', false);
      _fsSetCargaAtivo_(pid, 'externa', false);
      _fsAppendHist_({ pid: pid, etapa: nomeAlvo, servidor: servidor, motivo: 'RETORNO PARA FILA: ' + motivo });
      return { ok: true, etapa: nomeAlvo, statusPreservado: statusPreservado, concluidasPreservadas: concluidas };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_iniciarProcessos(params, authToken) {
  return _withAppLockResult_('iniciar processos (fs)', function() {
    try {
      _authRequire_(authToken || (params && params.authToken), true);
      var iniciados = 0;
      (params || []).forEach(function(item){
        var pid = String(item.pid || '').trim();
        if (!pid) return;
        var proc = _fsGet_('processos/' + pid) || {};
        var modalidade = proc.modalidade || item.modal || '';
        var extSeg = _isModalidadeExtSegregada_(modalidade);
        if (extSeg && item.servidor && item.servidorExt && item.servidor === item.servidorExt) {
          throw new Error('Fase interna e fase externa precisam ter responsáveis diferentes em Pregão/Concorrência.');
        }
        var upd = { status: 'Em andamento' };
        if (item.d0) upd.d0 = new Date(item.d0 + 'T12:00:00');
        _fsUpdate_('processos/' + pid, upd);

        var etapas = _fsEtapasDoProc_(pid);
        var primeira = null;
        etapas.forEach(function(e){
          var o = e.obj;
          var ext = String(o.fase || '').toLowerCase().indexOf('ext') >= 0;
          var agente = ext ? (extSeg ? (item.servidorExt || '') : (item.servidorExt || item.servidor || '')) : (item.servidor || '');
          _fsUpdate_(e.path, { agente: agente });
          if (!primeira && !_isEtapaContratual_(o.fase, o.etapa)) {
            var st = _normStatus_(o.status);
            if (st !== 'ok' && st !== 'na') primeira = e;
          }
        });
        if (primeira) _fsUpdate_(primeira.path, { status: 'Em andamento', motivoAtraso: '', dataRealizacao: null });
        _fsSetCargaAtivo_(pid, 'interna', true);
        _fsSetCargaAtivo_(pid, 'externa', false);
        iniciados++;
      });
      return { ok: true, iniciados: iniciados };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── Processo: campos cadastrais e fila ────────────────────────────────────
function fs_salvarEmailProcesso(pid, email, authToken) {
  return _withAppLockResult_('salvar email do requisitante (fs)', function() {
    try {
      _authRequire_(authToken, false);
      pid = String(pid || '').trim();
      if (!_fsGet_('processos/' + pid)) throw new Error('Processo ' + pid + ' não encontrado.');
      _fsUpdate_('processos/' + pid, { emailRequisitante: String(email || '').trim() });
      return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_salvarLinkSuapProcessoApp(params) {
  return _withAppLockResult_('salvar link SUAP (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, false);
      var pid = String(params.processoId || '').trim();
      var link = String(params.linkSuap || '').trim();
      if (!pid) throw new Error('Processo não informado.');
      if (!/^https?:\/\/\S+$/i.test(link)) throw new Error('Informe uma URL completa do SUAP (http:// ou https://).');
      if (link.length > 500) throw new Error('Link SUAP muito longo.');
      if (!_fsGet_('processos/' + pid)) throw new Error('Processo ' + pid + ' não encontrado.');
      _fsUpdate_('processos/' + pid, { linkSuap: link });
      return { ok: true, linkSuap: link };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// Edição de processo na fila exige que ele NÃO esteja em andamento.
// Regra simplificada e segura: permite se não tem D0 (está na fila) ou se há
// alguma etapa marcada como retorno para fila.
function _fsPodeEditarFila_(pid) {
  var proc = _fsGet_('processos/' + pid);
  if (!proc) return false;
  if (!proc.d0) return true;
  var retorno = _fsEtapasDoProc_(pid).some(function(e){
    return _normStatus_(e.obj.status) === 'retornado' || _isRetornoFilaMotivo_(e.obj.motivoAtraso);
  });
  return retorno;
}

function fs_salvarNomeProcessoFilaApp(params) {
  return _withAppLockResult_('editar nome na fila (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || '').trim();
      var nome = String(params.nome || '').trim();
      if (!pid) throw new Error('Processo não informado.');
      if (nome.length < 4) throw new Error('Informe um nome mais completo.');
      if (nome.length > 200) nome = nome.substring(0, 200).trim();
      if (!_fsPodeEditarFila_(pid)) throw new Error('O nome só pode ser editado pela Fila.');
      _fsUpdate_('processos/' + pid, { objeto: nome });
      return { ok: true, nome: nome };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_editarProcessoFilaApp(params) {
  return _withAppLockResult_('editar processo na fila (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || '').trim();
      if (!pid) throw new Error('Processo não informado.');
      var objeto = String(params.objeto || '').trim();
      if (objeto.length < 4) throw new Error('Informe um objeto/nome mais completo.');
      if (objeto.length > 200) objeto = objeto.substring(0, 200).trim();
      if (!_fsPodeEditarFila_(pid)) throw new Error('Só é possível editar pela Fila processos que ainda não começaram ou que retornaram.');

      var upd = { objeto: objeto };
      if (params.modalidade !== undefined) upd.modalidade = String(params.modalidade || '').trim();
      if (params.d0 !== undefined) upd.d0 = String(params.d0 || '').trim() ? new Date(params.d0 + 'T12:00:00') : null;
      if (params.temIRP !== undefined) upd.temIrp = (params.temIRP === 'Sim');
      if (params.setor !== undefined) upd.setorRequisitante = String(params.setor || '').trim();
      if (params.emailReq !== undefined) upd.emailRequisitante = String(params.emailReq || '').trim();
      if (params.nroSuap !== undefined) upd.suap = String(params.nroSuap || '').trim();
      if (params.linkSuap !== undefined) upd.linkSuap = String(params.linkSuap || '').trim() || '#';
      _fsUpdate_('processos/' + pid, upd);
      return { ok: true, nome: objeto };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_excluirProcessoApp(params) {
  return _withAppLockResult_('excluir processo (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.processoId || '').trim();
      if (!pid) throw new Error('Processo não informado.');
      var proc = _fsGet_('processos/' + pid);
      if (!proc) throw new Error('Processo ' + pid + ' não encontrado.');
      var objeto = String(proc.objeto || '').trim();
      _fsEtapasDoProc_(pid).forEach(function(e){ _fsDelete_(e.path); });
      _fsQueryEq_('cargas', 'processoId', pid).forEach(function(c){ _fsDelete_(c.path); });
      _fsDelete_('processos/' + pid);
      return { ok: true, pid: pid, objeto: objeto };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_salvarOrdemFilaApp(params) {
  return _withAppLockResult_('salvar ordem da fila (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var ordem = params.ordem;
      if (!ordem || !ordem.length || Object.prototype.toString.call(ordem) !== '[object Array]') {
        throw new Error('Ordem da fila não informada.');
      }
      var gravados = 0;
      ordem.forEach(function(pid, idx){
        pid = String(pid || '').trim();
        if (!pid) return;
        _fsUpdate_('processos/' + pid, { ordemFila: idx + 1 });
        gravados++;
      });
      return { ok: true, gravados: gravados, total: ordem.length };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ── Cadastro de processo (template explícito de 9 etapas) ─────────────────
// O template espelha o bloco pré-formatado da planilha (Portaria 638/2026).
var FS_ETAPAS_TEMPLATE = [
  { nome: 'Designação da equipe', fase: 'Interna', prazo: 5 },
  { nome: 'ETP + Mapa de Riscos + Pesquisa de Preços', fase: 'Interna', prazo: 45 },
  { nome: 'Minuta do Termo de Referência', fase: 'Interna', prazo: 10 },
  { nome: 'IRP — Intenção de Registro de Preços', fase: 'Interna', prazo: 15 },
  { nome: 'Adequações finais dos documentos e envio à Procuradoria', fase: 'Interna', prazo: 10 },
  { nome: 'Versão final do TR e demais documentos aprovados', fase: 'Interna', prazo: 10 },
  { nome: 'Envio ao SEL/SEPMA (Recebimento de processo, cadastro e publicação da licitação)', fase: 'Interna', prazo: 3 },
  { nome: 'Fase externa — Pregão Eletrônico', fase: 'Externa', prazo: 90 },
  { nome: 'Assinatura contrato / Ata (ARP)', fase: 'Contratual', prazo: 20 }
];

function fs_cadastrarProcesso(params) {
  return _withAppLockResult_('cadastrar processo (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var modalidade = String(params.modalidade || '').trim();
      var ehPE = _isModalidadeExtSegregada_(modalidade);
      if (ehPE && params.respInterno && params.respExterno && params.respInterno === params.respExterno) {
        throw new Error('Fase interna e fase externa precisam ter responsáveis diferentes em Pregão/Concorrência.');
      }
      var objeto = String(params.objeto || '').trim();
      if (objeto.length < 4) throw new Error('Informe um objeto/nome mais completo.');

      // Próximo ProcessoID: SEL-AAAA-NNN
      var ano = new Date().getFullYear();
      var prefixo = 'SEL-' + ano + '-';
      var maxSeq = 0;
      _fs_().query('processos').Execute().forEach(function(d){
        var id = String((d.obj || {}).id || '');
        if (id.indexOf(prefixo) === 0) { var s = parseInt(id.substring(prefixo.length), 10) || 0; if (s > maxSeq) maxSeq = s; }
      });
      var novoPID = prefixo + String(maxSeq + 1).padStart(3, '0');

      var d0 = String(params.d0 || '').trim() ? new Date(params.d0 + 'T12:00:00') : null;
      _fsSet_('processos/' + novoPID, {
        id: novoPID,
        suap: String(params.nroSuap || '').trim(),
        objeto: objeto,
        modalidade: modalidade,
        d0: d0,
        linkSuap: String(params.linkSuap || '#').trim(),
        temIrp: (params.temIRP === 'Sim'),
        status: d0 ? 'Em andamento' : 'Em planejamento',
        setorRequisitante: String(params.setor || '').trim(),
        emailRequisitante: String(params.emailReq || '').trim(),
        ordemFila: null
      });

      var fasePrazoExt = modalidade === 'Concorrência' ? 100 : (modalidade === 'Pregão Eletrônico' ? 90 : 30);
      FS_ETAPAS_TEMPLATE.forEach(function(t, i){
        var ordem = i + 1;
        var ext = t.fase === 'Externa';
        var nome = ext ? ('Fase externa — ' + (modalidade || 'Pregão Eletrônico')) : t.nome;
        var prazo = ext ? fasePrazoExt : t.prazo;
        var status = 'Não iniciada';
        if (ordem === 4 && params.temIRP !== 'Sim') status = 'Não se aplica'; // IRP sem SRP
        if (ordem === 9) status = 'Não se aplica';                            // contratual (fora do SEL)
        var agente = ext ? (ehPE ? (params.respExterno || '') : (params.respExterno || params.respInterno || '')) : (params.respInterno || '');
        _fsSet_('etapas/' + novoPID + '_' + String(ordem).padStart(2, '0'), {
          processoId: novoPID, ordem: ordem, etapa: nome, fase: t.fase,
          agente: agente, prazoDias: prazo, status: status,
          motivoAtraso: '', dataRealizacao: null
        });
      });

      // Cargas iniciais (pontuação posterior) — inativas até iniciar.
      _fsSet_('cargas/' + novoPID + '_int_01', {
        servidor: _fsNomeServ_(params.respInterno || ''), objeto: objeto, processoId: novoPID,
        ativo: false, modalidade: modalidade, fase: 'Fase Interna', p1: 0, p2: 0, p3: 0, total: 0
      });
      _fsSet_('cargas/' + novoPID + '_ext_01', {
        servidor: _fsNomeServ_(ehPE ? (params.respExterno || '') : (params.respExterno || params.respInterno || '')),
        objeto: objeto, processoId: novoPID,
        ativo: false, modalidade: modalidade, fase: 'Fase Externa', p1: 0, p2: 0, p3: 0, total: 0
      });

      return { ok: true, pid: novoPID };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

function fs_atribuirResponsaveisApp(params) {
  return _withAppLockResult_('atribuir responsáveis (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var pid = String(params.pid || '').trim();
      var servInt = _fsNomeServ_(params.servInt || '');
      var servExt = _fsNomeServ_(params.servExt || '');
      var mNorm = String(params.modal || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');
      var ehPE = mNorm.indexOf('pregao') >= 0 || mNorm.indexOf('concorr') >= 0;
      var avisos = [];
      if (ehPE && servInt && servExt && servInt === servExt) {
        throw new Error('Fase interna e fase externa precisam ter responsáveis diferentes em Pregão/Concorrência.');
      }

      // 1) cargas: define servidor por fase. Se o processo NÃO tiver carga
      // (ex.: criado por importação/seed que não semeou cargas), CRIA aqui —
      // senão o processo nunca apareceria na aba Capacidade (que lê `cargas`).
      var proc = _fsGet_('processos/' + pid) || {};
      var objetoCarga = String(proc.objeto || '').trim();
      var modalidadeCarga = String(proc.modalidade || params.modal || '').trim();
      var servExtVal = ehPE ? servExt : (servExt || servInt || '');
      var cargas = _fsQueryEq_('cargas', 'processoId', pid);
      var foundInt = false, foundExt = false;
      cargas.forEach(function(c){
        var ext = String(c.obj.fase || '').toLowerCase().indexOf('ext') >= 0;
        if (ext) { foundExt = true; _fsUpdate_(c.path, { servidor: servExtVal }); }
        else { foundInt = true; _fsUpdate_(c.path, { servidor: servInt || '' }); }
      });
      if (!foundInt) {
        _fsSet_('cargas/' + pid + '_int_01', {
          servidor: servInt || '', objeto: objetoCarga, processoId: pid,
          ativo: false, modalidade: modalidadeCarga, fase: 'Fase Interna', p1: 0, p2: 0, p3: 0, total: 0
        });
      }
      if (!foundExt) {
        _fsSet_('cargas/' + pid + '_ext_01', {
          servidor: servExtVal, objeto: objetoCarga, processoId: pid,
          ativo: false, modalidade: modalidadeCarga, fase: 'Fase Externa', p1: 0, p2: 0, p3: 0, total: 0
        });
      }

      // 2) etapas: Agente Responsável por fase + ativa a fase corrente
      var etapas = _fsEtapasDoProc_(pid);
      var faseAtual = '';
      etapas.forEach(function(e){
        var o = e.obj;
        var ext = String(o.fase || '').toLowerCase().indexOf('ext') >= 0;
        var st = _normStatus_(o.status);
        if (!faseAtual && st !== 'ok' && st !== 'na') faseAtual = ext ? 'externa' : 'interna';
        var novoAg = ext ? (ehPE ? (servExt || '') : (servExt || servInt || '')) : (servInt || '');
        _fsUpdate_(e.path, { agente: novoAg });
      });
      if (faseAtual) _fsSetCargaAtivo_(pid, faseAtual, true);

      return { ok: true, avisos: avisos };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// ════════════════════════════════════════════════════════════════════════
// MANUTENÇÃO (rodar manualmente no editor do Apps Script) — cria as cargas
// faltantes de TODOS os processos de uma unidade. Útil para unidades populadas
// por seed/importação que não semearam `cargas` (os processos não apareciam na
// aba Capacidade). É IDEMPOTENTE: nunca duplica uma carga já existente, então
// pode ser rodada quantas vezes quiser sem efeito colateral.
//
// COMO USAR: ajuste a constante UNIDADE_BACKFILL para o id (slug) da unidade
// e rode `backfillCargasUnidade` no botão ▷ Executar. O resultado sai em Logs.
// ════════════════════════════════════════════════════════════════════════
var UNIDADE_BACKFILL = 'sao-cristovao-i'; // id (slug) da unidade-alvo do backfill

function backfillCargasUnidade() {
  var r = _fsBackfillCargas_(UNIDADE_BACKFILL);
  Logger.log('── Backfill de cargas — unidade "' + UNIDADE_BACKFILL + '" ──');
  Logger.log('Processos verificados ...... ' + r.processos);
  Logger.log('Cargas internas criadas .... ' + r.intCriadas);
  Logger.log('Cargas externas criadas .... ' + r.extCriadas);
  Logger.log('Processos já completos ...... ' + r.jaOk);
  Logger.log('Pronto. Reabra a aba Capacidade para conferir.');
  return r;
}

function _fsBackfillCargas_(unidadeId) {
  unidadeId = String(unidadeId || '').trim();
  if (!unidadeId) throw new Error('Informe o id (slug) da unidade.');
  _FS_UNIDADE_REQ = unidadeId; // escopa os helpers _fs* para esta unidade
  try {
    var out = { processos: 0, intCriadas: 0, extCriadas: 0, jaOk: 0 };
    _fs_().query('processos').Execute().forEach(function(d){
      var proc = d.obj || {};
      var pid = String(proc.id || (d.path || '').split('/').pop() || '').trim();
      if (!pid) return;
      out.processos++;
      var modalidade = String(proc.modalidade || '').trim();
      var ehPE = _isModalidadeExtSegregada_(modalidade);
      var objeto = String(proc.objeto || '').trim();

      // Infere responsáveis e a fase corrente a partir das etapas (agente/status).
      var servInt = '', servExt = '', faseAtual = '';
      _fsEtapasDoProc_(pid).forEach(function(e){
        var o = e.obj;
        if (_isEtapaContratual_(o.fase, o.etapa)) return;
        var ext = String(o.fase || '').toLowerCase().indexOf('ext') >= 0;
        if (!ext && !servInt && o.agente) servInt = _fsNomeServ_(o.agente);
        if (ext && !servExt && o.agente) servExt = _fsNomeServ_(o.agente);
        var st = _normStatus_(o.status);
        if (!faseAtual && st !== 'ok' && st !== 'na') faseAtual = ext ? 'externa' : 'interna';
      });
      var servExtVal = ehPE ? servExt : (servExt || servInt || '');

      var hasInt = false, hasExt = false;
      _fsQueryEq_('cargas', 'processoId', pid).forEach(function(c){
        if (String(c.obj.fase || '').toLowerCase().indexOf('ext') >= 0) hasExt = true; else hasInt = true;
      });

      var fez = false;
      if (!hasInt) {
        _fsSet_('cargas/' + pid + '_int_01', {
          servidor: servInt || '', objeto: objeto, processoId: pid,
          ativo: (faseAtual === 'interna'), modalidade: modalidade, fase: 'Fase Interna', p1: 0, p2: 0, p3: 0, total: 0
        });
        out.intCriadas++; fez = true;
      }
      if (!hasExt) {
        _fsSet_('cargas/' + pid + '_ext_01', {
          servidor: servExtVal, objeto: objeto, processoId: pid,
          ativo: (faseAtual === 'externa'), modalidade: modalidade, fase: 'Fase Externa', p1: 0, p2: 0, p3: 0, total: 0
        });
        out.extCriadas++; fez = true;
      }
      if (!fez) out.jaOk++;
    });
    return out;
  } finally {
    _FS_UNIDADE_REQ = ''; // restaura o escopo padrão (reitoria-sel/FS_UNIDADE)
  }
}

// ════════════════════════════════════════════════════════════════════════
// MANUTENÇÃO — normaliza a caixa do nome do servidor nas cargas JÁ existentes
// ("BRUNO"→"Bruno", "AMANDA"→"Amanda"). Complementa a normalização na origem
// (_fsNomeServ_ nas escritas): esta limpa o histórico. É IDEMPOTENTE — só grava
// quando o valor muda, então pode rodar quantas vezes quiser.
//
// COMO USAR: rode `normalizarNomesCargasTodasUnidades` no botão ▷ Executar.
// O resultado (por unidade + total) sai em Logs.
// ════════════════════════════════════════════════════════════════════════
function normalizarNomesCargasTodasUnidades() {
  var unidades = _fsListarUnidadesAtivas_();
  var total = { unidades: 0, cargas: 0, corrigidas: 0 };
  unidades.forEach(function (uid) {
    var r = _fsNormalizarNomesCargas_(uid);
    Logger.log('Unidade "' + uid + '": ' + r.corrigidas + ' de ' + r.cargas + ' cargas normalizadas.');
    total.unidades++; total.cargas += r.cargas; total.corrigidas += r.corrigidas;
  });
  Logger.log('── Total: ' + total.corrigidas + ' carga(s) corrigida(s) em ' + total.unidades + ' unidade(s). ──');
  return total;
}

function _fsNormalizarNomesCargas_(unidadeId) {
  unidadeId = String(unidadeId || '').trim();
  if (!unidadeId) throw new Error('Informe o id (slug) da unidade.');
  _FS_UNIDADE_REQ = unidadeId; // escopa os helpers _fs* para esta unidade
  try {
    var pref = 'unidades/' + _fsUnidade_() + '/';
    var out = { cargas: 0, corrigidas: 0 };
    _fs_().query('cargas').Execute().forEach(function (d) {
      out.cargas++;
      var atual = String((d.obj && d.obj.servidor) || '');
      var norm = _fsNomeServ_(atual);
      if (norm && norm !== atual) {
        var rel = d.path.split('/documents/')[1];          // unidades/<u>/cargas/<id>
        if (rel.indexOf(pref) === 0) rel = rel.slice(pref.length);  // cargas/<id>
        _fsUpdate_(rel, { servidor: norm });
        out.corrigidas++;
      }
    });
    return out;
  } finally {
    _FS_UNIDADE_REQ = ''; // restaura o escopo padrão
  }
}

// Espelho de servidores/emails no Firestore (chamado dentro de
// salvarServidoresApp, no corte). Auth/senhas continuam nas Script Properties.
// limpa: [{nome,matricula,cor,isChefe}]; emailsMap: {nome: email}.
//
// IMPORTANTE: não é mais apenas aditivo. Além de gravar os servidores da lista
// atual, REMOVE das coleções `servidores`/`emails` os documentos cuja matrícula
// não está mais na lista. Sem essa poda, um servidor excluído na aba Config
// continuava existindo na coleção `servidores` do Firestore e reaparecia como
// "fantasma" na aba Capacidade (que lê essa coleção diretamente).
function fs_espelharServidores_(limpa, emailsMap) {
  var matriculas = [];
  (limpa || []).forEach(function(s){
    var mid = String(s.matricula || '').trim();
    if (!mid) return;
    matriculas.push(mid);
    _fsSet_('servidores/' + mid, { matricula: mid, nome: s.nome, cor: s.cor || '', chefe: !!s.isChefe });
    var email = (emailsMap || {})[s.nome] || '';
    _fsSet_('emails/' + mid, { matricula: mid, nome: s.nome, email: email });
  });
  _fsPodarServidoresOrfaos_(matriculas);
}

// Poda (best-effort) das coleções `servidores`/`emails` da unidade corrente os
// docs cuja matrícula NÃO está em `matriculasAtuais` — impede que um servidor
// excluído reapareça como fantasma na Capacidade (que lê `servidores` direto).
//
// SEGURANÇA: nunca poda quando a lista atual está vazia. Lista vazia em geral
// significa "não carregou" (e não "zero servidores"); podar nesse caso apagaria
// todos os servidores da unidade. Na dúvida, não apaga nada.
function _fsPodarServidoresOrfaos_(matriculasAtuais) {
  var atuais = {};
  (matriculasAtuais || []).forEach(function(m){
    var k = String(m || '').trim();
    if (k) atuais[k] = true;
  });
  if (!Object.keys(atuais).length) return; // trava de segurança
  ['servidores', 'emails'].forEach(function(col){
    var ids;
    try { ids = _fsIdsDaColecao_(col); } catch (e) { return; } // best-effort
    ids.forEach(function(id){
      if (!atuais[id]) {
        try { _fsDelete_(col + '/' + id); } catch (e) {}
      }
    });
  });
}

// Lista os ids (último segmento do path) de todos os docs de uma coleção da
// unidade corrente. Usado pela poda de servidores removidos.
function _fsIdsDaColecao_(col) {
  return _fs_().query(col).Execute().map(function(d){
    return String(d.path || '').split('/').pop();
  }).filter(function(id){ return !!id; });
}

// ════════════════════════════════════════════════════════════════════════
// FASE 4 — fonte de dados dos E-MAILS/avisos lendo do Firestore.
// Ativada por Propriedade do script FS_ATIVO='true' (par do firestoreAtivo do front).
// ════════════════════════════════════════════════════════════════════════
function _fsServerAtivo_() {
  try { return String(PropertiesService.getScriptProperties().getProperty('FS_ATIVO') || '').toLowerCase() === 'true'; }
  catch (e) { return false; }
}

// Switch único usado pelas rotinas de aviso (enviarAvisosPrazo, getAlertasApp).
function _dadosProcessosParaAvisos_(sess) {
  if (_fsServerAtivo_()) return _fsGetEtapasParaApp_(sess);
  return _getEtapasParaApp_(sess);
}

function _fsParseDate_(v) {
  if (!v) return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return new Date(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate());
  }
  var s = String(v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Port GS do construir() de appsel-firestore.js — devolve o MESMO shape de
// _getEtapasParaApp_, mas lendo processos/etapas/cargas do Firestore.
function _fsGetEtapasParaApp_(opts) {
  opts = opts || {};
  var isChefe = !!opts.isChefe;
  var fs = _fs_();
  function _toArr_(col) {
    return fs.query(col).Execute().map(function (d) { var o = d.obj || {}; o._id = d.path.split('/').pop(); return o; });
  }
  var procsRaw = _toArr_('processos');
  var etpsRaw = _toArr_('etapas');
  var cgsRaw = _toArr_('cargas');

  // servMap pid -> {int, ext, hasInt, hasExt}
  var servMap = {};
  cgsRaw.forEach(function (c) {
    var pid = String(c.processoId || '').trim();
    var serv = String(c.servidor || '').trim();
    if (!pid || !serv) return;
    var nomeNorm = _fsNomeServ_(serv);
    var ativo = (c.ativo === true);
    if (!servMap[pid]) servMap[pid] = { int: '', ext: '', hasInt: false, hasExt: false };
    if (String(c.fase || '').toLowerCase().indexOf('ext') >= 0) {
      servMap[pid].hasExt = true; if (!servMap[pid].ext || ativo) servMap[pid].ext = nomeNorm;
    } else {
      servMap[pid].hasInt = true; if (!servMap[pid].int || ativo) servMap[pid].int = nomeNorm;
    }
  });

  var etpPorProc = {};
  etpsRaw.forEach(function (e) {
    var pid = String(e.processoId || '').trim();
    var nome = String(e.etapa || '').trim();
    if (!pid || !nome) return;
    var fase = String(e.fase || '').trim();
    var status = _normStatus_(e.status);
    if (_isEtapaContratual_(fase, nome)) status = 'na';
    (etpPorProc[pid] = etpPorProc[pid] || []).push({
      docId: e._id, ordem: e.ordem, nome: nome, prazo: parseInt(e.prazoDias, 10) || 0,
      status: status, motivo: String(e.motivoAtraso || '').trim(),
      realiz: status === 'ok' ? _fsParseDate_(e.dataRealizacao) : null,
      agente: String(e.agente || '').trim(), fase: fase
    });
  });
  Object.keys(etpPorProc).forEach(function (pid) {
    etpPorProc[pid].sort(function (a, b) { return Number(a.ordem || 0) - Number(b.ordem || 0); });
  });

  var procs = [], filaPrevisao = [], ordemFilaMap = {}, ordemFilaDisponivel = false;
  procsRaw.forEach(function (p) {
    var pid = String(p.id || p._id || '').trim();
    if (!pid) return;
    if (p.ordemFila !== null && p.ordemFila !== undefined && p.ordemFila !== '') {
      var ov = parseFloat(p.ordemFila);
      if (!isNaN(ov)) { ordemFilaMap[pid] = ov; ordemFilaDisponivel = true; }
    }
    var base = {
      id: pid, num: String(p.suap || '').trim(), nome: String(p.objeto || '').trim(),
      modal: String(p.modalidade || '').trim(),
      temIRP: (p.temIrp === true || String(p.temIrp).trim().toLowerCase() === 'sim'),
      req: String(p.setorRequisitante || '').trim(), emailR: String(p.emailRequisitante || '').trim(),
      suap: String(p.linkSuap || '#').trim()
    };
    var d0 = _fsParseDate_(p.d0);
    if (!d0) { filaPrevisao.push(base); return; }
    base.d0 = d0; procs.push(base);
  });

  var resultado = procs.map(function (p) {
    var etapas = (etpPorProc[p.id] || []).filter(function (et) { return et.status !== 'na'; });
    var cursor = new Date(p.d0.getTime());
    var etapaAtualIdx = -1;
    var etCalc = etapas.map(function (et, idx) {
      var ini = new Date(cursor.getTime());
      var fimPrev = _addDU_(ini, et.prazo);
      var atraso = 0;
      if (et.realiz) { atraso = Math.max(0, _contDU_(fimPrev, et.realiz)); cursor = new Date(et.realiz.getTime()); }
      else if (et.status !== 'na') { cursor = new Date(fimPrev.getTime()); }
      if (etapaAtualIdx < 0 && et.status !== 'ok' && et.status !== 'na') etapaAtualIdx = idx;
      var retornoFilaEt = et.status === 'retornado' || _isRetornoFilaMotivo_(et.motivo);
      return {
        docId: et.docId, ordem: et.ordem, prazo: et.prazo, nome: et.nome, agente: et.agente,
        fase: et.fase, status: et.status, retornoFila: retornoFilaEt, motivo: et.motivo,
        dias: atraso, ini_iso: _toIso_(ini), fim_iso: _toIso_(fimPrev),
        realizacao_iso: et.realiz ? _toIso_(et.realiz) : null, historico: null
      };
    });
    var semNA = etCalc.filter(function (e) { return e.status !== 'na'; });
    var concl = semNA.filter(function (e) { return e.status === 'ok'; }).length;
    var execucao = semNA.length ? Math.round(concl / semNA.length * 100) : 0;
    var retornoFila = etCalc.some(function (e) { return e.retornoFila; });
    var st = 'planejamento';
    if (execucao === 100) st = 'ok';
    else if (etCalc.some(function (e) { return e.status === 'atrasado'; })) st = 'atrasado';
    else if (etCalc.some(function (e) { return e.status === 'aguardando'; })) st = 'aguardando';
    else if (etCalc.some(function (e) { return e.status === 'paralisado'; })) st = 'paralisado';
    else if (etCalc.some(function (e) { return e.status === 'andamento'; })) st = 'andamento';
    else if (concl > 0) st = 'andamento';
    else if (etCalc.some(function (e) { return e.status === 'retornado'; })) st = 'retornado';
    var mNorm = String(p.modal || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    var mAbrev = (mNorm.indexOf('pregao') >= 0 || mNorm.indexOf('concorr') >= 0) ? 'PE' : 'CD';
    var srvInt = servMap[p.id] ? (servMap[p.id].int || '') : '';
    var srvExt = servMap[p.id] ? (servMap[p.id].ext || '') : '';
    if (!srvInt && (!servMap[p.id] || !servMap[p.id].hasInt)) {
      for (var fi = 0; fi < etapas.length; fi++) { if (String(etapas[fi].fase || '').toLowerCase().indexOf('ext') < 0 && etapas[fi].agente) { srvInt = etapas[fi].agente; break; } }
    }
    if (!srvExt && (!servMap[p.id] || !servMap[p.id].hasExt)) {
      for (var fe = 0; fe < etapas.length; fe++) { if (String(etapas[fe].fase || '').toLowerCase().indexOf('ext') >= 0 && etapas[fe].agente) { srvExt = etapas[fe].agente; break; } }
    }
    var etRet = null;
    for (var k = 0; k < etCalc.length; k++) { if (etCalc[k].retornoFila) { etRet = etCalc[k]; break; } }
    return {
      id: p.id, num: p.num || p.id, nome: p.nome, modal: p.modal, modalAbrev: mAbrev,
      req: p.req, emailR: p.emailR, suap: p.suap, d0_iso: _toIso_(p.d0),
      execucao: execucao, status: st, retornoFila: retornoFila,
      motivoFila: etRet ? etRet.motivo : '', servidor: srvInt, servidorExt: srvExt,
      etapaAtualIdx: etapaAtualIdx, etapas: etCalc,
      ordemFila: ordemFilaMap.hasOwnProperty(p.id) ? ordemFilaMap[p.id] : null
    };
  });

  var ORD = { atrasado: 0, aguardando: 1, paralisado: 2, retornado: 3, andamento: 4, planejamento: 5, ok: 6 };
  resultado.sort(function (a, b) {
    var oa = ORD.hasOwnProperty(a.status) ? ORD[a.status] : 6;
    var ob = ORD.hasOwnProperty(b.status) ? ORD[b.status] : 6;
    return oa - ob;
  });
  filaPrevisao = filaPrevisao.map(function (fp) {
    var ets = etpPorProc[fp.id] || [];
    fp.etapasPrazos = ets.map(function (e) { return { nome: e.nome, prazo: e.prazo, fase: e.fase, status: e.status }; });
    fp.servidor = servMap[fp.id] ? (servMap[fp.id].int || '') : '';
    fp.servidorExt = servMap[fp.id] ? (servMap[fp.id].ext || '') : '';
    fp.ordemFila = ordemFilaMap.hasOwnProperty(fp.id) ? ordemFilaMap[fp.id] : null;
    return fp;
  });

  return {
    processos: resultado,
    filaPrevisao: isChefe ? filaPrevisao : [],
    ordemFilaDisponivel: ordemFilaDisponivel,
    calendario: { feriados: [], municipio: 'Rio de Janeiro', modoContagem: 'corridos' }
  };
}

// ── Histórico (coleção privada → lido no servidor via conta de serviço) ───
function fs_getHistorico(authToken) {
  _authRequire_(authToken, true);
  var procInfo = {};
  _fs_().query('processos').Execute().forEach(function(d){
    var o = d.obj || {};
    procInfo[String(o.id || '')] = { objeto: String(o.objeto || ''), suap: String(o.linkSuap || '') };
  });
  var out = [];
  _fs_().query('historico').Execute().forEach(function(d){
    var o = d.obj || {};
    var pid = String(o.processoId || '').trim();
    var etapa = String(o.etapa || '').trim();
    var motivo = String(o.motivo || '').trim();
    if (!pid || !etapa || !motivo) return;
    var info = procInfo[pid] || {};
    var suap = info.suap || ''; if (suap === '#') suap = '';
    var ts = o.timestamp ? new Date(o.timestamp) : null;
    out.push({
      ts: ts ? ts.getTime() : 0,
      tsStr: ts ? ts.toLocaleDateString('pt-BR') : '',
      pid: pid, objeto: info.objeto || '', suap: suap, etapa: etapa,
      servidor: String(o.servidor || '').trim(), motivo: motivo,
      dias: parseInt(o.diasAtraso, 10) || 0,
      dataRealiz: o.dataRealizacao ? String(o.dataRealizacao) : ''
    });
  });
  out.sort(function(a, b){ return (b.ts || 0) - (a.ts || 0); });
  return out;
}

// ── Capacidade: edições (a LEITURA é client-side em appsel-firestore.js) ───
// "Outros (fixo)" agora é um campo do servidor (servidores/{matricula}.outrosFixo).
function fs_salvarOutros(params) {
  return _withAppLockResult_('salvar outros pontos (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var mid = String(params.matricula || '').trim();
      if (!mid) throw new Error('Servidor não informado.');
      _fsUpdate_('servidores/' + mid, { outrosFixo: parseFloat(params.valor) || 0 });
      return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

// Pontuação guiada de uma carga (registro de processo). `docId` = id da carga.
function fs_salvarPontuacaoCap(params) {
  return _withAppLockResult_('salvar pontuação de capacidade (fs)', function() {
    try {
      params = params || {};
      _authRequire_(params.authToken, true);
      var docId = String(params.docId || '').trim();
      if (!docId) throw new Error('Carga não informada.');
      var p1 = parseFloat(params.pts11) || 0;
      var p2 = parseFloat(params.pts12) || 0;
      var p3 = parseFloat(params.pts23) || 0;
      _fsUpdate_('cargas/' + docId, { p1: p1, p2: p2, p3: p3, total: Math.round((p1 + p2 + p3) * 10) / 10 });
      return { ok: true };
    } catch(e) { return { ok: false, erro: e.message }; }
  });
}

/*
 * CORTE (último passo, quando for publicar): no shim invoke()/dispatcher do
 * index.html, rotear para os fs_* e a leitura de capacidade para
 * AppselFirestore.carregarCapacidade(); trocar et.linha→et.docId
 * (index.html:2491/2624/2837) e os handlers de capacidade (Outros→matricula,
 * pontuação→docId da carga). Chamar fs_espelharServidores_ dentro de
 * salvarServidoresApp. getHistorico: passar a ler `historico` via _fs_.
 * Depois: rodar _setupFirestoreProps_ (grava chave/props), republicar
 * firestore.rules (inclui cargas) e git push (App Gestão + Painel). Sem biblioteca.
 */
