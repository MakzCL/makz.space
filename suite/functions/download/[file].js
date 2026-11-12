// Serves the SK Suite Windows zip as one download, streamed from the < 25 MiB parts written by
// scripts/build-download.mjs. Permanent address: /download/SK-Suite-win-x64.zip (latest version).
// /download/SK-Suite-win-x64.zip.sha256 gives the checksum; anything else under /download/ falls through to static files.
export async function onRequest({ request, params, env, waitUntil, next }) {
  const file = String(params.file ?? "");
  if (file !== "SK-Suite-win-x64.zip" && file !== "SK-Suite-win-x64.zip.sha256") return next();
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  const base = new URL(request.url); const m = await env.ASSETS.fetch(new URL("/download/parts/manifest.json", base));
  if (!m.ok) return new Response("The download is not available right now. Please try again later.", { status: 503 });
  const man = await m.json();
  if (file.endsWith(".sha256")) return new Response(`${man.sha256}  ${man.name}\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  const headers = { "content-type": "application/zip", "content-length": String(man.size), "content-disposition": `attachment; filename="${man.name}"`, "cache-control": "no-store", "x-sk-suite-version": man.version, "x-sk-suite-sha256": man.sha256 };
  if (request.method === "HEAD") return new Response(null, { headers });
  const { readable, writable } = new TransformStream();
  waitUntil((async () => {
    try { for (const p of man.parts) { const r = await env.ASSETS.fetch(new URL(`/download/parts/${p}`, base)); if (!r.ok || !r.body) throw new Error(`part ${p}: HTTP ${r.status}`); await r.body.pipeTo(writable, { preventClose: true }); } await writable.close(); }
    catch (e) { await writable.abort(e); }
  })());
  return new Response(readable, { headers });
}
