// Theme names from before the Syndo → SEND rename: read everywhere, and sent in the old form to a backend
// that hasn't been redeployed since.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeThemeId, presetById, toLegacyThemeNames, validateGlobal, validateThemeDoc } from "@send/shared";

test("old preset ids resolve to the SEND presets", () => {
  assert.equal(normalizeThemeId("syndo-glass"), "send-glass");
  assert.equal(normalizeThemeId("preset:42"), "preset:42");
  assert.equal(presetById("syndo-midnight")?.meta.id, "send-midnight");
  assert.equal(validateGlobal({ themeId: "syndo-neon" }).value.themeId, "send-neon");
});

test("old theme files import", () => {
  const r = validateThemeDoc({ schema: "syndo.theme", version: 2, meta: { name: "Old", id: "syndo-frost" } });
  assert.ok(r.doc);
  assert.equal(r.doc!.schema, "send.theme");
  assert.equal(r.doc!.meta.id, "send-frost");
});

test("an old backend gets the old names, and nothing else changes", () => {
  const g = toLegacyThemeNames({ themeId: "send-glass", lightThemeId: "send-paper", followSystem: true });
  assert.deepEqual(g, { themeId: "syndo-glass", lightThemeId: "syndo-paper", followSystem: true });
  const d = toLegacyThemeNames({ schema: "send.theme", meta: { id: "custom", name: "send-glass" } });
  assert.deepEqual(d, { schema: "syndo.theme", meta: { id: "custom", name: "send-glass" } });
  assert.equal(toLegacyThemeNames(null), null);
});
