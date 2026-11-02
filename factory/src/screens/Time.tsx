import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, Coffee, Download, Pencil } from "lucide-react";
import { useMemo, useState } from "react";
import { Btn, Count, Empty, Field, Segmented, Sheet, item, list } from "../components/ui";
import { useActions } from "../lib/actions";
import { can } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import {
  DAY_TARGET, HOUR, clock, dailyTotals, dayLabel, hm, human, shiftWorked, splitOvertime,
  startOfDay, startOfMonth, startOfWeek, weekday, ymd,
} from "../lib/time";
import type { Shift } from "../lib/types";

type Range = "day" | "week" | "month";

function bounds(range: Range, offset: number) {
  const now = new Date();
  let a: Date, b: Date;
  if (range === "day") { a = startOfDay(now); a.setDate(a.getDate() + offset); b = new Date(a); b.setDate(b.getDate() + 1); }
  else if (range === "week") { a = startOfWeek(now); a.setDate(a.getDate() + offset * 7); b = new Date(a); b.setDate(b.getDate() + 7); }
  else { a = startOfMonth(now); a.setMonth(a.getMonth() + offset); b = new Date(a); b.setMonth(b.getMonth() + 1); }
  return [a, b] as const;
}

export function TimeScreen({ userId }: { userId?: string }) {
  return <motion.div className="page" initial="hidden" animate="show" variants={list}><TimeSheet userId={userId} /></motion.div>;
}

export function TimeSheet({ userId }: { userId?: string }) {
  const { db, me, person } = useStore();
  const uid = userId ?? me.id;
  const now = useNow(15000);
  const [range, setRange] = useState<Range>("day");
  const [off, setOff] = useState(0);
  const [edit, setEdit] = useState<Shift | null>(null);
  const [a, b] = bounds(range, off);

  const shifts = useMemo(() => db.shifts
    .filter((s) => s.user_id === uid && new Date(s.clock_in) >= a && new Date(s.clock_in) < b)
    .sort((x, y) => y.clock_in.localeCompare(x.clock_in)), [db.shifts, uid, a, b]);
  const perDay = dailyTotals(shifts, db.breaks, now);
  const { normal, over } = splitOvertime(perDay.values());

  const byDay = new Map<string, Shift[]>();
  for (const s of shifts) { const k = ymd(new Date(s.clock_in)); byDay.set(k, [...(byDay.get(k) ?? []), s]); }

  // Bars for week/month view
  const days: Date[] = [];
  if (range !== "day") for (let d = new Date(a); d < b; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const maxDay = Math.max(DAY_TARGET * 1.25, ...perDay.values());

  const title = range === "day" ? dayLabel(a) : range === "week" ? `${dayLabel(a)} – ${dayLabel(new Date(b.getTime() - 1))}` : a.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  function exportCsv() {
    const rows = [["Employee", "Code", "Date", "Clock in", "Clock out", "Breaks (min)", "Worked (h)"]];
    for (const s of [...shifts].reverse()) {
      const br = db.breaks.filter((x) => x.shift_id === s.id).reduce((t, x) => t + ((x.ended_at ? new Date(x.ended_at).getTime() : now) - new Date(x.started_at).getTime()), 0);
      rows.push([person(uid)?.full_name ?? "", person(uid)?.employee_code ?? "", ymd(new Date(s.clock_in)), clock(s.clock_in), s.clock_out ? clock(s.clock_out) : "", String(Math.round(br / 60000)), (shiftWorked(s, db.breaks, now) / HOUR).toFixed(2)]);
    }
    const blob = new Blob([rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `timesheet-${person(uid)?.employee_code}-${ymd(a)}.csv`;
    link.click();
  }

  return (
    <>
      {!userId && <motion.h2 className="page-title" variants={item}>Electronic time sheet</motion.h2>}
      <motion.div variants={item}><Segmented value={range} onChange={(v) => { setRange(v); setOff(0); }} options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} /></motion.div>
      <motion.div className="date-nav" variants={item}>
        <button className="icon-btn" onClick={() => setOff(off - 1)} aria-label="Previous"><ChevronLeft size={20} /></button>
        <motion.b key={title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{title}</motion.b>
        <button className="icon-btn" onClick={() => setOff(Math.min(0, off + 1))} disabled={off >= 0} aria-label="Next"><ChevronRight size={20} /></button>
      </motion.div>

      <motion.div className="card totals" variants={item}>
        <div><small>Total</small><b className="mono"><Count value={normal + over} format={hm} /></b></div>
        <div><small>Normal</small><b className="mono"><Count value={normal} format={hm} /></b></div>
        <div><small>Overtime</small><b className={`mono ${over ? "violet-t" : ""}`}><Count value={over} format={hm} /></b></div>
        <div><small>Days</small><b className="mono">{perDay.size}</b></div>
      </motion.div>

      {range !== "day" && (
        <motion.div className={`card bars ${range}`} variants={item}>
          <div className="target" style={{ bottom: `${(DAY_TARGET / maxDay) * 100}%` }}><span>8h</span></div>
          {days.map((d, i) => {
            const v = perDay.get(ymd(d)) ?? 0;
            return (
              <div key={i} className="bar-col" title={`${dayLabel(d)} · ${hm(v)}`}>
                <div className="bar-track">
                  <motion.i initial={{ height: 0 }} animate={{ height: `${(v / maxDay) * 100}%` }} transition={{ delay: i * 0.02, type: "spring", stiffness: 140, damping: 18 }} className={v > DAY_TARGET ? "ot" : ""} />
                </div>
                <small>{range === "week" ? weekday(d)[0] : d.getDate() % 5 === 1 ? d.getDate() : ""}</small>
              </div>
            );
          })}
        </motion.div>
      )}

      <motion.div className="stack" variants={list} initial="hidden" animate="show" key={range + off}>
        {[...byDay.entries()].map(([day, ss]) => (
          <motion.div key={day} className="card day" variants={item}>
            <div className="day-head"><b>{weekday(day)} {dayLabel(day)}</b><span className="muted mono">{hm(perDay.get(day) ?? 0)} total</span></div>
            {ss.map((s) => {
              const br = db.breaks.filter((x) => x.shift_id === s.id);
              return (
                <div key={s.id} className="shift-row">
                  <div className="grow">
                    <div className="mono big">{clock(s.clock_in)} – {s.clock_out ? clock(s.clock_out) : <span className="green-t">now</span>}</div>
                    {br.length > 0 && <small className="muted"><Coffee size={12} /> {br.map((x) => `${clock(x.started_at)} (${human((x.ended_at ? new Date(x.ended_at).getTime() : now) - new Date(x.started_at).getTime())})`).join(" · ")}</small>}
                  </div>
                  <b className="mono">{hm(shiftWorked(s, db.breaks, now))}</b>
                  {can.admin(me.role) && <button className="icon-btn subtle" onClick={() => setEdit(s)} aria-label="Correct shift"><Pencil size={15} /></button>}
                </div>
              );
            })}
          </motion.div>
        ))}
        {!shifts.length && <Empty icon={<Coffee size={28} />} title="No shifts" hint="Nothing recorded in this period." />}
      </motion.div>
      {shifts.length > 0 && <Btn tone="ghost" wide icon={<Download size={18} />} onClick={exportCsv}>Export CSV</Btn>}
      <ShiftEditor shift={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function ShiftEditor({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const a = useActions();
  const toLocal = (s: string) => { const d = new Date(s); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [cin, setIn] = useState(""); const [cout, setOut] = useState("");
  const [key, setKey] = useState<string | null>(null);
  if (shift && key !== shift.id) { setKey(shift.id); setIn(toLocal(shift.clock_in)); setOut(shift.clock_out ? toLocal(shift.clock_out) : ""); }
  return (
    <Sheet open={!!shift} onClose={() => { onClose(); setKey(null); }} title="Correct shift">
      <div className="stack">
        <Field label="Clock in"><input type="datetime-local" value={cin} onChange={(e) => setIn(e.target.value)} /></Field>
        <Field label="Clock out" hint="Leave empty if still on shift"><input type="datetime-local" value={cout} onChange={(e) => setOut(e.target.value)} /></Field>
        <Btn tone="primary" wide onClick={async () => {
          await a.editShift(shift!.id, { clock_in: new Date(cin).toISOString(), clock_out: cout ? new Date(cout).toISOString() : null });
          onClose(); setKey(null);
        }}>Save correction</Btn>
      </div>
    </Sheet>
  );
}
