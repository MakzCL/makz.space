const q = new URLSearchParams(location.search);
const err = document.getElementById("err"), input = document.getElementById("u"), go = document.getElementById("go");
if (q.get("error") === "unreachable") err.textContent = `Couldn't reach ${q.get("server") || "the server"}. Check your connection, or choose another server.`;
window.syndoLocal.connectInfo().then((i) => { input.value = i.current || i.baked || ""; });
document.getElementById("f").addEventListener("submit", async (e) => {
  e.preventDefault(); go.disabled = true; err.textContent = "Checking…";
  const r = await window.syndoLocal.setServer(input.value);
  go.disabled = false; err.textContent = r.ok ? "" : r.reason;
});
