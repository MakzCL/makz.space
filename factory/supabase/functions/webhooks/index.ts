// Kortana webhook sender (INT-07).
//
// Called by the database (pg_net) when an event is queued, and every minute by pg_cron for
// retries. It claims due deliveries, POSTs each event as JSON and records the result.
// Every request is signed so receivers can trust it:
//   X-Kortana-Timestamp: unix seconds
//   X-Kortana-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the webhook's secret>
//   X-Kortana-Event / X-Kortana-Delivery: event type / delivery id (use it to ignore repeats)
// Failed deliveries are retried after 1, 5, 30, 120 and 720 minutes, then given up.
// It only sends what is already queued in the database, so it needs no secret of its own.
// Deploy with JWT verification OFF.
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const enc = new TextEncoder();

async function sign(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Job { id: number; attempt: number; url: string; secret: string; event: { id: number; type: string; created_at: string; data: unknown } }

async function send(j: Job) {
  const body = JSON.stringify({ id: j.event.id, type: j.event.type, created_at: j.event.created_at, data: j.event.data });
  const ts = Math.floor(Date.now() / 1000).toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  let code = 0, err: string | null = null;
  try {
    const r = await fetch(j.url, {
      method: "POST", body, signal: ctl.signal, redirect: "manual",
      headers: { "content-type": "application/json", "user-agent": "Kortana-Webhooks/1.0", "x-kortana-event": j.event.type,
        "x-kortana-delivery": String(j.id), "x-kortana-timestamp": ts, "x-kortana-signature": `sha256=${await sign(j.secret, `${ts}.${body}`)}` },
    });
    code = r.status;
    if (code < 200 || code > 299) err = (await r.text().catch(() => "")).slice(0, 300) || `HTTP ${code}`;
  } catch (e) {
    err = e instanceof Error ? e.message : "request failed";
  } finally { clearTimeout(timer); }
  await sb.rpc("finish_webhook_delivery", { p_id: j.id, p_code: code, p_error: err });
  return code >= 200 && code < 300;
}

Deno.serve(async () => {
  const until = Date.now() + 20_000;
  let sent = 0, failed = 0;
  while (Date.now() < until) {
    const { data, error } = await sb.rpc("claim_webhook_deliveries", { p_limit: 25 });
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    const jobs = (data ?? []) as Job[];
    if (!jobs.length) break;
    const ok = await Promise.all(jobs.map(send));
    sent += ok.filter(Boolean).length; failed += ok.filter((x) => !x).length;
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { "content-type": "application/json" } });
});
