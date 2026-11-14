import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, sleep, startServer, stopServer } from "./helpers.ts";

const all: Client[] = [];
const client = (n: string) => { const c = new Client(n); all.push(c); return c; };

before(async () => { await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

async function serverWith(owner: Client, ...others: Client[]) {
  const g = (await owner.post("/api/guilds", { name: `Major ${owner.name}` })).body;
  const text = g.channels.find((c: any) => c.type === 0);
  const inv = (await owner.post(`/api/channels/${text.id}/invites`, {})).body;
  for (const o of others) assert.equal((await o.post(`/api/invites/${inv.code}`)).status, 200);
  return { g, text, inv };
}

describe("Messages: polls, forwarding, reply pings, inbox", () => {
  const a = client("ma"), b = client("mb");
  it("creates a poll, votes, ends it with a result message", async () => {
    await a.register(); await b.register();
    const { text } = await serverWith(a, b);
    const m = (await a.post(`/api/channels/${text.id}/messages`, { poll: { question: "Pizza?", answers: [{ text: "Yes" }, { text: "No" }], duration_hours: 1 } })).body;
    assert.equal(m.poll.question, "Pizza?");
    const v = await b.put(`/api/channels/${text.id}/polls/${m.id}/votes`, { answer_ids: [1] });
    assert.equal(v.status, 200);
    assert.equal(v.body.poll.answers[0].votes, 1);
    assert.equal(v.body.poll.answers[0].me, true);
    assert.equal((await b.put(`/api/channels/${text.id}/polls/${m.id}/votes`, { answer_ids: [1, 2] })).status, 400, "single choice");
    assert.equal((await b.post(`/api/channels/${text.id}/polls/${m.id}/expire`)).status, 403, "only the author ends it");
    const ended = await a.post(`/api/channels/${text.id}/polls/${m.id}/expire`);
    assert.equal(ended.body.poll.finalized, true);
    const list = (await a.get(`/api/channels/${text.id}/messages?limit=5`)).body;
    assert.ok(list.some((x: any) => x.type === 46 && JSON.parse(x.content).winner === "Yes"), "result message");
  });
  it("forwards a message as a snapshot and pings on reply unless turned off", async () => {
    const { text } = await serverWith(b, a);
    const orig = (await b.post(`/api/channels/${text.id}/messages`, { content: "original text" })).body;
    const dm = (await a.post("/api/users/@me/channels", { recipient_id: b.user.id })).body;
    const fwd = (await a.post(`/api/channels/${dm.id}/messages`, { forward: { message_id: orig.id, channel_id: text.id } })).body;
    assert.equal(fwd.snapshot.content, "original text");
    assert.equal(fwd.snapshot.origin.channel_id, text.id);
    const r1 = (await a.post(`/api/channels/${text.id}/messages`, { content: "reply", reply_to: orig.id })).body;
    assert.ok(r1.mentions.includes(b.user.id), "reply pings the author");
    const r2 = (await a.post(`/api/channels/${text.id}/messages`, { content: "quiet reply", reply_to: orig.id, mention_author: false })).body;
    assert.ok(!r2.mentions.includes(b.user.id));
    assert.equal(r2.mention_author, false);
    const inbox = (await b.get("/api/users/@me/mentions")).body;
    assert.ok(inbox.some((m: any) => m.id === r1.id), "mention shows in the inbox");
    assert.ok(!inbox.some((m: any) => m.id === r2.id));
  });
  it("never previews private addresses", async () => {
    const { previewFor, privateAddress, linksIn } = await import("../src/unfurl.ts");
    assert.equal(await previewFor("http://127.0.0.1:3900/api/health"), null);
    assert.equal(await previewFor("http://localhost/"), null);
    assert.ok(privateAddress("10.1.2.3") && privateAddress("169.254.169.254") && privateAddress("::1") && privateAddress("fd00::1") && !privateAddress("1.1.1.1"));
    assert.deepEqual(linksIn("see https://a.example/x and `https://b.example` and <https://c.example> ||https://d.example||"), ["https://a.example/x"]);
  });
});

describe("Threads and forums", () => {
  const o = client("to"), m = client("tm"), x = client("tx");
  it("starts a thread from a message, counts messages, archives", async () => {
    await o.register(); await m.register(); await x.register();
    const { text } = await serverWith(o, m, x);
    const msg = (await o.post(`/api/channels/${text.id}/messages`, { content: "start here" })).body;
    const t = await m.post(`/api/channels/${text.id}/threads`, { name: "Side chat", message_id: msg.id });
    assert.equal(t.status, 200);
    assert.equal(t.body.type, 11);
    await m.post(`/api/channels/${t.body.id}/messages`, { content: "in thread" });
    const list = (await o.get(`/api/channels/${text.id}/threads`)).body;
    assert.equal(list.threads[0].thread.message_count, 1);
    const starter = (await o.get(`/api/channels/${text.id}/messages/${msg.id}`)).body;
    assert.equal(starter.thread.id, t.body.id);
    assert.equal((await x.patch(`/api/channels/${t.body.id}/thread`, { locked: true })).status, 403);
    assert.equal((await o.patch(`/api/channels/${t.body.id}/thread`, { archived: true, locked: true })).body.thread.archived, true);
    assert.equal((await m.post(`/api/channels/${t.body.id}/messages`, { content: "locked?" })).status, 403);
  });
  it("private threads are only visible to members and moderators", async () => {
    const { text } = await serverWith(o, m, x);
    const t = (await m.post(`/api/channels/${text.id}/threads`, { name: "secret", type: 12 })).body;
    assert.equal((await x.get(`/api/channels/${t.id}/messages`)).status, 404);
    assert.equal((await o.get(`/api/channels/${t.id}/messages`)).status, 200, "owner (admin) sees it");
    await m.put(`/api/channels/${t.id}/thread-members/${x.user.id}`);
    assert.equal((await x.get(`/api/channels/${t.id}/messages`)).status, 200);
  });
  it("forum posts need tags when required and show their first message", async () => {
    const { g } = await serverWith(o, m);
    const forum = (await o.post(`/api/guilds/${g.id}/channels`, { name: "help", type: 15 })).body;
    const f = (await o.patch(`/api/channels/${forum.id}/forum`, { available_tags: [{ name: "Bug" }, { name: "Idea" }], require_tag: true })).body;
    assert.equal(f.available_tags.length, 2);
    assert.equal((await m.post(`/api/channels/${forum.id}/threads`, { name: "Crash", message: { content: "it crashes" } })).status, 400, "tag required");
    const post = await m.post(`/api/channels/${forum.id}/threads`, { name: "Crash", applied_tags: [f.available_tags[0].id], message: { content: "it crashes" } });
    assert.equal(post.status, 200);
    const list = (await o.get(`/api/channels/${forum.id}/threads`)).body;
    assert.equal(list.threads[0].thread.starter.content, "it crashes");
  });
});

describe("Server tools", () => {
  const o = client("so"), m = client("sm");
  it("events: create, RSVP, start, cancel", async () => {
    await o.register(); await m.register();
    const { g } = await serverWith(o, m);
    const start = new Date(Date.now() + 3600_000).toISOString(), end = new Date(Date.now() + 7200_000).toISOString();
    assert.equal((await m.post(`/api/guilds/${g.id}/events`, { name: "Party", entity_type: 3, location: "Park", start_at: start, end_at: end })).status, 403);
    const e = (await o.post(`/api/guilds/${g.id}/events`, { name: "Party", entity_type: 3, location: "Park", start_at: start, end_at: end, recurrence: "weekly" })).body;
    assert.equal(e.user_count, 1);
    await m.put(`/api/guilds/${g.id}/events/${e.id}/users/@me`);
    const list = (await m.get(`/api/guilds/${g.id}/events`)).body;
    assert.equal(list[0].user_count, 2);
    assert.equal(list[0].me, true);
    assert.equal((await o.patch(`/api/guilds/${g.id}/events/${e.id}`, { status: 2 })).body.status, 2);
    const done = await o.patch(`/api/guilds/${g.id}/events/${e.id}`, { status: 3 });
    assert.equal(done.body.status, 3);
    const next = (await m.get(`/api/guilds/${g.id}/events`)).body;
    assert.equal(next.length, 1, "weekly event made its next occurrence");
    assert.equal(next[0].user_count, 2, "interested people carried over");
  });
  it("AutoMod blocks words, allows admins, alerts a channel", async () => {
    const { g, text } = await serverWith(o, m);
    const r = await o.post(`/api/guilds/${g.id}/automod/rules`, { name: "No spoilers", trigger_type: 1, trigger_meta: { keywords: ["ending*"] }, actions: [{ type: 1, message: "No spoilers please" }, { type: 2, channel_id: text.id }] });
    assert.equal(r.status, 200);
    const blocked = await m.post(`/api/channels/${text.id}/messages`, { content: "the endings are great" });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.message, "No spoilers please");
    assert.equal((await m.post(`/api/channels/${text.id}/messages`, { content: "pending stuff" })).status, 200, "word boundary respected");
    assert.equal((await o.post(`/api/channels/${text.id}/messages`, { content: "endings" })).status, 200, "admins aren't filtered");
    const msgs = (await o.get(`/api/channels/${text.id}/messages?limit=10`)).body;
    assert.ok(msgs.some((x: any) => x.type === 24), "alert posted");
    assert.equal((await o.post(`/api/guilds/${g.id}/automod/rules`, { name: "bad", trigger_type: 1, trigger_meta: { regex: ["(a+)+$"] }, actions: [{ type: 1 }] })).status, 400, "unsafe regex refused");
  });
  it("rules screening keeps new members read-only until they accept", async () => {
    const { g, text, inv } = await serverWith(o);
    await o.put(`/api/guilds/${g.id}/onboarding`, { enabled: false, screening: { enabled: true, description: "Be nice", rules: ["No spam"] } });
    const n = client("snew"); await n.register();
    await n.post(`/api/invites/${inv.code}`);
    assert.equal((await n.post(`/api/channels/${text.id}/messages`, { content: "hi" })).status, 403);
    assert.equal((await n.get(`/api/channels/${text.id}/messages`)).status, 200, "can still read");
    assert.equal((await n.post(`/api/guilds/${g.id}/onboarding/complete`, {})).status, 400);
    assert.equal((await n.post(`/api/guilds/${g.id}/onboarding/complete`, { accept_rules: true })).status, 200);
    assert.equal((await n.post(`/api/channels/${text.id}/messages`, { content: "hi" })).status, 200);
  });
  it("insights, prune preview and discovery", async () => {
    const { g, text } = await serverWith(o, m);
    await m.post(`/api/channels/${text.id}/messages`, { content: "activity" });
    await sleep(100);
    const ins = (await o.get(`/api/guilds/${g.id}/insights`)).body;
    assert.ok(ins.totals.messages >= 1);
    assert.equal(ins.members, 2);
    assert.equal((await m.get(`/api/guilds/${g.id}/insights`)).status, 403);
    assert.equal((await o.get(`/api/guilds/${g.id}/prune?days=7`)).body.pruned, 0, "new members are never pruned");
    assert.equal((await o.patch(`/api/guilds/${g.id}/discovery`, { discoverable: true })).status, 400, "needs a description and members");
  });
  it("voice channel status is set by people in the channel", async () => {
    const { g } = await serverWith(o, m);
    const vc = g.channels.find((c: any) => c.type === 2);
    assert.equal((await m.put(`/api/channels/${vc.id}/voice-status`, { status: "Ranked games" })).status, 403);
    assert.equal((await o.put(`/api/channels/${vc.id}/voice-status`, { status: "Ranked games" })).status, 200, "moderators can");
  });
});

describe("Apps, commands, webhooks", () => {
  const o = client("ao"), m = client("am");
  it("webhooks post with their own name; the URL is the only secret", async () => {
    await o.register(); await m.register();
    const { text } = await serverWith(o, m);
    assert.equal((await m.post(`/api/channels/${text.id}/webhooks`, { name: "CI" })).status, 403);
    const w = (await o.post(`/api/channels/${text.id}/webhooks`, { name: "CI" })).body;
    assert.ok(w.url);
    const anon = new Client("anon");
    const sent = await anon.req("POST", `${w.url}?wait=true`, { content: "Build passed", username: "Builder", embeds: [{ title: "#42", color: 0x22cc88 }] }, { origin: "" });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.author.username, "Builder");
    assert.equal(sent.body.embeds[0].title, "#42");
    assert.equal((await anon.req("POST", `/api/webhooks/${w.id}/wrongtoken`, { content: "x" }, { origin: "" })).status, 404);
  });
  it("a bot registers slash commands and answers an interaction over the gateway", async () => {
    const { g, text } = await serverWith(o, m);
    const app = (await o.post("/api/applications", { name: "Helper" })).body;
    const { token } = (await o.post(`/api/applications/${app.id}/bot/reset-token`)).body;
    const bot = new Client("bot"); all.push(bot);
    bot.cookie = "";
    const asBot = (method: string, path: string, body?: unknown) => bot.req(method, path, body, { authorization: `Bearer ${token}`, origin: "" });
    assert.equal((await asBot("PUT", `/api/applications/${app.id}/commands`, [{ name: "ping", description: "Replies pong" }])).status, 200);
    assert.equal((await o.post(`/api/applications/${app.id}/install`, { guild_id: g.id, permissions: "3" })).status, 200);
    const cmds = (await m.get(`/api/guilds/${g.id}/commands`)).body;
    assert.equal(cmds[0].name, "ping");
    // The bot connects to the gateway with its token.
    const WebSocket = (await import("ws")).default;
    const base = (await import("./helpers.ts")) as any; void base;
    const url = (m as any).sockets?.[0]?.ws?.url;
    void url;
    const gw = await m.connect();
    const wsUrl = gw.ws.url;
    const ws = new WebSocket(wsUrl);
    const got: any[] = [];
    await new Promise<void>((res) => ws.on("open", () => res()));
    ws.on("message", (raw) => { const f = JSON.parse(String(raw)); if (f.op === "dispatch") got.push(f); });
    ws.send(JSON.stringify({ op: "identify", token }));
    await sleep(300);
    assert.ok(got.some((f) => f.t === "READY"), "bot identified");
    const ix = await m.post("/api/interactions", { type: 2, application_id: app.id, channel_id: text.id, data: { name: "ping" } });
    assert.equal(ix.status, 200, JSON.stringify(ix.body));
    await sleep(200);
    const ev = got.find((f) => f.t === "INTERACTION_CREATE");
    assert.ok(ev, "bot received the interaction");
    const reply = await asBot("POST", `/api/interactions/${ev.d.id}/${ev.d.token}/callback`, { type: 4, data: { content: "pong" } });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.content, "pong");
    assert.equal(reply.body.interaction.name, "ping");
    ws.close();
  });
});

describe("Boosts, notifications, stage, announcements", () => {
  const o = client("bo"), m = client("bm");
  it("staff codes give free boosts that raise a server's level", async () => {
    await o.register(); await m.register();
    const { g } = await serverWith(o, m);
    assert.equal((await m.post("/api/staff/codes", { kind: "free" })).status, 403);
    const { pool } = await import("../src/db.ts");
    await pool.query("update users set staff = true where id = $1", [o.user.id]);
    const code = (await o.post("/api/staff/codes", { kind: "free", slots: 2, max_uses: 1 })).body.code;
    assert.equal((await m.post("/api/premium/redeem", { code })).status, 200);
    assert.equal((await o.post("/api/premium/redeem", { code })).status, 400, "used up");
    const p = (await m.get("/api/premium")).body;
    assert.equal(p.boosts.length, 2);
    for (const b of p.boosts) await m.put(`/api/premium/boosts/${b.id}`, { guild_id: g.id });
    const guild = (await o.get(`/api/guilds/${g.id}`)).body;
    assert.equal(guild.premium_count, 2);
    assert.equal(guild.premium_tier, 1);
    assert.equal((await m.post("/api/premium/checkout", {})).status, 503, "no Stripe keys → clear message");
    await o.post("/api/staff/grants", { user: "bm", slots: 1, days: 30 });
    assert.equal((await m.get("/api/premium")).body.boosts.length, 3);
  });
  it("notification settings: levels and timed mutes", async () => {
    const { g } = await serverWith(o, m);
    const r = (await m.put(`/api/users/@me/notification-settings/${g.id}`, { scope_kind: 0, level: 2, muted: true, mute_minutes: 60 })).body;
    assert.equal(r.level, 2);
    assert.ok(new Date(r.muted_until).getTime() > Date.now() + 50 * 60_000);
    assert.equal((await m.get("/api/users/@me/notification-settings")).body.length, 1);
  });
  it("stage: start, raise hand, invite to speak", async () => {
    const { g } = await serverWith(o, m);
    const stage = (await o.post(`/api/guilds/${g.id}/channels`, { name: "Town hall", type: 13 })).body;
    const og = await o.connect(), mg = await m.connect();
    og.send("voice_state", { channel_id: stage.id }); mg.send("voice_state", { channel_id: stage.id });
    await sleep(300);
    assert.equal((await m.post("/api/stage-instances", { channel_id: stage.id, topic: "Q&A" })).status, 403);
    assert.equal((await o.post("/api/stage-instances", { channel_id: stage.id, topic: "Q&A" })).status, 200);
    const hand = await m.patch(`/api/channels/${stage.id}/voice-states/@me`, { request_to_speak: true });
    assert.ok(hand.body.request_to_speak_at);
    assert.equal(hand.body.suppress, true);
    assert.equal((await m.patch(`/api/channels/${stage.id}/voice-states/@me`, { suppress: false })).status, 403);
    const up = await o.patch(`/api/channels/${stage.id}/voice-states/${m.user.id}`, { suppress: false });
    assert.equal(up.body.suppress, false);
  });
  it("announcements publish to following channels in other servers", async () => {
    const a = await serverWith(o, m);
    const news = (await o.post(`/api/guilds/${a.g.id}/channels`, { name: "news", type: 5 })).body;
    const b = await serverWith(m);
    assert.equal((await m.post(`/api/channels/${news.id}/followers`, { webhook_channel_id: b.text.id })).status, 200);
    const post = (await o.post(`/api/channels/${news.id}/messages`, { content: "v2 is out" })).body;
    const pub = await o.post(`/api/channels/${news.id}/messages/${post.id}/crosspost`);
    assert.equal(pub.body.flags & 1, 1);
    const there = (await m.get(`/api/channels/${b.text.id}/messages?limit=5`)).body;
    const copy = there.find((x: any) => x.content === "v2 is out");
    assert.ok(copy, "copy arrived");
    assert.equal(copy.source.channel_id, news.id);
  });
});
