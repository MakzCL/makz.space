/** Tiny safe arithmetic for numeric fields: numbers, + - * / and parentheses. Anything else → null. */
export function evalNum(s: string): number | null {
  if (!/^[\d\s.+\-*/()eE]+$/.test(s) || !s.trim()) return null;
  let i = 0; const src = s.replace(/\s+/g, "");
  const num = (): number => { const m = /^\d*\.?\d+(?:[eE][-+]?\d+)?|^\d+\.?/.exec(src.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const atom = (): number => { if (src[i] === "-") { i++; return -atom(); } if (src[i] === "+") { i++; return atom(); } if (src[i] === "(") { i++; const v = expr(); if (src[i] !== ")") throw 0; i++; return v; } return num(); };
  const term = (): number => { let v = atom(); while (src[i] === "*" || src[i] === "/") { const o = src[i++]; const r = atom(); v = o === "*" ? v * r : v / r; } return v; };
  const expr = (): number => { let v = term(); while (src[i] === "+" || src[i] === "-") { const o = src[i++]; const r = term(); v = o === "+" ? v + r : v - r; } return v; };
  try { const v = expr(); return i === src.length && Number.isFinite(v) ? v : null; } catch { return null; }
}
