const grid = document.querySelector('#doorGrid');
const summary = document.querySelector('#summary');
const eventsEl = document.querySelector('#events');
const eventCount = document.querySelector('#eventCount');
const filter = document.querySelector('#filter');
const actor = document.querySelector('#actor');
const modal = document.querySelector('#modal');
const modalContent = document.querySelector('#modalContent');
const actionForm = document.querySelector('#actionForm');
const submitAction = document.querySelector('#submitAction');
const cancelAction = document.querySelector('#cancelAction');
const toast = document.querySelector('#toast');
const viewBanner = document.querySelector('#viewBanner');
const installBtn = document.querySelector('#installBtn');
const modeButtons = [...document.querySelectorAll('.mode-btn')];

let state = { board: [], events: [], day: '' };
let pending = null;
let deferredInstallPrompt = null;
let mode = localStorage.getItem('yardBoardMode') || 'driver';

actor.value = localStorage.getItem('yardActor') || '';
actor.addEventListener('change', () => localStorage.setItem('yardActor', actor.value.trim()));
modeButtons.forEach(btn => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
filter.addEventListener('change', render);
cancelAction.addEventListener('click', () => { pending = null; modal.close(); });

const socket = io();
socket.on('board:update', data => { state = { ...state, ...data }; render(); });
socket.on('connect_error', () => showToast('Connection interrupted — retrying…'));
fetch('/api/state').then(r => r.json()).then(d => { state = d; render(); }).catch(() => showToast('Unable to load board.'));

function setMode(nextMode) {
  mode = nextMode === 'desk' ? 'desk' : 'driver';
  localStorage.setItem('yardBoardMode', mode);
  filter.value = 'All';
  render();
}
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function showToast(msg) { toast.textContent=msg; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer=setTimeout(()=>toast.classList.remove('show'),2800); }
function counts() {
  const c={Empty:0,Available:0,Loading:0,'Loading Complete':0,'Out of Service':0};
  state.board.forEach(d=>{ c[d.status]=(c[d.status]||0)+1; if(d.out_of_service) c['Out of Service']++; });
  return c;
}
function statusClass(status) { return String(status).toLowerCase().replaceAll(' ','-'); }

function render() {
  modeButtons.forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));
  document.body.dataset.mode=mode;
  viewBanner.innerHTML = mode === 'driver'
    ? '<div><strong>Yard Driver View</strong><span>Red OUT OF SERVICE doors must not be used. Enter trailers only on active Empty doors.</span></div>'
    : '<div><strong>Load Desk View</strong><span>Assign runs and loading status. Use “Mark Out of Service” to immediately warn the Yard Driver.</span></div>';

  const c=counts();
  summary.innerHTML=[['Available',c.Available],['Loading',c.Loading],['Loading Complete',c['Loading Complete']],['Empty',c.Empty],['Out of Service',c['Out of Service']]]
    .map(([n,v])=>`<button type="button" class="sum sum-${statusClass(n)}" data-filter="${esc(n)}"><strong>${v}</strong><span>${n}</span></button>`).join('');
  summary.querySelectorAll('[data-filter]').forEach(btn=>btn.addEventListener('click',()=>{filter.value=btn.dataset.filter;render();}));

  const f=filter.value;
  const rows=state.board.filter(d=>f==='All'||(f==='Out of Service'?Boolean(d.out_of_service):d.status===f));
  grid.innerHTML=rows.map(doorCard).join('');
  grid.querySelectorAll('button[data-action]').forEach(b=>b.addEventListener('click',()=>openAction(b.dataset.action,Number(b.dataset.door))));
  bindCardEditing();

  eventCount.textContent=`${state.events.length} events`;
  eventsEl.innerHTML=state.events.slice(0,100).map(e=>`<div class="event"><span class="muted">${new Date(e.created_at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span><b>Door ${e.door}</b><span>${esc(e.action)}</span><span class="hide-mobile">Trailer ${esc(e.trailer||'—')} · Run ${esc(e.run||'—')}</span><span class="hide-mobile muted">${esc(e.actor||'')}</span></div>`).join('')||'<p class="muted">No activity yet today.</p>';
}

function doorCard(d) {
  const oos=Boolean(d.out_of_service);
  return `<article class="door ${statusClass(d.status)} ${oos?'out-of-service':''}" data-door-card="${d.door}" title="Double-click or double-tap to edit Door ${d.door}">
    ${oos?'<div class="oos-warning"><span class="oos-icon">⛔</span><span><strong>OUT OF SERVICE</strong><small>DO NOT USE THIS DOOR</small></span></div>':''}
    <div class="door-top"><span class="door-num">Door ${d.door}</span><span class="badge">${oos?'OUT OF SERVICE':esc(d.status)}</span></div>
    <div class="details"><div><small>Trailer</small><b>${esc(d.trailer||'—')}</b></div><div><small>Run</small><b>${esc(d.run||'—')}</b></div></div>
    <p class="door-helper">${mode==='driver'?driverHelper(d):deskHelper(d)}</p>
    <span class="edit-hint">Double-click to edit · Mobile: press & hold</span>
    <button type="button" class="card-edit-btn" data-edit-door="${d.door}" aria-label="Edit Door ${d.door}">✎ Edit</button>
    <div class="door-actions">${buttonsForMode(d)}</div>
  </article>`;
}
function driverHelper(d) {
  if(d.out_of_service) return d.trailer ? 'This door is disabled. Do not place another trailer here.' : 'DO NOT PLACE A TRAILER ON THIS DOOR.';
  if(d.status==='Empty') return 'Ready for a trailer.';
  if(d.status==='Available') return 'Trailer is available for Load Desk assignment.';
  if(d.status==='Loading') return 'Load Desk is loading this trailer.';
  return 'Ready for yard movement.';
}
function deskHelper(d) {
  if(d.out_of_service) return 'Door is disabled and clearly blocked in the Yard Driver view.';
  if(d.status==='Empty') return 'Waiting for Yard Driver to place a trailer.';
  if(d.status==='Available') return 'Ready to assign to a Run.';
  if(d.status==='Loading') return 'Loading in progress.';
  return 'Loading finished. Yard Driver can move this trailer.';
}
function buttonsForMode(d) {
  const oos=Boolean(d.out_of_service);
  if(mode==='driver') {
    if(oos && d.status==='Loading Complete') return `<button class="btn primary big-action" data-action="pooled" data-door="${d.door}">Pooled</button><button class="btn dispatch big-action" data-action="dispatched" data-door="${d.door}">Dispatched</button>`;
    if(oos) return '<span class="waiting-label danger-wait">⛔ DO NOT USE</span>';
    if(d.status==='Empty') return `<button class="btn primary big-action" data-action="place" data-door="${d.door}">+ Put Trailer on Door</button>`;
    if(d.status==='Loading Complete') return `<button class="btn primary big-action" data-action="pooled" data-door="${d.door}">Pooled</button><button class="btn dispatch big-action" data-action="dispatched" data-door="${d.door}">Dispatched</button>`;
    return '<span class="waiting-label">No yard action needed</span>';
  }

  const serviceBtn=oos
    ? `<button class="btn service-on" data-action="service-on" data-door="${d.door}">Return to Service</button>`
    : `<button class="btn service-off" data-action="service-off" data-door="${d.door}">⛔ Mark Out of Service</button>`;
  let work='';
  if(!oos && d.status==='Available') work=`<button class="btn primary big-action" data-action="loading" data-door="${d.door}">Assign Run / Start Loading</button>`;
  else if(d.status==='Loading') work=`<button class="btn complete big-action" data-action="complete" data-door="${d.door}">✓ Loading Complete</button>`;
  else if(d.status==='Loading Complete') work='<span class="waiting-label">Waiting for Yard Driver</span>';
  else if(!oos) work='<span class="waiting-label">Waiting for trailer</span>';
  return work + serviceBtn;
}


function bindCardEditing() {
  // A visible Edit button is the most reliable mobile fallback.
  grid.querySelectorAll('[data-edit-door]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openEdit(Number(btn.dataset.editDoor));
    });
  });

  grid.querySelectorAll('[data-door-card]').forEach(card => {
    // Desktop: keep the requested double-click behavior.
    card.addEventListener('dblclick', e => {
      if (e.target.closest('button, input, select, a')) return;
      e.preventDefault();
      openEdit(Number(card.dataset.doorCard));
    });

    // Mobile/tablet: press and hold for ~650 ms. This avoids unreliable
    // browser double-tap handling, which is often reserved for zooming.
    let holdTimer = null;
    let startX = 0;
    let startY = 0;
    let longPressFired = false;

    const cancelHold = () => {
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
    };

    card.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.target.closest('button, input, select, a')) return;
      startX = e.clientX;
      startY = e.clientY;
      longPressFired = false;
      cancelHold();
      holdTimer = setTimeout(() => {
        longPressFired = true;
        if (navigator.vibrate) navigator.vibrate(35);
        openEdit(Number(card.dataset.doorCard));
      }, 650);
    });

    card.addEventListener('pointermove', e => {
      if (!holdTimer) return;
      if (Math.abs(e.clientX - startX) > 12 || Math.abs(e.clientY - startY) > 12) cancelHold();
    });
    card.addEventListener('pointerup', cancelHold);
    card.addEventListener('pointercancel', cancelHold);
    card.addEventListener('pointerleave', e => { if (e.pointerType !== 'mouse') cancelHold(); });

    // Suppress the mobile long-press context menu on the card itself.
    card.addEventListener('contextmenu', e => {
      if (!e.target.closest('button, input, select, a')) e.preventDefault();
    });
  });
}

function openEdit(door) {
  const d = state.board.find(x => x.door === door);
  if (!d) return;
  pending = { action: 'edit', door };
  modalContent.innerHTML = `<h3>Edit Door ${door}</h3>
    <p class="modal-note">Manual corrections are recorded in today's activity history.</p>
    <div class="edit-grid">
      <label>Trailer #<input id="editTrailer" autocomplete="off" inputmode="text" value="${esc(d.trailer || '')}" placeholder="Trailer number"></label>
      <label>Run #<input id="editRun" autocomplete="off" inputmode="text" value="${esc(d.run || '')}" placeholder="Run number"></label>
    </div>
    <label>Status
      <select id="editStatus">
        ${['Empty','Available','Loading','Loading Complete'].map(s => `<option value="${s}" ${d.status===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </label>
    <label class="check-row"><input id="editOos" type="checkbox" ${d.out_of_service?'checked':''}><span>Door is OUT OF SERVICE</span></label>
    <p class="modal-note">Setting status to Empty clears the trailer and run. Available requires a trailer. Loading and Loading Complete require both a trailer and run.</p>`;
  submitAction.textContent = 'Save Changes';
  submitAction.classList.remove('danger-action');
  modal.showModal();
  setTimeout(() => document.querySelector('#editTrailer')?.focus(), 80);
}

function openAction(action,door) {
  pending={action,door};
  const d=state.board.find(x=>x.door===door);
  let html=`<h3>Door ${door}</h3>`;
  if(action==='place') html+=`<p>Enter the trailer you are placing on Door ${door}. It will immediately show as <b>Available</b> to the Load Desk.</p><label>Trailer #<input id="field" required autocomplete="off" inputmode="text" placeholder="Trailer number"></label>`;
  if(action==='loading') html+=`<p>Trailer <b>${esc(d.trailer)}</b> is available on Door ${door}.</p><label>Run #<input id="field" required autocomplete="off" inputmode="text" placeholder="Run number"></label>`;
  if(action==='complete') html+=`<p>Mark Run <b>${esc(d.run)}</b> / Trailer <b>${esc(d.trailer)}</b> as <b>Loading Complete</b>?</p>`;
  if(action==='pooled'||action==='dispatched') { const label=action==='pooled'?'Pooled on the back line':'Dispatched'; html+=`<p>Remove Trailer <b>${esc(d.trailer)}</b> from Door ${door} and mark it <b>${label}</b>?</p><p class="modal-note">After confirmation, Door ${door} will become Empty.</p>`; }
  if(action==='service-off') html+=`<div class="modal-danger"><b>⛔ Mark Door ${door} OUT OF SERVICE?</b><p>The Yard Driver will see a large red DO NOT USE warning immediately.</p></div><label>Reason / note (optional)<input id="field" autocomplete="off" placeholder="Example: Door plate damaged"></label>`;
  if(action==='service-on') html+=`<p>Return Door ${door} to normal service? The red warning will immediately disappear for the Yard Driver.</p>`;
  modalContent.innerHTML=html;
  submitAction.textContent=action==='place'?'Make Available':action==='loading'?'Start Loading':action==='complete'?'Complete Loading':action==='pooled'?'Confirm Pooled':action==='dispatched'?'Confirm Dispatched':action==='service-off'?'Mark OUT OF SERVICE':'Return to Service';
  submitAction.classList.toggle('danger-action',action==='service-off');
  modal.showModal(); setTimeout(()=>document.querySelector('#field')?.focus(),80);
}

actionForm.addEventListener('submit',async e=>{
  e.preventDefault(); if(!pending)return;
  const {action,door}=pending; const value=document.querySelector('#field')?.value.trim();
  const defaultActor=mode==='driver'?'Yard Driver':'Load Desk'; const who=actor.value.trim()||defaultActor;
  let url=`/api/doors/${door}/`; const body={actor:who};
  if(action==='edit'){
    url+='edit';
    body.trailer=document.querySelector('#editTrailer')?.value.trim()||'';
    body.run=document.querySelector('#editRun')?.value.trim()||'';
    body.status=document.querySelector('#editStatus')?.value||'Empty';
    body.out_of_service=Boolean(document.querySelector('#editOos')?.checked);
  }
  else if(action==='place'){url+='place';body.trailer=value;}
  else if(action==='loading'){url+='loading';body.run=value;}
  else if(action==='complete')url+='complete';
  else if(action==='service-off'||action==='service-on'){url+='service';body.out_of_service=action==='service-off';body.notes=value||'';}
  else{url+='remove';body.disposition=action==='pooled'?'Pooled':'Dispatched';}
  if((action==='place'||action==='loading')&&!value){showToast('Please enter a value.');return;}
  submitAction.disabled=true;
  try{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to save');modal.close();pending=null;showToast(action==='edit'?'Door information updated':action==='service-off'?'Door marked OUT OF SERVICE':action==='service-on'?'Door returned to service':'Updated successfully');}
  catch(err){showToast(err.message);}finally{submitAction.disabled=false;submitAction.classList.remove('danger-action');}
});

window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;installBtn.hidden=false;});
installBtn.addEventListener('click',async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;installBtn.hidden=true;});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;installBtn.hidden=true;showToast('Yard Door Board installed.');});
if(window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone)installBtn.hidden=true;
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
setMode(mode);
