// Kortana → Settings → TROTAN: who may use the laser app. Per role, with per-person exceptions.
// Owner, Developer and Manager change it; the server enforces it (set_trotan_role_access / set_trotan_person_access).
import type { SupabaseClient } from "@supabase/supabase-js";
import { Lock, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TLogo } from "../components/Logo";
import { t } from "../lib/i18n";
import { ROLE_META, ROLE_ORDER, isOwner } from "../lib/roles";
import { useStore } from "../lib/store";
import type { Role } from "../lib/types";

const SECTIONS = ["manage", "design", "prepare", "produce", "admin", "approve"] as const;
type Sec = (typeof SECTIONS)[number];
const LABEL: Record<Sec, string> = { manage: "Manage", design: "Design", prepare: "Prepare", produce: "Produce", admin: "Administration", approve: "Approve laser settings" };
const HINT: Record<Sec, string> = {
  manage: "See projects, job history and material stock",
  design: "Create and edit designs",
  prepare: "Set up jobs on the machine and queue them (reserves material)",
  produce: "Run queued jobs and record the result (uses material from stock)",
  admin: "Machines, materials and laser settings",
  approve: "Approve power and speed for a material — a safety decision",
};
const TROTAN_URL = "https://trotan.makz.space";

export function TrotanAccess() {
  const { db, backend, person } = useStore();
  const sb = (backend as unknown as { sb: SupabaseClient }).sb;
  const [roles, setRoles] = useState<{ role: Role; sections: Sec[]; updated_at: string; updated_by: string | null }[]>([]);
  const [people, setPeople] = useState<{ profile_id: string; sections: Sec[]; updated_at: string; updated_by: string | null }[]>([]);
  const [busy, setBusy] = useState(""); const [err, setErr] = useState(""); const [q, setQ] = useState("");
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([sb.from("trotan_access").select("*"), sb.from("trotan_person_access").select("*")]);
    if (a.error || b.error) { setErr((a.error ?? b.error)!.message); return; }
    setRoles(a.data as typeof roles); setPeople(b.data as typeof people);
  }, [sb]);
  useEffect(() => { load(); }, [load]);
  const run = async (key: string, fn: string, args: Record<string, unknown>) => {
    setBusy(key); setErr("");
    const { error } = await sb.rpc(fn, args);
    if (error) setErr(t(error.message)); else await load();
    setBusy("");
  };
  const roleSecs = (r: Role): Sec[] => roles.find((x) => x.role === r)?.sections ?? [];
  const staff = useMemo(() => db.profiles.filter((p) => p.active && !isOwner(p.role) && (!q || p.full_name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => a.full_name.localeCompare(b.full_name)), [db.profiles, q]);
  const toggleRole = (r: Role, s: Sec) => { const cur = roleSecs(r); run(`${r}:${s}`, "set_trotan_role_access", { p_role: r, p_sections: SECTIONS.filter((x) => (x === s ? !cur.includes(s) : cur.includes(x))) }); };
  const togglePerson = (id: string, eff: Sec[], s: Sec) => run(`${id}:${s}`, "set_trotan_person_access", { p_person: id, p_sections: SECTIONS.filter((x) => (x === s ? !eff.includes(s) : eff.includes(x))) });
  const last = [...roles, ...people].filter((x) => x.updated_at).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  return (
    <div className="stack">
      <div className="row gap" style={{ alignItems: "center" }}>
        <TLogo size={22} />
        <p className="muted" style={{ margin: 0, flex: 1 }}>{t("TROTAN is the laser cutting app. Choose which roles and which people may use each part of it. Owner and Developer always have everything. A person's own setting replaces their role's.")}</p>
        <a className="btn soft" href={TROTAN_URL} target="_blank" rel="noreferrer">{t("Open TROTAN")}</a>
      </div>

      <h3 className="k-sub">{t("By role")}</h3>
      <div className="tbl-wrap">
        <table className="tbl k-access">
          <thead><tr><th>{t("Role")}</th>{SECTIONS.map((s) => <th key={s} className="c" title={t(HINT[s])}>{t(LABEL[s])}</th>)}</tr></thead>
          <tbody>
            {ROLE_ORDER.filter(isOwner).map((r) => (
              <tr key={r} className="static dim"><td><b>{t(ROLE_META[r].label)}</b> <Lock size={12} /></td>{SECTIONS.map((s) => <td key={s} className="c"><input type="checkbox" checked disabled aria-label={`${t(ROLE_META[r].label)} · ${t(LABEL[s])}`} /></td>)}</tr>
            ))}
            {ROLE_ORDER.filter((r) => !isOwner(r)).map((r) => {
              const on = roleSecs(r);
              return (
                <tr key={r} className="static" data-testid={`trotan-role-${r}`}>
                  <td><b>{t(ROLE_META[r].label)}</b><small className="muted"> · {db.profiles.filter((p) => p.role === r && p.active).length}</small></td>
                  {SECTIONS.map((s) => <td key={s} className="c"><input type="checkbox" checked={on.includes(s)} disabled={!!busy} onChange={() => toggleRole(r, s)} aria-label={`${t(ROLE_META[r].label)} · ${t(LABEL[s])}`} /></td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="k-sub">{t("By person")}</h3>
      <p className="muted">{t("Tick a box to give one person their own access. “Use role” puts them back on their role's access.")}</p>
      <input className="input" placeholder={t("Search people")} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
      <div className="tbl-wrap">
        <table className="tbl k-access">
          <thead><tr><th>{t("Person")}</th>{SECTIONS.map((s) => <th key={s} className="c" title={t(HINT[s])}>{t(LABEL[s])}</th>)}<th /></tr></thead>
          <tbody>
            {staff.map((p) => {
              const own = people.find((x) => x.profile_id === p.id);
              const eff = own ? own.sections : roleSecs(p.role);
              return (
                <tr key={p.id} className="static" data-testid="trotan-person">
                  <td><b>{p.full_name}</b><small className="muted"> · {t(ROLE_META[p.role].label)}{own ? ` · ${t("own setting")}` : ""}</small></td>
                  {SECTIONS.map((s) => <td key={s} className="c"><input type="checkbox" checked={eff.includes(s)} disabled={!!busy} style={own ? undefined : { opacity: 0.55 }} onChange={() => togglePerson(p.id, eff, s)} aria-label={`${p.full_name} · ${t(LABEL[s])}`} /></td>)}
                  <td>{own && <button type="button" className="btn soft small" disabled={!!busy} onClick={() => run(`${p.id}:reset`, "set_trotan_person_access", { p_person: p.id, p_sections: null })}><RotateCcw size={13} /> {t("Use role")}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {err && <p className="hint red-t">{err}</p>}
      <p className="fine" style={{ textAlign: "left" }}>{t("Enforced on the server: without access, TROTAN's data is never sent to that person. “Approve laser settings” lets someone decide which power and speed are safe for a material — give it only to trained operators.")}</p>
      {last && <p className="fine" style={{ textAlign: "left" }}>{t("Last change")} {new Date(last.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{last.updated_by ? ` · ${person(last.updated_by)?.full_name ?? ""}` : ""}</p>}
    </div>
  );
}
