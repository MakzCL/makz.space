import { AlertTriangle, CalendarRange, Factory, LineChart, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, Empty, Field, Sheet } from "../components/ui";
import { placeList } from "../components/LocationSelect";
import { useActions } from "../lib/actions";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { fmtQty } from "../screens/Inventory";
import { useKimera } from "./actions";
import { shortDate } from "./kit";

/* Phase 6a — planning (PLAN-01..08). The server does the maths (plan_item / plan_overview);
 * this screen shows it, explains the method and lets the office set overrides. */

interface Week { week: string; receipts: number; orders: number; other: number; forecast: number; forecast_source: "auto" | "manual" | "none"; demand: number; closing: number; refs: { kind: string; qty: number; ref: string }[] }
interface Rec { action: "buy" | "make"; quantity: number; short_week: string; order_by: string; lead_days: number; lowest: number; reason: string }
interface PlanItem {
  item: { id: string; sku: string; name: string; unit: string; reorder_point: number }; location: string | null; opening: number;
  weeks: Week[]; history: { week: string; qty: number }[]; forecast: { weekly: number; enough_history: boolean; method: string }; recommendation: Rec | null;
}
interface Row { item: PlanItem["item"]; opening: number; recommendation: Rec; forecast: number; source: "auto" | "manual" | "none" }

const SRC: Record<string, { label: string; tone: string }> = { auto: { label: "Auto", tone: "blue" }, manual: { label: "Manual", tone: "moon" }, none: { label: "No history", tone: "muted" } };

export function ForecastView({ onBuy }: { onBuy: () => void }) {
  const { db, backend: B } = useStore();
  const [loc, setLoc] = useState("");
  const [weeks, setWeeks] = useState(12);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null); setErr("");
    B.rpc<Row[]>("plan_overview", { p_location: loc || null, p_weeks: weeks }).then((r) => setRows(r ?? [])).catch((e) => { setErr(e instanceof Error ? t(e.message) : String(e)); setRows([]); });
  }, [B, loc, weeks]);
  useEffect(() => { load(); }, [load, db.forecast_overrides.length]);
  const places = placeList(db.locations);
  const sorted = (rows ?? []).slice().sort((a, b) => a.recommendation.order_by.localeCompare(b.recommendation.order_by) || a.item.sku.localeCompare(b.item.sku));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted grow" style={{ margin: 0 }}>{t("Projected stock week by week from open orders, purchase and manufacturing orders, transfers and the demand forecast. Items below need action to stay at or above their reorder point.")}</p>
        {places.length > 1 && <select className="tb-select" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label={t("Location")}>
          <option value="">{t("All locations")}</option>{places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <select className="tb-select" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} aria-label={t("Horizon")}>
          {[8, 12, 26, 52].map((n) => <option key={n} value={n}>{t("{n} weeks", { n })}</option>)}</select>
      </div>
      {err && <p className="hint red-t">{err}</p>}
      {rows === null ? <p className="muted">{t("Working out the plan…")}</p> : sorted.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl">
            <thead><tr><th>SKU</th><th>{t("Item")}</th><th>{t("Action")}</th><th className="num">{t("Quantity")}</th><th>{t("Order by")}</th><th>{t("Runs short")}</th><th className="num">{t("In stock")}</th><th className="num">{t("Forecast / week")}</th></tr></thead>
            <tbody>{sorted.map((r) => (
              <tr key={r.item.id} onClick={() => setOpen(r.item.id)}>
                <td><span className="code">{r.item.sku}</span></td><td>{r.item.name}</td>
                <td><Badge tone={r.recommendation.action === "make" ? "moon" : "blue"}>{r.recommendation.action === "make" ? <><Factory size={12} /> {t("Produce it")}</> : <><ShoppingCart size={12} /> {t("Purchase it")}</>}</Badge></td>
                <td className="num"><b>{fmtQty(r.recommendation.quantity)}</b> <small>{r.item.unit}</small></td>
                <td className={r.recommendation.order_by <= today ? "red-t" : ""}>{r.recommendation.order_by <= today ? t("Now") : shortDate(r.recommendation.order_by)}</td>
                <td className="muted">{shortDate(r.recommendation.short_week)}</td>
                <td className="num">{fmtQty(r.opening)}</td>
                <td className="num">{fmtQty(r.forecast)} <Badge tone={SRC[r.source].tone}>{t(SRC[r.source].label)}</Badge></td>
              </tr>))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<LineChart size={26} />} title={t("Nothing runs short")} hint={t("Every item stays at or above its reorder point for the whole horizon.")} />}
      <ForecastSheet itemId={open} location={loc || null} weeks={weeks} onClose={() => setOpen(null)} onChanged={load} onBuy={onBuy} />
    </div>
  );
}

function ForecastSheet({ itemId, location, weeks, onClose, onChanged, onBuy }: { itemId: string | null; location: string | null; weeks: number; onClose: () => void; onChanged: () => void; onBuy: () => void }) {
  const { db, me, backend: B, refresh } = useStore();
  const a = useActions();
  const k = useKimera();
  const [p, setP] = useState<PlanItem | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [month, setMonth] = useState({ start: "", qty: "" });
  const editable = can.admin(me.role);
  const load = useCallback(() => {
    if (!itemId) { setP(null); return; }
    B.rpc<PlanItem>("plan_item", { p_item: itemId, p_location: location, p_weeks: weeks }).then(setP).catch((e) => setErr(e instanceof Error ? t(e.message) : String(e)));
  }, [B, itemId, location, weeks]);
  useEffect(() => { setP(null); setErr(""); load(); }, [load]);
  const item = itemId ? db.stock_items.find((s) => s.id === itemId) : undefined;
  const ovr = (period: "week" | "month", start: string) => db.forecast_overrides.find((o) => o.item_id === itemId && o.period === period && o.period_start === start && (o.location_id ?? null) === location);
  const saveOverride = async (period: "week" | "month", start: string, raw: string) => {
    const cur = ovr(period, start); const v = raw.trim() === "" ? null : Number(cleanNumber(raw));
    if (v !== null && !(v >= 0)) return;
    setBusy(start); setErr("");
    try {
      if (v === null) { if (cur) await B.remove("forecast_overrides", cur.id); }
      else if (cur) await B.update("forecast_overrides", cur.id, { quantity: v });
      else await B.insert("forecast_overrides", { item_id: itemId!, location_id: location, period, period_start: start, quantity: v });
      await refresh("forecast_overrides"); load(); onChanged();
    } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); }
    setBusy("");
  };
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + i); return d.toISOString().slice(0, 7) + "-01"; });
  const rec = p?.recommendation;
  return (
    <Sheet open={!!itemId} onClose={onClose} tall title={p && <span className="row gap-s"><CalendarRange size={18} /><span className="code">{p.item.sku}</span>{p.item.name}</span>}>
      {err && <p className="hint red-t">{err}</p>}
      {!p ? <p className="muted">{t("Working out the plan…")}</p> : (
        <div className="stack">
          <div className="tri">
            <div className="hl"><small>{t("In stock now")}</small><b>{fmtQty(p.opening)}</b><em>{p.item.unit}{p.location ? ` · ${p.location}` : ""}</em></div>
            <div><small>{t("Forecast / week")}</small><b>{fmtQty(p.forecast.weekly)}</b><em>{p.forecast.enough_history ? t("automatic") : t("not enough history")}</em></div>
            <div><small>{t("Reorder point")}</small><b>{fmtQty(p.item.reorder_point)}</b><em>{t("keep at least")}</em></div>
          </div>
          {rec ? (
            <div className="card flat stack fc-rec">
              <div className="row gap-s"><AlertTriangle size={17} className="red-t" /><b>{rec.action === "make" ? t("Make {n} {u} by {d}", { n: fmtQty(rec.quantity), u: p.item.unit, d: shortDate(rec.order_by) }) : t("Order {n} {u} by {d}", { n: fmtQty(rec.quantity), u: p.item.unit, d: shortDate(rec.order_by) })}</b></div>
              <small className="muted">{t("Projected stock falls to {n} in the week of {d} (reorder point {r}). Ordering {l} days ahead covers the lead time.", { n: fmtQty(rec.lowest), d: shortDate(rec.short_week), r: fmtQty(p.item.reorder_point), l: rec.lead_days })}</small>
              {editable && item && (
                <div className="row gap">
                  {rec.action === "buy" && can.editStock(me.role) && <Btn tone="primary" icon={<ShoppingCart size={16} />} busy={busy === "po"} disabled={!!busy} onClick={async () => {
                    setBusy("po");
                    await a.savePo({ supplier_id: item.supplier_id, expected_date: rec.short_week }, [{ item_id: item.id, quantity: rec.quantity, unit_cost: db.item_suppliers.find((x) => x.item_id === item.id && x.supplier_id === item.supplier_id)?.unit_cost ?? item.avg_cost ?? 0 }]);
                    setBusy(""); onClose(); onBuy();
                  }}>{t("Draft purchase order")}</Btn>}
                  {rec.action === "make" && <Btn tone="primary" icon={<Factory size={16} />} busy={busy === "mo"} disabled={!!busy} onClick={async () => {
                    setBusy("mo"); await k.createMo(item.sku, item.name, rec.quantity, rec.short_week, null); setBusy(""); load(); onChanged();
                  }}>{t("Create manufacturing order")}</Btn>}
                </div>
              )}
            </div>
          ) : <p className="ok-t">{t("Stock stays at or above the reorder point for the whole horizon.")}</p>}
          <ProjectionChart p={p} />
          <div className="tbl-wrap">
            <table className="tbl fc-tbl">
              <thead><tr><th>{t("Week")}</th><th className="num">{t("Coming in")}</th><th className="num">{t("Sales orders")}</th><th className="num">{t("Other demand")}</th><th className="num">{t("Forecast")}</th><th className="num">{t("Stock at week end")}</th></tr></thead>
              <tbody>{p.weeks.map((w) => {
                const o = ovr("week", w.week);
                return (
                  <tr key={w.week} className="static" title={w.refs.map((r) => `${r.ref}: ${r.kind === "receipt" ? "+" : "−"}${fmtQty(r.qty)}`).join("\n")}>
                    <td>{shortDate(w.week)}</td>
                    <td className="num">{w.receipts ? `+${fmtQty(w.receipts)}` : ""}</td>
                    <td className="num">{w.orders ? `−${fmtQty(w.orders)}` : ""}</td>
                    <td className="num muted">{w.other ? `−${fmtQty(w.other)}` : ""}</td>
                    <td className="num">
                      {editable
                        ? <input className="cell-input" inputMode="decimal" key={`${w.week}-${o?.quantity ?? ""}-${w.forecast}`} defaultValue={o ? String(o.quantity) : ""} placeholder={fmtQty(w.forecast)} disabled={busy === w.week}
                            title={t("Type a number to override this week; clear it to go back to the automatic forecast")} onBlur={(e) => { if (e.target.value !== (o ? String(o.quantity) : "")) saveOverride("week", w.week, e.target.value); }} />
                        : fmtQty(w.forecast)}
                      {" "}<Badge tone={SRC[w.forecast_source].tone}>{t(SRC[w.forecast_source].label)}</Badge>
                    </td>
                    <td className={`num ${w.closing < p.item.reorder_point ? "red-t" : ""}`}><b>{fmtQty(w.closing)}</b></td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
          {editable && (
            <div className="row gap wrap">
              <Field label={t("Monthly forecast")}><select value={month.start} onChange={(e) => setMonth({ start: e.target.value, qty: ovr("month", e.target.value)?.quantity?.toString() ?? "" })}>
                <option value="">{t("Pick a month")}</option>
                {months.map((m) => <option key={m} value={m}>{new Date(m).toLocaleDateString(undefined, { month: "long", year: "numeric" })}{ovr("month", m) ? ` · ${fmtQty(ovr("month", m)!.quantity)}` : ""}</option>)}</select></Field>
              <Field label={t("Quantity for the month")}><input inputMode="decimal" value={month.qty} disabled={!month.start} placeholder={t("empty = automatic")} onChange={(e) => setMonth({ ...month, qty: e.target.value })} /></Field>
              <Btn tone="soft" disabled={!month.start || !!busy} busy={busy === month.start} onClick={() => saveOverride("month", month.start, month.qty)}>{t("Save")}</Btn>
            </div>
          )}
          <div className="card flat stack">
            <small className="label">{t("How the forecast works")}</small>
            <p className="fine" style={{ textAlign: "left" }}>{t("Weighted average of the last 12 complete weeks of shipments: the most recent week counts 12×, the oldest 1×. It needs at least 4 weeks of history — new products show “No history” until you enter a manual forecast. A weekly number replaces the forecast for that week; a monthly number is spread evenly over the month's days. Booked sales orders use the forecast up instead of adding to it, so each week counts whichever is larger.")}</p>
            <HistoryBars h={p.history} unit={p.item.unit} />
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Projected stock at the end of each week (one series → no legend; the reorder point is a labelled line). */
function ProjectionChart({ p }: { p: PlanItem }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, padL = 44, padR = 12, padT = 16, padB = 28;
  const vals = p.weeks.map((w) => w.closing);
  const max = Math.max(p.item.reorder_point, ...vals, 1), min = Math.min(0, ...vals);
  const y = (v: number) => padT + (max - v) / (max - min || 1) * (H - padT - padB);
  const bw = (W - padL - padR) / vals.length;
  const ticks = [min, (min + max) / 2, max].map((v) => Math.round(v * 10) / 10);
  return (
    <figure className="fc-chart" aria-label={t("Projected stock at the end of each week")}>
      <figcaption className="label">{t("Projected stock at the end of each week")}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="fc-grid" /><text x={padL - 6} y={y(v) + 4} textAnchor="end" className="fc-axis">{fmtQty(v)}</text></g>)}
        <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} className="fc-zero" />
        {vals.map((v, i) => {
          const x = padL + i * bw + 1, w = Math.max(2, bw - 2), top = Math.min(y(v), y(0)), h = Math.max(1, Math.abs(y(v) - y(0)));
          const below = v < p.item.reorder_point;
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={H - padT - padB} fill="transparent" />
              <path className={below ? "fc-bar low" : "fc-bar"} d={v >= 0
                ? `M${x},${top + h} V${top + Math.min(4, h)} Q${x},${top} ${x + Math.min(4, w / 2)},${top} H${x + w - Math.min(4, w / 2)} Q${x + w},${top} ${x + w},${top + Math.min(4, h)} V${top + h} Z`
                : `M${x},${top} V${top + h - Math.min(4, h)} Q${x},${top + h} ${x + Math.min(4, w / 2)},${top + h} H${x + w - Math.min(4, w / 2)} Q${x + w},${top + h} ${x + w},${top + h - Math.min(4, h)} V${top} Z`} />
              {(i % Math.ceil(vals.length / 8) === 0) && <text x={padL + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="fc-axis">{shortDate(p.weeks[i].week)}</text>}
            </g>);
        })}
        <line x1={padL} x2={W - padR} y1={y(p.item.reorder_point)} y2={y(p.item.reorder_point)} className="fc-reorder" />
        <text x={W - padR} y={y(p.item.reorder_point) - 5} textAnchor="end" className="fc-axis">{t("reorder point {n}", { n: fmtQty(p.item.reorder_point) })}</text>
        {hover !== null && (() => {
          const w = p.weeks[hover], x = Math.min(W - 190, Math.max(padL, padL + hover * bw + bw / 2 - 90));
          return <g className="fc-tip" pointerEvents="none"><rect x={x} y={padT} width={180} height={58} rx={8} />
            <text x={x + 10} y={padT + 18}>{t("Week of {d}", { d: shortDate(w.week) })}</text>
            <text x={x + 10} y={padT + 36} className="b">{t("{n} at week end", { n: fmtQty(w.closing) })}{w.closing < p.item.reorder_point ? ` · ${t("below reorder point")}` : ""}</text>
            <text x={x + 10} y={padT + 52}>{`+${fmtQty(w.receipts)} / −${fmtQty(w.demand)}`}</text></g>;
        })()}
      </svg>
    </figure>
  );
}

function HistoryBars({ h, unit }: { h: { week: string; qty: number }[]; unit: string }) {
  const max = Math.max(1, ...h.map((x) => x.qty));
  return (
    <div className="fc-hist" aria-label={t("Shipped per week, last 12 weeks")}>
      {h.map((x) => <div key={x.week} title={`${shortDate(x.week)}: ${fmtQty(x.qty)} ${unit}`}><i style={{ height: `${Math.max(2, (x.qty / max) * 100)}%` }} /></div>)}
      <small className="muted">{t("Shipped per week, last 12 weeks")}</small>
    </div>
  );
}
