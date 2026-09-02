/** Class name join. No dependency, no variant engine — just concatenation. */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** Two-digit index, the way the whole site counts. */
export function pad(n: number, width = 2) {
  return String(n).padStart(width, "0");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 0 → 1 position of `value` inside [from, to]. */
export function progress(value: number, from: number, to: number) {
  if (to === from) return 0;
  return clamp((value - from) / (to - from), 0, 1);
}

export function formatDate(iso: string | null | undefined, style: "long" | "short" = "long") {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: style === "long" ? "long" : "short",
    year: "numeric",
  }).format(date);
}

/**
 * Every relative time in this application describes something that already
 * happened — an account joined, a record was kept, a probe last ran. A clock
 * a few seconds out of step between the browser and the server would
 * otherwise print "in 12 minutes" for a past event, so the future is clamped
 * to now rather than reported.
 */
export function formatRelative(iso: string | null | undefined) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.min(0, Math.round((then - Date.now()) / 1000));
  if (seconds > -30) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(Math.round(seconds), "second");
}

/** Duration since an ISO instant as HH:MM:SS. Used by the live counter. */
export function elapsed(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return null;
  const start = new Date(iso).getTime();
  if (Number.isNaN(start) || start > now) return null;
  const total = Math.floor((now - start) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/**
 * Deterministic small integer from a string. Used to give avatars and index
 * marks stable, non-random variation without storing anything.
 */
export function hashOf(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Naive but effective subsequence match for the command palette. */
export function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const direct = t.indexOf(q);
  if (direct === 0) return 1000;
  if (direct > 0) return 700 - direct;

  let score = 0;
  let ti = 0;
  let streak = 0;
  for (const char of q) {
    const found = t.indexOf(char, ti);
    if (found === -1) return 0;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 6 - Math.min(found - ti, 12);
    ti = found + 1;
  }
  return score;
}
