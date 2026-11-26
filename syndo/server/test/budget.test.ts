import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, Client } from "./helpers.ts";
import { config } from "../src/config.ts";
import { budget, checkBudget, levelFor } from "../src/budget.ts";
import { closeSfuUser, iceServers, sfuPeers } from "../src/sfu.ts";
before(startServer); after(stopServer);

test("budget levels: free allowance, then the hard stop before the budget", () => {
  assert.equal(levelFor(10, 1000, 1070), "ok");
  assert.equal(levelFor(1000, 1000, 1070), "soft");
  assert.equal(levelFor(1069.9, 1000, 1070), "soft");
  assert.equal(levelFor(1070, 1000, 1070), "hard");
  // $5 a month: 1,000 free GB + 100 paid GB, minus the 30 GB margin.
  assert.equal(budget.hard_gb, 1070);
});

test("past the free allowance new calls connect directly; at the hard stop calls move and the relay pauses", async () => {
  const a = await new Client("budgetana").register(), b = await new Client("budgetben").register();
  await a.post("/api/users/@me/relationships", { username: b.user.username }); await b.put(`/api/users/@me/relationships/${a.user.id}`, { type: 1 });
  const dm = (await a.post("/api/users/@me/channels", { recipient_id: b.user.id })).body;
  const original = globalThis.fetch, prevSfu = { ...config.sfu }, prevBudget = { ...budget };
  let usedBytes = 5e9, next = 0;
  config.sfu.appId = "test-app"; config.sfu.secret = "test-secret"; config.sfu.turnKeyId = "k"; config.sfu.turnKeyToken = "t";
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    if (url === "https://api.cloudflare.com/client/v4/graphql") return Response.json({ data: { viewer: { accounts: [{ sfu: [{ sum: { egressBytes: usedBytes } }], turn: [{ sum: { egressBytes: 0 } }] }] } }, errors: null });
    if (url.includes("/turn/keys/")) return Response.json({ iceServers: [{ urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" }] });
    if (url.startsWith("https://rtc.live.cloudflare.com/")) return Response.json(url.endsWith("/sessions/new") ? { sessionId: "budget-session-" + (++next) } : {});
    return original(input, init);
  }) as typeof fetch;
  try {
    budget.configured = true;
    await checkBudget();
    assert.equal(budget.level, "ok");
    const first = await a.post("/api/voice/token", { channel_id: dm.id });
    assert.equal(first.body.provider, "cloudflare", "under the free allowance the call server is used as before");
    assert.ok(sfuPeers.has(first.body.session));

    usedBytes = 1010e9; await checkBudget();
    assert.equal(budget.level, "soft");
    const capped = await b.post("/api/voice/token", { channel_id: dm.id });
    assert.equal(capped.body.provider, "mesh", "past the free allowance: direct connection");
    assert.ok(capped.body.ice_servers.some((s: any) => JSON.stringify(s.urls).includes("turn:")), "relay still handed out");
    assert.ok(sfuPeers.has(first.body.session), "calls already on the call server continue until the hard stop");

    usedBytes = 1075e9; await checkBudget();
    assert.equal(budget.level, "hard");
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(sfuPeers.has(first.body.session), false, "running calls are moved off the call server");
    const ice = await iceServers();
    assert.ok(!JSON.stringify(ice).includes("turn:"), "relay paused at the hard stop");

    // Analytics unavailable for over an hour: the call server stays closed (fail closed).
    usedBytes = 5e9; await checkBudget(); assert.equal(budget.level, "ok");
    budget.checked_at = Date.now() - 2 * 3600_000;
    globalThis.fetch = (async () => new Response("down", { status: 502 })) as typeof fetch;
    await checkBudget();
    assert.equal(budget.level, "soft");
  } finally {
    globalThis.fetch = original; Object.assign(config.sfu, prevSfu); Object.assign(budget, prevBudget);
    await closeSfuUser(dm.id, a.user.id).catch(() => {});
  }
});
