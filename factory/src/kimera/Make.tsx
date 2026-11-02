import { CheckCircle2, ChevronDown, ChevronUp, Factory, PackagePlus, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { opKey } from "../lib/actions";
import { moCell, useAvailability } from "./availability";
import { LocationSelect } from "../components/LocationSelect";
import { useMemo, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Chip, Empty, Field, HoldButton, Segmented, Sheet } from "../components/ui";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { Job } from "../lib/types";
import { ItemPicker, fmtQty } from "../screens/Inventory";
import { RoutePicker } from "../screens/Jobs";
import { RouteDots, STATUS, jobCode, statusLabel } from "../screens/parts";
import { useKimera } from "./actions";
import { PageHead, Pill, fullDate, shortDate } from "./kit";
import { analyse, moIngredients, type Cell } from "./status";

export function Make({ openId, onOpen, onOrder, creating, setCreating }: {
  openId: string | null; onOpen: (id: string | null) => void; onOrder: (id: string) => void; creating: boolean; setCreating: (v: boolean) => void;
}) {
  const { db, me, person } = useStore();
  const [done, setDone] = useState(false);
  const [kind, setKind] = useState<"all" | "order" | "stock">("all");
  const [q, setQ] = useState("");
  const av = useAvailability();
  const info = useMemo(() => analyse(db, av), [db, av]);
  const ingr = useMemo(() => {
    const m = new Map<string, Cell>();
    for (const o of info.values()) for (const l of o.lines) if (l.mo) m.set(l.mo.id, l.ingredients);
    const names = new Map(db.stock_items.map((s) => [s.id, s.sku]));
    if (av) for (const [id, a] of Object.entries(av.mos)) if (!m.has(id)) m.set(id, moCell(a, names));
    return m;
  }, [info, av, db.stock_items]);
  const stations = new Map(db.stations.map((s) => [s.id, s.name]));
  const orders = new Map(db.orders.map((o) => [o.id, o]));
  const effRank = (j: Job) => (j.order_id ? orders.get(j.order_id)?.rank : j.rank) ?? Date.parse(j.created_at) / 1000;
  const k = useKimera();
  // Manufacturing orders = routed jobs (Shopify lines, sales lines, stock builds).
  const rows = db.jobs.filter((j) => j.route?.length || j.order_id || j.code.startsWith("STK-"))
    .filter((j) => (done ? j.status === "done" : j.status !== "done"))
    .filter((j) => kind === "all" || (kind === "order" ? !!j.order_id : !j.order_id))
    .filter((j) => !q || `${j.code} ${jobCode(j)} ${j.title} ${j.sku ?? ""} ${j.customer}`.toLowerCase().includes(q.toLowerCase()))
    // Open MOs in queue order: the rank allocation uses (MTO MOs follow their sales order).
    .sort((a, b) => done ? (b.completed_at ?? "").localeCompare(a.completed_at ?? "") : effRank(a) - effRank(b) || a.created_at.localeCompare(b.created_at));
  const editable = can.admin(me.role);
  const cur = openId ? db.jobs.find((j) => j.id === openId) ?? null : null;

  return (
    <div className="k-page">
      <PageHead title={t("Make")} sub={t("Manufacturing orders — the same jobs your crews see in the Factory app.")}
        actions={editable && <Btn tone="primary" small icon={<Plus size={16} />} onClick={() => setCreating(true)}>{t("Manufacturing order")}</Btn>} />
      <div className="toolbar">
        <Segmented size="s" value={done ? "done" : "open"} onChange={(v) => setDone(v === "done")} options={[{ value: "open", label: t("Open") }, { value: "done", label: t("Done") }]} />
        <div className="chips">
          <Chip on={kind === "all"} onClick={() => setKind("all")}>{t("All")}</Chip>
          <Chip on={kind === "order"} onClick={() => setKind("order")}>{t("Make to order")}</Chip>
          <Chip on={kind === "stock"} onClick={() => setKind("stock")}>{t("Make to stock")}</Chip>
        </div>
        <div className="searchbar grow"><Search size={18} /><input placeholder={t("Search MO, product, customer…")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {!done && <KeptReady />}
      {rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl k-tbl">
            <thead><tr>
              <th>MO #</th><th>{t("Created")}</th><th>{t("Product")}</th><th className="num">{t("Qty")}</th><th>{t("Sales order")}</th><th>{t("Deadline")}</th>
              <th>{t("Ingredients")}</th><th>{t("Station")}</th><th>{t("Crew")}</th><th>{t("Status")}</th>
            </tr></thead>
            <tbody>
              {rows.map((j) => {
                const o = j.order_id ? orders.get(j.order_id) : null;
                const late = j.due_date && j.status !== "done" && j.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={j.id} onClick={() => onOpen(j.id)}>
                    <td className="nowrap">{!done && editable && !q && !j.order_id ? (() => {
                      const i = rows.indexOf(j);
                      return <span className="k-rank">
                        <button type="button" className="icon-btn subtle" disabled={i === 0} aria-label={t("Move up")} title={t("Higher priority")} onClick={(e) => { e.stopPropagation(); k.setRank("job", j.id, rows[i - 1]!.id); }}><ChevronUp size={14} /></button>
                        <button type="button" className="icon-btn subtle" disabled={i === rows.length - 1} aria-label={t("Move down")} title={t("Lower priority")} onClick={(e) => { e.stopPropagation(); k.setRank("job", j.id, rows[i + 2]?.id ?? null); }}><ChevronDown size={14} /></button>
                      </span>;
                    })() : null}<span className="code">{jobCode(j)}</span></td>
                    <td className="muted nowrap">{shortDate(j.created_at)}</td>
                    <td><b>{j.title}</b>{j.sku && <small className="muted"> · {j.sku}</small>}</td>
                    <td className="num">{j.quantity ?? 1}</td>
                    <td>{o ? <button type="button" className="link" onClick={(e) => { e.stopPropagation(); onOrder(o.id); }}>{o.order_number}</button> : <span className="muted">{t("Stock")}</span>}</td>
                    <td className={`nowrap ${late ? "red-t" : "muted"}`}>{shortDate(j.due_date) || "—"}</td>
                    <td><Pill cell={ingr.get(j.id) ?? (j.stock_booked || j.status === "done" ? { label: "Processed", tone: "ok" } : { label: "—", tone: "none" })} /></td>
                    <td><span className="row gap-s"><RouteDots job={j} /><small>{j.status === "done" ? "" : stations.get(j.station_id ?? "") ?? ""}</small></span></td>
                    <td><span className="avatars">{j.assignees.slice(0, 4).map((id) => <Avatar key={id} p={person(id)} size={22} />)}</span></td>
                    <td><Badge tone={STATUS[j.status].tone} dot>{statusLabel(j.status)}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<Factory size={28} />} title={done ? t("Nothing finished yet") : t("No open manufacturing orders")} hint={t("Make one from a sales order line, or build for stock.")} />}
      <NewMoSheet open={creating} onClose={() => setCreating(false)} onMade={(id) => { setCreating(false); onOpen(id); }} />
      <MoSheet job={cur} onClose={() => onOpen(null)} onOrder={onOrder} />
    </div>
  );
}

function NewMoSheet({ open, onClose, onMade }: { open: boolean; onClose: () => void; onMade: (id: string) => void }) {
  const { db } = useStore();
  const k = useKimera();
  const [item, setItem] = useState<string | null>(null);
  const [qty, setQty] = useState("1");
  const [due, setDue] = useState("");
  const [route, setRoute] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const it = db.stock_items.find((s) => s.id === item);
  const prodRoute = it ? db.products.find((p) => p.sku === it.sku)?.route ?? [] : [];
  return (
    <Sheet open={open} onClose={onClose} tall title={t("New manufacturing order")}>
      <form className="stack" onSubmit={async (e) => {
        e.preventDefault(); if (!it) return; setBusy(true);
        const id = await k.createMo(it.sku, it.name, Number(cleanNumber(qty)), due || null, route.length ? route : null);
        setBusy(false);
        if (id) { setItem(null); setQty("1"); setDue(""); setRoute([]); onMade(id); }
      }}>
        <p className="muted">{t("Make to stock: when the crew finishes, materials come off stock and the finished products go on.")}</p>
        <Field label={t("Product")}><ItemPicker value={item} onChange={(id) => { setItem(id); setRoute([]); }} filter={(s) => s.kind !== "material" && s.kind !== "service"} placeholder={t("Type SKU or name…")} /></Field>
        <div className="row gap">
          <Field label={t("Quantity")}><input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label={t("Due")}><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label={t("Route")} hint={route.length ? undefined : prodRoute.length ? t("Using this product's route") : t("Using the standard route")}>
          <RoutePicker value={route.length ? route : prodRoute.length ? prodRoute : db.stations.filter((s) => s.in_default).sort((a, b) => a.sort - b.sort).map((s) => s.id)} onChange={setRoute} />
        </Field>
        <Btn type="submit" tone="primary" wide busy={busy} disabled={!it || !(Number(cleanNumber(qty)) > 0)} icon={<Factory size={17} />}>{t("Create")}</Btn>
      </form>
    </Sheet>
  );
}

export function MoSheet({ job, onClose, onOrder }: { job: Job | null; onClose: () => void; onOrder?: (id: string) => void }) {
  const { db, me, person } = useStore();
  const k = useKimera();
  const editable = can.admin(me.role);
  const stations = new Map(db.stations.map((s) => [s.id, s.name]));
  const o = job?.order_id ? db.orders.find((x) => x.id === job.order_id) : null;
  const steps = job ? db.job_steps.filter((s) => s.job_id === job.id) : [];
  const ingr = job ? moIngredients(db, job) : [];
  return (
    <Sheet open={!!job} onClose={onClose} tall title={job && <span className="row gap-s"><span className="code">{jobCode(job)}</span>{job.title}<Badge tone={STATUS[job.status].tone} dot>{statusLabel(job.status)}</Badge></span>}>
      {job && (
        <div className="stack">
          <div className="tri">
            <div className="hl"><small>{t("Quantity")}</small><b>{job.quantity ?? 1}</b><em>{job.sku ?? ""}</em></div>
            <div><small>{t("Deadline")}</small><b>{fullDate(job.due_date)}</b><em>{t("Priority")} P{job.priority}</em></div>
            <div><small>{o ? t("Sales order") : t("For")}</small><b>{o ? <button type="button" className="link" onClick={() => onOrder?.(o.id)}>{o.order_number}</button> : t("Stock")}</b><em>{o?.customer ?? ""}</em></div>
          </div>
          {job.route?.length > 0 && (
            <div className="card flat">
              <small className="label">{t("Route")}</small>
              <ol className="k-route">
                {job.route.map((sid, i) => {
                  const st = steps.find((s) => s.stage === i);
                  const state = job.status === "done" || i < job.stage ? "done" : i === job.stage ? "now" : "";
                  return <li key={sid + i} className={state}><b>{stations.get(sid) ?? "—"}</b><small className="muted">{st ? `${person(st.completed_by)?.full_name.split(" ")[0] ?? ""} · ${shortDate(st.completed_at)}` : state === "now" ? t("Working on it") : ""}</small></li>;
                })}
              </ol>
            </div>
          )}
          <small className="label">{t("Ingredients")}</small>
          {ingr.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>SKU</th><th>{t("Material")}</th><th className="num">{t("Needed")}</th><th className="num">{t("In stock")}</th><th className="num">{t("Expected")}</th><th>{t("Status")}</th></tr></thead>
                <tbody>{ingr.map((r, i) => (
                  <tr key={i} className="static">
                    <td><span className="code">{r.m?.sku}</span></td><td>{r.m?.name}</td>
                    <td className="num">{fmtQty(r.need)} <small>{r.m?.unit}</small></td>
                    <td className="num muted">{fmtQty(r.inStock)}</td>
                    <td className="num muted">{r.expected ? fmtQty(r.expected) : ""}</td>
                    <td><Pill cell={job.stock_booked || job.status === "done" ? { label: "Processed", tone: "ok" } : r.avail >= 0 ? { label: "In stock", tone: "ok" } : r.avail + r.expected >= 0 ? { label: "Expected", tone: "warn" } : { label: "Not available", tone: "bad" }} /></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted">{t("No recipe for this product yet — add one under Items › Recipes.")}</p>}
          {job.sku && ingr.length > 0 && <MoProduction job={job} />}
          <small className="label">{t("Crew")}</small>
          <div className="chips">{job.assignees.length ? job.assignees.map((id) => <Badge key={id}><Avatar p={person(id)} size={18} />{person(id)?.full_name}</Badge>) : <span className="muted">{t("Nobody yet — add people to the station in Factory › Jobs › Production setup.")}</span>}</div>
          {job.status === "done" && <UsedByMo job={job} />}
          {editable && (job.status === "done"
            ? <HoldButton icon={<RotateCcw size={16} />} onConfirm={() => k.reopenMo(job.id)}>{t("Hold to reopen — everything it used goes back on stock")}</HoldButton>
            : <HoldButton tone="primary" icon={<CheckCircle2 size={16} />} onConfirm={() => k.completeMo(job.id)}>{t("Hold to complete — takes the recipe off stock")}</HoldButton>)}
          {editable && job.status !== "done" && (
            <>
              <div className="row gap">
                <Field label={t("Deadline")}><input type="date" defaultValue={job.due_date ?? ""} key={job.due_date} onBlur={(e) => e.target.value !== (job.due_date ?? "") && k.updateJob(job.id, { due_date: e.target.value || null })} /></Field>
                <Field label={t("Priority")}><select value={job.priority} onChange={(e) => k.updateJob(job.id, { priority: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((p) => <option key={p} value={p}>P{p}</option>)}</select></Field>
                <Field label={t("Quantity")}><input inputMode="decimal" defaultValue={job.quantity ?? 1} key={job.quantity} onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (v > 0 && v !== job.quantity) k.updateJob(job.id, { quantity: v }); }} /></Field>
              </div>
              <LocationSelect value={job.location_id} disabled={job.stock_booked} label={t("Made at")} onChange={(v) => k.updateJob(job.id, { location_id: v })} />
              {job.status === "open" && job.stage === 0 && <HoldButton tone="danger" icon={<Trash2 size={16} />} onConfirm={async () => { await k.deleteJob(job.id); onClose(); }}>{t("Hold to delete manufacturing order")}</HoldButton>}
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

/** Items kept ready by automatic builds (e.g. frames upstairs). */
function KeptReady() {
  const { db } = useStore();
  const kept = db.stock_items.filter((s) => !s.archived && s.make_min > 0).sort((a, b) => a.name.localeCompare(b.name));
  if (!kept.length) return null;
  return (
    <div className="k-kept">
      <small className="label">{t("Kept ready")}</small>
      <div className="k-kept-row">
        {kept.map((s) => {
          const building = db.jobs.filter((j) => j.sku === s.sku && !j.order_id && j.status !== "done").reduce((x, j) => x + (j.quantity ?? 1), 0);
          const tone = s.quantity >= s.make_min ? "ok" : building ? "warn" : "bad";
          return (
            <div key={s.id} className={`k-kept-card ${tone}`}>
              <b>{s.name}</b>
              <small className="muted">{s.location || t("No location")}</small>
              <span className="row gap-s"><Pill cell={{ label: `${fmtQty(s.quantity)} / ${fmtQty(s.make_min)}`, tone }} />{building > 0 && <small className="muted">{t("{n} being built", { n: building })}</small>}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** What a finished manufacturing order actually booked (net, so a reopen/complete cycle shows the latest). */
function UsedByMo({ job }: { job: Job }) {
  const { db } = useStore();
  const net = new Map<string, { item: string; used: number; made: number }>();
  for (const m of db.stock_movements) {
    if (m.job_id !== job.id || (m.reason !== "consume" && m.reason !== "produce")) continue;
    const r = net.get(m.item_id) ?? { item: m.item_id, used: 0, made: 0 };
    if (m.reason === "consume") r.used -= m.delta; else r.made += m.delta;
    net.set(m.item_id, r);
  }
  const rows = [...net.values()].filter((r) => r.used || r.made);
  if (!rows.length) return <p className="fine">{t("No stock was booked (no recipe for this SKU when it was finished).")}</p>;
  return (
    <>
      <small className="label">{t("Booked to stock")}</small>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>SKU</th><th>{t("Item")}</th><th className="num">{t("Used")}</th><th className="num">{t("Made")}</th></tr></thead>
          <tbody>{rows.map((r) => { const it = db.stock_items.find((s) => s.id === r.item); return (
            <tr key={r.item} className="static"><td><span className="code">{it?.sku}</span></td><td>{it?.name}</td>
              <td className="num red-t">{r.used ? `−${fmtQty(r.used)}` : ""}</td><td className="num ok-t">{r.made ? `+${fmtQty(r.made)}` : ""}</td></tr>); })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Picking, partial completion with actual usage, unused returns (MFG-10..13). */
function MoProduction({ job }: { job: Job }) {
  const { db, me } = useStore();
  const k = useKimera();
  const [qty, setQty] = useState("");
  const [actualOn, setActualOn] = useState(false);
  const [actual, setActual] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [key, setKey] = useState(opKey);
  const total = job.quantity ?? 1, left = Math.max(0, total - (job.produced ?? 0));
  const ingr = moIngredients(db, { ...job, quantity: 1 });
  const mm = new Map(db.mo_materials.filter((m) => m.job_id === job.id).map((m) => [m.item_id, m]));
  const allowed = (can.editStock(me.role) || job.assignees.includes(me.id)) && job.status !== "done";
  const q = Number(cleanNumber(qty)) || 0;
  const go = async (what: string, fn: () => Promise<unknown>) => { setBusy(what); const r = await fn(); setBusy(""); if (r !== null) { setKey(opKey()); setQty(""); setActual({}); setActualOn(false); } };
  const onFloor = (id: string) => { const m = mm.get(id); return m ? m.picked - m.used_from_wip - m.returned : 0; };
  return (
    <div className="card flat stack">
      <div className="row between"><small className="label">{t("Production")}</small>
        <b>{t("{done} of {total} made", { done: fmtQty(job.produced ?? 0), total: fmtQty(total) })}</b></div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Material")}</th><th className="num">{t("Per unit")}</th><th className="num">{t("Picked")}</th><th className="num">{t("Used")}</th><th className="num">{t("Returned")}</th><th className="num">{t("On the floor")}</th></tr></thead>
          <tbody>{ingr.map((r) => {
            const m = r.m ? mm.get(r.m.id) : undefined;
            return (
              <tr key={r.m?.id} className="static">
                <td><span className="code">{r.m?.sku}</span> {r.m?.name}</td>
                <td className="num">{fmtQty(r.need)}</td>
                <td className="num">{m ? fmtQty(m.picked) : "—"}</td>
                <td className="num">{m ? fmtQty(m.used_from_wip) : "—"}</td>
                <td className="num muted">{m?.returned ? fmtQty(m.returned) : "—"}</td>
                <td className="num"><b>{r.m ? fmtQty(onFloor(r.m.id)) : "—"}</b></td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <p className="fine" style={{ textAlign: "left" }}>{t("Picking moves materials to the production floor: they stay your stock but are kept for this order. Completing uses picked material first; when the order is finished, anything left on the floor goes back to the shelf.")}</p>
      {allowed && (
        <>
          <div className="row gap wrap">
            <Btn tone="soft" icon={<PackagePlus size={16} />} busy={busy === "pick"} disabled={!!busy} onClick={() => go("pick", () => k.pickMo(job.id, null, key))}>{t("Pick what's still needed")}</Btn>
            {ingr.some((r) => r.m && onFloor(r.m.id) > 0) && <Btn tone="ghost" busy={busy === "ret"} disabled={!!busy} onClick={() => go("ret", () => k.returnMo(job.id, key))}>{t("Return unused")}</Btn>}
          </div>
          {left > 0 && (
            <div className="stack">
              <div className="row gap">
                <Field label={t("Completed now")}><input inputMode="decimal" value={qty} placeholder={fmtQty(left)} onChange={(e) => setQty(e.target.value)} /></Field>
                <label className="row gap-s fine k-check"><input type="checkbox" checked={actualOn} onChange={(e) => setActualOn(e.target.checked)} />{t("Used different amounts than the recipe")}</label>
              </div>
              {actualOn && (
                <div className="map-grid">{ingr.filter((r) => r.m).map((r) => (
                  <Field key={r.m!.id} label={`${r.m!.sku} · ${t("used")}`}>
                    <input inputMode="decimal" value={actual[r.m!.id] ?? fmtQty(r.need * (q || left))} onChange={(e) => setActual({ ...actual, [r.m!.id]: e.target.value })} />
                  </Field>))}
                </div>
              )}
              <Btn tone="primary" icon={<CheckCircle2 size={16} />} busy={busy === "make"} disabled={!!busy || (q || left) > left}
                onClick={() => go("make", () => k.produceMo(job.id, q || left, actualOn ? Object.fromEntries(ingr.filter((r) => r.m).map((r) => [r.m!.id, Number(cleanNumber(actual[r.m!.id] ?? String(r.need * (q || left)))) || 0])) : null, key))}>
                {(q || left) >= left ? t("Book {n} made — finishes the order", { n: fmtQty(left) }) : t("Book {n} made", { n: fmtQty(q) })}</Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
