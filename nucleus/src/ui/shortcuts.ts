// Central shortcut registry. Defaults follow familiar EDA conventions (F6/F7/F8 zoom, G grid, M units);
// users can remap any command (stored per machine).
export interface Cmd { id: string; label: string; keys: string; scope: "global" | "schematic" }
export const COMMANDS: Cmd[] = [
  { id: "file.new", label: "New project", keys: "Ctrl+N", scope: "global" }, { id: "file.open", label: "Open project", keys: "Ctrl+O", scope: "global" },
  { id: "file.save", label: "Save", keys: "Ctrl+S", scope: "global" }, { id: "file.saveAs", label: "Save as", keys: "Ctrl+Shift+S", scope: "global" },
  { id: "edit.undo", label: "Undo", keys: "Ctrl+Z", scope: "global" }, { id: "edit.redo", label: "Redo", keys: "Ctrl+Y", scope: "global" },
  { id: "edit.delete", label: "Delete", keys: "Delete", scope: "schematic" }, { id: "edit.duplicate", label: "Duplicate", keys: "Ctrl+D", scope: "schematic" },
  { id: "edit.selectAll", label: "Select all", keys: "Ctrl+A", scope: "schematic" }, { id: "edit.rotate", label: "Rotate anticlockwise", keys: "R", scope: "schematic" },
  { id: "edit.rotateCw", label: "Rotate clockwise", keys: "Shift+R", scope: "schematic" }, { id: "edit.mirror", label: "Mirror", keys: "X", scope: "schematic" },
  { id: "place.component", label: "Pick / place component", keys: "P", scope: "schematic" }, { id: "place.wire", label: "Wire", keys: "W", scope: "schematic" },
  { id: "place.label", label: "Net label", keys: "L", scope: "schematic" }, { id: "place.select", label: "Selection mode", keys: "S", scope: "schematic" },
  { id: "view.grid", label: "Toggle grid", keys: "G", scope: "schematic" }, { id: "view.units", label: "Toggle mm / thou", keys: "M", scope: "global" },
  { id: "design.erc", label: "Electrical rule check", keys: "Ctrl+E", scope: "global" }, { id: "sim.run", label: "Run simulation", keys: "F5", scope: "global" },
  { id: "sim.stop", label: "Stop simulation", keys: "Shift+F5", scope: "global" }, { id: "help.keys", label: "Keyboard shortcuts", keys: "F1", scope: "global" },
];
const KEY = "nucleus-shortcuts-v1";
export function loadKeys(): Record<string, string> { try { return { ...Object.fromEntries(COMMANDS.map((c) => [c.id, c.keys])), ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return Object.fromEntries(COMMANDS.map((c) => [c.id, c.keys])); } }
export function saveKeys(k: Record<string, string>) { try { localStorage.setItem(KEY, JSON.stringify(k)); } catch { /* ignore */ } }
export function keyOf(e: KeyboardEvent): string {
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key === "Del" ? "Delete" : e.key;
  return [e.ctrlKey || e.metaKey ? "Ctrl" : "", e.altKey ? "Alt" : "", e.shiftKey && e.key.length > 1 || (e.shiftKey && /[A-Z]/.test(k)) ? "Shift" : "", k].filter(Boolean).join("+");
}
/** Conflicts are only conflicts within the same scope (or with global). */
export function conflicts(keys: Record<string, string>): string[] {
  const out: string[] = [];
  for (const a of COMMANDS) for (const b of COMMANDS) if (a.id < b.id && keys[a.id] && keys[a.id] === keys[b.id] && (a.scope === b.scope || a.scope === "global" || b.scope === "global")) out.push(`${keys[a.id]}: ${a.label} / ${b.label}`);
  return out;
}
