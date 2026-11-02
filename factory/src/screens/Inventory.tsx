import { motion } from "motion/react";
import { Boxes, ClipboardCheck, Download, History, MapPin, Minus, Plus, Search, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { SceneTabs } from "../components/Scene";
import { Badge, Btn, Chip, Empty, Field, HoldButton, RoundBtn, Segmented, Sheet, list } from "../components/ui";
import { opKey, useActions } from "../lib/actions";
import { docOf, useDocLink } from "../lib/doclink";
import { LocationSelect, placeList } from "../components/LocationSelect";
import { cleanNumber, download, guessColumns, parseCsv, toCsv } from "../lib/csv";
import { t } from "../lib/i18n";
import { can, canSeeCosts } from "../lib/roles";
import { useStore } from "../lib/store";
import { clock, dayLabel } from "../lib/time";
import type { DB, ItemKind, MoveReason, StockItem } from "../lib/types";
import { PurchasingView, SuppliersView } from "./Purchasing";

/* ------------------------------------------------------------- helpers -- */
export const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-GB", { maximumFractionDigits: 3 });
export const money = (n: number | null | undefined) => n === null || n === undefined ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<ItemKind, string> = { product: "Product", material: "Material", part: "Part", service: "Service" };
export const kindLabel = (k: ItemKind) => t(KIND[k]);
const REASON: Record<MoveReason, string> = {
  adjust: "Adjustment", count: "Stocktake", receive: "Received", consume: "Used in job", produce: "Made", import: "Import", opening: "Opening stock",
  ship: "Shipped", return: "Returned", transfer: "Transfer", pick: "Picked for production",
};

/**
 * On hand   = what the ledger says is physically here (stock_items.quantity).
 * Committed = ingredients still needed by unfinished manufacturing orders
 *             + made-to-order output waiting to ship on its sales line.
 * Expected  = still to arrive on ordered / part-received purchase orders.
 * Available = on hand − committed (open sales lines are allocated on top of this by rank).
 */
export function stockLevels(db: DB) {
  const committed = new Map<string, number>();
  const expected = new Map<string, number>();
  const bySku = new Map(db.stock_items.map((s) => [s.sku, s]));
  for (const j of db.jobs) {
    if (j.status === "done" || j.stock_booked || !j.sku) continue;
    const prod = bySku.get(j.sku);
    if (!prod) continue;
    for (const b of db.bom_lines) if (b.product_id === prod.id)
      committed.set(b.material_id, (committed.get(b.material_id) ?? 0) + b.quantity * (j.quantity ?? 1));
  }
  const doneMoLine = new Set(db.jobs.filter((j) => j.order_line_id && j.stock_booked).map((j) => j.order_line_id));
  const openOrder = new Set(db.orders.filter((o) => o.kind === "order" && o.status === "open").map((o) => o.id));
  for (const l of db.order_lines) if (l.item_id && openOrder.has(l.order_id) && doneMoLine.has(l.id) && l.quantity > l.shipped)
    committed.set(l.item_id, (committed.get(l.item_id) ?? 0) + l.quantity - l.shipped);
  const openPo = new Set(db.purchase_orders.filter((p) => p.status === "ordered" || p.status === "partial").map((p) => p.id));
  for (const l of db.po_lines) if (openPo.has(l.po_id))
    expected.set(l.item_id, (expected.get(l.item_id) ?? 0) + Math.max(0, l.quantity - l.received));
  return { committed, expected };
}

/** SKU picker that works with a keyboard: type part of a SKU or name. */
export function ItemPicker({ value, onChange, filter, placeholder }: { value: string | null; onChange: (id: string | null) => void; filter?: (s: StockItem) => boolean; placeholder?: string }) {
  const { db } = useStore();
  const items = db.stock_items.filter((s) => !s.archived && (!filter || filter(s)));
  const cur = db.stock_items.find((s) => s.id === value);
  const [txt, setTxt] = useState(cur ? `${cur.sku} — ${cur.name}` : "");
  const id = useMemo(() => `items-${Math.random().toString(36).slice(2)}`, []);
  return (
    <>
      <input list={id} value={txt} placeholder={placeholder ?? t("Type SKU or name…")}
        onChange={(e) => {
          setTxt(e.target.value);
          const v = e.target.value.trim().toLowerCase();
          const hit = items.find((s) => `${s.sku} — ${s.name}`.toLowerCase() === v || s.sku.toLowerCase() === v || (!!s.barcode && s.barcode.toLowerCase() === v));
          if (hit && hit.barcode?.toLowerCase() === v) setTxt(`${hit.sku} — ${hit.name}`); // scanned
          onChange(hit?.id ?? null);
        }} />
      <datalist id={id}>{items.slice(0, 2000).map((s) => <option key={s.id} value={`${s.sku} — ${s.name}`} />)}</datalist>
    </>
  );
}

/* --------------------------------------------------------------- screen -- */
type View = "items" | "recipes" | "purchasing" | "suppliers" | "history";

export function Inventory() {
  const { me } = useStore();
  const [view, setView] = useState<View>("items");
  const [importing, setImporting] = useState(false);
  const editable = can.editStock(me.role);
  return (
    <motion.div className="page inventory" initial="hidden" animate="show" variants={list}>
      <SceneTabs kind="warehouse" height={170} value={view} onChange={setView} title={t("Inventory")} sub={t("Stock, recipes and purchasing")}
        actions={editable ? <RoundBtn label={t("Import from Katana (CSV)")} onClick={() => setImporting(true)}><Upload size={18} /></RoundBtn> : undefined}
        tabs={[
          { value: "items", label: t("Items") }, { value: "recipes", label: t("Recipes") }, { value: "purchasing", label: t("Purchasing") },
          { value: "suppliers", label: t("Suppliers") }, { value: "history", label: t("History") },
        ]} />
      {view === "items" ? <ItemsView /> : view === "recipes" ? <RecipesView /> : view === "purchasing" ? <PurchasingView />
        : view === "suppliers" ? <SuppliersView /> : <HistoryView />}
      {editable && <ImportSheet open={importing} onClose={() => setImporting(false)} />}
    </motion.div>
  );
}

/* ---------------------------------------------------------------- items -- */
export function ItemsView({ kinds }: { kinds?: ItemKind[] } = {}) {
  const { db, me } = useStore();
  const costs = canSeeCosts(me.role, db.kimera_access);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ItemKind | "all">("all");
  const allowed = (k: ItemKind) => !kinds || kinds.includes(k);
  const [cat, setCat] = useState("");
  const [low, setLow] = useState(false);
  const [open, setOpen] = useState<StockItem | "new" | null>(null);
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: "name", d: 1 });
  const lv = useMemo(() => stockLevels(db), [db]);
  const cats = [...new Set(db.stock_items.map((s) => s.category).filter(Boolean))].sort();
  const sup = new Map(db.suppliers.map((s) => [s.id, s.name]));
  const [locF, setLocF] = useState<string>("");
  const places = placeList(db.locations);
  const atLoc = useMemo(() => {
    if (!locF) return null;
    const m = new Map<string, { q: number; bin: string }>();
    for (const l of db.stock_levels) if (l.location_id === locF) m.set(l.item_id, { q: l.quantity, bin: l.bin });
    return m;
  }, [db.stock_levels, locF]);

  const rows = db.stock_items
    .filter((s) => !s.archived)
    .filter((s) => allowed(s.kind) && (kind === "all" || s.kind === kind))
    .filter((s) => !cat || s.category === cat)
    .filter((s) => !q || `${s.sku} ${s.name} ${s.location} ${s.category} ${s.barcode ?? ""} ${s.supplier_code}`.toLowerCase().includes(q.toLowerCase()) || refsBySku(db, q).has(s.id))
    .map((s) => {
      const committed = lv.committed.get(s.id) ?? 0, expected = lv.expected.get(s.id) ?? 0;
      const qty = atLoc ? atLoc.get(s.id)?.q ?? 0 : s.quantity;
      return { s, qty, bin: atLoc ? atLoc.get(s.id)?.bin ?? "" : s.location, committed, expected, available: qty - committed, value: s.avg_cost === null ? 0 : qty * s.avg_cost };
    })
    .filter((r) => !atLoc || r.qty !== 0 || atLoc.has(r.s.id))
    .filter((r) => !low || (r.s.min_quantity > 0 && r.available + r.expected <= r.s.min_quantity))
    .sort((a, b) => {
      const v = (r: typeof a) => sort.k === "name" ? r.s.name.toLowerCase() : sort.k === "sku" ? r.s.sku : sort.k === "value" ? r.value : sort.k === "available" ? r.available : r.s.quantity;
      const x = v(a), y = v(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.d;
    });
  const total = rows.reduce((x, r) => x + r.value, 0);
  const lowCount = db.stock_items.filter((s) => !s.archived && s.min_quantity > 0 && s.quantity - (lv.committed.get(s.id) ?? 0) + (lv.expected.get(s.id) ?? 0) <= s.min_quantity).length;
  const th = (k: string, label: string, num = false) => (
    <th className={num ? "num" : ""}><button type="button" onClick={() => setSort({ k, d: sort.k === k ? (sort.d === 1 ? -1 : 1) : num ? -1 : 1 })}>{label}{sort.k === k ? (sort.d === 1 ? " ↑" : " ↓") : ""}</button></th>
  );

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search SKU, name, location, category…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {places.length > 1 && <select value={locF} onChange={(e) => setLocF(e.target.value)} className="tb-select" aria-label={t("Location")}>
          <option value="">{t("All locations")}</option>{places.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
        <select value={cat} onChange={(e) => setCat(e.target.value)} className="tb-select"><option value="">{t("All categories")}</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        <Btn tone="soft" icon={<Download size={17} />} onClick={() => download(`stock-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(
          ["SKU", "Name", "Type", "Category", "Location", "Unit", "In stock", "Committed", "Expected", "Available", "Reorder point", ...(costs ? ["Average cost", "Value"] : []), "Supplier"],
          rows.map((r) => [r.s.sku, r.s.name, r.s.kind, r.s.category, r.bin, r.s.unit, r.qty, r.committed, r.expected, r.available, r.s.min_quantity, ...(costs ? [r.s.avg_cost ?? "", r.value.toFixed(2)] : []), sup.get(r.s.supplier_id ?? "") ?? ""])))}>{t("Export")}</Btn>
        {can.editStock(me.role) && <Btn tone="primary" icon={<Plus size={18} />} onClick={() => setOpen("new")}>{t("New item")}</Btn>}
      </div>
      <div className="row between wrap">
        <div className="chips">
          {(["all", "product", "material", "part", "service"] as const).filter((k) => k === "all" || (allowed(k) && (kinds?.length ?? 4) > 1)).map((k) => <Chip key={k} on={kind === k} onClick={() => setKind(k)}>{k === "all" ? t("All") : kindLabel(k)}</Chip>)}
          <Chip on={low} onClick={() => setLow(!low)}>{t("To reorder")}{lowCount ? ` · ${lowCount}` : ""}</Chip>
        </div>
        <small className="muted">{t("{n} items", { n: rows.length })}{costs && <> · {t("stock value")} <b>{money(total)}</b></>}</small>
      </div>
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr>
              {th("sku", "SKU")}{th("name", t("Name"))}<th>{t("Category")}</th><th>{t("Location")}</th>
              {th("quantity", t("In stock"), true)}<th className="num">{t("Committed")}</th><th className="num">{t("Expected")}</th>
              {th("available", t("Available"), true)}<th className="num">{t("Reorder at")}</th>{costs && <><th className="num">{t("Avg cost")}</th>{th("value", t("Value"), true)}</>}
            </tr></thead>
            <tbody>
              {rows.slice(0, 1500).map((r) => {
                const isLow = r.s.min_quantity > 0 && r.available + r.expected <= r.s.min_quantity;
                return (
                  <tr key={r.s.id} onClick={() => setOpen(r.s)} className={isLow ? "low" : ""}>
                    <td><span className="code">{r.s.sku}</span></td>
                    <td><b>{r.s.name}</b>{r.s.kind !== "material" && <Badge tone={r.s.kind === "product" ? "blue" : "muted"}>{kindLabel(r.s.kind)}</Badge>}</td>
                    <td className="muted">{r.s.category}</td><td className="muted">{r.bin}</td>
                    <td className="num"><b>{fmtQty(r.qty)}</b> <small>{r.s.unit}</small></td>
                    <td className="num muted">{r.committed ? fmtQty(r.committed) : ""}</td>
                    <td className="num muted">{r.expected ? fmtQty(r.expected) : ""}</td>
                    <td className={`num ${r.available < 0 ? "red-t" : ""}`}>{fmtQty(r.available)}</td>
                    <td className="num muted">{r.s.min_quantity ? fmtQty(r.s.min_quantity) : ""}</td>
                    {costs && <><td className="num muted">{money(r.s.avg_cost)}</td>
                    <td className="num">{money(r.value)}</td></>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<Boxes size={28} />} title={db.stock_items.length ? t("Nothing found") : t("No stock yet")} hint={db.stock_items.length ? t("Try another search.") : t("Import your Katana export with the upload button above.")} />}
      <ItemSheet item={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export function ItemSheet({ item, onClose }: { item: StockItem | "new" | null; onClose: () => void }) {
  const { db, me, person } = useStore();
  const a = useActions();
  const live = item && item !== "new" ? db.stock_items.find((s) => s.id === item.id) ?? item : null;
  const editable = can.editStock(me.role);
  const [tab, setTab] = useState<"stock" | "details" | "recipe">("stock");
  const [f, setF] = useState<Partial<StockItem>>({});
  const [open0, setOpen0] = useState({ qty: "", cost: "" });
  const [delta, setDelta] = useState("");
  const [adjKey, setAdjKey] = useState(opKey);
  const [count, setCount] = useState("");
  const [loc, setLoc] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const k = item === "new" ? "new" : item?.id ?? null;
  if (k !== key) {
    setKey(k);
    setF(item === "new" ? { sku: "", name: "", kind: "material", category: "", unit: "pcs", location: "", min_quantity: 0, sale_price: null, supplier_id: null, supplier_code: "", lead_days: null, notes: "" } : item ? { ...item } : {});
    setTab(item === "new" ? "details" : "stock"); setDelta(""); setCount(""); setNote(""); setOpen0({ qty: "", cost: "" });
  }
  const lv = stockLevels(db);
  const moves = live ? db.stock_movements.filter((m) => m.item_id === live.id).sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, 40) : [];
  const usedIn = live ? db.bom_lines.filter((b) => b.material_id === live.id).map((b) => db.stock_items.find((s) => s.id === b.product_id)).filter(Boolean) : [];
  const save = async () => {
    const id = await a.saveStock(f, item === "new" ? { qty: Number(cleanNumber(open0.qty) || 0), cost: cleanNumber(open0.cost) ? Number(cleanNumber(open0.cost)) : null } : undefined);
    if (item === "new" && id) onClose();
  };
  return (
    <Sheet open={!!item} onClose={onClose} tall title={live ? <span className="row gap-s"><span className="code">{live.sku}</span>{live.name}</span> : t("New item")}>
      <div className="stack">
        {live && (
          <>
            <div className="tri">
              <div className="hl"><small>{t("In stock")}</small><b>{fmtQty(live.quantity)}</b><em>{live.unit}</em></div>
              <div><small>{t("Available")}</small><b>{fmtQty(live.quantity - (lv.committed.get(live.id) ?? 0))}</b><em>{t("{n} committed", { n: fmtQty(lv.committed.get(live.id) ?? 0) })}</em></div>
              {live.avg_cost !== null
                ? <div><small>{t("Value")}</small><b>{money(live.quantity * live.avg_cost)}</b><em>{t("avg {cost}", { cost: money(live.avg_cost) })}</em></div>
                : <div><small>{t("Reorder at")}</small><b>{live.min_quantity ? fmtQty(live.min_quantity) : "—"}</b><em>{live.unit}</em></div>}
            </div>
            <div className="seg-full"><Segmented value={tab} onChange={setTab} options={[
              { value: "stock", label: t("Stock") }, { value: "details", label: t("Details") }, ...(live.kind !== "material" ? [{ value: "recipe" as const, label: t("Recipe") }] : []),
            ]} /></div>
          </>
        )}
        {live && tab === "stock" && (
          <>
            {editable && (
              <div className="card flat">
                <LocationSelect value={loc} onChange={setLoc} label={t("At location")} />
                <Field label={t("Book in / out")} hint={t("e.g. +25 found, −3 scrapped")}>
                  <div className="row gap">
                    <button type="button" className="icon-btn" onClick={() => setDelta(String((Number(delta) || 0) - 1))} aria-label={t("Less")}><Minus size={16} /></button>
                    <input inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="±0" />
                    <button type="button" className="icon-btn" onClick={() => setDelta(String((Number(delta) || 0) + 1))} aria-label={t("More")}><Plus size={16} /></button>
                  </div>
                </Field>
                <Field label={t("Stocktake — counted quantity")}><input inputMode="decimal" value={count} onChange={(e) => setCount(e.target.value)} placeholder={fmtQty(loc || db.stock_levels.some((s) => s.item_id === live.id && s.location_id !== db.locations.find((l) => l.is_default)?.id && s.quantity !== 0) ? (db.stock_levels.find((s) => s.item_id === live.id && s.location_id === (loc ?? db.locations.find((l) => l.is_default)?.id))?.quantity ?? 0) : live.quantity)} /></Field>
                <Field label={t("Reason / note")}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Optional")} /></Field>
                <div className="row gap">
                  <Btn tone="soft" wide disabled={!Number(cleanNumber(delta))} onClick={async () => { await a.adjustStock(live, Number(cleanNumber(delta)), note, adjKey, loc); setDelta(""); setNote(""); setAdjKey(opKey()); }}>{t("Apply change")}</Btn>
                  <Btn tone="primary" wide icon={<ClipboardCheck size={17} />} disabled={cleanNumber(count) === ""} onClick={async () => { await a.countStock(live, Number(cleanNumber(count)), note, loc); setCount(""); setNote(""); }}>{t("Save count")}</Btn>
                </div>
              </div>
            )}
            <ItemLocations item={live} editable={editable} />
            {usedIn.length > 0 && <div className="card flat"><small className="label">{t("Used in")}</small><div className="chips">{usedIn.map((p) => <Badge key={p!.id}>{p!.sku} · {p!.name}</Badge>)}</div></div>}
            <div className="card flat">
              <small className="label"><History size={13} /> {t("History")}</small>
              {moves.length ? <MoveTable moves={moves} showItem={false} /> : <p className="muted">{t("No movements yet")}</p>}
            </div>
          </>
        )}
        {(tab === "details" || !live) && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="row gap">
              <Field label="SKU"><input required value={f.sku ?? ""} onChange={(e) => setF({ ...f, sku: e.target.value })} disabled={!editable} /></Field>
              <Field label={t("Type")}><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ItemKind })} disabled={!editable}>
                {(["material", "product", "part", "service"] as const).map((x) => <option key={x} value={x}>{kindLabel(x)}</option>)}</select></Field>
            </div>
            <Field label={t("Name")}><input required value={f.name ?? ""} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={!editable} /></Field>
            <div className="row gap">
              <Field label={t("Category")}><input value={f.category ?? ""} onChange={(e) => setF({ ...f, category: e.target.value })} list="inv-cats" disabled={!editable} /></Field>
              <Field label={t("Location")}><input value={f.location ?? ""} onChange={(e) => setF({ ...f, location: e.target.value })} disabled={!editable} /></Field>
              <Field label={t("Unit")}><input value={f.unit ?? ""} onChange={(e) => setF({ ...f, unit: e.target.value })} disabled={!editable} /></Field>
            </div>
            <datalist id="inv-cats">{[...new Set(db.stock_items.map((s) => s.category).filter(Boolean))].map((c) => <option key={c} value={c} />)}</datalist>
            <div className="row gap">
              <Field label={t("Reorder point")}><input inputMode="decimal" value={f.min_quantity ?? 0} onChange={(e) => setF({ ...f, min_quantity: Number(cleanNumber(e.target.value) || 0) })} disabled={!editable} /></Field>
              <Field label={t("Sale price (£)")}><input inputMode="decimal" value={f.sale_price ?? ""} onChange={(e) => setF({ ...f, sale_price: cleanNumber(e.target.value) ? Number(cleanNumber(e.target.value)) : null })} disabled={!editable} /></Field>
              <Field label={t("Lead time (days)")}><input inputMode="numeric" value={f.lead_days ?? ""} onChange={(e) => setF({ ...f, lead_days: e.target.value ? Number(e.target.value) || null : null })} disabled={!editable} /></Field>
            </div>
            <div className="row gap">
              <Field label={t("Supplier")}><select value={f.supplier_id ?? ""} onChange={(e) => setF({ ...f, supplier_id: e.target.value || null })} disabled={!editable}>
                <option value="">—</option>{[...db.suppliers].sort((x, y) => x.name.localeCompare(y.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
              <Field label={t("Supplier's code")}><input value={f.supplier_code ?? ""} onChange={(e) => setF({ ...f, supplier_code: e.target.value })} disabled={!editable} /></Field>
            </div>
            <Field label={t("Barcode")}><input value={f.barcode ?? ""} inputMode="text" placeholder={t("Scan or type (EAN, UPC, Code-128…)")} onChange={(e) => setF({ ...f, barcode: e.target.value.trim() || null })} disabled={!editable} /></Field>
            {live && <SupplierRefs item={live} editable={editable} />}
            {!live && (
              <div className="row gap">
                <Field label={t("Opening stock")}><input inputMode="decimal" value={open0.qty} onChange={(e) => setOpen0({ ...open0, qty: e.target.value })} placeholder="0" /></Field>
                <Field label={t("Unit cost (£)")}><input inputMode="decimal" value={open0.cost} onChange={(e) => setOpen0({ ...open0, cost: e.target.value })} placeholder="0.00" /></Field>
              </div>
            )}
            {f.kind !== "material" && (
              <div className="card flat stack">
                <small className="label">{t("Keep ready (automatic builds)")}</small>
                <p className="fine">{t("When fewer than this are on the shelf or being built, a make-to-stock job is raised for the crew — e.g. always one frame ready upstairs. 0 = off.")}</p>
                <div className="row gap">
                  <Field label={t("Keep at least")}><input inputMode="decimal" value={f.make_min ?? 0} onChange={(e) => setF({ ...f, make_min: Number(cleanNumber(e.target.value) || 0) })} disabled={!editable} /></Field>
                  <Field label={t("Build in batches of")}><input inputMode="decimal" value={f.make_batch ?? 1} onChange={(e) => setF({ ...f, make_batch: Math.max(1, Number(cleanNumber(e.target.value) || 1)) })} disabled={!editable} /></Field>
                </div>
              </div>
            )}
            <Field label={t("Notes")}><textarea rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} disabled={!editable} /></Field>
            {editable && <Btn type="submit" tone="primary" wide>{live ? t("Save details") : t("Add item")}</Btn>}
            {live && editable && <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await a.saveStock({ id: live.id, archived: true }); onClose(); }}>{t("Hold to archive item")}</HoldButton>}
          </form>
        )}
        {live && tab === "recipe" && <RecipeEditor product={live} />}
        {live && <p className="fine">{t("Last change")} {dayLabel(live.updated_at)} {clock(live.updated_at)}{live.updated_by ? ` · ${person(live.updated_by)?.full_name ?? ""}` : ""}</p>}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------- recipes -- */
export function RecipesView() {
  const { db } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const lv = useMemo(() => stockLevels(db), [db]);
  const products = db.stock_items.filter((s) => !s.archived && s.kind !== "material")
    .filter((s) => !q || `${s.sku} ${s.name}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => x.name.localeCompare(y.name));
  const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  const cur = sel ? byId.get(sel) : products[0];
  return (
    <div className="split">
      <div className="stack">
        <div className="searchbar"><Search size={18} /><input placeholder={t("Search products…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="pick-list">
          {products.map((p) => {
            const lines = db.bom_lines.filter((b) => b.product_id === p.id);
            const canMake = lines.length ? Math.max(0, Math.floor(Math.min(...lines.map((b) => ((byId.get(b.material_id)?.quantity ?? 0) - (lv.committed.get(b.material_id) ?? 0)) / b.quantity)))) : null;
            return (
              <button type="button" key={p.id} className={cur?.id === p.id ? "on" : ""} onClick={() => setSel(p.id)}>
                <span className="code">{p.sku}</span><b>{p.name}</b>
                <small className="muted">{lines.length ? t("{n} materials · can make {m}", { n: lines.length, m: canMake ?? 0 }) : t("No recipe yet")}</small>
              </button>
            );
          })}
          {!products.length && <p className="muted">{t("Mark items as Product to give them a recipe.")}</p>}
        </div>
      </div>
      <div className="card">{cur ? <><h3 className="job-h">{cur.name}</h3><RecipeEditor product={cur} /></> : <p className="muted">{t("Pick a product")}</p>}</div>
    </div>
  );
}

export function RecipeEditor({ product }: { product: StockItem }) {
  const { db, me } = useStore();
  const a = useActions();
  const editable = can.editStock(me.role);
  const [mat, setMat] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [pickKey, setPickKey] = useState(0);
  const lines = db.bom_lines.filter((b) => b.product_id === product.id);
  const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  const cost = lines.reduce((x, b) => x + b.quantity * (byId.get(b.material_id)?.avg_cost ?? 0), 0);
  return (
    <div className="stack">
      <p className="muted">{t("Materials for one {unit}. When a job for this SKU is finished, these are taken off stock × the job quantity.", { unit: product.unit })}</p>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>SKU</th><th>{t("Material")}</th><th className="num">{t("Qty per unit")}</th><th className="num">{t("In stock")}</th><th className="num">{t("Cost")}</th>{editable && <th />}</tr></thead>
          <tbody>
            {lines.map((b) => {
              const m = byId.get(b.material_id);
              return (
                <tr key={b.id} className="static">
                  <td><span className="code">{m?.sku}</span></td><td>{m?.name}</td>
                  <td className="num">{editable ? <input className="cell-input" inputMode="decimal" defaultValue={b.quantity} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v > 0 && v !== b.quantity) a.saveBomLine({ id: b.id, quantity: v }); }} /> : fmtQty(b.quantity)} <small>{m?.unit}</small></td>
                  <td className="num muted">{fmtQty(m?.quantity ?? 0)}</td>
                  <td className="num">{money(b.quantity * (m?.avg_cost ?? 0))}</td>
                  {editable && <td><button type="button" className="icon-btn subtle" onClick={() => a.removeBomLine(b.id)} aria-label={t("Remove")}><Trash2 size={15} /></button></td>}
                </tr>
              );
            })}
            {!lines.length && <tr className="static"><td colSpan={6} className="muted">{t("No materials yet")}</td></tr>}
          </tbody>
          {lines.length > 0 && <tfoot><tr><td colSpan={4}>{t("Material cost per unit")}</td><td className="num"><b>{money(cost)}</b></td>{editable && <td />}</tr></tfoot>}
        </table>
      </div>
      {editable && (
        <div className="row gap">
          <div className="grow" key={pickKey}><ItemPicker value={mat} onChange={setMat} filter={(s) => s.id !== product.id} placeholder={t("Add material — type SKU or name…")} /></div>
          <input className="qty-input" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} aria-label={t("Quantity")} />
          <Btn tone="primary" icon={<Plus size={17} />} disabled={!mat || !(Number(cleanNumber(qty)) > 0)} onClick={async () => {
            const existing = lines.find((b) => b.material_id === mat);
            await a.saveBomLine(existing ? { id: existing.id, quantity: existing.quantity + Number(cleanNumber(qty)) } : { product_id: product.id, material_id: mat!, quantity: Number(cleanNumber(qty)) });
            setMat(null); setQty("1"); setPickKey((x) => x + 1);
          }}>{t("Add")}</Btn>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- history -- */
function MoveTable({ moves, showItem = true }: { moves: DB["stock_movements"]; showItem?: boolean }) {
  const { db, person } = useStore();
  const open = useDocLink();
  const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr><th>{t("When")}</th>{showItem && <th>{t("Item")}</th>}<th className="num">{t("Change")}</th><th className="num">{t("After")}</th><th>{t("Why")}</th><th>{t("Ref")}</th><th>{t("Who")}</th></tr></thead>
        <tbody>
          {moves.map((m) => {
            const it = byId.get(m.item_id);
            return (
              <tr key={m.id} className="static">
                <td className="muted nowrap">{dayLabel(m.created_at)} {clock(m.created_at)}</td>
                {showItem && <td><span className="code">{it?.sku}</span> {it?.name}</td>}
                <td className={`num ${m.delta < 0 ? "red-t" : "ok-t"}`}><b>{m.delta > 0 ? "+" : ""}{fmtQty(m.delta)}</b></td>
                <td className="num muted">{fmtQty(m.after)}</td>
                <td>{t(REASON[m.reason])}{m.note && <small className="muted"> · {m.note}</small>}</td>
                <td className="muted">{(() => {
                  const d = open ? docOf(db, m) : null;
                  return d ? <button type="button" className="link code" onClick={() => open!(d)} title={t("Open")}>{m.ref || d.label}</button> : m.ref;
                })()}</td>
                <td className="muted">{person(m.user_id)?.full_name.split(" ")[0] ?? (m.user_id ? "—" : t("System"))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HistoryView() {
  const { db } = useStore();
  const [q, setQ] = useState("");
  const [why, setWhy] = useState<MoveReason | "all">("all");
  const byId = new Map(db.stock_items.map((s) => [s.id, s]));
  const moves = db.stock_movements
    .filter((m) => why === "all" || m.reason === why)
    .filter((m) => { if (!q) return true; const it = byId.get(m.item_id); return `${it?.sku} ${it?.name} ${m.ref} ${m.note}`.toLowerCase().includes(q.toLowerCase()); })
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  return (
    <div className="stack">
      <div className="toolbar">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search item, PO, job…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn tone="soft" icon={<Download size={17} />} onClick={() => download("stock-history.csv", toCsv(["When", "SKU", "Item", "Change", "After", "Why", "Ref", "Note"],
          moves.map((m) => [m.created_at, byId.get(m.item_id)?.sku, byId.get(m.item_id)?.name, m.delta, m.after, m.reason, m.ref, m.note])))}>{t("Export")}</Btn>
      </div>
      <div className="chips">
        <Chip on={why === "all"} onClick={() => setWhy("all")}>{t("All")}</Chip>
        {(Object.keys(REASON) as MoveReason[]).filter((r) => r !== "opening").map((r) => <Chip key={r} on={why === r} onClick={() => setWhy(r)}>{t(REASON[r])}</Chip>)}
      </div>
      {moves.length ? <MoveTable moves={moves.slice(0, 1000)} /> : <Empty icon={<History size={26} />} title={t("No stock movements yet")} />}
      <p className="fine">{t("Showing the last 120 days")}</p>
    </div>
  );
}

/* --------------------------------------------------------------- import -- */
const ITEM_FIELDS = {
  sku: ["variant code", "sku", "variant sku", "item code", "code"],
  name: ["name", "item name", "product name", "material name", "item", "variant name"],
  kind: ["type", "item type", "kind"],
  category: ["category", "category name"],
  unit: ["units of measure", "unit of measure", "uom", "unit", "units"],
  location: ["bin location", "bin", "storage location", "location"],
  quantity: ["in stock", "quantity in stock", "on hand", "stock", "quantity", "qty"],
  min_quantity: ["reorder point", "safety stock", "reorder level", "minimum", "min"],
  avg_cost: ["average cost", "avg cost", "unit cost", "default purchase price", "purchase price", "cost"],
  sale_price: ["default sales price", "sales price", "sale price", "price"],
  supplier: ["default supplier", "supplier name", "supplier"],
  supplier_code: ["supplier item code", "supplier code", "supplier sku"],
  lead_days: ["lead time days", "lead time", "purchase lead time"],
  notes: ["notes", "note", "description"],
  make_min: ["keep ready", "keep at least", "make min"],
  make_batch: ["build batch", "batch size", "make batch"],
  barcode: ["barcode", "ean", "upc", "gtin"],
};
const BOM_FIELDS = {
  product_sku: ["product variant code", "product sku", "product code", "parent sku", "product"],
  material_sku: ["ingredient variant code", "material variant code", "ingredient sku", "material sku", "component sku", "ingredient", "material", "component"],
  quantity: ["quantity", "qty", "amount"],
};
const LABELS: Record<string, string> = {
  sku: "SKU", name: "Name", kind: "Type", category: "Category", unit: "Unit", location: "Location", quantity: "In stock", min_quantity: "Reorder point",
  avg_cost: "Average cost", sale_price: "Sale price", supplier: "Supplier", supplier_code: "Supplier's code", lead_days: "Lead time (days)",
  product_sku: "Product SKU", material_sku: "Material SKU", notes: "Notes", make_min: "Keep at least", make_batch: "Build in batches of", barcode: "Barcode",
};
const NUMERIC = new Set(["quantity", "min_quantity", "avg_cost", "sale_price", "lead_days", "make_min", "make_batch"]);

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useActions();
  const [what, setWhat] = useState<"items" | "bom">("items");
  const [kind, setKind] = useState<"column" | ItemKind>("column");
  const [rows, setRows] = useState<string[][] | null>(null);
  const [file, setFile] = useState("");
  const [map, setMap] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<ImportCheck[] | null>(null);
  const { backend: B } = useStore();
  const fields = what === "items" ? ITEM_FIELDS : BOM_FIELDS;
  const header = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];
  const load = async (f: File) => {
    const parsed = parseCsv(await f.text());
    setFile(f.name); setRows(parsed);
    setMap(guessColumns(parsed[0] ?? [], fields as Record<string, string[]>));
  };
  const build = () => body.map((r) => {
    const o: Record<string, string> = {};
    for (const [k, i] of Object.entries(map)) if (i >= 0) o[k] = NUMERIC.has(k) ? cleanNumber(r[i]) : (r[i] ?? "").trim();
    if (what === "items" && kind !== "column") o.kind = kind;
    if (what === "items" && o.kind) o.kind = /prod/i.test(o.kind) ? "product" : /part|semi|sub/i.test(o.kind) ? "part" : /serv/i.test(o.kind) ? "service" : "material";
    return o;
  });
  const required = what === "items" ? ["sku"] : ["product_sku", "material_sku", "quantity"];
  const ready = rows && required.every((k) => (map[k] ?? -1) >= 0);
  const reset = () => { setRows(null); setFile(""); setMap({}); setCheck(null); };
  // Dry run on the server: same rules as the import, nothing written (CAT-08 / ADMIN-08).
  const runCheck = async () => {
    setBusy(true);
    try {
      const all = build(); const out: ImportCheck[] = [];
      for (let i = 0; i < all.length; i += 2000) {
        const part = await B.rpc<ImportCheck[]>("check_import", { p_kind: what, p_rows: all.slice(i, i + 2000) });
        out.push(...part.map((r) => ({ ...r, row: r.row + i })));
      }
      setCheck(out);
    } catch (e) { setCheck(null); alert(e instanceof Error ? t(e.message) : String(e)); }
    setBusy(false);
  };
  const clean = check ? build().filter((_, i) => check[i]?.action !== "error") : [];
  const errors = check?.filter((c) => c.action === "error") ?? [];
  return (
    <Sheet open={open} onClose={() => { reset(); onClose(); }} tall title={t("Import from Katana (CSV)")}>
      <div className="stack">
        <div className="seg-full"><Segmented value={what} onChange={(v) => { setWhat(v); reset(); }} options={[{ value: "items", label: t("Items & stock") }, { value: "bom", label: t("Recipes (BOM)") }]} /></div>
        <p className="muted">{what === "items"
          ? t("Export materials, products or inventory from Katana as CSV and pick the file. Items are matched on SKU, so importing again updates them. In-stock numbers become the current stock (logged as Import).")
          : t("Export recipes from Katana as CSV: one row per product + ingredient + quantity. Each product in the file gets its recipe replaced. Import items first.")}</p>
        <label className="file-drop">
          <Upload size={22} /><b>{file || t("Choose a CSV file")}</b><small className="muted">{rows ? t("{n} rows found", { n: body.length }) : t("Save Excel files as CSV first")}</small>
          <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        </label>
        {rows && (
          <>
            {what === "items" && (
              <Field label={t("These rows are")}>
                <div className="chips">
                  {(["column", "material", "product", "part", "service"] as const).map((k) => <Chip key={k} on={kind === k} onClick={() => { setKind(k); setCheck(null); }}>{k === "column" ? t("Use Type column / materials") : kindLabel(k)}</Chip>)}
                </div>
              </Field>
            )}
            <div className="map-grid">
              {Object.keys(fields).map((k) => (
                <Field key={k} label={`${t(LABELS[k] ?? k)}${required.includes(k) ? " *" : ""}`}>
                  <select value={map[k] ?? -1} onChange={(e) => { setMap({ ...map, [k]: Number(e.target.value) }); setCheck(null); }}>
                    <option value={-1}>— {t("not in file")} —</option>
                    {header.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <small className="label">{t("Preview")}</small>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>{Object.keys(fields).filter((k) => (map[k] ?? -1) >= 0).map((k) => <th key={k}>{t(LABELS[k] ?? k)}</th>)}</tr></thead>
                <tbody>{build().slice(0, 6).map((o, i) => <tr key={i} className="static">{Object.keys(fields).filter((k) => (map[k] ?? -1) >= 0).map((k) => <td key={k}>{o[k]}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {!check ? (
              <Btn tone="primary" wide busy={busy} disabled={!ready} icon={<ClipboardCheck size={18} />} onClick={runCheck}>{t("Check {n} rows", { n: body.length })}</Btn>
            ) : (
              <>
                <div className="chips">
                  <Badge tone="ok">{t("{n} new", { n: check.filter((c) => c.action === "create").length })}</Badge>
                  <Badge tone="blue">{t("{n} updated", { n: check.filter((c) => c.action === "update").length })}</Badge>
                  <Badge tone={errors.length ? "red" : "muted"}>{t("{n} with problems", { n: errors.length })}</Badge>
                </div>
                {(errors.length > 0 || check.some((c) => c.changes.length)) && (
                  <div className="tbl-wrap" style={{ maxHeight: 280, overflow: "auto" }}>
                    <table className="tbl">
                      <thead><tr><th className="num">{t("Row")}</th><th>{t("Item")}</th><th>{t("Result")}</th><th>{t("Details")}</th></tr></thead>
                      <tbody>
                        {[...errors, ...check.filter((c) => c.action !== "error" && c.changes.length)].slice(0, 300).map((c) => (
                          <tr key={c.row} className="static">
                            <td className="num muted">{c.row + 1}</td>
                            <td><span className="code">{c.key || "—"}</span></td>
                            <td><Badge tone={c.action === "error" ? "red" : c.action === "create" ? "ok" : "blue"}>{t(c.action === "error" ? "Skipped" : c.action === "create" ? "New" : "Update")}</Badge></td>
                            <td className={c.action === "error" ? "red-t fine" : "fine"}>{(c.action === "error" ? c.problems : c.changes).join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="fine">{t("Row numbers count the header as row 1, like a spreadsheet. Rows with problems are skipped — fix them in the file and import it again.")}</p>
                <div className="row gap">
                  <Btn tone="ghost" onClick={() => setCheck(null)}>{t("Back")}</Btn>
                  <Btn tone="primary" wide busy={busy} disabled={!clean.length} icon={<Upload size={18} />} onClick={async () => {
                    setBusy(true);
                    const n = await a.importRows(what, clean).catch(() => null);
                    setBusy(false);
                    if (n !== null) { reset(); onClose(); }
                  }}>{t("Import {n} rows", { n: clean.length })}</Btn>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Items whose supplier reference matches a search (CAT-05). */
function refsBySku(db: DB, q: string) {
  const v = q.trim().toLowerCase();
  return new Set(v.length < 2 ? [] : db.item_suppliers.filter((r) => r.supplier_sku.toLowerCase().includes(v)).map((r) => r.item_id));
}

/** Every supplier that sells this item, with their code, price and lead time (CAT-05). */
function SupplierRefs({ item, editable }: { item: StockItem; editable: boolean }) {
  const { db, backend: B, refresh } = useStore();
  const [sup, setSup] = useState("");
  const [code, setCode] = useState("");
  const [cost, setCost] = useState("");
  const [lead, setLead] = useState("");
  const [err, setErr] = useState("");
  const refs = db.item_suppliers.filter((r) => r.item_id === item.id);
  const names = new Map(db.suppliers.map((s) => [s.id, s]));
  const save = async (fn: () => Promise<unknown>) => {
    setErr("");
    try { await fn(); await refresh("item_suppliers"); return true; } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); return false; }
  };
  return (
    <div className="card flat stack">
      <small className="label">{t("Suppliers for this item")}</small>
      {refs.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t("Supplier")}</th><th>{t("Their code")}</th><th className="num">{t("Price")}</th><th className="num">{t("Lead time")}</th><th /></tr></thead>
            <tbody>
              {refs.map((r) => {
                const s = names.get(r.supplier_id);
                return (
                  <tr key={r.id} className="static">
                    <td>{s?.name}{r.preferred && <Badge tone="ok">{t("Preferred")}</Badge>}</td>
                    <td><span className="code">{r.supplier_sku || "—"}</span></td>
                    <td className="num">{r.unit_cost === null ? "—" : `${r.unit_cost.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${s?.currency ?? ""}`}</td>
                    <td className="num">{r.lead_days === null ? "—" : t("{n} d", { n: r.lead_days })}</td>
                    <td className="nowrap">{editable && <>
                      {!r.preferred && <Btn small tone="ghost" onClick={() => save(async () => {
                        for (const o of refs) if (o.preferred) await B.update("item_suppliers", o.id, { preferred: false });
                        await B.update("item_suppliers", r.id, { preferred: true });
                      })}>{t("Preferred")}</Btn>}
                      <button type="button" className="icon-btn subtle" aria-label={t("Remove")} onClick={() => save(() => B.remove("item_suppliers", r.id))}><Trash2 size={14} /></button>
                    </>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="muted">{t("No supplier references yet.")}</p>}
      {editable && (
        <div className="row gap wrap">
          <select value={sup} onChange={(e) => setSup(e.target.value)} aria-label={t("Supplier")}>
            <option value="">{t("Add supplier…")}</option>
            {[...db.suppliers].filter((s) => !refs.some((r) => r.supplier_id === s.id)).sort((x, y) => x.name.localeCompare(y.name)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input className="qty-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("Their code")} aria-label={t("Their code")} />
          <input className="qty-input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={t("Price")} aria-label={t("Price")} />
          <input className="qty-input" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} placeholder={t("Days")} aria-label={t("Lead time")} />
          <Btn tone="soft" small icon={<Plus size={15} />} disabled={!sup} onClick={async () => {
            const ok = await save(() => B.insert("item_suppliers", { item_id: item.id, supplier_id: sup, supplier_sku: code.trim(),
              unit_cost: cleanNumber(cost) ? Number(cleanNumber(cost)) : null, lead_days: /^\d+$/.test(lead.trim()) ? Number(lead.trim()) : null, preferred: !refs.length }));
            if (ok) { setSup(""); setCode(""); setCost(""); setLead(""); }
          }}>{t("Add")}</Btn>
        </div>
      )}
      {err && <p className="hint red-t">{err}</p>}
    </div>
  );
}

interface ImportCheck { row: number; key: string; action: "create" | "update" | "error"; problems: string[]; changes: string[] }

/** Stock of one item per location, with its bin there (INV-01, INV-07). */
export function ItemLocations({ item, editable }: { item: StockItem; editable: boolean }) {
  const { db, backend: B, refresh } = useStore();
  const names = new Map(db.locations.map((l) => [l.id, l]));
  const rows = db.stock_levels.filter((s) => s.item_id === item.id && (s.quantity !== 0 || s.bin) && names.get(s.location_id))
    .sort((a, b) => Number(names.get(b.location_id)!.is_default) - Number(names.get(a.location_id)!.is_default));
  if (!rows.length) return null;
  return (
    <div className="card flat stack">
      <small className="label"><MapPin size={13} /> {t("By location")}</small>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Location")}</th><th>{t("Bin")}</th><th className="num">{t("Quantity")}</th></tr></thead>
          <tbody>{rows.map((r) => {
            const l = names.get(r.location_id)!;
            return (
              <tr key={r.location_id} className="static">
                <td>{l.name}{l.kind === "transit" && <Badge tone="blue">{t("moving")}</Badge>}</td>
                <td>{editable && l.kind !== "transit"
                  ? <input className="cell-input wide" defaultValue={r.bin} key={r.bin} placeholder="—" onBlur={async (e) => { if (e.target.value.trim() !== r.bin) { await B.rpc("set_bin", { p_item: item.id, p_location: r.location_id, p_bin: e.target.value }); await Promise.all([refresh("stock_levels"), refresh("stock_items")]); } }} />
                  : r.bin || "—"}</td>
                <td className={`num ${r.quantity < 0 ? "red-t" : ""}`}><b>{fmtQty(r.quantity)}</b> <small>{item.unit}</small></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}
