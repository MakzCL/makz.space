const q = new URLSearchParams(location.search); const url = q.get("url") || "";
try { const p = JSON.parse(localStorage.getItem("suite-palette") || "null"); if (p) document.documentElement.dataset.theme = p; } catch { /* storage blocked */ }
let host = ""; try { host = new URL(url).hostname; } catch { /* bad url */ }
document.getElementById("d").textContent = `${host || "The app"} could not be loaded. Check your internet connection; the suite will open it as soon as it is reachable.`;
document.getElementById("e").textContent = q.get("err") || "";
const go = () => { if (/^https:/.test(url)) location.href = url; };
document.getElementById("retry").onclick = go;
window.addEventListener("online", go); setInterval(() => { if (navigator.onLine) fetch(url, { mode: "no-cors", cache: "no-store" }).then(go, () => {}); }, 15000);
