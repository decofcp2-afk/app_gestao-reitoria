'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function tela(){
  const els=new Map(),callbacks=[],toasts=[];
  const el=id=>{if(!els.has(id))els.set(id,{hidden:true,textContent:'',innerHTML:'',classList:{add(){},remove(){}},replaceChildren(){this.innerHTML='';}});return els.get(id);};
  const root={SESSAO_ADMIN:true,AUTH_TOKEN:'sessao-admin',toast:(...a)=>toasts.push(a)};
  const run={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},getSolicitacoesNTApp(){callbacks.push(this.success);}};
  const ctx={window:root,document:{getElementById:el,addEventListener(){}},google:{script:{run}},setInterval:()=>1,clearInterval(){},URLSearchParams,location:{search:''},Date,Object,Array,String,Number,Math};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync('notas-tecnicas.js','utf8'),ctx);
  return {root,el,callbacks,toasts};
}
const resposta={ok:true,pedidos:[{_id:'nt-exemplo',protocolo:'NT-privado',nome:'Pessoa',email:'privado@example.org',assunto:'Assunto',unidade:'Unidade',status:'nova'}],novas:1,ativa:true,email:'decof@cp2.g12.br',armazenamento:{usados:0,limite:1e10,percentual:0,disponivel:1e10}};
test('resposta atrasada depois do logout não restaura pedidos privados ou indicadores',()=>{
  const h=tela();h.root.carregarSolicitacoesNT_();h.root.SESSAO_ADMIN=false;h.root.AUTH_TOKEN='';h.root.limparSolicitacoesNT_();h.callbacks[0](resposta);
  assert.equal(h.el('tab-solicitacoes').innerHTML,'');assert.equal(h.el('nt-badge-menu').hidden,true);
});
test('resposta da sessão anterior é descartada após troca de administrador',()=>{
  const h=tela();h.root.carregarSolicitacoesNT_();h.root.AUTH_TOKEN='outra-sessao';h.root.limparSolicitacoesNT_();h.callbacks[0](resposta);
  assert.equal(h.el('tab-solicitacoes').innerHTML,'');
});
test('atualização silenciosa de indicadores não apaga formulário que o admin está editando',()=>{
  const h=tela();h.el('tab-solicitacoes').hidden=false;h.el('tab-solicitacoes').innerHTML='Configuração em edição';h.root.carregarSolicitacoesNT_(true);h.callbacks[0](resposta);
  assert.equal(h.el('tab-solicitacoes').innerHTML,'Configuração em edição');assert.equal(h.el('nt-badge-menu').textContent,1);
});
