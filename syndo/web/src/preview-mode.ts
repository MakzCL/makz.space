/** Explicit opt-in only; a failed production request never activates sample data. */
function mode() {
  try {
    const query = new URLSearchParams(location.search);
    if (query.get("live") === "1") { sessionStorage.removeItem("syndo.preview"); return false; }
    if (query.get("preview") === "1") sessionStorage.setItem("syndo.preview", "1");
    return sessionStorage.getItem("syndo.preview") === "1";
  } catch { return false; }
}
export const previewMode = mode();
