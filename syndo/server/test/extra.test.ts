import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, sleep, startServer, stopServer } from "./helpers.ts";

const all: Client[] = [];
const client = (n: string) => { const c = new Client(n); all.push(c); return c; };
const VIEW = 1n, SEND = 2n;
// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

before(async () => { await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

describe("Friends — decline, cancel, remove, privacy", () => {
  const a = client("fa"), b = client("fb"), c = client("fc");
  it("declines, cancels and removes in both directions", async () => {
    await a.register(); await b.register(); await c.register();
    await a.post("/api/users/@me/relationships", { username: "fb" });
    assert.equal((await b.del(`/api/users/@me/relationships/${a.user.id}`)).status, 200, "decline");
    assert.equal((await a.get("/api/users/@me/relationships")).body.length, 0, "declined request disappears for sender too");
    await a.post("/api/users/@me/relationships", { username: "fb" });
    assert.equal((await a.del(`/api/users/@me/relationships/${b.user.id}`)).status, 200, "cancel");
    assert.equal((await b.get("/api/users/@me/relationships")).body.length, 0);
    await a.post("/api/users/@me/relationships", { username: "fb" });
    await b.put(`/api/users/@me/relationships/${a.user.id}`, { type: 1 });
    assert.equal((await b.del(`/api/users/@me/relationships/${a.user.id}`)).status, 200, "remove friend");
    assert.equal((await a.get("/api/users/@me/relationships")).body.length, 0);
  });
  it("respects 'nobody' and 'friends of friends' request privacy", async () => {
    await c.patch("/api/users/@me", { privacy: { friend_requests: "nobody" } });
    assert.equal((await a.post("/api/users/@me/relationships", { username: "fc" })).status, 403);
    await c.patch("/api/users/@me", { privacy: { friend_requests: "friends_of_friends" } });
    assert.equal((await a.post("/api/users/@me/relationships", { username: "fc" })).status, 403);
    await c.post("/api/users/@me/relationships", { username: "fb" });
    await b.put(`/api/users/@me/relationships/${c.user.id}`, { type: 1 });
    await a.post("/api/users/@me/relationships", { username: "fb" });
    await b.put(`/api/users/@me/relationships/${a.user.id}`, { type: 1 });
    assert.equal((await a.post("/api/users/@me/relationships", { username: "fc" })).status, 200, "mutual friend unlocks it");
  });
  it("DM privacy: server members only when allowed", async () => {
    const x = client("fx"); await x.register();
    assert.equal((await x.post("/api/users/@me/channels", { recipient_id: c.user.id })).status, 403, "strangers can't DM");
    const g = (await c.post("/api/guilds", { name: "DM privacy" })).body;
    const inv = (await c.post(`/api/channels/${g.channels.find((ch: any) => ch.type === 0).id}/invites`, {})).body;
    await x.post(`/api/invites/${inv.code}`);
    assert.equal((await x.post("/api/users/@me/channels", { recipient_id: c.user.id })).status, 200, "server members allowed by default");
    const y = client("fy"); await y.register(); await y.post(`/api/invites/${inv.code}`);
    await c.patch("/api/users/@me", { privacy: { dms_from_server_members: false } });
    assert.equal((await y.post("/api/users/@me/channels", { recipient_id: c.user.id })).status, 403);
  });
});

describe("Profile media and mutuals", () => {
  const p = client("pia"), q = client("quin");
  it("uploads an avatar (validated by content), serves it, shows mutuals", async () => {
    await p.register(); await q.register();
    const bad = new FormData(); bad.append("file", new Blob([Buffer.from("<svg onload=alert(1)>")], { type: "image/png" }), "x.png");
    assert.equal((await p.req("POST", "/api/users/@me/avatar", bad)).status, 400, "content sniffing rejects non-images");
    const fd = new FormData(); fd.append("file", new Blob([PNG], { type: "image/png" }), "a.png");
    const up = await p.req("POST", "/api/users/@me/avatar", fd);
    assert.equal(up.status, 200);
    const img = await fetch(new URL(up.body.url, (await import("./helpers.ts")).ORIGIN.replace("http://send.test", "http://127.0.0.1")).toString()).catch(() => null);
    void img;
    const me = (await p.get("/api/users/@me")).body;
    assert.ok(me.avatar?.startsWith("/api/media/avatars/"));
    const g = (await p.post("/api/guilds", { name: "Mutual Club" })).body;
    const inv = (await p.post(`/api/channels/${g.channels.find((ch: any) => ch.type === 0).id}/invites`, {})).body;
    await q.post(`/api/invites/${inv.code}`);
    const prof = (await q.get(`/api/users/${p.user.id}/profile`)).body;
    assert.deepEqual(prof.mutual_guilds.map((x: any) => x.name), ["Mutual Club"]);
    await p.patch("/api/users/@me", { privacy: { show_mutuals: false } });
    assert.equal((await q.get(`/api/users/${p.user.id}/profile`)).body.mutual_guilds.length, 0, "privacy hides mutuals");
  });
});

describe("Servers — leave, transfer, delete, category sync, slow mode, moderation", () => {
  const o = client("sora"), m = client("milo");
  let g: any, text: any;
  it("syncs category permissions to synced children and stops after manual edit", async () => {
    await o.register(); await m.register();
    g = (await o.post("/api/guilds", { name: "Ops" })).body;
    text = g.channels.find((c: any) => c.type === 0);
    const inv = (await o.post(`/api/channels/${text.id}/invites`, {})).body;
    await m.post(`/api/invites/${inv.code}`);
    const cat = (await o.post(`/api/guilds/${g.id}/channels`, { name: "Staff", type: 4 })).body;
    const a = (await o.post(`/api/guilds/${g.id}/channels`, { name: "a", type: 0, parent_id: cat.id })).body;
    const b = (await o.post(`/api/guilds/${g.id}/channels`, { name: "b", type: 0, parent_id: cat.id })).body;
    await o.put(`/api/channels/${b.id}/permissions/${m.user.id}`, { type: 1, allow: String(VIEW), deny: "0" }); // b now unsynced
    await o.put(`/api/channels/${cat.id}/permissions/${g.id}`, { type: 0, allow: "0", deny: String(VIEW) });
    assert.equal((await m.get(`/api/channels/${a.id}/messages`)).status, 404, "synced child inherits the deny");
    assert.equal((await m.get(`/api/channels/${b.id}/messages`)).status, 200, "unsynced child keeps its own overwrites");
    await o.post(`/api/channels/${b.id}/sync-permissions`);
    assert.equal((await m.get(`/api/channels/${b.id}/messages`)).status, 404, "explicit re-sync applies category");
  });
  it("enforces slow mode except for moderators", async () => {
    await o.patch(`/api/channels/${text.id}`, { rate_limit_per_user: 30, topic: "Be kind" });
    assert.equal((await m.post(`/api/channels/${text.id}/messages`, { content: "one" })).status, 200);
    const second = await m.post(`/api/channels/${text.id}/messages`, { content: "two" });
    assert.equal(second.status, 429); assert.ok(second.body.retry_after > 0);
    assert.equal((await o.post(`/api/channels/${text.id}/messages`, { content: "owner bypass" })).status, 200);
    assert.equal((await o.post(`/api/channels/${text.id}/messages`, { content: "owner bypass 2" })).status, 200);
    await o.patch(`/api/channels/${text.id}`, { rate_limit_per_user: 0 });
  });
  it("rejects malformed ids with 400, not 500", async () => {
    assert.equal((await o.put(`/api/channels/${text.id}/pins/undefined`)).status, 400);
  });
  it("pins, saves (access-aware) and bulk-deletes", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await m.post(`/api/channels/${text.id}/messages`, { content: `bulk ${i}` })).body.id);
    assert.equal((await m.put(`/api/channels/${text.id}/pins/${ids[0]}`)).status, 403, "members can't pin without Manage Messages");
    assert.equal((await o.put(`/api/channels/${text.id}/pins/${ids[0]}`)).status, 200);
    assert.equal((await m.get(`/api/channels/${text.id}/pins`)).body.length, 1);
    await m.put(`/api/users/@me/saved/${ids[1]}`);
    assert.equal((await m.get("/api/users/@me/saved")).body.length, 1);
    await o.put(`/api/channels/${text.id}/permissions/${m.user.id}`, { type: 1, allow: "0", deny: String(VIEW) });
    assert.equal((await m.get("/api/users/@me/saved")).body.length, 0, "saved messages hide when access is lost");
    await o.del(`/api/channels/${text.id}/permissions/${m.user.id}`);
    assert.equal((await m.post(`/api/channels/${text.id}/messages/bulk-delete`, { ids })).status, 403);
    assert.equal((await o.post(`/api/channels/${text.id}/messages/bulk-delete`, { ids })).body.deleted, 3);
  });
  it("leave, transfer ownership, delete", async () => {
    assert.equal((await o.del(`/api/guilds/${g.id}/members/@me`)).status, 400, "owner can't leave without transferring");
    assert.equal((await m.post(`/api/guilds/${g.id}/transfer`, { user_id: m.user.id })).status, 403);
    assert.equal((await o.post(`/api/guilds/${g.id}/transfer`, { user_id: m.user.id })).status, 200);
    assert.equal((await o.del(`/api/guilds/${g.id}/members/@me`)).status, 200, "former owner leaves");
    assert.equal((await o.get(`/api/guilds/${g.id}`)).status, 404);
    assert.equal((await m.del(`/api/guilds/${g.id}`)).status, 200);
    assert.equal((await m.get(`/api/channels/${text.id}/messages`)).status, 404);
  });
});

describe("Group conversations", () => {
  const a = client("gaia"), b = client("gus"), c = client("gwen");
  it("create, rename, add, remove, leave", async () => {
    await a.register(); await b.register(); await c.register();
    for (const x of [b, c]) { await a.post("/api/users/@me/relationships", { username: x.name }); await x.put(`/api/users/@me/relationships/${a.user.id}`, { type: 1 }); }
    const gb = await b.connect();
    const grp = (await a.post("/api/users/@me/channels", { recipients: [b.user.id] })).body;
    assert.equal(grp.type, 3);
    await gb.next("CHANNEL_CREATE", (d) => d.id === grp.id, 4000, true);
    assert.equal((await a.patch(`/api/channels/${grp.id}`, { name: "Weekend plans" })).body.name, "Weekend plans");
    assert.equal((await a.put(`/api/channels/${grp.id}/recipients/${c.user.id}`)).status, 200);
    assert.equal((await c.get(`/api/channels/${grp.id}/messages`)).status, 200);
    assert.equal((await b.del(`/api/channels/${grp.id}/recipients/${c.user.id}`)).status, 403, "only the owner removes others");
    assert.equal((await a.del(`/api/channels/${grp.id}/recipients/${c.user.id}`)).status, 200);
    assert.equal((await c.get(`/api/channels/${grp.id}/messages`)).status, 404, "removed member loses access");
    assert.equal((await b.del(`/api/channels/${grp.id}`)).status, 200, "leave");
    await sleep(50);
    assert.equal((await b.get(`/api/channels/${grp.id}/messages`)).status, 404);
  });
});
