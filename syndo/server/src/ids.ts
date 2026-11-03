/** 64-bit time-ordered IDs: 42 bits ms since 2026-01-01, 10 bits worker, 12 bits sequence. */
const EPOCH = 1767225600000n;
const WORKER = BigInt(Number(process.env.SYNDO_WORKER_ID ?? 1) & 0x3ff);
let lastMs = 0n;
let seq = 0n;

export function newId(): string {
  let now = BigInt(Date.now());
  if (now === lastMs) {
    seq = (seq + 1n) & 0xfffn;
    if (seq === 0n) { while (BigInt(Date.now()) <= lastMs) { /* spin to next ms */ } now = BigInt(Date.now()); }
  } else seq = 0n;
  lastMs = now;
  return (((now - EPOCH) << 22n) | (WORKER << 12n) | seq).toString();
}

export const idTime = (id: string) => new Date(Number((BigInt(id) >> 22n) + EPOCH));
export const isId = (v: unknown): v is string => typeof v === "string" && /^\d{1,20}$/.test(v);
