import { createGateway, ROOT } from "../server/gateway.mjs";
import { chromium } from "playwright";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const runtime = await mkdtemp(os.tmpdir() + "/relay-benchmark-"),
  g = await createGateway({ port: 0, runtime }),
  browser = await chromium.launch({ headless: true, chromiumSandbox: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(await readFile(runtime + "/bootstrap-url.txt", "utf8"));
  await page.setContent(
    '<canvas id="notes-lab" width="1280" height="720"></canvas><canvas id="signal-lab" width="1280" height="720"></canvas>',
  );
  await page.evaluate(async () => {
    const { csrf } = await (await fetch("/api/session")).json();
    window.api = async (path, method, body) => {
      const r = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error("Benchmark API failure");
      return r.json();
    };
    window.stats = {};
    window.sockets = {};
    for (const appId of ["notes-lab", "signal-lab"]) {
      const w = await api("/api/windows", "POST", { appId });
      await api("/api/windows/" + w.id, "PATCH", { width: 1280, height: 720 });
      stats[w.id] = { frames: 0, jpegBytes: 0, jsonBytes: 0, ages: [] };
      const ws = new WebSocket(
        location.origin.replace("http", "ws") + "/ws/stream/" + w.id,
      );
      sockets[w.id] = ws;
      ws.onmessage = async (e) => {
        const m = JSON.parse(e.data);
        if (m.type !== "frame") return;
        const image = new Image();
        image.src = "data:" + m.mime + ";base64," + m.data;
        await image.decode();
        document.getElementById(w.id).getContext("2d").drawImage(image, 0, 0);
        const s = stats[w.id];
        s.frames++;
        s.jpegBytes += atob(m.data).length;
        s.jsonBytes += e.data.length;
        s.ages.push(Date.now() - m.sentAt);
        ws.send(JSON.stringify({ type: "ack", seq: m.seq }));
      };
    }
  });
  await page.waitForFunction(() =>
    Object.values(stats).every((s) => s.frames >= 5),
  );
  const startMetrics = await g.manager.metrics(),
    cpu = process.cpuUsage();
  const started = Date.now();
  await page.evaluate(() => {
    for (const s of Object.values(stats)) {
      s.frames = 0;
      s.jpegBytes = 0;
      s.jsonBytes = 0;
      s.ages = [];
    }
  });
  await new Promise((r) => setTimeout(r, 60000));
  const elapsed = (Date.now() - started) / 1000,
    endMetrics = await g.manager.metrics(),
    gatewayCpu = process.cpuUsage(cpu);
  const frames = await page.evaluate(() => stats);
  const processes = execFileSync(
    "ps",
    [
      "-p",
      endMetrics.browserProcesses.map((p) => p.id).join(","),
      "-o",
      "pid=,rss=,pcpu=",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .map((line) => {
      const [pid, rssKiB, pcpu] = line.trim().split(/\s+/).map(Number);
      return { pid, rssKiB, pcpu };
    });
  await page.evaluate(() =>
    api("/api/windows/signal-lab", "PATCH", { visible: false }),
  );
  await new Promise((r) => setTimeout(r, 250));
  const pre = await page.evaluate(() =>
    Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.frames])),
  );
  await new Promise((r) => setTimeout(r, 3000));
  const post = await page.evaluate(() =>
    Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.frames])),
  );
  assert.equal(post["signal-lab"], pre["signal-lab"]);
  assert.ok(post["notes-lab"] > pre["notes-lab"]);
  await page.evaluate(() => {
    for (const ws of Object.values(sockets)) ws.close();
  });
  await new Promise((r) => setTimeout(r, 100));
  for (let i = 0; i < 20; i++) {
    await g.manager.remove("signal-lab");
    const w = await g.manager.open("signal-lab");
    await g.manager.ensure(w);
  }
  await g.manager.remove("signal-lab");
  assert.equal((await g.manager.browserPromise).contexts().length, 1);
  const results = {
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
      totalMemory: os.totalmem(),
      node: process.version,
      playwright: JSON.parse(
        await readFile(ROOT + "node_modules/playwright/package.json"),
      ).version,
      browser: endMetrics.browserVersion,
    },
    durationSeconds: elapsed,
    viewport: "1280x720 each",
    transport:
      "CDP JPEG quality65; WebSocket JSON/base64; one shared sandbox-enabled Chromium; separate contexts",
    streams: Object.fromEntries(
      Object.entries(frames).map(([id, s]) => {
        s.ages.sort((a, b) => a - b);
        return [
          id,
          {
            frames: s.frames,
            fps: s.frames / elapsed,
            jpegBytes: s.jpegBytes,
            jsonBytes: s.jsonBytes,
            jsonMbps: (s.jsonBytes * 8) / elapsed / 1e6,
            sendToDecodePaintAgeMs: {
              p50: s.ages[Math.floor(s.ages.length * 0.5)],
              p95: s.ages[Math.floor(s.ages.length * 0.95)],
              max: s.ages.at(-1),
            },
          },
        ];
      }),
    ),
    browserProcesses: processes,
    browserRSSMiB: processes.reduce((n, p) => n + p.rssKiB, 0) / 1024,
    browserAverageCores:
      (endMetrics.browserProcesses.reduce((n, p) => n + p.cpuTime, 0) -
        startMetrics.browserProcesses.reduce((n, p) => n + p.cpuTime, 0)) /
      elapsed,
    gatewayRSSMiB: endMetrics.gatewayMemory.rss / 1024 / 1024,
    gatewayAverageCores: (gatewayCpu.user + gatewayCpu.system) / 1e6 / elapsed,
    minimizedThreeSecondsFrames: {
      notes: post["notes-lab"] - pre["notes-lab"],
      signal: post["signal-lab"] - pre["signal-lab"],
    },
    repeatedOpenCloseCycles: 20,
    contextsAfterCycles: 1,
    inputToVisibleLatency:
      "UNMEASURED: reported frame age begins at gateway send, not input/capture",
    limits:
      "60 second local synthetic counter workload, not hour stability, WAN, scrolling budget, Safari or production service test",
  };
  await writeFile(
    ROOT + "docs/benchmark-results.json",
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await g.close();
  await rm(runtime, { recursive: true, force: true });
}
