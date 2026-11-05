import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, startServer, stopServer } from "./helpers.ts";

const all: Client[] = [];
const client = (n: string) => { const c = new Client(n); all.push(c); return c; };
// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
/** A 50 ms, 8 kHz mono 16-bit WAV of silence. */
function wav() {
  const samples = 400, data = samples * 2, b = Buffer.alloc(44 + data);
  b.write("RIFF", 0); b.writeUInt32LE(36 + data, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write("data", 36); b.writeUInt32LE(data, 40);
  return b;
}
const file = (buf: Buffer, type: string, name: string) => { const fd = new FormData(); fd.append("file", new Blob([buf], { type }), name); return fd; };

before(async () => { await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

describe("Server expressions: emoji, soundboard, category banners", () => {
  const owner = client("emma"), member = client("milo");
  let guild: any, voice: any, emoji: any, sound: any;

  it("uploads custom emoji (MANAGE_EXPRESSIONS only) and serves them by id", async () => {
    await owner.register(); await member.register();
    guild = (await owner.post("/api/guilds", { name: "Emoji Club" })).body;
    const text = guild.channels.find((c: any) => c.type === 0);
    const inv = (await owner.post(`/api/channels/${text.id}/invites`, {})).body;
    assert.equal((await member.post(`/api/invites/${inv.code}`)).status, 200);

    assert.equal((await member.req("POST", `/api/guilds/${guild.id}/emojis?name=nope`, file(PNG, "image/png", "e.png"))).status, 403, "members can't upload by default");
    assert.equal((await owner.req("POST", `/api/guilds/${guild.id}/emojis?name=x`, file(PNG, "image/png", "e.png"))).status, 400, "name too short");
    const up = await owner.req("POST", `/api/guilds/${guild.id}/emojis?name=party_parrot`, file(PNG, "image/png", "e.png"));
    assert.equal(up.status, 200, JSON.stringify(up.body));
    emoji = up.body;
    assert.equal(emoji.name, "party_parrot");
    assert.equal(emoji.url, `/api/emojis/${emoji.id}`);
    assert.equal((await owner.req("POST", `/api/guilds/${guild.id}/emojis?name=party_parrot`, file(PNG, "image/png", "e.png"))).status, 400, "names are unique per server");

    const g = (await member.get(`/api/guilds/${guild.id}`)).body;
    assert.deepEqual(g.emojis.map((e: any) => e.name), ["party_parrot"], "members see the server's emoji");
    const r = await member.get(`/api/emojis/${emoji.id}`);
    assert.equal(r.status, 302);
    assert.match(r.headers.get("location") ?? "", /^\/api\/media\/emoji\/\d+\/\d+\.png$/);
    const img = await member.get(r.headers.get("location")!);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");
  });

  it("reacts with a custom emoji, renames and deletes it", async () => {
    const text = guild.channels.find((c: any) => c.type === 0);
    const msg = (await member.post(`/api/channels/${text.id}/messages`, { content: `hello <:party_parrot:${emoji.id}>` })).body;
    assert.equal((await member.put(`/api/channels/${text.id}/messages/${msg.id}/reactions/${encodeURIComponent(`party_parrot:${emoji.id}`)}/@me`)).status, 200);
    assert.equal((await owner.patch(`/api/guilds/${guild.id}/emojis/${emoji.id}`, { name: "parrot" })).body.name, "parrot");
    assert.equal((await owner.del(`/api/guilds/${guild.id}/emojis/${emoji.id}`)).status, 200);
    assert.equal((await member.get(`/api/emojis/${emoji.id}`)).status, 404);
  });

  it("uploads a sound and plays it only to people in the voice channel", async () => {
    voice = (await owner.post(`/api/guilds/${guild.id}/channels`, { name: "Hangout", type: 2 })).body;
    assert.equal((await owner.req("POST", `/api/guilds/${guild.id}/soundboard?name=Airhorn&emoji=📯&duration_ms=50&volume=0.7`, file(PNG, "audio/wav", "s.wav"))).status, 400, "content sniffing rejects non-audio");
    const up = await owner.req("POST", `/api/guilds/${guild.id}/soundboard?name=Airhorn&emoji=📯&duration_ms=50&volume=0.7`, file(wav(), "audio/wav", "s.wav"));
    assert.equal(up.status, 200, JSON.stringify(up.body));
    sound = up.body;
    assert.equal(sound.emoji, "📯");
    assert.match(sound.url, /^\/api\/media\/sounds\/\d+\/\d+\.wav$/);
    assert.equal((await member.get(sound.url)).headers.get("content-type"), "audio/wav");

    assert.equal((await member.post(`/api/channels/${voice.id}/soundboard`, { sound_id: sound.id })).status, 400, "must be in the channel");
    const og = await owner.connect(), mg = await member.connect();
    og.send("voice_state", { channel_id: voice.id }); mg.send("voice_state", { channel_id: voice.id });
    await og.next("VOICE_STATE_UPDATE", (d) => d.user_id === member.user.id && d.channel_id === voice.id);
    const heard = og.next("SOUNDBOARD_PLAY", (d) => d.sound.id === sound.id);
    const r = await member.post(`/api/channels/${voice.id}/soundboard`, { sound_id: sound.id });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ev = await heard;
    assert.equal(ev.user_id, member.user.id);
    assert.equal(ev.channel_id, voice.id);
    assert.equal((await member.post(`/api/channels/${voice.id}/soundboard`, { sound_id: sound.id })).status, 400, "rate limited");
    og.send("voice_state", { channel_id: null }); mg.send("voice_state", { channel_id: null });
  });

  it("sets and removes a category banner", async () => {
    const cat = (await owner.post(`/api/guilds/${guild.id}/channels`, { name: "Gaming", type: 4 })).body;
    assert.equal((await member.req("POST", `/api/channels/${cat.id}/banner`, file(PNG, "image/png", "b.png"))).status, 403);
    const up = await owner.req("POST", `/api/channels/${cat.id}/banner`, file(PNG, "image/png", "b.png"));
    assert.equal(up.status, 200, JSON.stringify(up.body));
    let g = (await member.get(`/api/guilds/${guild.id}`)).body;
    assert.match(g.channels.find((c: any) => c.id === cat.id).banner, /^\/api\/media\/channel-banners\//);
    assert.equal((await member.get(up.body.url)).status, 200);
    assert.equal((await owner.del(`/api/channels/${cat.id}/banner`)).status, 200);
    g = (await member.get(`/api/guilds/${guild.id}`)).body;
    assert.equal(g.channels.find((c: any) => c.id === cat.id).banner, null);
  });
});
