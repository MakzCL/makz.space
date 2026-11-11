/**
 * The app used to be called Syndo, so settings saved before the rename (Worker secrets, .env files,
 * docker-compose) can still use the old SYNDO_ prefix. Each one is copied to its SEND_ name unless that
 * is already set, so the rest of the server only reads SEND_. Imported first, before anything reads env.
 */
const LEGACY_PREFIX = "SYNDO_";
for (const [k, v] of Object.entries(process.env)) {
  if (!k.startsWith(LEGACY_PREFIX) || v === undefined) continue;
  const name = `SEND_${k.slice(LEGACY_PREFIX.length)}`;
  if (process.env[name] === undefined) process.env[name] = v;
}
export {};
