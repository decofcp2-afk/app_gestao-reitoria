'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const nonce = '11111111-1111-4111-8111-111111111111';
const id = 'nt-'+nonce;
const clone = v => structuredClone(v);
function backend() {
  const docs = new Map(), props = new Map([['NT_ATIVA','true'],['NT_DRIVE_FOLDER_ID','privada']]), cache = new Map();
  const files = new Map(), deletes = [], mails = [], failures = new Set();
  let serial=0;
  const folder = {getId:()=> 'privada',createFile(blob){const file=makeFile('arquivo-'+(++serial),blob);files.set(file.getId(),file);return file;},
    getFiles(){const a=Array.from(files.values());return {hasNext:()=>!!a.length,next:()=>a.shift()};}};
  function makeFile(key,blob,age=0,parent='privada') {return {getId:()=>key,getName:()=>blob.nome,getDateCreated:()=>new Date(Date.now()-age),getBlob:()=>({getBytes:()=>blob.bytes}),getParents(){let n=0;return {hasNext:()=>!n,next(){n++;return {getId:()=>parent};}};}};}
  const ctx = {console,Date,JSON,Math,Object,Array,String,Number,encodeURIComponent,_FS_UNIDADE_REQ:'campus-teste',
    _authRequire_(token){if(token!=='admin')return {isAdmin:false,nome:'Servidor'};return {isAdmin:true,nome:'Administrador'};},
    _sha256Base64_:s=>crypto.createHash('sha256').update(s).digest('base64'),
    _fsGet_:path=>clone(docs.get(path)||null),_fsSet_:(path,d)=>docs.set(path,clone(d)),
    _fsUpdate_:(path,d)=>docs.set(path,Object.assign(clone(docs.get(path)||{}),clone(d))),
    _fs_:()=>({query:col=>({Execute:()=>Array.from(docs).filter(([p])=>p.startsWith(col+'/')).map(([path,obj])=>({path,obj:clone(obj)}))})}),
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
    Utilities:{getUuid:()=>nonce,formatDate:(_d,_tz,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-09':'20261009',
      base64Decode:s=>Array.from(Buffer.from(s,'base64')),base64Encode:b=>Buffer.from(b).toString('base64'),newBlob:(bytes,tipo,nome)=>({bytes,tipo,nome})},
    DriveApp:{getStorageLimit:()=>15e9,getStorageUsed:()=>1e9,getFolderById:()=>folder,getFileById:key=>files.get(key),createFolder:()=>Object.assign(folder,{setSharing(){}}),Access:{PRIVATE:'private'},Permission:{NONE:'none'}},
    ScriptApp:{getOAuthToken:()=> 'mock',getProjectTriggers:()=>[],newTrigger:()=>({timeBased:()=>({everyMinutes:()=>({create(){}})})})},
    MailApp:{getRemainingDailyQuota:()=>100,sendEmail:d=>mails.push(d)},
    UrlFetchApp:{fetch(url,opts){const key=decodeURIComponent(url.split('/').pop());assert.equal(opts.method,'delete');deletes.push(key);if(!failures.has(key))files.delete(key);return {getResponseCode:()=>failures.has(key)?503:204};}}
  };
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('apps-script/NotasTecnicas.gs','utf8'),ctx);
  cache.set('nt_form_'+nonce,String(Date.now()-5000));
  return {ctx,docs,props,cache,files,deletes,mails,failures,makeFile};
}
const dados = (arquivos=[])=>({nonce,nome:'Pessoa solicitante',email:'pessoa@example.org',unidade:'Órgão solicitante',assunto:'Análise técnica',descricao:'Descrição suficiente para análise',arquivos});
const pdf = (size=16)=>({nome:'demanda.pdf',tipo:'application/pdf',base64:Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(Math.max(0,size-5))]).toString('base64')});
function pedido(h,status='nova') {h.docs.set('solicitacoesNT/'+id,{protocolo:'NT-20261009-11111111',status,criadoEm:new Date(),anexos:[{id:'arquivo-1',nome:'demanda.pdf',tipo:'application/pdf',tamanho:16,excluido:false}],historico:[],emailPendente:false});}

test('aceita PDF verdadeiro e rejeita extensão falsa, conteúdo falso e honeypot',()=>{
  const {ctx}=backend();assert.equal(ctx._ntValidar_(dados([pdf()])).tamanhoTotal,16);
  assert.throws(()=>ctx._ntValidar_(dados([{...pdf(),nome:'arquivo.exe'}])),/somente/);
  assert.throws(()=>ctx._ntValidar_(dados([{...pdf(),base64:Buffer.from('nao e pdf').toString('base64')}])),/conteúdo/);
  assert.throws(()=>ctx._ntValidar_({...dados(),site:'bot'}),/não permitido/);
});
test('limites de 5 arquivos, 5 MB individuais e 10 MB totais valem no servidor',()=>{
  const {ctx}=backend();assert.throws(()=>ctx._ntValidar_(dados(Array(6).fill(pdf()))),/5 arquivos/);
  assert.throws(()=>ctx._ntValidar_(dados([pdf(5*1024*1024+1)])),/5 MB/);
  assert.equal(ctx._ntValidar_(dados([pdf(5*1024*1024),pdf(5*1024*1024)])).tamanhoTotal,10*1024*1024);
  assert.throws(()=>ctx._ntValidar_(dados([pdf(5*1024*1024),pdf(5*1024*1024),pdf()])),/10 MB/);
});
test('envio gera protocolo idempotente, arquivo privado e apenas aviso sem anexos',()=>{
  const h=backend(),r=h.ctx.ntEnviarSolicitacao(dados([pdf()]));assert.equal(r.ok,true);assert.match(r.protocolo,/^NT-/);
  assert.equal(h.files.size,1);assert.equal(h.docs.get('solicitacoesNT/'+id).status,'nova');
  assert.equal(h.mails[0].to,'decof@cp2.g12.br');assert.equal(h.mails[0].attachments,undefined);
  assert.equal(h.ctx.ntEnviarSolicitacao(dados([pdf()])).protocolo,r.protocolo);assert.equal(h.files.size,1);assert.equal(h.mails.length,1);
  assert.equal(h.ctx._FS_UNIDADE_REQ,'campus-teste');
});
test('falha de e-mail preserva pedido e manutenção tenta avisar novamente',()=>{
  const h=backend();h.ctx.MailApp.sendEmail=()=>{throw new Error('quota');};assert.equal(h.ctx.ntEnviarSolicitacao(dados()).ok,true);
  assert.equal(h.docs.get('solicitacoesNT/'+id).emailPendente,true);
  h.ctx.MailApp.sendEmail=d=>h.mails.push(d);h.ctx.ntManutencao();assert.equal(h.mails.length,1);assert.equal(h.docs.get('solicitacoesNT/'+id).emailPendente,false);
});
test('servidor comum não lê pedidos, baixa anexos, configura, atende ou publica',()=>{
  const {ctx}=backend();assert.equal(ctx.getSolicitacoesNTApp('servidor').ok,false);assert.equal(ctx.getAnexoNTApp(id,'arquivo-1','servidor').ok,false);
  assert.throws(()=>ctx.configurarSolicitacoesNTApp({email:'decof@cp2.g12.br'},'servidor'),/administrador/);
  assert.throws(()=>ctx.atualizarSolicitacaoNTApp({id,status:'atendida',resposta:'OK'},'servidor'),/administrador/);
  assert.throws(()=>ctx.publicarDocumentoNTApp({titulo:'Teste',categoria:'nota',url:'https://example.org/nota'},'servidor'),/administrador/);
});
test('atendimento exige resposta, guarda histórico e apaga anexos definitivamente',()=>{
  const h=backend();pedido(h);assert.equal(h.ctx.atualizarSolicitacaoNTApp({id,status:'atendida'},'admin').ok,false);
  const r=h.ctx.atualizarSolicitacaoNTApp({id,status:'atendida',resposta:'Documento emitido.'},'admin');assert.equal(r.ok,true);assert.equal(r.exclusaoPendente,false);
  assert.deepEqual(h.deletes,['arquivo-1']);const saved=h.docs.get('solicitacoesNT/'+id);assert.equal(saved.anexos[0].excluido,true);assert.equal(saved.historico[0].status,'atendida');assert.equal(saved.resposta,'Documento emitido.');
  assert.equal(h.ctx.getAnexoNTApp(id,'arquivo-1','admin').ok,false);
  assert.equal(h.ctx.atualizarSolicitacaoNTApp({id,status:'analise'},'admin').ok,false);
});
test('falha na exclusão fica pendente e é recuperada pelo gatilho',()=>{
  const h=backend();pedido(h);h.failures.add('arquivo-1');assert.equal(h.ctx.atualizarSolicitacaoNTApp({id,status:'atendida',resposta:'Atendimento concluído.'},'admin').exclusaoPendente,true);
  assert.equal(h.docs.get('solicitacoesNT/'+id).status,'atendida');h.failures.clear();h.ctx.ntManutencao();assert.equal(h.docs.get('solicitacoesNT/'+id).exclusaoPendente,false);assert.equal(h.docs.get('solicitacoesNT/'+id).anexos[0].excluido,true);
});
test('encerramento direto é rejeitado e anexo de outra pasta não é baixado',()=>{
  const h=backend();pedido(h);assert.equal(h.ctx.atualizarSolicitacaoNTApp({id,status:'encerrada',resposta:'OK'},'admin').ok,false);
  h.files.set('arquivo-1',h.makeFile('arquivo-1',{nome:'arquivo',bytes:[1]},0,'outra'));
  assert.match(h.ctx.getAnexoNTApp(id,'arquivo-1','admin').erro,/pasta autorizada/);
});
test('falha na gravação depois de criar arquivo desfaz upload e não confirma protocolo',()=>{
  const h=backend(),set=h.ctx._fsUpdate_;h.ctx._fsUpdate_=(path,d)=>{if(d.anexos)throw new Error('Firestore offline');return set(path,d);};
  assert.equal(h.ctx.ntEnviarSolicitacao(dados([pdf()])).ok,false);assert.equal(h.files.size,0);assert.equal(h.mails.length,0);assert.equal(h.docs.get('solicitacoesNT/'+id).status,'falha');
});
test('manutenção recupera upload interrompido e órfãos antigos apenas na pasta do módulo',()=>{
  const h=backend();pedido(h,'recebendo');h.docs.get('solicitacoesNT/'+id).criadoEm=new Date(Date.now()-7200000);
  h.files.set('orfao',h.makeFile('orfao',{nome:'NT-20261009-1234ABCD_demanda.pdf',bytes:[1]},7200000));
  h.files.set('outro',h.makeFile('outro',{nome:'outro.pdf',bytes:[1]},7200000));
  h.ctx.ntManutencao();assert.equal(h.docs.get('solicitacoesNT/'+id).status,'falha');assert.ok(h.deletes.includes('orfao'));assert.ok(!h.deletes.includes('outro'));
});
test('biblioteca pública inclui somente campos publicados e nenhuma informação de pedidos',()=>{
  const h=backend();pedido(h);h.docs.set('documentosNT/doc',{publicado:true,titulo:'Portaria',categoria:'portaria',url:'https://suap.cp2.g12.br/doc/1',publicadoPor:'Administrador',email:'privado'});h.docs.set('documentosNT/rascunho',{publicado:false,titulo:'Interno'});
  const r=h.ctx.getBibliotecaNTPublica();assert.equal(r.documentos.length,1);assert.equal(r.documentos[0].publicadoPor,undefined);assert.equal(r.documentos[0].email,undefined);assert.equal(r.pedidos,undefined);
  assert.throws(()=>h.ctx._ntUrl_('javascript:alert(1)'),/HTTPS/);assert.throws(()=>h.ctx._ntUrl_('https://pessoa:senha@example.org/'),/HTTPS/);
});
test('formulário inativo, tempo mínimo e limite diário por e-mail são aplicados',()=>{
  const h=backend();h.props.set('NT_ATIVA','false');assert.equal(h.ctx.ntPrepararFormulario().ok,false);assert.equal(h.ctx.ntEnviarSolicitacao(dados()).ok,false);h.props.set('NT_ATIVA','true');h.cache.set('nt_form_'+nonce,String(Date.now()));assert.equal(h.ctx.ntEnviarSolicitacao(dados()).ok,false);
  for(let i=0;i<5;i++)h.ctx._ntLimitar_('pessoa@example.org');assert.throws(()=>h.ctx._ntLimitar_('pessoa@example.org'),/Limite/);
});
