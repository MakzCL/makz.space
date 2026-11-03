// Copies local pages (server chooser, screen picker) and icons next to the compiled main process.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
cpSync("static", "dist/static", { recursive: true });
