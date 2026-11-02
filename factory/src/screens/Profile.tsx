import { AnimatePresence, motion } from "motion/react";
import { Camera, ChevronDown, LogOut, RefreshCw, Send, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { Badge, Btn, Field, Section, Segmented, Sheet, Toggle, item, list } from "../components/ui";
import { useActions } from "../lib/actions";
import { setPrefs, usePrefs } from "../lib/prefs";
import { ROLE_META, TABS_FOR, type Tab } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { dailyTotals, dayLabel, daysBetween, hm, jobStats, splitOvertime, startOfMonth, ymd } from "../lib/time";
import type { AbsenceKind } from "../lib/types";
import { TAB_META } from "../components/Shell";
import { KIND } from "./Requests";

async function squareCrop(file: File, size = 320): Promise<Blob> {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return await new Promise((r) => c.toBlob((b) => r(b!), "image/webp", 0.86));
}

export function Profile({ onSignOut }: { onSignOut: () => void }) {
  const { db, me, backend } = useStore();
  const a = useActions();
  const now = useNow(30000);
  const prefs = usePrefs();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [name, setName] = useState<string | null>(null);

  const month = startOfMonth();
  const myShifts = db.shifts.filter((s) => s.user_id === me.id && new Date(s.clock_in) >= month);
  const { normal, over } = splitOvertime(dailyTotals(myShifts, db.breaks, now).values());
  const myJobs = new Set(db.participants.filter((p) => p.user_id === me.id).map((p) => p.job_id));
  const completed = db.jobs.filter((j) => j.status === "done" && myJobs.has(j.id)).length;
  const team = [...myJobs].filter((j) => jobStats(db, j, now).team).length;
  const year = String(new Date().getFullYear());
  const mine = db.absences.filter((x) => x.user_id === me.id).sort((x, y) => y.start_date.localeCompare(x.start_date));
  const days = (k: AbsenceKind) => mine.filter((x) => x.kind === k && x.status === "approved" && x.start_date.startsWith(year)).reduce((t, x) => t + daysBetween(x.start_date, x.end_date), 0);

  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <motion.div className="card profile-hero" variants={item}>
        <div className="profile-glow" style={{ ["--c" as string]: ROLE_META[me.role].hue }} />
        <motion.button className="avatar-edit" whileTap={{ scale: 0.94 }} onClick={() => fileRef.current?.click()} aria-label="Change photo">
          <Avatar p={me} size={92} ring />
          <span className="cam"><Camera size={16} /></span>
        </motion.button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          const blob = await squareCrop(f);
          setPreview({ blob, url: URL.createObjectURL(blob) });
        }} />
        <div className="grow">
          {name === null
            ? <h2 onClick={() => setName(me.full_name)} title="Tap to edit">{me.full_name}</h2>
            : <form onSubmit={async (e) => { e.preventDefault(); if (name.trim()) await a.updateProfile(me.id, { full_name: name.trim() }); setName(null); }}>
                <input autoFocus className="name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName(null)} />
              </form>}
          <span className="row gap-s"><Badge tone="role">{ROLE_META[me.role].label}</Badge><Badge>#{me.employee_code}</Badge></span>
        </div>
      </motion.div>

      <motion.div className="stats3" variants={item}>
        <div><small>Hours this month</small><b className="mono">{hm(normal + over)}</b></div>
        <div><small>Overtime</small><b className="mono">{hm(over)}</b></div>
        <div><small>Jobs · team</small><b className="mono">{completed} · {team}</b></div>
      </motion.div>

      <motion.div className="stack" variants={list}>
        <AbsenceForm kind="sick" title="Request off-sick" />
        <AbsenceForm kind="day_off" title="Request day-off" />
        <AbsenceForm kind="holiday" title="Request holidays" />
      </motion.div>

      <motion.div className="stats3 absence-tiles" variants={item}>
        <div className="k-sick"><small>Off-sick</small><b>{days("sick")}</b><em>days in {year}</em></div>
        <div className="k-day_off"><small>Day-off</small><b>{days("day_off")}</b><em>days in {year}</em></div>
        <div className="k-holiday"><small>Holidays</small><b>{days("holiday")}<span>/{me.holiday_allowance}</span></b><em>{Math.max(0, me.holiday_allowance - days("holiday"))} left</em></div>
      </motion.div>

      {mine.length > 0 && (
        <Section title="My requests">
          <div className="stack">
            {mine.slice(0, 6).map((r) => (
              <div key={r.id} className={`card mini-req k-${r.kind}`}>
                <div className="grow"><Badge tone={KIND[r.kind].tone}>{KIND[r.kind].label}</Badge> <span>{dayLabel(r.start_date)}{r.end_date !== r.start_date && ` → ${dayLabel(r.end_date)}`}</span></div>
                <Badge tone={r.status === "approved" ? "green" : r.status === "pending" ? "amber" : "muted"}>{r.status}</Badge>
                {r.status === "pending" && <button className="icon-btn subtle" onClick={() => a.decideAbsence(r.id, "cancelled")} aria-label="Cancel request"><X size={15} /></button>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Settings" sub="Saved on this device">
        <div className="card settings">
          <div className="set"><span><b>Text & layout size</b><small>Bigger for gloves and tablets</small></span>
            <Segmented size="s" value={prefs.scale} onChange={(v) => setPrefs({ scale: v })} options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]} /></div>
          <div className="set"><span><b>Theme</b><small>Pick your vibe</small></span>
            <Segmented size="s" value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: "midnight", label: "Night" }, { value: "carbon", label: "Carbon" }, { value: "aurora", label: "Aurora" }]} /></div>
          <div className="set col"><span><b>Start screen</b><small>Tab shown when the app opens</small></span>
            <Segmented size="s" value={TABS_FOR[me.role].includes(prefs.startTab) ? prefs.startTab : "home"} onChange={(v: Tab) => setPrefs({ startTab: v })}
              options={TABS_FOR[me.role].slice(0, 4).map((t) => ({ value: t, label: TAB_META[t].label }))} /></div>
          <div className="set"><span><b>Reduce animations</b><small>Open panels instantly</small></span><Toggle on={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} /></div>
          <div className="set"><span><b>Haptics</b><small>Little buzz on taps (Android)</small></span><Toggle on={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} /></div>
          <div className="set"><span><b>Sounds</b><small>Soft clicks on actions</small></span><Toggle on={prefs.sounds} onChange={(v) => setPrefs({ sounds: v })} /></div>
          <div className="set"><span><b>Update app</b><small>v{__APP_VERSION__} · {backend.mode === "demo" ? "demo mode" : "cloud sync"}</small></span>
            <Btn small tone="soft" icon={<RefreshCw size={15} />} onClick={async () => {
              const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
              await Promise.all(regs.map((r) => r.update()));
              location.reload();
            }}>Reload</Btn></div>
        </div>
      </Section>

      <Btn tone="danger" wide icon={<LogOut size={18} />} onClick={onSignOut}>Sign out</Btn>
      <p className="foot">Skalarki Electronics Ltd · Factory app</p>

      <Sheet open={!!preview} onClose={() => setPreview(null)} title="New profile photo">
        {preview && (
          <div className="stack center">
            <motion.img src={preview.url} className="pfp-preview" initial={{ scale: 0.6, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 200, damping: 16 }} />
            <div className="row gap">
              {me.avatar_url && <Btn tone="ghost" icon={<Trash2 size={16} />} onClick={async () => { await a.updateProfile(me.id, { avatar_url: null }); setPreview(null); }}>Remove current</Btn>}
              <Btn tone="primary" icon={<Camera size={16} />} onClick={async () => { await a.uploadAvatar(preview.blob); setPreview(null); }}>Use this photo</Btn>
            </div>
          </div>
        )}
      </Sheet>
    </motion.div>
  );
}

function AbsenceForm({ kind, title }: { kind: AbsenceKind; title: string }) {
  const a = useActions();
  const [open, setOpen] = useState(false);
  const today = ymd(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");
  const n = to >= from ? daysBetween(from, to) : 0;
  return (
    <motion.div className={`card absence k-${kind} ${open ? "open" : ""}`} variants={item} layout>
      <button className="absence-head" onClick={() => setOpen(!open)}>
        <span><small className="eyebrow">Absence</small><b>{title}</b></span>
        <motion.span animate={{ rotate: open ? 180 : 0 }}><ChevronDown size={22} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="absence-body">
            <div className="row gap">
              <Field label="From"><input type="date" value={from} min={kind === "sick" ? undefined : today} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Field>
              <Field label="To"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "sick" ? "How are you feeling?" : "Anything your manager should know"} /></Field>
            <Btn tone="primary" wide disabled={!n} icon={<Send size={16} />} onClick={async () => { await a.requestAbsence(kind, from, to, note); setOpen(false); setNote(""); }}>
              Send · {n} day{n === 1 ? "" : "s"}
            </Btn>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
