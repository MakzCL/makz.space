import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { config } from "./config.ts";

/**
 * Object storage. The default driver writes to a local directory (fine for a
 * single node; back it up with the database). An S3-compatible driver
 * (MinIO, R2, S3) is the documented path for multi-node deployments and is
 * tracked in FEATURE_MATRIX.md.
 */
const root = normalize(config.storageDir);
const full = (key: string) => {
  if (!/^[a-z0-9/_.-]+$/i.test(key) || key.includes("..")) throw new Error("bad storage key");
  return join(root, key);
};

export async function put(key: string, data: Readable | Buffer, maxBytes?: number): Promise<number> {
  const path = full(key);
  await mkdir(dirname(path), { recursive: true });
  if (Buffer.isBuffer(data)) {
    const ws = createWriteStream(path);
    await new Promise<void>((res, rej) => ws.end(data, () => res()).on("error", rej));
    return data.length;
  }
  let size = 0;
  try {
    await pipeline(data, async function* (src) {
      for await (const chunk of src) {
        size += (chunk as Buffer).length;
        if (maxBytes && size > maxBytes) throw Object.assign(new Error("too large"), { code: "too_large" });
        yield chunk;
      }
    }, createWriteStream(path));
  } catch (e) { await rm(path, { force: true }); throw e; }
  return size;
}

export const open = (key: string, range?: { start: number; end: number }) => createReadStream(full(key), range);
export const size = async (key: string) => (await stat(full(key))).size;
export const remove = (key: string) => rm(full(key), { force: true });
export const removePrefix = (prefix: string) => rm(full(prefix), { recursive: true, force: true });
