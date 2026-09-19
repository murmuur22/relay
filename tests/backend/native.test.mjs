import {browserLogin} from '../auth-helper.mjs';
import { inflateRawSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { realpath, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { createGateway } from "../../server/gateway.mjs";
test(
  "real isolated Keepsakes upload edit original bytes and client Parcels ZIP through native iframe",
  { timeout: 45000 },
  async () => {
    const runtime = await realpath(await mkdtemp(tmpdir() + "/relay-native-"));
    const g = await createGateway({
      port: 0,
      runtime,
      native: true,
      keepsakesPort: 4189,
      data: runtime + "/library",
    });
    const browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
    });
    try {
      const context = await browser.newContext({
        acceptDownloads: true,
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      await browserLogin(page,g.origin,runtime);
      const result = await page.evaluate(async () => {
        const prefix = "/native/keepsakes";
        const session = await (await fetch(prefix + "/api/session")).json();
        const canvas = document.createElement("canvas");
        canvas.width = 8;
        canvas.height = 8;
        canvas.getContext("2d").fillRect(0, 0, 8, 8);
        const png = Uint8Array.from(
          atob(canvas.toDataURL("image/png").split(",")[1]),
          (c) => c.charCodeAt(0),
        );
        const form = new FormData();
        form.set("title", "Synthetic Relay image");
        form.set(
          "file",
          new Blob([png], { type: "image/png" }),
          "synthetic.png",
        );
        const r = await fetch(prefix + "/api/clips", {
          method: "POST",
          headers: { "X-CSRF-Token": session.csrf },
          body: form,
        });
        if (!r.ok) return { status: r.status };
        const clip = await r.json();
        const edit = await fetch(prefix + "/api/clips/" + clip.id, {
          method: "PATCH",
          headers: {
            "X-CSRF-Token": session.csrf,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notes: "Synthetic integration note" }),
        });
        const asset = new Uint8Array(
          await (
            await fetch(prefix + "/api/clips/" + clip.id + "/asset")
          ).arrayBuffer(),
        );
        return {
          status: r.status,
          notes: (await edit.json()).notes,
          equal:
            asset.length === png.length && asset.every((v, i) => v === png[i]),
        };
      });
      assert.deepEqual(result, {
        status: 201,
        notes: "Synthetic integration note",
        equal: true,
      });
      await page.setContent('<iframe src="/native/keepsakes/"></iframe>');
      const keeps = page.frameLocator("iframe");
      await keeps
        .getByRole("button", { name: "Open Synthetic Relay image" })
        .waitFor();
      const png = await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 10;
        c.height = 10;
        c.getContext("2d").fillRect(0, 0, 10, 10);
        return c.toDataURL().split(",")[1];
      });
      await keeps.locator("#add").click();
      await keeps
        .locator("#file")
        .setInputFiles({
          name: "synthetic-picker.png",
          mimeType: "image/png",
          buffer: Buffer.from(png, "base64"),
        });
      await keeps
        .locator("#upload-form input[name=title]")
        .fill("Synthetic picker upload");
      await keeps
        .getByRole("button", { name: "Save clipping", exact: true })
        .click();
      await keeps
        .getByRole("button", { name: "Open Synthetic picker upload" })
        .click();
      await keeps.locator("textarea[name=notes]").fill("Native iframe edit");
      await keeps
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await keeps.getByText("Saved to your folder.", { exact: true }).waitFor();
      await page.setContent(
        '<iframe src="/native/parcels/" style="width:1000px;height:800px"></iframe>',
      );
      const parcels = page.frameLocator("iframe");
      await parcels
        .locator("#files")
        .setInputFiles({
          name: "synthetic.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Relay synthetic ZIP bytes"),
        });
      await parcels.locator("#seal").click();
      await parcels.locator("#download").waitFor({ state: "visible" });
      const download = page.waitForEvent("download");
      await parcels.locator("#download").click();
      const file = await download;
      assert.equal(file.suggestedFilename(), "parcel.zip");
      const bytes = await readFile(await file.path());
      assert.equal(bytes.readUInt32LE(0), 0x04034b50);
      assert.ok(bytes.includes(Buffer.from("synthetic.txt")));
      let recovered;
      for (
        let p = 0;
        p + 30 < bytes.length && bytes.readUInt32LE(p) === 0x04034b50;
      ) {
        const method = bytes.readUInt16LE(p + 8),
          size = bytes.readUInt32LE(p + 18),
          nameLength = bytes.readUInt16LE(p + 26),
          extra = bytes.readUInt16LE(p + 28),
          name = bytes.subarray(p + 30, p + 30 + nameLength).toString(),
          start = p + 30 + nameLength + extra,
          raw = bytes.subarray(start, start + size);
        if (name === "files/synthetic.txt")
          recovered = method === 8 ? inflateRawSync(raw) : raw;
        p = start + size;
      }
      assert.equal(recovered?.toString(), "Relay synthetic ZIP bytes");
    } finally {
      await browser.close();
      await g.close();
      await rm(runtime, { recursive: true, force: true });
    }
  },
);
