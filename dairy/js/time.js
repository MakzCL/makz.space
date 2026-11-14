// Farm-time-zone date helpers. No library: Intl does the zone maths.
// Instants are stored as ISO strings (UTC). Calendar days are 'YYYY-MM-DD'
// strings in the farm's time zone, so elapsed days follow the farm's clock,
// not the phone's.

const fmtCache = new Map();
function partsFormatter(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function partsIn(ms, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function offsetMs(ms, tz) {
  const p = partsIn(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock time in tz -> epoch ms. */
export function zonedToMs(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);
}

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(msOrIso, tz) {
  const ms = typeof msOrIso === 'string' ? Date.parse(msOrIso) : msOrIso;
  const p = partsIn(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export const todayKey = (tz, now = Date.now()) => dayKey(now, tz);

function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(key, n) {
  const t = new Date(keyToUTC(key) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole calendar days from a to b (b - a). */
export function diffDays(a, b) {
  return Math.round((keyToUTC(b) - keyToUTC(a)) / 86400000);
}

/** Value for <input type="datetime-local"> showing the instant in farm time. */
export function toInputDateTime(msOrIso, tz) {
  const ms = typeof msOrIso === 'string' ? Date.parse(msOrIso) : msOrIso;
  const p = partsIn(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** 'YYYY-MM-DDTHH:mm' in farm time -> ISO instant. */
export function fromInputDateTime(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(str || '');
  if (!m) return null;
  return new Date(zonedToMs(+m[1], +m[2], +m[3], +m[4], +m[5], tz)).toISOString();
}

/** Start of a farm calendar day as an instant. */
export function dayStartIso(key, tz) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(zonedToMs(y, m, d, 0, 0, tz)).toISOString();
}

// Display language for dates and relative days: 'en' or 'pl'.
let LANG = 'en';
export function setTimeLang(l) { LANG = l === 'pl' ? 'pl' : 'en'; }
const fmts = new Map();
function f(kind) {
  const key = `${LANG}:${kind}`;
  if (!fmts.has(key)) {
    const loc = LANG === 'pl' ? 'pl-PL' : 'en-GB';
    const o = { timeZone: 'UTC', ...(kind === 'date' ? { day: 'numeric', month: 'short', year: 'numeric' }
      : kind === 'short' ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short' }) };
    fmts.set(key, new Intl.DateTimeFormat(loc, o));
  }
  return fmts.get(key);
}

export const fmtDay = (key) => (key ? f('date').format(new Date(keyToUTC(key))) : '');
export const fmtDayShort = (key) => (key ? f('short').format(new Date(keyToUTC(key))) : '');
export const fmtDow = (key) => (key ? f('dow').format(new Date(keyToUTC(key))) : '');

export function fmtDateTime(iso, tz) {
  if (!iso) return '';
  const p = partsIn(Date.parse(iso), tz);
  return `${fmtDay(`${p.y}-${pad(p.m)}-${pad(p.d)}`)}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** Polish: 1 dzień, otherwise dni. */
const plDays = (n) => (n === 1 ? '1 dzień' : `${n} dni`);

export function agoText(days) {
  if (LANG === 'pl') {
    if (days === 0) return 'dzisiaj';
    if (days === 1) return 'wczoraj';
    if (days === -1) return 'jutro';
    if (days < 0) return `za ${plDays(-days)}`;
    return `${plDays(days)} temu`;
  }
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days === -1) return 'tomorrow';
  if (days < 0) return `in ${-days} days`;
  return `${days} days ago`;
}

export function inText(days) {
  if (LANG === 'pl') {
    if (days === 0) return 'dzisiaj';
    if (days === 1) return 'jutro';
    if (days < 0) return `${plDays(-days)} po terminie`;
    return `za ${plDays(days)}`;
  }
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return '1 day overdue';
  if (days < 0) return `${-days} days overdue`;
  return `in ${days} days`;
}

export function defaultTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export function timeZones() {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC', defaultTimeZone()]; }
}
