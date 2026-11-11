import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Private R2 bridge. The credential is scoped to this app's upload bucket. */
export function remoteStorage(origin: string, token: string) {
  if (!origin.startsWith("https://") && !origin.startsWith("http://127.0.0.1:")) throw new Error("Storage requires HTTPS");
  if (!token) throw new Error("SEND_STORAGE_TOKEN is required");
  const keyPath = (key: string) => {
    if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes("..")) throw new Error("bad storage key");
    return key;
  };
  const request = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(`${origin.replace(/\/$/, "")}/__storage/${path}`, {
      ...init, headers, redirect: "error", signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error(`Storage returned ${response.status}`), { code: response.status === 404 ? "ENOENT" : "storage_unavailable" });
    }
    return response;
  };
  return {
    async put(key: string, data: Readable | Buffer, maxBytes?: number) {
      keyPath(key);
      let bytes = 0;
      const check = (n: number) => {
        bytes += n;
        if (maxBytes !== undefined && bytes > maxBytes) throw Object.assign(new Error("too large"), { code: "too_large" });
      };
      // Stage streams on ephemeral disk only until a durable R2 PUT succeeds.
      // This gives R2 an exact content length without buffering large files in RAM.
      const dir = await mkdtemp(join(tmpdir(), "send-upload-"));
      const file = join(dir, "body");
      try {
        if (Buffer.isBuffer(data)) {
          check(data.length);
          await pipeline(Readable.from([data]), createWriteStream(file));
        } else {
          await pipeline(data, async function* (source) {
            for await (const chunk of source) { check(Buffer.byteLength(chunk)); yield chunk; }
          }, createWriteStream(file));
        }
        const response = await request(key, {
          method: "PUT", headers: { "content-length": String(bytes) },
          body: createReadStream(file), duplex: "half",
        } as RequestInit);
        await response.body?.cancel();
        return bytes;
      } finally { await rm(dir, { recursive: true, force: true }); }
    },
    open(key: string, range?: { start: number; end: number }) {
      keyPath(key);
      return Readable.from((async function* () {
        const response = await request(key, { headers: range ? { range: `bytes=${range.start}-${range.end}` } : {} });
        if (!response.body) throw new Error("Storage response has no body");
        for await (const chunk of response.body) yield chunk;
      })());
    },
    async size(key: string) {
      const response = await request(keyPath(key), { method: "HEAD" });
      const n = Number(response.headers.get("content-length"));
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid storage size");
      return n;
    },
    async remove(key: string) { const r = await request(keyPath(key), { method: "DELETE" }); await r.body?.cancel(); },
    async removePrefix(prefix: string) {
      const r = await request(`?prefix=${encodeURIComponent(keyPath(prefix).replace(/\/$/, "") + "/")}`, { method: "DELETE" });
      await r.body?.cancel();
    },
  };
}
