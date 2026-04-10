
const STORAGE_KEY = 'green-caddie-data-v1';
const defaultData = { rounds: [], courses: [], settings: {} };
let state = loadData();
let navStack = ['home'];
let activeRoundId = state.settings.activeRoundId || null;
let currentView = 'home';
let modalAction = null;
let sheetAction = null;
let map, mapReady = false;
let tileLayer = null;
let currentMarkers = [];
let mapMode = null; // set-pin or plan-shot
let transientPlan = null;
let transientUndo = null; // {type:'plan'|'pin', value}
let lastNextShotUndo = null; // {context:'setup'|'wait', holeIndex, priorState}
let selectedRoundForDetail = null;

const clubOptions = ['Driver','3 Wood','5 Wood','4 Hybrid','5 Hybrid','3 Iron','4 Iron','5 Iron','6 Iron','7 Iron','8 Iron','9 Iron','PW','GW','SW','LW','Putter'];
const swingOptions = ['Full','Partial','Chip','Punch'];

function loadData(){
  try{
    return { ...defaultData, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  }catch(e){ return structuredClone(defaultData); }
}
function saveData(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function uid(prefix='id'){ return prefix + '_' + Math.random().toString(36).slice(2,10); }
function yardsFromMeters(m){ return Math.round((m||0) * 1.09361); }
function metersBetween(a,b){
  if(!a || !b) return null;
  const R = 6371000;
  const toRad = d => d*Math.PI/180;
  const dLat = toRad(b.lat-a.lat);
  const dLng = toRad(b.lng-a.lng);
  const lat1=toRad(a.lat), lat2=toRad(b.lat);
  const x = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
}
function getActiveRound(){ return state.rounds.find(r=>r.id===activeRoundId) || null; }
function setActiveRound(id){
  activeRoundId = id;
  state.settings.activeRoundId = id;
  saveData();
}
function getCurrentHole(round){
  return round.holes[round.currentHoleIndex || 0];
}
function createRound({courseName, holesCount, sourceCourse=null}){
  const holes = Array.from({length: holesCount}, (_,i)=>{
    const sourceHole = sourceCourse?.holes?.[i];
    return {
      holeNumber: i+1,
      par: sourceHole?.par ?? 4,
      holeYardage: sourceHole?.yardage ?? '',
      pinLocation: sourceHole?.pinLocation || null,
      pinSource: sourceHole?.pinLocation ? 'last_known' : null,
      currentLie: i===0 ? 'Tee' : 'Tee',
      shots: [],
      puttCount: null,
      penaltyStrokes: 0,
      score: '',
      quickFinished: false
    }
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
function createCourseFromRound(round){
  return {
    id: uid('course'),
    name: round.courseName || 'Unnamed Course',
    holesCount: round.holesCount,
    holes: round.holes.map(h => ({
      holeNumber: h.holeNumber,
      par: Number(h.par) || 4,
      yardage: h.holeYardage ? Number(h.holeYardage) : '',
      pinLocation: h.pinLocation || null
    }))
  };
}
function updateCourseFromRound(course, round){
  course.name = round.courseName || course.name;
  course.holesCount = round.holesCount;
  course.holes = round.holes.map(h => ({
    holeNumber: h.holeNumber,
    par: Number(h.par) || 4,
    yardage: h.holeYardage ? Number(h.holeYardage) : '',
    pinLocation: h.pinLocation || null
  }));
  return course;
}
function computeEstimatedToPin(round, hole){
  // priority: current round pin, last known pin (already copied), fallback hole yardage
  const from = hole.pendingStartGps || hole.currentLocation || null;
  if(hole.pinLocation && from){
    const meters = metersBetween(from, hole.pinLocation);
    return meters != null ? yardsFromMeters(meters) : null;
  }
  if(hole.holeYardage){
    return Number(hole.holeYardage);
  }
  return null;
}
function ensureShotDraft(hole){
  if(!hole.currentShotDraft){
    hole.currentShotDraft = {
      shotNumber: (hole.shots.length || 0) + 1,
      club: '',
      swingType: '',
      manualPinYardage: '',
      estimatedPinYardage: computeEstimatedToPin(getActiveRound(), hole),
      startLie: hole.currentLie || 'Tee',
      startGps: null,
      startAccuracyYd: null,
      endGps: null,
      endAccuracyYd: null,
      endLie: '',
      resultType: '',
      started: false
    };
  }
  return hole.currentShotDraft;
}
function clearDraft(hole){ delete hole.currentShotDraft; delete hole.pendingEndGps; delete hole.pendingEndAccYd; delete hole.pendingStartGps; delete hole.pendingStartAccYd; delete hole.startUndoVisible; delete hole.waitUndoVisible; }
function render(){
  renderResumeButton();
  renderStartRound();
  renderHole();
  renderScorecard();
  renderHistory();
  renderCourses();
  renderRoundDetail();
}
function showView(name, push=true){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if(el) el.classList.add('active');
  currentView = name;
  if(push){
    const last = navStack[navStack.length-1];
    if(last !== name) navStack.push(name);
  }
  if(name === 'map') setTimeout(initMapIfNeeded, 10);
  render();
}
function back(){
  if(navStack.length > 1) navStack.pop();
  const prev = navStack[navStack.length-1] || 'home';
  showView(prev, false);
}
document.querySelectorAll('[data-back]').forEach(btn => btn.addEventListener('click', back));
document.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
  const target = btn.getAttribute('data-nav');
  if(target === 'scorecard' && !getActiveRound()) return;
  showView(target);
}));
document.getElementById('go-home-btn').addEventListener('click', ()=>showView('home'));
document.getElementById('hole-scorecard-btn').addEventListener('click', ()=>showView('scorecard'));

function renderResumeButton(){
  const btn = document.getElementById('resume-draft-btn');
  const r = getActiveRound();
  const show = !!(r && r.status !== 'complete');
  btn.hidden = !show;
  if(show){
    btn.textContent = `Resume Round • ${r.courseName}`;
    btn.onclick = ()=>showView('hole');
  }
}

function renderStartRound(){
  const sel = document.getElementById('start-course-select');
  sel.innerHTML = '<option value="">New course / no template</option>' + state.courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}
document.querySelectorAll('.seg').forEach(btn => btn.addEventListener('click', ()=>{
  document.querySelectorAll('.seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
}));
document.getElementById('start-course-select').addEventListener('change', e=>{
  const c = state.courses.find(x=>x.id===e.target.value);
  document.getElementById('start-course-name').value = c?.name || '';
});
document.getElementById('start-round-btn').addEventListener('click', ()=>{
  const holesCount = Number(document.querySelector('.seg.active').dataset.holes);
  const courseId = document.getElementById('start-course-select').value;
  const sourceCourse = state.courses.find(c=>c.id===courseId) || null;
  const courseName = document.getElementById('start-course-name').value.trim();
  const round = createRound({courseName, holesCount, sourceCourse});
  state.rounds.unshift(round);
  setActiveRound(round.id);
  saveData();
  navStack = ['home','hole'];
  showView('hole', false);
});

function holeElems(){
  return {
    holeNumber: document.getElementById('hole-number'),
    holePar: document.getElementById('hole-par'),
    holeYardage: document.getElementById('hole-yardage'),
    shotNumber: document.getElementById('shot-number'),
    penaltiesCount: document.getElementById('penalties-count'),
    currentLie: document.getElementById('current-lie-display'),
    estimated: document.getElementById('estimated-pin-display'),
    club: document.getElementById('club-display'),
    swing: document.getElementById('swing-display'),
    manualPin: document.getElementById('manual-pin-input'),
    startRow: document.getElementById('start-gps-row'),
    startGpsAcc: document.getElementById('start-gps-accuracy'),
    undoSetup: document.getElementById('undo-shot-btn'),
    hitBtn: document.getElementById('hit-from-here-btn'),
    ballBtn: document.getElementById('ball-is-here-btn'),
    nextRow: document.getElementById('single-next-row'),
  }
}
function renderHole(){
  const round = getActiveRound();
  if(!round){ return; }
  const hole = getCurrentHole(round);
  ensureShotDraft(hole);
  const draft = hole.currentShotDraft;
  const el = holeElems();
  el.holeNumber.textContent = hole.holeNumber;
  el.holePar.value = hole.par;
  el.holeYardage.value = hole.holeYardage;
  el.shotNumber.textContent = draft.shotNumber;
  el.penaltiesCount.textContent = hole.penaltyStrokes || 0;
  el.currentLie.textContent = hole.currentLie || draft.startLie || 'Tee';
  const est = computeEstimatedToPin(round, hole);
  draft.estimatedPinYardage = est ?? '';
  el.estimated.textContent = est ? `${est}` : '—';
  el.club.textContent = draft.club || 'Select';
  el.swing.textContent = draft.swingType || 'Select';
  el.manualPin.value = draft.manualPinYardage || '';
  el.startRow.hidden = !draft.started;
  el.startGpsAcc.textContent = `GPS ±${draft.startAccuracyYd ?? '—'} yd`;
  el.hitBtn.hidden = !!draft.started;
  el.ballBtn.hidden = !draft.started;
  el.nextRow.hidden = false;
  el.undoSetup.hidden = !(hole.startUndoVisible || hole.waitUndoVisible);
  document.getElementById('scorecard-subtitle').textContent = round.courseName;
  document.getElementById('map-title').textContent = `Hole ${hole.holeNumber} Map`;
  document.getElementById('map-subtitle').textContent = `Par ${hole.par} • Yardage ${hole.holeYardage || '—'}`;
}
document.getElementById('hole-par').addEventListener('change', e=>{
  const hole = getCurrentHole(getActiveRound());
  hole.par = Number(e.target.value) || 4; saveData(); render();
});
document.getElementById('hole-yardage').addEventListener('change', e=>{
  const hole = getCurrentHole(getActiveRound());
  hole.holeYardage = e.target.value ? Number(e.target.value) : ''; saveData(); render();
});

document.getElementById('penalty-plus-btn').addEventListener('click', ()=>{ const hole=getCurrentHole(getActiveRound()); hole.penaltyStrokes=(hole.penaltyStrokes||0)+1; saveData(); render(); });
document.getElementById('penalty-minus-btn').addEventListener('click', ()=>{ const hole=getCurrentHole(getActiveRound()); hole.penaltyStrokes=Math.max(0,(hole.penaltyStrokes||0)-1); saveData(); render(); });

document.getElementById('current-lie-btn').addEventListener('click', ()=>{
  const round = getActiveRound(); const hole = getCurrentHole(round);
  const options = ['Tee','Fairway','First Cut','Rough','Fringe','Bunker','Recovery','Green','Cup','Penalty'];
  openSheet('Select Current Lie', options.map(v=>({label:v, action:()=>{hole.currentLie=v; ensureShotDraft(hole).startLie=v; saveData(); render(); closeSheet();}})), 'option-grid-2');
});

document.getElementById('manual-pin-input').addEventListener('input', e=>{
  const hole = getCurrentHole(getActiveRound());
  ensureShotDraft(hole).manualPinYardage = e.target.value;
  saveData();
});
document.getElementById('club-btn').addEventListener('click', ()=>{
  const hole = getCurrentHole(getActiveRound()); const draft=ensureShotDraft(hole);
  const columns = [
    ['Driver','3 Wood','5 Wood','5 Hybrid','3 Iron'],
    ['4 Iron','5 Iron','6 Iron','7 Iron','8 Iron','9 Iron'],
    ['PW','GW','SW','LW','Putter']
  ];
  const html = `<div class="option-grid-3">${columns.map(col=>`<div class="stack">${col.map(v=>`<button class="option-btn club-pick" data-club="${v}">${v}</button>`).join('')}</div>`).join('')}</div>`;
  openModal('Select Club', html, ()=>{
    document.querySelectorAll('.club-pick').forEach(btn=>btn.onclick = ()=>{
      draft.club = btn.dataset.club; saveData(); render(); closeModal();
    });
  });
});
document.getElementById('swing-btn').addEventListener('click', ()=>{
  const hole = getCurrentHole(getActiveRound()); const draft=ensureShotDraft(hole);
  openSheet('Select Swing Type', swingOptions.map(v=>({label:v, action:()=>{draft.swingType=v; saveData(); render(); closeSheet();}})), 'option-grid-2');
});
document.getElementById('hit-from-here-btn').addEventListener('click', async ()=>{
  const hole = getCurrentHole(getActiveRound()); const draft=ensureShotDraft(hole);
  const geo = await captureLocation();
  if(geo){
    draft.startGps = geo.latlng;
    draft.startAccuracyYd = yardsFromMeters(geo.accuracy);
    draft.started = true;
    draft.startLie = hole.currentLie || draft.startLie;
    hole.startUndoVisible = false;
    saveData(); render();
  }
});
document.getElementById('refresh-start-gps-btn').addEventListener('click', async ()=>{
  const hole = getCurrentHole(getActiveRound()); const draft=ensureShotDraft(hole);
  const geo = await captureLocation();
  if(geo){
    draft.startGps = geo.latlng;
    draft.startAccuracyYd = yardsFromMeters(geo.accuracy);
    saveData(); render();
  }
});
function advanceNextShot(context){
  const round = getActiveRound(); const hole = getCurrentHole(round); const draft=ensureShotDraft(hole);
  lastNextShotUndo = {context, snapshot: JSON.parse(JSON.stringify({hole}))};
  const missed = {
    shotNumber: draft.shotNumber,
    club: draft.club || '',
    swingType: draft.swingType || '',
    manualPinYardage: draft.manualPinYardage || '',
    estimatedPinYardage: draft.estimatedPinYardage || '',
    startLie: draft.startLie || hole.currentLie || 'Tee',
    endLie: '',
    resultType: 'untracked',
    started: !!draft.started,
    startGps: draft.startGps || null,
    startAccuracyYd: draft.startAccuracyYd || null,
    endGps: null,
    endAccuracyYd: null,
    gpsDistance: null,
    notes: 'Advanced via Next Shot'
  };
  hole.shots.push(missed);
  hole.currentLie = hole.currentLie || missed.startLie;
  hole.currentShotDraft = {
    shotNumber: hole.shots.length + 1,
    club: '',
    swingType: '',
    manualPinYardage: '',
    estimatedPinYardage: computeEstimatedToPin(round, hole),
    startLie: hole.currentLie || 'Fairway',
    startGps: null,
    startAccuracyYd: null,
    started: false
  };
  if(context === 'setup'){ hole.startUndoVisible = true; hole.waitUndoVisible = false; }
  else { hole.waitUndoVisible = true; hole.startUndoVisible = false; hole.currentShotDraft.started = false; }
  saveData(); render();
}
document.getElementById('next-shot-btn').addEventListener('click', ()=>{ const hole=getCurrentHole(getActiveRound()); const draft=ensureShotDraft(hole); advanceNextShot(draft.started ? 'wait' : 'setup'); });
function undoNextShot(context){
  const round = getActiveRound(); const hole = getCurrentHole(round);
  if(hole.shots.length) hole.shots.pop();
  hole.currentShotDraft = {
    shotNumber: hole.shots.length + 1,
    club: '',
    swingType: '',
    manualPinYardage: '',
    estimatedPinYardage: computeEstimatedToPin(round, hole),
    startLie: hole.currentLie || 'Tee',
    startGps: null,
    startAccuracyYd: null,
    started: context === 'wait' ? true : false
  };
  if(context === 'wait'){
    const prior = hole.shots[hole.shots.length-1];
    hole.currentShotDraft = {
      shotNumber: hole.shots.length + 1,
      club: '',
      swingType: '',
      manualPinYardage: '',
      estimatedPinYardage: computeEstimatedToPin(round, hole),
      startLie: hole.currentLie || 'Tee',
      startGps: prior?.startGps || null,
      startAccuracyYd: prior?.startAccuracyYd || null,
      started: true
    };
  }
  hole.startUndoVisible = false;
  hole.waitUndoVisible = false;
  saveData(); render();
}
document.getElementById('undo-shot-btn').addEventListener('click', ()=>{ const hole=getCurrentHole(getActiveRound()); undoNextShot(hole.waitUndoVisible ? 'wait' : 'setup'); });

document.getElementById('ball-is-here-btn').addEventListener('click', async ()=>{
  const geo = await captureLocation();
  if(!geo) return;
  const hole = getCurrentHole(getActiveRound());
  hole.pendingEndGps = geo.latlng;
  hole.pendingEndAccYd = yardsFromMeters(geo.accuracy);
  openResultPicker();
});
function openResultPicker(){
  const hole = getCurrentHole(getActiveRound());
  const gpsText = `GPS ±${hole.pendingEndAccYd ?? '—'} yd`;
  const results = ['Fairway','First Cut','Rough','Fringe','Bunker','Recovery','Green','Cup','Penalty'];
  const grid = `
    <div class="gps-row"><span class="gps-chip">${gpsText}</span><button id="refresh-end-gps" class="icon-btn small">&#x21bb;</button></div>
    <div class="result-grid">
      ${results.map(r=>`<button class="option-btn result-btn" data-result="${r}">${r}</button>`).join('')}
    </div>`;
  openModal('Where did it finish?', grid, ()=>{
    document.getElementById('refresh-end-gps').onclick = async ()=>{
      const geo = await captureLocation();
      if(geo){
        hole.pendingEndGps = geo.latlng;
        hole.pendingEndAccYd = yardsFromMeters(geo.accuracy);
        openResultPicker();
      }
    };
    document.querySelectorAll('.result-btn').forEach(btn=>{
      btn.onclick = ()=>applyResult(btn.dataset.result);
    });
  });
}
function applyResult(result){
  const round = getActiveRound();
  const hole = getCurrentHole(round);
  const draft = ensureShotDraft(hole);
  const normalized = result.toLowerCase().replace(' ','_');
  const shot = {
    shotNumber: draft.shotNumber,
    club: draft.club || '',
    swingType: draft.swingType || '',
    manualPinYardage: draft.manualPinYardage || '',
    estimatedPinYardage: draft.estimatedPinYardage || '',
    startLie: draft.startLie || hole.currentLie || 'Tee',
    startGps: draft.startGps || null,
    startAccuracyYd: draft.startAccuracyYd || null,
    endLie: normalized,
    endGps: normalized === 'penalty' ? null : hole.pendingEndGps || null,
    endAccuracyYd: normalized === 'penalty' ? null : hole.pendingEndAccYd || null,
    resultType: normalized,
    started: true
  };
  if(shot.startGps && shot.endGps){
    shot.gpsDistance = yardsFromMeters(metersBetween(shot.startGps, shot.endGps));
  } else {
    shot.gpsDistance = null;
  }
  hole.shots.push(shot);
  closeModal();

  if(normalized === 'green'){
    hole.currentLie = 'Green';
    hole.currentShotDraft = null;
    openPuttingModal();
  } else if(normalized === 'cup'){
    hole.currentLie = 'Cup';
    hole.puttCount = 0;
    finalizeHoleAuto();
  } else if(normalized === 'penalty'){
    hole.penaltyStrokes = (hole.penaltyStrokes || 0) + 1;
    hole.currentLie = 'Penalty';
    hole.currentShotDraft = {
      shotNumber: hole.shots.length + 1,
      club: '', swingType: '', manualPinYardage: '',
      estimatedPinYardage: computeEstimatedToPin(round, hole),
      startLie: hole.currentLie,
      startGps: null, startAccuracyYd: null, started:false
    };
    hole.startUndoVisible = false; hole.waitUndoVisible = false;
    saveData(); render();
  } else {
    hole.currentLie = result;
    hole.currentShotDraft = {
      shotNumber: hole.shots.length + 1,
      club: '', swingType: '', manualPinYardage: '',
      estimatedPinYardage: computeEstimatedToPin(round, hole),
      startLie: result,
      startGps: null, startAccuracyYd: null, started:false
    };
    hole.startUndoVisible = false; hole.waitUndoVisible = false;
    saveData(); render();
  }
}
function openPuttingModal(){
  const hole = getCurrentHole(getActiveRound());
  if(hole.puttCount == null) hole.puttCount = 2;
  const html = `
    <div class="stack">
      <div class="subtle">On Green</div>
      <div class="row" style="align-items:center">
        <button id="putt-minus" class="secondary">-</button>
        <div class="card" style="text-align:center"><div class="value" id="putt-count-display">${hole.puttCount}</div></div>
        <button id="putt-plus" class="secondary">+</button>
      </div>
      <button id="finish-hole-btn" class="primary">Finish Hole</button>
    </div>`;
  openModal(`Hole ${hole.holeNumber}`, html, ()=>{
    document.getElementById('putt-minus').onclick = ()=>{ hole.puttCount = Math.max(1, (hole.puttCount||2)-1); openPuttingModal(); saveData(); };
    document.getElementById('putt-plus').onclick = ()=>{ hole.puttCount = (hole.puttCount||2)+1; openPuttingModal(); saveData(); };
    document.getElementById('finish-hole-btn').onclick = ()=>{
      finalizeHoleAuto();
      closeModal();
    };
  });
}
function finalizeHoleAuto(){
  const round = getActiveRound();
  const hole = getCurrentHole(round);
  if(!hole.score){
    hole.score = Number(hole.shots.length) + Number(hole.puttCount || 0) + Number(hole.penaltyStrokes || 0);
  }
  goToNextHole();
}
function goToNextHole(){
  const round = getActiveRound();
  const hole = getCurrentHole(round);
  clearDraft(hole);
  if(round.currentHoleIndex < round.holesCount - 1){
    round.currentHoleIndex += 1;
    const nextHole = getCurrentHole(round);
    ensureShotDraft(nextHole);
  } else {
    round.status = 'complete';
    round.completedAt = new Date().toISOString();
  }
  saveData(); render();
  if(round.status === 'complete'){
    selectedRoundForDetail = round.id;
    navStack = ['home','round-detail'];
    showView('round-detail', false);
  } else {
    showView('hole', false);
  }
}
document.getElementById('quick-finish-btn').addEventListener('click', ()=>openQuickFinish());
function openQuickFinish(prefillScore=null, stayOnScorecard=false){
  const hole = getCurrentHole(getActiveRound());
  let score = prefillScore || hole.score || Number(hole.par || 4) || 4;
  let putts = hole.puttCount;
  const puttDisplay = ()=> (putts == null ? '—' : String(putts));
  const html = `
    <div class="stack">
      <div class="qf-grid">
        <div class="qf-label">Score</div>
        <div class="qf-value-wrap">
          <button id="score-minus" class="secondary qf-mini">−</button>
          <div class="qf-value" id="quick-score-display">${score}</div>
          <button id="score-plus" class="secondary qf-mini">+</button>
        </div>
      </div>
      <div class="qf-grid">
        <div class="qf-label">Putts</div>
        <div class="qf-value-wrap">
          <button id="putts-minus" class="secondary qf-mini">−</button>
          <div class="qf-value" id="quick-putts-display">${puttDisplay()}</div>
          <button id="putts-plus" class="secondary qf-mini">+</button>
        </div>
      </div>
      <button id="save-hole-score-btn" class="secondary">Save Hole</button>
    </div>`;
  openModal(`Hole ${hole.holeNumber}`, html, ()=>{
    document.getElementById('score-minus').onclick = ()=>{ score = Math.max(1, score-1); document.getElementById('quick-score-display').textContent = score; };
    document.getElementById('score-plus').onclick = ()=>{ score += 1; document.getElementById('quick-score-display').textContent = score; };
    document.getElementById('putts-plus').onclick = ()=>{ putts = putts == null ? 0 : putts + 1; document.getElementById('quick-putts-display').textContent = puttDisplay(); };
    document.getElementById('putts-minus').onclick = ()=>{ putts = putts == null ? null : (putts <= 0 ? null : putts - 1); document.getElementById('quick-putts-display').textContent = puttDisplay(); };
    document.getElementById('save-hole-score-btn').onclick = ()=>{
      hole.score = score;
      if(putts != null) hole.puttCount = putts;
      hole.quickFinished = true;
      closeModal();
      if(stayOnScorecard){ saveData(); renderScorecard(); }
      else { goToNextHole(); }
    };
  });
}
document.getElementById('open-scorecard-btn').addEventListener('click', ()=>showView('scorecard'));
document.getElementById('back-to-hole-btn').addEventListener('click', ()=>showView('hole'));

function renderScorecard(){
  const list = document.getElementById('scorecard-list');
  const round = getActiveRound();
  if(!round){ list.innerHTML = '<div class="subtle">No active round.</div>'; return; }
  const renderCol = (holes, offset=0) => {
    const rows = holes.map((h,i)=>`
      <div class="score-row scorecard-row" id="scorecard-row-${i+offset}">
        <button class="secondary hole-jump" data-hole="${i+offset}">Hole ${h.holeNumber}</button>
        <label class="inline-field" style="padding:6px 6px">Par <input class="scorecard-par-input" data-hole="${i+offset}" type="number" min="3" max="7" value="${h.par}"></label>
        <button class="score-pill score-edit" data-hole="${i+offset}">${h.score || '—'}</button>
      </div>`).join('');
    const played = holes.filter(h=>h.score != null && h.score !== '');
    const total = played.reduce((a,h)=>a+(Number(h.score)||0),0);
    const par = played.reduce((a,h)=>a+(Number(h.par)||0),0);
    const diff = played.length ? (total-par) : null;
    const diffText = diff == null ? '—' : `${diff>0?'+':''}${diff}`;
    return `<div class="card stack frost-card" style="gap:6px">${rows}<div class="score-row"><div>Total</div><div class="score-pill">${played.length ? total : '—'}</div><div class="score-pill">${diffText}</div></div></div>`;
  };
  list.innerHTML = `<div class="scorecard-columns">${renderCol(round.holes.slice(0,9),0)}${round.holes.length>9 ? renderCol(round.holes.slice(9),9) : ''}</div>`;
  list.querySelectorAll('.hole-jump').forEach(btn=>btn.onclick = ()=>{
    round.currentHoleIndex = Number(btn.dataset.hole);
    saveData(); showView('hole');
  });
  list.querySelectorAll('.score-edit').forEach(btn=>btn.onclick = ()=>{
    round.currentHoleIndex = Number(btn.dataset.hole);
    openQuickFinish(Number(btn.textContent) || undefined, true);
  });
  list.querySelectorAll('.scorecard-par-input').forEach(inp=>inp.onchange = ()=>{
    const h = round.holes[Number(inp.dataset.hole)];
    h.par = Number(inp.value) || h.par;
    saveData(); renderScorecard();
  });
  requestAnimationFrame(()=>{
    const row = document.getElementById(`scorecard-row-${round.currentHoleIndex}`);
    row?.scrollIntoView({block:'center', behavior:'smooth'});
  });
}

function renderHistory(){
  const root = document.getElementById('history-list');
  if(!state.rounds.length){ root.innerHTML = '<div class="card subtle">No rounds yet.</div>'; return; }
  root.innerHTML = state.rounds.map(r=>`
    <div class="history-row">
      <button class="secondary history-open" data-id="${r.id}">
        <strong>${escapeHtml(r.courseName)}</strong><br>
        <span class="subtle">${new Date(r.createdAt).toLocaleDateString()} • ${r.holesCount} holes</span>
      </button>
      <div class="stack" style="gap:8px; flex:0 0 auto;">
        <button class="secondary history-export" data-id="${r.id}">Export JSON</button>
        <button class="danger history-delete" data-id="${r.id}">Delete</button>
      </div>
    </div>`).join('');
  root.querySelectorAll('.history-open').forEach(btn=>btn.onclick = ()=>{
    selectedRoundForDetail = btn.dataset.id;
    showView('round-detail');
  });
  root.querySelectorAll('.history-export').forEach(btn=>btn.onclick = ()=>exportRound(btn.dataset.id));
  root.querySelectorAll('.history-delete').forEach(btn=>btn.onclick = ()=>{
    state.rounds = state.rounds.filter(r=>r.id!==btn.dataset.id);
    if(activeRoundId===btn.dataset.id) setActiveRound(null);
    saveData(); render();
  });
}
function renderRoundDetail(){
  const round = state.rounds.find(r=>r.id===selectedRoundForDetail);
  if(!round) return;
  document.getElementById('round-detail-title').textContent = round.courseName;
  document.getElementById('round-detail-subtitle').textContent = `${new Date(round.createdAt).toLocaleDateString()} • ${round.holesCount} holes`;
  const wrap = document.getElementById('round-detail-holes');
  const front = round.holes.slice(0,9);
  const back = round.holes.slice(9);
  const frontPlayed = front.filter(h=>h.score != null && h.score !== '');
  const backPlayed = back.filter(h=>h.score != null && h.score !== '');
  const frontScore = frontPlayed.reduce((a,h)=>a+(Number(h.score)||0),0);
  const backScore = backPlayed.reduce((a,h)=>a+(Number(h.score)||0),0);
  const totalScore = [...frontPlayed,...backPlayed].reduce((a,h)=>a+(Number(h.score)||0),0);
  const teeDriverShots = round.holes.map(h=>h.shots.find(s=>(s.startLie||'').toLowerCase()==='tee' && (s.club||'').toLowerCase()==='driver' && s.gpsDistance!=null)).filter(Boolean);
  const avgDrive = teeDriverShots.length ? Math.round(teeDriverShots.reduce((a,s)=>a+s.gpsDistance,0)/teeDriverShots.length) : null;
  const teeShots = round.holes.map(h=>h.shots.find(s=>(s.startLie||'').toLowerCase()==='tee')).filter(Boolean);
  const fairwayHits = teeShots.filter(s=>['fairway','first_cut','fringe','cup','green'].includes((s.endLie||'').toLowerCase())).length || null;
  const fairwayMisses = teeShots.filter(s=>['rough','bunker','penalty','recovery'].includes((s.endLie||'').toLowerCase())).length || null;
  const puttHoles = round.holes.filter(h=>h.puttCount != null);
  const avgPutts = puttHoles.length ? (puttHoles.reduce((a,h)=>a+Number(h.puttCount||0),0)/puttHoles.length).toFixed(1) : null;
  const totalPen = round.holes.reduce((a,h)=>a+Number(h.penaltyStrokes||0),0);
  const girMade = round.holes.filter(h=>{ const greenShot = h.shots.find(s=>['green','cup'].includes((s.endLie||'').toLowerCase())); if(!greenShot) return false; return greenShot.shotNumber <= (Number(h.par||4)-2); }).length;
  const summary = [
    ['Avg Drive', avgDrive],
    ['Fairways Hit', fairwayHits],
    ['Fairways Missed', fairwayMisses],
    ['Avg Putts', avgPutts],
    ['Front 9', frontPlayed.length ? frontScore : null],
    ['Back 9', back.length ? (backPlayed.length ? backScore : null) : null],
    ['Total', (frontPlayed.length||backPlayed.length) ? totalScore : null],
    ['Penalties', totalPen || null],
    ['GIR', girMade ? `${girMade}` : null]
  ].filter(([,v])=>v != null);
  const box = (holes, offset=0) => `
    <div class="card stack frost-card" style="gap:6px">
      ${holes.map((h,i)=>`<div class="score-row" id="detail-hole-${i+offset}" style="padding:8px 10px"><div>Hole ${h.holeNumber}</div><div>Par ${h.par}</div><div class="score-pill">${h.score || '—'}</div></div>`).join('')}
    </div>`;
  wrap.innerHTML = `
    <div class="card frost-card">
      <div class="summary-grid">${summary.map(([k,v])=>`<div class="summary-chip"><span>${k}</span><strong>${v}</strong></div>`).join('')}</div>
    </div>
    <div class="scorecard-columns">${box(front,0)}${back.length ? box(back,9) : ''}</div>`;
  document.getElementById('round-export-btn').onclick = ()=>exportRound(round.id);
  const btn = document.getElementById('round-save-course-btn');
  btn.textContent = round.sourceCourseId ? 'Update Saved Course' : 'Save Course';
  btn.onclick = ()=>{
    if(round.sourceCourseId){
      const course = state.courses.find(c=>c.id===round.sourceCourseId);
      if(course) updateCourseFromRound(course, round);
    }else{
      state.courses.push(createCourseFromRound(round));
      round.sourceCourseId = state.courses[state.courses.length-1].id;
    }
    saveData(); render(); alert('Course saved.');
  };
  document.getElementById('round-delete-btn').onclick = ()=>{
    state.rounds = state.rounds.filter(r=>r.id!==round.id);
    saveData(); showView('history');
  };
}

function renderCourses(){
  const root = document.getElementById('courses-list');
  if(!state.courses.length){ root.innerHTML = '<div class="card subtle">No saved courses yet.</div>'; return; }
  root.innerHTML = state.courses.map(c=>`
    <div class="course-row">
      <div><strong>${escapeHtml(c.name)}</strong><br><span class="subtle">${c.holesCount} holes</span></div>
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="secondary course-load" data-id="${c.id}">Load</button>
        <button class="secondary course-edit" data-id="${c.id}">Edit</button>
        <button class="danger course-delete" data-id="${c.id}">Delete</button>
      </div>
    </div>`).join('');
  root.querySelectorAll('.course-load').forEach(btn=>btn.onclick = ()=>{
    document.getElementById('start-course-select').value = btn.dataset.id;
    document.getElementById('start-course-name').value = state.courses.find(c=>c.id===btn.dataset.id)?.name || '';
    showView('start-round');
  });
  root.querySelectorAll('.course-edit').forEach(btn=>btn.onclick = ()=>{
    const c = state.courses.find(x=>x.id===btn.dataset.id); if(!c) return;
    const rows = c.holes.map((h,i)=>`
      <div class="score-row">
        <div style="min-width:72px">Hole ${h.holeNumber}</div>
        <input class="course-par-input" data-idx="${i}" type="number" min="3" max="7" value="${h.par}" style="width:72px;padding:10px;border:1px solid #d8ddcf;border-radius:12px">
        <input class="course-yardage-input" data-idx="${i}" type="number" min="0" max="999" value="${h.yardage || ''}" style="width:96px;padding:10px;border:1px solid #d8ddcf;border-radius:12px">
      </div>`).join('');
    const html = `
      <div class="stack">
        <label class="field"><span>Course Name</span><input id="course-edit-name" type="text" value="${escapeHtml(c.name)}"></label>
        ${rows}
        <button id="save-course-edit" class="secondary">Save Course</button>
      </div>`;
    openModal('Edit Course', html, ()=>{
      document.getElementById('save-course-edit').onclick = ()=>{
        c.name = document.getElementById('course-edit-name').value.trim() || c.name;
        document.querySelectorAll('.course-par-input').forEach(inp=>{ c.holes[Number(inp.dataset.idx)].par = Number(inp.value) || c.holes[Number(inp.dataset.idx)].par; });
        document.querySelectorAll('.course-yardage-input').forEach(inp=>{ c.holes[Number(inp.dataset.idx)].yardage = inp.value ? Number(inp.value) : ''; });
        saveData(); closeModal(); render();
      };
    });
  });
  root.querySelectorAll('.course-delete').forEach(btn=>btn.onclick = ()=>{
    state.courses = state.courses.filter(c=>c.id!==btn.dataset.id);
    saveData(); render();
  });
}
document.getElementById('new-course-btn').addEventListener('click', ()=>showView('start-round'));

function exportRound(roundId){
  const round = state.rounds.find(r=>r.id===roundId);
  if(!round) return;
  const blob = new Blob([JSON.stringify(round, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  const safeCourse = (round.courseName || 'course').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase();
  a.href = URL.createObjectURL(blob);
  a.download = `${new Date(round.createdAt).toISOString().slice(0,10)}-${safeCourse}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function openSheet(title, options, layoutClass=''){
  const overlay = document.getElementById('sheet-overlay');
  const content = document.getElementById('sheet-content');
  document.getElementById('sheet-title').textContent = title;
  content.className = `sheet-content ${layoutClass}`.trim();
  content.innerHTML = options.map((o,i)=>`<button class="option-btn" data-idx="${i}">${o.label}</button>`).join('');
  overlay.hidden = false;
  content.querySelectorAll('.option-btn').forEach(btn=>btn.onclick = ()=>options[Number(btn.dataset.idx)].action());
}
function closeSheet(){
  document.getElementById('sheet-overlay').hidden = true;
  document.getElementById('sheet-content').className = 'sheet-content';
}
document.getElementById('sheet-close').addEventListener('click', closeSheet);
document.getElementById('sheet-overlay').addEventListener('click', e=>{ if(e.target.id==='sheet-overlay') closeSheet(); });

function openModal(title, html, onReady){
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').hidden = false;
  if(onReady) onReady();
}
function closeModal(){ document.getElementById('modal-overlay').hidden = true; }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e=>{ if(e.target.id==='modal-overlay') closeModal(); });

function captureLocation(){
  return new Promise(resolve=>{
    if(!navigator.geolocation){
      alert('Geolocation is not available in this browser.');
      resolve(null); return;
    }
    navigator.geolocation.getCurrentPosition(pos=>{
      resolve({
        latlng: {lat: pos.coords.latitude, lng: pos.coords.longitude},
        accuracy: pos.coords.accuracy
      });
    }, err=>{
      alert('Could not get location. Make sure location access is allowed.');
      resolve(null);
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  });
}

function escapeHtml(str=''){
  return str.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}


function getMaptilerKey(){ return (state.settings.maptilerApiKey || '').trim(); }
function updateTileLayer(){
  if(!map) return;
  if(tileLayer){ map.removeLayer(tileLayer); tileLayer = null; }
  const key = getMaptilerKey();
  if(key){
    tileLayer = L.tileLayer(`https://api.maptiler.com/maps/satellite/{z}/{x}/{y}.jpg?key=${key}`, {
      tileSize: 256, maxZoom: 20, attribution: '&copy; MapTiler &copy; OpenStreetMap'
    });
  } else {
    tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20, attribution: '&copy; OpenStreetMap'
    });
  }
  tileLayer.addTo(map);
}

// map
document.getElementById('open-map-btn').addEventListener('click', ()=>showView('map'));
document.getElementById('map-back-btn').addEventListener('click', ()=>showView('hole'));
document.getElementById('map-settings-btn').addEventListener('click', ()=>{
  let key = state.settings.maptilerApiKey || '';
  const html = `
    <div class="stack">
      <label class="field">
        <span>MapTiler API key</span>
        <input id="maptiler-key-input" type="text" placeholder="Paste your key" value="${escapeHtml(key)}">
      </label>
      <div class="subtle">If blank, the map will fall back to OpenStreetMap.</div>
      <div class="subtle">To obtain an API key create a free account at: <a href="https://www.maptiler.com" target="_blank" rel="noopener noreferrer">www.maptiler.com</a></div>
      <div class="row">
        <button id="save-maptiler-key" class="secondary">Save Key</button>
        <button id="clear-maptiler-key" class="danger">Clear Key</button>
      </div>
    </div>`;
  openModal('Map Settings', html, ()=>{
    document.getElementById('save-maptiler-key').onclick = ()=>{
      state.settings.maptilerApiKey = document.getElementById('maptiler-key-input').value.trim();
      saveData();
      updateTileLayer();
      closeModal();
      refreshMap();
    };
    document.getElementById('clear-maptiler-key').onclick = ()=>{
      state.settings.maptilerApiKey = '';
      saveData();
      updateTileLayer();
      closeModal();
      refreshMap();
    };
  });
});
function initMapIfNeeded(){
  if(mapReady){
    refreshMap();
    return;
  }
  map = L.map('map').setView([33.7490,-84.3880], 16);
  updateTileLayer();
  map.on('click', e=>{
    const round = getActiveRound(); if(!round) return;
    const hole = getCurrentHole(round);
    if(mapMode === 'set-pin'){
      hole.pinLocation = {lat: e.latlng.lat, lng: e.latlng.lng};
      hole.pinSource = 'this_round';
      saveData();
      mapMode = null;
      transientUndo = null;
      refreshMap();
    } else if(mapMode === 'plan-shot'){
      transientPlan = {lat: e.latlng.lat, lng: e.latlng.lng};
      mapMode = null;
      refreshMap();
    }
  });
  mapReady = true;
  refreshMap();
}
function pointIcon(color, size=16){
  return L.divIcon({className:'', html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>`, iconSize:[size,size], iconAnchor:[size/2,size/2]});
}
function addMarker(latlng, color, radius=8, draggable=false, onDragEnd=null){
  const marker = L.marker(latlng, {icon: pointIcon(color, radius*2), draggable}).addTo(map);
  if(onDragEnd){
    marker.on('dragend', e=>{ const ll = e.target.getLatLng(); onDragEnd({lat: ll.lat, lng: ll.lng}); });
  }
  return marker;
}
function labelIcon(text, border='#f0c600'){
  return L.divIcon({className:'', html:`<div class="line-bubble" style="border-color:${border}">${text}</div>`});
}

function resetMapUndoButtons(except=''){
  ['clear-plan-btn','clear-pin-btn'].forEach(id=>{
    const btn = document.getElementById(id);
    if(!btn) return;
    if(except && id===except) return;
    btn.dataset.mode = '';
  });
}
function updateMapActionButtons(current, hole){
  const clearPlan = document.getElementById('clear-plan-btn');
  const clearPin = document.getElementById('clear-pin-btn');
  const planBtn = document.getElementById('plan-shot-btn');
  planBtn.style.visibility = current ? 'visible' : 'hidden';
  planBtn.disabled = !current;
  clearPlan.style.visibility = (transientPlan || clearPlan.dataset.mode === 'undo') ? 'visible' : 'hidden';
  clearPlan.disabled = !(transientPlan || clearPlan.dataset.mode === 'undo');
  clearPin.style.visibility = (hole.pinLocation || clearPin.dataset.mode === 'undo') ? 'visible' : 'hidden';
  clearPin.disabled = !(hole.pinLocation || clearPin.dataset.mode === 'undo');
  clearPlan.textContent = clearPlan.dataset.mode === 'undo' ? 'Undo Plan' : 'Clear Plan';
  clearPin.textContent = clearPin.dataset.mode === 'undo' ? 'Undo Pin' : 'Clear Pin';
}

function refreshMap(){
  if(!mapReady) return;
  currentMarkers.forEach(x=>x.remove && x.remove());
  currentMarkers = [];
  const round = getActiveRound(); if(!round) return;
  const hole = getCurrentHole(round);
  document.getElementById('map-subtitle').textContent = `Par ${hole.par} • Yardage ${hole.holeYardage || '—'}`;
  const est = computeEstimatedToPin(round, hole);
  document.getElementById('map-estimated-display').textContent = est ? est : '—';
  document.getElementById('map-pin-status').textContent = hole.pinLocation ? `Pin: ${hole.pinSource === 'last_known' ? 'Last known' : 'This round'}` : 'No pin';
  document.getElementById('map-mode-text').textContent = mapMode === 'set-pin' ? 'Tap map to place pin' : mapMode === 'plan-shot' ? 'Tap map to place planned shot' : 'Tap Set Pin or Plan Shot';

  // current location from pending start or latest known
  let current = hole.currentLocation || hole.currentShotDraft?.startGps || hole.pendingEndGps || hole.shots.slice().reverse().find(s=>s.endGps)?.endGps || hole.shots[0]?.startGps || null;

  if(current){
    const m = addMarker(current, '#2d7ff9', 8, true, ll=>{
      if(hole.currentShotDraft?.started && hole.currentShotDraft.startGps){ hole.currentShotDraft.startGps = ll; }
      else { hole.currentLocation = ll; }
      saveData(); refreshMap();
    });
    currentMarkers.push(m);
  }

  // historical shots in blue
  hole.shots.forEach((s, idx)=>{
    if(s.startGps){
      const dot = addMarker(s.startGps, '#2d7ff9', 6, true, ll=>{ s.startGps = ll; saveData(); refreshMap(); });
      currentMarkers.push(dot);
      if(s.endGps){
        const endDot = addMarker(s.endGps, '#2d7ff9', 6, true, ll=>{ s.endGps = ll; saveData(); refreshMap(); });
        currentMarkers.push(endDot);
        const line = L.polyline([[s.startGps.lat,s.startGps.lng],[s.endGps.lat,s.endGps.lng]], {color:'#2d7ff9', weight:3, opacity:.75}).addTo(map);
        currentMarkers.push(line);
      }
    }
  });

  // pin
  if(hole.pinLocation){
    const pin = addMarker(hole.pinLocation, '#d02828', 8, true, ll=>{ hole.pinLocation = ll; saveData(); refreshMap(); });
    currentMarkers.push(pin);
  }

  // transient plan
  document.getElementById('plan-leg-1').textContent = '—';
  document.getElementById('plan-leg-2').textContent = '—';
  updateMapActionButtons(current, hole);
  if(transientPlan && current){
    const p = addMarker(transientPlan, '#e4c71a', 8, true, ll=>{ transientPlan = ll; refreshMap(); });
    currentMarkers.push(p);
    const line1 = L.polyline([[current.lat,current.lng],[transientPlan.lat,transientPlan.lng]], {color:'#e4c71a', weight:4, opacity:.95}).addTo(map);
    currentMarkers.push(line1);
    const leg1 = yardsFromMeters(metersBetween(current, transientPlan));
    document.getElementById('plan-leg-1').textContent = leg1;
    const mid1 = {lat:(current.lat+transientPlan.lat)/2, lng:(current.lng+transientPlan.lng)/2};
    const bubble1 = L.marker(mid1, {icon: labelIcon(String(leg1))}).addTo(map); currentMarkers.push(bubble1);

    if(hole.pinLocation){
      const line2 = L.polyline([[transientPlan.lat,transientPlan.lng],[hole.pinLocation.lat,hole.pinLocation.lng]], {color:'#e4c71a', weight:4, opacity:.95}).addTo(map);
      currentMarkers.push(line2);
      const leg2 = yardsFromMeters(metersBetween(transientPlan, hole.pinLocation));
      document.getElementById('plan-leg-2').textContent = leg2;
      const mid2 = {lat:(transientPlan.lat+hole.pinLocation.lat)/2, lng:(transientPlan.lng+hole.pinLocation.lng)/2};
      const bubble2 = L.marker(mid2, {icon: labelIcon(String(leg2))}).addTo(map); currentMarkers.push(bubble2);
    }
  }
}
document.getElementById('set-pin-btn').addEventListener('click', ()=>{ resetMapUndoButtons(); mapMode='set-pin'; refreshMap(); });
document.getElementById('plan-shot-btn').addEventListener('click', ()=>{ resetMapUndoButtons(); mapMode='plan-shot'; refreshMap(); });
document.getElementById('center-me-btn').addEventListener('click', async ()=>{
  resetMapUndoButtons();
  const geo = await captureLocation();
  if(geo){
    const hole = getCurrentHole(getActiveRound());
    hole.currentLocation = geo.latlng;
    saveData();
    map.setView([geo.latlng.lat, geo.latlng.lng], 18);
    refreshMap();
  }
});
document.getElementById('clear-plan-btn').addEventListener('click', ()=>{
  const btn = document.getElementById('clear-plan-btn');
  const other = document.getElementById('clear-pin-btn');
  other.dataset.mode = '';
  if(btn.dataset.mode === 'undo'){
    transientPlan = transientUndo?.type === 'plan' ? transientUndo.value : transientPlan;
    transientUndo = null;
    btn.dataset.mode = '';
  } else {
    transientUndo = {type:'plan', value: transientPlan};
    transientPlan = null;
    btn.dataset.mode = 'undo';
  }
  refreshMap();
});
document.getElementById('clear-pin-btn').addEventListener('click', ()=>{
  const btn = document.getElementById('clear-pin-btn');
  const other = document.getElementById('clear-plan-btn');
  other.dataset.mode = '';
  const hole = getCurrentHole(getActiveRound());
  if(btn.dataset.mode === 'undo'){
    if(transientUndo?.type === 'pin'){
      hole.pinLocation = transientUndo.value.location;
      hole.pinSource = transientUndo.value.source;
    }
    transientUndo = null;
    btn.dataset.mode = '';
  } else {
    transientUndo = {type:'pin', value:{location: hole.pinLocation, source: hole.pinSource}};
    hole.pinLocation = null;
    hole.pinSource = null;
    btn.dataset.mode = 'undo';
  }
  saveData(); refreshMap();
});

render();
