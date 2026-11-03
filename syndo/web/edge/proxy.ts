/**
 * Cloudflare Pages Functions: forward API and gateway traffic to the Syndo
 * server so the hosted web app is same-origin (cookies, WebSocket, CSRF
 * origin checks all behave exactly as on a single host).
 *
 * Pages project environment variable:  SYNDO_API_ORIGIN = https://api.example.com
 */
export interface Env { SYNDO_API_ORIGIN?: string }
interface Ctx { request: Request; env: Env }

export async function proxy({ request, env }: Ctx): Promise<Response> {
  const origin = (env.SYNDO_API_ORIGIN ?? "").replace(/\/$/, "");
  if (!/^https:\/\//.test(origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return new Response(JSON.stringify({ code: "not_configured", message: "This Syndo web app isn't connected to a server yet (SYNDO_API_ORIGIN is not set)." }), { status: 503, headers: { "content-type": "application/json" } });
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
