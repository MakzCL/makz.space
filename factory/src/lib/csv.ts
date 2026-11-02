/** Small CSV reader/writer for Katana exports and our own exports. */

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(header: string[], rows: unknown[][]) {
  return [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "£1,234.50" → "1234.5", "1.234,5" → "1234.5", "" → "". */
export function cleanNumber(v: string | undefined) {
  let s = (v ?? "").trim().replace(/[£$€\s]/g, "").replace(/[A-Za-z]+$/, "");
  if (!s) return "";
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (s.includes(",")) s = /,\d{3}$/.test(s) && !/^0,/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(s) ? String(Number(s)) : "";
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Guess which column holds each field from Katana / common header names. */
export function guessColumns<K extends string>(header: string[], aliases: Record<K, string[]>): Record<K, number> {
  const h = header.map(norm);
  const out = {} as Record<K, number>;
  const used = new Set<number>();
  for (const key of Object.keys(aliases) as K[]) {
    let idx = -1;
    for (const a of aliases[key]) { idx = h.findIndex((x, i) => !used.has(i) && x === norm(a)); if (idx >= 0) break; }
    if (idx < 0) for (const a of aliases[key]) { idx = h.findIndex((x, i) => !used.has(i) && x.includes(norm(a))); if (idx >= 0) break; }
    out[key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}
