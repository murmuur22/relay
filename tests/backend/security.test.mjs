import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import http from "node:http";
import WebSocket from "ws";
import { createGateway } from "../../server/gateway.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test(
  "hostile authorization, launch URLs, concurrent viewers, egress, malformed messages and reconnect",
  { timeout: 20000 },
  async () => {
    const runtime = await mkdtemp(tmpdir() + "/relay-security-");
    const g = await createGateway({ port: 0, runtime });
    let sockets = [];
    try {
      assert.equal((await stat(runtime)).mode & 0o777, 0o700);
      assert.equal(
        (await stat(runtime + "/bootstrap-url.txt")).mode & 0o777,
        0o600,
      );
      const hostile = await new Promise((resolve) => {
        http.get(g.origin, { headers: { Host: "evil.invalid" } }, (r) => {
          r.resume();
          resolve(r.statusCode);
        });
      });
      assert.equal(hostile, 403);
      const boot = await readFile(runtime + "/bootstrap-url.txt", "utf8");
      const r = await fetch(boot, { redirect: "manual" });
      const cookie = r.headers.get("set-cookie").split(";")[0];
      const session = await (
        await fetch(g.origin + "/api/session", { headers: { cookie } })
      ).json();
      const headers = {
        cookie,
        Origin: g.origin,
        "X-CSRF-Token": session.csrf,
        "Content-Type": "application/json",
      };
      for (const appId of ["http://example.com", "../keepsakes", "__proto__"])
        assert.equal(
          (
            await fetch(g.origin + "/api/windows", {
              method: "POST",
              headers,
              body: JSON.stringify({ appId }),
            })
          ).status,
          400,
        );
      await fetch(g.origin + "/api/windows", {
        method: "POST",
        headers,
        body: JSON.stringify({ appId: "notes-lab" }),
      });
      for (const h of [
        { Origin: g.origin },
        { cookie, Origin: "http://evil.invalid" },
      ]) {
        const status = await new Promise((resolve) => {
          const ws = new WebSocket(
            g.origin.replace("http", "ws") + "/ws/stream/notes-lab",
            { headers: h },
          );
          ws.on("unexpected-response", (_, r) => {
            r.resume();
            resolve(r.statusCode);
          });
          ws.on("error", () => {});
        });
        assert.equal(status, 403);
      }
      const connect = () =>
        new Promise((resolve, reject) => {
          const ws = new WebSocket(
            g.origin.replace("http", "ws") + "/ws/stream/notes-lab",
            { headers },
          );
          sockets.push(ws);
          ws.on("error", reject);
          ws.on("message", (raw) => {
            const m = JSON.parse(raw);
            if (m.type === "frame") {
              ws.send(JSON.stringify({ type: "ack", seq: m.seq }));
              resolve(ws);
            }
          });
        });
      const [first, second] = await Promise.all([connect(), connect()]);
      assert.equal(
        (await g.manager.browserPromise).contexts().length,
        1,
        "concurrent attaches share one app context",
      );
      const resource = g.manager.resources.get("notes-lab");
      assert.equal(resource.clients.size, 2);
    await resource.page.locator('textarea').focus();
    const client=[...resource.clients][0];let unblock;client.queue=new Promise(r=>unblock=r);
    first.send(JSON.stringify({type:'text',text:'stale queued input'}));await sleep(50);
    await g.manager.patch('notes-lab',{focused:false});await g.manager.patch('notes-lab',{focused:true});unblock();await sleep(100);
    assert.equal(await resource.page.locator('textarea').inputValue(),'','blur invalidates already queued input');
    for(let i=0;i<40;i++)await g.manager.input(resource,g.manager.windows.get('notes-lab'),{type:'key',phase:'down',key:'Shift',code:'Untrusted'+i,modifiers:0}).catch(()=>{});
    assert.ok(resource.keys.size<=32,'held-key memory is bounded');
    await g.manager.release(resource);
      const external = await resource.page.evaluate(async () => {
        try {
          await fetch("https://example.com");
          return true;
        } catch {
          return false;
        }
      });
      assert.equal(external, false);
      first.send("null");
      await sleep(100);
      assert.notEqual(
        first.readyState,
        WebSocket.OPEN,
        "invalid message closes without crashing",
      );
      second.close();
      await sleep(150);
      assert.equal(resource.capturing, false);
      const before = resource.page;
      await connect();
      assert.equal(g.manager.resources.get("notes-lab").page, before);
      assert.equal(resource.capturing, true);
    } finally {
      sockets.forEach((s) => s.terminate());
      await g.close();
      await rm(runtime, { recursive: true, force: true });
    }
  },
);
