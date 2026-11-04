# SEND beta hosting

The web app and renamed preview APK are published on the existing Pages project.
The `send-beta-api` container is active with approval for Cloudflare hosting
charges. Public health, registration, cookie sessions, invites, two-account
realtime messaging, author permissions and private R2 uploads were verified.
Pages proxies the API and gateway through the same app origin.

The prepared architecture runs the existing Node/Fastify server in a Cloudflare
managed container, PostgreSQL in the separate `syndo-beta` Supabase project, and
uploads in the private `syndo-beta-uploads` R2 bucket. Data survives container
replacement. One backend process owns realtime fanout for this initial beta.

Set `DATABASE_URL` and `STORAGE_TOKEN` as Worker secrets. The PostgreSQL URL must
use `sslmode=verify-full` and
`sslrootcert=/app/syndo/server/certs/supabase-ca.crt`; the bundled public root CA
was obtained from Supabase's official certificate download. Use the restricted
`syndo_runtime` role with the private `syndo` schema, not a Supabase service key.
Migrations are applied separately; `SYNDO_AUTO_MIGRATE=0` prevents the restricted
runtime role from attempting schema changes.

`SOURCE_COMMIT` pins the server source. Update it to a tested repository commit
when deploying backend changes. Container startup installs locked production
dependencies and sleeps after an hour of inactivity. The first cold start may
be slow; the health endpoint returns 503 with Retry-After while starting.

Pages `SYNDO_API_ORIGIN` points to
`https://send-beta-api.kuklinskikarol04.workers.dev`.
The superseded `syndo-beta-api` container application remains pending explicit
cleanup approval; deleting it was blocked by automatic approval review.
Voice/video uses Cloudflare Realtime SFU (`SFU_APP_ID` / `SFU_APP_SECRET`); email delivery still requires SMTP.

Cloudflare pricing: https://developers.cloudflare.com/containers/platform/pricing/

## Placement (latency)

The Durable Object is created with `locationHint: "weur"` so the container runs
next to the Supabase database (eu-west-2, London). Without the hint it landed in
Los Angeles and every SQL query cost ~220 ms (a message send took ~3 s); in
Western Europe a query costs 10–25 ms. Check with `GET /api/health/latency`
(container colo, DB round trips, pool, TURN status). Every API response carries
a `Server-Timing` header with DB time and query count.

A hint only applies when a Durable Object is first created, so moving region
means changing the object name in `worker.ts` (currently `syndo-beta-weur-v3`).
The only state the object stores is the active source commit.

## Deploying backend changes safely

- Deploy with `wrangler deploy` from this folder, or a full script upload whose
  metadata includes `containers: [{ "class_name": "SENDBackend" }]`.
- Do **not** use the API shortcuts that create versions without the container
  declaration (`PUT …/secrets`, `PUT …/content`, `PATCH …/settings`). Durable
  Object instances that start while the link is missing keep running without a
  container ("Container not configured") until they are replaced.
- Bump `SOURCE_COMMIT` to the pushed commit; the object replaces the container
  on the next request (~10–60 s of 503 "starting").

## TURN relay for calls (recommended)

Without TURN, people on networks that block direct UDP (strict NAT, school or
office Wi-Fi, some mobile carriers) can't connect calls. The server already
supports Cloudflare TURN over TLS/443:

1. Cloudflare dashboard → Realtime → TURN Server → Create → copy the
   **Turn Token ID** and **API Token**.
2. In this folder: `npx wrangler secret put TURN_KEY_ID` and
   `npx wrangler secret put TURN_KEY_TOKEN` (or Workers → send-beta-api →
   Settings → Variables and Secrets), then redeploy.
3. `GET /api/health/latency` shows `turn.last: "ok (…)"` after the next call join.
