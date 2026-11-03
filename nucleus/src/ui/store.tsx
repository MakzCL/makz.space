// Application state: the open project, undo/redo history, selection, open documents, simulation results.
// Engineering data lives in the Project; this layer only holds editor state.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Project } from "../core/types";
import { newProject } from "../core/project";
import { connectivity, type Connectivity } from "../connectivity/connectivity";
import { erc, type Finding } from "../erc/erc";
import { openFile, saveFile, FileError } from "../storage/file";
import type { SimResult } from "../simulation/results";

export type DocKind = "schematic" | "pcb" | "graph" | "bom" | "notes";
export interface Doc { id: string; kind: DocKind; title: string }
export interface Store {
  pr: Project; con: Connectivity; findings: Finding[] | null; setFindings: (f: Finding[] | null) => void; runErc: () => Finding[];
  change: (fn: (p: Project) => Project, label: string) => void; preview: Project | null; setPreview: (p: Project | null) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; lastLabel: string;
  sel: Set<string>; setSel: (s: Set<string>) => void; sheet: string; setSheet: (s: string) => void;
  docs: Doc[]; active: string; openDoc: (k: DocKind) => void; closeDoc: (id: string) => void; setActive: (id: string) => void; moveDoc: (id: string, to: number) => void;
  dirty: boolean; fileName: string | null; save: (as?: boolean) => Promise<void>; open: (file?: File) => Promise<void>; newFile: (name: string) => void;
  sim: SimResult | null; setSim: (r: SimResult | null) => void; simStale: boolean;
  focus: { sheet: string; at: [number, number]; id?: string } | null; focusOn: (f: Store["focus"]) => void;
  message: { text: string; tone: "ok" | "error" | "info" } | null; say: (text: string, tone?: "ok" | "error" | "info") => void;
}
const C = createContext<Store | null>(null);
export const useStore = () => { const c = useContext(C); if (!c) throw new Error("Store missing"); return c; };
const RECOVER = "nucleus-recovery-v1";
const DOC_TITLES: Record<DocKind, string> = { schematic: "Schematic", pcb: "PCB Layout", graph: "Analysis", bom: "Bill of Materials", notes: "Project Notes" };
type FSHandle = { createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>; name: string };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [pr, setPr] = useState<Project>(() => {
    try { const r = localStorage.getItem(RECOVER); if (r) { const j = JSON.parse(r); if (j?.project?.format === "nucleus") return j.project as Project; } } catch { /* storage blocked */ }
    return newProject("Untitled");
  });
  const [hist, setHist] = useState<{ past: { p: Project; l: string }[]; future: { p: Project; l: string }[] }>({ past: [], future: [] });
  const [preview, setPreview] = useState<Project | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState("S1");
  const [docs, setDocs] = useState<Doc[]>([{ id: "schematic", kind: "schematic", title: DOC_TITLES.schematic }]);
  const [active, setActive] = useState("schematic");
  const [dirty, setDirty] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const handle = useRef<FSHandle | null>(null);
  const [sim, setSimS] = useState<SimResult | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [focus, focusOn] = useState<Store["focus"]>(null);
  const [message, setMessage] = useState<Store["message"]>(null);
  const prRef = useRef(pr); prRef.current = pr;
  const say = useCallback((text: string, tone: "ok" | "error" | "info" = "info") => { setMessage({ text, tone }); window.setTimeout(() => setMessage((m) => (m?.text === text ? null : m)), tone === "error" ? 7000 : 3500); }, []);
  const change = useCallback((fn: (p: Project) => Project, label: string) => {
    const before = prRef.current; const after = fn(before); if (after === before) return;
    setPr(after); prRef.current = after; setHist((h) => ({ past: [...h.past.slice(-299), { p: before, l: label }], future: [] })); setDirty(true); setPreview(null);
  }, []);
  const undo = useCallback(() => setHist((h) => { const l = h.past[h.past.length - 1]; if (!l) return h; const cur = prRef.current; setPr(l.p); prRef.current = l.p; setDirty(true); return { past: h.past.slice(0, -1), future: [{ p: cur, l: l.l }, ...h.future] }; }), []);
  const redo = useCallback(() => setHist((h) => { const n = h.future[0]; if (!n) return h; const cur = prRef.current; setPr(n.p); prRef.current = n.p; setDirty(true); return { past: [...h.past, { p: cur, l: n.l }], future: h.future.slice(1) }; }), []);
  // recovery copy (convenience only: the saved file is the record)
  useEffect(() => { const t = window.setTimeout(() => { try { localStorage.setItem(RECOVER, JSON.stringify({ at: new Date().toISOString(), project: pr })); } catch { /* quota */ } }, 800); return () => clearTimeout(t); }, [pr]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); }; window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h); }, [dirty]);
  const shown = preview ?? pr;
  const con = useMemo(() => connectivity(shown), [shown]);
  const runErc = useCallback(() => { const f = erc(prRef.current); setFindings(f); return f; }, []);
  const save = useCallback(async (as = false) => {
    const text = await saveFile(prRef.current);
    const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FSHandle> };
    try {
      if (w.showSaveFilePicker && (as || !handle.current)) handle.current = await w.showSaveFilePicker({ suggestedName: `${prRef.current.name}.nucleus`, types: [{ description: "NUCLEUS project", accept: { "application/json": [".nucleus"] } }] });
      if (handle.current) { const s = await handle.current.createWritable(); await s.write(text); await s.close(); setFileName(handle.current.name); }
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = `${prRef.current.name}.nucleus`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); setFileName(a.download); }
      setDirty(false); say(`Saved ${prRef.current.name}`, "ok");
    } catch (e) { if ((e as Error).name !== "AbortError") say(`Not saved: ${(e as Error).message}`, "error"); }
  }, [say]);
  const load = useCallback((p: Project, name: string | null) => { setPr(p); prRef.current = p; setHist({ past: [], future: [] }); setSel(new Set()); setSheet(p.sheets[0].id); setDirty(false); setFileName(name); setSimS(null); setFindings(null); }, []);
  const open = useCallback(async (file?: File) => {
    try {
      let text: string, name: string;
      const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<(FSHandle & { getFile: () => Promise<File> })[]> };
      if (file) { text = await file.text(); name = file.name; handle.current = null; }
      else if (w.showOpenFilePicker) { const [h] = await w.showOpenFilePicker({ types: [{ description: "NUCLEUS project", accept: { "application/json": [".nucleus"] } }] }); const f = await h.getFile(); text = await f.text(); name = f.name; handle.current = h; }
      else { const f = await new Promise<File | null>((res) => { const i = document.createElement("input"); i.type = "file"; i.accept = ".nucleus,application/json"; i.onchange = () => res(i.files?.[0] ?? null); i.click(); }); if (!f) return; text = await f.text(); name = f.name; }
      try { const { project, warnings } = await openFile(text); load(project, name); say(warnings.length ? warnings.join(" ") : `Opened ${name}`, warnings.length ? "info" : "ok"); }
      catch (e) {
        if (e instanceof FileError && e.recoverable && window.confirm(`${e.message}\n\nOpen it anyway? The design may not be what was saved.`)) { const { project, warnings } = await openFile(text, { acceptChecksumMismatch: true }); load(project, name); say(warnings.join(" "), "info"); }
        else throw e;
      }
    } catch (e) { if ((e as Error).name !== "AbortError") say((e as Error).message, "error"); }
  }, [load, say]);
  const newFile = useCallback((name: string) => { load(newProject(name || "Untitled"), null); handle.current = null; setDirty(true); }, [load]);
  const openDoc = useCallback((k: DocKind) => { setDocs((d) => (d.some((x) => x.kind === k) ? d : [...d, { id: k, kind: k, title: DOC_TITLES[k] }])); setActive(k); }, []);
  const closeDoc = useCallback((id: string) => { setDocs((d) => { const n = d.filter((x) => x.id !== id); if (!n.length) return d; if (id === active) setActive(n[n.length - 1].id); return n; }); }, [active]);
  const moveDoc = useCallback((id: string, to: number) => setDocs((d) => { const i = d.findIndex((x) => x.id === id); if (i < 0) return d; const n = [...d]; const [x] = n.splice(i, 1); n.splice(Math.max(0, Math.min(n.length, to)), 0, x); return n; }), []);
  const setSim = useCallback((r: SimResult | null) => setSimS(r), []);
  const v: Store = {
    pr: shown, con, findings, setFindings, runErc, change, preview, setPreview, undo, redo, canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, lastLabel: hist.past[hist.past.length - 1]?.l ?? "",
    sel, setSel, sheet, setSheet, docs, active, openDoc, closeDoc, setActive, moveDoc, dirty, fileName, save, open, newFile,
    sim, setSim, simStale: !!sim && sim.revision !== -1 && sim.at < pr.modified, focus, focusOn, message, say,
  };
  return <C.Provider value={v}>{children}</C.Provider>;
}
