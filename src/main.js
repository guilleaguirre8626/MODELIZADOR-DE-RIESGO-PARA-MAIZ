// Dependencias cargadas desde index.html como scripts UMD para máxima compatibilidad con GitHub Pages.
const createClient = window.supabase?.createClient;
const Chart = window.Chart;
const jsPDF = window.jspdf?.jsPDF;

if (!createClient) {
  document.getElementById('app').innerHTML = '<div class="login"><div class="card"><h2>No se pudo cargar Supabase</h2><p>Revisá tu conexión a internet y recargá la página.</p><button onclick="location.reload()" class="primary">Reintentar</button></div></div>';
  throw new Error('Supabase JS no disponible');
}

const SUPABASE_URL='https://sjuizodatqyfocjbbuqz.supabase.co';
const SUPABASE_KEY='sb_publishable_gDOi7KQI3cDnojCvqs8eIQ_Sm-VkjnS';
const sb=createClient(SUPABASE_URL,SUPABASE_KEY);
const DEFAULT_MODEL={version:'v0.1-priors',heat_weight:.4,cold_weight:.15,drought_weight:.25,excess_weight:.2,critical_days_before:15,critical_days_after:15,tmax_heat_c:35,tmin_cold_c:4};
const TEMP_MEAN={9:16.5,10:19.5,11:22,12:24.2,1:25,2:24,3:21.5,4:17.5};
const FALLBACK_PRIORS={'09-2':{heat:5,cold:8,drought:30,excess:15},'10-1':{heat:8,cold:4,drought:25,excess:20},'10-2':{heat:12,cold:2,drought:20,excess:22},'11-1':{heat:18,cold:1,drought:18,excess:25},'11-2':{heat:25,cold:1,drought:15,excess:28},'12-1':{heat:35,cold:.5,drought:15,excess:30},'12-2':{heat:45,cold:.5,drought:12,excess:32},'01-1':{heat:55,cold:.5,drought:12,excess:35},'01-2':{heat:60,cold:.5,drought:10,excess:35},'02-1':{heat:50,cold:2,drought:10,excess:30},'02-2':{heat:40,cold:3,drought:12,excess:25},'03-1':{heat:20,cold:8,drought:15,excess:20},'03-2':{heat:10,cold:15,drought:18,excess:18}};
const ENSO_FACTORS={Nino:{heat:1,cold:1,drought:1,excess:1},Neutral:{heat:1.04,cold:1,drought:1.15,excess:.88},Nina:{heat:1.10,cold:1,drought:1.35,excess:.72}};
let state={user:null,profile:null,users:[],hybrids:[],farms:[],fields:[],stations:[],priors:{},observed:[],phenObserved:[],hydricReady:false,phenProfiles:{CORE:{heat_weight:.50,drought_weight:.30,excess_weight:.15,cold_weight:.05,band_weight:.60},SHOULDER:{heat_weight:.40,drought_weight:.30,excess_weight:.20,cold_weight:.10,band_weight:.40}},model:{...DEFAULT_MODEL},history:[],tab:'dashboard',last:null,charts:[],recoveryMode:false};

const $=s=>document.querySelector(s); const app=()=>$('#app');
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function dparse(v){const [y,m,d]=v.split('-').map(Number);return new Date(Date.UTC(y,m-1,d))}
function iso(d){return d.toISOString().slice(0,10)} function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x}
function fmt(d){return new Intl.DateTimeFormat('es-AR').format(d)}
function fortnightKey(d){const m=String(d.getUTCMonth()+1).padStart(2,'0');return `${m}-${d.getUTCDate()<=15?'1':'2'}`}
function phaseDbLabel(v){return v==='Nino'?'El Niño':v==='Nina'?'La Niña':'Neutral'}
function normalizePhase(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()}
function clamp(v){return Math.max(0,Math.min(100,v))}
function validCoord(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180}
function snap025(v){return Math.round(Number(v)*4)/4}
function haversineKm(a,b,c,d){const R=6371,toRad=x=>x*Math.PI/180;const dLat=toRad(c-a),dLon=toRad(d-b);const q=Math.sin(dLat/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(dLon/2)**2;return 2*R*Math.asin(Math.sqrt(q))}
function nearestStation(lat,lon){if(!validCoord(lat,lon))return null;const available=new Set(state.observed.map(r=>String(r.station_id)));let best=null;for(const st of state.stations){if(!available.has(String(st.id)))continue;const slat=Number(st.latitude),slon=Number(st.longitude);if(!validCoord(slat,slon))continue;const km=haversineKm(lat,lon,slat,slon);if(!best||km<best.distanceKm)best={...st,distanceKm:km};}return best}
function requestLocation(onSuccess,statusEl){if(!navigator.geolocation){if(statusEl)statusEl.textContent='Este navegador no ofrece geolocalización.';return}if(statusEl)statusEl.textContent='Solicitando ubicación…';navigator.geolocation.getCurrentPosition(pos=>{const x={lat:pos.coords.latitude,lon:pos.coords.longitude,accuracy:pos.coords.accuracy};if(statusEl)statusEl.textContent=`Ubicación obtenida · precisión ±${Math.round(x.accuracy)} m`;onSuccess(x)},err=>{const msg=err.code===1?'Permiso de ubicación rechazado. Podés ingresar coordenadas manualmente.':'No se pudo obtener la ubicación. Podés ingresar coordenadas manualmente.';if(statusEl)statusEl.textContent=msg},{enableHighAccuracy:true,timeout:12000,maximumAge:60000})}

function riskClass(s){s=Number(s||0);if(s<20)return['Bajo','low'];if(s<35)return['Moderado','medium'];return['Alto','high']}
function clearCharts(){state.charts.forEach(c=>{try{c.destroy()}catch{}});state.charts=[]}

async function bootstrap(){
  const {data}=await sb.auth.getSession();
  state.user=data.session?.user||null;
  if(!state.user)return loginView();
  const access=await loadProfileAndCheckAccess();
  if(!access)return;
  await loadReference();
  await loadUserData();
  if(state.profile?.role==='admin')await loadUsers();
  render();
}
async function loadProfileAndCheckAccess(){
  const {data,error}=await sb.from('profiles').select('*').eq('id',state.user.id).maybeSingle();
  if(error){console.warn('Perfil:',error.message);return accessErrorView('No se pudo verificar la autorización de la cuenta. '+error.message),false;}
  if(!data){return accessErrorView('La cuenta existe en Auth pero no tiene perfil de acceso. Ejecutá el parche de usuarios en Supabase.'),false;}
  state.profile=data;
  if(data.blocked){await sb.auth.signOut();state.user=null;blockedView();return false;}
  if(!data.approved){pendingView();return false;}
  return true;
}
async function loadReference(){
  const [h,m,p,o,po,pp,st]=await Promise.all([
    sb.from('hybrids').select('*').eq('active',true).order('name'),
    sb.from('model_config').select('*').order('version',{ascending:false}).limit(1),
    sb.from('risk_priors').select('*').order('id'),
    sb.from('observed_risk_stats').select('*'),
    sb.from('observed_risk_stats_phenology').select('*'),
    sb.from('phenology_score_profiles').select('*').order('band'),
    sb.from('climate_stations').select('*').order('name')
  ]);
  if(h.data?.length)state.hybrids=h.data;
  if(m.data?.length)state.model={...DEFAULT_MODEL,...m.data[0]};
  if(p.data?.length){state.priors={};p.data.forEach(x=>state.priors[x.fortnight]={heat:Number(x.p_heat)*100,cold:Number(x.p_cold)*100,drought:Number(x.p_drought)*100,excess:Number(x.p_excess)*100});}else state.priors={...FALLBACK_PRIORS};
  state.observed=o.data||[];state.phenObserved=po.data||[];
  if(pp.data?.length){state.phenProfiles={};pp.data.forEach(x=>state.phenProfiles[x.band]={heat_weight:Number(x.heat_weight),drought_weight:Number(x.drought_weight),excess_weight:Number(x.excess_weight),cold_weight:Number(x.cold_weight),band_weight:Number(x.band_weight)});}
  state.stations=st.data||[];
  try{const {count}=await sb.from('daily_weather').select('*',{count:'exact',head:true}).not('eto_mm','is',null);state.hydricReady=Number(count||0)>1000;}catch{state.hydricReady=false;}
}
async function loadUserData(){
  const [fa,fi,hi]=await Promise.all([
    sb.from('farms').select('*').order('name'),
    sb.from('fields').select('*, farms(name,latitude,longitude)').order('name'),
    sb.from('simulations').select('*, hybrids(name,biotechnology)').order('created_at',{ascending:false}).limit(100)
  ]);
  state.farms=fa.data||[];state.fields=fi.data||[];state.history=hi.data||[];
}
async function loadUsers(){
  if(state.profile?.role!=='admin'){state.users=[];return;}
  const {data,error}=await sb.from('profiles').select('*').order('requested_at',{ascending:false});
  if(error){console.warn('Usuarios:',error.message);state.users=[];return;}
  state.users=data||[];
}
function authCard(inner){return `<div class="login"><div class="card"><div class="brand"><h1>Modelizador de Riesgo para Maíz</h1><p>Riesgo agroclimático y decisiones de siembra.</p></div>${inner}</div></div>`}
function loginView(message=''){
  app().innerHTML=authCard(`${message?`<div class="note">${esc(message)}</div>`:''}<form id="loginForm"><label class="label">Email</label><input id="email" type="email" autocomplete="email" required><label class="label">Contraseña</label><input id="password" type="password" autocomplete="current-password" minlength="6" required><div class="actions"><button class="primary">Ingresar</button><button id="signup" class="secondary" type="button">Crear cuenta</button></div><button id="forgot" class="link-button" type="button">¿Olvidaste tu contraseña?</button></form><div class="note"><b>Acceso administrado.</b><br>Las cuentas nuevas quedan pendientes hasta ser autorizadas por el administrador.</div>`);
  $('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const {data,error}=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error)return alert(error.message);state.user=data.user;await bootstrap();});
  $('#signup').addEventListener('click',registerView);
  $('#forgot').addEventListener('click',forgotPasswordView);
}
function registerView(){
  app().innerHTML=authCard(`<button id="backLogin" class="ghost" type="button">← Volver</button><h2>Crear cuenta</h2><p class="muted">Después de validar el email, la cuenta quedará pendiente de aprobación.</p><form id="registerForm"><label class="label">Nombre y apellido</label><input id="regName" required autocomplete="name"><label class="label">Email</label><input id="regEmail" type="email" required autocomplete="email"><label class="label">Contraseña</label><input id="regPassword" type="password" minlength="6" required autocomplete="new-password"><label class="label">Repetir contraseña</label><input id="regPassword2" type="password" minlength="6" required autocomplete="new-password"><button class="primary" style="margin-top:14px">Solicitar cuenta</button></form><div id="regMsg"></div>`);
  $('#backLogin').addEventListener('click',()=>loginView());
  $('#registerForm').addEventListener('submit',async e=>{e.preventDefault();const p=$('#regPassword').value;if(p!==$('#regPassword2').value)return alert('Las contraseñas no coinciden.');const redirectTo=location.origin+location.pathname;const {data,error}=await sb.auth.signUp({email:$('#regEmail').value.trim(),password:p,options:{emailRedirectTo:redirectTo,data:{full_name:$('#regName').value.trim()}}});if(error)return alert(error.message);$('#regMsg').innerHTML='<div class="note"><b>Solicitud creada.</b><br>Revisá tu correo si Supabase solicita confirmar el email. Luego la cuenta quedará pendiente de aprobación del administrador.</div>';if(data.session){state.user=data.user;setTimeout(()=>bootstrap(),800);}});
}
function forgotPasswordView(){
  app().innerHTML=authCard(`<button id="backLogin" class="ghost" type="button">← Volver</button><h2>Recuperar contraseña</h2><p class="muted">Te enviaremos un enlace para definir una nueva contraseña.</p><form id="forgotForm"><label class="label">Email</label><input id="forgotEmail" type="email" required autocomplete="email"><button class="primary" style="margin-top:14px">Enviar email de recuperación</button></form><div id="forgotMsg"></div>`);
  $('#backLogin').addEventListener('click',()=>loginView());
  $('#forgotForm').addEventListener('submit',async e=>{e.preventDefault();const redirectTo=location.origin+location.pathname+'?recovery=1';const {error}=await sb.auth.resetPasswordForEmail($('#forgotEmail').value.trim(),{redirectTo});if(error)return alert(error.message);$('#forgotMsg').innerHTML='<div class="note"><b>Email enviado.</b><br>Revisá tu bandeja de entrada y spam. Abrí el enlace de recuperación desde el mismo navegador.</div>';});
}
function resetPasswordView(){
  state.recoveryMode=true;
  app().innerHTML=authCard(`<h2>Nueva contraseña</h2><p class="muted">Ingresá una contraseña nueva para tu cuenta.</p><form id="resetForm"><label class="label">Nueva contraseña</label><input id="newPass" type="password" minlength="6" required autocomplete="new-password"><label class="label">Repetir contraseña</label><input id="newPass2" type="password" minlength="6" required autocomplete="new-password"><button class="primary" style="margin-top:14px">Guardar contraseña</button></form>`);
  $('#resetForm').addEventListener('submit',async e=>{e.preventDefault();if($('#newPass').value!==$('#newPass2').value)return alert('Las contraseñas no coinciden.');const {error}=await sb.auth.updateUser({password:$('#newPass').value});if(error)return alert(error.message);state.recoveryMode=false;history.replaceState({},'',location.pathname);await sb.auth.signOut();loginView('Contraseña actualizada. Ya podés ingresar.');});
}
function pendingView(){
  app().innerHTML=authCard(`<div class="note warning"><b>Cuenta pendiente de aprobación</b><br>Tu email ya está registrado, pero el administrador todavía debe habilitar el acceso.</div><p class="muted">Cuenta: ${esc(state.user?.email||state.profile?.email||'')}</p><div class="actions"><button id="pendingRefresh" class="primary" type="button">Verificar aprobación</button><button id="pendingLogout" class="ghost" type="button">Salir</button></div>`);
  $('#pendingRefresh').addEventListener('click',()=>bootstrap());$('#pendingLogout').addEventListener('click',async()=>{await sb.auth.signOut();state.user=null;state.profile=null;loginView();});
}
function blockedView(){app().innerHTML=authCard(`<div class="note warning"><b>Cuenta bloqueada</b><br>El acceso fue deshabilitado por el administrador.</div><button id="backLogin" class="primary" type="button">Volver</button>`);$('#backLogin').addEventListener('click',()=>loginView());}
function accessErrorView(msg){app().innerHTML=authCard(`<div class="note warning"><b>No se pudo validar el acceso</b><br>${esc(msg)}</div><div class="actions"><button id="retryAccess" class="primary" type="button">Reintentar</button><button id="logoutAccess" class="ghost" type="button">Salir</button></div>`);$('#retryAccess').addEventListener('click',()=>bootstrap());$('#logoutAccess').addEventListener('click',async()=>{await sb.auth.signOut();loginView();});}

function shell(content){const tabs=[['dashboard','Resumen'],['simulate','Nueva simulación'],['history','Historial'],['hybrids','Híbridos'],['fields','Campos y lotes']];if(state.profile?.role==='admin')tabs.push(['users','Usuarios']);return `<div class="app"><div class="header"><div class="brand"><h1>Modelizador de Riesgo para Maíz</h1><p>Centro-norte de Córdoba · herramienta de decisión agronómica</p></div><div class="userbar"><span class="muted">${esc(state.profile?.full_name||state.user?.email||'')}${state.profile?.role==='admin'?' · Administrador':''}</span><button id="logout" class="ghost">Salir</button></div></div><div class="tabs">${tabs.map(([k,n])=>`<button class="tab ${state.tab===k?'active':''}" data-tab="${k}">${n}${k==='users'&&state.users.filter(u=>!u.approved&&!u.blocked).length?` <span class="badge medium">${state.users.filter(u=>!u.approved&&!u.blocked).length}</span>`:''}</button>`).join('')}</div>${content}</div>`}
function render(){clearCharts();let content=state.tab==='simulate'?simulateView():state.tab==='history'?historyView():state.tab==='hybrids'?hybridsView():state.tab==='fields'?fieldsView():state.tab==='users'&&state.profile?.role==='admin'?usersView():dashboardView();app().innerHTML=shell(content);bindCommon();bindTab();}
function bindCommon(){$('#logout').addEventListener('click',async()=>{await sb.auth.signOut();state.user=null;state.profile=null;state.users=[];loginView();});}
function bindTab(){document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.tab;render();}));if(state.tab==='simulate')bindSimulation();if(state.tab==='fields')bindFields();if(state.tab==='hybrids')bindHybridCards();if(state.tab==='history')bindHistory();if(state.tab==='users'&&state.profile?.role==='admin')bindUsers();}
function usersView(){
  const pending=state.users.filter(u=>!u.approved&&!u.blocked),approved=state.users.filter(u=>u.approved&&!u.blocked),blocked=state.users.filter(u=>u.blocked);
  const row=u=>`<tr><td><b>${esc(u.full_name||'Sin nombre')}</b><br><span class="muted">${esc(u.email||'')}</span></td><td>${new Date(u.requested_at||Date.now()).toLocaleString('es-AR')}</td><td>${esc(u.role||'productor')}</td><td>${u.blocked?'<span class="badge high">Bloqueada</span>':u.approved?'<span class="badge low">Aprobada</span>':'<span class="badge medium">Pendiente</span>'}</td><td><div class="actions">${!u.approved&&!u.blocked?`<button class="primary" data-approve-user="${u.id}">Aprobar</button>`:''}${u.approved&&!u.blocked&&u.id!==state.user.id?`<button class="secondary" data-block-user="${u.id}">Bloquear</button>`:''}${u.blocked?`<button class="secondary" data-unblock-user="${u.id}">Desbloquear</button>`:''}</div></td></tr>`;
  const table=arr=>arr.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Usuario</th><th>Solicitud</th><th>Rol</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${arr.map(row).join('')}</tbody></table></div>`:'<div class="empty">No hay usuarios en esta categoría.</div>';
  return `<div class="grid"><div class="card span12"><div class="section-title"><h2>Administración de usuarios</h2><span class="muted">${state.users.length} cuentas</span></div><div class="note"><b>Flujo:</b> registro → confirmación de email (si está activa) → pendiente → aprobación del administrador → acceso.</div></div><div class="card span12"><h3>Pendientes (${pending.length})</h3>${table(pending)}</div><div class="card span12"><h3>Aprobados (${approved.length})</h3>${table(approved)}</div><div class="card span12"><h3>Bloqueados (${blocked.length})</h3>${table(blocked)}</div></div>`;
}
function bindUsers(){
  document.querySelectorAll('[data-approve-user]').forEach(b=>b.addEventListener('click',async()=>{const {error}=await sb.from('profiles').update({approved:true,approved_at:new Date().toISOString(),blocked:false}).eq('id',b.dataset.approveUser);if(error)return alert(error.message);await loadUsers();render();}));
  document.querySelectorAll('[data-block-user]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Bloquear esta cuenta?'))return;const {error}=await sb.from('profiles').update({blocked:true,approved:false}).eq('id',b.dataset.blockUser);if(error)return alert(error.message);await loadUsers();render();}));
  document.querySelectorAll('[data-unblock-user]').forEach(b=>b.addEventListener('click',async()=>{const {error}=await sb.from('profiles').update({blocked:false,approved:true,approved_at:new Date().toISOString()}).eq('id',b.dataset.unblockUser);if(error)return alert(error.message);await loadUsers();render();}));
}

function dashboardView(){
  const last=state.history[0];const obs=state.observed.length>0;const farms=state.farms.length;const fields=state.fields.length;
  return `<div class="grid"><div class="card span3"><div class="muted">Campos</div><div class="kpi">${farms}</div></div><div class="card span3"><div class="muted">Lotes</div><div class="kpi">${fields}</div></div><div class="card span3"><div class="muted">Simulaciones</div><div class="kpi">${state.history.length}</div></div><div class="card span3"><div class="muted">Motor climático</div><div class="kpi">${obs?'HISTÓRICO':'PRIORS'} <small>${state.hydricReady?'CLIMA + BALANCE HÍDRICO':(obs?'NASA POWER':'fallback')}</small></div></div>
  <div class="card span7"><div class="section-title"><h2>Decisión rápida</h2><button class="primary" data-tab="simulate">Nueva simulación</button></div><p>El Modelizador combina fecha de siembra, fenología del híbrido, período crítico y riesgo climático para comparar alternativas.</p><div class="note ${obs?'':'warning'}"><b>${obs?'Probabilidades observadas disponibles':'Modelo provisional'}</b><br>${obs?'La recomendación usa frecuencias históricas por fase ENSO y quincena de R1. PRIORS queda sólo como respaldo cuando falta un dato histórico.':'Todavía se usan priors heurísticos. La app lo informa en cada resultado y cambiará automáticamente cuando carguemos probabilidades observadas.'}</div></div>
  <div class="card span5"><h2>Última consulta</h2>${last?`<div class="kpi">${Math.round(last.risk_score||0)}/100 <small>${esc(last.risk_class||'')}</small></div><p><b>${esc(last.field_name||'Sin lote')}</b> · ${esc(last.hybrids?.name||'Híbrido')} ${esc(last.hybrids?.biotechnology||'')}</p><p class="muted">Siembra ${esc(last.sowing_date||'')} · R1 ${esc(last.flowering_date||'')}</p>`:'<div class="empty">Todavía no hay consultas guardadas.</div>'}</div></div>`;
}

function hybridOption(h){return `<option value="${h.id}">${esc(h.name)}${h.biotechnology?` — ${esc(h.biotechnology)}`:''}</option>`}
function fieldOptions(){return `<option value="">Sin lote guardado</option>${state.fields.map(f=>`<option value="${f.id}">${esc(f.farms?.name||'Campo')} — ${esc(f.name)}</option>`).join('')}`}
function simulateView(){return `<div class="grid"><div class="card span5"><h2>Nueva simulación</h2><form id="simForm"><label class="label">Lote</label><select id="fieldId">${fieldOptions()}</select><label class="label">Nombre libre (opcional)</label><input id="fieldName" placeholder="Ej. Costa Sacate Lote 1"><div class="note"><b>Georreferencia climática</b><br><span class="muted">Podés usar la ubicación del dispositivo o las coordenadas guardadas del lote.</span><div class="form-row" style="margin-top:10px"><div><label class="label">Latitud</label><input id="simLat" type="number" step="any" placeholder="-31.65"></div><div><label class="label">Longitud</label><input id="simLon" type="number" step="any" placeholder="-63.73"></div></div><div class="actions"><button id="simGeo" class="secondary" type="button">📍 Usar mi ubicación</button></div><div id="simGeoStatus" class="muted"></div></div><label class="label">Híbrido</label><select id="hybridId" required>${state.hybrids.map(hybridOption).join('')}</select><div id="hybridSummary"></div><div class="form-row"><div><label class="label">Fecha de siembra</label><input id="sow" type="date" value="2026-10-05" required></div><div><label class="label">Escenario ENSO</label><select id="enso"><option value="Nino">Niño</option><option value="Neutral">Neutral</option><option value="Nina">Niña</option></select></div></div><div class="form-row"><div><label class="label">Agua útil inicial (mm)</label><input id="water" type="number" min="0" max="400" placeholder="Ej. 140" required></div><div><label class="label">AU máxima del perfil (mm)</label><input id="waterCapacity" type="number" min="30" max="500" placeholder="Ej. 200" required></div></div><div class="form-row"><div><label class="label">Densidad objetivo (pl/ha)</label><input id="density" type="number" min="20000" max="120000" step="1000" placeholder="Ej. 70000"></div><div><label class="label">Modelo hídrico</label><div class="note" style="margin-top:0">FAO Kc + ETo Hargreaves + balance diario histórico</div></div></div><label class="label">Ambiente</label><select id="environment"><option value="">Sin especificar</option><option>Alto potencial</option><option>Medio</option><option>Restrictivo</option></select><div class="actions"><button class="primary">Analizar siembra</button></div></form></div><div class="card span7" id="result"><h2>Resultado</h2><p class="muted">Completá una simulación para ver fecha estimada de R1, período crítico, riesgos, alternativas y recomendación.</p></div></div>`}
function selectedHybrid(){return state.hybrids.find(h=>String(h.id)===$('#hybridId').value)}
function bindSimulation(){const select=$('#hybridId');const update=()=>{$('#hybridSummary').innerHTML=hybridMini(selectedHybrid())};select.addEventListener('change',update);update();const applyFieldGeo=()=>{const f=state.fields.find(x=>String(x.id)===$('#fieldId').value);if(!f)return;const lat=Number(f.latitude??f.farms?.latitude),lon=Number(f.longitude??f.farms?.longitude);if(validCoord(lat,lon)){ $('#simLat').value=lat;$('#simLon').value=lon;$('#simGeoStatus').textContent='Usando georreferencia guardada del lote/campo.';}if(f.water_capacity_mm){$('#waterCapacity').value=f.water_capacity_mm;}};$('#fieldId').addEventListener('change',applyFieldGeo);applyFieldGeo();$('#simGeo').addEventListener('click',()=>requestLocation(x=>{$('#simLat').value=x.lat.toFixed(6);$('#simLon').value=x.lon.toFixed(6);$('#simGeo').dataset.accuracy=String(x.accuracy)},$('#simGeoStatus')));$('#simForm').addEventListener('submit',runSimulation);}
function hybridMini(h){if(!h)return'';const pub=h.published_gdu_to_flowering?`${h.published_gdu_to_flowering} GDU${h.published_gdu_base_c?` base ${h.published_gdu_base_c}°C`:''}`:(h.flowering_days_reference?`${h.flowering_days_reference} días ref.`:'Sin dato comparable');return `<div class="note"><b>${esc(h.company||'')} · ${esc(h.technology_verified||h.biotechnology||'')}</b><br>MR ${h.relative_maturity??'s/d'} · ${esc(h.cycle||'s/d')} · Fenología publicada: ${pub}.<br><span class="muted">Para el cálculo se usa ${h.model_gdu_fallback||h.gdu_to_flowering||790} GDU base ${h.model_base_temp_fallback_c||h.base_temp_c||10}°C salvo que exista un GDU publicado comparable en base 10.</span></div>`}
function modelPhenology(h){if(h?.published_gdu_to_flowering && Number(h.published_gdu_base_c)===10)return{gdu:Number(h.published_gdu_to_flowering),base:10,source:'GDU publicado comparable'};return{gdu:Number(h?.model_gdu_fallback||h?.gdu_to_flowering||790),base:Number(h?.model_base_temp_fallback_c||h?.base_temp_c||10),source:'fallback operativo'};}
function estimateFlowering(sow,gdu,base){let d=new Date(sow),acc=0,guard=0;while(acc<gdu&&guard<240){const t=TEMP_MEAN[d.getUTCMonth()+1]??18;acc+=Math.max(0,t-base);d=addDays(d,1);guard++;}return{date:d,days:guard,gdu:Math.round(acc)}}
function observedRecord(phase,key,metric,stationId=null){
  const metricMap={
    heat:'heatwave_3d_ge35',
    cold:'cold_any_le4',
    drought:'drought_proxy_p31_lt80',
    excess:'excess_proxy_p31_gt180'
  };
  const wantedPhase=normalizePhase(phaseDbLabel(phase));
  const wantedMetric=metricMap[metric];
  const rows=state.observed.filter(r=>normalizePhase(r.phase)===wantedPhase&&r.fortnight===key&&(!stationId||String(r.station_id)===String(stationId)));
  const row=rows.find(r=>String(r.metric)===wantedMetric);
  if(!row)return null;
  const raw=Number(row.probability);
  return {
    probability:clamp(raw<=1?raw*100:raw),
    eventCampaigns:Number(row.event_campaigns||0),
    totalCampaigns:Number(row.total_campaigns||0),
    periodStart:Number(row.period_start_year||0)||null,
    periodEnd:Number(row.period_end_year||0)||null,
    source:row.source||'NASA POWER',
    metric:row.metric,
    threshold:row.threshold
  };
}
function priorValue(phase,key,metric){const base=(state.priors[key]||FALLBACK_PRIORS[key]||{heat:20,cold:3,drought:20,excess:25})[metric];return clamp(base*(ENSO_FACTORS[phase]?.[metric]||1));}
function riskBundleAtR1(r1,phase,stationId=null){
  const key=fortnightKey(r1), values={}, details={};
  for(const metric of ['heat','cold','drought','excess']){
    const rec=observedRecord(phase,key,metric,stationId);
    if(rec){values[metric]=Math.round(rec.probability*10)/10;details[metric]=rec;}
    else{values[metric]=Math.round(priorValue(phase,key,metric)*10)/10;details[metric]=null;}
  }
  const historicalCount=Object.values(details).filter(Boolean).length;
  return {key,values,details,source:historicalCount===4?'historical':historicalCount>0?'mixed':'priors'};
}

function percentile(vals,p){if(!vals.length)return null;const a=[...vals].sort((x,y)=>x-y);const i=(a.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(i-lo)}
async function simulateHydricHistorical({stationId,phase,sow,gdu,base,waterInitial,waterCapacity,lat}){
  if(!state.hydricReady||!stationId)return null;
  const md=String(sow.getUTCMonth()+1).padStart(2,'0')+'-'+String(sow.getUTCDate()).padStart(2,'0');
  const {data,error}=await sb.rpc('simulate_hydric_r1',{
    p_station_id:Number(stationId),p_phase:phaseDbLabel(phase),p_sowing_md:md,
    p_gdu_target:Number(gdu),p_base_temp:Number(base),p_initial_au:Number(waterInitial),
    p_max_au:Number(waterCapacity),p_effective_rain_factor:0.90
  });
  if(error){console.warn('Hydric RPC:',error.message);return {error:error.message,rows:[]};}
  const rows=(data||[]).map(r=>({
    ...r,au_r1_mm:Number(r.au_r1_mm),au_r1_pct:Number(r.au_r1_pct),stress_days:Number(r.stress_days||0),
    precip_to_r1_mm:Number(r.precip_to_r1_mm||0),eto_to_r1_mm:Number(r.eto_to_r1_mm||0),etc_potential_to_r1_mm:Number(r.etc_potential_to_r1_mm||0),
    water_deficit_mm:Number(r.water_deficit_mm||0),min_au_pct:Number(r.min_au_pct||0)
  }));
  if(!rows.length)return {rows:[],error:null};
  const pct=rows.map(r=>r.au_r1_pct).filter(Number.isFinite),mm=rows.map(r=>r.au_r1_mm).filter(Number.isFinite);
  const stress=rows.filter(r=>r.au_r1_pct<45).length/rows.length*100;
  const severe=rows.filter(r=>r.au_r1_pct<20).length/rows.length*100;
  const stress3=rows.filter(r=>r.stress_days>=3).length/rows.length*100;
  return {rows,n:rows.length,medianPct:percentile(pct,.5),p25Pct:percentile(pct,.25),p75Pct:percentile(pct,.75),medianMm:percentile(mm,.5),riskStress:stress,riskSevere:severe,riskStress3:stress3,
    medianRain:percentile(rows.map(r=>r.precip_to_r1_mm),.5),medianETc:percentile(rows.map(r=>r.etc_potential_to_r1_mm),.5)};
}
function hydricHtml(h){if(!h)return `<div class="note warning"><b>Balance hídrico no disponible</b><br>Falta cargar la serie diaria con ETo en Supabase. El score sigue usando el proxy histórico de precipitación.</div>`;if(h.error)return `<div class="note warning"><b>Balance hídrico no disponible</b><br>${esc(h.error)}</div>`;if(!h.n)return `<div class="note warning"><b>Sin campañas hídricas comparables</b><br>No hubo datos diarios suficientes para esta combinación.</div>`;return `<div class="note"><b>💧 Estado hídrico histórico estimado a R1</b><br><div class="profile-grid" style="margin-top:10px"><div class="mini">AU mediana en R1<b>${h.medianMm.toFixed(0)} mm · ${h.medianPct.toFixed(0)}%</b></div><div class="mini">Rango P25–P75<b>${h.p25Pct.toFixed(0)}–${h.p75Pct.toFixed(0)}%</b></div><div class="mini">Riesgo de estrés en R1<b>${h.riskStress.toFixed(1)}%</b></div><div class="mini">Estrés severo &lt;20% AU<b>${h.riskSevere.toFixed(1)}%</b></div><div class="mini">≥3 días con estrés<b>${h.riskStress3.toFixed(1)}%</b></div><div class="mini">Campañas comparables<b>${h.n}</b></div><div class="mini">Lluvia mediana siembra→R1<b>${h.medianRain.toFixed(0)} mm</b></div><div class="mini">ETc potencial mediana<b>${h.medianETc.toFixed(0)} mm</b></div></div><span class="muted">Modelo: balance diario; Kc 0,40→1,15 según avance térmico; ETo Hargreaves; lluvia efectiva 90%; umbral de estrés FAO ajustado por ETc.</span></div>`}

function hydricRiskScore(h){
  if(!h?.n)return null;
  // Resume la distribución histórica sin convertir el mismo déficit en dos componentes distintos.
  // El evento principal (estrés al R1) domina; severidad y persistencia actúan como agravantes.
  return Math.round(clamp(h.riskStress*0.70+h.riskSevere*0.20+h.riskStress3*0.10)*10)/10;
}
function climatePhenologyScore(phen,fallbackRisk){
  // Calcula el bloque climático-fenológico SIN déficit hídrico, que se incorpora aparte
  // mediante el balance diario. Los pesos restantes se renormalizan a 100%.
  if(phen?.bands?.CORE&&phen?.bands?.SHOULDER){
    let weighted=0,totalBand=0;
    for(const band of ['CORE','SHOULDER']){
      const b=phen.bands[band],p=b.profile||{};
      const hw=Number(p.heat_weight||0),ew=Number(p.excess_weight||0),cw=Number(p.cold_weight||0);
      const denom=hw+ew+cw||1;
      const bandScore=(b.values.heat*hw+b.values.excess*ew+b.values.cold*cw)/denom;
      const bw=Number(p.band_weight||0);
      weighted+=bandScore*bw; totalBand+=bw;
    }
    if(totalBand>0)return Math.round(weighted/totalBand*10)/10;
  }
  const m=state.model;
  const hw=Number(m.heat_weight??.4),ew=Number(m.excess_weight??.2),cw=Number(m.cold_weight??.15);
  const denom=hw+ew+cw||1;
  return Math.round(((fallbackRisk.heat*hw+fallbackRisk.excess*ew+fallbackRisk.cold*cw)/denom)*10)/10;
}
function combinedRiskScore({phen,r,hydric}){
  const climate=climatePhenologyScore(phen,r);
  const hydricScore=hydricRiskScore(hydric);
  if(hydricScore==null)return {score:Math.round(climate),climateScore:climate,hydricScore:null,climateWeight:1,hydricWeight:0};
  const climateWeight=.70,hydricWeight=.30;
  return {score:Math.round(climate*climateWeight+hydricScore*hydricWeight),climateScore:climate,hydricScore,climateWeight,hydricWeight};
}
function scoreRisk(r){const m=state.model;return Math.round(r.heat*Number(m.heat_weight??.4)+r.cold*Number(m.cold_weight??.15)+r.drought*Number(m.drought_weight??.25)+r.excess*Number(m.excess_weight??.2))}
function phenObservedRecord(phase,key,band,metric,stationId=null){
  const metricMap={heat:'heatwave_3d_ge35',cold:'cold_any_le4',drought:'drought_proxy_scaled',excess:'excess_proxy_scaled'};
  const wantedPhase=normalizePhase(phaseDbLabel(phase));
  const rows=state.phenObserved.filter(r=>normalizePhase(r.phase)===wantedPhase&&r.fortnight===key&&String(r.window_band)===band&&(!stationId||String(r.station_id)===String(stationId)));
  const row=rows.find(r=>String(r.metric)===metricMap[metric]);
  if(!row)return null;
  const raw=Number(row.probability);
  return {probability:clamp(raw<=1?raw*100:raw),eventCampaigns:Number(row.event_campaigns||0),totalCampaigns:Number(row.total_campaigns||0),periodStart:Number(row.period_start_year||0)||null,periodEnd:Number(row.period_end_year||0)||null,source:row.source||'NASA POWER',threshold:Number(row.threshold),metric:row.metric};
}
function phenologyScoreAtR1(r1,phase,stationId=null){
  const key=fortnightKey(r1),bands={};
  let allHistorical=true,weighted=0,totalBandWeight=0;
  for(const band of ['CORE','SHOULDER']){
    const profile=state.phenProfiles[band]; if(!profile){allHistorical=false;continue;}
    const values={},details={};
    for(const metric of ['heat','drought','excess','cold']){
      const rec=phenObservedRecord(phase,key,band,metric,stationId);
      if(!rec){allHistorical=false;break;}
      values[metric]=Math.round(rec.probability*10)/10;details[metric]=rec;
    }
    if(Object.keys(values).length!==4)continue;
    const bandScore=values.heat*profile.heat_weight+values.drought*profile.drought_weight+values.excess*profile.excess_weight+values.cold*profile.cold_weight;
    const bw=profile.band_weight;
    bands[band]={values,details,profile,score:Math.round(bandScore*10)/10};
    weighted+=bandScore*bw;totalBandWeight+=bw;
  }
  if(!allHistorical||Object.keys(bands).length<2||totalBandWeight<=0)return null;
  return {key,bands,score:Math.round(weighted/totalBandWeight),source:'phenology_historical'};
}
function scoreWithPhenology(r1,phase,stationId,fallbackRisk){
  const phen=phenologyScoreAtR1(r1,phase,stationId);
  return phen?{score:phen.score,phen}:{score:scoreRisk(fallbackRisk),phen:null};
}

function densityAdvice(h,density,environment){if(!density)return'';if(h?.density_min_pl_ha&&density<h.density_min_pl_ha)return`La densidad ${density.toLocaleString('es-AR')} pl/ha está por debajo del rango técnico publicado (${h.density_min_pl_ha.toLocaleString('es-AR')}–${h.density_max_pl_ha?.toLocaleString('es-AR')||'?'}).`;if(h?.density_max_pl_ha&&density>h.density_max_pl_ha)return`La densidad ${density.toLocaleString('es-AR')} pl/ha supera el máximo publicado (${h.density_max_pl_ha.toLocaleString('es-AR')} pl/ha).`;if(environment==='Restrictivo'&&density>75000)return'En ambiente restrictivo, revisar una densidad alta frente a la oferta hídrica esperada.';return''}
function makeRecommendation(r,score,best,h,density,environment,source){const [klass]=riskClass(score);const dominant=Object.entries(r).sort((a,b)=>b[1]-a[1])[0];const names={heat:'ola de calor (≥3 días con Tmax ≥35 °C)',cold:'frío ≤4 °C',drought:'riesgo hídrico al llegar a R1',excess:'exceso hídrico proxy (>180 mm/31 días)'};let txt=`Riesgo ${klass.toLowerCase()}. El factor dominante es ${names[dominant[0]]} (${dominant[1]}%). `;const reduction=Math.max(0,score-best.score);if(score>=35&&best.score<score){txt+=`La fecha seleccionada supera el umbral de riesgo alto (35%). La mejor alternativa evaluada es ${fmt(best.date)}, con ${best.score}/100, una reducción de ${reduction.toFixed(0)} puntos. `;}else if(best.score<score-2){txt+=`Mover la siembra hacia ${fmt(best.date)} reduce el score estimado a ${best.score}/100 (${reduction.toFixed(0)} puntos menos). `;}else txt+='La fecha elegida está dentro de las mejores alternativas del rango ±20 días. ';const da=densityAdvice(h,density,environment);if(da)txt+=da+' ';if(h?.positioning)txt+=`Posicionamiento del híbrido: ${h.positioning} `;txt+=source==='phenology_historical'?'El score usa ponderación fenológica histórica: máxima sensibilidad en R1 ±7 días y menor peso en los hombros de 8–15 días.':source==='historical'?'Las cuatro probabilidades provienen del histórico NASA POWER clasificado por ENSO.':source==='mixed'?'Parte de la matriz proviene del histórico y los faltantes se completaron con PRIORS; revisar la trazabilidad mostrada.':'No hubo coincidencia histórica para esta combinación y se usaron PRIORS como fallback.';return txt}
async function runSimulation(e){
  e.preventDefault();
  const h=selectedHybrid(),phen=modelPhenology(h),sow=dparse($('#sow').value),phase=$('#enso').value;
  const lat=Number($('#simLat').value),lon=Number($('#simLon').value),hasGeo=validCoord(lat,lon);
  const station=hasGeo?nearestStation(lat,lon):(state.stations.find(st=>state.observed.some(r=>String(r.station_id)===String(st.id)))||null);
  const stationId=station?.id||null;
  const fl=estimateFlowering(sow,phen.gdu,phen.base);
  const before=Number(state.model.critical_days_before??15),after=Number(state.model.critical_days_after??15),cs=addDays(fl.date,-before),ce=addDays(fl.date,after);
  const bundle=riskBundleAtR1(fl.date,phase,stationId);let r={...bundle.values};
  const field=state.fields.find(f=>String(f.id)===$('#fieldId').value),free=$('#fieldName').value.trim(),fieldName=free||(field?`${field.farms?.name||''} ${field.name}`.trim():'Sin especificar');
  const density=Number($('#density').value)||null,water=Number($('#water').value),waterCapacity=Number($('#waterCapacity').value),environment=$('#environment').value||null;
  if(!Number.isFinite(water)||!Number.isFinite(waterCapacity)||water<0||waterCapacity<=0||water>waterCapacity)return alert('Revisá AU inicial y AU máxima: el AU inicial no puede superar la capacidad máxima del perfil.');
  const hydric=await simulateHydricHistorical({stationId,phase,sow,gdu:phen.gdu,base:phen.base,waterInitial:water,waterCapacity,lat});
  if(hydric?.n)r.drought=Math.round(hydric.riskStress*10)/10;
  const scorePack=scoreWithPhenology(fl.date,phase,stationId,r);
  const combined=combinedRiskScore({phen:scorePack.phen,r,hydric});
  const score=combined.score;
  const deltas=[];for(let delta=-20;delta<=20;delta+=5)deltas.push(delta);
  const alts=await Promise.all(deltas.map(async delta=>{
    const sd=addDays(sow,delta),ff=estimateFlowering(sd,phen.gdu,phen.base),bb=riskBundleAtR1(ff.date,phase,stationId);
    const altR={...bb.values};
    const altHydric=await simulateHydricHistorical({stationId,phase,sow:sd,gdu:phen.gdu,base:phen.base,waterInitial:water,waterCapacity,lat});
    if(altHydric?.n)altR.drought=Math.round(altHydric.riskStress*10)/10;
    const sp=scoreWithPhenology(ff.date,phase,stationId,altR);
    const altCombined=combinedRiskScore({phen:sp.phen,r:altR,hydric:altHydric});
    return {date:sd,score:altCombined.score,r1:ff.date,source:sp.phen?'phenology_historical':bb.source,climateScore:altCombined.climateScore,hydricScore:altCombined.hydricScore};
  }));
  const best=alts.reduce((a,b)=>a.score<=b.score?a:b);
  const accuracy=Number($('#simGeo').dataset.accuracy)||null,locationSource=accuracy?'device':(hasGeo?'saved_or_manual':'none');
  const climateCellLat=hasGeo?snap025(lat):null,climateCellLon=hasGeo?snap025(lon):null;
  let recommendation=makeRecommendation(r,score,best,h,density,environment,scorePack.phen?'phenology_historical':bundle.source);
  if(hydric?.n){recommendation+=` El score final combina ${Math.round(combined.climateWeight*100)}% riesgo climático-fenológico (${combined.climateScore.toFixed(1)}/100) y ${Math.round(combined.hydricWeight*100)}% riesgo hídrico (${combined.hydricScore.toFixed(1)}/100). Con ${water.toFixed(0)} mm de AU inicial sobre ${waterCapacity.toFixed(0)} mm de capacidad, el balance histórico estima ${hydric.riskStress.toFixed(0)}% de campañas comparables con AU <45% al llegar a R1 y una mediana de ${hydric.medianPct.toFixed(0)}% de AU en R1.`;}
  if(station){const km=hasGeo?haversineKm(lat,lon,Number(station.latitude),Number(station.longitude)):null;recommendation+=` Referencia histórica actual: ${station.name||'estación'}${km!=null?` a ${km.toFixed(1)} km`:''}.`;}
  state.last={h,phen,sow,fl,cs,ce,r,score,combined,phenScore:scorePack.phen,alts,best,phase,field,fieldName,density,water,waterCapacity,hydric,environment,recommendation,source:scorePack.phen?'phenology_historical':bundle.source,riskDetails:bundle.details,riskFortnight:bundle.key,lat:hasGeo?lat:null,lon:hasGeo?lon:null,accuracy,locationSource,climateCellLat,climateCellLon,station};
  renderResult();await saveSimulation();await loadUserData();
}
function detailLine(label,key,x){const d=x.riskDetails?.[key];if(!d)return `<div class="risk-row"><span>${label}</span><b>${x.r[key]}%</b><small>PRIORS · fallback</small></div>`;const years=d.periodStart&&d.periodEnd?`${d.periodStart}–${d.periodEnd}`:'período histórico';return `<div class="risk-row"><span>${label}</span><b>${x.r[key]}%</b><small>${d.eventCampaigns} de ${d.totalCampaigns} campañas · ${years}</small></div>`}
function phenScoreHtml(x){if(!x.phenScore)return `<div class="note warning"><b>Score clásico</b><br>No se encontró todavía la matriz fenológica por subventanas. El score usa el histórico R1 ±15 completo.</div>`;const c=x.phenScore.bands.CORE,sh=x.phenScore.bands.SHOULDER;return `<div class="note"><b>Score Fenológico v2</b><br>El score cambia los pesos según cercanía a R1.<div class="risk-details" style="margin-top:10px"><div class="risk-row"><span><b>R1 ±7 días</b> · máxima sensibilidad</span><b>${c.score.toFixed(1)}/100</b><small>Peso de banda ${(c.profile.band_weight*100).toFixed(0)}% · Calor ${(c.profile.heat_weight*100).toFixed(0)}% · Déficit ${(c.profile.drought_weight*100).toFixed(0)}% · Exceso ${(c.profile.excess_weight*100).toFixed(0)}% · Frío ${(c.profile.cold_weight*100).toFixed(0)}%</small></div><div class="risk-row"><span><b>8–15 días de R1</b> · sensibilidad alta</span><b>${sh.score.toFixed(1)}/100</b><small>Peso de banda ${(sh.profile.band_weight*100).toFixed(0)}% · Calor ${(sh.profile.heat_weight*100).toFixed(0)}% · Déficit ${(sh.profile.drought_weight*100).toFixed(0)}% · Exceso ${(sh.profile.excess_weight*100).toFixed(0)}% · Frío ${(sh.profile.cold_weight*100).toFixed(0)}%</small></div></div></div>`}
function combinedScoreHtml(x){
  const c=x.combined;if(!c)return'';
  if(c.hydricScore==null)return `<div class="note warning"><b>Score combinado parcial</b><br>No hubo balance hídrico comparable. El score refleja únicamente el riesgo climático-fenológico (${c.climateScore.toFixed(1)}/100).</div>`;
  return `<div class="note"><b>Score combinado final</b><br><div class="profile-grid" style="margin-top:10px"><div class="mini">Climático-fenológico <b>${c.climateScore.toFixed(1)}/100 · ${(c.climateWeight*100).toFixed(0)}%</b></div><div class="mini">Hídrico histórico <b>${c.hydricScore.toFixed(1)}/100 · ${(c.hydricWeight*100).toFixed(0)}%</b></div></div><span class="muted">El bloque climático-fenológico no incluye déficit para evitar doble conteo. El hídrico resume 70% probabilidad de estrés a R1, 20% estrés severo y 10% persistencia ≥3 días.</span></div>`;
}

function dateAtThermalTarget(sow,targetGdu,base){let d=new Date(sow),acc=0,guard=0;while(acc<targetGdu&&guard<360){const t=TEMP_MEAN[d.getUTCMonth()+1]??18;acc+=Math.max(0,t-base);d=addDays(d,1);guard++;}return d}
function stageRiskClass(v){v=Number(v||0);return v<20?'stage-low':v<35?'stage-medium':'stage-high'}
function stageRiskCell(v,detail=''){return `<span class="stage-prob ${stageRiskClass(v)}"${detail?` title="${esc(detail)}"`:''}>${Number(v).toFixed(0)}%</span>`}
function phenologyStagesForResult(x){
  const r1=Number(x.phen.gdu),base=Number(x.phen.base);
  const defs=[
    ['VE','Emergencia',Math.max(55,r1*.08),'🌱'],['V3','3 hojas',r1*.22,'🌱'],['V6','6 hojas',r1*.42,'🌿'],['V10','10 hojas',r1*.68,'🌿'],['VT','Panojamiento',r1*.92,'🌽'],['R1','Floración',r1,'🌽'],
    ['R2','Grano lechoso',r1+150,'🌽'],['R3','Grano pastoso',r1+340,'🌽'],['R4','Grano duro',r1+540,'🌽'],['R6','Madurez fisiológica',r1+900,'🌾']
  ];
  return defs.map(([code,label,target,icon])=>{
    const date=code==='R1'?new Date(x.fl.date):dateAtThermalTarget(x.sow,target,base);
    const b=riskBundleAtR1(date,x.phase,x.station?.id||null);
    const heat=b.values.heat,cold=b.values.cold,excess=b.values.excess;
    const hydric=(code==='R1'&&x.hydric?.n)?x.hydric.riskStress:b.values.drought;
    return {code,label,target:Math.round(target),icon,date,heat,cold,excess,hydric,key:b.key,source:b.source};
  });
}
function phenologyVisualHtml(x){
  const stages=phenologyStagesForResult(x);
  const heads=stages.map(s=>`<div class="stage-head ${s.code==='R1'?'stage-r1':''}"><div class="stage-plant">${s.icon}</div><b>${s.code}</b><span>${esc(s.label)}</span><small>${fmt(s.date)}</small></div>`).join('');
  const row=(label,key,icon)=>`<div class="phen-risk-label">${icon} ${label}</div>${stages.map(s=>stageRiskCell(s[key],`${s.code} · ${s.key} · ${s.source}`)).join('')}`;
  const gdu=`<div class="phen-risk-label">🌡️ GDU objetivo*</div>${stages.map(s=>`<span class="stage-gdu">${s.target}</span>`).join('')}`;
  return `<div class="phenology-panel"><div class="section-title"><div><h3>Etapas fenológicas y exposición histórica</h3><p class="muted">La fecha y la probabilidad se recalculan para esta siembra, híbrido, ENSO y referencia climática.</p></div><span class="badge info">R1 destacado</span></div><div class="phenology-scroll"><div class="phenology-grid"><div class="phen-corner">Etapa</div>${heads}${row('Ola de calor ≥3 días ≥35 °C','heat','🔥')}${row('Riesgo hídrico','hydric','💧')}${row('Exceso de lluvia','excess','🌧️')}${row('Frío ≤4 °C','cold','❄️')}${gdu}</div></div><p class="muted phen-foot">* Hasta R1 los GDU se distribuyen sobre el requerimiento térmico usado por el Modelizador; las etapas posteriores usan incrementos térmicos orientativos y deben interpretarse como fechas estimadas. En R1, el riesgo hídrico usa el balance histórico diario cuando está disponible; en las demás etapas se muestra el proxy histórico correspondiente a su quincena.</p></div>`;
}

function renderResult(){const x=state.last;const [label,klass]=riskClass(x.score);const engine=x.source==='phenology_historical'?'HISTÓRICO + SCORE FENOLÓGICO':x.source==='historical'?'HISTÓRICO':x.source==='mixed'?'HISTÓRICO + FALLBACK':'PRIORS';$('#result').innerHTML=`<div class="section-title"><h2>Resultado</h2><span class="badge ${klass}">${label}</span></div><div class="kpi">${x.score}/100 <small>score combinado</small></div><p><b>R1 estimada:</b> ${fmt(x.fl.date)} · <b>Período crítico:</b> ${fmt(x.cs)}–${fmt(x.ce)}</p><p class="muted">Fenología usada: ${x.phen.gdu} GDU base ${x.phen.base}°C (${x.phen.source}). · Quincena Data Risk: ${x.riskFortnight}</p>${x.lat!=null?`<p class="muted"><b>Georreferencia:</b> ${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}${x.station?` · referencia ${esc(x.station.name||'')}`:''}</p>`:''}<div class="note ${x.source==='priors'?'warning':''}"><b>Motor climático: ${engine}</b><br>${x.source==='phenology_historical'?'NASA POWER + ENSO con subventanas fenológicas. El calor pesa 50% dentro de R1 ±7 días y 40% entre 8–15 días; los pesos se leen desde Supabase.':x.source==='historical'?'NASA POWER diario + clasificación histórica ENSO. La probabilidad representa campañas con el evento dentro de la ventana crítica asociada a esa quincena de R1.':x.source==='mixed'?'Hay datos históricos parciales; los faltantes se completaron con PRIORS.':'No se encontró una matriz histórica coincidente y se usaron PRIORS como respaldo.'}</div>${combinedScoreHtml(x)}${phenScoreHtml(x)}${hydricHtml(x.hydric)}<div class="risk-details">${detailLine('🔥 Ola de calor ≥3 días ≥35 °C','heat',x)}${detailLine('❄️ Frío ≤4 °C','cold',x)}${detailLine('💧 Riesgo hídrico a R1','drought',x)}${detailLine('🌧️ Exceso >180 mm / 31 días*','excess',x)}</div><p class="muted">* Si el balance hídrico histórico está disponible, el componente de déficit del score usa la probabilidad de llegar a R1 con menos de 45% del AU máximo. Si no, usa el proxy histórico de precipitación.</p><div class="note"><b>Recomendación</b><br>${esc(x.recommendation)}</div>${phenologyVisualHtml(x)}<div class="actions"><button id="pdfBtn" class="primary">Descargar PDF</button><button id="hybridBtn" class="secondary">Ver ficha del híbrido</button></div><canvas id="compareChart"></canvas>`;drawCompare();$('#pdfBtn').addEventListener('click',downloadPdf);$('#hybridBtn').addEventListener('click',()=>{state.tab='hybrids';render();setTimeout(()=>{const el=document.querySelector(`[data-hybrid-card="${x.h.id}"]`);el?.scrollIntoView({behavior:'smooth',block:'start'})},100)});}
function drawCompare(){const x=state.last;const c=new Chart($('#compareChart'),{type:'line',data:{labels:x.alts.map(a=>fmt(a.date)),datasets:[{label:'Score combinado',data:x.alts.map(a=>a.score),tension:.25}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100,title:{display:true,text:'Riesgo 0–100'}},x:{title:{display:true,text:'Fecha de siembra'}}}}});state.charts.push(c)}
async function saveSimulation(){const x=state.last;const payload={user_id:state.user.id,field_id:x.field?.id||null,field_name:x.fieldName,hybrid_id:x.h.id,sowing_date:iso(x.sow),flowering_date:iso(x.fl.date),critical_start:iso(x.cs),critical_end:iso(x.ce),enso_phase:x.phase,risk_heat:x.r.heat,risk_cold:x.r.cold,risk_drought:x.r.drought,risk_excess:x.r.excess,risk_score:x.score,risk_class:riskClass(x.score)[0],recommendation:x.recommendation,model_version:x.combined?.hydricScore!=null?'score-combinado-v3':(x.phenScore?'score-fenologico-v2':(state.model.version||'v0.1-priors')),water_initial_mm:x.water,water_capacity_mm:x.waterCapacity,water_r1_median_mm:x.hydric?.medianMm??null,water_r1_median_pct:x.hydric?.medianPct??null,hydric_stress_probability:x.hydric?.riskStress??null,hydric_severe_probability:x.hydric?.riskSevere??null,hydric_stress3_probability:x.hydric?.riskStress3??null,target_density_pl_ha:x.density,environment:x.environment,risk_source:x.source,hybrid_snapshot:`${x.h.name} — ${x.h.biotechnology||''}`,latitude:x.lat,longitude:x.lon,geo_accuracy_m:x.accuracy,location_source:x.locationSource,climate_cell_lat:x.climateCellLat,climate_cell_lon:x.climateCellLon,climate_station_id:x.station?.id||null,climate_reference_name:x.station?.name||null,climate_distance_km:x.station?.distanceKm?Number(x.station.distanceKm.toFixed(2)):null};const {error}=await sb.from('simulations').insert(payload);if(error)alert('La simulación se calculó, pero no pudo guardarse: '+error.message)}
function downloadPdf(){const x=state.last;if(!x)return;const d=new jsPDF();d.setFontSize(19);d.text('Modelizador de Riesgo para Maíz',14,18);d.setFontSize(10);d.text('Informe de riesgo agroclimático',14,25);let y=38;const rows=[['Campo/lote',x.fieldName],['Híbrido',`${x.h.name} ${x.h.biotechnology||''}`],['Empresa',x.h.company||'s/d'],['Siembra',fmt(x.sow)],['R1 estimada',fmt(x.fl.date)],['Período crítico',`${fmt(x.cs)} a ${fmt(x.ce)}`],['ENSO',x.phase],...(x.lat!=null?[['Georreferencia',`${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}`],['Celda climática',`${x.climateCellLat}, ${x.climateCellLon}`],['Referencia climática',x.station?`${x.station.name} · ${x.station.distanceKm.toFixed(1)} km`:'Sin estación observada asociada']]:[]),['Fenología usada',`${x.phen.gdu} GDU base ${x.phen.base} °C`],['Score final',`${x.score}/100 - ${riskClass(x.score)[0]}`],...(x.combined?[['Score climático-fenológico',`${x.combined.climateScore.toFixed(1)}/100`],['Score hídrico',x.combined.hydricScore!=null?`${x.combined.hydricScore.toFixed(1)}/100`:'No disponible']]:[]),...(x.hydric?.n?[['AU inicial',`${x.water} / ${x.waterCapacity} mm`],['AU mediana en R1',`${x.hydric.medianMm.toFixed(0)} mm (${x.hydric.medianPct.toFixed(0)}%)`],['Prob. estrés hídrico R1',`${x.hydric.riskStress.toFixed(1)}% (${x.hydric.n} campañas)`]]:[]),['Calor',`${x.r.heat}%`],['Déficit',`${x.r.drought}%`],['Exceso',`${x.r.excess}%`],['Frío',`${x.r.cold}%`]];rows.forEach(([a,b])=>{d.setFont(undefined,'bold');d.text(a+':',14,y);d.setFont(undefined,'normal');d.text(String(b),62,y);y+=7});y+=5;d.setFont(undefined,'bold');d.text('Recomendación',14,y);y+=7;d.setFont(undefined,'normal');d.text(d.splitTextToSize(x.recommendation,180),14,y);y+=38;if(x.h.sanitary_profile){d.setFont(undefined,'bold');d.text('Perfil sanitario',14,y);y+=7;d.setFont(undefined,'normal');d.text(d.splitTextToSize(x.h.sanitary_profile,180),14,y)}d.setFontSize(8);d.text(x.source==='phenology_historical'?'Motor: HISTÓRICO + SCORE FENOLÓGICO v2 (NASA POWER + ENSO).':x.source==='historical'?'Motor: HISTÓRICO NASA POWER + ENSO.':'Motor: histórico parcial o PRIORS de respaldo; revisar trazabilidad en pantalla.',14,286);const stages=phenologyStagesForResult(x);d.addPage();d.setFontSize(16);d.text('Etapas fenológicas y exposición histórica',14,18);d.setFontSize(8);d.text('Probabilidades por la quincena estimada de cada etapa. R1 usa balance hídrico histórico cuando está disponible.',14,25);let py=38;d.setFont(undefined,'bold');d.text('Etapa',14,py);d.text('Fecha',35,py);d.text('Calor',65,py);d.text('Hídrico',88,py);d.text('Exceso',113,py);d.text('Frío',139,py);d.text('GDU*',162,py);d.setFont(undefined,'normal');py+=6;stages.forEach(st=>{d.text(st.code,14,py);d.text(fmt(st.date),35,py);d.text(st.heat.toFixed(0)+'%',65,py);d.text(st.hydric.toFixed(0)+'%',88,py);d.text(st.excess.toFixed(0)+'%',113,py);d.text(st.cold.toFixed(0)+'%',139,py);d.text(String(st.target),162,py);py+=7});d.setFontSize(7);d.text(d.splitTextToSize('* GDU posteriores a R1 son incrementos térmicos orientativos. Las probabilidades reflejan el histórico de la quincena estimada para cada etapa.',180),14,py+8);d.save(`Modelizador_Riesgo_Maiz_${x.h.name.replace(/\s+/g,'_')}_${iso(x.sow)}.pdf`)}

function historyView(){return `<div class="card"><div class="section-title"><h2>Historial de simulaciones</h2><span class="muted">${state.history.length} registros</span></div>${state.history.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Campo/Lote</th><th>Híbrido</th><th>Siembra</th><th>R1</th><th>ENSO</th><th>Score</th><th></th></tr></thead><tbody>${state.history.map(x=>`<tr><td>${new Date(x.created_at).toLocaleString('es-AR')}</td><td>${esc(x.field_name||'')}</td><td>${esc(x.hybrids?.name||x.hybrid_snapshot||'')} ${esc(x.hybrids?.biotechnology||'')}</td><td>${esc(x.sowing_date||'')}</td><td>${esc(x.flowering_date||'')}</td><td>${esc(x.enso_phase||'')}</td><td><span class="badge ${riskClass(Number(x.risk_score||0))[1]}">${Math.round(x.risk_score||0)}/100</span></td><td><button class="danger" data-delete-sim="${x.id}">Eliminar</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Todavía no hay simulaciones.</div>'}</div>`}
function bindHistory(){document.querySelectorAll('[data-delete-sim]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar esta simulación?'))return;const {error}=await sb.from('simulations').delete().eq('id',b.dataset.deleteSim);if(error)return alert(error.message);await loadUserData();render();}));}

function hybridsView(){return `<div class="grid"><div class="card span12"><div class="section-title"><h2>Biblioteca de híbridos</h2><span class="muted">${state.hybrids.length} versiones activas</span></div><p class="muted">La ficha distingue datos publicados, datos validados por usuario y valores fallback del modelo.</p></div>${state.hybrids.map(h=>`<div class="card span6" data-hybrid-card="${h.id}"><div class="section-title"><h3>${esc(h.name)} — ${esc(h.biotechnology||'')}</h3><span class="badge ${h.data_status==='validado_publico'?'low':'medium'}">${esc(h.data_status||'')}</span></div><p class="muted">${esc(h.company||'')} · MR ${h.relative_maturity??'s/d'} · ${esc(h.cycle||'s/d')}</p><div class="profile-grid"><div class="mini">Tecnología<b>${esc(h.technology_verified||h.technology||'s/d')}</b></div><div class="mini">GDU publicado<b>${h.published_gdu_to_flowering??'s/d'}${h.published_gdu_base_c?` · base ${h.published_gdu_base_c}°C`:''}</b></div><div class="mini">Días floración ref.<b>${h.flowering_days_reference??'s/d'}</b></div><div class="mini">Estabilidad<b>${h.stability_score?`${h.stability_score}/5`:'s/d'}</b></div><div class="mini">Densidad mínima<b>${h.density_min_pl_ha?Number(h.density_min_pl_ha).toLocaleString('es-AR'):'s/d'}</b></div><div class="mini">Densidad máxima<b>${h.density_max_pl_ha?Number(h.density_max_pl_ha).toLocaleString('es-AR'):'s/d'}</b></div></div><p><b>Sanidad:</b> ${esc(h.sanitary_profile||'Sin dato público verificado.')}</p><p><b>Posicionamiento:</b> ${esc(h.positioning||'Sin dato público verificado.')}</p><p class="muted">${esc(h.observations||'')}</p>${h.source_url?`<a class="source-link" href="${esc(h.source_url)}" target="_blank" rel="noopener">Fuente técnica</a>`:''}</div>`).join('')}</div>`}
function bindHybridCards(){}

function fieldsView(){return `<div class="grid"><div class="card span5"><h2>Nuevo campo</h2><form id="farmForm"><label class="label">Nombre</label><input id="farmName" required placeholder="Ej. Costa Sacate"><label class="label">Localidad (opcional)</label><input id="farmLocality" placeholder="Ej. Costa Sacate"><div class="form-row"><div><label class="label">Latitud</label><input id="farmLat" type="number" step="any"></div><div><label class="label">Longitud</label><input id="farmLon" type="number" step="any"></div></div><div class="actions"><button id="farmGeo" class="secondary" type="button">📍 Usar mi ubicación</button></div><div id="farmGeoStatus" class="muted"></div><button class="primary" style="margin-top:14px">Guardar campo</button></form><hr style="border:0;border-top:1px solid var(--border);margin:20px 0"><h2>Nuevo lote</h2><form id="fieldForm"><label class="label">Campo</label><select id="fieldFarm" required>${state.farms.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select><label class="label">Nombre del lote</label><input id="newFieldName" required><div class="form-row"><div><label class="label">Área (ha)</label><input id="fieldArea" type="number" step="0.01"></div><div><label class="label">Profundidad de suelo</label><select id="soilDepth"><option value="">Sin dato</option><option>Profundo</option><option>Medio</option><option>Somero</option></select></div></div><label class="label">Ambiente</label><select id="fieldEnv"><option value="">Sin dato</option><option>Alto potencial</option><option>Medio</option><option>Restrictivo</option></select><label class="label">AU máxima del perfil (mm)</label><input id="fieldWaterCapacity" type="number" min="30" max="500" placeholder="Ej. 200"><div class="muted">Capacidad de agua útil total del perfil explorado por el cultivo.</div><div class="note" style="margin-top:12px"><b>Georreferencia del lote</b><div class="form-row" style="margin-top:8px"><div><label class="label">Latitud</label><input id="fieldLat" type="number" step="any"></div><div><label class="label">Longitud</label><input id="fieldLon" type="number" step="any"></div></div><div class="actions"><button id="fieldGeo" class="secondary" type="button">📍 Usar mi ubicación</button><button id="fieldUseFarmGeo" class="ghost" type="button">Usar coordenadas del campo</button></div><div id="fieldGeoStatus" class="muted"></div></div><button class="primary" style="margin-top:14px" ${state.farms.length?'':'disabled'}>Guardar lote</button></form></div><div class="card span7"><h2>Mis campos y lotes</h2>${state.farms.length?state.farms.map(f=>`<div class="history-item"><div class="history-top"><strong>${esc(f.name)}</strong><button class="danger" data-delete-farm="${f.id}">Eliminar</button></div><div class="muted">${esc(f.locality||'')} ${f.latitude!=null?`· ${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}`:''}</div>${state.fields.filter(x=>x.farm_id===f.id).map(x=>`<div style="margin:8px 0 0 12px">↳ <b>${esc(x.name)}</b> ${x.area_ha?`· ${x.area_ha} ha`:''} ${x.environment?`· ${esc(x.environment)}`:''}${x.water_capacity_mm?` · AU máx ${Number(x.water_capacity_mm).toFixed(0)} mm`:''}${x.latitude!=null?` · 📍 ${Number(x.latitude).toFixed(5)}, ${Number(x.longitude).toFixed(5)}`:''} <button class="danger" data-delete-field="${x.id}" style="padding:5px 8px">Eliminar</button></div>`).join('')}</div>`).join(''):'<div class="empty">Todavía no cargaste campos.</div>'}</div></div>`}
function bindFields(){
  $('#farmGeo').addEventListener('click',()=>requestLocation(x=>{$('#farmLat').value=x.lat.toFixed(6);$('#farmLon').value=x.lon.toFixed(6);$('#farmGeo').dataset.accuracy=String(x.accuracy)},$('#farmGeoStatus')));
  $('#fieldGeo').addEventListener('click',()=>requestLocation(x=>{$('#fieldLat').value=x.lat.toFixed(6);$('#fieldLon').value=x.lon.toFixed(6);$('#fieldGeo').dataset.accuracy=String(x.accuracy)},$('#fieldGeoStatus')));
  $('#fieldUseFarmGeo').addEventListener('click',()=>{const f=state.farms.find(x=>String(x.id)===$('#fieldFarm').value);if(f&&validCoord(Number(f.latitude),Number(f.longitude))){$('#fieldLat').value=f.latitude;$('#fieldLon').value=f.longitude;$('#fieldGeoStatus').textContent='Coordenadas copiadas del campo.'}else $('#fieldGeoStatus').textContent='Ese campo no tiene georreferencia guardada.'});
  $('#farmForm').addEventListener('submit',async e=>{e.preventDefault();const lat=$('#farmLat').value?Number($('#farmLat').value):null,lon=$('#farmLon').value?Number($('#farmLon').value):null;if((lat!=null||lon!=null)&&!validCoord(lat,lon))return alert('Revisá latitud y longitud.');const payload={user_id:state.user.id,name:$('#farmName').value.trim(),locality:$('#farmLocality').value.trim()||null,latitude:lat,longitude:lon};const {error}=await sb.from('farms').insert(payload);if(error)return alert(error.message);await loadUserData();render();});
  $('#fieldForm').addEventListener('submit',async e=>{e.preventDefault();const lat=$('#fieldLat').value?Number($('#fieldLat').value):null,lon=$('#fieldLon').value?Number($('#fieldLon').value):null;if((lat!=null||lon!=null)&&!validCoord(lat,lon))return alert('Revisá latitud y longitud del lote.');const payload={farm_id:$('#fieldFarm').value,name:$('#newFieldName').value.trim(),area_ha:$('#fieldArea').value?Number($('#fieldArea').value):null,soil_depth:$('#soilDepth').value||null,environment:$('#fieldEnv').value||null,water_capacity_mm:$('#fieldWaterCapacity').value?Number($('#fieldWaterCapacity').value):null,latitude:lat,longitude:lon,geo_accuracy_m:Number($('#fieldGeo').dataset.accuracy)||null,location_source:Number($('#fieldGeo').dataset.accuracy)?'device':(lat!=null?'manual_or_farm':'none')};const {error}=await sb.from('fields').insert(payload);if(error)return alert(error.message);await loadUserData();render();});
  document.querySelectorAll('[data-delete-field]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar este lote?'))return;const {error}=await sb.from('fields').delete().eq('id',b.dataset.deleteField);if(error)return alert(error.message);await loadUserData();render();}));
  document.querySelectorAll('[data-delete-farm]').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('Eliminar el campo también elimina sus lotes. ¿Continuar?'))return;const {error}=await sb.from('farms').delete().eq('id',b.dataset.deleteFarm);if(error)return alert(error.message);await loadUserData();render();}));
}

sb.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY')setTimeout(()=>resetPasswordView(),0);
});
if(new URLSearchParams(location.search).get('recovery')==='1'){
  // Supabase completará la sesión de recuperación y disparará PASSWORD_RECOVERY.
  setTimeout(()=>{if(!state.recoveryMode)resetPasswordView()},1200);
}else bootstrap();
