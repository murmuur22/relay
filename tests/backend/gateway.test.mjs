import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createGateway } from "../../server/gateway.mjs";
test("loopback gateway locks content and consumes bootstrap, enforcing Host Origin CSRF", async () => {
  const dir = await mkdtemp(tmpdir() + "/relay-test-");
  const g = await createGateway({ port: 0, runtime: dir });
  try {
    const base = g.origin;
    assert.equal((await fetch(base + "/api/session")).status, 401);
    assert.equal((await fetch(base + "/native/parcels/")).status, 401);
    assert.equal(
      (await fetch(base + "/", { headers: { Origin: "http://evil.invalid" } }))
        .status,
      403,
    );
    const boot = await readFile(dir + "/bootstrap-url.txt", "utf8");
    const r = await fetch(boot, { redirect: "manual" });
    assert.equal(r.status, 303);
    const cookie = r.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(boot, { redirect: "manual" })).status, 403);
    const s = await (
      await fetch(base + "/api/session", { headers: { cookie } })
    ).json();
    assert.ok(s.csrf);
    assert.equal(s.limits.maxStreams, 2);
    assert.equal(
      (
        await fetch(base + "/api/windows", {
          method: "POST",
          headers: { cookie, "Content-Type": "application/json" },
          body: '{"appId":"parcels"}',
        })
      ).status,
      403,
    );
  } finally {
    await g.close();
    await rm(dir, { recursive: true, force: true });
  }
});
