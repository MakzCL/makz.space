/** Only an explicit preview URL or the dedicated bundled origin uses sample data. */
function mode() {
  try {
    const query = new URLSearchParams(location.search);
    if (query.get("live") === "1") { sessionStorage.removeItem("syndo.preview"); return false; }
    if (query.get("preview") === "1" || location.hostname === "appassets.androidplatform.net") sessionStorage.setItem("syndo.preview", "1");
    return sessionStorage.getItem("syndo.preview") === "1";
  } catch { return false; }
}
export const previewMode = mode();
