import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ base: "./", plugins: [react()], define: { __SK_CHANNEL__: JSON.stringify(process.env.SK_CHANNEL ?? (process.env.CF_PAGES_BRANCH === "beta" ? "beta" : "stable")) } });
