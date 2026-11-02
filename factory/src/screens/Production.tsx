import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ArrowUp, Check, Copy, Package, Plus, Search, ShoppingBag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/Avatar";
import { useToast } from "../components/Toast";
import { Badge, Btn, Empty, Field, HoldButton, Segmented, Sheet, Toggle } from "../components/ui";
import { useActions, useStations } from "../lib/actions";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import { ago } from "../lib/time";
import type { Product, Station } from "../lib/types";
import { RoutePicker } from "./Jobs";

const SUPA = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
export const WEBHOOK_URL = `${SUPA.replace(/\/$/, "")}/functions/v1/shopify-webhook`;

/** Boss / manager: stations and who works there, products and their routes, the Shopify link. */
export function ProductionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"stations" | "products" | "shopify">("stations");
  return (
    <Sheet open={open} onClose={onClose} tall title={t("Production setup")}>
      <div className="stack">
        <div className="seg-full"><Segmented value={tab} onChange={setTab} options={[
          { value: "stations", label: t("Stations") }, { value: "products", label: t("Products") }, { value: "shopify", label: "Shopify" },
        ]} /></div>
        {tab === "stations" ? <Stations /> : tab === "products" ? <Products /> : <ShopifyLink />}
      </div>
    </Sheet>
  );
}

function Stations() {
  const stations = useStations();
  const a = useActions();
  const [name, setName] = useState("");
  return (
    <div className="stack">
      <p className="muted">{t("Jobs travel through these stations in order. Everyone at a station sees its jobs on their Jobs tab automatically.")}</p>
      {stations.list.map((s, i) => <StationCard key={s.id} s={s} first={i === 0} last={i === stations.list.length - 1} />)}
      <form className="row gap" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await a.saveStation({ name: name.trim() }); setName(""); }}>
        <input placeholder={t("New station, e.g. Powder coating")} value={name} onChange={(e) => setName(e.target.value)} />
        <Btn type="submit" tone="primary" icon={<Plus size={18} />} disabled={!name.trim()}>{t("Add")}</Btn>
      </form>
    </div>
  );
}

function StationCard({ s, first, last }: { s: Station; first: boolean; last: boolean }) {
  const { db } = useStore();
  const stations = useStations();
  const a = useActions();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(s.name);
  const crew = stations.crew(s.id);
  const staff = db.profiles.filter((p) => p.active).sort((x, y) => Number(crew.includes(y.id)) - Number(crew.includes(x.id)) || x.full_name.localeCompare(y.full_name));
  const waiting = db.jobs.filter((j) => j.station_id === s.id && j.status !== "done").length;
  return (
    <div className="card station-card">
      <div className="row gap">
        <span className="station-no">{stations.list.indexOf(s) + 1}</span>
        <input className="station-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== s.name && a.saveStation({ id: s.id, name: name.trim() })} aria-label={t("Station name")} />
        <button type="button" className="icon-btn subtle" disabled={first} onClick={() => a.moveStation(s, -1)} aria-label={t("Move up")}><ArrowUp size={17} /></button>
        <button type="button" className="icon-btn subtle" disabled={last} onClick={() => a.moveStation(s, 1)} aria-label={t("Move down")}><ArrowDown size={17} /></button>
      </div>
      <button type="button" className="row between station-crew" onClick={() => setOpen(!open)}>
        <span className="row gap-s wrap">
          {crew.length ? crew.map((id) => { const p = db.profiles.find((x) => x.id === id); return <span key={id} className="who"><Avatar p={p} size={22} />{p?.full_name.split(" ")[0]}</span>; })
            : <span className="muted">{t("Nobody assigned — tap to add people")}</span>}
        </span>
        <Badge>{t("{n} waiting", { n: waiting })}</Badge>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="stack" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }}>
            <div className="pick-grid">
              {staff.map((p) => {
                const on = crew.includes(p.id);
                return (
                  <motion.button type="button" key={p.id} className={`pick ${on ? "on" : ""}`} whileTap={{ scale: 0.92 }} onClick={() => a.setStationMember(s.id, p.id, !on)}>
                    <Avatar p={p} size={42} />
                    {on && <i className="pick-check"><Check size={12} /></i>}
                    <small>{p.full_name.split(" ")[0]}</small>
                  </motion.button>
                );
              })}
            </div>
            <div className="set"><span><b>{t("Part of the standard route")}</b><small>{t("New products from Shopify go through this station")}</small></span>
              <Toggle on={s.in_default} onChange={(v) => a.saveStation({ id: s.id, in_default: v })} /></div>
            <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={() => a.deleteStation(s)}>{t("Hold to remove station")}</HoldButton>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Products() {
  const { db } = useStore();
  const stations = useStations();
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<Partial<Product> | null>(null);
  const list = [...db.products].filter((p) => !q || `${p.sku} ${p.name}`.toLowerCase().includes(q.toLowerCase())).sort((x, y) => x.sku.localeCompare(y.sku));
  if (edit) return <ProductForm p={edit} onDone={() => setEdit(null)} />;
  return (
    <div className="stack">
      <p className="muted">{t("Each Shopify SKU follows its own route. New SKUs are added here automatically with the standard route — change it if a product skips a station.")}</p>
      <div className="row gap">
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search SKU or name…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <Btn tone="primary" icon={<Plus size={18} />} onClick={() => setEdit({ sku: "", name: "", route: stations.list.filter((s) => s.in_default).map((s) => s.id), estimate_minutes: null })}>{t("Add")}</Btn>
      </div>
      {list.map((p) => (
        <button type="button" key={p.id} className="card product-row" onClick={() => setEdit(p)}>
          <span className="row between"><span className="code">{p.sku}</span>{p.estimate_minutes ? <small className="muted">{Math.round(p.estimate_minutes / 6) / 10} h</small> : null}</span>
          <b>{p.name || "—"}</b>
          <small className="muted">{p.route.length ? p.route.map((id) => stations.name(id)).join(" → ") : t("Standard route")}</small>
        </button>
      ))}
      {!list.length && <Empty icon={<Package size={26} />} title={t("No products yet")} hint={t("They appear here with the first Shopify order, or add them yourself.")} />}
      {db.products.length > 0 && <p className="fine">{t("{n} products", { n: db.products.length })}</p>}
    </div>
  );
}

function ProductForm({ p, onDone }: { p: Partial<Product>; onDone: () => void }) {
  const a = useActions();
  const [f, setF] = useState({ sku: p.sku ?? "", name: p.name ?? "", route: p.route ?? [], hours: p.estimate_minutes ? String(p.estimate_minutes / 60) : "" });
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      await a.saveProduct({ id: p.id, sku: f.sku.trim(), name: f.name.trim(), route: f.route, estimate_minutes: f.hours ? Math.round(Number(f.hours) * 60) : null });
      onDone();
    }}>
      <Field label={t("Shopify SKU")}><input required value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} placeholder="SK-0123" disabled={!!p.id} /></Field>
      <Field label={t("Name")}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="A32X Pedestal" /></Field>
      <Field label={t("Estimate per job (hours)")}><input type="number" min={0} step={0.25} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
      <Field label={t("Route — stations in order")}><RoutePicker value={f.route} onChange={(route) => setF({ ...f, route })} /></Field>
      <div className="row gap">
        <Btn tone="ghost" wide onClick={onDone}>{t("Cancel")}</Btn>
        <Btn type="submit" tone="primary" wide icon={<Check size={18} />}>{t("Save")}</Btn>
      </div>
      {p.id && <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await a.deleteProduct(p as Product); onDone(); }}>{t("Hold to remove product")}</HoldButton>}
    </form>
  );
}

function ShopifyLink() {
  const { db } = useStore();
  const toast = useToast();
  const last = [...db.orders].sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
  return (
    <div className="stack">
      <div className={`card ${last ? "" : "pending-card"}`}>
        <div className="row gap"><ShoppingBag size={22} />
          <div className="grow"><b>{last ? t("Connected — orders are arriving") : t("Waiting for the first order")}</b>
            <small className="muted">{last ? t("Last order {order} · {ago}", { order: last.order_number, ago: ago(last.created_at) }) : t("Finish the steps below in Shopify.")}</small></div>
        </div>
      </div>
      <ol className="steps">
        <li>{t("In Shopify admin open Settings → Notifications → Webhooks.")}</li>
        <li>{t("Create webhook: event “Order creation”, format JSON, and this URL:")}
          <div className="link-box"><span>{WEBHOOK_URL}</span>
            <button type="button" className="icon-btn subtle" onClick={async () => { try { await navigator.clipboard.writeText(WEBHOOK_URL); toast(t("Copied"), "info"); } catch { /* ignore */ } }} aria-label={t("Copy")}><Copy size={17} /></button></div>
        </li>
        <li>{t("Copy the signing secret Shopify shows under the webhooks list and send it to whoever set up the app, so orders can be verified.")}</li>
      </ol>
      <p className="hint">{t("Each order line becomes a job at the first station of its product's route, with the order number, customer, delivery address and quantity filled in.")}</p>
    </div>
  );
}
