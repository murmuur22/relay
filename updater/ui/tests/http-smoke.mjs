import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createUpdaterWeb } from '../../web/server.mjs';

// REAL compiled UI + sibling HTTP server + Chromium. SYNTHETIC Unix broker and Relay auth.
// Does NOT verify an artifact, restart Relay, or qualify the engine.
test('compiled UI uses real HTTP cookies, CSRF and action bridge; read monitoring survives Relay fixture shutdown', { timeout: 25000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'relay-ui-http-'));
  const socketPath = join(root, 'broker.sock');
  const token = 'a'.repeat(64), ticket = 'b'.repeat(64), authorization = 'c'.repeat(64);
  const state = { protocol: 1, mode: 'fixture', currentVersion: 'v0.3.0', available: [{ version: 'v0.4.0', notes: 'SYNTHETIC HTTP CONTRACT FIXTURE\nNo real release or service activation.', verified: true, size: 1048576 }], job: null, history: [], canInstall: true, reason: null };
  let starts = 0, prepares = 0, authorized = null;
  const authorizations = [];
  const jobId = 'd'.repeat(32);
  const broker = net.createServer(socket => {
    let input = '';
    socket.on('data', data => {
      input += data;
      if (!input.includes('\n')) return;
      const request = JSON.parse(input.split('\n')[0]); input = '';
      let result;
      if (request.action === 'redeem-ui') {
        assert.equal(request.params.ticket, ticket);
        result = { token, userId: 'synthetic-user', interfaceAnimations: false, expiresAt: Date.now() + 60000 };
      } else {
        assert.equal(request.params.token, token);
        assert.notEqual(request.action, 'start', 'no immediate-install fallback');
        if (request.action === 'prepare' || request.action === 'apply') {
          assert.equal(request.params.authorization, authorization); assert.equal(request.params.version, 'v0.4.0');
          assert.equal(authorized, request.action); authorized = null;
          if (request.action === 'prepare') {
            assert.equal(request.params.jobId, undefined); prepares++;
            state.job = { id: jobId, kind: 'prepare', userId: 'synthetic-user', version: 'v0.4.0', phase: 'ready', downloadedBytes: 1048576, totalBytes: 1048576, canCancel: true, canRollback: false, events: [], outcome: null, error: null };
            state.canPrepare = false; state.canApply = true;
          } else {
            assert.equal(request.params.jobId, jobId); assert.equal(state.job.phase, 'ready'); starts++;
            state.job.phase = 'restarting'; state.job.canCancel = false; state.canApply = false;
          }
          state.canInstall = false;
        }
        result = state;
      }
      socket.end(JSON.stringify({ ok: true, result }) + '\n');
    });
  });
  const relay = http.createServer(async (req, res) => {
    assert.ok(req.headers.cookie.includes('relay_session='));
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/session') res.end(JSON.stringify({ user: { id:'synthetic-user', role: 'admin', disabled: false, mustChange: false }, csrf: 'e'.repeat(64) }));
    else {
      let body = ''; for await (const chunk of req) body += chunk;
      const data = JSON.parse(body); assert.equal(data.password, 'synthetic-password'); assert.equal(data.confirmed, true); assert.equal(req.headers['x-csrf-token'], 'e'.repeat(64));
      assert.ok(['prepare', 'apply'].includes(data.action)); assert.equal(data.version, 'v0.4.0');
      assert.equal(data.jobId, data.action === 'apply' ? jobId : undefined);
      authorized = data.action; authorizations.push(data.action);
      res.end(JSON.stringify({ authorization, expiresAt: Date.now() + 60000 }));
    }
  });
  let web, browser;
  try {
    await new Promise(resolve => broker.listen(socketPath, resolve));
    await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
    const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
    const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
    const uiOrigin = `http://127.0.0.1:${port}`;
    web = await createUpdaterWeb({ uiOrigin, relayOrigin: `http://127.0.0.1:${relay.address().port}`, socketPath });
    browser = await chromium.launch({ chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.addCookies([{ name: 'relay_session', value: 'f'.repeat(64), url: uiOrigin, httpOnly: true, sameSite: 'Strict' }]);
    const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    const fonts=[];page.on('response',response=>{if(response.url().endsWith('.woff2'))fonts.push(response.status());});
    await page.goto(`${uiOrigin}/updater/#${ticket}`);
    await page.locator('#console:not([hidden])').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Review installation' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Download & prepare' }).isDisabled(), true);
    assert.match(await page.locator('#install-reason').textContent(), /Staged updates unsupported/);
    assert.equal(prepares, 0); assert.equal(starts, 0); assert.deepEqual(authorizations, []);
    state.capabilities = { prepare: 1, apply: 1 }; state.canPrepare = true; state.canApply = false;
    await page.getByRole('button', { name: 'Download & prepare' }).click();
    await page.evaluate(()=>document.fonts.ready);assert.deepEqual(fonts,[200,200]);assert.equal(await page.evaluate(()=>document.fonts.check('700 44px "Relay Pixel"')&&document.fonts.check('400 12px "Relay Mono"')),true);
    const noCsrf = await context.request.post(`${uiOrigin}/updater/api/prepare`, { headers: { Origin: uiOrigin }, data: { version: 'v0.4.0', password: 'synthetic-password', confirmed: true } });
    assert.equal(noCsrf.status(), 403); assert.equal(prepares, 0); assert.deepEqual(authorizations, []);
    await page.getByLabel('Current Relay password').fill('synthetic-password');
    await page.getByLabel('I authorize download and preparation only, not Apply.').check();
    await page.getByRole('button', { name: 'Authorize preparation' }).click();
    await page.waitForFunction(() => document.getElementById('phase').textContent === 'Ready to apply');
    assert.equal(prepares, 1); assert.equal(starts, 0); assert.deepEqual(authorizations, ['prepare']);
    await page.getByRole('button', { name: 'Apply v0.4.0', exact: true }).click();
    assert.equal(await page.getByLabel('Current Relay password').inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'Authorize Apply' }).isDisabled(), true);
    await page.getByLabel('Current Relay password').fill('synthetic-password');
    await page.getByLabel('I understand active Relay sessions will be interrupted.').check();
    await page.getByRole('button', { name: 'Authorize Apply' }).click();
    await page.waitForFunction(() => document.getElementById('phase').textContent === 'Restarting Relay');
    assert.equal(starts, 1);
    assert.deepEqual(authorizations, ['prepare', 'apply']);
    assert.equal(new URL(page.url()).hash, '');
    assert.ok((await context.cookies()).some(cookie => cookie.name === 'relay_updater_session' && cookie.httpOnly));
    await new Promise(resolve => { relay.close(resolve); relay.closeAllConnections(); });
    state.job.phase = 'rolled-back'; state.job.outcome = 'rolled-back'; state.job.error = 'Synthetic readiness failure; previous state restored.';
    state.history = [{ version: 'v0.4.0', outcome: 'rolled-back' }];
    await page.waitForFunction(() => document.getElementById('phase').textContent === 'Rolled back');
    await page.getByText('Current job details', { exact: false }).click();
    await page.getByText('Update history', { exact: false }).click();
    await page.screenshot({ path: '../../screenshots/updater-synthetic-http-rollback.png', fullPage: true });
    assert.deepEqual(errors, []);
    assert.equal(await page.locator('#connection').textContent(), 'Connected to updater');
    await page.getByRole('button', { name: 'End monitoring session' }).click();
    await page.waitForFunction(() => document.getElementById('console').hidden);
    assert.equal((await context.cookies()).some(cookie => cookie.name === 'relay_updater_session'), false);
  } finally {
    await browser?.close(); await web?.close();
    await new Promise(resolve => { relay.close(resolve); relay.closeAllConnections(); });
    await new Promise(resolve => broker.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
