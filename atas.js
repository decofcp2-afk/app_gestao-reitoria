(function (root) {
  'use strict';

  var D = root.AtasDomain;
  var state = { enabled: false, loaded: false, loading: false, atas: [], alertas: [], selected: null, mode: 'compras', resultados: [], prefill: null, page: 1, pageSize: 25 };
  root.GESTAO_ATAS = state;

  function e(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]; });
  }
  function el(id) { return document.getElementById(id); }
  function val(id) { return (el(id) && el(id).value || '').trim(); }
  function localPreview() { return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && /(?:\?|&)previewAtas=1(?:&|$)/.test(location.search); }
  function unidadePilotoConhecida() {
    return !!(root.AppselFirestore && root.AppselFirestore.unidadeAtual
      && root.AppselFirestore.unidadeAtual() === 'reitoria-sel');
  }
  function podeEditar(ata) { return !!(state.podeGerirTodas || (root.SERVIDOR && D.normalizarTexto(root.SERVIDOR) === D.normalizarTexto(ata.responsavel))); }

  function previewData() {
    return [
      {_id:'p1',numeroAta:'01126/2026',uasg:'153167',processo:'23040.000201/2026-83',numeroCompra:'90011',anoCompra:'2026',objeto:'Materiais esportivos e recreativos',responsavel:'Bruno Alves',vigenciaInicio:'2026-08-14',vigenciaFim:'2027-08-14',origem:'compras'},
      {_id:'p2',numeroAta:'00987/2026',uasg:'153167',processo:'23040.000156/2026-41',numeroCompra:'90007',anoCompra:'2026',objeto:'Equipamentos de informática',responsavel:'Carla Mendes',vigenciaInicio:'2026-08-01',vigenciaFim:'2026-10-23',origem:'compras'},
      {_id:'p3',numeroAta:'00606/2026',uasg:'153167',processo:'23040.000098/2026-12',numeroCompra:'90008',anoCompra:'2026',objeto:'Mobiliário corporativo (mesas e cadeiras)',responsavel:'Rafael Lima',vigenciaInicio:'2026-06-18',vigenciaFim:'2027-06-18',origem:'compras'},
      {_id:'p4',numeroAta:'00854/2026',uasg:'153167',processo:'23040.000110/2026-77',numeroCompra:'90009',anoCompra:'2026',objeto:'Material de expediente',responsavel:'Fernanda Souza',vigenciaInicio:'2026-07-10',vigenciaFim:'2027-07-10',origem:'compras'},
      {_id:'p5',numeroAta:'00741/2026',uasg:'153167',processo:'23040.000099/2026-55',numeroCompra:'90006',anoCompra:'2026',objeto:'Serviços de limpeza e conservação',responsavel:'André Santos',vigenciaInicio:'2026-06-01',vigenciaFim:'2027-06-01',origem:'compras'},
      {_id:'p6',numeroAta:'00108/2026',uasg:'153167',processo:'23040.000065/2026-30',numeroCompra:'90010',anoCompra:'2026',objeto:'Gêneros alimentícios',responsavel:'Juliana Costa',vigenciaInicio:'2026-07-24',vigenciaFim:'',origem:'manual'},
      {_id:'p7',numeroAta:'00042/2026',uasg:'153167',processo:'23040.000032/2026-10',numeroCompra:'90002',anoCompra:'2026',objeto:'Veículos administrativos',responsavel:'Paulo Henrique',vigenciaInicio:'2025-03-15',vigenciaFim:'2026-03-15',origem:'compras'},
      {_id:'p8',numeroAta:'00038/2026',uasg:'153167',processo:'23040.000028/2026-61',numeroCompra:'90001',anoCompra:'2026',objeto:'Serviços de manutenção predial',responsavel:'Mariana Ribeiro',vigenciaInicio:'2025-02-01',vigenciaFim:'2026-02-01',origem:'compras'}
    ];
  }

  function toggleEntradas() {
    ['hdr-atas-item','hdr-atas-sep','desktop-atas'].forEach(function (id) { var x=el(id); if(x)x.hidden=!state.enabled; });
    var procBtn=el('btn-ata-proc'); if(procBtn)procBtn.hidden=!state.enabled;
  }

  function init() {
    if (localPreview()) {
      state.enabled=true; state.loaded=true; state.podeGerirTodas=true; state.preview=true; state.atas=previewData(); state.consultadoEm=new Date().toISOString();
      state.alertas=[{_id:'av1',ataId:'p2',numeroAta:'00987/2026',objeto:'Equipamentos de informática',responsavel:'Carla Mendes',marcoDias:60},{_id:'av2',ataId:'p7',numeroAta:'00042/2026',objeto:'Veículos administrativos',responsavel:'Paulo Henrique',marcoDias:0}];
      root.SERVIDOR='Adm Geral'; root.SESSAO_CHEFE=true; root.SESSAO_ADMIN=true;
      var login=el('tela-login'), app=el('app'); if(login)login.hidden=true; if(app)app.hidden=false;
      if(el('hdr-nome'))el('hdr-nome').textContent='Adm Geral';
      toggleEntradas(); atualizarAvisos(); root.switchTab('atas');
      if (/(?:\?|&)previewTrigger=1(?:&|$)/.test(location.search)) {
        setTimeout(function(){ if(typeof root.aplicarTriggerStatus_==='function')root.aplicarTriggerStatus_({instalado:false}); }, 0);
      }
      return;
    }
    if (!root.AUTH_TOKEN || !root.google || !google.script) return;
    // Evita o item desaparecer no menu enquanto a consulta de habilitação ainda
    // está carregando em conexões móveis. O backend continua sendo a confirmação
    // definitiva e volta a ocultá-lo se a unidade não estiver habilitada.
    if (unidadePilotoConhecida()) { state.enabled=true; state.checking=true; toggleEntradas(); }
    google.script.run.withSuccessHandler(function (r) {
      state.enabled=!!(r&&r.enabled); state.loaded=true; state.atas=(r&&r.atas)||[]; state.alertas=(r&&r.alertas)||[];
      state.checking=false; state.podeGerirTodas=!!(r&&r.podeGerirTodas); state.consultadoEm=r&&r.consultadoEm; toggleEntradas();
      if(state.enabled){atualizarAvisos(); if(el('tab-atas')&&!el('tab-atas').hidden)render();}
    }).withFailureHandler(function(){state.checking=false;state.enabled=false;toggleEntradas();}).getGestaoAtasApp(root.AUTH_TOKEN);
  }

  function carregar(force) {
    if (!state.enabled) return;
    if (localPreview()) { render(); return; }
    if(state.loading)return; if(state.loaded&&!force){render();return;} state.loading=true; renderLoading();
    google.script.run.withSuccessHandler(function(r){state.loading=false;if(r&&r.ok){state.atas=r.atas||[];state.alertas=r.alertas||[];state.podeGerirTodas=!!r.podeGerirTodas;state.consultadoEm=r.consultadoEm;state.loaded=true;render();atualizarAvisos();}else renderError(r&&r.erro);})
      .withFailureHandler(function(x){state.loading=false;renderError(x.message||x);}).getGestaoAtasApp(root.AUTH_TOKEN);
  }

  function renderLoading(){var c=el('tab-atas');if(c)c.innerHTML='<div class="atas-shell"><div class="atas-loading">Carregando a gestão de atas…</div></div>';}
  function renderError(msg){var c=el('tab-atas');if(c)c.innerHTML='<div class="atas-shell"><div class="atas-error"><strong>Não foi possível carregar as atas</strong>'+e(msg||'Tente novamente.')+'<br><button class="atas-primary" style="margin-top:14px" onclick="carregarGestaoAtas_(true)">Tentar novamente</button></div></div>';}
  function options(lista, atual){return '<option value="">Todos</option>'+lista.map(function(x){return '<option '+(x===atual?'selected':'')+'>'+e(x)+'</option>';}).join('');}

  function render(){
    var c=el('tab-atas');if(!c)return;
    var fs={situacao:val('ata-f-situacao'),responsavel:val('ata-f-resp'),ano:val('ata-f-ano'),busca:val('ata-f-busca')};
    var lista=D.filtrarAtas(state.atas,fs); var k=D.kpis(state.atas); var resps=Array.from(new Set(state.atas.map(function(a){return a.responsavel;}).filter(Boolean))).sort(); var anos=Array.from(new Set(state.atas.map(function(a){return String(a.anoAta||'');}).filter(Boolean))).sort().reverse();
    var totalPaginas=Math.max(1,Math.ceil(lista.length/state.pageSize));state.page=Math.min(Math.max(1,state.page),totalPaginas);var inicio=(state.page-1)*state.pageSize;var listaPagina=lista.slice(inicio,inicio+state.pageSize);
    var sync=state.consultadoEm?new Date(state.consultadoEm).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'ainda não realizada';
    var h='<div class="atas-shell"><div class="atas-breadcrumb">Contratações &nbsp;›&nbsp; Gestão de Atas</div><div class="atas-head"><div><h1 class="atas-title">Gestão de Atas</h1><div class="atas-subtitle">SEL/SEPMA &nbsp;·&nbsp; Controle de vigências e responsáveis da unidade</div></div><div class="atas-head-actions"><div class="atas-sync">Última consulta: '+e(sync)+'<br>Compras.gov.br somente leitura</div><button class="atas-primary" onclick="abrirCadastroAta_()">Cadastrar ata</button></div></div>';
    h+='<div class="atas-kpis"><div class="atas-kpi" style="--kpi-color:#22c55e"><div class="atas-kpi-value">'+k.ativas+'</div><div class="atas-kpi-label">Ativas</div></div><div class="atas-kpi" style="--kpi-color:#eab308"><div class="atas-kpi-value">'+k.vencendo90+'</div><div class="atas-kpi-label">Vencendo em 90 dias</div></div><div class="atas-kpi" style="--kpi-color:#3b82f6"><div class="atas-kpi-value">'+k.aguardando+'</div><div class="atas-kpi-label">Aguardando dados</div></div><div class="atas-kpi" style="--kpi-color:#ef4444"><div class="atas-kpi-value">'+k.vencidas+'</div><div class="atas-kpi-label">Atas vencidas</div></div></div>';
    h+='<div class="atas-filters"><div class="atas-field"><label>Situação</label><select id="ata-f-situacao" class="atas-filter" onchange="renderGestaoAtas_()"><option value="">Todas</option><option value="ativa" '+(fs.situacao==='ativa'?'selected':'')+'>Ativas</option><option value="vencendo" '+(fs.situacao==='vencendo'?'selected':'')+'>Vencendo</option><option value="aguardando" '+(fs.situacao==='aguardando'?'selected':'')+'>Aguardando dados</option><option value="vencida" '+(fs.situacao==='vencida'?'selected':'')+'>Vencidas</option></select></div><div class="atas-field"><label>Responsável</label><select id="ata-f-resp" class="atas-filter" onchange="renderGestaoAtas_()">'+options(resps,fs.responsavel)+'</select></div><div class="atas-field"><label>Ano da ata</label><select id="ata-f-ano" class="atas-filter" onchange="renderGestaoAtas_()">'+options(anos,fs.ano)+'</select></div><div class="atas-field atas-field-search"><label>Pesquisar</label><input id="ata-f-busca" class="atas-filter" type="search" value="'+e(fs.busca)+'" placeholder="Ata, processo, compra, objeto ou responsável" oninput="renderGestaoAtas_()"></div><button class="atas-clear" onclick="limparFiltrosAtas_()">Limpar filtros</button></div>';
    if(!lista.length)h+='<div class="atas-table-wrap"><div class="atas-empty"><strong>Nenhuma ata encontrada</strong>Ajuste os filtros ou cadastre a primeira ata da unidade.</div></div>';
    else{h+='<div class="atas-table-wrap"><table class="atas-table"><thead><tr><th>Ata</th><th>Processo / Compra</th><th>Objeto</th><th>Responsável</th><th>Vigência</th><th>Situação</th><th>Ações</th></tr></thead><tbody>';listaPagina.forEach(function(a){var s=D.situacaoAta(a);h+='<tr><td><span class="atas-number">'+e(a.numeroAta)+'</span><span class="atas-muted">UASG '+e(a.uasg||'153167')+'</span></td><td>'+e(a.processo||'—')+'<span class="atas-muted">'+(a.numeroCompra?'Compra '+e(a.numeroCompra+'/'+(a.anoCompra||'')):'Cadastro manual')+'</span></td><td>'+e(a.objeto||'—')+'</td><td>'+e(a.responsavel||'—')+'</td><td>'+e(D.formatarDataBR(a.vigenciaInicio))+'<span class="atas-muted">a '+e(D.formatarDataBR(a.vigenciaFim))+'</span></td><td><span class="atas-status atas-status-'+s.codigo+'">'+e(s.rotulo)+'</span></td><td><div class="atas-actions"><button class="atas-action" onclick="abrirDetalheAta_(\''+e(a._id)+'\')">Ver</button></div></td></tr>';});h+='</tbody></table></div><div class="atas-pagination"><span>Exibindo '+(inicio+1)+'–'+Math.min(inicio+listaPagina.length,lista.length)+' de '+lista.length+' atas filtradas</span><div class="atas-pages"><button onclick="mudarPaginaAtas_('+(state.page-1)+')" '+(state.page===1?'disabled':'')+'>‹</button><span>'+state.page+' / '+totalPaginas+'</span><button onclick="mudarPaginaAtas_('+(state.page+1)+')" '+(state.page===totalPaginas?'disabled':'')+'>›</button></div></div>';}
    c.innerHTML=h+'</div>';
  }

  function limparFiltros(){['ata-f-situacao','ata-f-resp','ata-f-ano','ata-f-busca'].forEach(function(id){if(el(id))el(id).value='';});state.page=1;render();}
  function mudarPagina(pagina){state.page=pagina;render();var c=el('tab-atas');if(c)c.scrollIntoView({behavior:'smooth',block:'start'});}
  function setMode(mode){state.mode=mode;el('ata-mode-compras').classList.toggle('active',mode==='compras');el('ata-mode-manual').classList.toggle('active',mode==='manual');el('ata-form-compras').hidden=mode!=='compras';el('ata-form-manual').hidden=mode!=='manual';el('ata-modal-save').textContent=mode==='compras'?'Adicionar selecionadas':'Salvar ata';}
  function abrirCadastro(prefill){state.prefill=prefill||null;state.resultados=[];el('ata-resultados').innerHTML='';el('ata-cad-titulo').textContent=prefill?'Adicionar ata deste processo':'Adicionar ata ao controle';['ata-compra','ata-ano-compra','ata-processo','ata-manual-numero','ata-manual-ano','ata-manual-inicio','ata-manual-fim','ata-observacao'].forEach(function(id){if(el(id))el(id).value='';});if(prefill){el('ata-processo').value=prefill.num||prefill.id||'';el('ata-responsavel').value=prefill.servidorExt||root.SERVIDOR||'';el('ata-objeto').value=prefill.nome||'';}else{el('ata-responsavel').value=root.SERVIDOR||'';el('ata-objeto').value='';}setMode('compras');el('ov-ata-cad').classList.add('open');el('modal-ata-cad').classList.add('open');}
  function fecharCadastro(){el('ov-ata-cad').classList.remove('open');el('modal-ata-cad').classList.remove('open');}
  function consultar(){var btn=el('ata-consultar');btn.disabled=true;btn.textContent='Consultando…';el('ata-resultados').innerHTML='<div class="atas-loading">Consultando o Compras.gov.br…</div>';google.script.run.withSuccessHandler(function(r){btn.disabled=false;btn.textContent='Consultar';state.resultados=(r&&r.atas)||[];renderResultados();}).withFailureHandler(function(x){btn.disabled=false;btn.textContent='Consultar';el('ata-resultados').innerHTML='<div class="atas-error">'+e(x.message||x)+'</div>';}).consultarAtasComprasApp({uasg:'153167',numeroCompra:val('ata-compra'),anoCompra:val('ata-ano-compra'),processo:val('ata-processo')},root.AUTH_TOKEN);}
  function renderResultados(){var c=el('ata-resultados');if(!state.resultados.length){c.innerHTML='<div class="atas-empty" style="padding:24px"><strong>Nenhuma ata encontrada</strong>Confira os dados ou use o cadastro manual.</div>';return;}c.innerHTML='<div class="atas-modal-card">'+state.resultados.map(function(a,i){return '<label class="atas-result"><input type="checkbox" name="ata-oficial" value="'+i+'"><span class="atas-result-main"><span class="atas-result-title">Ata '+e(a.numeroAta)+'</span><span class="atas-muted">Compra '+e(a.numeroCompra+'/'+a.anoCompra)+' · '+e(D.formatarDataBR(a.vigenciaInicio))+' a '+e(D.formatarDataBR(a.vigenciaFim))+'</span><span class="atas-muted">'+e(a.objeto||'Objeto não informado')+'</span></span></label>';}).join('')+'</div>';}
  function payloadInterno(){return{processoId:state.prefill&&state.prefill.id||'',processo:val('ata-processo'),objeto:val('ata-objeto'),responsavel:val('ata-responsavel'),observacao:val('ata-observacao')};}
  function salvar(){if(localPreview()){fecharCadastro();if(root.toast)root.toast('Prévia: cadastro não gravado.','ok');return;}var base=payloadInterno(),lista=[];if(state.mode==='compras'){document.querySelectorAll('input[name="ata-oficial"]:checked').forEach(function(x){lista.push(Object.assign({},state.resultados[Number(x.value)],base,{origem:'compras'}));});if(!lista.length){root.toast('Selecione ao menos uma ata.','err');return;}}else{lista.push(Object.assign(base,{origem:'manual',numeroAta:val('ata-manual-numero'),anoAta:val('ata-manual-ano'),uasg:'153167',numeroCompra:val('ata-compra'),anoCompra:val('ata-ano-compra'),dataAssinatura:val('ata-manual-assinatura'),vigenciaInicio:val('ata-manual-inicio'),vigenciaFim:val('ata-manual-fim')}));}var btn=el('ata-modal-save');btn.disabled=true;btn.textContent='Salvando…';var i=0;function next(){if(i>=lista.length){btn.disabled=false;fecharCadastro();state.loaded=false;carregar(true);root.toast('Ata adicionada ao controle.','ok');return;}google.script.run.withSuccessHandler(function(r){if(!r||!r.ok){btn.disabled=false;btn.textContent='Salvar ata';root.toast('Erro: '+(r&&r.erro||'Falha ao salvar.'),'err');return;}i++;next();}).withFailureHandler(function(x){btn.disabled=false;btn.textContent='Salvar ata';root.toast('Erro: '+(x.message||x),'err');}).salvarAtaApp(lista[i],root.AUTH_TOKEN);}next();}
  function abrirDetalhe(id){var a=state.atas.find(function(x){return x._id===id;});if(!a)return;state.selected=a;el('ata-det-title').textContent='Ata '+a.numeroAta;var s=D.situacaoAta(a);el('ata-det-body').innerHTML='<div class="atas-official">'+(a.origem==='compras'?'Dados oficiais consultados no Compras.gov.br. Somente os campos internos podem ser alterados.':'Cadastro manual. Datas podem ser ajustadas até a vinculação oficial.')+'</div><div class="atas-detail-list"><div class="atas-detail-item"><span>Processo</span><strong>'+e(a.processo||'—')+'</strong></div><div class="atas-detail-item"><span>Compra</span><strong>'+e(a.numeroCompra?(a.numeroCompra+'/'+a.anoCompra):'—')+'</strong></div><div class="atas-detail-item"><span>Objeto</span><strong>'+e(a.objeto||'—')+'</strong></div><div class="atas-detail-item"><span>Situação</span><strong>'+e(s.rotulo)+'</strong></div><div class="atas-detail-item"><span>Vigência inicial</span><strong>'+e(D.formatarDataBR(a.vigenciaInicio))+'</strong></div><div class="atas-detail-item"><span>Vigência final</span><strong>'+e(D.formatarDataBR(a.vigenciaFim))+'</strong></div></div><div class="form-group"><label class="form-label">Responsável interno</label><input id="ata-det-resp" class="field-input" value="'+e(a.responsavel||'')+'" '+(podeEditar(a)?'':'disabled')+'></div><div class="form-group"><label class="form-label">Observação interna</label><textarea id="ata-det-obs" class="field-input" rows="4" '+(podeEditar(a)?'':'disabled')+'>'+e(a.observacao||'')+'</textarea></div>'+(a.linkPncp?'<a href="'+e(a.linkPncp)+'" target="_blank" rel="noopener" class="atas-action" style="display:inline-block;text-decoration:none">Consultar registro oficial</a>':'');el('ata-det-save').hidden=!podeEditar(a);el('ov-ata-det').classList.add('open');el('modal-ata-det').classList.add('open');}
  function fecharDetalhe(){el('ov-ata-det').classList.remove('open');el('modal-ata-det').classList.remove('open');}
  function salvarDetalhe(){if(localPreview()){fecharDetalhe();return;}var a=state.selected;google.script.run.withSuccessHandler(function(r){if(r&&r.ok){fecharDetalhe();state.loaded=false;carregar(true);root.toast('Alterações salvas.','ok');}else root.toast('Erro: '+(r&&r.erro||''),'err');}).withFailureHandler(function(x){root.toast('Erro: '+(x.message||x),'err');}).atualizarAtaInternaApp({id:a._id,responsavel:val('ata-det-resp'),observacao:val('ata-det-obs')},root.AUTH_TOKEN);}
  function atualizarAvisos(){if(!state.enabled)return;root.NOTIF=root.NOTIF||{};root.NOTIF.atas=state.alertas||[];if(typeof root.atualizarBadgeNotif_==='function')root.atualizarBadgeNotif_();}
  function renderEquipePreview(){var plan=el('cfg-planejamento-card');root.SERV_DATA=[{nome:'Amanda',matricula:'3419547',email:'amandacarlaxx@gmail.com',cor:'#db2777',isChefe:true},{nome:'Beatriz',matricula:'3307673',email:'beatrizgoes@cp2.g12.br',cor:'#7c3aed',isChefe:false},{nome:'Bruno',matricula:'3118336',email:'br8unocesar@gmail.com',cor:'#ea580c',isChefe:false},{nome:'Samuel',matricula:'3469772',email:'samuelg.silva07@gmail.com',cor:'#0891b2',isChefe:false}];root.EMAILS_CACHE={Amanda:'amandacarlaxx@gmail.com',Beatriz:'beatrizgoes@cp2.g12.br',Bruno:'br8unocesar@gmail.com',Samuel:'samuelg.silva07@gmail.com'};if(typeof root.renderEquipeConfig_==='function')root.renderEquipeConfig_();if(plan)plan.innerHTML='<div class="team-plan-summary"><div class="team-plan-stat"><span>Disponíveis hoje</span><b>4/4</b></div><div class="team-plan-stat"><span>Ausentes hoje</span><b>0</b></div><div class="team-plan-stat"><span>Programados</span><b>1</b></div></div><div class="team-plan-list"><div class="team-plan-item"><span class="team-plan-mark"></span><div class="team-plan-copy"><strong>Bruno · Férias</strong><span>Programado · 05/10/2026 a 19/10/2026</span></div></div></div><div class="team-plan-actions"><button class="btn-cfg" onclick="abrirAusencias_()">Ver planejamento completo</button></div>';}
  function carregarAlertas(){if(!state.enabled||localPreview())return;google.script.run.withSuccessHandler(function(r){if(r&&r.ok){state.alertas=r.alertas||[];atualizarAvisos();var p=el('notif-panel');if(p&&!p.hidden&&root.NOTIF_SCOPE==='atas')renderAvisos();}}).withFailureHandler(function(){}).getAlertasAtasApp(root.AUTH_TOKEN);}
  function renderAvisos(){var c=el('notif-body');var lista=state.alertas||[];if(!lista.length){c.innerHTML='<div class="notif-empty">Nenhum aviso de ata no momento.</div>';return;}c.innerHTML=lista.map(function(a){var venc=Number(a.marcoDias)===0;return '<button class="notif-ata '+(venc?'vencida':'')+'" onclick="abrirAvisoAta_(\''+e(a._id)+'\',\''+e(a.ataId)+'\')"><strong>Ata '+e(a.numeroAta)+' · '+(venc?'vencida':'marco de '+e(a.marcoDias)+' dias')+'</strong><span>'+e(a.objeto||a.processo||'')+' · '+e(a.responsavel||'')+'</span></button>';}).join('');}
  function abrirAviso(avisoId,ataId){state.alertas=state.alertas.filter(function(a){return a._id!==avisoId;});atualizarAvisos();if(!localPreview())google.script.run.marcarAlertaAtaLidoApp(avisoId,root.AUTH_TOKEN);if(typeof root.fecharNotif_==='function')root.fecharNotif_();root.switchTab('atas');setTimeout(function(){abrirDetalhe(ataId);},50);}

  root.inicializarGestaoAtas_=init; root.carregarGestaoAtas_=carregar; root.renderGestaoAtas_=render; root.limparFiltrosAtas_=limparFiltros; root.mudarPaginaAtas_=mudarPagina;
  root.abrirCadastroAta_=abrirCadastro; root.abrirCadastroAtaDoProcesso_=abrirCadastro; root.fecharCadastroAta_=fecharCadastro; root.setModoCadastroAta_=setMode; root.consultarAtasCompras_=consultar; root.salvarCadastroAta_=salvar;
  root.abrirDetalheAta_=abrirDetalhe; root.fecharDetalheAta_=fecharDetalhe; root.salvarDetalheAta_=salvarDetalhe; root.renderNotifAtas_=renderAvisos; root.abrirAvisoAta_=abrirAviso; root.carregarAlertasAtas_=carregarAlertas; root.renderEquipePreview_=renderEquipePreview;
  document.addEventListener('keydown',function(ev){if(ev.key!=='Escape')return;if(el('modal-ata-det')&&el('modal-ata-det').classList.contains('open'))fecharDetalhe();else if(el('modal-ata-cad')&&el('modal-ata-cad').classList.contains('open'))fecharCadastro();});
  document.addEventListener('DOMContentLoaded',function(){if(localPreview())setTimeout(init,80);});
})(window);
