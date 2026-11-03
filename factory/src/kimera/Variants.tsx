import { Layers, Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Btn, Field } from "../components/ui";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import { useToast } from "../components/Toast";
import type { StockItem } from "../lib/types";

const fmt = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-GB", { maximumFractionDigits: 3 });

/** "Czarny · XL" from an item's option values, in the family's option order. */
export function variantLabel(it: Pick<StockItem, "variant">, options?: string[]) {
  const v = it.variant ?? {};
  const keys = options?.length ? options.filter((k) => v[k]) : Object.keys(v);
  return keys.map((k) => v[k]).join(" · ");
}

/** CAT-02/06: put an item in a product family, see its siblings and add a new variant (copies recipe, steps and suppliers). */
export function VariantPanel({ item, onOpen }: { item: StockItem; onOpen?: (it: StockItem) => void }) {
  const { db, me, backend: B, refresh } = useStore();
  const toast = useToast();
  const editable = can.editStock(me.role);
  const fam = item.family_id ? db.product_families.find((f) => f.id === item.family_id) : undefined;
  const [setup, setSetup] = useState<{ name: string; options: string; values: Record<string, string> } | null>(null);
  const [nv, setNv] = useState<{ sku: string; name: string; values: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); await Promise.all([refresh("stock_items"), refresh("product_families"), refresh("bom_lines"), refresh("product_operations"), refresh("item_suppliers"), refresh("products")]); toast(t(msg), "ok"); return true; }
    catch (e) { toast(e instanceof Error ? t(e.message) : String(e), "error"); return false; }
    finally { setBusy(false); }
  };
  const optsOf = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  if (!fam) {
    if (!editable) return null;
    return (
      <div className="card flat stack">
        <small className="label"><Layers size={13} /> {t("Variants")}</small>
        {!setup ? <>
          <p className="fine" style={{ textAlign: "left" }}>{t("Sell this in several versions (colour, size, firmware…)? Make it a family: each variant keeps its own SKU, stock and recipe.")}</p>
          <Btn small tone="soft" icon={<Layers size={15} />} onClick={() => setSetup({ name: item.name, options: "", values: {} })}>{t("Set up variants")}</Btn>
        </> : <>
          <Field label={t("Family name")}><input value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></Field>
          <Field label={t("Options")} hint={t("Comma-separated, e.g. Colour, Size")}><input value={setup.options} onChange={(e) => setSetup({ ...setup, options: e.target.value })} placeholder={t("Colour, Size")} /></Field>
          {optsOf(setup.options).map((o) => <Field key={o} label={t("{o} of this item", { o })}><input value={setup.values[o] ?? ""} onChange={(e) => setSetup({ ...setup, values: { ...setup.values, [o]: e.target.value } })} /></Field>)}
          <div className="row gap">
            <Btn tone="ghost" onClick={() => setSetup(null)}>{t("Cancel")}</Btn>
            <Btn tone="primary" wide disabled={busy || !setup.name.trim() || !optsOf(setup.options).length || optsOf(setup.options).some((o) => !setup.values[o]?.trim())} onClick={async () => {
              const options = optsOf(setup.options);
              const ok = await run(async () => {
                const f = await B.insert("product_families", { name: setup.name.trim(), options, category: item.category });
                await B.update("stock_items", item.id, { family_id: f.id, variant: Object.fromEntries(options.map((o) => [o, setup.values[o].trim()])) });
              }, "Variant family created");
              if (ok) setSetup(null);
            }}>{t("Create family")}</Btn>
          </div>
        </>}
      </div>
    );
  }

  const sibs = db.stock_items.filter((s) => s.family_id === fam.id && !s.archived)
    .sort((a, b) => variantLabel(a, fam.options).localeCompare(variantLabel(b, fam.options)));
  return (
    <div className="card flat stack">
      <div className="row between"><small className="label"><Layers size={13} /> {t("Family")}: {fam.name}</small><Badge>{t("{n} variants", { n: sibs.length })}</Badge></div>
      <div className="chips">{fam.options.map((o) => <Badge key={o} tone="muted">{o}: <b>{item.variant?.[o] ?? "—"}</b></Badge>)}</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>SKU</th>{fam.options.map((o) => <th key={o}>{o}</th>)}<th className="num">{t("In stock")}</th></tr></thead>
          <tbody>{sibs.map((s) => (
            <tr key={s.id} className={s.id === item.id ? "static sel" : ""} onClick={() => s.id !== item.id && onOpen?.(s)}>
              <td><span className="code">{s.sku}</span></td>{fam.options.map((o) => <td key={o}>{s.variant?.[o] ?? ""}</td>)}<td className="num">{fmt(s.quantity)}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {editable && (!nv ? (
        <Btn small tone="soft" icon={<Plus size={15} />} onClick={() => setNv({ sku: "", name: "", values: { ...(item.variant ?? {}) } })}>{t("New variant")}</Btn>
      ) : (
        <div className="stack">
          <p className="fine" style={{ textAlign: "left" }}>{t("Copies {sku}'s recipe, operations, suppliers and route. Stock starts at 0.", { sku: item.sku })}</p>
          <div className="row gap wrap">{fam.options.map((o) => <Field key={o} label={o}><input value={nv.values[o] ?? ""} onChange={(e) => setNv({ ...nv, values: { ...nv.values, [o]: e.target.value } })} /></Field>)}</div>
          <div className="row gap">
            <Field label="SKU"><input value={nv.sku} onChange={(e) => setNv({ ...nv, sku: e.target.value })} placeholder={`${item.sku}-…`} /></Field>
            <Field label={t("Name")}><input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder={`${fam.name} ${fam.options.map((o) => nv.values[o]).filter(Boolean).join(" ")}`} /></Field>
          </div>
          <div className="row gap">
            <Btn tone="ghost" onClick={() => setNv(null)}>{t("Cancel")}</Btn>
            <Btn tone="primary" wide disabled={busy || !nv.sku.trim() || fam.options.some((o) => !nv.values[o]?.trim())} onClick={async () => {
              const variant = Object.fromEntries(fam.options.map((o) => [o, nv.values[o].trim()]));
              const ok = await run(() => B.rpc("create_variant", { p_from: item.id, p_sku: nv.sku.trim(), p_name: nv.name.trim() || `${fam.name} ${Object.values(variant).join(" ")}`, p_variant: variant }), "Variant added");
              if (ok) setNv(null);
            }}>{t("Add variant")}</Btn>
          </div>
        </div>
      ))}
    </div>
  );
}
