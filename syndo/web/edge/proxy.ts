/**
 * Cloudflare Pages Functions: forward API and gateway traffic to the SEND
 * server so the hosted web app is same-origin (cookies, WebSocket, CSRF
 * origin checks all behave exactly as on a single host).
 *
 * Pages project environment variable:  SEND_API_ORIGIN = https://api.example.com
 */
/** SYNDO_API_ORIGIN is the name used before the rename; projects that still have it keep working. */
export interface Env { SEND_API_ORIGIN?: string; SYNDO_API_ORIGIN?: string }
interface Ctx { request: Request; env: Env }

export async function proxy({ request, env }: Ctx): Promise<Response> {
  const origin = (env.SEND_API_ORIGIN ?? env.SYNDO_API_ORIGIN ?? "").replace(/\/$/, "");
  if (!/^https:\/\//.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return new Response(JSON.stringify({ code: "not_configured", message: "This SEND web app isn't connected to a server yet (SEND_API_ORIGIN is not set)." }), { status: 503, headers: { "content-type": "application/json" } });
  }
  const url = new URL(request.url);
  const target = origin + url.pathname + url.search;
  const headers = new Headers(request.headers);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) headers.set("x-forwarded-for", ip);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-host", url.host);
  // WebSocket upgrades are passed through as-is (Workers proxy the 101 response).
  return fetch(target, { method: request.method, headers, body: request.body, redirect: "manual" } as RequestInit);
}
