import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Tauri expects a fixed port and no browser auto-open; the same build also
// runs in a plain browser as the demo on quasar.makz.space/demo.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        splash: resolve(__dirname, "splash.html"),
      },
    },
  },
});
