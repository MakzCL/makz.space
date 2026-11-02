/**
 * Crash reporting: errors are saved to public.client_errors so they can be
 * read and fixed. Plain fetch (no app state needed), max a few per page load.
 */
const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const sent = new Set<string>();

function session(): { token: string | null; user: string | null } {
  try {
    const k = Object.keys(localStorage).find((x) => /^sb-.*-auth-token$/.test(x));
    const s = k ? JSON.parse(localStorage.getItem(k) ?? "null") : null;
    return { token: s?.access_token ?? null, user: s?.user?.id ?? null };
  } catch { return { token: null, user: null }; }
}

export function reportError(err: unknown, where = "") {
  try {
    if (!URL_ || !KEY) return;
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const sig = `${where}|${e.message}`;
    if (sent.has(sig) || sent.size >= 8) return;
    sent.add(sig);
    const { token, user } = session();
    fetch(`${URL_}/rest/v1/client_errors`, {
      method: "POST",
      headers: { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: token ? user : null, message: e.message.slice(0, 500), stack: (e.stack ?? "").slice(0, 4000),
        place: where.slice(0, 200), url: location.pathname + location.search, user_agent: navigator.userAgent.slice(0, 300),
        app_version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "",
      }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* never let reporting crash the app */ }
}

export function installGlobalHandlers() {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message, "window.error"));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason, "unhandledrejection"));
}
