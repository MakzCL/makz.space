// Writes docs/FILE_FORMAT_SUPPORT_MATRIX.md from the adapter declarations, so the matrix never drifts from the code.
import fs from "node:fs"; import path from "node:path";
import { ADAPTERS, LEVEL_LABEL } from "../src/index.ts";
const rows = ADAPTERS.map((a) => `| ${a.app.toUpperCase()} | ${a.label} | ${a.formats.join(", ")} | ${LEVEL_LABEL[a.read]} | ${LEVEL_LABEL[a.write]} | ${a.versionsVerified.join("; ") || "—"} | ${[...a.limitations, ...(a.unsupported.length && a.unsupported[0] !== "everything" ? ["Not kept: " + a.unsupported.join("; ")] : [])].join(" ") || "—"} | ${a.tests.join("<br>") || "—"} |`);
const md = `# File format support matrix

Generated from \`src/adapters.ts\` by \`node --experimental-strip-types scripts/matrix.ts\`. Do not edit by hand.

Each level is a claim backed by the tests listed in its row. "Unsupported" rows are formats SK Suite **recognises** by content (with their version), so the user gets a precise answer instead of a guess.

| App | Format | Detected as | Read | Write | Versions verified | Limits | Evidence |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
fs.writeFileSync(path.join(import.meta.dirname, "../docs/FILE_FORMAT_SUPPORT_MATRIX.md"), md); console.log(`${ADAPTERS.length} adapters → docs/FILE_FORMAT_SUPPORT_MATRIX.md`);
