import { ArrowDownLeft, ArrowUpRight, Factory, Package, Route, Tags, Truck } from "lucide-react";
import { printLabels } from "../lib/scan";
import { useEffect, useState } from "react";
import { Badge, Btn, Sheet } from "../components/ui";
import { useDocLink } from "../lib/doclink";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { StockItem } from "../lib/types";

const q = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-GB", { maximumFractionDigits: 3 });
const day = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const today = () => new Date().toISOString().slice(0, 10);

/** Batches / serial numbers of one item with stock per location and expiry (INV-10..12). */
export function ItemLots({ item }: { item: StockItem }) {
  const { db, me, backend: B, refresh } = useStore();
  const [trace, setTrace] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (item.tracking === "none") return null;
  const locs = new Map(db.locations.map((l) => [l.id, l.name]));
  const lots = db.lots.filter((l) => l.item_id === item.id).map((l) => {
    const lv = db.lot_levels.filter((x) => x.lot_id === l.id && x.quantity !== 0);
    return { l, lv, total: lv.reduce((s, x) => s + x.quantity, 0) };
  }).filter((x) => all || x.total !== 0)
    .sort((a, b) => (a.l.expiry ?? "9999").localeCompare(b.l.expiry ?? "9999") || a.l.created_at.localeCompare(b.l.created_at));
  const tracked = db.lot_levels.filter((x) => db.lots.find((l) => l.id === x.lot_id)?.item_id === item.id).reduce((s, x) => s + x.quantity, 0);
  const untracked = Math.round((item.quantity - tracked) * 1000) / 1000;
  const editable = can.editStock(me.role);
  return (
    <div className="card flat stack">
      <div className="row between"><small className="label"><Package size={13} /> {item.tracking === "serial" ? t("Serial numbers") : t("Batches")}</small>
        <button type="button" className="link" onClick={() => setAll(!all)}>{all ? t("Only in stock") : t("Show used up too")}</button></div>
      {lots.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{item.tracking === "serial" ? t("Serial") : t("Batch")}</th><th>{t("Expiry")}</th><th>{t("Where")}</th><th className="num">{t("Quantity")}</th><th /></tr></thead>
            <tbody>{lots.map(({ l, lv, total }) => {
              const expired = !!l.expiry && l.expiry < today();
              return (
                <tr key={l.id} className="static">
                  <td><span className="code">{l.code}</span></td>
                  <td>{editable && item.tracking === "batch"
                    ? <input type="date" className="cell-input wide" defaultValue={l.expiry ?? ""} key={l.expiry ?? ""} onBlur={async (e) => { if ((e.target.value || null) !== l.expiry) { await B.update("lots", l.id, { expiry: e.target.value || null }); await refresh("lots"); } }} />
                    : <span className={expired ? "red-t" : ""}>{day(l.expiry)}</span>}{expired && <Badge tone="red">{t("Expired")}</Badge>}</td>
                  <td className="muted">{lv.map((x) => locs.get(x.location_id)).join(", ") || "—"}</td>
                  <td className="num"><b>{q(total)}</b></td>
                  <td className="row gap-s"><Btn small tone="ghost" icon={<Route size={14} />} onClick={() => setTrace(l.id)}>{t("Trace")}</Btn>
                    <button type="button" className="icon-btn subtle" title={t("Print label")} aria-label={t("Print label")} onClick={() => printLabels([{ code: l.code, title: item.name, sub: `${item.sku}${l.expiry ? ` · ${t("exp.")} ${l.expiry}` : ""}` }], Math.max(1, Math.round(total)))}><Tags size={14} /></button></td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      ) : <p className="muted">{t("No batches yet — they are created when you receive or make this item.")}</p>}
      {untracked > 0 && <p className="fine" style={{ textAlign: "left" }}>{t("{n} in stock without a batch (from before tracking was switched on). They are used after the batches.", { n: q(untracked) })}</p>}
      <TraceSheet lotId={trace} onClose={() => setTrace(null)} />
    </div>
  );
}

interface Trace {
  lot: { code: string; sku: string; name: string; expiry: string | null; tracking: string } | null;
  on_hand: { location: string; qty: number }[];
  received: { po: string; supplier: string | null; at: string; qty: number }[];
  shipped: { order: string; order_id: string; customer: string; company: string; lot: string; sku: string; at: string; qty: number }[];
  made_from: { lot: string; sku: string; name: string; depth: number; made_by: string | null; received: { po: string; supplier: string | null; at: string; qty: number }[] }[];
  went_into: { lot: string; sku: string; name: string; depth: number; made_by: string | null }[];
}

/** Where a batch came from, what it went into, and which customers received it (INV-13). */
export function TraceSheet({ lotId, onClose }: { lotId: string | null; onClose: () => void }) {
  const { backend: B } = useStore();
  const open = useDocLink();
  const [tr, setTr] = useState<Trace | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setTr(null); setErr("");
    if (!lotId) return;
    B.rpc<Trace>("trace_lot", { p_lot: lotId }).then(setTr).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [B, lotId]);
  const pad = (d: number) => ({ paddingLeft: `${(d - 1) * 1.1}rem` });
  return (
    <Sheet open={!!lotId} onClose={onClose} tall title={tr?.lot && <span className="row gap-s"><Route size={18} /><span className="code">{tr.lot.code}</span>{tr.lot.sku} · {tr.lot.name}</span>}>
      {err && <p className="hint red-t">{err}</p>}
      {!tr && !err && <p className="muted">{t("Loading…")}</p>}
      {tr && (
        <div className="stack">
          <div className="tri">
            <div className="hl"><small>{t("On hand")}</small><b>{q(tr.on_hand.reduce((s, x) => s + x.qty, 0))}</b><em>{tr.on_hand.map((x) => `${x.location} ${q(x.qty)}`).join(" · ") || "—"}</em></div>
            <div><small>{t("Expiry")}</small><b>{day(tr.lot?.expiry)}</b><em>{tr.lot?.tracking === "serial" ? t("Serial number") : t("Batch")}</em></div>
            <div><small>{t("Customers")}</small><b>{new Set(tr.shipped.map((x) => x.order)).size}</b><em>{t("{n} shipped", { n: q(tr.shipped.reduce((s, x) => s + x.qty, 0)) })}</em></div>
          </div>
          <small className="label"><ArrowDownLeft size={13} /> {t("Came from")}</small>
          {tr.received.length || tr.made_from.length ? (
            <ul className="trace">
              {tr.received.map((r, i) => <li key={"r" + i}><Truck size={14} /> {t("Received {qty} on {po}", { qty: q(r.qty), po: r.po })}{r.supplier ? ` · ${r.supplier}` : ""} <small className="muted">{day(r.at)}</small></li>)}
              {tr.made_from.map((m, i) => (
                <li key={"m" + i} style={pad(m.depth)}><Factory size={14} /> <span className="code">{m.lot}</span> {m.sku} · {m.name}
                  {m.received.map((r, k) => <small key={k} className="muted"> · {t("received on {po}", { po: r.po })}{r.supplier ? ` (${r.supplier})` : ""}</small>)}
                  {m.made_by && <small className="muted"> · {t("made on {mo}", { mo: m.made_by })}</small>}</li>))}
            </ul>) : <p className="muted">{t("Nothing recorded before this batch.")}</p>}
          <small className="label"><ArrowUpRight size={13} /> {t("Went into")}</small>
          {tr.went_into.length ? (
            <ul className="trace">{tr.went_into.map((m, i) => <li key={i} style={pad(m.depth)}><Factory size={14} /> <span className="code">{m.lot}</span> {m.sku} · {m.name}{m.made_by && <small className="muted"> · {m.made_by}</small>}</li>)}</ul>
          ) : <p className="muted">{t("Not used in production yet.")}</p>}
          <small className="label"><Truck size={13} /> {t("Shipped to")}</small>
          {tr.shipped.length ? (
            <ul className="trace">{tr.shipped.map((x, i) => (
              <li key={i}>{open ? <button type="button" className="link code" onClick={() => open({ kind: "order", id: x.order_id, label: x.order })}>{x.order}</button> : <span className="code">{x.order}</span>}
                {" "}{x.customer}{x.company ? ` · ${x.company}` : ""} — {q(x.qty)} × {x.sku} <span className="code">{x.lot}</span> <small className="muted">{day(x.at)}</small></li>))}
            </ul>) : <p className="muted">{t("Not shipped to any customer.")}</p>}
        </div>
      )}
    </Sheet>
  );
}
