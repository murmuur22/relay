import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import express from "express";
const MAX = 15 * 1024 * 1024 + 256 * 1024;
export async function installNative(
  app,
  { root, origin, port = 4181, data = root + ".data/keepsakes" },
) {
  await mkdir(data, { recursive: true, mode: 0o700 });
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", () =>
      reject(
        Error("Dedicated Keepsakes port occupied; refusing existing service"),
      ),
    );
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
  const home = root + "integrations/keepsakes";
  const child = spawn(
    home + "/.venv/bin/python",
    ["-u", home + "/app.py", "--data-dir", data, "--port", String(port)],
    { cwd: home, stdio: ["ignore", "ignore", "ignore"] },
  );
  let exited = false;
  child.on("exit", () => (exited = true));
  child.on("error", () => (exited = true));
  const upstream = `http://127.0.0.1:${port}`;
  try {
    for (let n = 0; ; n++) {
      if (exited || n > 100) throw Error("Isolated Keepsakes failed to start");
      try {
        const r = await fetch(upstream + "/api/session");
        if (r.ok) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (e) {
    child.kill();
    throw e;
  }
  const csp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'";
  app.use(
    "/native/parcels",
    (req, res, next) => {
      res.set("Content-Security-Policy", csp);
      next();
    },
    express.static(root + "integrations/parcels/dist"),
  );
  app.use("/native/keepsakes", async (req, res) => {
    const path = req.path;
    const allowed =
      path === "/" ||
      /^\/static\/(index\.html|app\.js|appearance\.js|style\.css|favicon\.svg)$/.test(
        path,
      ) ||
      /^\/api\/(session|clips(?:\/[0-9a-f-]{36}(?:\/asset)?)?)$/.test(path);
    if (
      !allowed ||
      !["GET", "HEAD", "POST", "PATCH", "DELETE"].includes(req.method)
    )
      return res.status(404).json({ error: "Native route not registered" });
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== origin)
      return res.status(403).json({ error: "Origin required" });
    if (Number(req.headers["content-length"]) > MAX)
      return res.status(413).json({ error: "Native upload exceeds limit" });
    let bytes = 0;
    const chunks = [];
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX) {
          res.status(413).json({ error: "Native upload exceeds limit" });
          return;
        }
        chunks.push(chunk);
      }
    } catch {
      return;
    }
    // Revocation can occur while the bounded upload body is being received.
    if(res.destroyed||req.session?.revoked)return;
    const headers = { Host: `127.0.0.1:${port}` };
    if (req.headers.origin) headers.Origin = upstream;
    if (req.headers["x-csrf-token"])
      headers["X-CSRF-Token"] = req.headers["x-csrf-token"];
    if (req.headers["content-type"])
      headers["Content-Type"] = req.headers["content-type"];
    headers["Content-Length"] = bytes;
    const request = http.request(
      upstream + path,
      { method: req.method, headers, timeout: 20000 },
      (response) => {
        res.status(response.statusCode);
        for (const key of ["content-type", "content-length"])
          if (response.headers[key]) res.set(key, response.headers[key]);
        res.set("Content-Security-Policy", csp);
        response.pipe(res);
        response.on("error", () => res.destroy());
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => {
      if (!res.headersSent)
        res.status(502).json({ error: "Isolated Keepsakes unavailable" });
      else res.destroy();
    });
    res.on("close", () => request.destroy());
    request.end(Buffer.concat(chunks));
  });
  return {
    pid: child.pid,
    get ready(){return !exited;},
    probe: async()=>{if(exited)return false;try{const r=await fetch(upstream+'/api/session',{signal:AbortSignal.timeout(1000),redirect:'error'});await r.body?.cancel();return r.ok;}catch{return false;}},
    close: async () => {
      if (exited) return;
      const done = new Promise((r) => child.once("exit", r));
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), 3000).unref();
      await done;
      clearTimeout(timer);
    },
  };
}
