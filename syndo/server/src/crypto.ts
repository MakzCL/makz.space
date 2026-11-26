import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** scrypt (N=32768, r=8, p=1), self-describing so parameters can be raised later. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw.normalize("NFKC"), salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) { await hashPassword(pw); return false; } // equalise timing for unknown accounts
  const [alg, N, r, p, salt, key] = stored.split("$");
  if (alg !== "scrypt") return false;
  const want = Buffer.from(key!, "base64");
  const got = await scrypt(pw.normalize("NFKC"), Buffer.from(salt!, "base64"), want.length, { N: +N!, r: +r!, p: +p!, maxmem: 128 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest();
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
export function randomCode(len = 8) {
  const b = randomBytes(len);
  return [...b].map((x) => ALNUM[x % ALNUM.length]).join("");
}
