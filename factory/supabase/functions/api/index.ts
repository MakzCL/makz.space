// Kortana REST API (INT-06/08/09) — for Zapier/Make, a website, or your own scripts.
//
// Auth:   Authorization: Bearer kt_…   (or X-API-Key: kt_…). Keys are made in Kortana →
//         Settings → Integrations; only a hash is stored. Keys have "read" and/or "write".
// Routes: GET  /items[?sku=&updated_since=&limit=&offset=]   GET /items/{sku}
//         GET  /stock[?sku=&location=]                       GET /locations
//         GET  /orders[?status=open|done|cancelled&since=]   GET /orders/{number}
//         POST /orders  {customer, company?, email?, phone?, ship_to?, shipping_method?, currency?,
//                        delivery_deadline?, reference?, lines:[{sku, quantity, unit_price?}]}   (write)
//         GET  /purchase-orders[?status=]                    GET /manufacturing-orders[?status=]
// Costs, margins and stock value are never returned.
// Deploy with JWT verification OFF (callers use API keys, not Supabase logins).
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-api-key, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "content-type": "application/json" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
const fail = (status: number, error: string) => json(status, { error });

const ITEM = "id, sku, name, kind, category, unit, quantity, min_quantity, sale_price, barcode, tracking, lead_days, archived, updated_at";
const ORDER = "id, order_number, customer, company, email, ship_to, shipping_method, status, delivery, tracking, currency, source, ordered_at, delivery_deadline, shipped_at, delivered_at, created_at";
const LINE = "sku, name, quantity, shipped, returned, unit_price";

function page(u: URL) {
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") ?? 100) || 100, 1), 500);
  const offset = Math.max(Number(u.searchParams.get("offset") ?? 0) || 0, 0);
  return { limit, offset, to: offset + limit - 1 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "") || req.headers.get("x-api-key") || "";
  if (!key.startsWith("kt_")) return fail(401, "Missing API key (Authorization: Bearer kt_…)");
  const { data: scopes, error: kerr } = await sb.rpc("verify_api_key", { p_key: key });
  if (kerr) return fail(500, "Key check failed");
  if (!scopes) return fail(401, "Invalid or revoked API key");
  const can = (s: string) => (scopes as string[]).includes(s);

  const u = new URL(req.url);
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.indexOf("api");
  const [res, id] = parts.slice(at + 1).map(decodeURIComponent);
  const p = page(u);

  try {
    if (req.method === "GET") {
      if (!can("read")) return fail(403, "This key cannot read");
      if (res === "items") {
        let q = sb.from("stock_items").select(ITEM, { count: "exact" }).order("sku");
        if (id) { const { data } = await q.eq("sku", id).maybeSingle(); return data ? json(200, { data }) : fail(404, "No item with that SKU"); }
        if (u.searchParams.get("sku")) q = q.eq("sku", u.searchParams.get("sku")!);
        if (u.searchParams.get("updated_since")) q = q.gte("updated_at", u.searchParams.get("updated_since")!);
        const { data, count, error } = await q.range(p.offset, p.to);
        if (error) throw error;
        return json(200, { data, count, limit: p.limit, offset: p.offset });
      }
      if (res === "locations") {
        const { data, error } = await sb.from("locations").select("id, name, kind, is_default, archived").not("kind", "in", "(transit,wip)").order("name");
        if (error) throw error;
        return json(200, { data });
      }
      if (res === "stock") {
        let q = sb.from("stock_levels").select("quantity, bin, location:locations!inner(id, name, kind), item:stock_items!inner(sku, name, unit)").neq("quantity", 0);
        if (u.searchParams.get("sku")) q = q.eq("item.sku", u.searchParams.get("sku")!);
        if (u.searchParams.get("location")) q = q.eq("location.name", u.searchParams.get("location")!);
        const { data, error } = await q.range(p.offset, p.to);
        if (error) throw error;
        return json(200, { data, limit: p.limit, offset: p.offset });
      }
      if (res === "orders") {
        let q = sb.from("orders").select(`${ORDER}, lines:order_lines(${LINE})`, { count: "exact" }).eq("kind", "order").order("created_at", { ascending: false });
        if (id) { const { data } = await q.eq("order_number", id).maybeSingle(); return data ? json(200, { data }) : fail(404, "No order with that number"); }
        if (u.searchParams.get("status")) q = q.eq("status", u.searchParams.get("status")!);
        if (u.searchParams.get("since")) q = q.gte("created_at", u.searchParams.get("since")!);
        const { data, count, error } = await q.range(p.offset, p.to);
        if (error) throw error;
        return json(200, { data, count, limit: p.limit, offset: p.offset });
      }
      if (res === "purchase-orders") {
        let q = sb.from("purchase_orders").select("id, number, status, kind, expected_date, ordered_at, received_at, supplier:suppliers(name), lines:po_lines(quantity, received, item:stock_items(sku, name))", { count: "exact" }).order("created_at", { ascending: false });
        if (u.searchParams.get("status")) q = q.eq("status", u.searchParams.get("status")!);
        const { data, count, error } = await q.range(p.offset, p.to);
        if (error) throw error;
        return json(200, { data, count, limit: p.limit, offset: p.offset });
      }
      if (res === "manufacturing-orders") {
        let q = sb.from("jobs").select("id, code, title, sku, quantity, produced, status, due_date, completed_at, created_at", { count: "exact" }).not("sku", "is", null).order("created_at", { ascending: false });
        if (u.searchParams.get("status")) q = q.eq("status", u.searchParams.get("status")!);
        const { data, count, error } = await q.range(p.offset, p.to);
        if (error) throw error;
        return json(200, { data, count, limit: p.limit, offset: p.offset });
      }
      return fail(404, "Unknown resource. Try /items, /stock, /locations, /orders, /purchase-orders, /manufacturing-orders");
    }
    if (req.method === "POST" && res === "orders") {
      if (!can("write")) return fail(403, "This key cannot write");
      let body: unknown;
      try { body = await req.json(); } catch { return fail(400, "Body must be JSON"); }
      const { data, error } = await sb.rpc("api_create_order", { p: body });
      if (error) return fail(422, error.message);
      return json((data as { duplicate?: boolean }).duplicate ? 200 : 201, { data });
    }
    return fail(405, "Method not allowed");
  } catch (e) {
    return fail(500, e instanceof Error ? e.message : "Something went wrong");
  }
});
