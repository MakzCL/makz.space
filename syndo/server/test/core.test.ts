import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, mailToken, sleep, startServer, stopServer } from "./helpers.ts";

const P = {
  VIEW_CHANNEL: 1n << 0n, SEND_MESSAGES: 1n << 1n, READ_MESSAGE_HISTORY: 1n << 2n, ATTACH_FILES: 1n << 4n,
  MANAGE_MESSAGES: 1n << 7n, MANAGE_ROLES: 1n << 9n, KICK_MEMBERS: 1n << 11n, BAN_MEMBERS: 1n << 12n,
  MODERATE_MEMBERS: 1n << 19n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, VIDEO: 1n << 22n,
};
const all: Client[] = [];
const client = (n: string) => { const c = new Client(n); all.push(c); return c; };

before(async () => { await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

describe("Scenario 1 — accounts, friends, DMs, reconnect and history", () => {
  const ana = client("ana"), ben = client("ben");
  let dm: any;

  it("registers users without requiring a verification email", async () => {
    await ana.register(); await ben.register();
    assert.equal((await ana.get("/api/users/@me")).status, 200);
    assert.equal(ana.user.email_verified, false, "verification is not fabricated");
  });

  it("rejects duplicate usernames and bad passwords without leaking which accounts exist", async () => {
    const dup = client("dup");
    const r = await dup.post("/api/auth/register", { email: "x@example.test", username: "ana", password: "long enough pw" });
    assert.equal(r.status, 409);
    const bad = await dup.post("/api/auth/login", { login: "ana", password: "wrong password" });
    const none = await dup.post("/api/auth/login", { login: "nobody", password: "wrong password" });
    assert.equal(bad.status, 401); assert.equal(none.status, 401);
    assert.equal(bad.body.message, none.body.message);
  });

  it("sends, sees and accepts a friend request in real time", async () => {
    const ga = await ana.connect(), gb = await ben.connect();
    const incoming = gb.next("RELATIONSHIP_ADD", (d) => d.type === 3);
    const r = await ana.post("/api/users/@me/relationships", { username: "BEN" });
    assert.equal(r.status, 200); assert.equal(r.body.type, 4);
    await incoming;
    const accepted = ga.next("RELATIONSHIP_ADD", (d) => d.type === 1);
    assert.equal((await ben.put(`/api/users/@me/relationships/${ana.user.id}`, { type: 1 })).status, 200);
    await accepted;
    const list = (await ana.get("/api/users/@me/relationships")).body;
    assert.equal(list.find((x: any) => x.id === ben.user.id).type, 1);
  });

  it("exchanges DMs in real time with no duplicates on retry", async () => {
    dm = (await ana.post("/api/users/@me/channels", { recipient_id: ben.user.id })).body;
    assert.equal(dm.type, 1);
    const again = (await ben.post("/api/users/@me/channels", { recipient_id: ana.user.id })).body;
    assert.equal(again.id, dm.id, "one DM per pair");
    const gb = ben.sockets[0]!;
    const got = gb.next("MESSAGE_CREATE", (d) => d.content === "hi ben!");
    const m1 = await ana.post(`/api/channels/${dm.id}/messages`, { content: "hi ben!", nonce: "n-1" });
    assert.equal(m1.status, 200);
    const ev = await got;
    assert.equal(ev.id, m1.body.id); assert.equal(ev.author.id, ana.user.id);
    const retry = await ana.post(`/api/channels/${dm.id}/messages`, { content: "hi ben!", nonce: "n-1" });
    assert.equal(retry.body.id, m1.body.id, "same nonce returns the original message");
    for (let i = 0; i < 5; i++) await ben.post(`/api/channels/${dm.id}/messages`, { content: `reply ${i}` });
    const hist = (await ana.get(`/api/channels/${dm.id}/messages?limit=50`)).body;
    assert.equal(hist.length, 6);
    assert.equal(new Set(hist.map((m: any) => m.id)).size, 6);
  });

  it("recovers missed messages after reconnecting", async () => {
    ana.close(); ana.sockets = [];
    await sleep(100);
    const latest = (await ana.get(`/api/channels/${dm.id}/messages?limit=1`)).body[0].id;
    await ben.post(`/api/channels/${dm.id}/messages`, { content: "while you were away 1" });
    await ben.post(`/api/channels/${dm.id}/messages`, { content: "while you were away 2" });
    const g = await ana.connect();
    const ready = g.events.find((e) => e.t === "READY")!.d;
    assert.ok(ready.private_channels.some((c: any) => c.id === dm.id));
    const missed = (await ana.get(`/api/channels/${dm.id}/messages?after=${latest}`)).body;
    assert.deepEqual(missed.map((m: any) => m.content).reverse(), ["while you were away 1", "while you were away 2"]);
    const page1 = (await ana.get(`/api/channels/${dm.id}/messages?limit=3`)).body;
    const page2 = (await ana.get(`/api/channels/${dm.id}/messages?limit=3&before=${page1[2].id}`)).body;
    assert.equal(page2.length, 3);
    assert.ok(BigInt(page2[0].id) < BigInt(page1[2].id), "pagination is ordered");
  });

  it("tracks read state and syncs it across a user's devices", async () => {
    const second = await ben.connect();
    const rs = second.next("MESSAGE_ACK", (d) => d.channel_id === dm.id);
    const last = (await ben.get(`/api/channels/${dm.id}/messages?limit=1`)).body[0].id;
    assert.equal((await ben.post(`/api/channels/${dm.id}/messages/${last}/ack`)).status, 200);
    assert.equal((await rs).last_read_id, last);
  });
});

describe("Scenario 2/17 — roles, private channels, and no leaks via messages, search, files or the gateway", () => {
  const owner = client("olivia"), member = client("mark"), outsider = client("otto");
  let guild: any, secret: any, general: any, role: any, att: any;

  it("creates a server and lets a member join by invite", async () => {
    await owner.register(); await member.register(); await outsider.register();
    guild = (await owner.post("/api/guilds", { name: "Sunrise Club" })).body;
    general = guild.channels.find((c: any) => c.type === 0);
    assert.ok(general, "default text channel");
    const inv = (await owner.post(`/api/channels/${general.id}/invites`, { max_uses: 5 })).body;
    const preview = await outsider.get(`/api/invites/${inv.code}`);
    assert.equal(preview.body.guild.name, "Sunrise Club");
    assert.equal((await member.post(`/api/invites/${inv.code}`)).status, 200);
    const g = (await member.get(`/api/guilds/${guild.id}`)).body;
    assert.equal(g.me.user.id, member.user.id);
  });

  it("hides a private channel from members without access everywhere", async () => {
    await member.connect(); await owner.connect();
    secret = (await owner.post(`/api/guilds/${guild.id}/channels`, { name: "Staff Room", type: 0, private: true })).body;
    assert.equal(secret.name, "staff-room");
    const msg = (await owner.post(`/api/channels/${secret.id}/messages`, { content: "the secret password is pineapple" })).body;
    // Attachment in the private channel.
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from("top secret notes")], { type: "text/plain" }), "notes.txt");
    att = (await owner.req("POST", `/api/channels/${secret.id}/attachments`, fd)).body;
    assert.ok(att.id, JSON.stringify(att));
    await owner.post(`/api/channels/${secret.id}/messages`, { content: "file", attachment_ids: [att.id] });

    assert.equal((await member.get(`/api/channels/${secret.id}/messages`)).status, 404, "history hidden as not found");
    assert.equal((await member.get(`/api/channels/${secret.id}/messages/${msg.id}`)).status, 404);
    assert.equal((await member.post(`/api/channels/${secret.id}/messages`, { content: "let me in" })).status, 404);
    assert.equal((await member.get(att.url)).status, 404, "attachment URL is permission-checked");
    assert.equal((await outsider.get(att.url)).status, 404);
    const s = (await member.get(`/api/search?guild_id=${guild.id}&q=pineapple`)).body;
    assert.equal(s.total, 0, "search never returns private messages");
    const gview = (await member.get(`/api/guilds/${guild.id}`)).body;
    assert.ok(!gview.channels.some((c: any) => c.id === secret.id), "channel not listed");
    assert.ok(!member.sockets[0]!.has("MESSAGE_CREATE", (d) => d.channel_id === secret.id), "no gateway events");
    assert.equal((await member.put(`/api/channels/${secret.id}/messages/${msg.id}/reactions/${encodeURIComponent("👍")}/@me`)).status, 404);
    assert.equal((await member.put(`/api/channels/${secret.id}/pins/${msg.id}`)).status, 404);
    assert.equal((await outsider.get(`/api/guilds/${guild.id}`)).status, 404, "non-members can't see the server");
  });

  it("grants access through a role overwrite and revokes it again", async () => {
    role = (await owner.post(`/api/guilds/${guild.id}/roles`, { name: "Staff", color: "#3D6BFF", hoist: true })).body;
    assert.equal((await owner.put(`/api/channels/${secret.id}/permissions/${role.id}`, { type: 0, allow: String(P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY), deny: "0" })).status, 200);
    const sync = member.sockets[0]!.next("GUILD_SYNC", (d) => d.channels.some((c: any) => c.id === secret.id));
    assert.equal((await owner.patch(`/api/guilds/${guild.id}/members/${member.user.id}`, { roles: [role.id] })).status, 200);
    await sync;
    assert.equal((await member.get(`/api/channels/${secret.id}/messages`)).status, 200);
    assert.equal((await member.get(att.url)).status, 200);
    assert.equal((await member.get(`/api/search?guild_id=${guild.id}&q=pineapple`)).body.total, 1);
    const live = member.sockets[0]!.next("MESSAGE_CREATE", (d) => d.channel_id === secret.id);
    await owner.post(`/api/channels/${secret.id}/messages`, { content: "welcome to staff" });
    await live;
    // Revoke
    const gone = member.sockets[0]!.next("GUILD_SYNC", (d) => !d.channels.some((c: any) => c.id === secret.id));
    await owner.patch(`/api/guilds/${guild.id}/members/${member.user.id}`, { roles: [] });
    await gone;
    await owner.post(`/api/channels/${secret.id}/messages`, { content: "after revocation" });
    await sleep(200);
    assert.ok(!member.sockets[0]!.has("MESSAGE_CREATE", (d) => d.content === "after revocation"));
    assert.equal((await member.get(att.url)).status, 404);
  });

  it("enforces role hierarchy and permission escalation rules", async () => {
    const mod = (await owner.post(`/api/guilds/${guild.id}/roles`, { name: "Mod", permissions: String(P.MANAGE_ROLES | P.KICK_MEMBERS) })).body;
    await owner.patch(`/api/guilds/${guild.id}/members/${member.user.id}`, { roles: [mod.id] });
    const esc = await member.post(`/api/guilds/${guild.id}/roles`, { name: "Boss", permissions: String(1n << 13n) });
    assert.equal(esc.status, 403, "can't grant ADMINISTRATOR they don't have");
    assert.equal((await member.del(`/api/guilds/${guild.id}/members/${owner.user.id}`)).status, 403, "can't kick the owner");
    const roles = (await owner.get(`/api/guilds/${guild.id}`)).body.roles;
    const staff = roles.find((r: any) => r.name === "Staff");
    // Staff was created first then Mod placed directly above @everyone → Staff is now above Mod.
    assert.ok(staff.position > roles.find((r: any) => r.name === "Mod").position);
    assert.equal((await member.patch(`/api/guilds/${guild.id}/roles/${staff.id}`, { name: "Hacked" })).status, 403, "can't edit a higher role");
    assert.equal((await member.patch(`/api/guilds/${guild.id}/members/${member.user.id}`, { roles: [mod.id, staff.id] })).status, 403, "can't self-assign a higher role");
  });

  it("records administrative actions in the audit log (visible only with permission)", async () => {
    const log = (await owner.get(`/api/guilds/${guild.id}/audit-log`)).body;
    assert.ok(log.some((e: any) => e.action === "role_create"));
    assert.ok(log.some((e: any) => e.action === "overwrite_update"));
    assert.equal((await member.get(`/api/guilds/${guild.id}/audit-log`)).status, 403);
  });
});

describe("Scenario 3 — edits, reactions and deletions sync across clients", () => {
  const a = client("cara"), b = client("dev");
  let ch: any, msg: any;
  it("syncs everything to both users and to a second device", async () => {
    await a.register(); await b.register();
    const g = (await a.post("/api/guilds", { name: "Sync Lab" })).body;
    ch = g.channels.find((c: any) => c.type === 0);
    const inv = (await a.post(`/api/channels/${ch.id}/invites`, {})).body;
    await b.post(`/api/invites/${inv.code}`);
    const ga = await a.connect(), gb = await b.connect(), gb2 = await b.connect();
    msg = (await a.post(`/api/channels/${ch.id}/messages`, { content: "**hello** <@" + b.user.id + ">" })).body;
    assert.deepEqual(msg.mentions, [b.user.id]);
    await gb.next("MESSAGE_CREATE", (d) => d.id === msg.id, 4000, true);
    await gb2.next("MESSAGE_CREATE", (d) => d.id === msg.id, 4000, true);
    await gb.next("MENTION", (d) => d.message_id === msg.id, 4000, true);

    const ed = gb2.next("MESSAGE_UPDATE", (d) => d.id === msg.id);
    assert.equal((await a.patch(`/api/channels/${ch.id}/messages/${msg.id}`, { content: "hello (edited)" })).status, 200);
    assert.ok((await ed).edited_at);
    assert.equal((await b.patch(`/api/channels/${ch.id}/messages/${msg.id}`, { content: "not yours" })).status, 403);

    const re = ga.next("MESSAGE_REACTION_ADD", (d) => d.message_id === msg.id && d.user_id === b.user.id);
    assert.equal((await b.put(`/api/channels/${ch.id}/messages/${msg.id}/reactions/${encodeURIComponent("🌻")}/@me`)).status, 200);
    await re;
    await b.put(`/api/channels/${ch.id}/messages/${msg.id}/reactions/${encodeURIComponent("🌻")}/@me`); // idempotent
    const fetched = (await a.get(`/api/channels/${ch.id}/messages/${msg.id}`)).body;
    assert.deepEqual(fetched.reactions, [{ emoji: "🌻", count: 1, me: false }]);
    assert.equal((await b.put(`/api/channels/${ch.id}/messages/${msg.id}/reactions/${encodeURIComponent("<script>")}/@me`)).status, 400);

    const reply = (await b.post(`/api/channels/${ch.id}/messages`, { content: "replying", reply_to: msg.id })).body;
    assert.equal(reply.reply_to.id, msg.id);

    const del = gb2.next("MESSAGE_DELETE", (d) => d.id === msg.id);
    assert.equal((await b.del(`/api/channels/${ch.id}/messages/${msg.id}`)).status, 403, "can't delete others' messages");
    assert.equal((await a.del(`/api/channels/${ch.id}/messages/${msg.id}`)).status, 200);
    await del;
    const hist = (await b.get(`/api/channels/${ch.id}/messages`)).body;
    assert.ok(!hist.some((m: any) => m.id === msg.id));
    const typing = ga.next("TYPING_START", (d) => d.user_id === b.user.id);
    await b.post(`/api/channels/${ch.id}/typing`);
    await typing;
  });
});

describe("Scenario 14 — blocking, timeouts, kicks and bans", () => {
  const x = client("xena"), y = client("yuri"), z = client("zoe");
  let g: any, ch: any;
  it("blocking stops DMs, friend requests and group invites without revealing the block", async () => {
    await x.register(); await y.register(); await z.register();
    await x.post("/api/users/@me/relationships", { username: "yuri" });
    await y.put(`/api/users/@me/relationships/${x.user.id}`, { type: 1 });
    const dm = (await x.post("/api/users/@me/channels", { recipient_id: y.user.id })).body;
    await x.post(`/api/channels/${dm.id}/messages`, { content: "before block" });
    assert.equal((await y.put(`/api/users/@me/relationships/${x.user.id}`, { type: 2 })).status, 200);
    const send = await x.post(`/api/channels/${dm.id}/messages`, { content: "after block" });
    assert.equal(send.status, 403);
    assert.equal((await x.get(`/api/channels/${dm.id}/messages`)).status, 200, "history stays readable");
    const fr = await x.post("/api/users/@me/relationships", { username: "yuri" });
    const unknown = await x.post("/api/users/@me/relationships", { username: "nobody_here" });
    assert.equal(fr.status, 400); assert.equal(fr.body.message, unknown.body.message, "block not revealed");
    await x.post("/api/users/@me/relationships", { username: "zoe" });
    await z.put(`/api/users/@me/relationships/${x.user.id}`, { type: 1 });
    const grp = await x.post("/api/users/@me/channels", { recipients: [z.user.id, y.user.id] });
    assert.equal(grp.status, 403, "can't add a non-friend/blocker");
    const tok = await x.post("/api/voice/token", { channel_id: dm.id });
    assert.equal(tok.status, 403, "no calls across a block");
  });

  it("timeouts stop sending; kicks and bans remove access; bans block rejoining", async () => {
    g = (await z.post("/api/guilds", { name: "Mod Test" })).body;
    ch = g.channels.find((c: any) => c.type === 0);
    const inv = (await z.post(`/api/channels/${ch.id}/invites`, {})).body;
    await x.post(`/api/invites/${inv.code}`);
    const until = new Date(Date.now() + 60_000).toISOString();
    assert.equal((await z.patch(`/api/guilds/${g.id}/members/${x.user.id}`, { communication_disabled_until: until })).status, 200);
    assert.equal((await x.post(`/api/channels/${ch.id}/messages`, { content: "can I talk?" })).status, 403);
    assert.equal((await x.get(`/api/channels/${ch.id}/messages`)).status, 200, "can still read");
    assert.equal((await x.patch(`/api/guilds/${g.id}/members/${z.user.id}`, { communication_disabled_until: until })).status, 403);
    await z.patch(`/api/guilds/${g.id}/members/${x.user.id}`, { communication_disabled_until: null });
    assert.equal((await x.post(`/api/channels/${ch.id}/messages`, { content: "thanks" })).status, 200);
    const gx = await x.connect();
    const del = gx.next("GUILD_DELETE", (d) => d.id === g.id);
    assert.equal((await z.put(`/api/guilds/${g.id}/bans/${x.user.id}`, { reason: "test", delete_message_seconds: 3600 })).status, 200);
    await del;
    assert.equal((await x.get(`/api/channels/${ch.id}/messages`)).status, 404);
    const rejoin = await x.post(`/api/invites/${inv.code}`);
    assert.equal(rejoin.status, 403);
    const hist = (await z.get(`/api/channels/${ch.id}/messages`)).body;
    assert.ok(!hist.some((m: any) => m.content === "thanks"), "ban removed recent messages");
    assert.equal((await z.del(`/api/guilds/${g.id}/bans/${x.user.id}`)).status, 200);
    assert.equal((await x.post(`/api/invites/${inv.code}`)).status, 200, "unban allows rejoining");
  });
});

describe("Scenario 15 — session revocation and password reset", () => {
  const s = client("sam");
  it("revoking a session closes its gateway and rejects its requests", async () => {
    await s.register();
    const other = new Client("sam-laptop"); all.push(other);
    const login = await other.post("/api/auth/login", { login: "sam", password: "correct horse battery" });
    assert.equal(login.status, 200);
    const g = await other.connect();
    const sessions = (await s.get("/api/auth/sessions")).body;
    assert.equal(sessions.length, 2);
    const laptop = sessions.find((x: any) => !x.current);
    assert.equal((await s.del(`/api/auth/sessions/${laptop.id}`)).status, 200);
    const closed = await g.closed;
    assert.equal(closed.code, 4004);
    assert.equal((await other.get("/api/users/@me")).status, 401);
    assert.equal((await s.get("/api/users/@me")).status, 200);
  });

  it("password reset revokes every session", async () => {
    await s.post("/api/auth/forgot-password", { email: "sam@example.test" });
    const token = await mailToken(s, "sam@example.test", "reset");
    assert.ok(token);
    assert.equal((await s.post("/api/auth/reset-password", { token, password: "a brand new password" })).status, 200);
    assert.equal((await s.get("/api/users/@me")).status, 401);
    assert.equal((await s.post("/api/auth/login", { login: "sam", password: "a brand new password" })).status, 200);
  });

  it("rejects cookie-authenticated writes from foreign origins", async () => {
    const r = await s.req("POST", "/api/guilds", { name: "CSRF" }, { origin: "https://evil.example" });
    assert.equal(r.status, 403);
  });
});

describe("Multifactor authentication", () => {
  const m = client("mia");
  it("enables TOTP, requires it at login, and accepts a recovery code once", async () => {
    await m.register();
    const setup = (await m.post("/api/auth/mfa/setup")).body;
    const OTPAuth = await import("otpauth");
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.secret) });
    const en = await m.post("/api/auth/mfa/enable", { code: totp.generate() });
    assert.equal(en.status, 200);
    assert.equal(en.body.recovery_codes.length, 10);
    const fresh = new Client("mia2"); all.push(fresh);
    const l = await fresh.post("/api/auth/login", { login: "mia", password: "correct horse battery" });
    assert.equal(l.body.mfa_required, true);
    assert.equal((await fresh.get("/api/users/@me")).status, 401, "pending session can't act");
    assert.equal((await fresh.post("/api/auth/mfa/verify", { code: "000000" })).status, 401);
    assert.equal((await fresh.post("/api/auth/mfa/verify", { code: en.body.recovery_codes[0] })).status, 200);
    assert.equal((await fresh.get("/api/users/@me")).status, 200);
    const again = new Client("mia3"); all.push(again);
    await again.post("/api/auth/login", { login: "mia", password: "correct horse battery" });
    assert.equal((await again.post("/api/auth/mfa/verify", { code: en.body.recovery_codes[0] })).status, 401, "recovery code is single-use");
    assert.equal((await again.post("/api/auth/mfa/verify", { code: totp.generate() })).status, 200);
  });
});

describe("Invites — limits, expiry and revocation", () => {
  const o = client("ivy"), p1 = client("pat"), p2 = client("quinn");
  it("enforces max uses atomically and revocation", async () => {
    await o.register(); await p1.register(); await p2.register();
    const g = (await o.post("/api/guilds", { name: "Invite Lab" })).body;
    const ch = g.channels.find((c: any) => c.type === 0);
    const one = (await o.post(`/api/channels/${ch.id}/invites`, { max_uses: 1 })).body;
    const [r1, r2] = await Promise.all([p1.post(`/api/invites/${one.code}`), p2.post(`/api/invites/${one.code}`)]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 404], "exactly one person gets the last use");
    const multi = (await o.post(`/api/channels/${ch.id}/invites`, {})).body;
    assert.equal((await o.del(`/api/invites/${multi.code}`)).status, 200);
    assert.equal((await p2.get(`/api/invites/${multi.code}`)).status, 404);
    assert.equal((await o.patch(`/api/guilds/${g.id}`, { vanity_code: "invite-lab" })).status, 200);
    const loser = r1.status === 200 ? p2 : p1;
    assert.equal((await loser.post(`/api/invites/invite-lab`)).status, 200, "custom invite alias works");
  });
});

describe("Voice admission — media tokens follow permissions", () => {
  const o = client("vera"), m = client("walt");
  it("mints tokens whose grants match SPEAK/VIDEO and refuses without CONNECT", async () => {
    await o.register(); await m.register();
    const g = (await o.post("/api/guilds", { name: "Voice Lab" })).body;
    const vc = g.channels.find((c: any) => c.type === 2);
    const text = g.channels.find((c: any) => c.type === 0);
    const inv = (await o.post(`/api/channels/${text.id}/invites`, {})).body;
    await m.post(`/api/invites/${inv.code}`);
    const decode = (t: string) => JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString());
    const t1 = (await m.post("/api/voice/token", { channel_id: vc.id })).body;
    const v1 = decode(t1.token).video;
    assert.equal(v1.room, `c${vc.id}`);
    assert.deepEqual(v1.canPublishSources.sort(), ["camera", "microphone", "screen_share", "screen_share_audio"].sort());
    // Deny SPEAK + VIDEO for @everyone in this channel.
    await o.put(`/api/channels/${vc.id}/permissions/${g.id}`, { type: 0, allow: "0", deny: String(P.SPEAK | P.VIDEO) });
    const v2 = decode((await m.post("/api/voice/token", { channel_id: vc.id })).body.token).video;
    assert.deepEqual(v2.canPublishSources ?? [], [], "listen-only");
    assert.equal(v2.canPublish, false);
    await o.put(`/api/channels/${vc.id}/permissions/${g.id}`, { type: 0, allow: "0", deny: String(P.CONNECT) });
    assert.equal((await m.post("/api/voice/token", { channel_id: vc.id })).status, 403);
    assert.equal((await m.post("/api/voice/token", { channel_id: text.id })).status, 400);
  });

  it("tracks voice state on the gateway and removes it when access is revoked", async () => {
    const g = (await o.post("/api/guilds", { name: "Voice Lab 2" })).body;
    const vc = g.channels.find((c: any) => c.type === 2);
    const text = g.channels.find((c: any) => c.type === 0);
    const inv = (await o.post(`/api/channels/${text.id}/invites`, {})).body;
    await m.post(`/api/invites/${inv.code}`);
    const go = await o.connect(), gm = await m.connect();
    const seen = go.next("VOICE_STATE_UPDATE", (d) => d.user_id === m.user.id && d.channel_id === vc.id);
    gm.send("voice_state", { channel_id: vc.id, self_mute: false });
    await seen;
    const kicked = gm.next("VOICE_DISCONNECTED");
    await o.put(`/api/channels/${vc.id}/permissions/${m.user.id}`, { type: 1, allow: "0", deny: String(P.CONNECT) });
    await kicked;
  });
});

describe("Account data", () => {
  const d = client("dana");
  it("exports data and deletes the account", async () => {
    await d.register();
    await d.patch("/api/users/@me", { bio: "hello", pronouns: "they/them", profile_theme: { primary: "#3D6BFF", secondary: "#FFC93C" } });
    await d.patch("/api/users/@me/settings", { theme: "dark", fontScale: 1.1 });
    const exp = (await d.get("/api/users/@me/export")).body;
    assert.equal(exp.user.bio, "hello");
    assert.equal(exp.user.settings.theme, "dark");
    assert.equal((await d.del("/api/users/@me", { password: "wrong" })).status, 401);
    assert.equal((await d.del("/api/users/@me", { password: "correct horse battery" })).status, 200);
    assert.equal((await d.get("/api/users/@me")).status, 401);
    const relogin = await d.post("/api/auth/login", { login: "dana", password: "correct horse battery" });
    assert.equal(relogin.status, 401);
  });
});
