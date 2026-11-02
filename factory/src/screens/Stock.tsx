import { AnimatePresence, motion } from "motion/react";
import { Boxes, MapPin, Minus, Pencil, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Btn, Chip, Empty, Field, Section, Sheet, item, list } from "../components/ui";
import { useActions } from "../lib/actions";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { t } from "../lib/i18n";
import { Scene } from "../components/Scene";
import { ago } from "../lib/time";
import type { StockItem } from "../lib/types";

export function Stock() {
  const { db, me, person } = useStore();
  const a = useActions();
  const [q, setQ] = useState("");
  const [low, setLow] = useState(false);
  const [edit, setEdit] = useState<StockItem | "new" | null>(null);
  const editable = can.editStock(me.role);
  const items = db.stock_items
    .filter((s) => !low || s.quantity <= s.min_quantity)
    .filter((s) => !q || `${s.sku} ${s.name} ${s.location}`.toLowerCase().includes(q.toLowerCase()))
    .sort((x, y) => Number(y.quantity <= y.min_quantity) - Number(x.quantity <= x.min_quantity) || x.name.localeCompare(y.name));
  const lowCount = db.stock_items.filter((s) => s.quantity <= s.min_quantity).length;
  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <motion.div className="hero" variants={item}>
        <Scene kind="warehouse" height={170}><div className="scene-title"><h1>{t("Stock")}</h1><p>{editable ? t("Tap − / + to book parts in and out.") : t("Read-only — ask an assistant or the office to adjust stock.")}</p></div></Scene>
      </motion.div>
      <Section title="">
        <div className="searchbar"><Search size={18} /><input placeholder={t("Search SKU, part, location…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="chips"><Chip on={low} onClick={() => setLow(!low)}>{t("Low stock")}{lowCount ? ` · ${lowCount}` : ""}</Chip></div>
        <motion.div className="stack" variants={list} initial="hidden" animate="show">
          {items.map((s) => {
            const isLow = s.quantity <= s.min_quantity;
            const pct = Math.min(1, s.quantity / Math.max(1, s.min_quantity * 2));
            return (
              <motion.div key={s.id} className={`card stock ${isLow ? "low" : ""}`} variants={item} layout>
                <div className="grow">
                  <div className="row gap-s"><span className="code">{s.sku}</span>{isLow && <Badge tone="red">{t("Low")}</Badge>}</div>
                  <b>{s.name}</b>
                  <small className="muted"><MapPin size={12} /> {s.location || "—"} · {ago(s.updated_at)}{s.updated_by && ` · ${person(s.updated_by)?.full_name.split(" ")[0]}`}</small>
                  <div className="bar"><motion.i initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} className={isLow ? "over" : ""} /></div>
                </div>
                <div className="qty">
                  {editable && <motion.button whileTap={{ scale: 0.85 }} className="step" onClick={() => a.adjustStock(s, -1)} aria-label={t("Remove one")}><Minus size={16} /></motion.button>}
                  <AnimatePresence mode="popLayout"><motion.b key={s.quantity} className="mono" initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 10, opacity: 0 }}>{s.quantity}</motion.b></AnimatePresence>
                  <small>{s.unit}</small>
                  {editable && <motion.button whileTap={{ scale: 0.85 }} className="step" onClick={() => a.adjustStock(s, 1)} aria-label={t("Add one")}><Plus size={16} /></motion.button>}
                </div>
                {editable && <button className="icon-btn subtle" onClick={() => setEdit(s)} aria-label={t("Edit")}><Pencil size={15} /></button>}
              </motion.div>
            );
          })}
          {!items.length && <Empty icon={<Boxes size={28} />} title={t("Nothing found")} hint={low ? t("No items below minimum") : t("Try another search.")} />}
        </motion.div>
      </Section>
      {editable && <motion.button className="fab" onClick={() => setEdit("new")} initial={{ scale: 0 }} animate={{ scale: 1 }} whileTap={{ scale: 0.9 }} aria-label={t("Add item")}><Plus size={26} /></motion.button>}
      <StockEditor item={edit} onClose={() => setEdit(null)} />
    </motion.div>
  );
}

function StockEditor({ item: it, onClose }: { item: StockItem | "new" | null; onClose: () => void }) {
  const a = useActions();
  const blank = { sku: "", name: "", location: "", unit: "pcs", quantity: 0, min_quantity: 0 };
  const [f, setF] = useState(blank);
  const [delta, setDelta] = useState("");
  useEffect(() => { if (it) { setF(it === "new" ? blank : { sku: it.sku, name: it.name, location: it.location, unit: it.unit, quantity: it.quantity, min_quantity: it.min_quantity }); setDelta(""); } }, [it]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={!!it} onClose={onClose} title={it === "new" ? t("Add stock item") : t("Edit stock")}>
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); await a.saveStock({ ...f, id: it && it !== "new" ? it.id : undefined }); onClose(); }}>
        {it !== "new" && (
          <Field label={t("Book in / out")} hint={t("e.g. +250 delivery or −40 issued to line")}>
            <div className="row gap">
              <input type="number" inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="±0" />
              <Btn tone="soft" disabled={!Number(delta)} onClick={() => { setF({ ...f, quantity: Math.max(0, f.quantity + Number(delta)) }); setDelta(""); }}>{t("Apply")}</Btn>
            </div>
          </Field>
        )}
        <div className="row gap">
          <Field label="SKU"><input required value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} /></Field>
          <Field label={t("Location")}><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        </div>
        <Field label={t("Name")}><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <div className="row gap">
          <Field label={t("Quantity")}><input type="number" min={0} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
          <Field label={t("Minimum")}><input type="number" min={0} value={f.min_quantity} onChange={(e) => setF({ ...f, min_quantity: Number(e.target.value) })} /></Field>
          <Field label={t("Unit")}><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        </div>
        <div className="sheet-foot"><Btn type="submit" tone="primary" wide>{t("Save")}</Btn></div>
      </form>
    </Sheet>
  );
}
