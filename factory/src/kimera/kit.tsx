import { ShoppingBag, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "../lib/i18n";
import type { Cell } from "./status";

export const shortDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
export const fullDate = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** Colour-coded status cell (green / amber / red / blue / grey). */
export function Pill({ cell, onClick }: { cell: Cell; onClick?: () => void }) {
  const body = <>{t(cell.label)}{cell.date && <small>{shortDate(cell.date)}</small>}</>;
  return onClick
    ? <button type="button" title={cell.why} className={`kpill ${cell.tone} act`} onClick={(e) => { e.stopPropagation(); onClick(); }}>{body}</button>
    : <span className={`kpill ${cell.tone}`} title={cell.why}>{body}</span>;
}

export function Channel({ source }: { source: "shopify" | "manual" }) {
  return source === "shopify"
    ? <span className="kchan shop" title="Shopify"><ShoppingBag size={14} /></span>
    : <span className="kchan" title={t("Entered in Kimera")}><PenLine size={14} /></span>;
}

export function PageHead({ title, sub, tabs, actions }: { title: string; sub?: ReactNode; tabs?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="k-head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {tabs && <div className="k-subtabs">{tabs}</div>}
      {actions && <div className="row gap">{actions}</div>}
    </div>
  );
}

export function SubTabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div className="k-tabs" role="tablist">
      {tabs.map((x) => (
        <button type="button" key={x.value} role="tab" aria-selected={value === x.value} className={value === x.value ? "on" : ""} onClick={() => onChange(x.value)}>
          {x.label}{x.count ? <i>{x.count}</i> : null}
        </button>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "ok" | "warn" }) {
  return (
    <div className={`k-stat ${tone ?? ""}`}>
      <small>{label}</small>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}
