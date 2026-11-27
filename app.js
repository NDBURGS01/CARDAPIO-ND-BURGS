/* ND BURGS GESTÃO — frontend inicial. Configure SUPABASE_URL e SUPABASE_ANON_KEY. */
const SUPABASE_URL = "COLOQUE_A_URL_DO_SEU_SUPABASE";
const SUPABASE_ANON_KEY = "COLOQUE_A_CHAVE_PUBLICAVEL_DO_SUPABASE";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser=null, profile=null, orders=[], refreshTimer=null;
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s)), money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roleName={admin:'ADMIN',attendant:'ATENDIMENTO',stock:'SABRINA',driver:'MOTOBOY'};
const statusName={received:'RECEBIDO',preparing:'EM PREPARO',ready:'PRONTO',out_for_delivery:'EM ENTREGA',delivered:'ENTREGUE',cancelled:'CANCELADO'};
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
function can(...roles){return roles.includes(profile?.role)}
function showLogin(){ $('#loginView').classList.remove('hidden');$('#appView').classList.add('hidden'); }
async function boot(){
 const {data:{session}}=await sb.auth.getSession();
 if(!session){showLogin();return}
 currentUser=session.user;
 const {data:p,error}=await sb.from('profiles').select('*').eq('id',currentUser.id).single();
 if(error||!p||!p.active){await sb.auth.signOut();$('#loginError').textContent='Perfil não cadastrado ou desativado. Peça acesso ao ADMIN.';showLogin();return}
 profile=p; $('#userName').textContent=p.full_name||currentUser.email;$('#userRole').textContent=roleName[p.role]||p.role.toUpperCase();
 $('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');
 document.querySelectorAll('[data-roles]').forEach(el=>{el.classList.toggle('hidden',!el.dataset.roles.split(',').includes(profile.role))});
 await loadPage('dashboard'); subscribeOrders();
}
async function loadOrders(){
 const {data,error}=await sb.from('orders').select('*,order_items(*)').order('created_at',{ascending:false}).limit(250);
 if(error)throw error; orders=data||[];$('#ordersCount').textContent=orders.filter(o=>!['delivered','cancelled'].includes(o.status)).length;
}
function pageTitle(p){return ({dashboard:'VISÃO GERAL',orders:'PEDIDOS',routes:'ROTAS',drivers:'MOTOBOYS',stock:'ESTOQUE',finance:'FINANCEIRO',fees:'TAXAS DE ENTREGA',reports:'RELATÓRIOS',settings:'CONFIGURAÇÕES'})[p]||'ND BURGS'}
async function loadPage(page){
 const allowed={admin:['dashboard','orders','routes','drivers','stock','finance','fees','reports','settings'],attendant:['dashboard','orders','routes','drivers','fees'],stock:['dashboard','stock'],driver:['dashboard','orders','routes','drivers']};
 if(!(allowed[profile?.role]||[]).includes(page))return toast('SEU PERFIL NÃO TEM ACESSO A ESTA ÁREA');
 if(page==='finance'&&!can('admin'))return toast('ACESSO RESTRITO AO ADMIN');
 if(page==='reports'&&!can('admin'))return toast('ACESSO RESTRITO AO ADMIN');
 if(page==='settings'&&!can('admin'))return toast('ACESSO RESTRITO AO ADMIN');
 if(page==='fees'&&!can('admin','attendant'))return toast('ACESSO RESTRITO');
 document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
 $('#pageTitle').textContent=pageTitle(page);
 try{await loadOrders();}catch(e){toast('Falha ao carregar pedidos: '+e.message)}
 const root=$('#pageContent');
 if(page==='dashboard')root.innerHTML=dashboard();
 if(page==='orders')root.innerHTML=ordersPage();
 if(page==='routes')root.innerHTML=routesPage();
 if(page==='drivers')root.innerHTML=driversPage();
 if(page==='stock')await renderStock(root);
 if(page==='finance')await renderFinance(root);
 if(page==='fees')await renderFees(root);
 if(page==='reports')root.innerHTML=reportsPage();
 if(page==='settings')await renderSettings(root);
 bindPage(page);
}
function dashboard(){
 const open=orders.filter(o=>!['delivered','cancelled'].includes(o.status));
 const delivered=orders.filter(o=>o.status==='delivered');
 const total=delivered.reduce((s,o)=>s+Number(o.total||0),0);
 return `<div class="grid">
 <div class="metric"><small>PEDIDOS EM ABERTO</small><strong>${open.length}</strong><em>Pedidos ativos</em></div>
 <div class="metric"><small>ENTREGUES (CARREGADOS)</small><strong>${delivered.length}</strong><em>Últimos 250 pedidos</em></div>
 <div class="metric"><small>VENDAS ENTREGUES</small><strong>${money(total)}</strong><em>Valor bruto dos pedidos carregados</em></div>
 <div class="metric"><small>PERFIL ATUAL</small><strong>${roleName[profile.role]||profile.role}</strong><em>Permissões por função</em></div></div>
 <div class="section-head"><h3>ÚLTIMOS PEDIDOS</h3><button class="small-btn" data-go="orders">ABRIR PEDIDOS →</button></div>${recentTable(orders.slice(0,8))}
 <p class="note">Os indicadores acima usam os últimos 250 pedidos carregados. O financeiro oficial deve ser conferido pela tela de fechamento do expediente.</p>`;
}
function recentTable(rows){if(!rows.length)return '<div class="empty">Nenhum pedido encontrado.</div>';return `<div class="table-wrap"><table><thead><tr><th>PEDIDO</th><th>CLIENTE</th><th>ENDEREÇO</th><th>STATUS</th><th>TOTAL</th></tr></thead><tbody>${rows.map(o=>`<tr><td><strong>#${esc(o.order_number||o.id.slice(0,8))}</strong></td><td>${esc(o.customer_name)}</td><td>${esc(o.address||'RETIRADA')}</td><td>${pill(o.status)}</td><td>${money(o.total)}</td></tr>`).join('')}</tbody></table></div>`}
function pill(s){let c=['delivered'].includes(s)?'green':['cancelled'].includes(s)?'red':['out_for_delivery','ready'].includes(s)?'orange':'';return `<span class="pill ${c}">${esc(statusName[s]||s||'—')}</span>`}
function ordersPage(){const groups=['received','preparing','ready','out_for_delivery'];return `<div class="section-head"><h3>QUADRO DE PEDIDOS</h3><div class="toolbar"><input id="orderSearch" placeholder="Buscar cliente, pedido ou rua"><button class="small-btn" id="reloadOrders">ATUALIZAR</button></div></div><div class="kanban">${groups.map(g=>`<section class="lane"><h4>${statusName[g]} · ${orders.filter(o=>o.status===g).length}</h4>${orders.filter(o=>o.status===g).map(orderCard).join('')||'<div class="empty">Sem pedidos</div>'}</section>`).join('')}</div><div class="section-head"><h3>HISTÓRICO RECENTE</h3></div>${recentTable(orders.filter(o=>['delivered','cancelled'].includes(o.status)).slice(0,30))}`}
function orderCard(o){return `<article class="order-card" data-order="${o.id}"><b>#${esc(o.order_number||o.id.slice(0,8))} · ${esc(o.customer_name)}</b><p>${esc(o.address||'RETIRADA')}<br>${esc(o.payment_method||'')} · ${money(o.total)}</p><div class="actions">${o.status==='received'?`<button class="small-btn" data-status="preparing" data-id="${o.id}">PREPARO</button>`:''}${o.status==='preparing'?`<button class="small-btn" data-status="ready" data-id="${o.id}">PRONTO</button>`:''}${o.status==='ready'?`<button class="small-btn" data-status="out_for_delivery" data-id="${o.id}">SAIU</button>`:''}${o.status==='out_for_delivery'?`<button class="small-btn" data-status="delivered" data-id="${o.id}">CHEGOU</button>`:''}</div></article>`}
function routesPage(){const list=orders.filter(o=>['ready','out_for_delivery'].includes(o.status));return `<div class="section-head"><h3>ENTREGAS PARA ORGANIZAR</h3><span class="pill orange">${list.length} PEDIDOS</span></div>${recentTable(list)}<div class="panel" style="margin-top:14px"><h3>MAPA DE OPERAÇÃO</h3><p class="note">O mapa será preenchido com as coordenadas GPS autorizadas dos motoboys e endereços geocodificados. Por segurança, não inventamos posições nem rotas.</p><div class="map-frame" style="display:grid;place-items:center;color:#8d9b90">MAPA — AGUARDANDO LOCALIZAÇÕES E COORDENADAS</div></div>`}
function driversPage(){return `<div class="section-head"><h3>LOCALIZAÇÃO E EQUIPE</h3><button class="small-btn" id="loadLocations">ATUALIZAR LOCALIZAÇÕES</button></div><div id="driverList" class="panel"><div class="empty">Carregando localizações...</div></div><p class="note">O perfil MOTOBOY pode enviar sua posição enquanto estiver autenticado e com permissão de localização no aparelho.</p>`}
function stockPage(rows){return `<div class="section-head"><h3>INVENTÁRIO</h3><button class="small-btn" id="addStock">+ NOVO ITEM</button></div><div class="table-wrap"><table><thead><tr><th>ITEM</th><th>QUANTIDADE</th><th>UNIDADE</th><th>AÇÕES</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.quantity}</td><td>${esc(x.unit||'un')}</td><td><div class="actions"><button class="small-btn" data-stock="-1" data-id="${x.id}">−</button><button class="small-btn" data-stock="1" data-id="${x.id}">+</button></div></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Estoque vazio</td></tr>'}</tbody></table></div>`}
async function renderStock(root){const {data,error}=await sb.from('inventory_items').select('*').order('name');if(error){root.innerHTML=`<div class="panel error">${esc(error.message)}</div>`;return}root.innerHTML=stockPage(data||[])}
async function renderFinance(root){const today=new Date();today.setHours(0,0,0,0);const {data,error}=await sb.from('orders').select('total,payment_method,status,created_at').gte('created_at',today.toISOString()).eq('status','delivered');if(error){root.innerHTML=`<div class="panel error">${esc(error.message)}</div>`;return}const sums={PIX:0,DINHEIRO:0,CARTÃO:0};(data||[]).forEach(o=>{const k=String(o.payment_method||'').toUpperCase();if(k in sums)sums[k]+=Number(o.total||0)});root.innerHTML=`<div class="grid">${Object.entries(sums).map(([k,v])=>`<div class="metric"><small>${k}</small><strong>${money(v)}</strong><em>Pedidos entregues hoje</em></div>`).join('')}</div><div class="panel" style="margin-top:15px"><h3>FECHAMENTO DO EXPEDIENTE</h3><p class="note">Este quadro inicial soma pedidos entregues por data do calendário. A regra de vincular pedidos ao expediente iniciado precisa ser ativada com o processo de abertura/encerramento do turno antes de usar estes números como fechamento oficial.</p><button class="primary" id="startShift">INICIAR EXPEDIENTE</button> <button class="small-btn" id="endShift">ENCERRAR EXPEDIENTE</button></div>`}
async function renderFees(root){const {data,error}=await sb.from('delivery_fees').select('*').order('street_name');if(error){root.innerHTML=`<div class="panel error">${esc(error.message)}</div>`;return}root.innerHTML=`<div class="section-head"><h3>BASE ÚNICA DE TAXAS</h3><button class="small-btn" id="addFee">+ ADICIONAR RUA</button></div><div class="table-wrap"><table><thead><tr><th>RUA / TRECHO</th><th>REGIÃO</th><th>TAXA</th><th>AÇÃO</th></tr></thead><tbody>${(data||[]).map(f=>`<tr><td>${esc(f.street_name)}</td><td>${esc(f.region||'—')}</td><td>${money(f.fee)}</td><td><button class="small-btn" data-edit-fee="${f.id}">EDITAR</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty">Cadastre as taxas para iniciar.</td></tr>'}</tbody></table></div><p class="note">A loja e o painel devem consultar esta mesma tabela. Taxas não cadastradas não devem ser presumidas.</p>`}
function reportsPage(){return `<div class="panel"><h3>RELATÓRIOS</h3><p class="note">Os relatórios detalhados de lucro, custo de ingredientes, sangrias e fechamento por expediente dependem do cadastro de custos e dos movimentos financeiros. O resumo operacional atual está na Visão Geral.</p><button class="small-btn" id="exportOrders">EXPORTAR PEDIDOS CSV</button></div>`}
async function renderSettings(root){const {data}=await sb.from('profiles').select('id,full_name,role,active').order('full_name');root.innerHTML=`<div class="section-head"><h3>USUÁRIOS E PERMISSÕES</h3></div><div class="table-wrap"><table><thead><tr><th>NOME</th><th>PERFIL</th><th>ATIVO</th></tr></thead><tbody>${(data||[]).map(p=>`<tr><td>${esc(p.full_name||p.id)}</td><td>${esc(roleName[p.role]||p.role)}</td><td>${p.active?'SIM':'NÃO'}</td></tr>`).join('')}</tbody></table></div><p class="note">Criação de usuários: crie a conta em Supabase Authentication e depois associe o UUID na tabela profiles. Não compartilhe senhas pelo painel.</p>`}
function bindPage(page){
 $$('[data-go]').forEach(b=>b.onclick=()=>loadPage(b.dataset.go));
 $$('[data-status]').forEach(b=>b.onclick=()=>updateOrder(b.dataset.id,b.dataset.status));
 $('#reloadOrders')?.addEventListener('click',()=>loadPage('orders'));
 $('#orderSearch')?.addEventListener('input',e=>{$$('.order-card').forEach(c=>c.classList.toggle('hidden',!c.textContent.toLowerCase().includes(e.target.value.toLowerCase())))});
 $$('[data-stock]').forEach(b=>b.onclick=()=>adjustStock(b.dataset.id,Number(b.dataset.stock)));
 $('#addStock')?.addEventListener('click',addStock);
 $('#addFee')?.addEventListener('click',addFee);
 $$('[data-edit-fee]').forEach(b=>b.onclick=()=>editFee(b.dataset.editFee));
 $('#refreshBtn')?.addEventListener('click',()=>loadPage(page));
 $('#loadLocations')?.addEventListener('click',loadLocations);
 $('#exportOrders')?.addEventListener('click',exportOrders);
 $('#startShift')?.addEventListener('click',()=>toast('Configure a abertura de expediente no módulo de turnos antes do fechamento oficial.'));
 $('#endShift')?.addEventListener('click',()=>toast('Não há expediente oficial configurado nesta versão inicial.'));
}
async function updateOrder(id,status){const {error}=await sb.from('orders').update({status}).eq('id',id);if(error)return toast(error.message);toast('Pedido atualizado');await loadPage('orders')}
async function adjustStock(id,delta){const {data,error}=await sb.from('inventory_items').select('quantity').eq('id',id).single();if(error)return toast(error.message);const {error:e}=await sb.from('inventory_items').update({quantity:Math.max(0,Math.min(100,Number(data.quantity)+delta))}).eq('id',id);if(e)return toast(e.message);await loadPage('stock')}
async function addStock(){const name=prompt('Nome do item:');if(!name)return;const {error}=await sb.from('inventory_items').insert({name,quantity:0,unit:'un'});if(error)return toast(error.message);await loadPage('stock')}
async function addFee(){const street_name=prompt('Nome exato da rua/trecho:');if(!street_name)return;const value=prompt('Taxa em reais (ex.: 5.00):');if(value===null)return;const fee=Number(value.replace(',','.'));if(!Number.isFinite(fee)||fee<0)return toast('Valor inválido');const {error}=await sb.from('delivery_fees').insert({street_name,fee});if(error)return toast(error.message);await loadPage('fees')}
async function editFee(id){const {data}=await sb.from('delivery_fees').select('*').eq('id',id).single();if(!data)return;const value=prompt('Nova taxa em reais:',String(data.fee));if(value===null)return;const fee=Number(value.replace(',','.'));if(!Number.isFinite(fee)||fee<0)return toast('Valor inválido');const {error}=await sb.from('delivery_fees').update({fee}).eq('id',id);if(error)return toast(error.message);await loadPage('fees')}
async function loadLocations(){const {data,error}=await sb.from('driver_locations').select('*,profiles(full_name)').order('updated_at',{ascending:false});if(error)return toast(error.message);$('#driverList').innerHTML=(data||[]).map(x=>`<p><b>${esc(x.profiles?.full_name||'Motoboy')}</b> · ${new Date(x.updated_at).toLocaleString('pt-BR')} · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${x.latitude},${x.longitude}">ABRIR NO MAPS</a></p>`).join('')||'<div class="empty">Nenhuma localização recebida.</div>'}
function exportOrders(){const rows=[['pedido','cliente','telefone','endereco','status','pagamento','total'],...orders.map(o=>[o.order_number,o.customer_name,o.phone,o.address,o.status,o.payment_method,o.total])];const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='nd-burgs-pedidos.csv';a.click();URL.revokeObjectURL(a.href)}
function subscribeOrders(){sb.channel('nd-orders-live').on('postgres_changes',{event:'*',schema:'public',table:'orders'},()=>loadPage($('#pageTitle').textContent==='PEDIDOS'?'orders':'dashboard')).subscribe()}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';const {error}=await sb.auth.signInWithPassword({email:$('#email').value,password:$('#password').value});if(error){$('#loginError').textContent='Não foi possível entrar: '+error.message;return}await boot()});
$('#logoutBtn').addEventListener('click',async()=>{clearInterval(refreshTimer);await sb.auth.signOut();showLogin()});
$('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)loadPage(b.dataset.page)});
$('#menuToggle').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#refreshBtn').addEventListener('click',()=>loadPage($('#pageTitle').textContent.toLowerCase().replace('visão geral','dashboard').replace('taxas de entrega','fees').replace('pedidos','orders').replace('rotas','routes').replace('motoboys','drivers').replace('estoque','stock').replace('financeiro','finance').replace('relatórios','reports').replace('configurações','settings')));
boot().catch(e=>{console.error(e);showLogin()});
