import { Select } from "../components/Select.tsx";
import { Range } from "../components/Range.tsx";
import { RotateCcw } from "lucide-react";
import { createContext, useContext, type ReactNode } from "react";
import { getPath, setPath, unsetPath, type DeepPartial, type LayerName, type ThemeDoc } from "@send/shared";
import { editDraft, effective, resolveFor, scopeKey, useAppearance, type Draft } from "./store.ts";

/** What Studio is editing: your global look, one server, or one channel/conversation. */
export type Target = { kind: "global" } | { kind: "guild"; id: string; label: string } | { kind: "channel"; id: string; guildId: string | null; label: string };
export const TargetCtx = createContext<Target>({ kind: "global" });
export const useTarget = () => useContext(TargetCtx);
export const ctxOf = (t: Target) => ({ guildId: t.kind === "guild" ? t.id : t.kind === "channel" ? t.guildId : null, channelId: t.kind === "channel" ? t.id : null });

function overridesOf(d: Draft, t: Target): DeepPartial<ThemeDoc> {
  if (t.kind === "global") return d.global.overrides;
  return d.scopes[scopeKey(t.kind, t.id)]?.overrides ?? {};
}
function withOverrides(d: Draft, t: Target, fn: (o: DeepPartial<ThemeDoc>) => DeepPartial<ThemeDoc>): Draft {
  if (t.kind === "global") return { ...d, global: { ...d.global, overrides: fn(d.global.overrides) } };
  const k = scopeKey(t.kind, t.id);
  const cur = d.scopes[k] ?? { overrides: {} };
  return { ...d, scopes: { ...d.scopes, [k]: { ...cur, overrides: fn(cur.overrides ?? {}) } } };
}

/** Read the effective value (with provenance) and write overrides at the current target. */
export function useField<T = unknown>(path: string) {
  const target = useTarget();
  useAppearance((s) => s.draft); // re-render on draft changes
  const d = effective();
  const r = resolveFor(ctxOf(target), d).resolved;
  const own = getPath(overridesOf(d, target), path);
  const value = getPath(r.theme, path) as T;
  const source: LayerName = r.source(path);
  return {
    value, overridden: own !== undefined, source,
    set: (v: T) => editDraft((x) => withOverrides(x, target, (o) => setPath(o, path, v))),
    reset: () => editDraft((x) => withOverrides(x, target, (o) => unsetPath(o, path))),
  };
}
export const resetSection = (target: Target, keys: string[]) => editDraft((x) => withOverrides(x, target, (o) => { let n = o; for (const k of keys) n = unsetPath(n, k); return n; }));

const SOURCE_LABEL: Record<LayerName, string> = { default: "SEND default", theme: "theme", global: "your global look", device: "this device", server: "server override", shared: "shared conversation theme", conversation: "conversation override", accessibility: "accessibility setting" };

function Row({ label, hint, path, children, field }: { label: string; hint?: ReactNode; path: string; children: ReactNode; field: { overridden: boolean; source: LayerName; reset: () => void } }) {
  return (
    <div className={`sf-row ${field.overridden ? "is-set" : ""}`}>
      <div className="sf-label">
        <span>{label}</span>
        <small className="sf-src" title={path}>{field.overridden ? "Overridden here" : `Inherited from ${SOURCE_LABEL[field.source]}`}</small>
        {hint && <small className="muted block">{hint}</small>}
      </div>
      <div className="sf-input">{children}</div>
      <button className="icon-btn sm" disabled={!field.overridden} onClick={field.reset} aria-label={`Reset ${label} to inherited`} title="Reset to inherited"><RotateCcw size={14} /></button>
    </div>
  );
}

export function ColorField({ path, label, hint }: { path: string; label: string; hint?: ReactNode }) {
  const f = useField<string>(path);
  const v = typeof f.value === "string" ? f.value.slice(0, 7) : "#000000";
  return (
    <Row label={label} hint={hint} path={path} field={f}>
      <input type="color" value={v} onChange={(e) => f.set(e.target.value.toUpperCase())} aria-label={label} />
      <input className="hex" value={v} maxLength={7} onChange={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && f.set(e.target.value.toUpperCase())} aria-label={`${label} hex`} />
    </Row>
  );
}
export function RangeField({ path, label, min, max, step = 1, unit = "", hint }: { path: string; label: string; min: number; max: number; step?: number; unit?: string; hint?: ReactNode }) {
  const f = useField<number>(path);
  const v = typeof f.value === "number" ? f.value : min;
  return (
    <Row label={label} hint={hint} path={path} field={f}>
      <Range min={min} max={max} step={step} value={v} onChange={(e) => f.set(Number(e.target.value))} aria-label={label} aria-valuetext={`${v}${unit}`} />
      <output className="sf-num">{Number.isInteger(step) ? v : v.toFixed(2)}{unit}</output>
    </Row>
  );
}
export function SelectField<T extends string | number>({ path, label, options, hint }: { path: string; label: string; options: readonly (readonly [T, string])[]; hint?: ReactNode }) {
  const f = useField<T>(path);
  return (
    <Row label={label} hint={hint} path={path} field={f}>
      <Select value={String(f.value)} onChange={(e) => { const o = options.find(([k]) => String(k) === e.target.value); if (o) f.set(o[0]); }} aria-label={label}>
        {options.map(([k, l]) => <option key={String(k)} value={String(k)}>{l}</option>)}
      </Select>
    </Row>
  );
}
export function BoolField({ path, label, hint }: { path: string; label: string; hint?: ReactNode }) {
  const f = useField<boolean>(path);
  return (
    <Row label={label} hint={hint} path={path} field={f}>
      <input type="checkbox" role="switch" className="toggle" checked={!!f.value} onChange={(e) => f.set(e.target.checked)} aria-label={label} />
    </Row>
  );
}
