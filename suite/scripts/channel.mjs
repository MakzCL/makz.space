// Release channel for the desktop build: "stable" (SK Suite) or "beta" (SK Suite Beta, the pre-publish suite).
// Beta when SK_CHANNEL=beta, or when Cloudflare Pages builds the git branch "beta" (CF_PAGES_BRANCH).
// A beta build carries channel.json; the app reads it for its name, profile, update feed and app addresses,
// so SK Suite Beta installs and runs side by side with SK Suite and never touches its data or updates.
export const BETA = (process.env.SK_CHANNEL ?? (process.env.CF_PAGES_BRANCH === "beta" ? "beta" : "stable")) === "beta";
const F = "https://beta.skalarki-factory.pages.dev";
export const CHANNEL = BETA
  ? { channel: "beta", name: "SK Suite Beta", slug: "SK-Suite-Beta", pkgName: "sk-suite-beta", updateBase: "https://beta.sk-suite.pages.dev/update/",
      apps: { factory: { url: `${F}/`, hosts: ["beta.skalarki-factory.pages.dev"], path: "/" },
              kortana: { url: `${F}/kimera`, hosts: ["beta.skalarki-factory.pages.dev"], path: "/kimera" },
              trotan: { url: `${F}/trotan`, hosts: ["beta.skalarki-factory.pages.dev"], path: "/trotan" } } }
  : { channel: "stable", name: "SK Suite", slug: "SK-Suite", pkgName: "sk-suite" };
