import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { BRAND } from "../shared/src/brand.ts";

/** Generates the web manifest and HTML metadata from the central brand config. */
function brand(): Plugin {
  const manifest = {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    start_url: "/channels/@me",
    display: "standalone",
    background_color: BRAND.surfaces.dark.bg0,
    theme_color: BRAND.surfaces.dark.bg1,
    icons: [
      { src: BRAND.assets.appIcon192, sizes: "192x192", type: "image/png" },
      { src: BRAND.assets.appIcon512, sizes: "512x512", type: "image/png" },
      { src: "/brand/send-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return {
    name: "send-brand",
    transformIndexHtml: (html) => html
      .replaceAll("%BRAND_NAME%", BRAND.name)
      .replaceAll("%BRAND_DESCRIPTION%", BRAND.description)
      .replaceAll("%BRAND_BG%", BRAND.surfaces.dark.bg0)
      .replaceAll("%BRAND_THEME%", BRAND.surfaces.dark.bg1),
    configureServer(server) {
      server.middlewares.use("/manifest.webmanifest", (_req, res) => { res.setHeader("content-type", "application/manifest+json"); res.end(JSON.stringify(manifest)); });
    },
    generateBundle() { this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: JSON.stringify(manifest, null, 2) }); },
  };
}

/**
 * Build id = a hash of the built JS/CSS file names (which carry content hashes), so it only changes when the
 * app's code or styles change. It goes into index.html and /version.json; running apps compare the two and
 * offer "update" when a new build is live on Cloudflare.
 */
function buildId(): Plugin {
  const idOf = (bundle: Record<string, unknown>) => {
    const names = Object.keys(bundle).filter((n) => /\.(js|css)$/.test(n)).sort().join("|");
    let h = 0x811c9dc5; for (let i = 0; i < names.length; i++) { h ^= names.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  };
  return {
    name: "send-build-id",
    apply: "build",
    generateBundle(_o, bundle) { this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: idOf(bundle) }) }); },
    transformIndexHtml: { order: "post", handler: (html, ctx) => html.replace("</head>", `<meta name="send-build" content="${ctx.bundle ? idOf(ctx.bundle) : "dev"}"></head>`) },
  };
}

const api = process.env.SEND_API ?? process.env.SYNDO_API ?? "http://localhost:3900";
export default defineConfig({
  plugins: [react(), brand(), buildId()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/gateway": { target: api.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
