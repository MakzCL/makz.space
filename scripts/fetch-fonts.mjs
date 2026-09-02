#!/usr/bin/env node
/**
 * Downloads the Cabinet Grotesk variable font (free from Fontshare, by
 * Indian Type Foundry) into /public/fonts so it can be self-hosted.
 *
 *   npm run fetch:fonts
 *
 * Commit the resulting .woff2 — the site then ships zero third-party font
 * requests. If your network blocks Fontshare, download Cabinet Grotesk from
 * https://www.fontshare.com/fonts/cabinet-grotesk and save the variable
 * woff2 as public/fonts/CabinetGrotesk-Variable.woff2 by hand.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "public/fonts/CabinetGrotesk-Variable.woff2");
const cssUrl =
  "https://api.fontshare.com/v2/css?f%5B%5D=cabinet-grotesk@100,200,300,400,500,700,800,900,1&display=swap";

async function main() {
  process.stdout.write("Resolving Cabinet Grotesk from Fontshare… ");
  const cssRes = await fetch(cssUrl, {
    headers: {
      // Fontshare serves variable woff2 only to browsers that advertise support.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    },
  });
  if (!cssRes.ok) throw new Error(`Fontshare responded ${cssRes.status}`);
  const css = await cssRes.text();

  const urls = [...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]);
  const variable = urls.find((u) => /variable/i.test(u)) ?? urls[0];
  if (!variable) throw new Error("No woff2 found in the Fontshare stylesheet.");
  process.stdout.write("ok\n");

  process.stdout.write(`Downloading ${variable}\n`);
  const fontRes = await fetch(variable);
  if (!fontRes.ok) throw new Error(`Font download failed ${fontRes.status}`);
  const buf = Buffer.from(await fontRes.arrayBuffer());

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  process.stdout.write(
    `Wrote ${target} (${(buf.length / 1024).toFixed(1)} kB)\nCommit it and the typeface is live.\n`,
  );
}

main().catch((error) => {
  console.error(`\nCould not fetch the typeface: ${error.message}`);
  console.error(
    "Download it manually from https://www.fontshare.com/fonts/cabinet-grotesk\n" +
      "and save the variable woff2 to public/fonts/CabinetGrotesk-Variable.woff2",
  );
  process.exitCode = 1;
});
