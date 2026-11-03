import { BRAND } from "@syndo/shared";
import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { startJobs } from "./jobs.ts";
import { migrate } from "./migrate.ts";

await migrate();
const app = await buildApp({ logger: process.env.NODE_ENV === "production" });
await app.listen({ port: config.port, host: config.host });
startJobs();
console.log(`${BRAND.name} API listening on :${config.port} — media ${config.limits.media_enabled ? "enabled" : "NOT configured (set LIVEKIT_URL/KEY/SECRET)"}`);
