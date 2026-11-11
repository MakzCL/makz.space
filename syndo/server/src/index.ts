import "./env-compat.ts"; // must stay first: maps old SYNDO_ settings to SEND_
import { BRAND } from "@send/shared";
import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { startJobs } from "./jobs.ts";
import { migrate } from "./migrate.ts";

if (process.env.SEND_AUTO_MIGRATE !== "0") await migrate();
const app = await buildApp({ logger: process.env.NODE_ENV === "production" });
await app.listen({ port: config.port, host: config.host });
startJobs();
console.log(`${BRAND.name} API listening on :${config.port} — media ${config.limits.media_enabled ? "enabled" : "NOT configured (set LIVEKIT_URL/KEY/SECRET)"}`);
