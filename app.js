
const STORAGE_KEY = 'green-caddie-data-v2';
const state = loadData();
let navStack = ['home'];
let activeRoundId = state.settings.activeRoundId || null;
let currentView = 'home';
let selectedRoundForDetail = null;

const lieOptions = ['Tee','Fairway','First Cut','Rough','Fringe','Bunker','Recovery','Green','Cup','Penalty'];
const swingOptions = ['Full','Partial','Chip','Punch'];
const clubGroups = [
  ['Driver','3 Wood','5 Wood','4 Hybrid','5 Hybrid'],
  ['3 Iron','4 Iron','5 Iron','6 Iron','7 Iron','8 Iron'],
  ['9 Iron','PW','GW','SW','LW','Putter']
];

let map, tileLayer, mapReady=false;
let mapMode=null;
let currentLayers=[];
let transientPlan=null;
let transientUndo=null;

function loadData(){
  try{
    return Object.assign({rounds:[],courses:[],settings:{}}, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  }catch(e){ return {rounds:[],courses:[],settings:{}}; }
}
function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
const uid=(p='id')=>`${p}_${Math.random().toString(36).slice(2,10)}`;
const yardsFromMeters=m=>Math.round((m||0)*1.09361);
function metersBetween(a,b){
  if(!a || !b) return null;
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  const lat1=toRad(a.lat), lat2=toRad(b.lat);
  const x=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function getActiveRound(){ return state.rounds.find(r=>r.id===activeRoundId) || null; }
function setActiveRound(id){ activeRoundId=id; state.settings.activeRoundId=id; saveData(); }
function getHole(round){ return round.holes[round.currentHoleIndex||0]; }
function ensureDraft(hole){
  if(!hole.currentShotDraft){
    hole.currentShotDraft = {
      shotNumber: hole.shots.length + 1,
      club: '',
      swingType: '',
      manualPinYardage: '',
      startLie: hole.currentLie || 'Tee',
      startGps: null,
      startAccuracyYd: null,
      started: false
    };
  }
  return hole.currentShotDraft;
}
function estimatedToPin(hole){
  const from = hole.currentShotDraft?.startGps || hole.currentLocation || hole.shots.slice().reverse().find(s=>s.endGps)?.endGps || null;
  if(hole.pinLocation && from){
    const m = metersBetween(from, hole.pinLocation);
    return m != null ? yardsFromMeters(m) : null;
  }
  if(hole.holeYardage) return Number(hole.holeYardage);
  return null;
}
function createRound({courseName, holesCount, sourceCourse}){
  const holes = Array.from({length:holesCount}, (_,i)=>{
    const source = sourceCourse?.holes?.[i];
    return {
      holeNumber:i+1,
      par: source?.par ?? 4,
      holeYardage: source?.yardage ?? '',
      pinLocation: source?.pinLocation ?? null,
      pinSource: source?.pinLocation ? 'last_known' : null,
      currentLie: 'Tee',
      shots: [],
      puttCount: null,
      penaltyStrokes: 0,
      score: ''
    };
  });
  return {
    id: uid('round'),
    createdAt: new Date().toISOString(),
    completedAt: null,
    status: 'draft',
    courseName: courseName || sourceCourse?.name || 'Untitled Course',
    holesCount,
    sourceCourseId: sourceCourse?.id || null,
    currentHoleIndex: 0,
    holes
  };
}
function courseFromRound(round){
  return {
    id: uid('course'),
    name: round.courseName,
    holesCount: round.holesCount,
    holes: round.holes.map(h=>({holeNumber:h.holeNumber,par:Number(h.par)||4,yardage:h.holeYardage?Number(h.holeYardage):'',pinLocation:h.pinLocation||null}))
  };
}
function updateCourseFromRound(course, round){
  course.name = round.courseName;
  course.holesCount = round.holesCount;
  course.holes = round.holes.map(h=>({holeNumber:h.holeNumber,par:Number(h.par)||4,yardage:h.holeYardage?Number(h.holeYardage):'',pinLocation:h.pinLocation||null}));
}

function showView(name,push=true){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el=document.getElementById(`view-${name}`);
  if(el) el.classList.add('active');
  currentView=name;
  if(push){
    const last=navStack[navStack.length-1];
    if(last!==name) navStack.push(name);
  }
  if(name==='map') setTimeout(initMapIfNeeded, 20);
  render();
}
function back(){
  if(navStack.length>1) navStack.pop();
  const prev = navStack[navStack.length-1] || 'home';
  showView(prev,false);
}
document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',back));
document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.nav)));

function render(){
  renderHome();
  renderStart();
  renderHole();
  renderScorecard();
  renderHistory();
  renderCourses();
  renderRoundDetail();
}
function renderHome(){
  const btn=document.getElementById('resume-draft-btn');
  const round=getActiveRound();
  btn.hidden = !(round && round.status!=='complete');
  if(!btn.hidden) btn.textContent=`Resume Draft Round • ${round.courseName}`;
}
function renderStart(){
  const select=document.getElementById('start-course-select');
  select.innerHTML='<option value="">New course / no template</option>'+state.courses.map(c=>`<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}
document.getElementById('start-course-select').addEventListener('change',e=>{
  const c=state.courses.find(x=>x.id===e.target.value);
  document.getElementById('start-course-name').value = c?.name || '';
});
document.querySelectorAll('.seg').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.seg').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
}));
document.getElementById('start-round-btn').addEventListener('click',()=>{
  const holesCount=Number(document.querySelector('.seg.active').dataset.holes);
  const courseId=document.getElementById('start-course-select').value;
  const sourceCourse=state.courses.find(c=>c.id===courseId);
  const courseName=document.getElementById('start-course-name').value.trim();
  const round=createRound({courseName, holesCount, sourceCourse});
  state.rounds.unshift(round);
  setActiveRound(round.id);
  saveData();
  navStack=['home','hole'];
  showView('hole',false);
});

function renderHole(){
  const round=getActiveRound(); if(!round) return;
  const hole=getHole(round), draft=ensureDraft(hole);
  document.getElementById('hole-number').textContent=hole.holeNumber;
  document.getElementById('hole-yardage').value=hole.holeYardage;
  document.getElementById('hole-par').value=hole.par;
  document.getElementById('shot-number').textContent=draft.shotNumber;
  document.getElementById('penalties-count').textContent=hole.penaltyStrokes || 0;
  document.getElementById('current-lie-display').textContent=hole.currentLie || draft.startLie || 'Tee';
  const est=estimatedToPin(hole);
  document.getElementById('estimated-pin-display').textContent=est ? est : '—';
  document.getElementById('club-display').textContent=draft.club || 'Select';
  document.getElementById('swing-display').textContent=draft.swingType || 'Select';
  document.getElementById('manual-pin-input').value=draft.manualPinYardage || '';
  document.getElementById('start-gps-row').hidden=!draft.started;
  document.getElementById('start-gps-accuracy').textContent=`GPS ±${draft.startAccuracyYd ?? '—'} yd`;
  document.getElementById('setup-actions').hidden=!!draft.started;
  document.getElementById('waiting-actions').hidden=!draft.started;
  document.getElementById('undo-shot-btn').hidden=!hole.setupUndoVisible;
  document.getElementById('undo-wait-shot-btn').hidden=!hole.waitUndoVisible;
  document.getElementById('scorecard-subtitle').textContent=round.courseName;
}
document.getElementById('hole-yardage').addEventListener('change',e=>{ const hole=getHole(getActiveRound()); hole.holeYardage=e.target.value?Number(e.target.value):''; saveData(); render(); });
document.getElementById('hole-par').addEventListener('change',e=>{ const hole=getHole(getActiveRound()); hole.par=e.target.value?Number(e.target.value):4; saveData(); render(); });
document.getElementById('manual-pin-input').addEventListener('input',e=>{ const draft=ensureDraft(getHole(getActiveRound())); draft.manualPinYardage=e.target.value; saveData(); });

document.getElementById('current-lie-btn').addEventListener('click',()=>{
  openSheet('Current Lie', lieOptions.map(v=>({label:v, action:()=>{ const hole=getHole(getActiveRound()); hole.currentLie=v; ensureDraft(hole).startLie=v; saveData(); render(); closeSheet(); }})));
});

document.getElementById('club-btn').addEventListener('click',()=>{
  const rows = clubGroups.map(group=>`<div class="option-grid">${group.map(v=>`<button class="option-btn club-choice" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join('')}</div>`).join('');
  openCustomSheet('Select Club', rows, ()=>{
    document.querySelectorAll('.club-choice').forEach(btn=>btn.onclick=()=>{
      ensureDraft(getHole(getActiveRound())).club=btn.dataset.value;
      saveData(); render(); closeSheet();
    });
  });
});
document.getElementById('swing-btn').addEventListener('click',()=>{
  openSheet('Select Swing Type', swingOptions.map(v=>({label:v, action:()=>{ ensureDraft(getHole(getActiveRound())).swingType=v; saveData(); render(); closeSheet(); }})));
});

async function captureLocation(){
  return new Promise(resolve=>{
    if(!navigator.geolocation){ alert('Geolocation is not available.'); return resolve(null); }
    navigator.geolocation.getCurrentPosition(pos=>{
      resolve({lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy});
    }, err=>{ alert('Could not get location.'); resolve(null); }, {enableHighAccuracy:true, maximumAge:0, timeout:12000});
  });
}
document.getElementById('hit-from-here-btn').addEventListener('click', async ()=>{
  const hole=getHole(getActiveRound()), draft=ensureDraft(hole);
  const loc=await captureLocation();
  if(!loc) return;
  draft.startGps={lat:loc.lat,lng:loc.lng};
  draft.startAccuracyYd=yardsFromMeters(loc.accuracy);
  draft.started=true;
  hole.setupUndoVisible=false;
  saveData(); render();
});
document.getElementById('refresh-start-gps-btn').addEventListener('click', async ()=>{
  const draft=ensureDraft(getHole(getActiveRound()));
  const loc=await captureLocation(); if(!loc) return;
  draft.startGps={lat:loc.lat,lng:loc.lng};
  draft.startAccuracyYd=yardsFromMeters(loc.accuracy);
  saveData(); render();
});

function advanceNextShot(context){
  const hole=getHole(getActiveRound()), draft=ensureDraft(hole);
  const missed = {
    shotNumber:draft.shotNumber, club:draft.club||'', swingType:draft.swingType||'', manualPinYardage:draft.manualPinYardage||'',
    startLie:draft.startLie||hole.currentLie||'Tee', startGps:draft.startGps||null, startAccuracyYd:draft.startAccuracyYd||null,
    endLie:'', endGps:null, endAccuracyYd:null, gpsDistance:null, resultType:'untracked'
  };
  hole.shots.push(missed);
  hole.currentShotDraft = {shotNumber:hole.shots.length+1, club:'', swingType:'', manualPinYardage:'', startLie:hole.currentLie||missed.startLie, startGps:null, startAccuracyYd:null, started:false};
  if(context==='setup'){ hole.setupUndoVisible=true; hole.waitUndoVisible=false; } else { hole.waitUndoVisible=true; hole.setupUndoVisible=false; }
  saveData(); render();
}
function undoNextShot(context){
  const hole=getHole(getActiveRound());
  if(hole.shots.length) hole.shots.pop();
  hole.currentShotDraft = {shotNumber:hole.shots.length+1, club:'', swingType:'', manualPinYardage:'', startLie:hole.currentLie||'Tee', startGps:null, startAccuracyYd:null, started: context==='wait'};
  hole.setupUndoVisible=false; hole.waitUndoVisible=false;
  saveData(); render();
}
document.getElementById('next-shot-setup-btn').addEventListener('click',()=>advanceNextShot('setup'));
document.getElementById('next-shot-wait-btn').addEventListener('click',()=>advanceNextShot('wait'));
document.getElementById('undo-shot-btn').addEventListener('click',()=>undoNextShot('setup'));
document.getElementById('undo-wait-shot-btn').addEventListener('click',()=>undoNextShot('wait'));

document.getElementById('ball-is-here-btn').addEventListener('click', async ()=>{
  const hole=getHole(getActiveRound());
  const loc=await captureLocation(); if(!loc) return;
  hole.pendingEndGps={lat:loc.lat,lng:loc.lng};
  hole.pendingEndAccYd=yardsFromMeters(loc.accuracy);
  openResultPicker();
});

function openResultPicker(){
  const hole=getHole(getActiveRound());
  const html=`
    <div class="gps-row"><span class="gps-chip">GPS ±${hole.pendingEndAccYd ?? '—'} yd</span><button id="refresh-end-gps" class="refresh-btn">&#x21bb;</button></div>
    <div class="result-grid">
      ${lieOptions.filter(x=>x!=='Tee').map(v=>`<button class="option-btn result-choice" data-value="${v}">${v}</button>`).join('')}
    </div>`;
  openModal('Where did it finish?', html, ()=>{
    document.getElementById('refresh-end-gps').onclick = async ()=>{
      const loc=await captureLocation(); if(!loc) return;
      hole.pendingEndGps={lat:loc.lat,lng:loc.lng}; hole.pendingEndAccYd=yardsFromMeters(loc.accuracy);
      openResultPicker();
    };
    document.querySelectorAll('.result-choice').forEach(btn=>btn.onclick=()=>applyResult(btn.dataset.value));
  });
}
function applyResult(value){
  const round=getActiveRound(), hole=getHole(round), draft=ensureDraft(hole);
  const normalized=value.toLowerCase().replace(' ','_');
  const shot={
    shotNumber:draft.shotNumber, club:draft.club||'', swingType:draft.swingType||'', manualPinYardage:draft.manualPinYardage||'',
    startLie:draft.startLie||hole.currentLie||'Tee', startGps:draft.startGps||null, startAccuracyYd:draft.startAccuracyYd||null,
    endLie:normalized, endGps: normalized==='penalty'?null:hole.pendingEndGps||null, endAccuracyYd: normalized==='penalty'?null:hole.pendingEndAccYd||null, resultType:normalized
  };
  shot.gpsDistance = shot.startGps && shot.endGps ? yardsFromMeters(metersBetween(shot.startGps, shot.endGps)) : null;
  hole.shots.push(shot);
  closeModal();
  if(normalized==='green'){
    hole.currentLie='Green'; delete hole.currentShotDraft; openPutting();
  } else if(normalized==='cup'){
    hole.currentLie='Cup'; hole.puttCount=0; finishHoleAuto();
  } else if(normalized==='penalty'){
    hole.penaltyStrokes=(hole.penaltyStrokes||0)+1;
    hole.currentLie='Penalty';
    hole.currentShotDraft={shotNumber:hole.shots.length+1,club:'',swingType:'',manualPinYardage:'',startLie:'Penalty',startGps:null,startAccuracyYd:null,started:false};
    hole.setupUndoVisible=false; hole.waitUndoVisible=false;
    saveData(); render();
  } else {
    hole.currentLie=value;
    hole.currentShotDraft={shotNumber:hole.shots.length+1,club:'',swingType:'',manualPinYardage:'',startLie:value,startGps:null,startAccuracyYd:null,started:false};
    hole.setupUndoVisible=false; hole.waitUndoVisible=false;
    saveData(); render();
  }
}
function openPutting(){
  const hole=getHole(getActiveRound());
  if(hole.puttCount==null) hole.puttCount=2;
  const html=`<div class="stack"><div class="subtle">On Green</div><div class="two-col"><button id="putt-minus" class="secondary-badge">-</button><button id="putt-plus" class="secondary-badge">+</button></div><div class="score-pill" style="margin:auto">${hole.puttCount}</div><button id="finish-hole-btn" class="action-badge slim">Finish Hole</button></div>`;
  openModal(`Hole ${hole.holeNumber}`, html, ()=>{
    document.getElementById('putt-minus').onclick=()=>{ hole.puttCount=Math.max(1,(hole.puttCount||2)-1); openPutting(); saveData(); };
    document.getElementById('putt-plus').onclick=()=>{ hole.puttCount=(hole.puttCount||2)+1; openPutting(); saveData(); };
    document.getElementById('finish-hole-btn').onclick=()=>{ closeModal(); finishHoleAuto(); };
  });
}
function finishHoleAuto(){
  const round=getActiveRound(), hole=getHole(round);
  if(!hole.score) hole.score = Number(hole.shots.length) + Number(hole.puttCount||0) + Number(hole.penaltyStrokes||0);
  delete hole.currentShotDraft; delete hole.pendingEndGps; delete hole.pendingEndAccYd;
  if(round.currentHoleIndex < round.holesCount - 1){
    round.currentHoleIndex += 1;
  } else {
    round.status='complete'; round.completedAt=new Date().toISOString();
  }
  saveData();
  if(round.status==='complete'){ selectedRoundForDetail=round.id; navStack=['home','round-detail']; showView('round-detail', false); }
  else { showView('hole', false); }
}
document.getElementById('quick-finish-btn').addEventListener('click', ()=>openQuickFinish());
function openQuickFinish(initial){
  const hole=getHole(getActiveRound()); let score = initial || Number(hole.score) || Number(hole.par)||4;
  const html=`<div class="stack"><div class="subtle">Finish Hole Quickly</div><div class="two-col"><button id="score-minus" class="secondary-badge">-</button><button id="score-plus" class="secondary-badge">+</button></div><div class="score-pill" id="quick-score-value" style="margin:auto">${score}</div><button id="save-hole-score-btn" class="action-badge slim">Save Hole</button></div>`;
  openModal(`Hole ${hole.holeNumber}`, html, ()=>{
    document.getElementById('score-minus').onclick=()=>{ score=Math.max(1,score-1); document.getElementById('quick-score-value').textContent=score; };
    document.getElementById('score-plus').onclick=()=>{ score+=1; document.getElementById('quick-score-value').textContent=score; };
    document.getElementById('save-hole-score-btn').onclick=()=>{ hole.score=score; closeModal(); finishHoleAuto(); };
  });
}

document.getElementById('open-scorecard-btn').addEventListener('click',()=>showView('scorecard'));
document.getElementById('back-to-hole-btn').addEventListener('click',()=>showView('hole'));
document.getElementById('go-home-btn').addEventListener('click',()=>showView('home'));

function renderScorecard(){
  const list=document.getElementById('scorecard-list');
  const round=getActiveRound(); if(!round){ list.innerHTML='<div class="subtle">No active round.</div>'; return; }
  list.innerHTML = round.holes.map((h,i)=>`<div class="score-row"><button class="secondary-badge hole-jump" data-hole="${i}">Hole ${h.holeNumber} • Par ${h.par}</button><button class="score-pill score-edit" data-hole="${i}">${h.score || '—'}</button></div>`).join('');
  list.querySelectorAll('.hole-jump').forEach(btn=>btn.onclick=()=>{ round.currentHoleIndex=Number(btn.dataset.hole); saveData(); showView('hole'); });
  list.querySelectorAll('.score-edit').forEach(btn=>btn.onclick=()=>{ round.currentHoleIndex=Number(btn.dataset.hole); openQuickFinish(Number(btn.textContent) || undefined); });
}
function renderHistory(){
  const root=document.getElementById('history-list');
  if(!state.rounds.length){ root.innerHTML='<div class="secondary-badge full">No rounds yet.</div>'; return; }
  root.innerHTML=state.rounds.map(r=>`<div class="history-row"><button class="secondary-badge history-open" data-id="${r.id}">${escapeHtml(r.courseName)}<br><span class="subtle">${new Date(r.createdAt).toLocaleDateString()} • ${r.holesCount} holes</span></button><div class="stack" style="gap:8px;flex:0 0 auto;"><button class="secondary-badge history-export" data-id="${r.id}">Export JSON</button><button class="danger-badge history-delete" data-id="${r.id}">Delete</button></div></div>`).join('');
  root.querySelectorAll('.history-open').forEach(btn=>btn.onclick=()=>{ selectedRoundForDetail=btn.dataset.id; showView('round-detail'); });
  root.querySelectorAll('.history-export').forEach(btn=>btn.onclick=()=>exportRound(btn.dataset.id));
  root.querySelectorAll('.history-delete').forEach(btn=>btn.onclick=()=>{ state.rounds=state.rounds.filter(r=>r.id!==btn.dataset.id); if(activeRoundId===btn.dataset.id) setActiveRound(null); saveData(); render(); });
}
function renderRoundDetail(){
  const round=state.rounds.find(r=>r.id===selectedRoundForDetail); if(!round) return;
  document.getElementById('round-detail-title').textContent=round.courseName;
  document.getElementById('round-detail-subtitle').textContent=`${new Date(round.createdAt).toLocaleDateString()} • ${round.holesCount} holes`;
  document.getElementById('round-detail-holes').innerHTML = round.holes.map(h=>`<div class="hole-row"><div>Hole ${h.holeNumber} • Par ${h.par}</div><div class="score-pill">${h.score || '—'}</div></div>`).join('');
  document.getElementById('round-export-btn').onclick=()=>exportRound(round.id);
  const btn=document.getElementById('round-save-course-btn');
  btn.textContent = round.sourceCourseId ? 'Update Saved Course' : 'Save Course';
  btn.onclick=()=>{
    if(round.sourceCourseId){
      const course=state.courses.find(c=>c.id===round.sourceCourseId);
      if(course) updateCourseFromRound(course, round);
    } else {
      const course=courseFromRound(round); state.courses.push(course); round.sourceCourseId=course.id;
    }
    saveData(); render(); alert('Course saved.');
  };
  document.getElementById('round-delete-btn').onclick=()=>{ state.rounds=state.rounds.filter(r=>r.id!==round.id); saveData(); showView('history'); };
}
function renderCourses(){
  const root=document.getElementById('courses-list');
  if(!state.courses.length){ root.innerHTML='<div class="secondary-badge full">No saved courses yet.</div>'; return; }
  root.innerHTML=state.courses.map(c=>`<div class="course-row"><div><strong>${escapeHtml(c.name)}</strong><br><span class="subtle">${c.holesCount} holes</span></div><div style="display:flex;gap:8px"><button class="secondary-badge course-load" data-id="${c.id}">Load</button><button class="danger-badge course-delete" data-id="${c.id}">Delete</button></div></div>`).join('');
  root.querySelectorAll('.course-load').forEach(btn=>btn.onclick=()=>{ document.getElementById('start-course-select').value=btn.dataset.id; document.getElementById('start-course-name').value=state.courses.find(c=>c.id===btn.dataset.id)?.name || ''; showView('start-round'); });
  root.querySelectorAll('.course-delete').forEach(btn=>btn.onclick=()=>{ state.courses=state.courses.filter(c=>c.id!==btn.dataset.id); saveData(); render(); });
}
document.getElementById('new-course-btn').addEventListener('click',()=>showView('start-round'));

function exportRound(roundId){
  const round=state.rounds.find(r=>r.id===roundId); if(!round) return;
  const safe=(round.courseName||'course').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();
  const blob=new Blob([JSON.stringify(round,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`${new Date(round.createdAt).toISOString().slice(0,10)}-${safe}.json`; a.click(); URL.revokeObjectURL(a.href);
}
function escapeHtml(s=''){ return s.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

// overlays
function openSheet(title, options){
  document.getElementById('sheet-title').textContent=title;
  document.getElementById('sheet-content').innerHTML=options.map((o,i)=>`<button class="option-btn" data-i="${i}">${o.label}</button>`).join('');
  document.getElementById('sheet-overlay').hidden=false;
  document.querySelectorAll('#sheet-content .option-btn').forEach(btn=>btn.onclick=()=>options[Number(btn.dataset.i)].action());
}
function openCustomSheet(title, html, ready){
  document.getElementById('sheet-title').textContent=title;
  document.getElementById('sheet-content').innerHTML=html;
  document.getElementById('sheet-overlay').hidden=false;
  if(ready) ready();
}
function closeSheet(){ document.getElementById('sheet-overlay').hidden=true; }
document.getElementById('sheet-close').addEventListener('click', closeSheet);
document.getElementById('sheet-overlay').addEventListener('click',e=>{ if(e.target.id==='sheet-overlay') closeSheet(); });

function openModal(title, html, ready){
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-content').innerHTML=html;
  document.getElementById('modal-overlay').hidden=false;
  if(ready) ready();
}
function closeModal(){ document.getElementById('modal-overlay').hidden=true; }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click',e=>{ if(e.target.id==='modal-overlay') closeModal(); });

// map and settings
function initMapIfNeeded(){
  if(!mapReady){
    map = L.map('map').setView([33.749,-84.388], 16);
    rebuildTileLayer();
    map.on('click', e=>{
      const round=getActiveRound(); if(!round) return;
      const hole=getHole(round);
      if(mapMode==='set-pin'){
        hole.pinLocation={lat:e.latlng.lat,lng:e.latlng.lng}; hole.pinSource='this_round'; mapMode=null; saveData(); refreshMap();
      } else if(mapMode==='plan-shot'){
        transientPlan={lat:e.latlng.lat,lng:e.latlng.lng}; mapMode=null; refreshMap();
      }
    });
    mapReady=true;
  }
  refreshMap();
}
function rebuildTileLayer(){
  if(tileLayer && map) map.removeLayer(tileLayer);
  const key=(state.settings.maptilerKey || '').trim();
  if(key){
    tileLayer=L.tileLayer(`https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}?key=${key}`, {maxZoom:20, attribution:'&copy; MapTiler'});
  } else {
    tileLayer=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:20, attribution:'&copy; OpenStreetMap'});
  }
  tileLayer.addTo(map);
}
function addCircle(latlng,color,r=7){ return L.circleMarker([latlng.lat,latlng.lng], {radius:r,color,weight:2,fillColor:color,fillOpacity:1}); }
function labelIcon(text){ return L.divIcon({className:'', html:`<div class="line-bubble">${text}</div>`}); }
function refreshMap(){
  if(!mapReady) return;
  currentLayers.forEach(l=>map.removeLayer(l)); currentLayers=[];
  const round=getActiveRound(); if(!round) return;
  const hole=getHole(round);
  document.getElementById('map-title').textContent=`Hole ${hole.holeNumber} Map`;
  document.getElementById('map-subtitle').textContent=`Par ${hole.par} • Yardage ${hole.holeYardage || '—'}`;
  const est=estimatedToPin(hole);
  document.getElementById('map-estimated-display').textContent=est ? est : '—';
  document.getElementById('map-pin-status').textContent=hole.pinLocation ? (hole.pinSource==='last_known'?'Last known':'This round') : 'No pin';
  document.getElementById('map-mode-text').textContent = mapMode==='set-pin' ? 'Tap map to place pin' : mapMode==='plan-shot' ? 'Tap map to place planned shot' : 'Tap Set Pin or Plan Shot';
  document.getElementById('plan-leg-1').textContent='—'; document.getElementById('plan-leg-2').textContent='—';
  let current = hole.currentShotDraft?.startGps || hole.currentLocation || hole.shots.slice().reverse().find(s=>s.endGps)?.endGps || hole.shots[0]?.startGps || null;
  if(current){
    const m=addCircle(current,'#2d7ff9',8).addTo(map); currentLayers.push(m); map.setView([current.lat,current.lng], Math.max(map.getZoom(),17));
  }
  hole.shots.forEach(s=>{
    if(s.startGps){
      const sdot=addCircle(s.startGps,'#2d7ff9',5).addTo(map); currentLayers.push(sdot);
      if(s.endGps){
        const line=L.polyline([[s.startGps.lat,s.startGps.lng],[s.endGps.lat,s.endGps.lng]],{color:'#2d7ff9',weight:3,opacity:.75}).addTo(map);
        currentLayers.push(line);
      }
    }
  });
  if(hole.pinLocation){
    const pin=addCircle(hole.pinLocation,'#d02828',8).addTo(map); currentLayers.push(pin);
  }
  if(transientPlan && current){
    const yp=addCircle(transientPlan,'#e3c61b',8).addTo(map); currentLayers.push(yp);
    const l1=L.polyline([[current.lat,current.lng],[transientPlan.lat,transientPlan.lng]],{color:'#e3c61b',weight:4,opacity:.95}).addTo(map); currentLayers.push(l1);
    const leg1=yardsFromMeters(metersBetween(current, transientPlan)); document.getElementById('plan-leg-1').textContent=leg1;
    const mid1={lat:(current.lat+transientPlan.lat)/2,lng:(current.lng+transientPlan.lng)/2};
    const b1=L.marker([mid1.lat,mid1.lng], {icon:labelIcon(String(leg1))}).addTo(map); currentLayers.push(b1);
    if(hole.pinLocation){
      const l2=L.polyline([[transientPlan.lat,transientPlan.lng],[hole.pinLocation.lat,hole.pinLocation.lng]],{color:'#e3c61b',weight:4,opacity:.95}).addTo(map); currentLayers.push(l2);
      const leg2=yardsFromMeters(metersBetween(transientPlan, hole.pinLocation)); document.getElementById('plan-leg-2').textContent=leg2;
      const mid2={lat:(transientPlan.lat+hole.pinLocation.lat)/2,lng:(transientPlan.lng+hole.pinLocation.lng)/2};
      const b2=L.marker([mid2.lat,mid2.lng], {icon:labelIcon(String(leg2))}).addTo(map); currentLayers.push(b2);
    }
  }
}
document.getElementById('open-map-btn').addEventListener('click',()=>showView('map'));
document.getElementById('map-back-btn').addEventListener('click',()=>showView('hole'));
document.getElementById('set-pin-btn').addEventListener('click',()=>{ mapMode='set-pin'; refreshMap(); });
document.getElementById('plan-shot-btn').addEventListener('click',()=>{ mapMode='plan-shot'; refreshMap(); });
document.getElementById('center-me-btn').addEventListener('click', async ()=>{ const loc=await captureLocation(); if(!loc) return; const hole=getHole(getActiveRound()); hole.currentLocation={lat:loc.lat,lng:loc.lng}; saveData(); refreshMap(); if(map) map.setView([loc.lat,loc.lng],18); });
document.getElementById('clear-plan-btn').addEventListener('click',()=>{
  const btn=document.getElementById('clear-plan-btn');
  if(btn.dataset.mode==='undo'){ transientPlan=transientUndo?.plan || null; transientUndo=null; btn.dataset.mode=''; btn.textContent='Clear Plan'; }
  else { transientUndo={plan: transientPlan}; transientPlan=null; btn.dataset.mode='undo'; btn.textContent='Undo'; }
  refreshMap();
});
document.getElementById('clear-pin-btn').addEventListener('click',()=>{
  const btn=document.getElementById('clear-pin-btn'); const hole=getHole(getActiveRound());
  if(btn.dataset.mode==='undo'){ if(transientUndo?.pin){ hole.pinLocation=transientUndo.pin.location; hole.pinSource=transientUndo.pin.source; } transientUndo=null; btn.dataset.mode=''; btn.textContent='Clear Pin'; }
  else { transientUndo={pin:{location:hole.pinLocation,source:hole.pinSource}}; hole.pinLocation=null; hole.pinSource=null; btn.dataset.mode='undo'; btn.textContent='Undo'; saveData(); }
  refreshMap();
});
document.getElementById('map-settings-btn').addEventListener('click',()=>{
  const key = state.settings.maptilerKey || '';
  const html=`<label class="field"><span>Enter your API key from MapTiler</span><input id="maptiler-key-input" type="text" value="${escapeHtml(key)}" placeholder="Paste your key"></label>
  <div class="two-col"><button id="save-map-key-btn" class="action-badge slim">Save Key</button><button id="clear-map-key-btn" class="secondary-badge">Use OpenStreetMap</button></div>`;
  openModal('Map Settings', html, ()=>{
    document.getElementById('save-map-key-btn').onclick=()=>{
      state.settings.maptilerKey=document.getElementById('maptiler-key-input').value.trim();
      saveData(); rebuildTileLayer(); closeModal(); refreshMap();
    };
    document.getElementById('clear-map-key-btn').onclick=()=>{
      state.settings.maptilerKey=''; saveData(); rebuildTileLayer(); closeModal(); refreshMap();
    };
  });
});

render();
