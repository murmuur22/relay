import './style.css';
import { phases, activeJob, transfer, formatTime } from './state.js';

import {reviewHint, reviewVersion} from './review.js';

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
let animations = false;
let pollTimer, readBusy = false;
let chamber = null, chamberAttempted = false;
let fresh = false, sessionEpoch = 0, bootBusy = false;
const media = matchMedia('(prefers-reduced-motion: reduce)');

$('app').innerHTML = `
  <header><a class="brand" href="/updater/" aria-label="Relay updater">r<span>/</span></a><span class="path">RELAY <i>/</i> SYSTEM <i>/</i> UPDATER</span><span id="mode" class="badge">CONNECTING</span></header>
  <div class="workspace">
    <div class="heading"><div><p class="eyebrow">INDEPENDENT MAINTENANCE CONSOLE</p><h1>Transfer chamber</h1></div><div class="connection" id="connection" role="status">Connecting to updater…</div></div>
    <p id="notice" role="alert" hidden></p>
    <section id="locked" hidden><h2>Open from Relay</h2><p>Launch Updater from your administrator desktop to establish a protected monitoring session.</p><a id="relay-link" hidden target="_blank" rel="noopener noreferrer">Open Relay to sign in ↗</a><button id="retry">Retry connection</button></section>
    <div id="console" hidden>
      <div class="operate">
        <section class="transfer" aria-label="Update transfer">
          <div class="section-line"><span>01 / TRANSFER</span><span id="render-mode">STATIC VIEW</span></div>
          <div id="chamber" aria-hidden="true"><div class="cross top-left">+</div><div class="cross top-right">+</div><div class="cross bottom-left">+</div><div class="cross bottom-right">+</div><svg id="fallback" viewBox="0 0 600 370"><g fill="none" stroke="currentColor"><ellipse cx="300" cy="291" rx="156" ry="34" opacity=".2"/><path d="M300 73 405 134 405 255 300 316 195 255 195 134Z M195 134 300 195 405 134 M300 195V316 M300 73V195 M195 255 300 195 405 255"/><path opacity=".25" d="M300 105 378 150 378 239 300 284 222 239 222 150Z M222 150 300 195 378 150 M300 195V284"/></g></svg><span class="chamber-label">RELEASE / TRANSFER CORE</span></div>
          <div class="telemetry"><div><p class="eyebrow">BROKER PHASE</p><h2 id="phase">Idle</h2></div><span id="job-version" class="mono">—</span></div>
          <p id="phase-detail" class="muted">No update is running.</p>
          <p id="motion-explanation" class="fine">Core assembly follows received bytes. Moving trails illustrate activity, not transfer speed.</p>
          <div id="progress" role="progressbar" aria-label="Artifact download" aria-valuemin="0" aria-valuemax="100"><div id="progress-fill"></div></div>
          <div class="byte-row mono"><span id="bytes">No transfer</span><span id="percentage">—</span></div>
          <div class="transfer-actions"><button id="cancel" hidden>Cancel transfer</button><button id="rollback" hidden>Review rollback</button></div>
        </section>
        <aside class="release"><div class="section-line"><span>02 / RELEASE</span><button id="check" class="text-button">Check releases ↻</button></div>
          <dl class="installed"><dt>INSTALLED</dt><dd id="current-version">—</dd></dl>
          <label class="eyebrow" for="release-select">AVAILABLE RELEASE</label><select id="release-select"></select><p id="verification" class="muted"></p>
          <h2 class="small-heading">Release notes</h2><pre id="release-notes"></pre>
          <div class="release-bottom"><p id="install-reason" class="muted"></p><button id="install" class="primary" disabled>Review installation <span>↗</span></button><p class="fine">You authorize the change. The broker verifies and applies it.</p></div>
        </aside>
      </div>
      <section class="ledger"><div class="section-line"><span>03 / ACTIVITY</span><span>SERVER-REPORTED EVENTS</span></div><details><summary>Current job details <span id="event-count"></span></summary><ol id="events"></ol></details><details><summary>Update history <span id="history-count"></span></summary><ol id="history"></ol></details></section>
    </div>
    <footer><span>This tab stays open when Relay restarts.</span><span>NO SOUND · <span id="motion-label">MOTION OFF</span></span><button id="logout" hidden class="text-button">End monitoring session</button></footer>
  </div>
  <dialog id="confirm" aria-labelledby="confirm-title"><form id="confirm-form">
    <p class="eyebrow">ADMINISTRATOR AUTHORIZATION</p><h2 id="confirm-title"></h2><p id="confirm-description"></p>
    <label><input id="confirmed" type="checkbox" required> I understand active Relay sessions will be interrupted.</label>
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
    const mutation = ['install', 'cancel', 'rollback'].includes(name);
    const message = response.status === 401 ? (mutation ? 'Sign in to Relay again before authorizing an update action.' : 'Monitoring session expired. Open Updater again from Relay.') : response.status === 403 ? 'Authorization was not accepted. Check your password and administrator session in Relay.' : 'Updater request unavailable. Monitoring will retry; no successful change is assumed.';
    const error = new Error(message); error.status = response.status; throw error;
  }
  return response.json();
}
function notice(message = '') { $('notice').textContent = message; $('notice').hidden = !message; }
function motionChanged() {
  const enabled = animations && !media.matches && fresh && authenticated;
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
function actionEligible({ action, version = selected, jobId = state?.job?.id }) {
  if (!fresh || !authenticated || !state || state.mode === 'observe') return false;
  if (action === 'install') return Boolean(state.canInstall && version !== state.currentVersion && version === selected && state.available.some(item => item.version === version && item.verified) && !activeJob(state.job) && !['rollback-failed', 'interrupted'].includes(state.job?.phase));
  if (action === 'cancel' || action === 'rollback') return Boolean(jobId && jobId === state.job?.id && state.job[action === 'cancel' ? 'canCancel' : 'canRollback']);
  return false;
}
function renderRelease() {
  const release = state.available.find(item => item.version === selected);
  $('release-notes').textContent = release?.notes || 'No release notes available.';
  $('verification').textContent = release ? `${release.verified ? 'Verified release' : 'Not verified'} · ${release.size.toLocaleString()} bytes` : 'No published release available.';
  $('install-reason').textContent = selected && selected === state.currentVersion ? 'This release is already installed.' : requestedVersion&&!release ? `Selected release ${requestedVersion} is unavailable. Choose a release explicitly to review it.` : state.reason || (state.mode === 'observe' ? 'Observe mode is read-only. Installation is disabled.' : 'Active Relay sessions will be interrupted.');
  $('install').disabled = !actionEligible({ action: 'install' });
}
function render(snapshot) {
  fresh = true;
  state = snapshot;
  $('mode').textContent = ({ fixture: 'FIXTURE SANDBOX', observe: 'OBSERVE / READ ONLY', production: 'PRODUCTION' })[state.mode] || 'UNCONFIGURED';
  $('current-version').textContent = state.currentVersion || 'Unknown';
  if (!requestedVersion&&!state.available.some(item => item.version === selected)) selected = state.available[0]?.version || '';
  const select = $('release-select');
  // Preserve keyboard focus and selection during monitoring.
  if (JSON.stringify([...select.options].map(option => option.value)) !== JSON.stringify(state.available.map(item => item.version))) {
    select.replaceChildren(...state.available.map(item => new Option(item.version, item.version)));
  }
  select.value = selected;
  renderRelease();
  const job = state.job, phase = job?.phase || 'idle';
  const description = phases[phase] || ['Unknown phase', 'The broker reported an unsupported phase.'];
  $('phase').textContent = description[0];
  $('phase-detail').textContent = job?.error ? `${description[1]} ${job.error}` : description[1];
  $('job-version').textContent = job?.version || '—';
  const { bytes, total, ratio } = transfer(job);
  $('bytes').textContent = !job ? 'No transfer' : total ? `${bytes.toLocaleString('en-US')} / ${total.toLocaleString('en-US')} bytes` : `${bytes.toLocaleString('en-US')} bytes · total unknown`;
  $('percentage').textContent = ratio === null ? '—' : `${Math.floor(ratio * 100)}% of artifact`;
  $('progress-fill').style.width = `${(ratio || 0) * 100}%`;
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
  motionChanged();
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (authenticated) pollTimer = setTimeout(() => readState(), 1000);
}
async function readState(endpoint = 'state') {
  if (readBusy || bootBusy || !authenticated) return;
  const epoch = sessionEpoch;
  readBusy = true; clearTimeout(pollTimer); $('check').disabled = true;
  try {
    const snapshot = await api(endpoint, endpoint === 'check' ? {} : undefined);
    if (epoch !== sessionEpoch || !authenticated) return;
    render(snapshot);
    $('connection').textContent = 'Connected to updater'; notice();
  } catch (error) {
    if (epoch !== sessionEpoch) return;
    fresh = false; renderRelease(); motionChanged();
    $('cancel').disabled = true; $('rollback').disabled = true;
    notice(error.message); $('connection').textContent = 'Disconnected · last known state';
    if (error.status === 401) { clearSession(); $('mode').textContent = 'SESSION EXPIRED'; }
  } finally { readBusy = false; $('check').disabled = false; validateConfirmation(); schedulePoll(); }
}
$('check').onclick = () => readState('check');
let pendingAction = null, actionBusy = false;
function closeConfirmation() { $('password').value = ''; $('confirmed').checked = false; pendingAction = null; $('confirm').close(); }
function confirmAction(action) {
  if (actionBusy || !actionEligible({ action })) return;
  // Rollback's job identity binds local consent only; it is not an API field.
  pendingAction = { action, ...(action === 'install' ? { version: selected } : { jobId: state.job.id }) };
  const label = { install: 'installation', cancel: 'cancellation', rollback: 'rollback' }[action];
  $('confirm-title').textContent = action === 'install' ? `Install ${selected}?` : action === 'cancel' ? 'Cancel this transfer?' : 'Restore the previous release?';
  $('confirm-description').textContent = action === 'install' ? 'Save your work first. Relay will enter maintenance and restart; this tab remains available to monitor the job.' : action === 'cancel' ? 'Cancellation is allowed only before activation. The broker checks whether it is still safe when your request arrives.' : 'Restore the broker’s previous verified release and matching state checkpoint. Relay will restart and changes since that checkpoint may be lost.';
  $('authorize').textContent = `Authorize ${label}`; $('authorize').disabled = true;
  $('password').value = ''; $('confirmed').checked = false; $('confirm-error').hidden = true;
  $('confirm').showModal(); $('confirmed').focus();
}
$('install').onclick = () => confirmAction('install');
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
  const target = action === 'install' ? { version } : action === 'cancel' ? { jobId } : {};
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
$('release-select').onchange = event => { selected = requestedVersion = reviewVersion(event.target.value); saveReview(selected); renderRelease(); };
function clearSession() {
  authenticated = false; fresh = false; csrf = ''; state = null; sessionEpoch++;
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
    if (auth.relayOrigin) { const url = new URL(auth.relayOrigin); if (['http:', 'https:'].includes(url.protocol) && url.hostname === location.hostname) { $('relay-link').href = url.origin; $('relay-link').hidden = false; } }
    $('locked').hidden = authenticated; $('console').hidden = !authenticated; $('logout').hidden = !authenticated;
    if (!authenticated) { $('connection').textContent = 'Monitoring session required'; $('mode').textContent = 'LOCKED'; return; }
    render(await api('state'));
    $('connection').textContent = 'Connected to updater';
    initChamber();
    schedulePoll();
  } catch (error) { fresh = false; notice(error.message); $('connection').textContent = 'Connection unavailable'; $('mode').textContent = 'UNAVAILABLE'; $('locked').hidden = false; }
  finally { bootBusy = false; $('check').disabled = false; }
}
$('retry').onclick = boot;
boot();
