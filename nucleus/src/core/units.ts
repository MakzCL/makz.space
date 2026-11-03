// Engineering units. Electrical values use SPICE-compatible engineering notation; schematic geometry is
// in integer thou (1 th = 0.001 in = 0.0254 mm), PCB geometry in integer nanometres (see pcb/).
export const TH_MM = 0.0254;
export const thToMm = (th: number) => th * TH_MM;

const MULT: [RegExp, number][] = [
  [/^meg/i, 1e6], [/^mil/i, 25.4e-6], [/^f/i, 1e-15], [/^p/i, 1e-12], [/^n/i, 1e-9], [/^[uµμ]/i, 1e-6],
  [/^m/i, 1e-3], [/^k/i, 1e3], [/^g/i, 1e9], [/^t/i, 1e12],
];
/** Parse "4k7", "10k", "2.2u", "1meg", "100", "5V", "1.5mA", "47nF". Returns null when it is not a number. */
export function parseValue(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "").replace(/[Ωω]|ohms?$/i, "");
  if (!s) return null;
  // European "4k7" / "2u2" / "4R7" style
  const euro = /^(\d+)([pnuµμmkgtrR]|meg)(\d+)$/i.exec(s);
  if (euro) {
    const unit = euro[2].toLowerCase() === "r" ? "" : euro[2];
    const v = parseValue(`${euro[1]}.${euro[3]}${unit}`);
    return v;
  }
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(.*)$/i.exec(s);
  if (!m) return null;
  const base = parseFloat(m[1]);
  if (!Number.isFinite(base)) return null;
  let rest = m[2];
  let mult = 1;
  for (const [re, k] of MULT) if (re.test(rest)) { mult = k; rest = rest.replace(re, ""); break; }
  // anything left must be a unit name, never more digits
  if (rest && !/^(v|a|f|h|hz|s|w|ohm|r|%)?$/i.test(rest)) return null;
  return base * mult;
}
const PREFIX: [number, string][] = [[1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];
/** 0.00247 → "2.47m" (3 significant digits by default). */
export function formatEng(v: number, unit = "", digits = 3): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return `0${unit ? " " + unit : ""}`;
  const a = Math.abs(v);
  const [k, p] = PREFIX.find(([k]) => a >= k * 0.9995) ?? PREFIX[PREFIX.length - 1];
  const n = v / k;
  const s = Number(n.toPrecision(digits)).toString();
  return `${s}${unit || p ? " " : ""}${p}${unit}`;
}
/** SPICE wants "1meg" not "1M" (M = milli in SPICE). */
export function toSpice(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  const t: [number, string][] = [[1e12, "t"], [1e9, "g"], [1e6, "meg"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "u"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"]];
  const [k, p] = t.find(([k]) => a >= k) ?? t[t.length - 1];
  return `${Number((v / k).toPrecision(12))}${p}`;
}
