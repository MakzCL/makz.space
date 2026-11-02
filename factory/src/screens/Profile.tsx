import { AnimatePresence, motion } from "motion/react";
import { Award, Camera, ChevronDown, Eye, Flame, Handshake, LogOut, RefreshCw, Send, Star, Sunrise, Trash2, Trophy, X } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { SceneTabs } from "../components/Scene";
import { Badge, Btn, Field, LangSwitch, Section, Segmented, Sheet, Toggle, item, list } from "../components/ui";
import { tabLabel } from "../components/Shell";
import { useActions } from "../lib/actions";
import { t } from "../lib/i18n";
import { setPrefs, usePrefs } from "../lib/prefs";
import { TABS_FOR, type Tab } from "../lib/roles";
import { useNow, useStore } from "../lib/store";
import { DAY_TARGET, HOUR, dailyTotals, dayLabel, daysBetween, hm, jobStats, splitOvertime, startOfMonth, ymd } from "../lib/time";
import type { AbsenceKind } from "../lib/types";
import { KIND, kindLabel } from "./Requests";
import { roleLabel } from "./Team";

async function squareCrop(file: File, size = 320): Promise<Blob> {
  const img = await createImageBitmap(file);
  const s = Math.min(img.width, img.height);
  const c = document.createElement("canvas"); c.width = c.height = size;
  c.getContext("2d")!.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return await new Promise((r) => c.toBlob((b) => r(b!), "image/webp", 0.86));
}

type PTab = "me" | "awards" | "settings";

export function Profile({ onSignOut }: { onSignOut: () => void }) {
  const { me } = useStore();
  const a = useActions();
  const [tab, setTab] = useState<PTab>("me");
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [name, setName] = useState<string | null>(null);

  return (
    <motion.div className="page" initial="hidden" animate="show" variants={list}>
      <div className="profile-head">
        <SceneTabs kind="peaks" height={200} value={tab} onChange={setTab}
          tabs={[{ value: "me", label: t("Profile") }, { value: "awards", label: t("Awards") }, { value: "settings", label: t("Settings") }]} />
        <div className="profile-id">
          <motion.button className="avatar-edit" whileTap={{ scale: 0.94 }} onClick={() => fileRef.current?.click()} aria-label={t("Change photo")}>
            <Avatar p={me} size={88} />
            <span className="cam"><Camera size={15} /></span>
          </motion.button>
          <div className="grow">
            {name === null
              ? <h2 onClick={() => setName(me.full_name)} title={t("Tap to edit")}>{me.full_name}</h2>
              : <form onSubmit={async (e) => { e.preventDefault(); if (name.trim()) await a.updateProfile(me.id, { full_name: name.trim() }); setName(null); }}>
                  <input autoFocus className="name-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setName(null)} />
                </form>}
            <span className="row gap-s"><Badge tone="red">{roleLabel(me.role)}</Badge><Badge>#{me.employee_code}</Badge></span>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        const blob = await squareCrop(f);
        setPreview({ blob, url: URL.createObjectURL(blob) });
      }} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} className="stack-lg" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
          {tab === "me" && <MeTab />}
          {tab === "awards" && <Awards />}
          {tab === "settings" && <Settings onSignOut={onSignOut} />}
        </motion.div>
      </AnimatePresence>

      <Sheet open={!!preview} onClose={() => setPreview(null)} title={t("New profile photo")}>
        {preview && (
          <div className="stack center">
            <motion.img src={preview.url} className="pfp-preview" initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 200, damping: 18 }} />
            <div className="row gap">
              {me.avatar_url && <Btn tone="ghost" icon={<Trash2 size={16} />} onClick={async () => { await a.updateProfile(me.id, { avatar_url: null }); setPreview(null); }}>{t("Remove current")}</Btn>}
              <Btn tone="primary" icon={<Camera size={16} />} onClick={async () => { await a.uploadAvatar(preview.blob); setPreview(null); }}>{t("Use this photo")}</Btn>
            </div>
          </div>
        )}
      </Sheet>
    </motion.div>
  );
}

function MeTab() {
  const { db, me } = useStore();
  const a = useActions();
  const now = useNow(30000);
  const month = startOfMonth();
  const myShifts = db.shifts.filter((s) => s.user_id === me.id && new Date(s.clock_in) >= month);
  const { normal, over } = splitOvertime(dailyTotals(myShifts, db.breaks, now).values());
  const myJobs = new Set(db.participants.filter((p) => p.user_id === me.id).map((p) => p.job_id));
  const completed = db.jobs.filter((j) => j.status === "done" && myJobs.has(j.id)).length;
  const year = String(new Date().getFullYear());
  const mine = db.absences.filter((x) => x.user_id === me.id).sort((x, y) => y.start_date.localeCompare(x.start_date));
  const days = (k: AbsenceKind) => mine.filter((x) => x.kind === k && x.status === "approved" && x.start_date.startsWith(year)).reduce((tt, x) => tt + daysBetween(x.start_date, x.end_date), 0);
  return (
    <>
      <div className="tiles3">
        <div className="tile red"><b>{hm(normal + over)}</b><small>{t("Hours this month")}</small></div>
        <div className="tile blue"><b>{hm(over)}</b><small>{t("Overtime")}</small></div>
        <div className="tile plain"><b>{completed}</b><small>{t("Completed jobs")}</small></div>
      </div>
      <div className="stack">
        <AbsenceForm kind="sick" title={t("Request off-sick")} />
        <AbsenceForm kind="day_off" title={t("Request day-off")} />
        <AbsenceForm kind="holiday" title={t("Request holidays")} />
      </div>
      <div className="tiles3 absence-tiles">
        <div className="tile plain k-sick"><b>{days("sick")}</b><small>{t("Off-sick")} · {year}</small></div>
        <div className="tile plain k-day_off"><b>{days("day_off")}</b><small>{t("Day-off")} · {year}</small></div>
        <div className="tile plain k-holiday"><b>{days("holiday")}<span>/{me.holiday_allowance}</span></b><small>{t("Holidays")} · {t("{n} left", { n: Math.max(0, me.holiday_allowance - days("holiday")) })}</small></div>
      </div>
      {mine.length > 0 && (
        <Section title={t("My requests")}>
          <div className="stack">
            {mine.slice(0, 6).map((r) => (
              <div key={r.id} className={`card mini-req k-${r.kind}`}>
                <div className="grow"><Badge tone={KIND[r.kind].tone}>{kindLabel(r.kind)}</Badge> <span>{dayLabel(r.start_date)}{r.end_date !== r.start_date && ` → ${dayLabel(r.end_date)}`}</span></div>
                <Badge tone={r.status === "approved" ? "ok" : r.status === "pending" ? "moon" : "muted"}>{t(r.status)}</Badge>
                {r.status === "pending" && <button className="icon-btn subtle" onClick={() => a.decideAbsence(r.id, "cancelled")} aria-label={t("Cancel request")}><X size={15} /></button>}
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function Awards() {
  const { db, me } = useStore();
  const now = useNow(60000);
  const list2 = useMemo(() => {
    const myParts = db.participants.filter((p) => p.user_id === me.id);
    const jobIds = new Set(myParts.map((p) => p.job_id));
    const team = [...jobIds].filter((j) => jobStats(db, j, now).team).length;
    const done = db.jobs.filter((j) => j.status === "done" && jobIds.has(j.id)).length;
    const shifts = db.shifts.filter((s) => s.user_id === me.id);
    const early = shifts.filter((s) => { const d = new Date(s.clock_in); return d.getHours() * 60 + d.getMinutes() <= 6 * 60 + 15; }).length;
    const longest = Math.max(0, ...dailyTotals(shifts, db.breaks, now).values());
    const issues = db.issues.filter((i) => i.reported_by === me.id).length;
    const A: { name: string; desc: string; v: number; goal: number; icon: ReactNode }[] = [
      { name: "Team Player", desc: "Work 5 jobs as a team", v: team, goal: 5, icon: <Handshake size={26} /> },
      { name: "Early Bird", desc: "Clock in by 06:15 five times", v: early, goal: 5, icon: <Sunrise size={26} /> },
      { name: "Finisher", desc: "Help complete 10 jobs", v: done, goal: 10, icon: <Trophy size={26} /> },
      { name: "Iron Shift", desc: "Work a 9-hour day", v: Math.min(1, longest / (DAY_TARGET + HOUR)), goal: 1, icon: <Flame size={26} /> },
      { name: "Eagle Eye", desc: "Report 3 issues", v: issues, goal: 3, icon: <Eye size={26} /> },
      { name: "Regular", desc: "Clock 20 shifts", v: shifts.length, goal: 20, icon: <Star size={26} /> },
    ];
    return A;
  }, [db, me.id, now]);
  const won = list2.filter((x) => x.v >= x.goal);
  const next = list2.filter((x) => x.v < x.goal);
  return (
    <>
      <Section title={t("Rewards achieved")} action={<span className="count-pill">{won.length}/{list2.length}</span>}>
        {won.length ? (
          <div className="award-grid">
            {won.map((x, i) => (
              <motion.div key={x.name} className={`award ${i % 2 ? "blue" : "red"}`} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.06, type: "spring", stiffness: 220, damping: 18 }}>
                <span className="medal">{x.icon}</span><b className="award-name">{t(x.name)}</b>
              </motion.div>
            ))}
          </div>
        ) : <p className="muted">{t("Your first award is close — check the list below.")}</p>}
      </Section>
      <Section title={t("Next up")}>
        <div className="stack">
          {next.map((x) => (
            <div key={x.name} className="card goal">
              <span className="goal-ic"><Award size={20} /></span>
              <div className="grow">
                <b>{t(x.name)}</b>
                <small className="muted">{t(x.desc)}</small>
                <div className="thin red"><motion.i initial={{ width: 0 }} animate={{ width: `${(x.v / x.goal) * 100}%` }} /></div>
                <small className="red-t">{t("Progress")}: {Math.round((x.v / x.goal) * 100)}%</small>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function Settings({ onSignOut }: { onSignOut: () => void }) {
  const { me } = useStore();
  const prefs = usePrefs();
  return (
    <>
      <div className="card settings">
        <div className="set"><span><b>{t("Language")}</b><small>English / Polski</small></span><LangSwitch /></div>
        <div className="set"><span><b>{t("Text & layout size")}</b><small>{t("Bigger for gloves and tablets")}</small></span>
          <Segmented size="s" value={prefs.scale} onChange={(v) => setPrefs({ scale: v })} options={[{ value: "s", label: "S" }, { value: "m", label: "M" }, { value: "l", label: "L" }]} /></div>
        <div className="set"><span><b>{t("Background")}</b><small>{t("Night blue or deeper")}</small></span>
          <Segmented size="s" value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: "night", label: t("Night") }, { value: "deep", label: t("Deep") }]} /></div>
        <div className="set col"><span><b>{t("Start screen")}</b><small>{t("Tab shown when the app opens")}</small></span>
          <Segmented size="s" value={TABS_FOR[me.role].includes(prefs.startTab) ? prefs.startTab : "home"} onChange={(v: Tab) => setPrefs({ startTab: v })}
            options={TABS_FOR[me.role].slice(0, 4).map((x) => ({ value: x, label: tabLabel(x) }))} /></div>
        <div className="set"><span><b>{t("Reduce animations")}</b><small>{t("Open panels instantly")}</small></span><Toggle on={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })} /></div>
        <div className="set"><span><b>{t("Vibration")}</b><small>{t("Short buzz on taps (Android)")}</small></span><Toggle on={prefs.haptics} onChange={(v) => setPrefs({ haptics: v })} /></div>
        <div className="set"><span><b>{t("Sounds")}</b><small>{t("Soft clicks on actions")}</small></span><Toggle on={prefs.sounds} onChange={(v) => setPrefs({ sounds: v })} /></div>
        <div className="set"><span><b>{t("Update app")}</b><small>v{__APP_VERSION__} · {t("cloud sync")}</small></span>
          <Btn small tone="soft" icon={<RefreshCw size={15} />} onClick={async () => {
            const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
            await Promise.all(regs.map((r) => r.update()));
            location.reload();
          }}>{t("Reload")}</Btn></div>
      </div>
      <Btn tone="danger" wide icon={<LogOut size={18} />} onClick={onSignOut}>{t("Sign out")}</Btn>
      <p className="foot">Skalarki Electronics Ltd</p>
    </>
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
        <span><small className="label">{t("Absence")}</small><b>{title}</b></span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="absence-chev"><ChevronDown size={20} /></motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="absence-body">
            <div className="row gap">
              <Field label={t("From")}><input type="date" value={from} min={kind === "sick" ? undefined : today} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></Field>
              <Field label={t("To")}><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Field label={t("Note (optional)")}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "sick" ? t("How are you feeling?") : t("Anything your manager should know")} /></Field>
            <Btn tone="primary" wide disabled={!n} icon={<Send size={16} />} onClick={async () => { await a.requestAbsence(kind, from, to, note); setOpen(false); setNote(""); }}>
              {t("Send")} · {n}
            </Btn>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
