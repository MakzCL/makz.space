// UI audit crawler. For each screen: static checks (overflow, clipping, labels, contrast, tap targets, off-screen),
// then clicks every visible control one at a time from a fresh screen and records crashes, console errors, failed
// requests and controls that do nothing. Used by audit-*.mjs runners; writes JSON + Markdown reports.
import fs from "node:fs";

export const STATIC_JS = () => {
  const out = []; const W = innerWidth;
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
  const name = (e) => (e.getAttribute("aria-label") || e.getAttribute("title") || e.innerText || e.value || e.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const path = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 4; x = x.parentElement) p.unshift(x.tagName.toLowerCase() + (x.dataset.testid ? `[${x.dataset.testid}]` : x.className && typeof x.className === "string" ? "." + x.className.trim().split(/\s+/)[0] : "")); return p.join(">"); };
  if (document.documentElement.scrollWidth > W + 1) out.push({ kind: "page-horizontal-scroll", detail: `page is ${document.documentElement.scrollWidth}px wide in a ${W}px window` });
  for (const e of document.querySelectorAll("button, a[href], [role=button], [role=tab], input:not([type=hidden]), select, textarea")) {
    if (!vis(e)) continue; const r = e.getBoundingClientRect();
    if (!name(e) && !(e.labels && e.labels.length) && !e.getAttribute("placeholder") && !e.closest("label")) out.push({ kind: "no-accessible-name", detail: path(e) });
    const inScroller = (() => { for (let x = e.parentElement; x; x = x.parentElement) { const st = getComputedStyle(x); if (/(auto|scroll)/.test(st.overflowX) && x.scrollWidth > x.clientWidth + 1) return true; } return false; })();
    if ((r.right > W + 1 || r.left < -1) && !inScroller) out.push({ kind: "off-screen-control", detail: `${path(e)} "${name(e)}" at x ${Math.round(r.left)}–${Math.round(r.right)}` });
    if (W <= 500 && (r.width < 24 || r.height < 24) && !["checkbox", "radio"].includes(e.type)) out.push({ kind: "small-tap-target", detail: `${path(e)} "${name(e)}" ${Math.round(r.width)}×${Math.round(r.height)}` });
  }
  // clipped text: an element whose text is cut (overflow hidden/ellipsis) — reported only when it has no title to reveal it
  for (const e of document.querySelectorAll("body *")) {
    if (!vis(e) || e.children.length > 3) continue; const s = getComputedStyle(e); const t = (e.innerText || "").trim(); if (!t || t.length < 2) continue;
    if ((s.overflowX === "hidden" || s.textOverflow === "ellipsis") && e.scrollWidth > e.clientWidth + 2 && !e.title && !e.closest("[title]")) out.push({ kind: "clipped-text", detail: `${path(e)} "${t.slice(0, 50)}"` });
  }
  // text contrast (WCAG AA 4.5:1 normal, 3:1 large) against the nearest opaque background
  const rgb = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (e) => { for (let x = e; x; x = x.parentElement) { const c = rgb(getComputedStyle(x).backgroundColor); if (c && (c[3] === undefined || c[3] > 0.9)) return c; if (getComputedStyle(x).backgroundImage !== "none") return null; } return [255, 255, 255]; };
  const seen = new Set();
  for (const e of document.querySelectorAll("body *")) {
    if (!vis(e)) continue; const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1); if (!own) continue;
    if (e.closest("canvas, svg, [aria-hidden=true]") || e.closest("button:disabled, [disabled], .disabled")) continue;
    if (e.closest(".seg button.on, .k-seg button.on")) continue; // the selected segment's background is a sliding sibling pill
    const s = getComputedStyle(e); const fg = rgb(s.color), bg = bgOf(e); if (!fg || !bg) continue;
    const a = fg[3] === undefined ? 1 : fg[3]; const mix = fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
    const L1 = lum(mix), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(s.fontSize), bold = +s.fontWeight >= 700; const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    if (ratio < need - 0.05) { const k = `${s.color}|${bgOf(e)}|${size}`; if (seen.has(k)) continue; seen.add(k); out.push({ kind: "low-contrast", detail: `${path(e)} "${e.textContent.trim().slice(0, 40)}" ${ratio.toFixed(2)}:1 (needs ${need}:1) ${s.color} on rgb(${bg.join(",")}) ${size}px` }); }
  }
  return out;
};

const CONTROLS = "button:not([disabled]), a[href]:not([href^='http']):not([download]), [role=tab], [role=menuitem], input[type=checkbox]:not([disabled]), input[type=radio]:not([disabled]), select:not([disabled])";

/** Crawl one screen. open(page) must navigate a fresh page to the screen. */
export async function crawlScreen({ browser, newPage, open, app, screen, viewport, maxControls = 120, skip = [] }) {
  const issues = []; const add = (kind, detail, extra = {}) => issues.push({ app, screen, viewport: viewport.width, kind, detail, ...extra });
  const page = await newPage(viewport); const errs = []; hook(page, errs);
  await open(page); await page.waitForTimeout(700);
  for (const x of await page.evaluate(STATIC_JS)) add(x.kind, x.detail);
  for (const e of errs.splice(0)) add(e.kind, e.detail, { control: "(load)" });
  const controls = await page.evaluate((sel) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
    // with a dialog/sheet open, only its own controls are reachable (as for a person)
    const dlg = [...document.querySelectorAll("[role=dialog], [role=menu], .t-modal, .n-modal, .sheet-wrap, .k-sheet")].filter(vis).pop();
    return [...document.querySelectorAll(sel)].filter(vis).map((e, i) => ({ i, e })).filter(({ e }) => !dlg || dlg.contains(e)).map(({ i, e }) => ({ i, tag: e.tagName.toLowerCase(), type: e.type || "",
      active: e.classList.contains("on") || e.classList.contains("active") || e.getAttribute("aria-selected") === "true" || e.getAttribute("aria-pressed") === "true" || e.getAttribute("aria-current") === "page",
      text: (e.getAttribute("aria-label") || e.innerText || e.title || e.value || "").trim().replace(/\s+/g, " ").slice(0, 50), testid: e.dataset.testid || "" }));
  }, CONTROLS);
  await page.close();
  let n = 0;
  for (const c of controls) {
    if (n++ >= maxControls) break;
    const label = c.text || c.testid || `${c.tag}#${c.i}`;
    if (skip.some((s) => (typeof s === "string" ? label.includes(s) : s.test(label)))) continue;
    const p = await newPage(viewport); const e2 = []; hook(p, e2);
    try {
      await open(p); await p.waitForTimeout(400);
      const el = p.locator(CONTROLS).filter({ visible: true }).nth(c.i);
      if (!(await el.count())) continue;
      const before = await p.evaluate(() => document.body.innerHTML.length + "|" + document.body.innerText + "|" + location.href + "|" + document.activeElement?.tagName);
      if (c.tag === "select") { const opts = await el.locator("option").evaluateAll((o) => o.map((x) => x.value)); const cur = await el.inputValue(); const other = opts.find((v) => v !== cur); if (other !== undefined) await el.selectOption(other, { timeout: 3000 }); }
      else await el.click({ timeout: 3000, trial: false });
      await p.waitForTimeout(600);
      const after = await p.evaluate(() => document.body.innerHTML.length + "|" + document.body.innerText + "|" + location.href + "|" + document.activeElement?.tagName);
      const dl = e2.find((x) => x.kind === "download"); const pop = e2.find((x) => x.kind === "popup");
      const confirmed = e2.some((x) => x.kind === "dialog"); // a confirm() that the crawler cancelled
      if (before === after && !dl && !pop && !confirmed && !c.active && c.tag !== "select" && c.type !== "checkbox") add("dead-control", `"${label}" (${c.tag}) changes nothing visible`, { control: label });
      for (const x of await p.evaluate(STATIC_JS)) if (["page-horizontal-scroll", "off-screen-control"].includes(x.kind)) add(x.kind, `after "${label}": ${x.detail}`, { control: label });
    } catch (err) { add("click-failed", `"${label}": ${String(err.message).split("\n")[0].slice(0, 160)}`, { control: label }); }
    for (const x of e2) if (!["download", "popup"].includes(x.kind)) add(x.kind, x.detail, { control: label });
    await p.close().catch(() => {});
  }
  return issues;
}
function hook(p, errs) {
  p.on("pageerror", (e) => errs.push({ kind: "js-error", detail: String(e.message).slice(0, 200) }));
  p.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: net::ERR_FAILED|ERR_BLOCKED/.test(m.text())) errs.push({ kind: "console-error", detail: m.text().slice(0, 200) }); });
  p.on("requestfailed", (r) => { const u = r.url(); if (!/fontshare|fonts\.g|favicon|supabase\.co\/realtime/.test(u) && r.failure()?.errorText !== "net::ERR_ABORTED") errs.push({ kind: "request-failed", detail: `${u.slice(0, 120)} ${r.failure()?.errorText}` }); });
  p.on("download", () => errs.push({ kind: "download", detail: "" })); p.on("popup", () => errs.push({ kind: "popup", detail: "" }));
  p.on("dialog", (d) => { errs.push({ kind: "dialog", detail: d.message().slice(0, 80) }); d.dismiss().catch(() => {}); });
}
export function report(all, file) {
  const dedup = new Map(); for (const i of all) { const k = `${i.app}|${i.kind}|${i.detail}`; if (!dedup.has(k)) dedup.set(k, { ...i, screens: new Set([i.screen]), widths: new Set([i.viewport]) }); else { dedup.get(k).screens.add(i.screen); dedup.get(k).widths.add(i.viewport); } }
  const rows = [...dedup.values()].filter((i) => i.kind !== "dialog");
  fs.writeFileSync(file + ".json", JSON.stringify(rows.map((r) => ({ ...r, screens: [...r.screens], widths: [...r.widths] })), null, 1));
  const by = {}; for (const r of rows) (by[r.app] ??= {})[r.kind] = [...(by[r.app][r.kind] ?? []), r];
  let md = "# UI audit\n\n"; for (const [app, kinds] of Object.entries(by)) { md += `## ${app}\n\n`; for (const [k, list] of Object.entries(kinds)) { md += `### ${k} (${list.length})\n`; for (const r of list.slice(0, 60)) md += `- [${[...r.screens].join(", ")} @${[...r.widths].join("/")}] ${r.detail}\n`; md += "\n"; } }
  fs.writeFileSync(file + ".md", md); return rows;
}
