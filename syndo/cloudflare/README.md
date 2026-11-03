# SEND beta hosting

The web app and renamed preview APK are published on the existing Pages project.
The production API is not yet verified. Activating the prepared `send-beta-api`
container requires approval for Cloudflare's metered hosting charges.

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

After approval, activate the container and public Worker endpoint, verify health,
registration, two-account messaging, gateway reconnects and private uploads, then
point Pages `SYNDO_API_ORIGIN` to that verified endpoint and redeploy Pages.
Voice/video still requires LiveKit, and email delivery still requires SMTP.

Cloudflare pricing: https://developers.cloudflare.com/containers/platform/pricing/
