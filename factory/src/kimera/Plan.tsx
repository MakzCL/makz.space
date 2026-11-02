import { CalendarClock, Factory, ShoppingCart } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Empty, Section } from "../components/ui";
import { useActions } from "../lib/actions";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { fmtQty, money, stockLevels } from "../screens/Inventory";
import { useKimera } from "./actions";
import { PageHead, Pill, shortDate } from "./kit";
import { analyse } from "./status";

/** What to make and what to buy so every open sales order can ship. */
export function Plan({ onOrder, onBuy }: { onOrder: (id: string) => void; onBuy: () => void }) {
  const { db, me } = useStore();
  const k = useKimera();
  const a = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const info = useMemo(() => analyse(db), [db]);
  const lv = useMemo(() => stockLevels(db), [db]);
  const editable = can.admin(me.role);

  const toMake = [...info.values()].filter((o) => o.rank !== null)
    .flatMap((o) => o.lines.filter((l) => !l.mo && l.sales.action === "make").map((l) => ({ o, l })))
    .sort((x, y) => (x.o.rank ?? 0) - (y.o.rank ?? 0));

  // Materials short once every open MO has taken what it needs.
  const sup = new Map(db.suppliers.map((s) => [s.id, s]));
  // Made in-house = has a recipe (e.g. the pedestal frame). Those get built, not bought.
  const hasRecipe = new Set(db.bom_lines.map((b) => b.product_id));
  const building = new Map<string, number>();
  for (const j of db.jobs) if (j.sku && !j.order_id && j.status !== "done") building.set(j.sku, (building.get(j.sku) ?? 0) + (j.quantity ?? 1));
  const shortAll = db.stock_items.filter((s) => !s.archived)
    .map((s) => {
      const committed = lv.committed.get(s.id) ?? 0, expected = (lv.expected.get(s.id) ?? 0) + (hasRecipe.has(s.id) ? building.get(s.sku) ?? 0 : 0);
      const after = s.quantity - committed + expected;
      // Top up to twice the reorder point (or just cover the gap when there is none).
      return { s, committed, expected, after, buy: Math.max(1, Math.ceil(s.min_quantity * 2 - after)) };
    })
    .filter((r) => r.after < 0 || (r.s.min_quantity > 0 && r.after <= r.s.min_quantity))
    .sort((x, y) => x.after - y.after);
  const subs = shortAll.filter((r) => hasRecipe.has(r.s.id));
  const short = shortAll.filter((r) => !hasRecipe.has(r.s.id));
  const bySup = new Map<string, typeof short>();
  for (const r of short) { const key = r.s.supplier_id ?? ""; bySup.set(key, [...(bySup.get(key) ?? []), r]); }

  return (
    <div className="k-page">
      <PageHead title={t("Plan")} sub={t("Open sales orders in rank order: what needs making, and what needs buying.")} />
      <Section title={<span className="row gap-s"><Factory size={17} /> {t("To make")}</span>}
        action={editable && toMake.length > 1 ? <Btn small tone="primary" busy={busy === "all"} onClick={async () => { setBusy("all"); for (const x of toMake) await k.makeLine(x.l.line.id); setBusy(null); }}>{t("Make all ({n})", { n: toMake.length })}</Btn> : undefined}>
        {toMake.length ? (
          <div className="tbl-wrap">
            <table className="tbl k-tbl">
              <thead><tr><th className="num">{t("Rank")}</th><th>{t("Order #")}</th><th>{t("Customer")}</th><th>{t("Deadline")}</th><th>SKU</th><th>{t("Item")}</th><th className="num">{t("Qty")}</th><th className="num">{t("Free stock")}</th><th>{t("Ingredients")}</th><th /></tr></thead>
              <tbody>
                {toMake.map(({ o, l }) => {
                  const bom = l.item ? db.bom_lines.filter((b) => b.product_id === l.item!.id) : [];
                  const ok = bom.every((b) => { const m = db.stock_items.find((s) => s.id === b.material_id); return m && m.quantity - (lv.committed.get(m.id) ?? 0) >= b.quantity * l.line.quantity; });
                  return (
                    <tr key={l.line.id} onClick={() => onOrder(o.order.id)}>
                      <td className="num muted">{o.rank}</td>
                      <td><span className="code">{o.order.order_number}</span></td>
                      <td>{o.order.customer}</td>
                      <td className={o.late ? "red-t" : "muted"}>{shortDate(o.order.delivery_deadline) || "—"}</td>
                      <td><span className="code">{l.line.sku}</span></td><td>{l.line.name}</td>
                      <td className="num"><b>{fmtQty(l.line.quantity)}</b></td>
                      <td className="num muted">{fmtQty(Math.max(0, l.item?.quantity ?? 0))}</td>
                      <td><Pill cell={!bom.length ? { label: "No recipe", tone: "none" } : ok ? { label: "In stock", tone: "ok" } : { label: "Short", tone: "bad" }} /></td>
                      <td>{editable && <Btn small tone="soft" busy={busy === l.line.id} icon={<Factory size={14} />} onClick={async () => { setBusy(l.line.id); await k.makeLine(l.line.id); setBusy(null); }}>{t("Make")}</Btn>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty icon={<CalendarClock size={26} />} title={t("Nothing to make")} hint={t("Every open order is covered by stock or a manufacturing order.")} />}
      </Section>

      {subs.length > 0 && (
        <Section title={<span className="row gap-s"><Factory size={17} /> {t("Sub-assemblies to build")}</span>} sub={t("Short parts you make yourselves (they have a recipe) — e.g. frames. Building them takes their own materials off stock.")}>
          <div className="tbl-wrap">
            <table className="tbl k-tbl">
              <thead><tr><th>SKU</th><th>{t("Part")}</th><th className="num">{t("In stock")}</th><th className="num">{t("Needed")}</th><th className="num">{t("Being built")}</th><th className="num">{t("Build")}</th><th /></tr></thead>
              <tbody>{subs.map((r) => (
                <tr key={r.s.id} className="static">
                  <td><span className="code">{r.s.sku}</span></td><td>{r.s.name}</td>
                  <td className="num">{fmtQty(r.s.quantity)}</td><td className="num muted">{fmtQty(r.committed)}</td>
                  <td className="num muted">{fmtQty(building.get(r.s.sku) ?? 0)}</td>
                  <td className="num"><b>{fmtQty(r.buy)}</b></td>
                  <td>{editable && <Btn small tone="soft" busy={busy === "sub" + r.s.id} icon={<Factory size={14} />} onClick={async () => { setBusy("sub" + r.s.id); await k.createMo(r.s.sku, r.s.name, r.buy, null, null); setBusy(null); }}>{t("Make")}</Btn>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title={<span className="row gap-s"><ShoppingCart size={17} /> {t("To buy")}</span>} action={<Btn small tone="soft" onClick={onBuy}>{t("Purchase orders")}</Btn>}>
        {short.length ? [...bySup.entries()].map(([sid, list]) => (
          <div key={sid} className="card flat stack">
            <div className="row between">
              <b>{sup.get(sid)?.name ?? t("No supplier set")}</b>
              {editable && can.editStock(me.role) && <Btn small tone="primary" busy={busy === "po" + sid} icon={<ShoppingCart size={14} />} onClick={async () => {
                setBusy("po" + sid);
                await a.savePo({ supplier_id: sid || null }, list.map((r) => ({ item_id: r.s.id, quantity: r.buy, unit_cost: db.item_suppliers.find((x) => x.item_id === r.s.id && x.supplier_id === sid)?.unit_cost ?? r.s.avg_cost ?? 0 })));
                setBusy(null); onBuy();
              }}>{t("Draft purchase order")}</Btn>}
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>SKU</th><th>{t("Material")}</th><th className="num">{t("In stock")}</th><th className="num">{t("Committed")}</th><th className="num">{t("Expected")}</th><th className="num">{t("After")}</th><th className="num">{t("Reorder at")}</th><th className="num">{t("Suggest")}</th><th className="num">{t("Cost")}</th></tr></thead>
                <tbody>{list.map((r) => (
                  <tr key={r.s.id} className="static">
                    <td><span className="code">{r.s.sku}</span></td><td>{r.s.name}</td>
                    <td className="num">{fmtQty(r.s.quantity)}</td><td className="num muted">{fmtQty(r.committed)}</td><td className="num muted">{r.expected ? fmtQty(r.expected) : ""}</td>
                    <td className={`num ${r.after < 0 ? "red-t" : ""}`}><b>{fmtQty(r.after)}</b></td>
                    <td className="num muted">{r.s.min_quantity ? fmtQty(r.s.min_quantity) : ""}</td>
                    <td className="num"><b>{fmtQty(r.buy)}</b> <small>{r.s.unit}</small></td>
                    <td className="num muted">{money(r.s.avg_cost === null ? null : r.buy * r.s.avg_cost)}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </div>
        )) : <Empty icon={<ShoppingCart size={26} />} title={t("Nothing to buy")} hint={t("Stock covers every open manufacturing order and reorder point.")} />}
      </Section>
    </div>
  );
}
