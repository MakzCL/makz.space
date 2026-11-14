# SEND — Operations

## Health and observability

| Signal | Where |
|---|---|
| API liveness + DB | `GET /api/health` |
| Instance limits / media enabled | `GET /api/instance` |
| Request logs | Fastify logger (on when `NODE_ENV=production`), JSON to stdout |
| Media quality per call | In-app diagnostics panel (users can screenshot it for support) |
| SFU metrics | LiveKit exposes Prometheus metrics (enable `prometheus_port` in `livekit.yaml`) |
| Email delivery | `mail_outbox.sent_at` / `error` columns |

Not built yet (tracked): server-side aggregation of client call-quality reports, Prometheus metrics from the API (gateway connections, dispatch latency, rate-limit hits), alerting.

## Backups

What to back up: the PostgreSQL database **and** the storage directory (attachments, avatars, icons). LiveKit is stateless.

```bash
docker compose exec -T db pg_dump -U syndo -Fc syndo > send-$(date +%F).dump
```

```bash
docker run --rm -v deploy_storage:/data -v "$PWD":/out alpine tar czf /out/send-files-$(date +%F).tgz -C /data .
```

Encrypt backups before they leave the host (e.g. `age` or `gpg`) and keep at least one copy off-site.

### Restore (tested for the database — see TEST_RESULTS.md)

```bash
docker compose stop send
```

```bash
docker compose exec -T db psql -U syndo -c 'drop database syndo' -c 'create database syndo'
```

```bash
docker compose exec -T db pg_restore -U syndo --no-owner -d syndo < send-YYYY-MM-DD.dump
```

```bash
docker run --rm -v deploy_storage:/data -v "$PWD":/in alpine sh -c 'cd /data && tar xzf /in/send-files-YYYY-MM-DD.tgz'
```

```bash
docker compose start send
```

Practise the restore into a separate database regularly; a backup that hasn't been restored isn't a backup.

## Routine maintenance (automatic)

Every 10 minutes the API removes uploads never attached to a message (>24 h), expired/revoked sessions (>30 days), old email tokens and outbox rows (>7 days), expired custom statuses, stale invites and finished jobs.

## Scaling limits (current, honest)

- **One API node** holds all gateway WebSockets; the hub is in-process. Needed for more: a pub/sub bus between nodes (Redis/Postgres NOTIFY) and sticky routing. Not built.
- **Member list** returns up to 1,000 members per request; bigger servers need lazy/virtualised member lists.
- **Search** uses PostgreSQL full-text search; fine for millions of messages on decent hardware, but a dedicated engine is needed beyond that.
- **Local file storage** ties uploads to one host; S3-compatible storage is needed for multiple nodes.
- **Load testing has not been done.** No concurrency figure is claimed.

## Capacity worksheet

Fill in your own inputs; every output below is derived from them. Media traffic dominates.

### Inputs

| Symbol | Meaning | Example |
|---|---|---|
| U | Peak concurrent connected users | 500 |
| V | Peak concurrent users in voice | 60 |
| Rv | Average room size (people per voice room) | 5 |
| Fa | Fraction of voice users speaking at once | 0.3 |
| Ba | Audio bitrate per speaking stream (kbps) | 96 |
| C | Concurrent cameras | 10 |
| Bc | Camera bitrate, top layer (kbps) | 1,700 |
| S | Concurrent screen shares | 4 |
| Bs | Screen share top-layer bitrate (kbps) | 6,000 |
| Ws | Average viewers per screen share | 6 |
| Wc | Average viewers per camera | 4 |
| T | Fraction of media users needing TURN relay | 0.15 |
| M | Messages per day | 50,000 |
| A | Attachment bytes per day | 2 GB |

### Derived

SFU **ingress** (kbps) ≈ `V·Fa·Ba + C·Bc·1.3 + S·Bs·1.3` (×1.3 for simulcast lower layers)
Example: 60·0.3·96 + 10·1700·1.3 + 4·6000·1.3 = 1,728 + 22,100 + 31,200 ≈ **55 Mbit/s**

SFU **egress** (kbps) ≈ `V·Fa·Ba·(Rv−1) + C·Bc·Wc + S·Bs·Ws` (upper bound: every viewer on the top layer)
Example: 1,728·4 + 10·1700·4 + 4·6000·6 = 6,912 + 68,000 + 144,000 ≈ **219 Mbit/s** peak

TURN adds roughly `T × (that user's ingress + egress)` on the TURN host (same host here): ≈ 0.15 × 274 ≈ **41 Mbit/s**.

Monthly media transfer ≈ `average egress (Mbit/s) × 0.33 TB per Mbit/s-month`. If the *average* is 25 % of peak: 219·0.25·0.33 ≈ **18 TB/month** egress. Price it with your provider's per-TB rate.

CPU: LiveKit forwards rather than transcodes; plan ~1 vCPU per 100–200 Mbit/s forwarded as a **starting assumption to verify with a load test**, not a measured figure.

Storage growth/day ≈ `A + M × ~1 KB` (messages + indexes) → example ≈ 2.05 GB/day ≈ 62 GB/month, before backups (×2–3 for retained backups).

API/gateway: ~50–100 KB RAM per WebSocket is a typical starting estimate → 500 users ≈ 50 MB; the database, not the API, is usually the first non-media bottleneck. Verify with a load test (scenario 20, not yet run).
