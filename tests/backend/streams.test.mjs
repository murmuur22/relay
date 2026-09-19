import {authenticate} from '../auth-helper.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createGateway } from "../../server/gateway.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test(
  "two actual gateway streams, focused text, bounded frames, pause resume reconnect and persistence",
  { timeout: 40000 },
  async () => {
    const runtime = await mkdtemp(tmpdir() + "/relay-stream-");
    let g = await createGateway({ port: 0, runtime });
    let sockets = [];
    try {
      const {cookie}=await authenticate(g.origin,runtime);
      const session = await (
        await fetch(g.origin + "/api/session", { headers: { cookie } })
      ).json();
      const api = async (path, method = "GET", body) => {
        const r = await fetch(g.origin + path, {
          method,
          headers: {
            cookie,
            Origin: g.origin,
            "X-CSRF-Token": session.csrf,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        assert.ok(r.ok, `${path}: ${r.status}`);
        return r.json();
      };
      const a = await api("/api/windows", "POST", { appId: "notes-lab" });
      const b = await api("/api/windows", "POST", { appId: "signal-lab" });
      assert.notEqual(a.id, b.id);
      const frames = [[], []];
      for (const [i, w] of [a, b].entries()) {
        const ws = new WebSocket(
          g.origin.replace("http", "ws") + "/ws/stream/" + w.id,
          { headers: { cookie, Origin: g.origin } },
        );
        sockets.push(ws);
        ws.on("message", (raw) => {
          const m = JSON.parse(raw);
          if (m.type === "frame") {
            frames[i].push(m);
            if (i === 1) ws.send(JSON.stringify({ type: "ack", seq: m.seq }));
          }
        });
        await new Promise((r, j) => {
          ws.once("open", r);
          ws.once("error", j);
        });
      }
      await sleep(1300);
      assert.equal(frames[0].length, 1);
      assert.ok(frames[1].length > 3);
      assert.ok(frames[0][0].data.length > 100);
      const metrics = await api("/api/metrics");
      assert.ok(
        metrics.browserProcesses.some((p) => p.type === "browser" && p.id > 0),
      );
      assert.ok(metrics.browserVersion);
      await api("/api/windows/" + b.id, "PATCH", { width: 1200, height: 700 });
      await sleep(250);
      const latest = frames[1].at(-1);
      const actual = await g.manager.resources
        .get(b.id)
        .page.evaluate(async (data) => {
          const blob = await (
            await fetch("data:image/jpeg;base64," + data)
          ).blob();
          const image = await createImageBitmap(blob);
          return { width: image.width, height: image.height };
        }, latest.data);
      assert.deepEqual(actual, { width: 1200, height: 700 });
      await api("/api/windows/" + a.id, "PATCH", { focused: true });
      sockets[0].send(
        JSON.stringify({
          type: "pointer",
          phase: "down",
          x: 100,
          y: 150,
          button: 0,
          buttons: 1,
        }),
      );
      sockets[0].send(
        JSON.stringify({
          type: "pointer",
          phase: "up",
          x: 100,
          y: 150,
          button: 0,
          buttons: 0,
        }),
      );
      sockets[0].send(
        JSON.stringify({ type: "text", text: "synthetic alpha" }),
      );
      sockets[1].send(
        JSON.stringify({ type: "text", text: "must not arrive" }),
      );
      await sleep(250);
      assert.equal(
        await g.manager.resources
          .get(a.id)
          .page.locator("textarea")
          .inputValue(),
        "synthetic alpha",
      );
      assert.equal(
        await g.manager.resources
          .get(b.id)
          .page.locator("textarea")
          .inputValue(),
        "",
      );
      await api("/api/windows/" + b.id, "PATCH", { visible: false });
      await sleep(150);
      const count = frames[1].length;
      await sleep(400);
      assert.equal(frames[1].length, count);
      await api("/api/windows/" + b.id, "PATCH", {
        visible: true,
        focused: true,
      });
      await sleep(400);
      assert.ok(frames[1].length > count);
      sockets[1].send(
        JSON.stringify({
          type: "pointer",
          phase: "down",
          x: 100,
          y: 150,
          button: 0,
          buttons: 1,
        }),
      );
      sockets[1].send(
        JSON.stringify({
          type: "pointer",
          phase: "up",
          x: 100,
          y: 150,
          button: 0,
          buttons: 0,
        }),
      );
      sockets[1].send(JSON.stringify({ type: "text", text: "synthetic beta" }));
      await sleep(150);
      assert.equal(
        await g.manager.resources
          .get(b.id)
          .page.locator("textarea")
          .inputValue(),
        "synthetic beta",
      );
      sockets[1].send(
        JSON.stringify({
          type: "key",
          phase: "down",
          key: "Backspace",
          code: "Backspace",
          modifiers: 0,
        }),
      );
      sockets[1].send(
        JSON.stringify({
          type: "key",
          phase: "up",
          key: "Backspace",
          code: "Backspace",
          modifiers: 0,
        }),
      );
      await sleep(100);
      assert.equal(
        await g.manager.resources
          .get(b.id)
          .page.locator("textarea")
          .inputValue(),
        "synthetic bet",
      );
      sockets[1].send(
        JSON.stringify({
          type: "wheel",
          x: 500,
          y: 400,
          deltaY: 350,
          deltaX: 0,
        }),
      );
      // CDP wheel dispatch and compositor scroll are asynchronous, especially when
      // other browser tests run concurrently. Wait for the actual effect.
      await g.manager.resources.get(b.id).page.waitForFunction(() => scrollY > 0, null, {timeout:3000});
      assert.ok(
        (await g.manager.resources.get(b.id).page.evaluate(() => scrollY)) > 0,
      );
      sockets[1].send(
        JSON.stringify({
          type: "key",
          phase: "down",
          key: "Shift",
          code: "ShiftLeft",
          modifiers: 8,
        }),
      );
      await sleep(50);
      sockets.forEach((s) => s.close());
      await sleep(150);
      assert.equal(g.manager.resources.get(a.id).capturing, false);
      await api("/api/windows/" + a.id, "PATCH", { x: 123, width: 720 });
      await api("/api/windows/" + b.id, "DELETE");
      assert.equal(g.manager.resources.has(b.id), false);
      await g.close();
      g = await createGateway({ port: 0, runtime });
      await authenticate(g.origin,runtime);
      assert.equal(g.manager.windows.get(a.id).x, 123);
      assert.equal(g.manager.windows.size, 1);
    } finally {
      sockets.forEach((s) => s.terminate());
      await g.close();
      await rm(runtime, { recursive: true, force: true });
    }
  },
);
