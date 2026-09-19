// Visual recording ONLY: scripted synthetic broker responses, not install evidence.
// The separate fixture-smoke.mjs exercises actual transfer/activation/rollback.
import { preview } from 'vite';
import { chromium, expect } from '@playwright/test';
import { mkdir, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('../../../screenshots/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 0, strictPort: true } });
let browser;
try {
  browser = await chromium.launch({ chromiumSandbox: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1024 }, recordVideo: { dir: output, size: { width: 1280, height: 1024 } } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const job = { id: 'synthetic-recording', version: 'v0.4.0', phase: 'downloading', downloadedBytes: 0, totalBytes: 104857600, canCancel: false, canRollback: false, events: [] };
  const state = { protocol: 1, mode: 'fixture', currentVersion: 'v0.3.0', available: [{ version: 'v0.4.0', notes: 'SYNTHETIC MOTION PREVIEW\n\nScripted phases for visual review.\nThis recording does not install a release.\n\nSeparate maintenance tab.\nByte-driven assembly.\nReduced-motion support.', size: job.totalBytes, verified: true }], job, history: [], canInstall: false, reason: 'Visual preview only — installation disabled.' };
  await page.route('**/updater/api/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    if (!['auth', 'state', 'check'].includes(name)) return route.fulfill({ status: 405, json: { error: 'Visual preview is read-only' } });
    await route.fulfill({ json: name === 'auth' ? { authenticated: true, csrf: 'synthetic-preview', interfaceAnimations: true } : state });
  });
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/updater/`);
  await expect(page.locator('#chamber')).toHaveAttribute('data-renderer', 'webgl');
  // Deliberate shot pacing, never a readiness/test synchronization substitute.
  for (const bytes of [0, 26214400, 68157440, 104857600]) {
    job.downloadedBytes = bytes;
    await page.getByRole('button', { name: 'Check releases' }).click();
    await expect(page.locator('#percentage')).toHaveText(`${Math.floor(bytes / job.totalBytes * 100)}% of artifact`);
    await page.waitForTimeout(1800);
    if (bytes === 26214400) await page.screenshot({ path: output + 'updater-synthetic-preview.png', fullPage: true });
  }
  for (const [phase, label] of [['verifying', 'Verifying'], ['activating', 'Activating'], ['restarting', 'Restarting Relay'], ['health-checking', 'Checking readiness'], ['succeeded', 'Update complete']]) {
    job.phase = phase;
    if (phase === 'succeeded') state.currentVersion = job.version;
    await page.getByRole('button', { name: 'Check releases' }).click();
    await expect(page.locator('#phase')).toHaveText(label);
    await page.waitForTimeout(1300);
  }
  expect(errors).toEqual([]);
  const video = page.video();
  await context.close();
  await rename(await video.path(), output + 'updater-synthetic-motion.webm');
  console.log('Saved screenshots/updater-synthetic-motion.webm — scripted UI preview, not installation evidence.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
