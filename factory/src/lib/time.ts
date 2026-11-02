import { locale, t } from "./i18n";
import type { Break, DB, Participant, Shift, WorkSession } from "./types";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY_TARGET = 8 * HOUR;

const tsOf = (s: string | null | undefined, now: number) => (s ? new Date(s).getTime() : now);

export function hm(ms: number) {
  const neg = ms < 0;
  const m = Math.floor(Math.abs(ms) / MIN);
  return `${neg ? "-" : ""}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
export function hms(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? h + ":" : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}
export function human(ms: number) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
/** "7hr 16" style used on the dials. */
export function hrMin(ms: number) {
  const m = Math.max(0, Math.floor(ms / MIN));
  return { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") };
}
export const clock = (s: string) => new Date(s).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
export const dayLabel = (d: Date | string) =>
  new Date(d).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
export const longDate = (d: Date) => d.toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" });
export const weekday = (d: Date | string) => new Date(d).toLocaleDateString(locale(), { weekday: "short" });
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ago(s: string, now = Date.now()) {
  const d = now - new Date(s).getTime();
  if (d < MIN) return t("just now");
  if (d < HOUR) return t("{n}m ago", { n: Math.floor(d / MIN) });
  if (d < 24 * HOUR) return t("{n}h ago", { n: Math.floor(d / HOUR) });
  const days = Math.floor(d / (24 * HOUR));
  return days === 1 ? t("yesterday") : days < 7 ? t("{n}d ago", { n: days }) : dayLabel(s);
}

export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function startOfWeek(d = new Date()) {
  const x = startOfDay(d); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x;
}
export function startOfMonth(d = new Date()) { const x = startOfDay(d); x.setDate(1); return x; }

export function breakMs(b: Break, now: number) { return tsOf(b.ended_at, now) - tsOf(b.started_at, now); }

export function shiftWorked(s: Shift, breaks: Break[], now: number) {
  const gross = tsOf(s.clock_out, now) - tsOf(s.clock_in, now);
  const br = breaks.filter((b) => b.shift_id === s.id).reduce((a, b) => a + breakMs(b, now), 0);
  return Math.max(0, gross - br);
}

/** Worked time per calendar day (keyed by clock-in day), split into normal/overtime at 8h. */
export function dailyTotals(shifts: Shift[], breaks: Break[], now: number) {
  const map = new Map<string, number>();
  for (const s of shifts) {
    const k = ymd(new Date(s.clock_in));
    map.set(k, (map.get(k) ?? 0) + shiftWorked(s, breaks, now));
  }
  return map;
}
export function splitOvertime(totalPerDay: Iterable<number>) {
  let normal = 0, over = 0;
  for (const v of totalPerDay) { normal += Math.min(v, DAY_TARGET); over += Math.max(0, v - DAY_TARGET); }
  return { normal, over };
}

export function participantMs(p: Participant, now: number) { return tsOf(p.left_at, now) - tsOf(p.joined_at, now); }
export function sessionMs(s: WorkSession, now: number) { return tsOf(s.ended_at, now) - tsOf(s.started_at, now); }

/** Wall time vs person-hours for a job — the heart of the "team job" view. */
export function jobStats(db: DB, jobId: string, now: number) {
  const sessions = db.work_sessions.filter((s) => s.job_id === jobId);
  const parts = db.participants.filter((p) => p.job_id === jobId);
  const wall = sessions.reduce((a, s) => a + sessionMs(s, now), 0);
  const person = parts.reduce((a, p) => a + participantMs(p, now), 0);
  const people = new Set(parts.map((p) => p.user_id));
  let maxCrew = 0;
  for (const s of sessions) {
    maxCrew = Math.max(maxCrew, new Set(parts.filter((p) => p.session_id === s.id).map((p) => p.user_id)).size);
  }
  const perPerson = new Map<string, number>();
  for (const p of parts) perPerson.set(p.user_id, (perPerson.get(p.user_id) ?? 0) + participantMs(p, now));
  const live = sessions.find((s) => !s.ended_at) ?? null;
  return { wall, person, people: [...people], maxCrew, perPerson, sessions, live, team: maxCrew >= 2 };
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  if (h < 5) return t("Night shift");
  if (h < 12) return t("Good morning");
  if (h < 17) return t("Good afternoon");
  return t("Good evening");
}

export function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / (24 * HOUR)) + 1;
}
