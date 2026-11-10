import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Client, ORIGIN, startServer, stopServer } from "./helpers.ts";

let base = "";
const all: Client[] = [];
before(async () => { base = await startServer(); });
after(async () => { all.forEach((c) => c.close()); await stopServer(); });

const raw = (c: Client, method: string, path: string, body?: Buffer | string) =>
  fetch(base + path, { method, headers: { origin: ORIGIN, cookie: c.cookie, "content-type": typeof body === "string" ? "application/json" : "application/octet-stream" }, body });

describe("Big attachments in pieces", () => {
  const a = new Client("bigup"); all.push(a);
  it("uploads a 70 MB file in three pieces, checks the ticket, and attaches it", async () => {
    await a.register();
    const g = (await a.post("/api/guilds", { name: "Big files" })).body;
    const text = g.channels.find((c: any) => c.type === 0);
    const size = 70 * 1024 * 1024;
    const file = Buffer.alloc(size, 7);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]).copy(file);

    assert.equal((await a.post(`/api/channels/${text.id}/attachments/large`, { size: 600 * 1024 * 1024 })).status, 413, "over the limit");
    const t = await a.post(`/api/channels/${text.id}/attachments/large`, { size });
    assert.equal(t.status, 200);
    const { ticket, part_size, endpoint } = t.body;
    const qs = (extra: Record<string, string> = {}) => new URLSearchParams({ key: ticket.key, size: String(ticket.size), exp: String(ticket.exp), sig: ticket.sig, ...extra }).toString();

    const forged = new URLSearchParams({ key: ticket.key, size: String(size + 1), exp: String(ticket.exp), sig: ticket.sig }).toString();
    assert.equal((await raw(a, "POST", `${endpoint}/start?${forged}`)).status, 403, "ticket is bound to the size");

    const start = await (await raw(a, "POST", `${endpoint}/start?${qs()}`)).json() as any;
    assert.match(start.upload_id, /^[a-f0-9]{32}$/);
    assert.equal(start.part_size, part_size);
    const count = Math.ceil(size / part_size);
    assert.equal(count, 3);
    assert.equal((await raw(a, "PUT", `${endpoint}/part?${qs({ upload_id: start.upload_id, part: "1" })}`, file.subarray(0, 1000))).status, 400, "wrong-size piece");
    const parts = [];
    for (let n = 1; n <= count; n++) {
      const r = await raw(a, "PUT", `${endpoint}/part?${qs({ upload_id: start.upload_id, part: String(n) })}`, file.subarray((n - 1) * part_size, Math.min(size, n * part_size)));
      assert.equal(r.status, 200, `piece ${n}`);
      parts.push(await r.json());
    }
    const done = await raw(a, "POST", `${endpoint}/complete?${qs({ upload_id: start.upload_id })}`, JSON.stringify({ parts }));
    assert.equal(done.status, 200);

    const fin = await a.post(`/api/channels/${text.id}/attachments/large/finish`, { ticket, filename: "huge.png" });
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    assert.equal(fin.body.size, size);
    assert.equal(fin.body.content_type, "image/png", "type comes from the bytes");
    assert.equal((await a.post(`/api/channels/${text.id}/attachments/large/finish`, { ticket, filename: "again.png" })).status, 400, "a ticket works once");

    const m = await a.post(`/api/channels/${text.id}/messages`, { content: "big one", attachment_ids: [fin.body.id] });
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.equal(m.body.attachments[0].size, size);
    const dl = await fetch(base + m.body.attachments[0].url, { headers: { cookie: a.cookie } });
    assert.equal(dl.status, 200);
    assert.equal((await dl.arrayBuffer()).byteLength, size);
  });
});
