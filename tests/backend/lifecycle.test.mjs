import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createGateway } from "../../server/gateway.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test(
  "hidden initial socket reports paused and abandoned opens expire within grace",
  { timeout: 10000 },
  async () => {
    const runtime = await mkdtemp(tmpdir() + "/relay-life-");
    const g = await createGateway({ port: 0, runtime });
    g.manager.graceMs = 150;
    let ws;
    try {
      const r = await fetch(
        await readFile(runtime + "/bootstrap-url.txt", "utf8"),
        { redirect: "manual" },
      );
      const cookie = r.headers.get("set-cookie").split(";")[0];
      const w = await g.manager.open("notes-lab");
      await g.manager.patch(w.id, { visible: false });
      ws = new WebSocket(
        g.origin.replace("http", "ws") + "/ws/stream/" + w.id,
        { headers: { cookie, Origin: g.origin } },
      );
      let states = [];
      ws.on("message", (raw) => states.push(JSON.parse(raw).state));
      await sleep(600);
      assert.ok(states.includes("paused"));
      ws.close();
      await sleep(400);
      assert.equal(g.manager.resources.size, 0, "disconnected grace expires");
      await g.manager.patch(w.id, { visible: true });
      ws = new WebSocket(
        g.origin.replace("http", "ws") + "/ws/stream/" + w.id,
        { headers: { cookie, Origin: g.origin } },
      );
      ws.on("open", () => ws.close());
      await sleep(500);
      assert.equal(
        g.manager.resources.size,
        0,
        "abandoned opening also expires",
      );
    } finally {
      ws?.terminate();
      await g.close();
      await rm(runtime, { recursive: true, force: true });
    }
  },
);
