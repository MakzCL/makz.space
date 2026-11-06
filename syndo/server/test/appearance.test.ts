import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, startServer, stopServer } from "./helpers.ts";

const all: Client[] = [];
const client = (n: string) => { const c = new Client(n); all.push(c); return c; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const upload = (c: Client, path: string, buf: Buffer, name = "w.png", type = "image/png", method = "POST") => {
  const fd = new FormData(); fd.append("file", new Blob([new Uint8Array(buf)], { type }), name);
  return c.req(method, path, fd);
};

before(async () => { await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

describe("Personal appearance", () => {
  const a = client("ava"), b = client("bea");
  let dm1: any, dm2: any, guild: any, chan: any;

  it("saves global settings, validates them, and syncs to the user's other devices", async () => {
    await a.register(); await b.register();
    const g2 = await a.connect();
    const bad = await a.put("/api/appearance/global", { data: { themeId: "syndo-glass", overrides: { panels: { chat: { opacity: 250 } } } } });
    assert.equal(bad.status, 400, "out-of-range opacity rejected");
    assert.match(bad.body.message, /panels\.chat\.opacity/);
    const ev = g2.next("APPEARANCE_UPDATE", (d) => d.scope === "global");
    const ok = await a.put("/api/appearance/global", { data: { themeId: "syndo-glass", overrides: { panels: { chat: { opacity: 40 }, rail: { opacity: 70, blur: 12 } } } } });
    assert.equal(ok.status, 200);
    assert.equal((await ev).data.overrides.panels.chat.opacity, 40);
    const back = (await a.get("/api/appearance")).body.prefs.find((p: any) => p.scope === "global");
    assert.equal(back.data.overrides.panels.rail.blur, 12, "each panel keeps its own styling after reload");
  });

  it("detects edits from a stale device revision", async () => {
    const cur = (await a.get("/api/appearance")).body.prefs.find((p: any) => p.scope === "global");
    assert.equal((await a.put("/api/appearance/global", { data: cur.data, rev: cur.rev })).status, 200);
    const stale = await a.put("/api/appearance/global", { data: cur.data, rev: cur.rev });
    assert.equal(stale.status, 409);
    assert.ok(stale.body.current?.rev > cur.rev, "the current revision is returned for merging");
  });

  it("keeps different backgrounds per DM without leaking between them", async () => {
    const c = client("cy"); await c.register();
    for (const x of [b, c]) { await a.post("/api/users/@me/relationships", { username: x.name }); await x.put(`/api/users/@me/relationships/${a.user.id}`, { type: 1 }); }
    dm1 = (await a.post("/api/users/@me/channels", { recipient_id: b.user.id })).body;
    dm2 = (await a.post("/api/users/@me/channels", { recipient_id: c.user.id })).body;
    await a.put(`/api/appearance/channel/${dm1.id}`, { data: { overrides: { background: { dark: { kind: "color", color: "#112233" } } }, conversation: { label: "Bestie", messageStyle: "bubbles" } } });
    await a.put(`/api/appearance/channel/${dm2.id}`, { data: { overrides: { background: { dark: { kind: "gradient", gradient: { from: "#000000", to: "#FF0000", angle: 90, type: "linear" } } } } } });
    const prefs = (await a.get("/api/appearance")).body.prefs;
    assert.equal(prefs.find((p: any) => p.scope_id === dm1.id).data.overrides.background.dark.color, "#112233");
    assert.equal(prefs.find((p: any) => p.scope_id === dm2.id).data.overrides.background.dark.kind, "gradient");
    assert.equal(prefs.find((p: any) => p.scope_id === dm1.id).data.conversation.label, "Bestie");
  });

  it("personal themes and conversation labels stay private", async () => {
    const theirs = (await b.get("/api/appearance")).body;
    assert.equal(theirs.prefs.length, 0, "the other participant sees none of my appearance");
    const profile = JSON.stringify((await b.get(`/api/users/${a.user.id}/profile`)).body);
    assert.ok(!profile.includes("Bestie") && !profile.includes("syndo-glass") && !profile.includes("#112233"), "nothing personal in public profile");
    const dmView = JSON.stringify((await b.get("/api/users/@me/channels")).body);
    assert.ok(!dmView.includes("Bestie"));
  });

  it("scopes are limited: server overrides can't change layout, and you must be a member", async () => {
    guild = (await a.post("/api/guilds", { name: "Looks" })).body;
    chan = guild.channels.find((c: any) => c.type === 0);
    const r = await a.put(`/api/appearance/guild/${guild.id}`, { data: { overrides: { colors: { accent: "#FF00AA" }, layout: { nav: "horizontal" } } } });
    assert.equal(r.status, 200);
    assert.ok(r.body.warnings.some((w: any) => w.path === "overrides.layout"), "layout ignored with a warning");
    assert.equal(r.body.data.overrides.layout, undefined);
    assert.equal((await b.put(`/api/appearance/guild/${guild.id}`, { data: { overrides: {} } })).status, 404, "not a member");
    assert.equal((await a.put(`/api/appearance/channel/${chan.id}`, { data: { overrides: { colors: { accent: "#00FF00" } } } })).status, 200);
    assert.equal((await a.del(`/api/appearance/channel/${chan.id}`)).status, 200, "reset channel to inherited");
    assert.ok(!(await a.get("/api/appearance")).body.prefs.some((p: any) => p.scope_id === chan.id));
  });

  it("rejects remote URLs, scripts and invalid custom CSS in themes", async () => {
    const r1 = await a.put("/api/appearance/global", { data: { overrides: { background: { dark: { kind: "image", asset: "https://evil.example/track.png" } } } } });
    assert.equal(r1.status, 400);
    const r2 = await a.post("/api/appearance/presets", { name: "Bad", data: { schema: "syndo.theme", version: 2, meta: { name: "x" }, customCss: "@import url(https://evil.example/x.css);" } });
    assert.equal(r2.status, 400);
    const ok = await a.post("/api/appearance/presets", { name: "Mine", data: { schema: "syndo.theme", version: 2, meta: { name: "Mine", scheme: "dark" }, colors: { accent: "#FF7700" }, customCss: ".msg-name { letter-spacing: 1px; }" } });
    assert.equal(ok.status, 200);
    const v = await a.post("/api/appearance/validate", { data: { name: "BetterDiscord file", css: ":root{}" } });
    assert.equal(v.body.ok, false);
    assert.match(v.body.issues[0].message, /Not a Syndo theme/);
    const v1 = await a.post("/api/appearance/validate", { data: { syndo_theme: 1, theme: "dark", accent: "#123456" } });
    assert.equal(v1.body.ok, true, "v1 exports still import");
    assert.equal(v1.body.doc.colors.accent, "#123456");
  });
});

describe("Background library", () => {
  const o = client("owen"), p = client("pam");
  let asset: any;
  it("uploads with content sniffing, tracks references, refuses deleting in-use assets", async () => {
    await o.register(); await p.register();
    assert.equal((await upload(o, "/api/appearance/assets", Buffer.from("<svg onload=alert(1)>"), "x.svg", "image/svg+xml")).status, 400);
    asset = (await upload(o, "/api/appearance/assets", PNG)).body;
    assert.match(asset.id, /^a\d+$/);
    const first = await o.req("GET", asset.url);
    assert.equal(first.status, 200);
    assert.match(String(first.headers.get("cache-control")), /no-cache/, "private assets revalidate so deletion takes effect");
    const etag = first.headers.get("etag")!;
    assert.equal((await o.req("GET", asset.url, undefined, { "if-none-match": etag })).status, 304, "unchanged asset revalidates cheaply");
    assert.equal((await p.req("GET", asset.url, undefined, { "if-none-match": etag })).status, 404, "a validator never bypasses the access check");
    assert.equal((await p.req("GET", asset.url)).status, 404, "someone else can't fetch a private wallpaper");
    assert.equal((await p.put("/api/appearance/global", { data: { overrides: { background: { dark: { kind: "image", asset: asset.id } } } } })).status, 400, "can't reference another user's asset");
    await o.put("/api/appearance/global", { data: { overrides: { background: { dark: { kind: "image", asset: asset.id } } } } });
    const del = await o.del(`/api/appearance/assets/${asset.id.slice(1)}`);
    assert.equal(del.status, 409);
    assert.deepEqual(del.body.references, ["Global appearance"]);
    const list = (await o.get("/api/appearance/assets")).body;
    assert.deepEqual(list[0].references, ["Global appearance"]);
    assert.equal((await o.post("/api/appearance/assets/cleanup")).body.removed, 0, "referenced asset survives cleanup");
    assert.equal((await o.del(`/api/appearance/assets/${asset.id.slice(1)}?force=1`)).status, 200);
    assert.equal((await o.req("GET", asset.url)).status, 404, "deleted asset is gone");
    assert.equal((await o.req("GET", asset.url, undefined, { "if-none-match": etag })).status, 404, "a cached copy can't be revalidated after deletion");
  });
});

describe("Shared conversation themes", () => {
  const x = client("xia"), y = client("yan");
  it("apply only after explicit acceptance and expose the proposer's asset only to participants", async () => {
    await x.register(); await y.register();
    await x.post("/api/users/@me/relationships", { username: "yan" }); await y.put(`/api/users/@me/relationships/${x.user.id}`, { type: 1 });
    const dm = (await x.post("/api/users/@me/channels", { recipient_id: y.user.id })).body;
    const asset = (await upload(x, "/api/appearance/assets", PNG)).body;
    const outsider = client("zed"); await outsider.register();
    assert.equal((await y.req("GET", asset.url)).status, 404);
    const gy = await y.connect();
    const ev = gy.next("CONVERSATION_THEME_UPDATE");
    const prop = await x.post(`/api/channels/${dm.id}/theme-proposals`, { data: { background: { dark: { kind: "image", asset: asset.id } }, colors: { accent: "#FF5599" } } });
    assert.equal(prop.status, 200);
    await ev;
    let shared = (await y.get("/api/appearance")).body.shared;
    assert.equal(shared.length, 1);
    assert.equal(shared[0].my_vote, null, "not applied until accepted");
    assert.equal((await y.req("GET", asset.url)).status, 200, "participants may preview the proposal's wallpaper");
    assert.equal((await outsider.req("GET", asset.url)).status, 404);
    assert.equal((await outsider.post(`/api/theme-proposals/${prop.body.id}/accept`)).status, 404);
    await y.post(`/api/theme-proposals/${prop.body.id}/accept`);
    shared = (await y.get("/api/appearance")).body.shared;
    assert.equal(shared[0].my_vote, true);
    await x.del(`/api/theme-proposals/${prop.body.id}`);
    assert.equal((await y.get("/api/appearance")).body.shared.length, 0, "withdrawn");
    assert.equal((await y.req("GET", asset.url)).status, 404, "access ends when the proposal ends");
  });
});

describe("Server profiles", () => {
  const s = client("sol"), t = client("tia");
  it("are stored separately from the global profile and shown to other members", async () => {
    await s.register(); await t.register();
    await s.patch("/api/users/@me", { bio: "global bio", pronouns: "they/them" });
    const g = (await s.post("/api/guilds", { name: "Profiles" })).body;
    const ch = g.channels.find((c: any) => c.type === 0);
    const inv = (await s.post(`/api/channels/${ch.id}/invites`, {})).body;
    await t.post(`/api/invites/${inv.code}`);
    const gt = await t.connect();
    const upd = gt.next("GUILD_MEMBER_UPDATE", (d) => d.user.id === s.user.id && !!d.guild_avatar);
    assert.equal((await upload(s, `/api/guilds/${g.id}/members/@me/avatar`, PNG)).status, 200);
    await upd;
    assert.equal((await upload(s, `/api/guilds/${g.id}/members/@me/banner`, PNG)).status, 200);
    const pr = await s.patch(`/api/guilds/${g.id}/members/@me`, { nick: "Captain Sol", bio: "server bio", pronouns: "she/her", profile_theme: { primary: "#FF0000", secondary: "#00FF00", ring: { style: "spin", color: "#FF0000", speed: 1 }, effects: [{ kind: "sparkle", enabled: true, color: "#FFFFFF", intensity: 50, speed: 1, duration: 3, loop: true, trigger: "hover", density: 30 }] } });
    assert.equal(pr.status, 200);
    assert.equal(pr.body.guild_pronouns, "she/her");
    const me = (await s.get("/api/users/@me")).body;
    assert.equal(me.bio, "global bio"); assert.equal(me.pronouns, "they/them"); assert.equal(me.avatar, null, "global avatar untouched");
    const seen = (await t.get(`/api/users/${s.user.id}/profile?guild_id=${g.id}`)).body;
    assert.equal(seen.member.nick, "Captain Sol"); assert.equal(seen.member.bio, "server bio"); assert.ok(seen.member.banner); assert.equal(seen.member.profile_theme.ring.style, "spin");
    assert.equal(seen.user.username, "sol", "stable username always present");
    const outside = (await t.get(`/api/users/${s.user.id}/profile`)).body;
    assert.equal(outside.member, null, "server profile only appears in the server context");
    const msg = (await s.post(`/api/channels/${ch.id}/messages`, { content: "hi" })).body;
    assert.equal(msg.member_nick, "Captain Sol"); assert.ok(msg.member.avatar?.includes("member-avatars"));
    const members = (await t.get(`/api/guilds/${g.id}/members`)).body.find((m: any) => m.user.id === s.user.id);
    assert.equal(members.guild_pronouns, "she/her");
    assert.equal((await s.patch(`/api/guilds/${g.id}/members/@me`, { profile_theme: { ring: { style: "<script>" } } })).status, 400);
    // "Use global value"
    await s.patch(`/api/guilds/${g.id}/members/@me`, { pronouns: null, bio: null });
    await s.del(`/api/guilds/${g.id}/members/@me/avatar`);
    const reset = (await t.get(`/api/users/${s.user.id}/profile?guild_id=${g.id}`)).body.member;
    assert.equal(reset.pronouns, null); assert.equal(reset.bio, null); assert.equal(reset.avatar, null);
    assert.equal((await t.patch(`/api/guilds/${g.id}/members/${s.user.id}`, { bio: "hijack" })).status, 403, "nobody else can edit my server profile");
  });
});
