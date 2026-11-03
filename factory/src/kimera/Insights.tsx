import { useMemo, useState } from "react";
import { canSeeCosts } from "../lib/roles";
import { t, plural } from "../lib/i18n";
import { useStore } from "../lib/store";
import { money, stockLevels } from "../screens/Inventory";
import { PageHead, Stat, SubTabs } from "./kit";
import { ReportsView } from "./Reports";
import { analyse } from "./status";

const WEEKS = 12;
const monday = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export function KInsights({ onItem }: { onItem: (id: string) => void }) {
  const { db, me } = useStore();
  const [view, setView] = useState<"overview" | "reports">("overview");
  const tabs = <SubTabs value={view} onChange={setView} tabs={[{ value: "overview", label: t("Overview") }, { value: "reports", label: t("Reports") }]} />;
  const costs = canSeeCosts(me.role, db.kimera_access);
  const info = useMemo(() => analyse(db), [db]);
  const lv = useMemo(() => stockLevels(db), [db]);
  if (view === "reports") return (
    <div className="k-page">
      <PageHead title={t("Insights")} sub={t("Reports straight from the stock ledger and the documents — they add up to the records behind them.")} tabs={tabs} />
      <ReportsView onItem={onItem} />
    </div>
  );
  const now = new Date();
  const month0 = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const sold = [...info.values()].filter((o) => o.order.kind === "order" && o.order.status !== "cancelled");
  const when = (o: (typeof sold)[number]) => o.order.ordered_at ?? o.order.created_at;
  const monthSales = sold.filter((o) => when(o) >= month0).reduce((x, o) => x + (o.amount ?? 0), 0);
  const open = sold.filter((o) => o.order.status === "open");
  const late = open.filter((o) => o.late).length;
  const moOpen = db.jobs.filter((j) => j.route?.length && j.status !== "done");
  const week0 = monday(now).toISOString();
  const madeWeek = db.jobs.filter((j) => j.route?.length && j.status === "done" && (j.completed_at ?? "") >= week0).length;
  const stockValue = db.stock_items.filter((s) => !s.archived).reduce((x, s) => x + Math.max(0, s.quantity) * (s.avg_cost ?? 0), 0);
  const reorder = db.stock_items.filter((s) => !s.archived && s.min_quantity > 0 && s.quantity - (lv.committed.get(s.id) ?? 0) + (lv.expected.get(s.id) ?? 0) <= s.min_quantity).length;
  const tickets = db.issues.filter((i) => i.status !== "resolved").length;

  // Weekly sales, last 12 weeks.
  const start = monday(now); start.setDate(start.getDate() - 7 * (WEEKS - 1));
  const weeks = Array.from({ length: WEEKS }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + 7 * i); return { d, v: 0, n: 0 }; });
  for (const o of sold) {
    const i = Math.floor((new Date(when(o)).getTime() - start.getTime()) / (7 * 864e5));
    if (i >= 0 && i < WEEKS) { weeks[i]!.v += o.amount ?? 0; weeks[i]!.n += 1; }
  }
  // Top products by units, last 90 days.
  const since = new Date(Date.now() - 90 * 864e5).toISOString();
  const recent = new Set(sold.filter((o) => when(o) >= since).map((o) => o.order.id));
  const units = new Map<string, { name: string; q: number }>();
  for (const l of db.order_lines) if (recent.has(l.order_id)) {
    const key = l.sku || l.name; const cur = units.get(key) ?? { name: l.name || l.sku, q: 0 };
    cur.q += l.quantity; units.set(key, cur);
  }
  const top = [...units.entries()].sort((a, b) => b[1].q - a[1].q).slice(0, 8);

  return (
    <div className="k-page">
      <PageHead title={t("Insights")} sub={t("Sales, production and stock at a glance.")} tabs={tabs} />
      <div className="k-stats">
        <Stat label={t("Sales this month")} value={money(monthSales)} sub={plural(sold.filter((o) => when(o) >= month0).length, ["order", "orders"], ["zamówienie", "zamówienia", "zamówień"])} />
        <Stat label={t("Open orders")} value={open.length} sub={money(open.reduce((x, o) => x + (o.amount ?? 0), 0))} />
        <Stat label={t("Late orders")} value={late} tone={late ? "bad" : "ok"} sub={late ? t("past their deadline") : t("all on time")} />
        <Stat label={t("In production")} value={moOpen.length} sub={t("{n} finished this week", { n: madeWeek })} />
        {costs && <Stat label={t("Stock value")} value={money(stockValue)} sub={t("at average cost")} />}
        <Stat label={t("To reorder")} value={reorder} tone={reorder ? "warn" : undefined} sub={t("items at or below reorder point")} />
        <Stat label={t("Open tickets")} value={tickets} tone={tickets ? "warn" : undefined} />
      </div>
      <div className="k-charts">
        <div className="card k-chart">
          <h3>{t("Sales per week")}</h3>
          <small className="muted">{t("Last {n} weeks, by order date", { n: WEEKS })}</small>
          <WeekBars weeks={weeks} />
        </div>
        <div className="card k-chart">
          <h3>{t("Best sellers")}</h3>
          <small className="muted">{t("Units sold, last 90 days")}</small>
          {top.length ? (
            <ul className="k-hbars">
              {top.map(([sku, x]) => (
                <li key={sku} title={`${x.name}: ${x.q}`}>
                  <span className="k-hb-label"><span className="code">{sku}</span> {x.name}</span>
                  <span className="k-hb-track"><i style={{ width: `${(x.q / top[0]![1].q) * 100}%` }} /></span>
                  <b>{x.q.toLocaleString("en-GB")}</b>
                </li>
              ))}
            </ul>
          ) : <p className="muted">{t("No sales yet")}</p>}
        </div>
      </div>
    </div>
  );
}

function WeekBars({ weeks }: { weeks: { d: Date; v: number; n: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.v));
  const W = 600, H = 200, pad = 28, bw = (W - pad) / weeks.length;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const h = hover !== null ? weeks[hover]! : null;
  return (
    <div className="k-bars">
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={t("Sales per week")} onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => { const y = H - (v / max) * (H - 10); return <g key={v}><line x1={pad} x2={W} y1={y} y2={y} className="k-grid" /><text x={pad - 4} y={y + 3} textAnchor="end" className="k-axis">{v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}</text></g>; })}
        {weeks.map((w, i) => {
          const bh = w.v ? Math.max(2, (w.v / max) * (H - 10)) : 0;
          const x = pad + i * bw + 2, y = H - bh, wd = bw - 4;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
              <rect x={pad + i * bw} y={0} width={bw} height={H} fill="transparent" />
              {bh > 0 && <path className={`k-bar ${hover === i ? "on" : ""}`} d={`M${x},${H} V${y + 4} Q${x},${y} ${x + 4},${y} H${x + wd - 4} Q${x + wd},${y} ${x + wd},${y + 4} V${H} Z`} />}
              {i % 2 === 0 && <text x={x + wd / 2} y={H + 15} textAnchor="middle" className="k-axis">{w.d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</text>}
            </g>
          );
        })}
      </svg>
      {h && <div className="k-tip" style={{ left: `${((pad + (hover! + 0.5) * bw) / W) * 100}%` }}>
        <small>{t("Week of {d}", { d: h.d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) })}</small><b>{money(h.v)}</b><small>{plural(h.n, ["order", "orders"], ["zamówienie", "zamówienia", "zamówień"])}</small>
      </div>}
    </div>
  );
}
