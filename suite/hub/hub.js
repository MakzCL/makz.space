// SK Suite hub: lists the apps, opens them, shows which are open, and switches the palette.
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); } for (const c of kids) if (c != null) e.append(c); return e; };
let APPS = [], STATE = { palette: "granat", running: [], lastOpened: {} }, online = navigator.onLine;

const ago = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400); return d === 1 ? "yesterday" : `${d} days ago`; };
const icon = (a) => el("img", { src: `icons/${a.icon}`, alt: "" });
const open = (id) => window.suite.open(id);

function paintPalette() {
  document.documentElement.dataset.theme = STATE.palette;
  try { localStorage.setItem("suite-palette", JSON.stringify(STATE.palette)); } catch { /* ignore */ }
  for (const b of document.querySelectorAll(".themes button")) b.classList.toggle("on", b.dataset.p === STATE.palette);
}
function render() {
  paintPalette();
  const running = new Set(STATE.running);
  const grid = $("#grid"); grid.replaceChildren(...APPS.map((a) => {
    const live = running.has(a.id);
    return el("button", { type: "button", class: `tile${live ? " is-running" : ""}`, "data-app": a.id, onclick: () => open(a.id), title: `Open ${a.name}` },
      el("div", { class: "logo" }, icon(a)),
      el("div", {}, el("b", {}, a.name), el("small", {}, a.tagline)),
      el("div", { class: "cta" }, a.offline ? el("span", { class: "badge ok" }, "Works offline") : el("span", { class: "badge" }, online ? "Online" : "Needs internet"), el("span", {}, live ? "Switch to" : "Open")));
  }));
  const recent = Object.entries(STATE.lastOpened).sort((a, b) => b[1].localeCompare(a[1])).slice(0, 6).map(([id, at]) => { const a = APPS.find((x) => x.id === id); return a && el("button", { type: "button", class: "chip", onclick: () => open(id) }, icon(a), el("span", {}, a.name), el("em", {}, ago(at))); }).filter(Boolean);
  $("#recent").replaceChildren(...recent);
  $("#list").replaceChildren(...APPS.map((a) => el("div", { class: "row" }, icon(a),
    el("div", {}, el("b", {}, a.name), el("p", {}, a.description)),
    el("div", { class: "acts" }, a.offline ? null : el("button", { type: "button", class: "btn", onclick: () => window.suite.openInBrowser(a.id) }, "Open in browser"), el("button", { type: "button", class: "btn primary", onclick: () => open(a.id) }, running.has(a.id) ? "Switch to" : "Open")))));
  $("#running").replaceChildren(...APPS.filter((a) => running.has(a.id)).map((a) => el("button", { type: "button", class: "run", onclick: () => open(a.id) }, icon(a), el("span", {}, a.name))));
  const net = $("#net"); net.className = `net ${online ? "on" : "off"}`; net.lastElementChild.textContent = online ? "Online" : "Offline: NUCLEUS still works";
}
function show(view) {
  for (const b of document.querySelectorAll(".nav")) b.classList.toggle("on", b.dataset.view === view);
  for (const s of document.querySelectorAll(".view")) s.hidden = s.id !== `view-${view}`;
}
async function main() {
  const h = new Date().getHours(); $("#greet").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  for (const b of document.querySelectorAll(".nav")) b.addEventListener("click", () => show(b.dataset.view));
  for (const b of document.querySelectorAll(".themes button")) b.addEventListener("click", async () => { STATE.palette = await window.suite.setPalette(b.dataset.p); paintPalette(); });
  window.addEventListener("online", () => { online = true; render(); }); window.addEventListener("offline", () => { online = false; render(); });
  [APPS, STATE] = await Promise.all([window.suite.apps(), window.suite.state()]);
  window.suite.onState((s) => { STATE = s; render(); });
  const v = await window.suite.version(); $("#about").textContent = `SK Suite ${v.suite} · Electron ${v.electron} · Chromium ${v.chrome}. NUCLEUS is a separate product bundled for offline use.`;
  render();
}
main();
