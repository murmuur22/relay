import { test, expect } from '@playwright/test';
test('the installed release cannot be authorized as a new update', async ({page}) => {
 const state=snapshot();state.currentVersion=state.available[0].version;
 const calls=await mockAPI(page,state);await page.goto('/updater/');
 await expect(page.locator('#current-version')).toHaveText('v0.4.0');
 await expect(page.getByRole('button',{name:'Review installation'})).toBeDisabled();
 await expect(page.locator('#install-reason')).toContainText('already installed');
 expect(calls.some(c=>c.name==='install')).toBe(false);
});
test('handoff never silently substitutes a different release when the selected version disappeared', async ({page})=>{
 const calls=await mockAPI(page);await page.goto('/updater/#'+'a'.repeat(64)+'~v9.9.9');
 await expect(page.locator('#connection')).toContainText('Connected');
 await expect(page.getByRole('button',{name:'Review installation'})).toBeDisabled();
 await expect(page.locator('#install-reason')).toContainText('v9.9.9');
 expect(calls.some(c=>c.name==='install')).toBe(false);expect(new URL(page.url()).hash).toBe('');
 await page.locator('#release-select').selectOption('v0.4.0');await expect(page.getByRole('button',{name:'Review installation'})).toBeEnabled();
});
for (const reload of [false,true]) test(`reviewed handoff installs exact non-default target, reload=${reload}`,async({page})=>{
 const state=snapshot();state.available.push({...state.available[0],version:'v0.5.0'});
 const calls=await mockAPI(page,state),ticket='a'.repeat(64);
 await page.goto('/updater/#'+ticket+'~v0.5.0');
 await expect(page.locator('#release-select')).toHaveValue('v0.5.0');
 if(reload){await page.reload();await expect(page.locator('#release-select')).toHaveValue('v0.5.0');}
 expect(await page.evaluate(()=>history.state)).toEqual({reviewedVersion:'v0.5.0'});
 expect(calls.filter(c=>c.name==='exchange')).toHaveLength(1);
 expect(calls.every(c=>c.hash==='')).toBe(true);
 expect(calls.some(c=>c.name==='install')).toBe(false);
 await page.getByRole('button',{name:'Review installation'}).click();
 await expect(page.locator('#confirm-title')).toHaveText('Install v0.5.0?');
 await page.locator('#confirmed').check();await page.locator('#password').fill('synthetic-password-only');
 await page.getByRole('button',{name:'Authorize installation',exact:true}).click();
 await expect.poll(()=>calls.filter(c=>c.name==='install').length).toBe(1);
 expect(calls.find(c=>c.name==='install').body).toEqual({version:'v0.5.0',password:'synthetic-password-only',confirmed:true});
 expect(await page.evaluate(()=>({history:history.state,local:{...localStorage},session:{...sessionStorage}}))).toEqual({history:{reviewedVersion:'v0.5.0'},local:{},session:{}});
});
test('unavailable saved review target requires explicit selection after reload',async({page})=>{
 const calls=await mockAPI(page);await page.goto('/updater/#'+'a'.repeat(64)+'~v9.9.9');
 await expect(page.locator('#connection')).toContainText('Connected');await page.reload();
 await expect(page.locator('#install-reason')).toContainText('v9.9.9');await expect(page.locator('#install')).toBeDisabled();
 expect(calls.some(c=>c.name==='install')).toBe(false);
 await page.locator('#release-select').selectOption('v0.4.0');await page.reload();
 await expect(page.locator('#release-select')).toHaveValue('v0.4.0');await expect(page.locator('#install')).toBeEnabled();
});
export const snapshot = () => ({ protocol: 1, mode: 'fixture', currentVersion: 'v0.3.0', available: [{ version: 'v0.4.0', notes: 'Synthetic release notes\nA safer update path. <img src=x onerror=alert(1)>', size: 104857600, verified: true }], job: null, history: [], canInstall: true, reason: null });
async function mockAPI(page, state = snapshot(), options = {}) {
  const calls = [];
  await page.route('**/updater/api/**', async route => {
    const request = route.request(), name = new URL(request.url()).pathname.split('/').pop();
    calls.push({ name, body: request.postDataJSON(), headers: request.headers(), hash: await page.evaluate(() => location.hash) });
    let json = name === 'auth' ? { authenticated: true, csrf: 'synthetic-csrf', interfaceAnimations: options.motion ?? true, relayOrigin: 'http://127.0.0.1:4180' } : name === 'exchange' ? { csrf: 'synthetic-csrf', interfaceAnimations: true } : state;
    await route.fulfill({ json, status: 200 });
  });
  return calls;
}
const job = (phase = 'downloading', totalBytes = 104857600) => ({ id: 'synthetic-job', version: 'v0.4.0', phase, downloadedBytes: 26214400, totalBytes, startedAt: '2026-09-19T12:00:00Z', updatedAt: '2026-09-19T12:00:01Z', canCancel: phase === 'downloading', canRollback: phase === 'succeeded', outcome: null, error: null, events: [{ at: '2026-09-19T12:00:00Z', phase, message: 'Synthetic broker event <script>unsafe()</script>' }] });
test('polls real snapshot bytes without fabricated progress, unknown totals and failure remain truthful', async ({ page }) => {
  const state = snapshot(); state.job = job();
  await mockAPI(page, state);
  await page.goto('/updater/');
  await expect(page.locator('#phase')).toHaveText('Downloading');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await expect(page.locator('#bytes')).toHaveText('26,214,400 / 104,857,600 bytes');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeDisabled();
  state.job = job('downloading', null);
  await expect(page.locator('#bytes')).toHaveText('26,214,400 bytes · total unknown');
  await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  state.job = { ...job('rollback-failed'), error: 'Recovery required', outcome: 'rollback-failed' };
  state.history = [{ id: 'prior', version: 'v0.3.0', phase: 'rolled-back', outcome: 'rolled-back' }];
  await expect(page.locator('#phase')).toHaveText('Recovery required');
  await expect(page.locator('#phase-detail')).toContainText('Recovery required');
  await page.getByText('Current job details', { exact: false }).click();
  await expect(page.locator('#events')).toContainText('<script>unsafe()</script>');
  expect(await page.locator('#events script').count()).toBe(0);
  await page.getByText('Update history', { exact: false }).click();
  await expect(page.locator('#history')).toContainText('rolled-back');
});
test('installation requires explicit interruption consent and transient password; rejection preserves monitoring', async ({ page }) => {
  const calls = await mockAPI(page);
  await page.route('**/updater/api/install', async route => {
    calls.push({ name: 'install', body: route.request().postDataJSON(), headers: route.request().headers() });
    await route.fulfill({ status: 403, json: { error: 'Rejected' } });
  });
  await page.goto('/updater/');
  await page.getByRole('button', { name: 'Review installation' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Authorize installation' })).toBeDisabled();
  await page.getByLabel('Current Relay password').fill('synthetic-password-only');
  await page.getByLabel('I understand active Relay sessions will be interrupted.').check();
  await page.getByRole('button', { name: 'Authorize installation' }).click();
  await expect(page.getByLabel('Current Relay password')).toHaveValue('');
  await expect(page.locator('#confirm-error')).toContainText('Authorization was not accepted');
  expect(calls.find(call => call.name === 'install').body).toEqual({ version: 'v0.4.0', password: 'synthetic-password-only', confirmed: true });
  expect(calls.find(call => call.name === 'install').headers['x-csrf-token']).toBe('synthetic-csrf');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.locator('#connection')).toContainText('Connected');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain('synthetic-password');
});
test('download trails animate only activity, freeze for reduced motion, and disappear after transfer', async ({ page }) => {
  const state = snapshot(); state.job = job();
  await mockAPI(page, state); await page.goto('/updater/');
  const chamber = page.locator('#chamber');
  await expect(chamber).toHaveAttribute('data-packets', 'visible');
  await expect(page.locator('#motion-explanation')).toContainText('not transfer speed');
  const canvas = page.locator('#chamber canvas');
  const initial = await canvas.screenshot();
  await expect.poll(async () => (await canvas.screenshot()).equals(initial)).toBe(false);
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(chamber).toHaveAttribute('data-motion', 'off');
  const stopped = await canvas.screenshot();
  await page.getByRole('button', { name: 'Check releases' }).click();
  await expect(page.locator('#connection')).toHaveText('Connected to updater');
  expect((await canvas.screenshot()).equals(stopped)).toBe(true);
  state.job = job('verifying');
  await page.getByRole('button', { name: 'Check releases' }).click();
  await expect(chamber).toHaveAttribute('data-packets', 'hidden');
  await expect(page.locator('#phase')).toHaveText('Verifying');
});
test('WebGL chamber renders and OS or handed-off preferences stop all motion', async ({ page }) => {
  const state = snapshot(); state.job = job();
  await mockAPI(page, state);
  await page.goto('/updater/');
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'webgl');
  await expect(page.locator('#chamber canvas')).toBeVisible();
  await expect(page.locator('#chamber')).toHaveAttribute('data-motion', 'on');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#chamber')).toHaveAttribute('data-motion', 'off');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('#chamber')).toHaveAttribute('data-motion', 'on');
  await page.screenshot({ path: '../../screenshots/updater-synthetic-transfer.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('#chamber canvas').evaluate(canvas => canvas.clientWidth === canvas.parentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'webgl');
  await page.screenshot({ path: '../../screenshots/updater-synthetic-webgl-mobile.png', fullPage: true });
});
test('no WebGL is fully functional; account animation preference overrides OS', async ({ page }) => {
  await page.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type.includes('webgl') ? null : original.call(this, type, ...args); }; });
  await mockAPI(page, snapshot(), { motion: false });
  await page.goto('/updater/');
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'static');
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.locator('#motion-label')).toHaveText('MOTION OFF');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../../screenshots/updater-synthetic-fallback-mobile.png', fullPage: true });
});
test('logout verifies session ended and removes private state', async ({ page }) => {
  const calls = await mockAPI(page);
  let signedOut = false;
  await page.route('**/updater/api/logout', async route => { signedOut = true; calls.push({ name: 'logout', body: route.request().postDataJSON() }); await route.fulfill({ json: { ok: true } }); });
  await page.route('**/updater/api/auth', route => route.fulfill({ json: { authenticated: !signedOut, csrf: 'synthetic-csrf', interfaceAnimations: false, relayOrigin: 'http://127.0.0.1:4180' } }));
  await page.goto('/updater/');
  await page.getByRole('button', { name: 'End monitoring session' }).click();
  await expect(page.locator('#console')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Open from Relay' })).toBeVisible();
  expect(calls.find(call => call.name === 'logout').body).toEqual({});
});
test('connectivity loss freezes stale action controls then recovers without guessing success', async ({ page }) => {
  await mockAPI(page);
  let offline = false;
  await page.route('**/updater/api/state', route => route.fulfill({ status: offline ? 503 : 200, json: offline ? { error: 'Unavailable' } : snapshot() }));
  await page.goto('/updater/');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeEnabled();
  offline = true;
  await expect(page.locator('#connection')).toContainText('last known state');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeDisabled();
  offline = false;
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeEnabled();
});
test('an open authorization dialog freezes on lost connectivity and recovers explicitly', async ({ page }) => {
  await mockAPI(page);
  let offline = false;
  await page.route('**/updater/api/state', route => route.fulfill({ status: offline ? 503 : 200, json: offline ? { error: 'Unavailable' } : snapshot() }));
  await page.goto('/updater/');
  await page.getByRole('button', { name: 'Review installation' }).click();
  await page.getByLabel('Current Relay password').fill('synthetic-password');
  await page.getByLabel('I understand active Relay sessions will be interrupted.').check();
  const authorize = page.getByRole('button', { name: 'Authorize installation' });
  await expect(authorize).toBeEnabled();
  offline = true;
  await expect(page.locator('#connection')).toContainText('last known state');
  await expect(authorize).toBeDisabled();
  offline = false;
  await expect(page.locator('#connection')).toHaveText('Connected to updater');
  await expect(authorize).toBeEnabled();
});
const staleConfirmationCases = [
  ['install', 'installation disabled', state => { state.canInstall = false; }],
  ['install', 'release removed with another verified release available', state => { state.available = [{ ...state.available[0], version: 'v0.5.0' }]; }],
  ['install', 'release unverified', state => { state.available[0].verified = false; }],
  ['install', 'new active job', state => { state.job = job(); }],
  ['install', 'observe mode', state => { state.mode = 'observe'; }],
  ['install', 'interrupted job', state => { state.job = job('interrupted'); }],
  ['install', 'failed rollback', state => { state.job = job('rollback-failed'); }],
  ...['cancel', 'rollback'].flatMap(action => [
    [action, 'permission revoked', state => { state.job[action === 'cancel' ? 'canCancel' : 'canRollback'] = false; }],
    [action, 'job replaced while still eligible', state => { state.job.id = 'replacement-job'; }],
    [action, 'job removed', state => { state.job = null; }],
  ]),
];
for (const [action, change, invalidate] of staleConfirmationCases) {
  test(`stale confirmation: ${action} requires review again after ${change}`, async ({ page }) => {
    const state = snapshot();
    if (action !== 'install') state.job = job(action === 'cancel' ? 'downloading' : 'succeeded');
    const original = structuredClone(state);
    const calls = await mockAPI(page, state, { motion: false });
    const mutations = () => calls.filter(call => ['install', 'cancel', 'rollback'].includes(call.name));
    await page.goto('/updater/');
    await page.locator(`#${action}`).click();
    await page.locator('#password').fill('synthetic-password');
    await page.locator('#confirmed').check();
    await expect(page.locator('#authorize')).toBeEnabled();

    invalidate(state);
    state.currentVersion = 'invalidating-poll';
    await expect(page.locator('#current-version')).toHaveText('invalidating-poll');
    await expect(page.locator('#authorize')).toBeDisabled();
    await expect(page.locator('#password')).toHaveValue('');
    await expect(page.locator('#confirm-error')).toContainText('review again');

    // Even a later eligible poll must not revive the old authorization.
    Object.assign(state, structuredClone(original), { currentVersion: 'restoring-poll' });
    await expect(page.locator('#current-version')).toHaveText('restoring-poll');
    await page.locator('#password').fill('synthetic-password');
    await page.locator('#confirmed').check();
    await expect(page.locator('#authorize')).toBeDisabled();
    // Exercise the submit guard independently of the disabled button.
    await page.locator('#confirm-form').dispatchEvent('submit');
    expect(mutations()).toEqual([]);
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.locator('#back').click();
    await page.locator(`#${action}`).click();
    await page.locator('#password').fill('synthetic-password');
    await page.locator('#confirmed').check();
    await page.locator('#authorize').click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    expect(mutations().map(call => ({ name: call.name, body: call.body }))).toEqual([{
      name: action,
      body: { ...(action === 'install' ? { version: 'v0.4.0' } : action === 'cancel' ? { jobId: 'synthetic-job' } : {}), password: 'synthetic-password', confirmed: true },
    }]);
  });
}
test('initial state read cannot overlap a manual release check', async ({ page }) => {
  await mockAPI(page);
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**/updater/api/state', async route => { await held; await route.fulfill({ json: snapshot() }); });
  try {
    await page.goto('/updater/');
    await expect(page.locator('#console')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check releases' })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('button', { name: 'Check releases' })).toBeEnabled();
});
test('expired Relay action session does not imply expired read-only monitoring', async ({ page }) => {
  await mockAPI(page);
  await page.route('**/updater/api/install', route => route.fulfill({ status: 401, json: { error: 'Sign in to Relay' } }));
  await page.goto('/updater/');
  await page.getByRole('button', { name: 'Review installation' }).click();
  await page.getByLabel('Current Relay password').fill('synthetic');
  await page.getByLabel('I understand active Relay sessions will be interrupted.').check();
  await page.getByRole('button', { name: 'Authorize installation' }).click();
  await expect(page.locator('#confirm-error')).toContainText('Sign in to Relay again');
  await expect(page.locator('#confirm-error')).not.toContainText('Monitoring session expired');
  await page.screenshot({ path: '../../screenshots/updater-synthetic-reauth.png', fullPage: true });
});
test('cancel and rollback use bound API targets, never optimistic success', async ({ page }) => {
  const state = snapshot(); state.job = job();
  const calls = await mockAPI(page, state);
  for (const [action, button, authorize, terminal] of [['cancel', 'Cancel transfer', 'Authorize cancellation', 'cancelled'], ['rollback', 'Review rollback', 'Authorize rollback', 'rolled-back']]) {
    if (action === 'rollback') state.job = job('succeeded');
    await page.goto('/updater/');
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByLabel('Current Relay password').fill('synthetic-password');
    await page.getByLabel('I understand active Relay sessions will be interrupted.').check();
    await page.getByRole('button', { name: authorize }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const call = calls.find(call => call.name === action);
    expect(call.body).toEqual({ ...(action === 'cancel' ? { jobId: 'synthetic-job' } : {}), password: 'synthetic-password', confirmed: true });
    expect(await page.locator('#phase').textContent()).not.toBe(terminal);
  }
});
test('every broker phase is represented without treating downloaded bytes as update completion', async ({ page }) => {
  const state = snapshot(); await mockAPI(page, state, { motion: false }); await page.goto('/updater/');
  const labels = { checking: 'Checking releases', downloading: 'Downloading', verifying: 'Verifying', staging: 'Staging', 'backing-up': 'Backing up', activating: 'Activating', restarting: 'Restarting Relay', 'health-checking': 'Checking readiness', succeeded: 'Update complete', failed: 'Update failed', 'rolled-back': 'Rolled back', 'rollback-failed': 'Recovery required', cancelled: 'Transfer cancelled', interrupted: 'Update interrupted' };
  for (const [phase, label] of Object.entries(labels)) {
    state.job = { ...job(phase), downloadedBytes: 104857600 };
    await page.getByRole('button', { name: 'Check releases' }).click();
    await expect(page.locator('#phase')).toHaveText(label);
    await expect(page.locator('#percentage')).toHaveText('100% of artifact');
  }
  await expect(page.locator('#chamber')).toHaveAttribute('data-motion', 'off');
  await page.screenshot({ path: '../../screenshots/updater-synthetic-interrupted.png', fullPage: true });
});
test('observe and empty releases never offer installation; session expiry hides protected content', async ({ page }) => {
  const state = snapshot(); state.mode = 'observe'; state.canInstall = false; state.available = [];
  await mockAPI(page, state); await page.goto('/updater/');
  await expect(page.locator('#mode')).toHaveText('OBSERVE / READ ONLY');
  await expect(page.locator('#verification')).toHaveText('No published release available.');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeDisabled();
  await page.route('**/updater/api/state', route => route.fulfill({ status: 401, json: { error: 'Expired' } }));
  await expect(page.locator('#mode')).toHaveText('SESSION EXPIRED');
  await expect(page.locator('#console')).toBeHidden();
});
test('lost WebGL context switches to usable static fallback', async ({ page }) => {
  await mockAPI(page); await page.goto('/updater/');
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'webgl');
  await page.locator('#chamber canvas').evaluate(canvas => canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'static');
  await expect(page.locator('#fallback')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeEnabled();
});
test('confirmation supporting text has readable contrast on the light surface', async ({ page }) => {
  await mockAPI(page); await page.goto('/updater/'); await page.getByRole('button', { name: 'Review installation' }).click();
  const ratios = await page.locator('dialog').evaluate(dialog => {
    const luminance = color => { const rgb = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; }); return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722; };
    const background = luminance(getComputedStyle(dialog).backgroundColor);
    return [...dialog.querySelectorAll('.eyebrow,.fine')].map(element => { const foreground = luminance(getComputedStyle(element).color); return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05); });
  });
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});
test('unverified releases never receive a verified label or install control', async ({ page }) => {
  const state = snapshot(); state.available[0].verified = false;
  await mockAPI(page, state); await page.goto('/updater/');
  await expect(page.locator('#verification')).toContainText('Not verified');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeDisabled();
  await expect(page.locator('.chamber-label')).not.toContainText('VERIFIED');
});
test('clears launch fragment before exchange and renders actual release data safely', async ({ page }) => {
  const calls = await mockAPI(page);
  await page.goto('/updater/?keep=1#synthetic-ticket');
  await expect(page.getByRole('heading', { name: 'Transfer chamber' })).toBeVisible();
  await expect(page.getByText('FIXTURE SANDBOX', { exact: true })).toBeVisible();
  await expect(page.locator('#current-version')).toHaveText('v0.3.0');
  await expect(page.locator('#release-notes')).toContainText('<img src=x onerror=alert(1)>');
  expect(await page.locator('#release-notes img').count()).toBe(0);
  expect(calls[0].name).toBe('exchange');
  expect(calls[0].hash).toBe('');
  expect(calls[0].body).toEqual({ ticket: 'synthetic-ticket' });
  expect(page.url()).toContain('?keep=1');
  await expect(page.getByRole('button', { name: 'Review installation' })).toBeEnabled();
});
