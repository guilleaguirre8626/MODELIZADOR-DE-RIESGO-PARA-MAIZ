import './styles.css';
import { createClient } from '@supabase/supabase-js';
import Chart from 'chart.js/auto';
import { jsPDF } from 'jspdf';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseReady = Boolean(SUPABASE_URL && SUPABASE_KEY && !SUPABASE_URL.includes('TU-PROYECTO'));
const supabase = supabaseReady ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

let HYBRIDS = [
  {id:null,name:'DK 7272',gdu_to_flowering:790},{id:null,name:'DK 7447',gdu_to_flowering:790},{id:null,name:'DK 6968',gdu_to_flowering:790},{id:null,name:'Brevant 8380',gdu_to_flowering:790},{id:null,name:'Pioneer 2021',gdu_to_flowering:790},{id:null,name:'Stine 9820',gdu_to_flowering:790}
];

async function loadHybrids(){
  if(!supabaseReady) return;
  const {data,error}=await supabase.from('hybrids').select('id,name,gdu_to_flowering').eq('active',true).order('name');
  if(!error && data?.length) HYBRIDS=data;
}

// Priors de trabajo. Reemplazar por frecuencias históricas observadas condicionadas a Niño.
const RISK_BY_MONTH = {
  9:{heat:8,drought:35,excess:20,cold:4},
  10:{heat:12,drought:32,excess:24,cold:2},
  11:{heat:18,drought:28,excess:30,cold:1},
  12:{heat:28,drought:24,excess:34,cold:1},
  1:{heat:42,drought:26,excess:32,cold:1},
  2:{heat:34,drought:20,excess:36,cold:3},
  3:{heat:20,drought:18,excess:30,cold:5}
};
const TEMP_MEAN = {9:16.5,10:19.5,11:22.0,12:24.2,1:25.0,2:24.0,3:21.5,4:17.5};

let currentUser = null;
let currentChart = null;
let lastResult = null;

function fmtDate(d){return new Intl.DateTimeFormat('es-AR').format(d)}
function dateFromInput(v){const [y,m,d]=v.split('-').map(Number);return new Date(Date.UTC(y,m-1,d));}
function addDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
function monthName(m){return ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][m]}

function estimateFlowering(sowDate,gduTarget){
  let d=new Date(sowDate), acc=0, guard=0;
  while(acc<gduTarget && guard<220){
    const m=d.getUTCMonth()+1;
    const t=TEMP_MEAN[m] ?? 18;
    const daily=Math.max(0,t-10);
    acc+=daily;
    d=addDays(d,1); guard++;
  }
  return {date:d,gdu:Math.round(acc),days:guard};
}

function avgRisk(start,end,key){
  let d=new Date(start), vals=[];
  while(d<=end){const m=d.getUTCMonth()+1;vals.push((RISK_BY_MONTH[m]||RISK_BY_MONTH[12])[key]);d=addDays(d,1)}
  return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
}
function scoreRisk(r){return Math.round(r.heat*.35+r.drought*.30+r.excess*.25+r.cold*.10)}
function classRisk(score){if(score<=30)return ['Bajo','low']; if(score<=50)return ['Moderado','medium']; return ['Alto','high'];}

async function saveHistory(item){
  if(supabaseReady && currentUser){
    const payload={
      user_id:currentUser.id,
      field_name:item.field_name || null,
      hybrid_id:item.hybrid_id || null,
      sowing_date:item.sowing_date_iso,
      flowering_date:item.flowering_date_iso,
      critical_start:item.critical_start_iso,
      critical_end:item.critical_end_iso,
      enso_phase:'Nino',
      risk_heat:item.heat_risk,
      risk_cold:item.cold_risk,
      risk_drought:item.drought_risk,
      risk_excess:item.excess_risk,
      risk_score:item.score,
      risk_class:item.risk_class,
      recommendation:item.recommendation,
      model_version:'v0.2'
    };
    const {error}=await supabase.from('simulations').insert(payload);
    if(error) alert('No se pudo guardar el historial: '+error.message);
  } else {
    const arr=JSON.parse(localStorage.getItem('agroclima_history')||'[]');
    arr.unshift({...item,id:crypto.randomUUID(),created_at:new Date().toISOString()});
    localStorage.setItem('agroclima_history',JSON.stringify(arr.slice(0,50)));
  }
}
async function getHistory(){
  if(supabaseReady && currentUser){
    const {data,error}=await supabase.from('simulations').select('*, hybrids(name)').order('created_at',{ascending:false}).limit(20);
    if(error){console.warn(error);return []}
    return (data||[]).map(x=>({
      ...x,
      hybrid:x.hybrids?.name || 'Hibrido',
      score:x.risk_score,
      sow_date:x.sowing_date,
      flowering_date:x.flowering_date
    }));
  }
  return JSON.parse(localStorage.getItem('agroclima_history')||'[]');
}

function loginView(){
  document.querySelector('#app').innerHTML=`<div class="login-wrap card"><div class="brand"><h1>AgroClima Maíz</h1><p>Decisiones de siembra basadas en riesgo agroclimático.</p></div>
    <form id="loginForm"><label>Email</label><input id="email" type="email" required placeholder="productor@ejemplo.com"><label>Contraseña</label><input id="password" type="password" required minlength="6"><div class="actions"><button class="primary" type="submit">Ingresar</button><button class="secondary" type="button" id="signup">Crear usuario</button></div></form>
    <div class="note">${supabaseReady?'Autenticación Supabase activa.':'Modo demo: configurá Supabase para habilitar usuarios reales. En modo demo podés ingresar con cualquier email y contraseña.'}</div></div>`;
  document.querySelector('#loginForm').addEventListener('submit', async e=>{e.preventDefault(); const email=emailEl().value;const password=passEl().value;
    if(supabaseReady){const {data,error}=await supabase.auth.signInWithPassword({email,password}); if(error)return alert(error.message); currentUser=data.user;} else currentUser={id:'demo',email}; dashboard();
  });
  document.querySelector('#signup').addEventListener('click', async ()=>{if(!supabaseReady)return alert('Configurá Supabase para crear usuarios reales.'); const {error}=await supabase.auth.signUp({email:emailEl().value,password:passEl().value}); alert(error?error.message:'Usuario creado. Revisá el email si activaste confirmación.');});
  function emailEl(){return document.querySelector('#email')} function passEl(){return document.querySelector('#password')}
}

async function dashboard(){
  await loadHybrids();
  const history=await getHistory();
  document.querySelector('#app').innerHTML=`<div class="app"><div class="header"><div class="brand"><h1>AgroClima Maíz</h1><p>Centro-norte de Córdoba · escenario Niño</p></div><div><span class="muted">${currentUser?.email||''}</span> <button id="logout" class="ghost">Salir</button></div></div>
  <div class="grid">
    <div class="card span4"><div class="muted">Escenario climático</div><div class="kpi">Niño <small>modelo activo</small></div></div>
    <div class="card span4"><div class="muted">GDU por defecto a floración</div><div class="kpi">790 <small>base 10 °C</small></div></div>
    <div class="card span4"><div class="muted">Consultas guardadas</div><div class="kpi">${history.length}</div></div>

    <div class="card span5"><h2>Nueva simulación</h2><form id="simForm">
      <label>Campo</label><input id="field" placeholder="Ej. Costa Sacate">
      <label>Híbrido</label><select id="hybrid">${HYBRIDS.map(h=>`<option value="${h.name}" data-id="${h.id??''}" data-gdu="${h.gdu_to_flowering}">${h.name}</option>`).join('')}</select>
      <label>Fecha de siembra</label><input id="sow" type="date" value="2026-10-05" required>
      <label>GDU a floración</label><input id="gdu" type="number" min="500" max="1200" value="790" required>
      <label>Agua útil inicial (mm, opcional)</label><input id="water" type="number" min="0" max="300" placeholder="Ej. 140">
      <div class="actions"><button class="primary" type="submit">Analizar siembra</button></div></form>
      <div class="note muted">Los porcentajes actuales son priors de trabajo editables, no frecuencias históricas definitivas.</div>
    </div>

    <div class="card span7" id="result"><h2>Resultado</h2><p class="muted">Completá una simulación para ver recomendación, riesgos y fecha estimada de floración.</p><canvas id="riskChart"></canvas></div>

    <div class="card span12"><h2>Historial</h2><div id="history">${historyHtml(history)}</div></div>
  </div></div>`;

  document.querySelector('#logout').addEventListener('click',async()=>{if(supabaseReady)await supabase.auth.signOut(); currentUser=null;loginView();});
  document.querySelector('#hybrid').addEventListener('change',e=>{document.querySelector('#gdu').value=e.target.selectedOptions[0].dataset.gdu});
  document.querySelector('#simForm').addEventListener('submit',runSimulation);
}

function historyHtml(items){if(!items.length)return '<p class="muted">Todavía no hay consultas guardadas.</p>';return items.map(x=>`<div class="history-item"><div class="history-top"><strong>${x.field_name||'Sin campo'} · ${x.hybrid}</strong><span class="badge ${classRisk(Number(x.score))[1]}">${x.score}/100</span></div><div class="muted">Siembra ${x.sow_date} · Floración ${x.flowering_date||'-'} · ${x.recommendation||''}</div></div>`).join('')}

async function runSimulation(e){
  e.preventDefault();
  const sowInput=document.querySelector('#sow').value; const sow=dateFromInput(sowInput); const gdu=Number(document.querySelector('#gdu').value); const hybridSelect=document.querySelector('#hybrid'); const hybrid=hybridSelect.value; const hybridId=hybridSelect.selectedOptions[0].dataset.id ? Number(hybridSelect.selectedOptions[0].dataset.id) : null; const field=document.querySelector('#field').value.trim();
  const flower=estimateFlowering(sow,gdu); const criticalStart=addDays(flower.date,-15); const criticalEnd=addDays(flower.date,15);
  const risk={heat:avgRisk(criticalStart,criticalEnd,'heat'),drought:avgRisk(criticalStart,criticalEnd,'drought'),excess:avgRisk(criticalStart,criticalEnd,'excess'),cold:avgRisk(criticalStart,criticalEnd,'cold')};
  const score=scoreRisk(risk); const [label,klass]=classRisk(score);
  const alt=[]; for(let delta=-15;delta<=15;delta+=5){const sd=addDays(sow,delta), fl=estimateFlowering(sd,gdu), cs=addDays(fl.date,-15), ce=addDays(fl.date,15);const rr={heat:avgRisk(cs,ce,'heat'),drought:avgRisk(cs,ce,'drought'),excess:avgRisk(cs,ce,'excess'),cold:avgRisk(cs,ce,'cold')}; alt.push({date:sd,score:scoreRisk(rr)})}
  const best=alt.reduce((a,b)=>a.score<b.score?a:b);
  const recommendation=`Riesgo ${label.toLowerCase()}. ${best.score<score?`Mover la siembra hacia ${fmtDate(best.date)} reduce el score estimado a ${best.score}/100.`:'La fecha elegida está dentro de las mejores alternativas del rango evaluado.'}`;
  lastResult={field_name:field,hybrid,hybrid_id:hybridId,sow_date:fmtDate(sow),sowing_date_iso:sowInput,flowering_date:fmtDate(flower.date),flowering_date_iso:flower.date.toISOString().slice(0,10),critical_start:fmtDate(criticalStart),critical_start_iso:criticalStart.toISOString().slice(0,10),critical_end:fmtDate(criticalEnd),critical_end_iso:criticalEnd.toISOString().slice(0,10),score,risk_class:label,heat_risk:risk.heat,drought_risk:risk.drought,excess_risk:risk.excess,cold_risk:risk.cold,recommendation,alts:alt};
  const el=document.querySelector('#result'); el.innerHTML=`<div class="result-title"><h2>Resultado</h2><span class="badge ${klass}">${label}</span></div><div class="kpi">${score}/100 <small>riesgo agroclimático</small></div>
    <p><strong>Floración estimada:</strong> ${fmtDate(flower.date)} · <strong>Período crítico:</strong> ${fmtDate(criticalStart)}–${fmtDate(criticalEnd)}</p>
    ${riskRows(risk)}<div class="note"><strong>Recomendación:</strong> ${recommendation}</div><div class="actions"><button id="pdf" class="primary">Descargar PDF</button></div><canvas id="riskChart"></canvas>`;
  drawChart(alt); document.querySelector('#pdf').addEventListener('click',downloadPdf);
  await saveHistory(lastResult); document.querySelector('#history').innerHTML=historyHtml(await getHistory());
}
function riskRows(r){return [['Calor extremo',r.heat],['Déficit hídrico',r.drought],['Exceso hídrico',r.excess],['Frío extremo',r.cold]].map(([n,v])=>`<div class="risk-row"><span>${n}</span><div class="bar"><span style="width:${Math.min(v,100)}%"></span></div><strong>${v}%</strong></div>`).join('')}
function drawChart(alt){const ctx=document.querySelector('#riskChart'); if(currentChart) currentChart.destroy(); currentChart=new Chart(ctx,{type:'line',data:{labels:alt.map(x=>fmtDate(x.date)),datasets:[{label:'Score de riesgo',data:alt.map(x=>x.score),tension:.25,fill:false}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,max:100,title:{display:true,text:'Riesgo 0–100'}},x:{title:{display:true,text:'Fecha de siembra'}}}}});}
function downloadPdf(){if(!lastResult)return; const d=new jsPDF(); d.setFontSize(18);d.text('Informe de Riesgo Agroclimático - Maíz',14,18);d.setFontSize(11);let y=32;
  const rows=[['Campo',lastResult.field_name||'Sin especificar'],['Híbrido',lastResult.hybrid],['Fecha de siembra',lastResult.sow_date],['Floración estimada',lastResult.flowering_date],['Período crítico',`${lastResult.critical_start} a ${lastResult.critical_end}`],['Score',`${lastResult.score}/100`],['Calor extremo',`${lastResult.heat_risk}%`],['Déficit hídrico',`${lastResult.drought_risk}%`],['Exceso hídrico',`${lastResult.excess_risk}%`],['Frío extremo',`${lastResult.cold_risk}%`]];
  rows.forEach(([a,b])=>{d.setFont(undefined,'bold');d.text(`${a}:`,14,y);d.setFont(undefined,'normal');d.text(String(b),62,y);y+=8}); y+=6;d.setFont(undefined,'bold');d.text('Recomendación',14,y);y+=8;d.setFont(undefined,'normal');d.text(d.splitTextToSize(lastResult.recommendation,180),14,y);y+=28;d.setFontSize(9);d.text('Nota: esta versión usa priors climáticos de trabajo. Deben recalibrarse con series históricas observadas condicionadas a ENSO.',14,280);d.save('informe-riesgo-maiz.pdf');}

(async()=>{if(supabaseReady){const {data}=await supabase.auth.getSession();currentUser=data.session?.user||null;} currentUser?dashboard():loginView();})();
