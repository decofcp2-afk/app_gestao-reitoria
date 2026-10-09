'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('apps-script/Code.gs', 'utf8');
const routing = source.slice(source.indexOf('function doGet(e)'), source.indexOf('function _apiParseArgs_'));
function api() {
  let submissions = 0;
  const ctx = {
    ContentService: {MimeType:{JSON:'json',JAVASCRIPT:'js'}, createTextOutput(text) {
      return {text, setMimeType(type){this.type=type;return this;}};
    }},
    ntPrepararFormulario:()=>({ok:true,nonce:'public-form-nonce'}),
    ntEnviarSolicitacao:payload=>{submissions++;return {ok:true,protocolo:'NT-123',nome:payload.nome};}
  };
  vm.createContext(ctx);vm.runInContext(routing,ctx);
  return {ctx,submissions:()=>submissions};
}
const event = (body,route='nt.enviar') => ({parameter:{route,callback:'steal'},postData:{contents:body}});
test('preparação pública retorna JSON sem executar callback fornecido',()=>{
  const {ctx}=api();const r=ctx.doGet({parameter:{route:'nt.preparar',callback:'steal'}});
  assert.equal(r.type,'json');assert.equal(JSON.parse(r.text).nonce,'public-form-nonce');
});
test('envio público por POST encaminha os dados à validação existente e não usa JSONP',()=>{
  const {ctx,submissions}=api();const r=ctx.doPost(event(JSON.stringify({nonce:'123',nome:'Pessoa',arquivos:[]})));
  assert.equal(r.type,'json');assert.equal(JSON.parse(r.text).protocolo,'NT-123');assert.equal(submissions(),1);
});
test('rotas privadas, JSON inválido, arrays e corpos excessivos não são encaminhados',()=>{
  const {ctx,submissions}=api();
  for(const e of [event('{}','appsel.call'),event('{'),event('[]'),event('x'.repeat(15*1024*1024+1))]) {
    assert.equal(JSON.parse(ctx.doPost(e).text).ok,false);
  }
  assert.equal(submissions(),0);
});
test('falhas de validação são devolvidas ao formulário e GET não recebe solicitações',()=>{
  const {ctx,submissions}=api();ctx.ntEnviarSolicitacao=()=>{throw new Error('Nonce expirado');};
  assert.equal(JSON.parse(ctx.doPost(event('{}')).text).erro,'Nonce expirado');
  assert.equal(JSON.parse(ctx.doGet({parameter:{route:'nt.enviar'}}).text).ok,false);
  assert.equal(submissions(),0);
});
