import { test } from "node:test";
import assert from "node:assert/strict";
const { parseLrc } = await import("../src/music.ts");

// Made-up lines: SEND never stores real lyrics.
test("timed lyrics are read and sorted, lines with two stamps appear twice", () => {
  const lines = parseLrc("[00:05.50] second line\n[00:01.00] first line\n[01:02.3][01:10.25] chorus line\nno stamp here\n[00:20.00]");
  assert.deepEqual(lines, [
    { t: 1000, text: "first line" }, { t: 5500, text: "second line" }, { t: 20000, text: "" },
    { t: 62300, text: "chorus line" }, { t: 70250, text: "chorus line" },
  ]);
});
