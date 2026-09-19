import express from "express";
import { WebSocketServer } from "ws";
import { Manager } from "./streams.mjs";
import { installNative } from "./native.mjs";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const APPS = [
  {
    id: "parcels",
    label: "Parcels",
    mode: "native",
    description: "Client-side ZIP packing",
    url: "/native/parcels/",
  },
  {
    id: "keepsakes",
    label: "Keepsakes",
    mode: "native",
    description: "Isolated image collection",
    url: "/native/keepsakes/",
  },
  {
    id: "notes-lab",
    label: "Notes Lab",
    mode: "stream",
    description: "Synthetic editable notes",
  },
  {
    id: "signal-lab",
    label: "Signal Lab",
    mode: "stream",
    description: "Synthetic live signals",
  },
];
export async function createGateway({
  port = 4180,
  runtime = ROOT + ".runtime",
  native = false,
  keepsakesPort = 4181,
  data = ROOT + ".data/keepsakes",
} = {}) {
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  await chmod(runtime, 0o700);
  const app = express(),
    server = http.createServer(app);
  let bootstrap = randomBytes(32).toString("hex");
  const session = randomBytes(32).toString("hex"),
    csrf = randomBytes(32).toString("hex");
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const authorized = (req) =>
    (req.headers.cookie || "")
      .split(";")
      .some((x) => x.trim() === `relay_session=${session}`);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (
      req.headers.host !== new URL(origin).host ||
      (req.headers.origin && req.headers.origin !== origin)
    )
      return res.status(403).json({ error: "Invalid Host or Origin" });
    next();
  });
  app.get("/bootstrap", (req, res) => {
    if (!bootstrap || req.query.token !== bootstrap)
      return res.status(403).json({ error: "Invalid bootstrap" });
    bootstrap = null;
    res.cookie("relay_session", session, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    res.redirect(303, "/");
  });
  app.use((req, res, next) => {
    if (!authorized(req)) {
      if (req.path === "/")
        return res
          .status(401)
          .send(
            "Desktop locked. Open the local .runtime/bootstrap-url.txt in your browser.",
          );
      return res.status(401).json({ error: "Authentication required" });
    }
    next();
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD"].includes(req.method) &&
      (req.headers.origin !== origin || req.headers["x-csrf-token"] !== csrf)
    )
      return res.status(403).json({ error: "Origin and CSRF required" });
    next();
  });
  app.use("/api", express.json({ limit: "16kb" }));
  const manager = new Manager(runtime, APPS);
  await manager.init();
  app.get("/api/session", (req, res) =>
    res.json({
      csrf,
      apps: APPS,
      windows: [...manager.windows.values()],
      limits: { maxStreams: 2 },
    }),
  );
  const operation = (fn) => async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch {
      res.status(400).json({ error: "Invalid window operation" });
    }
  };
  app.post(
    "/api/windows",
    operation((req) => manager.open(req.body?.appId)),
  );
  app.patch(
    "/api/windows/:id",
    operation((req) => manager.patch(req.params.id, req.body || {})),
  );
  app.delete(
    "/api/windows/:id",
    operation(async (req) => {
      if (!manager.windows.has(req.params.id)) throw Error();
      await manager.remove(req.params.id);
      return { closed: true };
    }),
  );
  app.post(
    "/api/windows/:id/reload",
    operation((req) => manager.reload(req.params.id)),
  );
  app.get(
    "/api/metrics",
    operation(() => manager.metrics()),
  );
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    const match = /^\/ws\/stream\/([a-z-]+)$/.exec(req.url);
    if (
      req.headers.host !== new URL(origin).host ||
      req.headers.origin !== origin ||
      !authorized(req) ||
      !match ||
      !manager.windows.has(match[1]) ||
      manager.windows.get(match[1]).mode !== "stream"
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => {});
      manager.attach(match[1], ws);
    });
  });
  let nativeService;
  if (native) {
    try {
      nativeService = await installNative(app, {
        root: ROOT,
        origin,
        port: keepsakesPort,
        data,
      });
    } catch (e) {
      await new Promise((r) => server.close(r));
      throw e;
    }
  }
  app.use(express.static(ROOT + "dist", { index: "index.html" }));
  app.use((req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({ error: "Request rejected" }),
  );
  await writeFile(
    runtime + "/bootstrap-url.txt",
    origin + "/bootstrap?token=" + bootstrap,
    { mode: 0o600 },
  );
  await chmod(runtime + "/bootstrap-url.txt", 0o600);
  return {
    origin,
    app,
    server,
    authorized,
    manager,
    nativeService,
    close: async () => {
      for (const ws of wss.clients) ws.terminate();
      await manager.close();
      await nativeService?.close();
      await new Promise((r) => server.close(r));
    },
  };
}
