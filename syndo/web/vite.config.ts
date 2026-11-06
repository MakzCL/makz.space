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
    name: "syndo-brand",
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

const api = process.env.SYNDO_API ?? "http://localhost:3900";
export default defineConfig({
  plugins: [react(), brand()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: api, changeOrigin: false },
      "/gateway": { target: api.replace(/^http/, "ws"), ws: true },
    },
  },
  build: { target: "es2022", sourcemap: true },
});
