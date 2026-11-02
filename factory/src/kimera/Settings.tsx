import { History, Lock, Percent, Plus, RefreshCw, Settings2 } from "lucide-react";
import { LocationsSettings } from "./Locations";
import { useEffect, useState } from "react";
import { Badge, Btn, Empty, Field } from "../components/ui";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { KIMERA_SECTIONS, ROLE_META, ROLE_ORDER, can, isOwner, kimeraSections } from "../lib/roles";
import { useStore } from "../lib/store";
import type { AuditEntry, KimeraSection, Role } from "../lib/types";
import { useKimera } from "./actions";
import { PageHead, SubTabs } from "./kit";

type View = "company" | "tax" | "activity" | "access" | "locations";

/** Kimera → Settings (ADMIN-06): company defaults, tax rates and the activity log. */
export function Settings() {
  const { me } = useStore();
  const [view, setView] = useState<View>(isOwner(me.role) ? "access" : "company");
  if (!can.admin(me.role)) return <Empty icon={<Settings2 size={28} />} title={t("Settings are for the office team")} />;
  return (
    <div className="k-page">
      <PageHead title={t("Settings")} sub={t("Company defaults, tax rates and who changed what.")}
        tabs={<SubTabs value={view} onChange={setView} tabs={[
          ...(isOwner(me.role) ? [{ value: "access" as View, label: t("Access") }] : []),
          { value: "company", label: t("Company") }, { value: "locations", label: t("Locations") }, { value: "tax", label: t("Tax rates") }, { value: "activity", label: t("Activity") }]} />} />
      {view === "access" && isOwner(me.role) ? <Access /> : view === "locations" ? <LocationsSettings /> : view === "company" || view === "access" ? <Company /> : view === "tax" ? <TaxRates /> : <Activity />}
    </div>
  );
}

function Company() {
  const { db } = useStore();
  const k = useKimera();
  const s = db.company_settings[0];
  const valued = db.stock_movements.some((m) => (m.unit_cost ?? 0) !== 0);
  if (!s) return <Empty icon={<Settings2 size={28} />} title={t("Settings not loaded")} />;
  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <Field label={t("Base currency")}>
        <input defaultValue={s.base_currency} key={s.base_currency} maxLength={3} disabled={valued}
          onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (/^[A-Z]{3}$/.test(v) && v !== s.base_currency) k.saveSettings({ base_currency: v }); }} />
      </Field>
      <p className="fine">{valued
        ? t("Locked: stock is already valued in {c}. Costs, stock value and reports are all kept in this currency.", { c: s.base_currency })
        : t("Every cost and stock value is kept in this currency. It locks once stock has a value.")}</p>
      <Field label={t("Default lead time (days)")}>
        <input inputMode="numeric" defaultValue={s.default_lead_days} key={s.default_lead_days}
          onBlur={(e) => { const v = Number(cleanNumber(e.target.value)); if (Number.isInteger(v) && v >= 0 && v !== s.default_lead_days) k.saveSettings({ default_lead_days: v }); }} />
      </Field>
      <p className="fine">{t("Used for items and suppliers without their own lead time.")}</p>
    </div>
  );
}

function TaxRates() {
  const { db } = useStore();
  const k = useKimera();
  const [name, setName] = useState("");
  const [pct, setPct] = useState("");
  const rates = [...db.tax_rates].sort((a, b) => Number(a.archived) - Number(b.archived) || b.rate - a.rate);
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>{t("Name")}</th><th className="num">{t("Rate")}</th><th>{t("Default")}</th><th /></tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id} className={`static ${r.archived ? "dim" : ""}`}>
                <td><input className="cell-input wide" defaultValue={r.name} key={r.name} onBlur={(e) => e.target.value.trim() && e.target.value !== r.name && k.saveTaxRate({ id: r.id, name: e.target.value.trim() })} /></td>
                <td className="num">{Math.round(r.rate * 10000) / 100}%</td>
                <td>{r.is_default ? <Badge tone="ok">{t("Default")}</Badge>
                  : !r.archived && <Btn small tone="ghost" onClick={async () => {
                      const cur = db.tax_rates.find((x) => x.is_default);
                      if (cur) await k.saveTaxRate({ id: cur.id, is_default: false });
                      await k.saveTaxRate({ id: r.id, is_default: true });
                    }}>{t("Make default")}</Btn>}</td>
                <td>{!r.is_default && <Btn small tone="ghost" onClick={() => k.saveTaxRate({ id: r.id, archived: !r.archived })}>{r.archived ? t("Restore") : t("Archive")}</Btn>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">{t("Rates are copied onto each order line when it is added, so changing or archiving a rate never alters existing orders. To change a rate, add a new one and make it the default.")}</p>
      <div className="row gap">
        <Field label={t("New rate name")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Reduced 5%")} /></Field>
        <Field label={t("Rate %")}><input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="5" /></Field>
        <Btn tone="primary" icon={<Percent size={16} />} disabled={!name.trim() || !(Number(cleanNumber(pct)) >= 0 && Number(cleanNumber(pct)) <= 100 && cleanNumber(pct) !== "")}
          onClick={async () => { if (await k.saveTaxRate({ name: name.trim(), rate: Number(cleanNumber(pct)) / 100 })) { setName(""); setPct(""); } }}><Plus size={16} />{t("Add")}</Btn>
      </div>
    </div>
  );
}

const TABLE_LABEL: Record<string, string> = {
  orders: "Order", order_lines: "Order line", purchase_orders: "Purchase order", po_lines: "PO line", bom_lines: "Recipe line",
  suppliers: "Supplier", stock_items: "Item", jobs: "Manufacturing order", profiles: "Person", customers: "Customer",
  tax_rates: "Tax rate", item_suppliers: "Supplier reference", company_settings: "Company settings",
};

function Activity() {
  const { db, person } = useStore();
  const k = useKimera();
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [table, setTable] = useState("");
  const load = async () => { setRows(null); setRows((await k.activity(table || null)) ?? []); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [table]);
  const label = (a: AuditEntry) => {
    const c = a.changes as Record<string, unknown>;
    const pick = (o: Record<string, unknown>) => (o.order_number ?? o.number ?? o.code ?? o.sku ?? o.name ?? "") as string;
    if (a.action !== "update") return pick(c);
    const row = a.table_name === "orders" ? db.orders.find((o) => o.id === a.row_id)?.order_number
      : a.table_name === "stock_items" ? db.stock_items.find((s) => s.id === a.row_id)?.sku
      : a.table_name === "customers" ? db.customers.find((s) => s.id === a.row_id)?.name
      : a.table_name === "jobs" ? db.jobs.find((s) => s.id === a.row_id)?.code
      : a.table_name === "purchase_orders" ? db.purchase_orders.find((s) => s.id === a.row_id)?.number : "";
    return row ?? "";
  };
  const diff = (a: AuditEntry) => a.action !== "update" ? "" : Object.entries(a.changes)
    .map(([key, v]) => { const [from, to] = v as [unknown, unknown]; return `${key}: ${fmt(from)} → ${fmt(to)}`; }).join(" · ");
  return (
    <div className="stack">
      <div className="toolbar">
        <select className="tb-select" value={table} onChange={(e) => setTable(e.target.value)}>
          <option value="">{t("Everything")}</option>
          {Object.entries(TABLE_LABEL).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
        </select>
        <Btn tone="soft" icon={<RefreshCw size={16} />} onClick={load}>{t("Refresh")}</Btn>
        <small className="muted">{t("Last 300 changes. Stock quantities have their own history in Stock → Stock movements.")}</small>
      </div>
      {rows === null ? <p className="muted">{t("Loading…")}</p> : rows.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t("When")}</th><th>{t("Who")}</th><th>{t("What")}</th><th>{t("Record")}</th><th>{t("Change")}</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="static">
                  <td className="muted nowrap">{new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{a.user_id ? person(a.user_id)?.full_name ?? "—" : t("System")}</td>
                  <td><Badge tone={a.action === "delete" ? "red" : a.action === "insert" ? "ok" : "muted"}>{t(a.action === "insert" ? "Added" : a.action === "delete" ? "Deleted" : "Changed")}</Badge> {t(TABLE_LABEL[a.table_name] ?? a.table_name)}</td>
                  <td><span className="code">{label(a) || "—"}</span></td>
                  <td className="muted" style={{ textAlign: "left", fontSize: "0.85em" }}>{diff(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon={<History size={28} />} title={t("No changes recorded yet")} />}
    </div>
  );
}

const fmt = (v: unknown) => v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);

const SECTION_LABEL: Record<KimeraSection, string> = {
  sell: "Sell", make: "Make", buy: "Buy", stock: "Stock", items: "Items", plan: "Plan", tickets: "Tickets", insights: "Insights", settings: "Settings",
  costs: "Costs & margins",
};
const SECTION_HINT: Partial<Record<KimeraSection, string>> = {
  sell: "Sales orders, quotes, customers, prices", buy: "Purchase orders and supplier prices", stock: "Stock levels and stock value",
  insights: "Revenue, profit and margins", settings: "Company, tax rates and activity log",
  costs: "Average costs, stock value, purchase prices and margins — hidden on the server, not just on screen",
};

/** Owner dashboard: which Kimera sections each role may open (Owner and Developer: always everything). */
function Access() {
  const { db, backend: B, refresh, person } = useStore();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const roles = ROLE_ORDER.filter((r) => !isOwner(r));
  const toggle = async (role: Role, s: KimeraSection) => {
    const cur = kimeraSections(role, db.kimera_access);
    const next = cur.includes(s) ? cur.filter((x) => x !== s) : KIMERA_SECTIONS.filter((x) => x === s || cur.includes(x));
    setBusy(`${role}:${s}`); setErr("");
    try {
      await B.rpc("set_kimera_access", { p_role: role, p_sections: next });
      await refresh("kimera_access");
    } catch (e) { setErr(e instanceof Error ? t(e.message) : String(e)); }
    setBusy("");
  };
  const last = [...db.kimera_access].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return (
    <div className="stack">
      <p className="muted">{t("Choose which parts of Kimera each role can open. Owner and Developer always see everything. People see the change straight away.")}</p>
      <div className="tbl-wrap">
        <table className="tbl k-access">
          <thead><tr><th>{t("Role")}</th>{KIMERA_SECTIONS.map((s) => <th key={s} className="c" title={SECTION_HINT[s] ? t(SECTION_HINT[s]!) : undefined}>{t(SECTION_LABEL[s])}</th>)}</tr></thead>
          <tbody>
            {ROLE_ORDER.filter(isOwner).map((r) => (
              <tr key={r} className="static dim">
                <td><b>{t(ROLE_META[r].label)}</b> <Lock size={12} /></td>
                {KIMERA_SECTIONS.map((s) => <td key={s} className="c"><input type="checkbox" checked disabled aria-label={`${t(ROLE_META[r].label)} · ${t(SECTION_LABEL[s])}`} /></td>)}
              </tr>
            ))}
            {roles.map((r) => {
              const on = kimeraSections(r, db.kimera_access);
              return (
                <tr key={r} className="static">
                  <td><b>{t(ROLE_META[r].label)}</b><small className="muted"> · {db.profiles.filter((p) => p.role === r && p.active).length}</small></td>
                  {KIMERA_SECTIONS.map((s) => (
                    <td key={s} className="c">
                      <input type="checkbox" checked={on.includes(s)} disabled={!!busy} onChange={() => toggle(r, s)}
                        aria-label={`${t(ROLE_META[r].label)} · ${t(SECTION_LABEL[s])}`} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {err && <p className="hint red-t">{err}</p>}
      <p className="fine" style={{ textAlign: "left" }}>{t("Costs & margins is enforced on the server: without it, costs and stock value are never sent to that person's phone or computer. Roles with Buy still see purchase prices. Other sections hide screens in Kimera; editing rights (stock, purchasing, orders) still follow each role's permissions on the server.")}</p>
      {last && <p className="fine" style={{ textAlign: "left" }}>{t("Last change")} {new Date(last.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{last.updated_by ? ` · ${person(last.updated_by)?.full_name ?? ""}` : ""}</p>}
    </div>
  );
}
