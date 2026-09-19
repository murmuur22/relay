import { chromium } from "playwright";
import { readFile, writeFile, rename } from "node:fs/promises";
const virtualKey = (key) =>
  ({
    Backspace: 8,
    Tab: 9,
    Enter: 13,
    Shift: 16,
    Control: 17,
    Alt: 18,
    Escape: 27,
    " ": 32,
    PageUp: 33,
    PageDown: 34,
    End: 35,
    Home: 36,
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Delete: 46,
    Meta: 91,
  })[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
const number = (n, min, max, fallback) =>
  Number.isFinite(n) ? Math.round(Math.max(min, Math.min(max, n))) : fallback;
export class Manager {
  constructor(runtime, apps) {
    this.runtime = runtime;
    this.apps = apps;
    this.windows = new Map();
    this.resources = new Map();
    this.serial = Promise.resolve();
    this.persistQueue = Promise.resolve();
  }
  async init() {
    try {
      for (const w of JSON.parse(
        await readFile(this.runtime + "/layout.json", "utf8"),
      ))
        if (this.apps.some((a) => a.id === w.appId)) this.windows.set(w.id, w);
    } catch {}
  }
  persist() {
    const data = JSON.stringify([...this.windows.values()]);
    this.persistQueue = this.persistQueue.then(async () => {
      await writeFile(this.runtime + "/layout.tmp", data, { mode: 0o600 });
      await rename(this.runtime + "/layout.tmp", this.runtime + "/layout.json");
    });
    return this.persistQueue;
  }
  async open(appId) {
    const app = this.apps.find((a) => a.id === appId);
    if (!app) throw Error("Unknown registered app");
    let w = this.windows.get(appId);
    if (!w) {
      w = {
        id: app.id,
        appId,
        title: app.label,
        mode: app.mode,
        x: appId === "signal-lab" ? 120 : 60,
        y: 80,
        width: 800,
        height: 500,
        visible: true,
        focused: false,
        ...(app.url ? { url: app.url } : {}),
      };
      this.windows.set(w.id, w);
    }
    return this.patch(w.id, { visible: true, focused: true });
  }
  async patch(id, changes) {
    const w = this.windows.get(id);
    if (!w) throw Error("Unknown window");
    // Commit ownership before yielding; release invalidates queued input immediately.
    const releases = [];
    if (changes.focused === true) {
      for (const v of this.windows.values()) {
        if (v.id !== id && v.focused) {
          v.focused = false;
          releases.push(this.release(this.resources.get(v.id)));
        }
      }
    }
    for (const key of ["x", "y", "width", "height"])
      if (key in changes)
        w[key] = number(
          changes[key],
          key === "width" ? 320 : key === "height" ? 200 : 0,
          key === "width" ? 1600 : key === "height" ? 1000 : 4096,
          w[key],
        );
    for (const key of ["visible", "focused"])
      if (typeof changes[key] === "boolean") w[key] = changes[key];
    if (!w.visible) w.focused = false;
    const r = this.resources.get(id);
    if (r && !w.focused) releases.push(this.release(r));
    await Promise.all(releases);
    if (r && this.windows.get(id) === w && this.resources.get(id) === r) {
      await this.capture(w, r, "width" in changes || "height" in changes);
    }
    await this.persist();
    return w;
  }
  async ensure(w) {
    this.opening ??= new Map();
    if (this.windows.get(w.id) !== w) return null;
    if (this.resources.has(w.id)) return this.resources.get(w.id);
    if (this.opening.has(w)) return this.opening.get(w);
    const promise = this.createResource(w).then(async (r) => {
      if (this.windows.get(w.id) !== w) {
        r.disposed = true;
        await r.context.close();
        return null;
      }
      this.resources.set(w.id, r);
      return r;
    });
    this.opening.set(w, promise);
    try {
      return await promise;
    } finally {
      this.opening.delete(w);
    }
  }
  async createResource(w) {
    if (this.resources.has(w.id)) return this.resources.get(w.id);
    if (!this.browserPromise)
      this.browserPromise = chromium.launch({
        headless: true,
        chromiumSandbox: true,
      });
    const browser = await this.browserPromise;
    const context = await browser.newContext({
      viewport: { width: w.width, height: w.height },
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    try {
      const url = `http://relay-synthetic.invalid/${w.appId}`;
      await context.route("**/*", (route) =>
        route.request().url() === url &&
        route.request().resourceType() === "document"
          ? route.fulfill({ contentType: "text/html", body: this.synthetic(w) })
          : route.abort(),
      );
      await context.routeWebSocket("**/*", (ws) => ws.close());
      const page = await context.newPage();
      context.on("page", (p) => {
        if (p !== page) p.close().catch(() => {});
      });
      await page.goto(url);
      const cdp = await context.newCDPSession(page);
      await cdp.send("Page.enable");
      const r = {
        page,
        context,
        cdp,
        clients: new Set(),
        capturing: false,
        seq: 0,
        keys: new Map(),
        buttons: new Set(),
        frames: 0,
        bytes: 0,
        dropped: 0,
        inputDropped: 0,
      };
      cdp.on("Page.screencastFrame", (frame) => {
        cdp
          .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
          .catch(() => {});
        if (
          (!r.capturing && !r.starting) || r.disposed || !w.visible ||
          this.windows.get(w.id) !== w
        ) return;
        const m = {
          type: "frame",
          windowId: w.id,
          seq: ++r.seq,
          data: frame.data,
          mime: "image/jpeg",
          width: w.width,
          height: w.height,
          sentAt: Date.now(),
        };
        r.frames++;
        r.bytes += Buffer.byteLength(frame.data, "base64");
        for (const c of r.clients) {
          if (c.inflight) {
            if (c.pending) r.dropped++;
            c.pending = m;
          } else this.sendFrame(c, m);
        }
      });
      page.on("crash", () => this.state(r, "failed", "Browser page failed"));
      return r;
    } catch (error) {
      await context.close().catch(() => {});
      throw error;
    }
  }
  synthetic(w) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{background:${w.appId === "notes-lab" ? "#f5eedc" : "#dae9ec"};color:#202423;font:20px monospace;margin:24px}h1{font-size:26px}textarea{display:block;box-sizing:border-box;width:90%;height:180px;font:22px monospace;padding:12px}#tick{font-size:24px}article{height:1200px}</style></head><body><h1>${w.title} / synthetic</h1><p id="tick">0</p><textarea aria-label="Synthetic editor" spellcheck="false"></textarea><p>Editable server-side browser. Scroll this page.</p><article>Independent context · no external requests</article><script>let n=0;setInterval(()=>document.querySelector('#tick').textContent='Signal '+(++n),100);</script></body></html>`;
  }
  sendFrame(c, m) {
    if (c.ws.readyState !== 1 || c.ws.bufferedAmount > 2 * 1024 * 1024) return;
    c.inflight = m.seq;
    c.ws.send(JSON.stringify(m));
  }
  state(r, state, message) {
    for (const c of r.clients)
      if (c.ws.readyState === 1)
        c.ws.send(
          JSON.stringify({
            type: "state",
            state,
            ...(message ? { message } : {}),
          }),
        );
  }
  capture(w, r, resize = false) {
    const transition = (r.captureQueue || Promise.resolve()).then(async () => {
      if (r.disposed || this.windows.get(w.id) !== w) return;
      try {
        if (resize) {
          if (r.capturing) {
            r.capturing = false;
            await r.cdp.send("Page.stopScreencast");
          }
          for (const c of r.clients) c.pending = null;
          await r.page.setViewportSize({ width: w.width, height: w.height });
        }
        if (r.disposed || this.windows.get(w.id) !== w) return;
        const active = w.visible && r.clients.size > 0;
        if (active !== r.capturing) {
          if (active) {
            // Accept the static page's first frame even before start resolves.
            r.starting = true;
            await r.cdp.send("Page.startScreencast", {
              format: "jpeg", quality: 65,
              maxWidth: w.width, maxHeight: w.height, everyNthFrame: 1,
            });
            r.capturing = true;
          } else {
            r.capturing = false;
            await r.cdp.send("Page.stopScreencast");
            for (const c of r.clients) c.pending = null;
          }
        }
        if (!r.disposed && this.windows.get(w.id) === w && active === (w.visible && r.clients.size > 0))
          this.state(r, active ? "live" : "paused");
      } catch (error) {
        r.capturing = false;
        for (const c of r.clients) c.pending = null;
        if (!r.disposed) this.state(r, "failed", "Capture unavailable");
        throw error;
      } finally {
        r.starting = false;
        if (r.disposed) r.capturing = false;
      }
    });
    // A failed transition must not poison subsequent restore/retry attempts.
    r.captureQueue = transition.catch(() => {});
    return transition;
  }
  async attach(id, ws) {
    const w = this.windows.get(id);
    if (!w || w.mode !== "stream") {
      ws.close(1008);
      return;
    }
    ws.send(JSON.stringify({ type: "state", state: "opening" }));
    try {
      const r = await this.ensure(w);
      if (!r || r.disposed || this.windows.get(id) !== w || this.resources.get(id) !== r) {
        ws.close(1000);
        return;
      }
      if (ws.readyState !== 1) {
        if (!r.clients.size)
          r.grace = setTimeout(
            () => this.dispose(id, r).catch(() => {}),
            this.graceMs ?? 60000,
          ).unref();
        return;
      }
      clearTimeout(r.grace);
      if (r.clients.size >= 2) {
        ws.close(1008);
        return;
      }
      const c = {
        ws,
        inflight: null,
        pending: null,
        tokens: 120,
        last: Date.now(),
        busy: false,
      };
      r.clients.add(c);
      ws.on("message", (raw) => {
        let m;
        try {
          m = JSON.parse(raw);
          if (!m || typeof m !== "object" || Array.isArray(m)) throw Error();
        } catch {
          return ws.close(1008);
        }
        if (m.type === "ack") {
          if (m.seq === c.inflight) {
            c.inflight = null;
            if (c.pending) {
              const frame = c.pending;
              c.pending = null;
              this.sendFrame(c, frame);
            }
          }
          return;
        }
        if (r.disposed || this.windows.get(id) !== w) return;
        if (m.type === "release") {
          this.release(r).catch(() => {});
          return;
        }
        const now = Date.now();
        c.tokens = Math.min(120, c.tokens + (now - c.last) * 0.12);
        c.last = now;
        if (c.tokens < 1 || (c.queued || 0) >= 32 || !w.visible || !w.focused) {
          r.inputDropped++;
          return;
        }
        c.tokens--;
        const epoch=r.inputEpoch||0;
        c.queued = (c.queued || 0) + 1;
        c.queue = (c.queue || Promise.resolve())
          .then(async () => {
            await r.releaseQueue;
            if (!r.disposed && this.windows.get(id) === w && ws.readyState === 1 && w.visible && w.focused && epoch===(r.inputEpoch||0))
              return this.input(r, w, m);
          })
          .catch(() => {})
          .finally(() => c.queued--);
      });
      ws.once("close", () => {
        r.clients.delete(c);
        if (r.disposed) return;
        this.release(r)
          .then(() => this.capture(w, r))
          .catch(() => {});
        if (!r.clients.size)
          r.grace = setTimeout(
            () => this.dispose(id, r).catch(() => {}),
            this.graceMs ?? 60000,
          ).unref();
      });
      await this.capture(w, r);
    } catch {
      ws.send(
        JSON.stringify({
          type: "state",
          state: "failed",
          message: "Capture unavailable",
        }),
      );
      ws.close(1011);
    }
  }
  async input(r, w, m) {
    const xy = {
      x: number(m.x, 0, w.width - 1, 0),
      y: number(m.y, 0, w.height - 1, 0),
    };
    if (
      m.type === "text" &&
      typeof m.text === "string" &&
      m.text.length <= 2048
    ) {
      await r.cdp.send("Input.insertText", { text: m.text });
    } else if (
      m.type === "pointer" &&
      ["move", "down", "up"].includes(m.phase) &&
      [0, 1, 2].includes(m.button)
    ) {
      const button = ["left", "middle", "right"][m.button];
      if (m.phase === "down") r.buttons.add(button);
      if (m.phase === "up") r.buttons.delete(button);
      await r.cdp.send("Input.dispatchMouseEvent", {
        type: { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" }[
          m.phase
        ],
        ...xy,
        button,
        buttons: number(m.buttons, 0, 7, 0),
        clickCount: m.phase === "move" ? 0 : 1,
      });
    } else if (m.type === "wheel") {
      await r.cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        ...xy,
        deltaX: number(m.deltaX, -2000, 2000, 0),
        deltaY: number(m.deltaY, -2000, 2000, 0),
      });
    } else if (
      m.type === "key" &&
      ["down", "up"].includes(m.phase) &&
      typeof m.key === "string" &&
      m.key.length <= 32 &&
      typeof m.code === "string" &&
      m.code.length <= 32
    ) {
      if (m.phase === 'down' && !r.keys.has(m.code) && r.keys.size>=32) return;
      if (m.phase === "down") r.keys.set(m.code, m.key);
      else r.keys.delete(m.code);
      await r.cdp.send("Input.dispatchKeyEvent", {
        type: m.phase === "down" ? "rawKeyDown" : "keyUp",
        key: m.key,
        code: m.code,
        windowsVirtualKeyCode: virtualKey(m.key),
        modifiers: number(m.modifiers, 0, 15, 0),
      });
    }
  }
  async release(r) {
    if (!r) return;
    r.inputEpoch = (r.inputEpoch || 0) + 1;
    // Snapshot before yielding: a later focus must not lose newly held keys.
    const keys = [...r.keys], buttons = [...r.buttons];
    r.keys.clear();
    r.buttons.clear();
    if (!keys.length && !buttons.length) return r.releaseQueue;
    r.releaseQueue = (r.releaseQueue || Promise.resolve()).then(async () => {
      for (const [code, key] of keys)
        await r.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", code, key }).catch(() => {});
      for (const button of buttons)
        await r.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased", x: 0, y: 0, button, buttons: 0, clickCount: 1,
        }).catch(() => {});
    });
    return r.releaseQueue;
  }
  async dispose(id, expected = this.resources.get(id)) {
    const r = this.resources.get(id);
    if (!r || r !== expected) return;
    r.disposed = true;
    r.capturing = false;
    this.resources.delete(id);
    clearTimeout(r.grace);
    await this.release(r);
    for (const c of r.clients) c.ws.close(1000);
    await r.captureQueue;
    await r.context.close();
  }
  async remove(id) {
    const w = this.windows.get(id);
    this.windows.delete(id);
    // Creation reports its failure to attach; closing still completes cleanup.
    await Promise.all([this.dispose(id), this.opening?.get(w)?.catch(() => {})]);
    await this.persist();
  }
  async reload(id) {
    const w = this.windows.get(id);
    if (!w) throw Error("Unknown window");
    const r = this.resources.get(id);
    if (r) {
      await this.release(r);
      await r.page.reload();
    }
    return w;
  }
  async metrics() {
    let browserProcesses = [],
      browserVersion = null;
    if (this.browserPromise) {
      try {
        const b = await this.browserPromise;
        browserVersion = b.version();
        const s = await b.newBrowserCDPSession();
        browserProcesses = (await s.send("SystemInfo.getProcessInfo"))
          .processInfo;
        await s.detach();
      } catch {}
    }
    return {
      browserProcesses,
      browserVersion,
      transport: "CDP JPEG over WebSocket",
      gatewayPid: process.pid,
      gatewayMemory: process.memoryUsage(),
      windows: [...this.windows.values()].map((w) => {
        const r = this.resources.get(w.id);
        return {
          id: w.id,
          visible: w.visible,
          focused: w.focused,
          capturing: r?.capturing || false,
          viewers: r?.clients.size || 0,
          frames: r?.frames || 0,
          bytes: r?.bytes || 0,
          dropped: r?.dropped || 0,
          inputDropped: r?.inputDropped || 0,
        };
      }),
    };
  }
  async close() {
    for (const id of [...this.resources.keys()]) await this.dispose(id);
    if (this.browserPromise) await (await this.browserPromise).close();
    await this.persistQueue;
  }
}
