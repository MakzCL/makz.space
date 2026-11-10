import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, startServer, stopServer } from "./helpers.ts";

// Saved 7TV/BTTV responses instead of the network.
process.env.SYNDO_EMOTE_FIXTURES = new URL("./fixtures/emotes", import.meta.url).pathname;
const all: Client[] = [];
before(async () => { await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

describe("7TV and BTTV emotes", () => {
  const a = new Client("emo_a"), b = new Client("emo_b"); all.push(a, b);
  it("offers the global sets, links a channel's set and lets a server turn them off", async () => {
    await a.register(); await b.register();
    const g = (await a.get("/api/emotes/global")).body.emotes;
    assert.ok(g.some((e: any) => e.provider === "7tv" && e.name === "RainTime"), "7TV globals");
    assert.ok(g.some((e: any) => e.provider === "bttv" && e.name === "GabeN"), "BTTV globals");
    assert.ok(!g.some((e: any) => e.name === ":tf:"), "names that can't be typed as :name: are left out");

    const guild = (await a.post("/api/guilds", { name: "Emotes" })).body;
    const text = guild.channels.find((c: any) => c.type === 0);
    const inv = (await a.post(`/api/channels/${text.id}/invites`, {})).body;
    await b.post(`/api/invites/${inv.code}`);
    assert.deepEqual((await b.get(`/api/guilds/${guild.id}/emotes`)).body.emotes, [], "nothing linked yet");

    assert.equal((await b.patch(`/api/guilds/${guild.id}/emotes`, { source: "71092938" })).status, 403, "needs Manage Expressions");
    assert.equal((await a.patch(`/api/guilds/${guild.id}/emotes`, { source: "not a link" })).status, 400);
    const linked = await a.patch(`/api/guilds/${guild.id}/emotes`, { source: "https://7tv.app/users/01FE9DRF000009TR6M9N941CYW" });
    assert.equal(linked.status, 200, JSON.stringify(linked.body));
    assert.equal(linked.body.settings.twitch_id, "71092938", "the Twitch account comes from the 7TV profile");
    assert.ok(linked.body.emotes.some((e: any) => e.provider === "7tv") && linked.body.emotes.some((e: any) => e.provider === "bttv"), "7TV and BTTV channel emotes");
    assert.ok((await b.get(`/api/guilds/${guild.id}/emotes`)).body.emotes.length > 0, "members see the linked set");

    const byId = await a.patch(`/api/guilds/${guild.id}/emotes`, { source: "71092938" });
    assert.equal(byId.body.settings.seventv_set, "01FE9DRF000009TR6M9N941CYW", "a Twitch ID works too");

    const off = await a.patch(`/api/guilds/${guild.id}/emotes`, { enabled: false });
    assert.equal(off.body.settings.enabled, false);
    assert.deepEqual((await b.get(`/api/guilds/${guild.id}/emotes`)).body, { settings: off.body.settings, emotes: [] });

    const m = await a.post(`/api/channels/${text.id}/messages`, { content: "<7tv:RainTime:01FCY771D800007PQ2DF3GDTN6> nice" });
    assert.equal(m.status, 200);
    assert.equal(m.body.content, "<7tv:RainTime:01FCY771D800007PQ2DF3GDTN6> nice", "messages keep the emote reference");
    assert.equal((await a.get("/api/emotes/img/7tv/../../etc")).status, 404);
  });
});
