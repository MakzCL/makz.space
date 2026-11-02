// Shopify "Order creation" webhook → Skalarki Factory jobs.
//
// Shopify signs every webhook with the store's webhook secret (HMAC-SHA256 of
// the raw body, base64, in X-Shopify-Hmac-Sha256). Unsigned or wrongly signed
// requests are rejected. The order is handed to ingest_shopify_order(), which
// creates the order and one job per line item at the first station of the
// product's route. Re-delivered webhooks never create duplicates.
//
// Secrets: SHOPIFY_WEBHOOK_SECRET (from Shopify → Settings → Notifications → Webhooks).
// Deploy with JWT verification OFF (Shopify cannot send a Supabase token).
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();

async function sign(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin);
}

function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const reply = (status: number, msg: string) => new Response(JSON.stringify({ ok: status < 300, msg }), {
  status, headers: { "content-type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(200, "Skalarki Factory Shopify webhook");
  const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET");
  if (!secret) return reply(503, "SHOPIFY_WEBHOOK_SECRET is not set");

  const body = await req.text();
  const given = req.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!given || !same(await sign(secret, body), given)) return reply(401, "bad signature");

  const topic = req.headers.get("x-shopify-topic") ?? "orders/create";
  if (!["orders/create", "orders/paid"].includes(topic)) return reply(200, `ignored ${topic}`);

  let order: unknown;
  try { order = JSON.parse(body); } catch { return reply(400, "bad json"); }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb.rpc("ingest_shopify_order", { o: order });
  if (error) {
    console.error("ingest failed", error);
    return reply(500, error.message); // Shopify retries failed deliveries
  }
  return reply(200, `${data} job(s) created`);
});
