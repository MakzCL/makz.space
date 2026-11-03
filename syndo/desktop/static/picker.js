let kind = "screen", chosen = null, data = { sources: [], systemAudio: false };
const grid = document.getElementById("grid"), share = document.getElementById("share");
function render() {
  grid.textContent = "";
  for (const s of data.sources.filter((x) => x.kind === kind)) {
    const b = document.createElement("button");
    b.className = "src"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(chosen === s.id));
    const t = document.createElement("img"); t.className = "t"; t.alt = ""; t.src = s.thumb; b.appendChild(t);
    const l = document.createElement("span"); if (s.icon) { const i = document.createElement("img"); i.src = s.icon; i.alt = ""; l.appendChild(i); }
    l.appendChild(document.createTextNode(s.name)); b.appendChild(l);
    b.addEventListener("click", () => { chosen = s.id; share.disabled = false; render(); });
    b.addEventListener("dblclick", () => { chosen = s.id; done(); });
    grid.appendChild(b);
  }
}
function tab(k) { kind = k; for (const x of ["screen", "window"]) document.getElementById(`t-${x}`).setAttribute("aria-selected", String(x === k)); render(); }
document.getElementById("t-screen").onclick = () => tab("screen");
document.getElementById("t-window").onclick = () => tab("window");
const done = () => window.syndoLocal.choose(chosen ? { id: chosen, audio: data.systemAudio && document.getElementById("audio").checked } : null);
share.onclick = done;
document.getElementById("cancel").onclick = () => window.syndoLocal.choose(null);
addEventListener("keydown", (e) => { if (e.key === "Escape") window.syndoLocal.choose(null); });
window.syndoLocal.pickerSources().then((d) => {
  data = d;
  if (!d.systemAudio) { document.getElementById("audioRow").hidden = true; document.getElementById("audioNote").textContent = "System audio sharing is available on Windows."; }
  else document.getElementById("audioNote").textContent = "Windows captures all system audio. Sharing a single app's audio isn't supported by Windows' capture API for this app yet.";
  render();
});
