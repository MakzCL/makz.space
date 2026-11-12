// SK Suite release channel: "stable" (the live apps) or "beta" (the pre-publish suite for testing updates).
// A build is beta when it was built with SK_CHANNEL=beta or from the git branch "beta" on Cloudflare Pages
// (CF_PAGES_BRANCH), which each app's vite.config passes in as __SK_CHANNEL__. A page served from a
// beta.* address is beta too, so a stable build can never be mistaken for beta and vice versa on the web.
// Beta apps link to each other, never to the live apps, and show a BETA mark in the corner.
declare const __SK_CHANNEL__: string | undefined;

const built = typeof __SK_CHANNEL__ !== "undefined" ? __SK_CHANNEL__ : "stable";
const host = typeof location !== "undefined" ? location.hostname : "";
export const IS_BETA = built === "beta" || /^beta\./.test(host);
export const CHANNEL: "stable" | "beta" = IS_BETA ? "beta" : "stable";

const STABLE = {
  factory: "https://factory.makz.space", kortana: "https://kortana.makz.space", trotan: "https://trotan.makz.space",
  nucleus: "https://nucleus-eda.pages.dev", cadra: "https://cadra.makz.space",
  suiteDownload: "https://sk-suite.pages.dev/download/SK-Suite-win-x64.zip",
};
const BETA_FACTORY = "https://beta.skalarki-factory.pages.dev";
const BETA: typeof STABLE = {
  factory: BETA_FACTORY, kortana: `${BETA_FACTORY}/kimera`, trotan: `${BETA_FACTORY}/trotan`,
  nucleus: "https://beta.nucleus-eda.pages.dev", cadra: "https://beta.cadra.pages.dev",
  suiteDownload: "https://beta.sk-suite.pages.dev/download/SK-Suite-Beta-win-x64.zip",
};
/** Addresses of the SK Suite apps in this channel. */
export const URLS = IS_BETA ? BETA : STABLE;

/** Shows the BETA mark in the top-left corner and prefixes the window title. Does nothing in stable builds. */
export function mountBetaMark(): void {
  if (!IS_BETA || typeof document === "undefined" || document.getElementById("sk-beta-mark")) return;
  const style = document.createElement("style");
  style.textContent = `#sk-beta-mark{position:fixed;top:0;left:0;width:92px;height:92px;overflow:hidden;z-index:2147483647;pointer-events:none}
#sk-beta-mark span{position:absolute;top:16px;left:-30px;width:130px;transform:rotate(-45deg);background:#f5a524;color:#1a1200;
font:800 11px/22px system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.18em;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.35);opacity:.92}
@media print{#sk-beta-mark{display:none}}`;
  const mark = document.createElement("div"); mark.id = "sk-beta-mark"; mark.setAttribute("aria-label", "Beta version");
  mark.title = "Beta: pre-release version for testing"; const s = document.createElement("span"); s.textContent = "BETA"; mark.appendChild(s);
  const add = () => { document.head.appendChild(style); document.body.appendChild(mark); };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add, { once: true });
  // keep "BETA · " at the front of the title, whatever the app sets it to
  const fix = () => { if (!document.title.startsWith("BETA · ")) document.title = `BETA · ${document.title}`; };
  fix();
  const t = document.querySelector("title"); if (t) new MutationObserver(fix).observe(t, { childList: true, characterData: true, subtree: true });
}
