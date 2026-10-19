import './workspace.css';
import { phases, transfer, formatTime, stagedEligible, stagedSupported } from './state.js';

import {reviewHint, reviewVersion} from './review.js';
import {readyObservation,parseReadyMessage} from './host-ready.js';

// Consume the single-use fragment before any request, import of Three.js, or await.
let {ticket, version: requestedVersion} = reviewHint(location.hash.slice(1), history.state);
function saveReview(version) {
  const reviewedVersion = reviewVersion(version);
  // Replace, never merge: no ticket, password or monitoring authority belongs here.
  history.replaceState(reviewedVersion ? {reviewedVersion} : null, '', location.pathname + location.search);
}
saveReview(requestedVersion);
window.opener = null;
const $ = id => document.getElementById(id);
let csrf = '', state = null, selected = requestedVersion, authenticated = false;
let animations = false, relayOrigin = '', hostVisible=true, reviewSerial=0;
let readSettled=Promise.resolve();
const embedded = window.parent !== window;
function hostMessage(type){if(embedded&&relayOrigin)window.parent.postMessage({type},relayOrigin);}
function publishObservation(){if(embedded&&relayOrigin)window.parent.postMessage(readyObservation(state,fresh&&authenticated),relayOrigin);}
window.addEventListener('message',async event=>{
 if(!embedded||event.source!==window.parent||event.origin!==relayOrigin||!event.data)return;
 const review=parseReadyMessage(event.data,'relay-updater-review');
 if(review){
  // Wait out any older poll, then read again for this exact review intent.
  // No mutation and no reuse of a pre-intent snapshot or authorization fields.
  const epoch=sessionEpoch,serial=++reviewSerial;closeConfirmation();await readSettled;
  if(epoch!==sessionEpoch||serial!==reviewSerial||!hostVisible||!authenticated)return;
  const snapshot=await readState();
  if(epoch===sessionEpoch&&serial===reviewSerial&&snapshot&&hostVisible&&snapshot.job?.id===review.jobId&&snapshot.job?.version===review.version&&actionEligible({action:'apply',version:review.version,jobId:review.jobId})){selectRelease(review.version);confirmAction('apply');}
  return;
 }
 if(Object.keys(event.data).length!==1)return;
 if(event.data.type==='relay-updater-hidden'||event.data.type==='relay-updater-visible'){hostVisible=event.data.type==='relay-updater-visible';if(!hostVisible)reviewSerial++;motionChanged();}
 if(event.data.type==='relay-updater-reconnected'){reviewSerial++;closeConfirmation();notice('Relay signed in again. Review and authorize any further action explicitly.');await readState();}
 if(event.data.type==='relay-updater-end'){
  const old=csrf;clearSession();
  try{
   const ended=await fetch('/updater/api/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':old},body:'{}',signal:AbortSignal.timeout(7000)});
   if(!ended.ok&&ended.status!==401)throw Error('Independent logout was rejected.');
   const check=await fetch('/updater/api/auth',{credentials:'same-origin',signal:AbortSignal.timeout(7000)});
   if(!check.ok||(await check.json()).authenticated!==false)throw Error('Independent session termination could not be confirmed.');
   hostMessage('relay-updater-ended');
  }catch(error){notice(error.message);}
 }
});
let pollTimer, readBusy = false;
let chamber = null, chamberAttempted = false;
let fresh = false, sessionEpoch = 0, bootBusy = false;
const media = matchMedia('(prefers-reduced-motion: reduce)');

$('app').classList.add('relay-terminal', 'release-workspace');
$('app').innerHTML = `
  <header><a class="brand" href="/updater/" aria-label="Relay updater">Relay updater</a><nav aria-label="Updater surfaces"><span aria-current="page">OPERATE</span><a href="#monitor">MONITOR</a></nav><span id="mode" class="badge">CONNECTING</span></header>
  <div class="connection-line"><span id="connection" role="status">Connecting to updater…</span><span>INDEPENDENT CONSOLE</span></div>
  <p id="notice" role="alert" hidden></p>
  <section id="locked" hidden><h2>Open from Relay</h2><p>Launch Updater from your administrator desktop to establish a protected monitoring session.</p><a id="relay-link" hidden target="_blank" rel="noopener noreferrer">Open Relay to sign in ↗</a><button id="retry">Retry connection</button></section>
  <div id="console" hidden>
    <div class="release-panes">
      <aside class="release-list" aria-label="Release selection"><div class="list-title eyebrow">RELEASES <button id="check" class="text-button">Check releases ↻</button></div><div id="release-buttons"></div><label class="eyebrow" for="release-select">Selected release</label><select id="release-select"></select><dl class="installed"><dt>INSTALLED</dt><dd id="current-version">—</dd></dl><p class="list-foot">Selecting a release does not authorize a change.<br><br>Only releases admitted by the configured official publisher policy are offered.</p></aside>
      <main id="release-detail" class="release-detail" aria-label="Release details"><div class="detail-content">
        <div class="detail-top"><div><p class="eyebrow">OPERATE / SELECTED RELEASE</p><h1 id="release-title">Release details</h1><p id="verification" class="muted"></p></div><span class="eyebrow">REVIEW BEFORE CHANGE</span></div>
        <section class="changes" aria-labelledby="notes-title"><h2 id="notes-title" class="small-heading">Release notes</h2><pre id="release-notes"></pre></section>
        <section id="monitor" class="monitor" aria-label="Update monitor"><div class="section-line">MONITOR / BROKER OBSERVATION <span id="render-mode" class="chamber-label">STATIC VIEW</span></div>
          <div class="monitor-grid"><div><div class="telemetry"><h2 id="phase">Idle</h2><span id="job-version" class="mono">—</span></div><p id="phase-detail" class="muted">No update is running.</p><div id="percentage" class="percentage">—</div><p id="bytes" class="bytes mono">No transfer</p><div id="progress" class="progress" role="progressbar" aria-label="Artifact download" aria-valuemin="0" aria-valuemax="100"><div id="progress-fill" class="progress-fill" aria-hidden="true"></div></div></div>
          <div class="transfer"><div id="chamber" aria-hidden="true"><div id="fallback">. : + * # / @<br>3D view unavailable. Live status remains available.</div></div><p id="motion-explanation" class="fine">Particles illustrate activity, not transfer speed.</p></div></div>
          <section class="ledger"><details open><summary>Current job details <span id="event-count"></span></summary><ol id="events"></ol></details><details><summary>Update history <span id="history-count"></span></summary><ol id="history"></ol></details></section>
        </section>
      </div></main>
    </div>
    <div class="action-rail"><p id="install-reason" class="rail-note"></p><div class="rail-actions"><button id="cancel" hidden>Cancel transfer</button><button id="rollback" hidden>Review rollback</button><button id="install" class="primary" disabled>Download & prepare</button><button id="apply" class="primary" hidden disabled>Apply prepared release</button></div></div>
  </div>
  <footer><span id="survival">Independent monitoring survives Relay restart.</span><button id="relay-sign-in" hidden>Sign in to Relay</button><span>NO SOUND · <span id="motion-label">MOTION OFF</span></span><button id="logout" hidden class="text-button">End monitoring session</button></footer>
  <dialog id="confirm" aria-labelledby="confirm-title"><form id="confirm-form">
    <p class="eyebrow">ADMINISTRATOR AUTHORIZATION</p><h2 id="confirm-title"></h2><p id="confirm-description"></p>
    <label><input id="confirmed" type="checkbox" required> <span id="consent-copy"></span></label>
    <label for="password">Current Relay password<input id="password" type="password" autocomplete="current-password" required maxlength="128"></label>
    <p id="confirm-error" role="alert" hidden></p><p class="fine">A current Relay administrator session is required. Your password is sent only for this authorization and is not saved by this page.</p>
    <div class="buttons"><button id="back" type="button">Go back</button><button id="authorize" class="primary" disabled></button></div>
  </form></dialog>`;

async function api(name, body) {
  const response = await fetch(`/updater/api/${name}`, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const mutation = ['prepare', 'apply', 'cancel', 'rollback'].includes(name);
    const message = response.status === 401 ? (mutation ? 'Sign in to Relay again before authorizing an update action.' : 'Monitoring session expired. Open Updater again from Relay.') : response.status === 403 ? 'Authorization was not accepted. Check your password and administrator session in Relay.' : 'Updater request unavailable. Monitoring will retry; no successful change is assumed.';
    const error = new Error(message); error.status = response.status; throw error;
  }
  return response.json();
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function motionChanged() {
  const enabled = animations && hostVisible && !media.matches && fresh && authenticated;
  $('motion-label').textContent = enabled && chamber ? 'MOTION ON' : 'MOTION OFF';
  chamber?.update(state?.job, enabled);
}
function staticChamber() {
  chamber = null; $('fallback').removeAttribute('hidden');
  $('chamber').dataset.renderer = 'static'; $('chamber').dataset.motion = 'off';
  $('render-mode').textContent = 'STATIC VIEW / WEBGL UNAVAILABLE'; motionChanged();
}
async function initChamber() {
  if (chamberAttempted) return;
  chamberAttempted = true;
  try {
    const { createChamber } = await import('./chamber.js');
    chamber = createChamber($('chamber'), staticChamber);
    $('fallback').setAttribute('hidden', ''); $('chamber').dataset.renderer = 'webgl';
    $('render-mode').textContent = 'WEBGL / BYTE-DRIVEN'; motionChanged();
  } catch { staticChamber(); }
}
media.addEventListener('change', motionChanged);
function actionEligible(target) {
  return stagedEligible({state, fresh, authenticated, selected, ...target});
}
function selectRelease(version) {
  selected = requestedVersion = reviewVersion(version); saveReview(selected); renderRelease(); validateConfirmation();
}
function renderRelease() {
  if (!state) return;
  const release = state.available.find(item => item.version === selected);
  // Don't rewrite unchanged review text: preserve selection and scroll while polling.
  const notes = release?.notes || 'No release notes available.';
  if ($('release-notes').textContent !== notes) $('release-notes').textContent = notes;
  $('release-title').textContent = selected ? `Release ${selected}` : 'Release details';
  $('verification').textContent = release ? `${release.verified ? 'Verified release' : 'Not verified'} · ${Number.isSafeInteger(release.size) ? release.size.toLocaleString() + ' bytes' : 'Size unavailable'}` : 'No published release available.';
  const ready = state.job?.kind === 'prepare' && state.job.phase === 'ready';
  $('install-reason').textContent = !stagedSupported(state) ? 'Staged updates unsupported by this control plane. No immediate-install fallback. A separately qualified control-plane upgrade is required.' : ready ? `Ready: ${state.job.version}. Relay is still running. Apply requires fresh authorization.` : selected && selected === state.currentVersion ? 'This release is already installed.' : selected && !release ? `Selected release ${selected} is unavailable. Choose a release explicitly to review it.` : state.reason || (state.mode === 'observe' ? 'Observe mode is read-only.' : 'Download and verify now. Relay keeps running until you explicitly Apply.');
  $('install').disabled = !actionEligible({action:'prepare'});
  $('install').hidden = ready;
  $('apply').hidden = !ready;
  $('apply').textContent = ready ? `Apply ${state.job.version}` : 'Apply prepared release';
  $('apply').disabled = !actionEligible({action:'apply',version:state.job?.version});
  for (const button of $('release-buttons').children) button.setAttribute('aria-pressed', String(button.dataset.version === selected));
}
function render(snapshot) {
  fresh = true;
  state = snapshot;
  $('mode').textContent = ({ fixture: 'FIXTURE SANDBOX', observe: 'OBSERVE / READ ONLY', production: 'PRODUCTION' })[state.mode] || 'UNCONFIGURED';
  $('current-version').textContent = state.currentVersion || 'Unknown';
  if (!selected) { selected = requestedVersion = state.available[0]?.version || ''; saveReview(selected); }
  const select = $('release-select');
  // Reconcile keyed release controls, not the root, so focused buttons survive polls.
  const versions = new Set(state.available.map(item => item.version));
  for (const button of [...$('release-buttons').children]) if (!versions.has(button.dataset.version)) button.remove();
  for (const item of state.available) {
    let button = [...$('release-buttons').children].find(b => b.dataset.version === item.version);
    if (!button) { button = document.createElement('button'); button.className = 'release-button'; button.dataset.version = item.version; button.onclick = () => { select.value = item.version; selectRelease(item.version); }; $('release-buttons').append(button); }
    const text = `${item.version}\n${item.version === state.currentVersion ? 'Installed' : item.verified ? 'Verified release' : 'Not verified'}`;
    if (button.textContent !== text) button.textContent = text;
  }
  // Update keyed options in place, including the unavailable selected target.
  for (const option of [...select.options]) if (!versions.has(option.value) && option.value !== selected) option.remove();
  for (const item of state.available) if (![...select.options].some(o => o.value === item.version)) select.add(new Option(item.version, item.version));
  if (selected && ![...select.options].some(o => o.value === selected)) select.add(new Option(`${selected} — unavailable`, selected));
  select.value = selected;
  renderRelease();
  const job = state.job, phase = job?.phase || 'idle';
  const description = phases[phase] || ['Unknown phase', 'The broker reported an unsupported phase.'];
  $('phase').textContent = description[0];
  $('phase-detail').textContent = job?.error ? `${description[1]} ${job.error}` : description[1];
  $('job-version').textContent = job?.version || '—';
  const { bytes, total, ratio } = transfer(job);
  $('bytes').textContent = !job ? 'No transfer' : total ? `${bytes.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} bytes` : `${bytes.toLocaleString('en-US')} bytes · total unknown`;
  const value=document.createElement('span');value.textContent=ratio===null?'—':String(Math.floor(ratio*100));
  const symbol=document.createElement('span');symbol.className='percent-symbol';symbol.textContent=ratio===null?'':'%';
  const scope=document.createElement('small');scope.textContent=ratio===null?'':' of artifact';$('percentage').replaceChildren(value,symbol,scope);
  const filled = ratio === null ? 0 : Math.floor(ratio * 40);
  $('progress-fill').textContent = '█'.repeat(filled) + '░'.repeat(40 - filled);
  if (ratio === null) $('progress').removeAttribute('aria-valuenow');
  else $('progress').setAttribute('aria-valuenow', String(Math.floor(ratio * 100)));
  $('progress').setAttribute('aria-valuetext', $('bytes').textContent);
  $('cancel').hidden = !job?.canCancel || state.mode === 'observe';
  $('rollback').hidden = !job?.canRollback || state.mode === 'observe';
  $('cancel').disabled = !actionEligible({ action: 'cancel' }); $('rollback').disabled = !actionEligible({ action: 'rollback' });
  const list = (id, entries, format) => $(id).replaceChildren(...entries.map(entry => { const li = document.createElement('li'); li.textContent = format(entry); return li; }));
  const events = job?.events || [];
  list('events', events, event => `${formatTime(event.at)} / ${event.phase || ''} — ${event.message || ''}`);
  list('history', state.history, entry => `${entry.version || 'Unknown version'} / ${entry.outcome || entry.phase || 'Unknown outcome'}${entry.updatedAt ? ` / ${formatTime(entry.updatedAt)}` : ''}${entry.error ? ` — ${entry.error}` : ''}`);
  $('event-count').textContent = String(events.length);
  $('history-count').textContent = String(state.history.length);
  motionChanged(); publishObservation();
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (authenticated) pollTimer = setTimeout(() => readState(), 1000);
}
async function readState(endpoint = 'state') {
  if (readBusy || bootBusy || !authenticated) return;
  const epoch = sessionEpoch;
  readBusy = true;let settleRead;readSettled=new Promise(resolve=>settleRead=resolve);clearTimeout(pollTimer); $('check').disabled = true;
  try {
    const snapshot = await api(endpoint, endpoint === 'check' ? {} : undefined);
    if (epoch !== sessionEpoch || !authenticated) return;
    render(snapshot);
    $('connection').textContent = 'Connected to updater'; notice();return snapshot;
  } catch (error) {
    if (epoch !== sessionEpoch) return;
    fresh = false; renderRelease(); motionChanged(); publishObservation();
    $('cancel').disabled = true; $('rollback').disabled = true;
    notice(error.message); $('connection').textContent = 'Disconnected · last known state';
    if (error.status === 401) { clearSession(); $('mode').textContent = 'SESSION EXPIRED'; }
  } finally { readBusy = false; $('check').disabled = false; validateConfirmation(); schedulePoll();settleRead(); }
}
$('check').onclick = () => readState('check');
let pendingAction = null, actionBusy = false;
function closeConfirmation() { $('password').value = ''; $('confirmed').checked = false; pendingAction = null; $('confirm').close(); }
function confirmAction(action) {
  const target = {action, ...(action === 'prepare' ? {version:selected} : {jobId:state?.job?.id, version:state?.job?.version})};
  if (actionBusy || !actionEligible(target)) return;
  pendingAction = target;
  const label = {prepare:'preparation', apply:'Apply', cancel:'cancellation', rollback:'rollback'}[action];
  $('confirm-title').textContent = action === 'prepare' ? `Prepare ${selected}?` : action === 'apply' ? `Apply ${target.version}?` : action === 'cancel' ? 'Cancel this transfer?' : 'Restore the previous release?';
  $('confirm-description').textContent = action === 'prepare' ? 'Download, verify and stage this exact release. Relay keeps running. This permission does not authorize Apply or a restart.' : action === 'apply' ? `Apply prepared release ${target.version}. Save your work first. The broker revalidates this job, backs up state, installs and checks health. Relay sessions will be interrupted.` : action === 'cancel' ? 'Cancel this exact job before activation. A ready preparation is discarded without stopping Relay. The broker checks whether cancellation is still safe.' : 'Restore the broker’s previous verified release and matching state checkpoint. Relay will restart and changes since that checkpoint may be lost.';
  $('consent-copy').textContent = action === 'prepare' ? 'I authorize download and preparation only, not Apply.' : action === 'cancel' ? 'I authorize cancellation of this exact job.' : 'I understand active Relay sessions will be interrupted.';
  $('authorize').textContent = `Authorize ${label}`; $('authorize').disabled = true;
  $('password').value = ''; $('confirmed').checked = false; $('confirm-error').hidden = true;
  $('confirm').showModal(); $('confirmed').focus();
}
$('install').onclick = () => confirmAction('prepare');
$('apply').onclick = () => confirmAction('apply');
$('cancel').onclick = () => confirmAction('cancel');
$('rollback').onclick = () => confirmAction('rollback');
$('back').onclick = closeConfirmation;
$('confirm').addEventListener('cancel', event => { if (actionBusy) event.preventDefault(); else closeConfirmation(); });
function validateConfirmation() {
  // Connectivity loss freezes consent; a successful but incompatible snapshot retires it.
  if (pendingAction && !pendingAction.invalidated && fresh && authenticated && !actionEligible(pendingAction)) {
    pendingAction.invalidated = true;
    $('password').value = ''; $('confirmed').checked = false;
    $('confirm-error').textContent = 'The release or job changed, or this action is no longer allowed. Go back and review again before authorizing.';
    $('confirm-error').hidden = false;
  }
  const allowed = Boolean(pendingAction && !pendingAction.invalidated && actionEligible(pendingAction) && !actionBusy && $('password').value && $('confirmed').checked);
  $('authorize').disabled = !allowed;
  return allowed;
}
$('password').oninput = validateConfirmation;
$('confirmed').onchange = validateConfirmation;
$('confirm-form').onsubmit = async event => {
  event.preventDefault();
  if (!validateConfirmation()) return;
  actionBusy = true; $('back').disabled = true; validateConfirmation();
  const { action, version, jobId } = pendingAction;
  const target = action === 'prepare' ? { version } : action === 'apply' ? {version, jobId} : action === 'cancel' ? { jobId } : {};
  const password = $('password').value;
  $('password').value = '';
  try {
    // Never retry a mutation automatically: an unavailable response may hide an accepted job.
    await api(action, { ...target, password, confirmed: true });
    closeConfirmation();
    // Read back state rather than considering a POST response proof of activation.
    await readState();
  } catch (error) {
    $('confirm-error').textContent = `${error.message} If Relay restarted, sign in there again before authorizing another action. Read-only monitoring remains available.`;
    $('confirm-error').hidden = false;
  } finally { actionBusy = false; $('back').disabled = false; validateConfirmation(); }
};
$('release-select').onchange = event => selectRelease(event.target.value);
function clearSession() {
  authenticated = false; fresh = false; csrf = ''; state = null; sessionEpoch++; publishObservation();
  clearTimeout(pollTimer); closeConfirmation();
  $('console').hidden = true; $('locked').hidden = false; $('logout').hidden = true;
  $('release-notes').textContent = ''; $('events').replaceChildren(); $('history').replaceChildren();
  $('current-version').textContent = '—'; $('release-select').replaceChildren();
  $('connection').textContent = 'Monitoring session required'; $('mode').textContent = 'LOCKED'; motionChanged();
}
$('logout').onclick = async () => {
  $('logout').disabled = true;
  try {
    await api('logout', {});
    const auth = await api('auth');
    if (auth.authenticated) throw new Error('The updater session is still active. Try ending it again.');
    clearSession(); notice();
  } catch (error) { notice(error.message); }
  finally { $('logout').disabled = false; }
};
async function boot() {
  if (bootBusy) return;
  bootBusy = true; $('check').disabled = true; clearTimeout(pollTimer);
  notice();
  try {
    if (ticket) { const captured = ticket; ticket = ''; await api('exchange', { ticket: captured }); }
    const auth = await api('auth');
    csrf = auth.csrf || ''; authenticated = auth.authenticated;
    animations = auth.interfaceAnimations === true;
    if (auth.relayOrigin) { const url = new URL(auth.relayOrigin); if (['http:', 'https:'].includes(url.protocol) && url.hostname === location.hostname && url.origin === auth.relayOrigin) { relayOrigin=url.origin;$('relay-link').href = url.origin; $('relay-link').hidden = embedded; $('relay-sign-in').hidden=!embedded; } }
    $('locked').hidden = authenticated; $('console').hidden = !authenticated; $('logout').hidden = !authenticated;
    if (!authenticated) { $('connection').textContent = 'Monitoring session required'; $('mode').textContent = 'LOCKED'; return; }
    render(await api('state'));
    $('connection').textContent = 'Connected to updater';
    initChamber();
    schedulePoll();
  } catch (error) { fresh = false; notice(error.message); $('connection').textContent = 'Connection unavailable'; $('mode').textContent = 'UNAVAILABLE'; $('locked').hidden = false; }
  finally { bootBusy = false; $('check').disabled = false;hostMessage('relay-updater-ready'); }
}
$('relay-sign-in').onclick=()=>{closeConfirmation();hostMessage('relay-updater-sign-in');};
$('retry').onclick = boot;
boot();
