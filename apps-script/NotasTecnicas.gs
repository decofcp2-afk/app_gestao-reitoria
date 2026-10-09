// Solicitações públicas: metadados no Firestore, anexos privados e temporários no Drive.
// Toda consulta/alteração de pedidos exige o administrador geral. Não usa Firebase Storage.
var NT_MAX_ARQUIVOS = 5;
var NT_MAX_ARQUIVO = 5 * 1024 * 1024;
var NT_MAX_PEDIDO = 10 * 1024 * 1024;
var NT_ORCAMENTO_DRIVE = 10 * 1000 * 1000 * 1000;

function _ntTexto_(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function _ntEmail_(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
function _ntProps_() { return PropertiesService.getScriptProperties(); }
function _ntCentral_(fn) {
  var anterior = _FS_UNIDADE_REQ;
  _FS_UNIDADE_REQ = 'reitoria-sel';
  try { return fn(); } finally { _FS_UNIDADE_REQ = anterior; }
}
function _ntAdmin_(token) {
  var sess = _authRequire_(token, false);
  if (!sess.isAdmin) throw new Error('Ação exclusiva do administrador geral.');
  return sess;
}
function _ntLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {ok:false, erro:'Há outro envio em andamento. Tente novamente.'};
  try { return _ntCentral_(fn); }
  catch(e) { return {ok:false, erro:e.message}; }
  finally { lock.releaseLock(); }
}
function _ntAtiva_() { return _ntProps_().getProperty('NT_ATIVA') === 'true'; }
function _ntRows_(col) {
  return _fs_().query(col).Execute().map(function(row) {
    var d = row.obj || row;
    d._id = d._id || String(row.path || '').split('/').pop();
    return d;
  });
}
function _ntData_(v) {
  if (!v) return '';
  var d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
function _ntPedidoPublicavel_(p) {
  var d = Object.assign({}, p);
  ['criadoEm','atualizadoEm','atendidoEm','anexosExcluidosEm'].forEach(function(k){ d[k] = _ntData_(d[k]); });
  d.historico = (d.historico || []).map(function(h){ return Object.assign({},h,{em:_ntData_(h.em)}); });
  return d;
}
function _ntOcupacao_() {
  var usados = _ntRows_('solicitacoesNT').reduce(function(total,p) {
    return total + (p.anexos || []).reduce(function(n,a){ return n + (a.excluido ? 0 : Number(a.tamanho || 0)); },0);
  },0);
  var quota = DriveApp.getStorageLimit(), contaUsada = DriveApp.getStorageUsed();
  return {usados:usados, limite:NT_ORCAMENTO_DRIVE, percentual:Math.round(usados / NT_ORCAMENTO_DRIVE * 100),
    contaLimite:quota, contaUsada:contaUsada, disponivel:quota > 0 ? Math.max(0,quota-contaUsada) : null};
}
function _ntPasta_() {
  var id = _ntProps_().getProperty('NT_DRIVE_FOLDER_ID');
  if (!id) throw new Error('O administrador precisa ativar o recebimento de solicitações.');
  return DriveApp.getFolderById(id);
}
function _ntNomeArquivo_(nome) {
  return _ntTexto_(nome,150).replace(/[\x00-\x1f/\\<>:"|?*]/g,'_') || 'anexo';
}
function _ntValidar_(dados) {
  dados = dados || {};
  var p = {nome:_ntTexto_(dados.nome,120), email:_ntTexto_(dados.email,254).toLowerCase(),
    unidade:_ntTexto_(dados.unidade,160), assunto:_ntTexto_(dados.assunto,180), descricao:_ntTexto_(dados.descricao,5000)};
  if (!p.nome || !_ntEmail_(p.email) || !p.unidade || !p.assunto || p.descricao.length < 10)
    throw new Error('Preencha nome, e-mail, unidade/órgão, assunto e uma descrição de pelo menos 10 caracteres.');
  if (_ntTexto_(dados.site,200)) throw new Error('Envio não permitido.');
  var arquivos = dados.arquivos || [];
  if (!Array.isArray(arquivos) || arquivos.length > NT_MAX_ARQUIVOS) throw new Error('Envie no máximo 5 arquivos.');
  var total = 0;
  p.arquivos = arquivos.map(function(a) {
    var tipo = String(a.tipo || ''), nome = _ntNomeArquivo_(a.nome), b64 = String(a.base64 || '');
    var extensoes = {'application/pdf':/\.pdf$/i, 'image/jpeg':/\.jpe?g$/i, 'image/png':/\.png$/i};
    if (!extensoes[tipo] || !extensoes[tipo].test(nome)) throw new Error('Anexe somente PDF, JPG ou PNG.');
    if (!b64 || b64.length > Math.ceil(NT_MAX_ARQUIVO/3)*4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64))
      throw new Error('Arquivo inválido ou maior que 5 MB.');
    var bytes = Utilities.base64Decode(b64);
    if (!bytes.length || bytes.length > NT_MAX_ARQUIVO) throw new Error('Cada arquivo deve ter até 5 MB.');
    var u = function(i){ return (bytes[i] || 0) & 255; };
    var valido = tipo === 'application/pdf' ? u(0)===37&&u(1)===80&&u(2)===68&&u(3)===70&&u(4)===45
      : tipo === 'image/png' ? u(0)===137&&u(1)===80&&u(2)===78&&u(3)===71&&u(4)===13&&u(5)===10&&u(6)===26&&u(7)===10
      : u(0)===255&&u(1)===216&&u(2)===255;
    if (!valido) throw new Error('O conteúdo do arquivo não corresponde ao formato informado.');
    total += bytes.length;
    if (total > NT_MAX_PEDIDO) throw new Error('Os anexos juntos devem ter até 10 MB.');
    return {nome:nome, tipo:tipo, tamanho:bytes.length, bytes:bytes};
  });
  p.tamanhoTotal = total;
  return p;
}
function ntPrepararFormulario() {
  if (!_ntAtiva_()) return {ok:false, erro:'O recebimento de solicitações está em configuração. Tente novamente mais tarde.'};
  var nonce = Utilities.getUuid(), agora = Date.now();
  CacheService.getScriptCache().put('nt_form_'+nonce, String(agora), 1800);
  return {ok:true, nonce:nonce};
}
function _ntLimitar_(email) {
  var pr = _ntProps_(), dia = Utilities.formatDate(new Date(),'America/Sao_Paulo','yyyy-MM-dd');
  var raw = pr.getProperty('NT_CONTADORES') || '{}', c = JSON.parse(raw);
  if(c.dia !== dia) c = {dia:dia,total:0,emails:{}};
  var chave = _sha256Base64_(email);
  if(c.total >= 100 || (c.emails[chave]||0) >= 5) throw new Error('Limite de solicitações alcançado. Tente novamente amanhã.');
  c.total++; c.emails[chave] = (c.emails[chave]||0)+1;
  pr.setProperty('NT_CONTADORES',JSON.stringify(c));
}
function _ntExcluirArquivo_(id) {
  if(!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error('Identificador de anexo inválido.');
  var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id), {
    method:'delete',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
  var code = r.getResponseCode();
  if(code !== 204 && code !== 404) throw new Error('Não foi possível excluir o anexo (HTTP '+code+').');
}
function _ntAvisar_(p) {
  try {
    if(MailApp.getRemainingDailyQuota() < 5) return false;
    var email = _ntProps_().getProperty('NT_EMAIL_AVISOS') || 'decof@cp2.g12.br';
    MailApp.sendEmail({to:email,subject:'Nova solicitação de nota técnica · '+p.protocolo,
      name:'Colégio Pedro II — Solicitações',body:'Uma solicitação de nota técnica foi recebida.\n\nProtocolo: '+p.protocolo+
      '\nAssunto: '+p.assunto+'\nUnidade/órgão: '+p.unidade+'\nSolicitante: '+p.nome+'\n\nAbra o App Gestão com o login de administrador:\nhttps://decofcp2-afk.github.io/app_gestao-reitoria/?tab=solicitacoes\n\nOs anexos estão disponíveis somente na área administrativa.'});
    return true;
  } catch(e) { return false; }
}
function ntEnviarSolicitacao(dados) {
  return _ntLock_(function() {
    if(!_ntAtiva_()) throw new Error('O recebimento de solicitações ainda não está ativo.');
    var nonce = String(dados && dados.nonce || '');
    if(!/^[a-f0-9-]{36}$/i.test(nonce)) throw new Error('Reabra o formulário para enviar sua solicitação.');
    var id = 'nt-'+nonce;
    var existente = _fsGet_('solicitacoesNT/'+id);
    if(existente && ['recebendo','falha'].indexOf(existente.status)<0) return {ok:true, protocolo:existente.protocolo};
    if(existente) throw new Error('O envio anterior não foi concluído. Reabra o formulário para tentar novamente.');
    var cache = CacheService.getScriptCache(), inicio = Number(cache.get('nt_form_'+nonce));
    if(!inicio || Date.now()-inicio < 3000) throw new Error('Formulário expirado ou envio muito rápido. Reabra o formulário.');
    var p = _ntValidar_(dados), ocupacao = _ntOcupacao_();
    if(ocupacao.usados + p.tamanhoTotal > NT_ORCAMENTO_DRIVE || (ocupacao.disponivel !== null && p.tamanhoTotal > ocupacao.disponivel))
      throw new Error('O espaço para anexos está temporariamente indisponível. Tente novamente mais tarde.');
    _ntLimitar_(p.email);
    cache.remove('nt_form_'+nonce);
    var pasta = _ntPasta_(), anexos = [], agora = new Date();
    var protocolo = 'NT-'+Utilities.formatDate(agora,'America/Sao_Paulo','yyyyMMdd')+'-'+nonce.slice(0,8).toUpperCase();
    try {
      // Reserva o protocolo antes de criar arquivos: a manutenção recupera envios interrompidos.
      var reserva=Object.assign({},p);delete reserva.arquivos;
      _fsSet_('solicitacoesNT/'+id,Object.assign(reserva,{protocolo:protocolo,status:'recebendo',criadoEm:agora,anexos:[]}));
      p.arquivos.forEach(function(a) {
        var f = pasta.createFile(Utilities.newBlob(a.bytes,a.tipo,protocolo+'_'+a.nome));
        anexos.push({id:f.getId(),nome:a.nome,tipo:a.tipo,tamanho:a.tamanho,excluido:false});
        _fsUpdate_('solicitacoesNT/'+id,{anexos:anexos});
      });
      delete p.arquivos;
      Object.assign(p,{protocolo:protocolo,status:'nova',criadoEm:agora,atualizadoEm:agora,anexos:anexos,
        resposta:'',respostaUrl:'',emailPendente:true,exclusaoPendente:false,historico:[{status:'nova',em:agora,por:'Solicitante'}]});
      _fsSet_('solicitacoesNT/'+id,p);
    } catch(e) {
      var pendentes = [];
      anexos.forEach(function(a){try{_ntExcluirArquivo_(a.id);}catch(x){pendentes.push(a);}});
      try { _fsSet_('solicitacoesNT/'+id,{status:'falha',protocolo:protocolo,anexos:pendentes,exclusaoPendente:!!pendentes.length,criadoEm:agora}); } catch(x) {}
      throw new Error('Não foi possível concluir o envio. Tente novamente.');
    }
    var enviado = _ntAvisar_(p);
    if(enviado) { try { _fsUpdate_('solicitacoesNT/'+id,{emailPendente:false}); } catch(e) {} }
    return {ok:true,protocolo:protocolo};
  });
}
function _ntLimparAnexos_(p) {
  var pendente = false;
  (p.anexos||[]).forEach(function(a) {
    if(a.excluido)return;
    try{_ntExcluirArquivo_(a.id);a.excluido=true;}catch(e){pendente=true;}
  });
  p.exclusaoPendente = pendente;
  if(!pendente)p.anexosExcluidosEm=new Date();
  _fsUpdate_('solicitacoesNT/'+p._id,{anexos:p.anexos||[],exclusaoPendente:pendente,anexosExcluidosEm:p.anexosExcluidosEm||null});
  return !pendente;
}
function getSolicitacoesNTApp(token) {
  try {
    _ntAdmin_(token);
    return _ntCentral_(function(){
      var pedidos = _ntRows_('solicitacoesNT').filter(function(p){return ['falha','recebendo'].indexOf(p.status)<0;});
      pedidos.sort(function(a,b){return _ntData_(b.criadoEm).localeCompare(_ntData_(a.criadoEm));});
      var armazenamento;
      try{armazenamento=_ntOcupacao_();}catch(e){armazenamento={erro:'Autorize o acesso ao Drive no editor do Apps Script para habilitar os anexos.'};}
      return {ok:true,pedidos:pedidos.map(_ntPedidoPublicavel_),novas:pedidos.filter(function(p){return p.status==='nova';}).length,
        ativa:_ntAtiva_(),email:_ntProps_().getProperty('NT_EMAIL_AVISOS')||'decof@cp2.g12.br',armazenamento:armazenamento};
    });
  }catch(e){return {ok:false,erro:e.message};}
}
function configurarSolicitacoesNTApp(dados,token) {
  var sess = _ntAdmin_(token);
  return _ntLock_(function(){
    var email = _ntTexto_(dados && dados.email,254).toLowerCase();
    if(!_ntEmail_(email))throw new Error('Informe um e-mail válido para os avisos.');
    var pr = _ntProps_();
    DriveApp.getStorageUsed();
    if(!pr.getProperty('NT_DRIVE_FOLDER_ID')){
      var pasta=DriveApp.createFolder('CPII — anexos temporários de solicitações de notas técnicas');
      pasta.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
      pr.setProperty('NT_DRIVE_FOLDER_ID',pasta.getId());
    }
    var temTrigger=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='ntManutencao';});
    if(!temTrigger)ScriptApp.newTrigger('ntManutencao').timeBased().everyMinutes(10).create();
    pr.setProperty('NT_EMAIL_AVISOS',email);
    pr.setProperty('NT_ATIVA',dados.ativa===false?'false':'true');
    pr.setProperty('NT_CONFIGURADO_POR',sess.nome);
    return {ok:true};
  });
}
// Execute uma vez no editor, com a conta institucional, para autorizar o Drive.
// Esta função não ativa o formulário nem envia e-mail.
function autorizarAnexosNotasTecnicas() {
  return {limite:DriveApp.getStorageLimit(),usado:DriveApp.getStorageUsed()};
}
function atualizarSolicitacaoNTApp(dados,token) {
  var sess = _ntAdmin_(token);
  return _ntLock_(function(){
    dados=dados||{};
    var id=_ntTexto_(dados.id,100);
    if(!/^nt-[a-f0-9-]{36}$/i.test(id))throw new Error('Pedido inválido.');
    var p=_fsGet_('solicitacoesNT/'+id);
    if(!p||p.status==='falha')throw new Error('Pedido não encontrado.');
    var status=String(dados.status||'');
    if(['nova','analise','atendida','encerrada'].indexOf(status)<0)throw new Error('Situação inválida.');
    if(['atendida','encerrada'].indexOf(p.status)>=0 && ['nova','analise'].indexOf(status)>=0)
      throw new Error('Os anexos deste pedido já foram excluídos. Para nova análise, solicite um novo pedido.');
    var resposta=_ntTexto_(dados.resposta,5000),url=_ntUrl_(dados.respostaUrl);
    if(['atendida','encerrada'].indexOf(status)>=0&&!resposta)throw new Error('Registre a resposta antes de concluir o atendimento.');
    if(status==='encerrada'&&p.status!=='atendida'&&p.status!=='encerrada')throw new Error('Marque como atendida antes de encerrar.');
    var historico=p.historico||[];
    if(status!==p.status)historico.push({status:status,em:new Date(),por:sess.nome});
    var campos={status:status,resposta:resposta,respostaUrl:url,atualizadoEm:new Date(),atualizadoPor:sess.nome,historico:historico};
    if(status==='atendida'&&p.status!=='atendida')campos.atendidoEm=new Date();
    if(status==='atendida'||status==='encerrada')campos.exclusaoPendente=true;
    _fsUpdate_('solicitacoesNT/'+id,campos);
    Object.assign(p,campos,{_id:id});
    var limpo=true;
    if(p.exclusaoPendente)limpo=_ntLimparAnexos_(p);
    return {ok:true,exclusaoPendente:!limpo};
  });
}
function getAnexoNTApp(id,arquivoId,token) {
  try {
    _ntAdmin_(token);
    return _ntCentral_(function(){
      if(!/^nt-[a-f0-9-]{36}$/i.test(String(id)))throw new Error('Pedido inválido.');
      var p=_fsGet_('solicitacoesNT/'+id);
      if(!p||['atendida','encerrada','falha'].indexOf(p.status)>=0)throw new Error('Anexos indisponíveis após o atendimento.');
      var a=(p.anexos||[]).find(function(x){return x.id===arquivoId&&!x.excluido;});
      if(!a)throw new Error('Anexo não encontrado.');
      var f=DriveApp.getFileById(a.id),pais=f.getParents(),correto=false,pasta=_ntPasta_().getId();
      while(pais.hasNext())if(pais.next().getId()===pasta)correto=true;
      if(!correto)throw new Error('Anexo fora da pasta autorizada.');
      return {ok:true,nome:a.nome,tipo:a.tipo,base64:Utilities.base64Encode(f.getBlob().getBytes())};
    });
  }catch(e){return {ok:false,erro:e.message};}
}
function ntManutencao() {
  return _ntLock_(function(){
    var pedidos=_ntRows_('solicitacoesNT'), conhecidos={},limite=Date.now()-3600000;
    pedidos.forEach(function(p){
      (p.anexos||[]).forEach(function(a){conhecidos[a.id]=true;});
      if(p.status==='recebendo'&&new Date(p.criadoEm).getTime()<limite){
        p.status='falha';p.exclusaoPendente=true;
        _fsUpdate_('solicitacoesNT/'+p._id,{status:'falha',exclusaoPendente:true});
      }
      if(p.exclusaoPendente)_ntLimparAnexos_(p);
      if(p.emailPendente&&p.status!=='falha'&&_ntAvisar_(p))_fsUpdate_('solicitacoesNT/'+p._id,{emailPendente:false});
    });
    // Recupera também a janela entre createFile e a gravação de seu ID no Firestore.
    if(_ntProps_().getProperty('NT_DRIVE_FOLDER_ID')){
      var arquivos=_ntPasta_().getFiles();
      while(arquivos.hasNext()){
        var f=arquivos.next();
        if(!conhecidos[f.getId()]&&/^NT-\d{8}-[A-F0-9]{8}_/.test(f.getName())&&f.getDateCreated().getTime()<limite){
          try{_ntExcluirArquivo_(f.getId());}catch(e){console.warn('Limpeza de anexo órfão pendente.');}
        }
      }
    }
    return {ok:true};
  });
}
function _ntUrl_(url) {
  url=_ntTexto_(url,1200);
  if(url&&!/^https:\/\/[a-z0-9.-]+(?::443)?(?:\/[^\s<>"']*)?$/i.test(url))throw new Error('Use um endereço HTTPS válido para o documento.');
  return url;
}
function getBibliotecaNTPublica() {
  return _ntCentral_(function(){
    var documentos=_ntRows_('documentosNT').filter(function(d){return d.publicado===true;}).map(function(d){
      return {id:d._id,titulo:d.titulo,categoria:d.categoria,numero:d.numero,data:d.data,assunto:d.assunto,url:_ntUrl_(d.url)};
    });
    return {ok:true,documentos:documentos,solicitacoesAtivas:_ntAtiva_()};
  });
}
function publicarDocumentoNTApp(dados,token) {
  var sess=_ntAdmin_(token);
  return _ntLock_(function(){
    dados=dados||{};
    var categoria=String(dados.categoria||'');
    if(['nota','portaria'].indexOf(categoria)<0)throw new Error('Escolha Nota técnica ou Portaria.');
    var titulo=_ntTexto_(dados.titulo,180),url=_ntUrl_(dados.url);
    if(!titulo||!url)throw new Error('Informe título e endereço do documento.');
    var id=Utilities.getUuid();
    _fsSet_('documentosNT/'+id,{titulo:titulo,categoria:categoria,numero:_ntTexto_(dados.numero,60),data:_ntTexto_(dados.data,10),
      assunto:_ntTexto_(dados.assunto,500),url:url,publicado:true,publicadoEm:new Date(),publicadoPor:sess.nome});
    return {ok:true};
  });
}
