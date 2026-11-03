import { Download, FileBarChart } from "lucide-react";
import { useEffect, useState } from "react";
import { Btn, Chip, Empty } from "../components/ui";
import { placeList } from "../components/LocationSelect";
import { download, toCsv } from "../lib/csv";
import { useDocLink } from "../lib/doclink";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import { fmtQty, money } from "../screens/Inventory";

/* Phase 6b — reports (REP-01..09). Computed on the server by report(); every figure comes from the
 * ledger or the documents, so it reconciles. Rows drill through to the item, MO or PO behind them. */

type Kind = "sales" | "inventory" | "purchasing" | "manufacturing" | "consumption" | "production";
type Fmt = "qty" | "money" | "pct" | "hours" | "days" | "int" | "date" | "text";
interface Col { k: string; label: string; f: Fmt; cost?: boolean }
const KINDS: { v: Kind; label: string; hint: string }[] = [
  { v: "sales", label: "Sales & margin", hint: "Revenue when goods ship (net of returns), cost of goods at the cost they left stock, and the margin." },
  { v: "inventory", label: "Inventory", hint: "Stock at the start, what came in and went out, stock at the end and its value at today's average cost." },
  { v: "purchasing", label: "Purchasing", hint: "Purchase orders placed in the period by supplier: value ordered and received, delivered on time, average lead time." },
  { v: "manufacturing", label: "Manufacturing cost", hint: "Finished manufacturing orders: planned vs actual materials, labour at the company rate, cost per unit." },
  { v: "consumption", label: "Material use", hint: "Materials used up by production in the period and their cost." },
  { v: "production", label: "Production", hint: "Hours on jobs per person, stations completed, orders finished and units made." },
];
const COLS: Record<Kind, Col[]> = {
  sales: [{ k: "key", label: "", f: "text" }, { k: "label", label: "Name", f: "text" }, { k: "orders", label: "Orders", f: "int" }, { k: "qty", label: "Units", f: "qty" },
    { k: "revenue", label: "Revenue", f: "money" }, { k: "cost", label: "Cost", f: "money", cost: true }, { k: "margin", label: "Margin", f: "money", cost: true }, { k: "margin_pct", label: "Margin %", f: "pct", cost: true }],
  inventory: [{ k: "key", label: "SKU", f: "text" }, { k: "label", label: "Item", f: "text" }, { k: "opening", label: "At start", f: "qty" }, { k: "in", label: "In", f: "qty" },
    { k: "out", label: "Out", f: "qty" }, { k: "closing", label: "At end", f: "qty" }, { k: "value", label: "Value", f: "money", cost: true }],
  purchasing: [{ k: "label", label: "Supplier", f: "text" }, { k: "pos", label: "POs", f: "int" }, { k: "outsourced", label: "Outsourced", f: "int" }, { k: "ordered", label: "Ordered", f: "money" },
    { k: "received", label: "Received", f: "money" }, { k: "on_time_pct", label: "On time", f: "pct" }, { k: "lead_days", label: "Lead time", f: "days" }],
  manufacturing: [{ k: "key", label: "MO", f: "text" }, { k: "label", label: "Product", f: "text" }, { k: "qty", label: "Qty", f: "qty" }, { k: "done", label: "Finished", f: "date" },
    { k: "hours", label: "Hours", f: "hours" }, { k: "planned", label: "Materials plan", f: "money", cost: true }, { k: "materials", label: "Materials actual", f: "money", cost: true },
    { k: "labour", label: "Labour", f: "money", cost: true }, { k: "unit", label: "Per unit", f: "money", cost: true }],
  consumption: [{ k: "key", label: "SKU", f: "text" }, { k: "label", label: "Material", f: "text" }, { k: "qty", label: "Used", f: "qty" }, { k: "mos", label: "MOs", f: "int" }, { k: "value", label: "Cost", f: "money", cost: true }],
  production: [{ k: "label", label: "Person", f: "text" }, { k: "hours", label: "Hours on jobs", f: "hours" }, { k: "jobs", label: "Jobs", f: "int" }, { k: "steps", label: "Stations done", f: "int" }, { k: "hours_per_job", label: "Hours / job", f: "hours" }],
};
type RowT = Record<string, string | number | null>;
interface Rep { costs: boolean; rows: RowT[]; totals: Record<string, unknown> }

const iso = (d: Date) => d.toISOString().slice(0, 10);
function preset(p: string): [string, string] {
  const n = new Date(); const y = n.getFullYear(), m = n.getMonth();
  if (p === "last") return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  if (p === "quarter") return [iso(new Date(Date.UTC(y, m - 2, 1))), iso(n)];
  if (p === "year") return [iso(new Date(Date.UTC(y, 0, 1))), iso(n)];
  return [iso(new Date(Date.UTC(y, m, 1))), iso(n)];
}
const show = (v: unknown, f: Fmt) => {
  if (v === null || v === undefined || v === "") return f === "text" ? "" : "—";
  const n = Number(v);
  switch (f) {
    case "money": return money(n);
    case "pct": return `${n.toLocaleString("en-GB", { maximumFractionDigits: 1 })}%`;
    case "hours": return `${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })} h`;
    case "days": return t("{n} days", { n: n.toLocaleString("en-GB", { maximumFractionDigits: 1 }) });
    case "date": return new Date(String(v)).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    case "qty": return fmtQty(n);
    case "int": return String(Math.round(n));
    default: return String(v);
  }
};

export function ReportsView({ onItem }: { onItem: (id: string) => void }) {
  const { db, backend: B } = useStore();
  const open = useDocLink();
  const [kind, setKind] = useState<Kind>("sales");
  const [range, setRange] = useState<[string, string]>(preset("month"));
  const [pre, setPre] = useState("month");
  const [group, setGroup] = useState("product");
  const [loc, setLoc] = useState("");
  const [rep, setRep] = useState<Rep | null>(null);
  const [err, setErr] = useState("");
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 } | null>(null);
  useEffect(() => {
    setRep(null); setErr("");
    B.rpc<Rep>("report", { p_kind: kind, p_from: range[0], p_to: range[1], p_group: kind === "sales" ? group : null, p_location: loc || null })
      .then(setRep).catch((e) => setErr(e instanceof Error ? t(e.message) : String(e)));
  }, [B, kind, range, group, loc]);
  const cols = COLS[kind].filter((c) => !c.cost || rep?.costs).map((c) => kind === "sales" && c.k === "key" ? { ...c, label: group === "product" ? "SKU" : group === "month" ? t("Month") : "" } : c)
    .filter((c) => !(kind === "sales" && c.k === "key" && group === "customer"));
  const rows = (rep?.rows ?? []).slice().sort((a, b) => {
    if (!sort) return 0;
    const x = a[sort.k], y = b[sort.k];
    return (typeof x === "number" || typeof y === "number" ? (Number(x ?? 0) - Number(y ?? 0)) : String(x ?? "").localeCompare(String(y ?? ""))) * sort.d;
  });
  const drill = (r: RowT) => {
    if (r.item_id) onItem(String(r.item_id));
    else if (r.job_id && open) open({ kind: "job", id: String(r.job_id), label: String(r.key) });
  };
  const k = KINDS.find((x) => x.v === kind)!;
  const places = placeList(db.locations);
  const exportCsv = () => download(`${kind}-${range[0]}-${range[1]}.csv`, toCsv(cols.map((c) => t(c.label) || c.k), rows.map((r) => cols.map((c) => r[c.k] ?? ""))));
  return (
    <div className="stack">
      <div className="chips">{KINDS.map((x) => <Chip key={x.v} on={kind === x.v} onClick={() => { setKind(x.v); setSort(null); }}>{t(x.label)}</Chip>)}</div>
      <div className="toolbar">
        <select className="tb-select" value={pre} onChange={(e) => { setPre(e.target.value); if (e.target.value !== "custom") setRange(preset(e.target.value)); }} aria-label={t("Period")}>
          <option value="month">{t("This month")}</option><option value="last">{t("Last month")}</option><option value="quarter">{t("Last 3 months")}</option><option value="year">{t("This year")}</option><option value="custom">{t("Custom…")}</option>
        </select>
        {pre === "custom" && <>
          <input type="date" value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} aria-label={t("From")} />
          <input type="date" value={range[1]} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} aria-label={t("To")} />
        </>}
        {kind === "sales" && <select className="tb-select" value={group} onChange={(e) => setGroup(e.target.value)} aria-label={t("Group by")}>
          <option value="product">{t("By product")}</option><option value="customer">{t("By customer")}</option><option value="month">{t("By month")}</option></select>}
        {places.length > 1 && ["sales", "inventory", "purchasing", "manufacturing", "consumption"].includes(kind) && <select className="tb-select" value={loc} onChange={(e) => setLoc(e.target.value)} aria-label={t("Location")}>
          <option value="">{t("All locations")}</option>{places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <span className="grow" />
        <Btn tone="soft" icon={<Download size={16} />} disabled={!rows.length} onClick={exportCsv}>{t("Export")}</Btn>
      </div>
      <p className="muted" style={{ margin: 0 }}>{t(k.hint)}{rep && !rep.costs && cols.length < COLS[kind].length ? ` ${t("Cost columns are hidden for your role.")}` : ""}</p>
      {err && <p className="hint red-t">{err}</p>}
      {!rep ? <p className="muted">{t("Loading…")}</p> : rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl rep-tbl">
            <thead><tr>{cols.map((c) => (
              <th key={c.k} className={c.f === "text" || c.f === "date" ? "" : "num"} aria-sort={sort?.k === c.k ? (sort.d === 1 ? "ascending" : "descending") : undefined}>
                <button type="button" className="th-sort" onClick={() => setSort(sort?.k === c.k ? { k: c.k, d: sort.d === 1 ? -1 : 1 } : { k: c.k, d: c.f === "text" ? 1 : -1 })}>{t(c.label)}{sort?.k === c.k ? (sort.d === 1 ? " ↑" : " ↓") : ""}</button>
              </th>))}</tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className={r.item_id || r.job_id ? "" : "static"} onClick={() => drill(r)}>
                {cols.map((c) => <td key={c.k} className={c.f === "text" || c.f === "date" ? (c.k === "key" ? "" : "") : `num ${c.k === "margin" && Number(r[c.k]) < 0 ? "red-t" : ""}`}>
                  {c.k === "key" ? <span className="code">{show(r[c.k], c.f)}</span> : show(r[c.k], c.f)}</td>)}
              </tr>))}
            </tbody>
            <tfoot><tr>{cols.map((c, i) => <td key={c.k} className={c.f === "text" || c.f === "date" ? "" : "num"}>{i === 0 ? <b>{t("Total")}</b> : rep.totals[c.k] !== undefined ? <b>{show(rep.totals[c.k], c.f)}</b> : ""}</td>)}</tr></tfoot>
          </table>
        </div>
      ) : <Empty icon={<FileBarChart size={26} />} title={t("Nothing in this period")} hint={t("Try a longer period.")} />}
      {kind === "production" && rep && Array.isArray(rep.totals.by_station) && (rep.totals.by_station as { station: string | null; steps: number }[]).length > 0 && (
        <p className="fine" style={{ textAlign: "left" }}>{t("Orders finished")}: <b>{String(rep.totals.mos_done)}</b> · {t("Units made")}: <b>{fmtQty(Number(rep.totals.units_made))}</b> · {t("Stations completed")}: {(rep.totals.by_station as { station: string | null; steps: number }[]).map((s) => `${s.station ?? "—"} ${s.steps}`).join(", ")}</p>
      )}
    </div>
  );
}
