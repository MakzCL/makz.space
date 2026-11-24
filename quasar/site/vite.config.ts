import { defineConfig } from "vite";

// The marketing site for quasar.makz.space. `npm run build:site` builds the
// app demo into site/public/demo first, so it ships at /demo/.
export default defineConfig({
  root: __dirname,
  base: "/",
  css: { postcss: {} },
  build: { outDir: "dist", emptyOutDir: true, target: "es2022" },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.1.0"),
  },
});
