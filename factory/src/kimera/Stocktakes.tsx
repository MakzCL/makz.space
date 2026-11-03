import { ClipboardCheck, Plus, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { ScanButton } from "../components/Scanner";
import { useToast } from "../components/Toast";
import { Badge, Btn, Chip, Empty, Field, HoldButton, Sheet } from "../components/ui";
import { LocationSelect } from "../components/LocationSelect";
import { cleanNumber } from "../lib/csv";
import { t } from "../lib/i18n";
import { can, canSeeCosts } from "../lib/roles";
import { resolveCode } from "../lib/scan";
import { useStore } from "../lib/store";
import { fmtQty, money } from "../screens/Inventory";
import { shortDate } from "./kit";

/** INV-08: stocktake sessions. Start a count for a location, count (by hand or scanner), review the differences, post. */
export function StocktakesView() {
  const { db, me, backend: B, refresh, person } = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [loc, setLoc] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const editable = can.editStock(me.role);
  const list = [...db.stocktakes].sort((a, b) => (a.status === "counting" ? 0 : 1) - (b.status === "counting" ? 0 : 1) || b.created_at.localeCompare(a.created_at));
  const locName = (id: string | null) => db.locations.find((l) => l.id === id)?.name ?? "—";
  const progress = (id: string) => { const ls = db.stocktake_lines.filter((l) => l.stocktake_id === id); return { n: ls.length, done: ls.filter((l) => l.counted !== null).length }; };
  return (
    <div className="stack">
      <div className="toolbar">
        <p className="muted grow" style={{ margin: 0 }}>{t("Count a whole location without stopping work: stock keeps moving while you count, and only the differences you approve are booked.")}</p>
        {editable && <Btn tone="primary" icon={<Plus size={18} />} onClick={() => setStarting(true)}>{t("New stocktake")}</Btn>}
      </div>
      {list.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>#</th><th>{t("Location")}</th><th>{t("Status")}</th><th className="num">{t("Counted")}</th><th>{t("Started")}</th><th>{t("By")}</th></tr></thead>
            <tbody>{list.map((s) => { const p = progress(s.id); return (
              <tr key={s.id} onClick={() => setOpen(s.id)}>
                <td><span className="code">{s.number}</span></td><td>{locName(s.location_id)}{s.note && <small className="muted"> · {s.note}</small>}</td>
                <td><Badge tone={s.status === "counting" ? "blue" : s.status === "posted" ? "ok" : "muted"} dot>{s.status === "counting" ? t("Counting") : s.status === "posted" ? t("Posted") : t("Cancelled")}</Badge></td>
                <td className="num">{p.done} / {p.n}</td><td className="muted">{shortDate(s.created_at)}</td><td className="muted">{person(s.created_by)?.full_name ?? ""}</td>
              </tr>); })}</tbody>
          </table>
        </div>
      ) : <Empty icon={<ClipboardCheck size={28} />} title={t("No stocktakes yet")} hint={t("Start one to count a location shelf by shelf.")} />}
      <Sheet open={starting} onClose={() => setStarting(false)} title={t("New stocktake")}>
        <div className="stack">
          <LocationSelect value={loc} onChange={setLoc} label={t("Location")} />
          <Field label={t("Note")}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. Year-end count, shelf A")} /></Field>
          <p className="fine">{t("Every item with stock at this location goes on the count sheet. You can add others by scanning them.")}</p>
          <Btn tone="primary" wide disabled={busy} onClick={async () => {
            setBusy(true);
            try { const id = await B.rpc<string>("start_stocktake", { p_location: loc, p_items: null, p_note: note }); await Promise.all([refresh("stocktakes"), refresh("stocktake_lines")]); setStarting(false); setNote(""); setOpen(id); }
            catch (e) { toast(e instanceof Error ? t(e.message) : String(e), "error"); } finally { setBusy(false); }
          }}>{t("Start counting")}</Btn>
        </div>
      </Sheet>
      <StocktakeSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function StocktakeSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { db, me, backend: B, refresh, person } = useStore();
  const toast = useToast();
  const st = db.stocktakes.find((s) => s.id === id);
  const editable = can.editStock(me.role) && st?.status === "counting";
  const costs = canSeeCosts(me.role, db.kimera_access);
  const [q, setQ] = useState("");
  const [view, setView] = useState<"all" | "todo" | "diff">("all");
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  // Fast repeated scans run ahead of the server: keep the latest local count per line.
  const local = useRef(new Map<string, number>());
  const lines = useMemo(() => !st ? [] : db.stocktake_lines.filter((l) => l.stocktake_id === st.id).map((l) => {
    const it = db.stock_items.find((s) => s.id === l.item_id);
    const sys = st.status === "counting" ? db.stock_levels.find((x) => x.item_id === l.item_id && x.location_id === st.location_id)?.quantity ?? 0 : l.system_at_post ?? 0;
    const bin = db.stock_levels.find((x) => x.item_id === l.item_id && x.location_id === st.location_id)?.bin || it?.location || "";
    return { l, it, sys, bin, diff: l.counted === null ? null : l.counted - sys };
  }).sort((a, b) => a.bin.localeCompare(b.bin) || (a.it?.sku ?? "").localeCompare(b.it?.sku ?? "")), [db, st]);
  if (!st) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;
  const save = async (lineId: string, v: number | null) => {
    try { await B.update("stocktake_lines", lineId, { counted: v }); await refresh("stocktake_lines"); }
    catch (e) { toast(e instanceof Error ? t(e.message) : String(e), "error"); }
  };
  const onScan = (raw: string) => {
    const hit = resolveCode(db, raw);
    if (hit.kind !== "item") { setMsg({ text: t("Not an item: {c}", { c: raw }), ok: false }); return false; }
    const row = lines.find((r) => r.l.item_id === hit.item.id);
    if (row) {
      const next = (local.current.get(row.l.id) ?? row.l.counted ?? 0) + 1;
      local.current.set(row.l.id, next);
      save(row.l.id, next); setMsg({ text: `${hit.item.sku} → ${fmtQty(next)}`, ok: true }); return true;
    }
    B.insert("stocktake_lines", { stocktake_id: st.id, item_id: hit.item.id, counted: 1 }).then(() => refresh("stocktake_lines")).catch((e) => toast(String(e?.message ?? e), "error"));
    setMsg({ text: t("{sku} added to the count", { sku: hit.item.sku }), ok: true });
    return true;
  };
  const shown = lines.filter((r) => view === "all" || (view === "todo" ? r.l.counted === null : r.diff !== null && r.diff !== 0))
    .filter((r) => !q || `${r.it?.sku} ${r.it?.name} ${r.bin}`.toLowerCase().includes(q.toLowerCase()));
  const counted = lines.filter((r) => r.l.counted !== null);
  const diffs = counted.filter((r) => r.diff !== 0);
  const value = diffs.reduce((x, r) => x + (r.diff ?? 0) * (r.it?.avg_cost ?? 0), 0);
  return (
    <Sheet open onClose={onClose} tall title={<span className="row gap-s"><span className="code">{st.number}</span>{db.locations.find((l) => l.id === st.location_id)?.name}</span>}>
      <div className="stack">
        <div className="tri">
          <div className="hl"><small>{t("Counted")}</small><b>{counted.length}</b><em>{t("of {n}", { n: lines.length })}</em></div>
          <div><small>{t("Differences")}</small><b>{diffs.length}</b><em>{st.status === "posted" ? t("booked") : t("to review")}</em></div>
          <div><small>{costs ? t("Value") : t("Status")}</small><b className={value < 0 ? "red-t" : ""}>{costs ? (value < 0 ? `−${money(-value)}` : money(value)) : st.status === "counting" ? t("Counting") : st.status === "posted" ? t("Posted") : t("Cancelled")}</b>
            <em>{st.posted_at ? `${shortDate(st.posted_at)} · ${person(st.posted_by)?.full_name ?? ""}` : ""}</em></div>
        </div>
        {editable && <div className="row gap wrap"><ScanButton onCode={onScan} continuous title={t("Scan to count")} hint={t("Each scan adds one. Type the number for boxes and reels.")} />{msg && <small className={msg.ok ? "ok-t" : "red-t"}>{msg.text}</small>}</div>}
        <div className="row between wrap">
          <div className="chips">
            <Chip on={view === "all"} onClick={() => setView("all")}>{t("All")}</Chip>
            <Chip on={view === "todo"} onClick={() => setView("todo")}>{t("Not counted")} · {lines.length - counted.length}</Chip>
            <Chip on={view === "diff"} onClick={() => setView("diff")}>{t("Differences")} · {diffs.length}</Chip>
          </div>
          <div className="searchbar"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search SKU, name, bin…")} /></div>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t("Bin")}</th><th>SKU</th><th>{t("Item")}</th><th className="num">{st.status === "counting" ? t("System now") : t("System")}</th><th className="num">{t("Counted")}</th><th className="num">{t("Difference")}</th></tr></thead>
            <tbody>{shown.slice(0, 1000).map((r) => (
              <tr key={r.l.id} className="static">
                <td className="muted">{r.bin}</td><td><span className="code">{r.it?.sku}</span></td><td>{r.it?.name}</td>
                <td className="num muted">{fmtQty(r.sys)}</td>
                <td className="num">{editable
                  ? <input className="cell-input" inputMode="decimal" placeholder="—" defaultValue={r.l.counted ?? ""} key={`${r.l.id}-${r.l.counted}`}
                      onBlur={(e) => { const v = cleanNumber(e.target.value) === "" ? null : Number(cleanNumber(e.target.value)); if (v !== r.l.counted && (v === null || v >= 0)) { if (v === null) local.current.delete(r.l.id); else local.current.set(r.l.id, v); save(r.l.id, v); } }} />
                  : r.l.counted === null ? "—" : fmtQty(r.l.counted)}</td>
                <td className={`num ${r.diff && r.diff < 0 ? "red-t" : r.diff ? "ok-t" : "muted"}`}>{r.diff === null ? "" : r.diff > 0 ? `+${fmtQty(r.diff)}` : fmtQty(r.diff)}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {editable && <>
          <p className="fine">{t("Posting books only the counted lines. Each difference is measured against the stock at the moment you post, so sales and picks during the count are not lost.")}</p>
          <HoldButton tone="primary" icon={<ClipboardCheck size={16} />} onConfirm={async () => {
            if (busy) return; setBusy(true);
            try {
              const r = await B.rpc<{ lines: number; difference: number; value: number | null }>("post_stocktake", { p_id: st.id, p_action: "post" });
              await Promise.all([refresh("stocktakes"), refresh("stocktake_lines"), refresh("stock_items"), refresh("stock_levels"), refresh("stock_movements")]);
              toast(t("Stocktake posted: {n} lines, {d} difference", { n: r.lines, d: fmtQty(r.difference) }), "ok");
            } catch (e) { toast(e instanceof Error ? t(e.message) : String(e), "error"); } finally { setBusy(false); }
          }}>{t("Hold to post {n} counted lines", { n: counted.length })}</HoldButton>
          <HoldButton onConfirm={async () => { try { await B.rpc("post_stocktake", { p_id: st.id, p_action: "cancel" }); await refresh("stocktakes"); } catch (e) { toast(e instanceof Error ? t(e.message) : String(e), "error"); } }}>{t("Hold to cancel stocktake")}</HoldButton>
        </>}
      </div>
    </Sheet>
  );
}
