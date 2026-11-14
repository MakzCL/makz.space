// The app was renamed from Syndo to SEND. Sessions, saved themes and older clients that still use the
// old names must keep working.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, startServer, stopServer } from "./helpers.ts";

let base = "";
before(async () => { base = await startServer(); });
after(async () => { await stopServer(); });

describe("Names from before the rename", () => {
  const a = new Client("legacy");

  it("signs in with the new cookie name and still accepts the old one", async () => {
    await a.register();
    assert.match(a.cookie, /^send_session=/);
    const token = a.cookie.split("=")[1]!;
    const me = await fetch(`${base}/api/users/@me`, { headers: { cookie: `syndo_session=${token}` } });
    assert.equal(me.status, 200, "old cookie name still signs you in");
  });

  it("accepts the client header under either name when Origin is missing", async () => {
    const post = (h: Record<string, string>) => fetch(`${base}/api/users/@me/settings`, { method: "PATCH", headers: { cookie: a.cookie, "content-type": "application/json", ...h }, body: "{}" });
    assert.equal((await post({})).status, 403, "no Origin and no client header is refused");
    assert.notEqual((await post({ "x-send-client": "1" })).status, 403);
    assert.notEqual((await post({ "x-syndo-client": "1" })).status, 403);
  });

  it("reads old theme ids and theme files, and saves the new names", async () => {
    const r = await a.put("/api/appearance/global", { data: { themeId: "syndo-neon", lightThemeId: "syndo-paper" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.themeId, "send-neon");
    assert.equal(r.body.data.lightThemeId, "send-paper");
    const p = await a.post("/api/appearance/presets", { name: "Old file", data: { schema: "syndo.theme", version: 2, meta: { name: "Old file", scheme: "dark" }, colors: { accent: "#FF0088" } } });
    assert.equal(p.status, 200, JSON.stringify(p.body));
  });

  it("tells clients it understands the new names", async () => {
    const g = await a.connect();
    assert.equal((await g.ready).limits.send_names, true);
    a.close();
  });
});
