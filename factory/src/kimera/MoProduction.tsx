import { CheckCircle2, PackagePlus } from "lucide-react";
import { useState } from "react";
import { Btn, Field } from "../components/ui";
import { opKey } from "../lib/actions";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can } from "../lib/roles";
import { useStore } from "../lib/store";
import type { Job } from "../lib/types";
import { fmtQty } from "../screens/Inventory";
import { useKimera } from "./actions";
import { moIngredients } from "./status";

/** Production on an MO (MFG-10..13, MFG-17): pick to the floor, book what was made (with actual
 * usage), return unused. Used in Kortana's MO sheet and on the shop floor in SK Factory. */
export function MoProduction({ job, compact = false }: { job: Job; compact?: boolean }) {
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
      {compact ? (
        <div className="stack">{ingr.map((r) => {
          const m = r.m ? mm.get(r.m.id) : undefined;
          return (
            <div key={r.m?.id} className="mo-mat">
              <div className="grow"><span className="code">{r.m?.sku}</span><small>{r.m?.name}</small></div>
              <div className="num"><b>{r.m ? fmtQty(onFloor(r.m.id)) : "—"}</b><small>{t("on the floor")} · {fmtQty(r.need)}/{t("pc")}{m?.used_from_wip ? ` · ${t("used")} ${fmtQty(m.used_from_wip)}` : ""}</small></div>
            </div>);
        })}</div>
      ) : (
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
      )}
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
