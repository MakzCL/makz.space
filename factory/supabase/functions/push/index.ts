// Phone/desktop push for Skalarki Factory notifications.
//
// GET  → { publicKey } (the VAPID key pair is created on first use and kept in
//        public.push_keys, readable by the service role only).
// POST { id } → sends notification <id> to every device its owner subscribed.
//        Called by the database (pg_net) when a notification is created. It only
//        sends what is in the database, to its owner, once — so no secret needed.
// Deploy with JWT verification OFF.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, apikey", "content-type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });

async function keys() {
  const { data } = await sb.from("push_keys").select("public_key, private_key").eq("id", 1).maybeSingle();
  if (data) return data;
  const k = webpush.generateVAPIDKeys();
  await sb.from("push_keys").upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  const { data: again } = await sb.from("push_keys").select("public_key, private_key").eq("id", 1).single();
  return again!;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const k = await keys();
  if (req.method === "GET") return json(200, { publicKey: k.public_key });

  let id = "";
  try { id = (await req.json()).id; } catch { return json(400, { error: "bad body" }); }
  if (!/^[0-9a-f-]{36}$/.test(id)) return json(400, { error: "bad id" });

  // Claim it (only the first caller sends).
  const { data: n } = await sb.from("notifications").update({ pushed_at: new Date().toISOString() })
    .eq("id", id).is("pushed_at", null).select("id, user_id, kind, title, body, link").maybeSingle();
  if (!n) return json(200, { sent: 0, why: "already sent or missing" });

  const { data: who } = await sb.from("profiles").select("status").eq("id", n.user_id).single();
  if (who?.status === "dnd" && n.kind !== "call") return json(200, { sent: 0, why: "do not disturb" });

  const { data: subs } = await sb.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", n.user_id);
  webpush.setVapidDetails("https://factory.makz.space", k.public_key, k.private_key);
  const payload = JSON.stringify({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link });
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: n.kind === "call" ? 60 : 86400, urgency: n.kind === "call" || n.kind === "message" ? "high" : "normal" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // device unsubscribed
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return json(200, { sent });
});
