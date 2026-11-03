import { Copy, KeyRound, Pause, Play, Plus, RefreshCw, Send, Trash2, Webhook } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import { Badge, Btn, Chip, Field } from "../components/ui";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import { dayLabel } from "../lib/time";

/* Phase 6c — Settings → Integrations (INT-06..09). Owner/Developer only; everything goes through
 * owner-only database functions, so key hashes and webhook secrets never reach the app. */

interface Key { id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null; created_by: string | null }
interface Hook { id: string; url: string; events: string[]; active: boolean; note: string; failures: number; last_status: number | null; last_delivery_at: string | null }
interface Delivery { id: number; webhook_id: string; type: string; status: string; attempts: number; code: number | null; error: string | null; next_at: string; created_at: string }
interface State { keys: Key[]; webhooks: Hook[]; deliveries: Delivery[]; events: string[] }

const API_BASE = "https://duuvhofvfdnlkcewdtuf.supabase.co/functions/v1/api";
const EVENT_LABEL: Record<string, string> = { "order.created": "New sales order", "order.shipped": "Order shipped", "po.received": "Purchase order received",
  "mo.completed": "Manufacturing order finished", "stock.low": "Stock at or below reorder point", "test.ping": "Test ping" };

function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const toast = useToast();
  return (
    <div className="card flat stack int-secret">
      <b>{label}</b>
      <code className="int-code">{value}</code>
      <small className="red-t">{t("Copy it now — it will not be shown again.")}</small>
      <div className="row gap">
        <Btn tone="primary" icon={<Copy size={15} />} onClick={async () => { try { await navigator.clipboard.writeText(value); toast(t("Copied"), "ok"); } catch { toast(t("Copy it by hand"), "info"); } }}>{t("Copy")}</Btn>
        <Btn tone="ghost" onClick={onDone}>{t("I've saved it")}</Btn>
      </div>
    </div>
  );
}

export function Integrations() {
  const { backend: B } = useStore();
  const toast = useToast();
  const [s, setS] = useState<State | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const [kName, setKName] = useState("");
  const [kWrite, setKWrite] = useState(false);
  const [hUrl, setHUrl] = useState("");
  const [hEvents, setHEvents] = useState<string[]>(["order.created", "order.shipped"]);
  const [hNote, setHNote] = useState("");
  const load = useCallback(() => { B.rpc<State>("integrations_state", {}).then(setS).catch((e) => setErr(e instanceof Error ? t(e.message) : String(e))); }, [B]);
  useEffect(() => { load(); }, [load]);
  const run = async (what: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(what); setErr("");
    try { const r = await fn(); load(); if (ok) toast(ok, "ok"); return r; } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); return null; } finally { setBusy(""); }
  };
  if (!s) return <div className="stack">{err ? <p className="hint red-t">{err}</p> : <p className="muted">{t("Loading…")}</p>}</div>;
  const hookName = (id: string) => s.webhooks.find((h) => h.id === id)?.url.replace(/^https:\/\//, "") ?? "";
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <p className="muted">{t("Connect Kortana to other tools: an API key lets a program read stock, orders and production (and create orders); a webhook tells another system the moment something happens. Works with Zapier, Make, n8n or your own code.")}</p>
      {err && <p className="hint red-t">{err}</p>}
      {shown && <Secret label={shown.label} value={shown.value} onDone={() => setShown(null)} />}

      <section className="card stack">
        <div className="row between"><b className="row gap-s"><KeyRound size={17} />{t("API keys")}</b><small className="muted">{API_BASE}</small></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>{t("Name")}</th><th>{t("Key")}</th><th>{t("Can")}</th><th>{t("Last used")}</th><th /></tr></thead>
          <tbody>
            {s.keys.map((k) => (
              <tr key={k.id} className={`static ${k.revoked_at ? "dim" : ""}`}>
                <td><b>{k.name}</b><br /><small className="muted">{dayLabel(k.created_at)}{k.created_by ? ` · ${k.created_by}` : ""}</small></td>
                <td><span className="code">{k.prefix}…</span></td>
                <td>{k.scopes.map((x) => <Badge key={x} tone={x === "write" ? "moon" : "blue"}>{t(x === "write" ? "Read & write" : "Read")}</Badge>).slice(-1)}</td>
                <td className="muted">{k.revoked_at ? t("Revoked {d}", { d: dayLabel(k.revoked_at) }) : k.last_used_at ? dayLabel(k.last_used_at) : t("Never")}</td>
                <td>{!k.revoked_at && <Btn small tone="ghost" disabled={!!busy} onClick={() => window.confirm(t("Revoke {name}? Anything using it stops working straight away.", { name: k.name })) && run("rev" + k.id, () => B.rpc("revoke_api_key", { p_id: k.id }), t("Key revoked"))}>{t("Revoke")}</Btn>}</td>
              </tr>))}
            {!s.keys.length && <tr className="static"><td colSpan={5} className="muted">{t("No API keys yet.")}</td></tr>}
          </tbody>
        </table></div>
        <div className="row gap wrap">
          <Field label={t("New key — what is it for?")}><input value={kName} onChange={(e) => setKName(e.target.value)} placeholder={t("e.g. Zapier, website stock feed")} /></Field>
          <label className="row gap-s fine k-check"><input type="checkbox" checked={kWrite} onChange={(e) => setKWrite(e.target.checked)} />{t("Allow creating orders")}</label>
          <Btn tone="primary" icon={<Plus size={16} />} busy={busy === "key"} disabled={!kName.trim() || !!busy} onClick={async () => {
            const r = await run("key", () => B.rpc<{ key: string }>("create_api_key", { p_name: kName.trim(), p_scopes: kWrite ? ["read", "write"] : ["read"] }));
            if (r) { setShown({ label: t("API key for {name}", { name: kName.trim() }), value: (r as { key: string }).key }); setKName(""); setKWrite(false); }
          }}>{t("Create key")}</Btn>
        </div>
        <details className="fine int-docs"><summary>{t("How to use the API")}</summary>
          <pre className="int-code">{`curl -H "Authorization: Bearer kt_…" ${API_BASE}/items?limit=50
curl -H "Authorization: Bearer kt_…" ${API_BASE}/stock?sku=032X-2301.A
curl -H "Authorization: Bearer kt_…" ${API_BASE}/orders?status=open
curl -X POST -H "Authorization: Bearer kt_…" -H "Content-Type: application/json" \\
  -d '{"customer":"Avia Sim","reference":"web-1001","lines":[{"sku":"032X-2301.A","quantity":1}]}' ${API_BASE}/orders`}</pre>
          <p>{t("Also: /items/{sku}, /locations, /orders/{number}, /purchase-orders, /manufacturing-orders. Lists take limit (max 500) and offset. Costs and margins are never returned. Sending the same reference twice does not create a second order.")}</p>
        </details>
      </section>

      <section className="card stack">
        <b className="row gap-s"><Webhook size={17} />{t("Webhooks")}</b>
        {s.webhooks.map((h) => (
          <div key={h.id} className="card flat stack">
            <div className="row between wrap gap-s">
              <span className="row gap-s"><span className="code">{h.url}</span>{h.active ? <Badge tone="ok">{t("On")}</Badge> : <Badge tone="muted">{t("Paused")}</Badge>}
                {h.last_status !== null && <Badge tone={h.last_status >= 200 && h.last_status < 300 ? "ok" : "red"}>{h.last_status || t("no answer")}</Badge>}</span>
              <span className="row gap-s">
                <Btn small tone="soft" icon={<Send size={14} />} disabled={!!busy || !h.active} onClick={() => run("test" + h.id, () => B.rpc("test_webhook", { p_id: h.id }), t("Test ping queued"))}>{t("Test")}</Btn>
                <Btn small tone="ghost" icon={h.active ? <Pause size={14} /> : <Play size={14} />} disabled={!!busy} onClick={() => run("act" + h.id, () => B.rpc("set_webhook", { p_id: h.id, p_active: !h.active, p_delete: false }))}>{h.active ? t("Pause") : t("Resume")}</Btn>
                <Btn small tone="ghost" icon={<RefreshCw size={14} />} disabled={!!busy} onClick={async () => { if (!window.confirm(t("Make a new signing secret? The receiver must be updated with it."))) return; const r = await run("rot" + h.id, () => B.rpc<string>("rotate_webhook_secret", { p_id: h.id })); if (r) setShown({ label: t("New signing secret"), value: r as string }); }}>{t("New secret")}</Btn>
                <button type="button" className="icon-btn subtle" aria-label={t("Delete")} onClick={() => window.confirm(t("Delete this webhook?")) && run("del" + h.id, () => B.rpc("set_webhook", { p_id: h.id, p_active: null, p_delete: true }))}><Trash2 size={15} /></button>
              </span>
            </div>
            <small className="muted">{h.events.map((e) => t(EVENT_LABEL[e] ?? e)).join(" · ")}{h.note ? ` — ${h.note}` : ""}{h.failures ? ` · ${t("{n} failures in a row", { n: h.failures })}` : ""}</small>
          </div>
        ))}
        <div className="stack">
          <Field label={t("Send to (https:// address)")}><input value={hUrl} onChange={(e) => setHUrl(e.target.value)} placeholder="https://hooks.zapier.com/…" inputMode="url" /></Field>
          <div className="chips">{s.events.filter((e) => e !== "test.ping").map((e) => (
            <Chip key={e} on={hEvents.includes(e)} onClick={() => setHEvents(hEvents.includes(e) ? hEvents.filter((x) => x !== e) : [...hEvents, e])}>{t(EVENT_LABEL[e] ?? e)}</Chip>))}</div>
          <div className="row gap">
            <Field label={t("Note")}><input value={hNote} onChange={(e) => setHNote(e.target.value)} placeholder={t("e.g. Slack alerts")} /></Field>
            <Btn tone="primary" icon={<Plus size={16} />} busy={busy === "hook"} disabled={!/^https:\/\/\S+/.test(hUrl) || !hEvents.length || !!busy} onClick={async () => {
              const r = await run("hook", () => B.rpc<{ secret: string }>("create_webhook", { p_url: hUrl.trim(), p_events: hEvents, p_note: hNote }));
              if (r) { setShown({ label: t("Signing secret for {url}", { url: hUrl.trim() }), value: (r as { secret: string }).secret }); setHUrl(""); setHNote(""); }
            }}>{t("Add webhook")}</Btn>
          </div>
        </div>
        <details className="fine int-docs"><summary>{t("Checking that a webhook really came from Kortana")}</summary>
          <p>{t("Each request is JSON {id, type, created_at, data} with headers X-Kortana-Event, X-Kortana-Delivery, X-Kortana-Timestamp and X-Kortana-Signature = sha256=HMAC-SHA256(secret, timestamp + \".\" + body) in hex. Reply with any 2xx; failures are retried after 1, 5, 30, 120 and 720 minutes. Use the delivery id to ignore repeats.")}</p>
        </details>
        {s.deliveries.length > 0 && (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>{t("When")}</th><th>{t("Event")}</th><th>{t("Webhook")}</th><th>{t("Result")}</th></tr></thead>
            <tbody>{s.deliveries.map((d) => (
              <tr key={d.id} className="static">
                <td className="muted">{dayLabel(d.created_at)} {new Date(d.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</td>
                <td>{t(EVENT_LABEL[d.type] ?? d.type)}</td>
                <td className="muted">{hookName(d.webhook_id)}</td>
                <td>{d.status === "ok" ? <Badge tone="ok">{d.code ?? "OK"}</Badge> : d.status === "failed" ? <Badge tone="red">{t("Gave up")}</Badge>
                  : d.attempts ? <Badge tone="moon">{t("Retry {n}", { n: d.attempts })}{d.code ? ` · ${d.code}` : ""}</Badge> : <Badge tone="muted">{t("Queued")}</Badge>}
                  {d.error && <small className="muted"> {d.error.slice(0, 80)}</small>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
