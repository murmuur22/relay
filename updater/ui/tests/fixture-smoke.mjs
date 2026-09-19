import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createGateway, ROOT } from '../../../server/gateway.mjs';
import { createUpdaterWeb } from '../../web/server.mjs';
import { browserLogin, password } from '../../../tests/auth-helper.mjs';

// REAL broker, HMAC fixture release, HTTP bytes, disposable Node service and state rollback.
// No production updater, GitHub proof, systemd, real Relay state or external host is involved.
test('real disposable fixture success and rollback appear in the compiled transfer chamber', { timeout: 65000 }, async t => {
  const reserve = net.createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const uiOrigin = `http://127.0.0.1:${reserve.address().port}`; await new Promise(resolve => reserve.close(resolve));
  const script = "from updater.fixtures.harness import Sandbox\nfrom updater.broker.auth import atomic_json\nimport sys,json\nbox=Sandbox()\ntry:\n box.config['uiOrigin']=sys.argv[1]\n atomic_json(box.config_path,box.config)\n box.start()\n print(json.dumps({'root':str(box.root),'config':box.config}),flush=True)\n sys.stdin.readline()\nfinally:\n box.close()";
  const child = spawn('python3', ['-u', '-c', script, uiOrigin], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errors = '', gateway, web, browser;
  child.stdout.on('data', data => output += data); child.stderr.on('data', data => errors += data);
  t.after(async () => {
    await browser?.close(); await web?.close(); await gateway?.close();
    child.stdin.end('\n');
    if (child.exitCode === null) { const timer = setTimeout(() => child.kill('SIGKILL'), 22000); await once(child, 'exit'); clearTimeout(timer); }
  });
  await expect.poll(() => { if (child.exitCode !== null) throw new Error(errors); return output.includes('\n'); }, { timeout: 15000 }).toBe(true);
  const { root, config } = JSON.parse(output.split('\n')[0]);
  gateway = await createGateway({ port: 0, runtime: root + '/visual-relay', profile: 'standalone', updater: { socketPath: config.socketPath, keyFile: config.bridgeKeyFile, uiOrigin }, maintenanceFile: config.maintenance });
  web = await createUpdaterWeb({ uiOrigin, relayOrigin: gateway.origin, socketPath: config.socketPath });
  browser = await chromium.launch({ chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const desktop = await context.newPage(); await browserLogin(desktop, gateway.origin, root + '/visual-relay');
  await desktop.getByRole('button', { name: 'Open Updater', exact: true }).click();
  await expect(desktop.getByLabel('Available release')).toHaveValue('v0.3.1');assert.equal(context.pages().length,1);
  await desktop.getByRole('button',{name:'Maximize Updater',exact:true}).click();
  await desktop.screenshot({path:ROOT+'/screenshots/updater-desktop-browse-fixture.png',fullPage:true});
  await desktop.getByRole('button',{name:'Restore size Updater',exact:true}).click();
  const opened = context.waitForEvent('page'); await desktop.getByRole('button', { name: 'Start update', exact: true }).click();
  const page = await opened; const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  await expect(page.locator('#mode')).toHaveText('FIXTURE SANDBOX');
  await page.getByRole('button', { name: 'Check releases' }).click();
  async function install(version, phase) {
    await page.locator('#release-select').selectOption(version);
    await page.getByRole('button', { name: 'Review installation' }).click();
    await page.getByLabel('I understand active Relay sessions will be interrupted.').check();
    await page.getByLabel('Current Relay password').fill(password);
    await page.getByRole('button', { name: 'Authorize installation', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('#phase')).toHaveText(phase, { timeout: 30000 });
    assert.equal(await page.locator('#password').inputValue(), '');
  }
  await install('v0.3.1', 'Update complete');
  await expect(page.locator('#current-version')).toHaveText('v0.3.1');
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'webgl');
  await page.getByText('Current job details', { exact: false }).click();
  await page.screenshot({ path: ROOT + '/screenshots/updater-real-fixture-success.png', fullPage: true });
  await install('v0.3.2', 'Rolled back');
  await expect(page.locator('#current-version')).toHaveText('v0.3.1');
  assert.equal(await readFile(root + '/state/fixture.txt', 'utf8'), 'initial synthetic state');
  await page.getByText('Update history', { exact: false }).click();
  await page.screenshot({ path: ROOT + '/screenshots/updater-real-fixture-rollback.png', fullPage: true });
  assert.equal(await page.evaluate(() => window.opener), null);
  await desktop.close(); await gateway.close(); gateway = null;
  await page.reload(); await expect(page.locator('#phase')).toHaveText('Rolled back');
  await expect(page.locator('#current-version')).toHaveText('v0.3.1');
  assert.deepEqual(pageErrors, []);
});
