// The open project: design document, undo/redo history, selection and job preparation. Kept above
// the workspaces, so moving between DESIGN, PREPARE and PRODUCE never loses state.
// Saving: autosave to the server 2.5 s after the last change (optimistic version check), a named
// revision on Save (Ctrl+S). A crash-recovery copy is kept in this browser until the server has it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { newDoc, type Doc, type OpType } from "./geom/core";
import type { OpParams, Placement } from "./geom/laser";
import { checkDoc } from "./geom/project";
import { errText, useT, type ProjectRow } from "./data";

export interface Prep {
  jobId: string | null; machineId: string | null; materialId: string | null;
  placements: Placement[]; margin: number; spacing: number; kerf: number; commonLine: boolean;
  ops: Partial<Record<OpType, OpParams>>; copies: number; sheets: number; moJobId: string | null; test: boolean;
}
export const emptyPrep = (): Prep => ({ jobId: null, machineId: null, materialId: null, placements: [], margin: 5, spacing: 2, kerf: 0, commonLine: false, ops: {}, copies: 1, sheets: 1, moJobId: null, test: false });

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
interface Sess {
  project: ProjectRow | null; doc: Doc; version: number; saveState: SaveState; saveError: string | null;
  sel: string[]; setSel: (ids: string[]) => void;
  /** Commit a change (one undo step). */
  change: (fn: (d: Doc) => Doc, label?: string) => void;
  /** Live preview while dragging (no undo step); finish with commitDraft(). */
  draft: Doc | null; setDraft: (d: Doc | null) => void; commitDraft: (label?: string) => void;
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean; lastLabel: string;
  open: (id: string) => Promise<void>; close: () => void;
  save: (note?: string, revision?: boolean) => Promise<number | null>;
  replaceDoc: (d: Doc, label?: string) => void;
  prep: Prep; setPrep: (fn: (p: Prep) => Prep) => void;
  recovery: { doc: Doc; at: string } | null; restoreRecovery: () => void; dropRecovery: () => void;
}
const S = createContext<Sess | null>(null);
export const useSession = () => { const s = useContext(S); if (!s) throw new Error("Session missing"); return s; };
const LKEY = (id: string) => `trotan-recover-${id}`;
const tryStore = (fn: () => void) => { try { fn(); } catch { /* private mode / quota: recovery copy is a convenience only */ } };

export function SessionProvider({ children }: { children: ReactNode }) {
  const T = useT();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [doc, setDoc] = useState<Doc>(newDoc());
  const [version, setVersion] = useState(0);
  const [hist, setHist] = useState<{ past: { d: Doc; l: string }[]; future: { d: Doc; l: string }[] }>({ past: [], future: [] });
  const [sel, setSel] = useState<string[]>([]);
  const [draft, setDraft] = useState<Doc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [prep, setPrepS] = useState<Prep>(emptyPrep());
  const [recovery, setRecovery] = useState<{ doc: Doc; at: string } | null>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const verRef = useRef(version); verRef.current = version;
  const projRef = useRef(project); projRef.current = project;
  const saving = useRef<Promise<number | null> | null>(null);
  const timer = useRef<number | null>(null);

  const save = useCallback(async (note = "", revision = false): Promise<number | null> => {
    const p = projRef.current; if (!p) return null;
    if (saving.current) await saving.current.catch(() => null);
    const d = docRef.current, base = verRef.current;
    setSaveState("saving");
    const run = (async () => {
      try {
        const v = await T.rpc<number>("trotan_save", { p_project: p.id, p_base: base, p_doc: d, p_note: note, p_revision: revision });
        setVersion(v); verRef.current = v;
        setSaveState(docRef.current === d ? "saved" : "dirty"); setSaveError(null);
        if (docRef.current === d) tryStore(() => localStorage.removeItem(LKEY(p.id)));
        T.refresh("projects");
        return v;
      } catch (e) {
        const m = errText(e);
        setSaveState(/Someone else saved/.test(m) ? "conflict" : "error"); setSaveError(m);
        return null;
      } finally { saving.current = null; }
    })();
    saving.current = run;
    return run;
  }, [T]);
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (projRef.current) save(); }, 2500);
  }, [save]);
  const touched = useCallback((d: Doc) => {
    const p = projRef.current; if (!p) return;
    setSaveState((s) => (s === "conflict" ? s : "dirty"));
    tryStore(() => localStorage.setItem(LKEY(p.id), JSON.stringify({ at: new Date().toISOString(), base: verRef.current, doc: d })));
    schedule();
  }, [schedule]);
  const change = useCallback((fn: (d: Doc) => Doc, label = "Edit") => {
    const before = docRef.current, after = fn(before);
    if (after === before) return;
    setDoc(after); docRef.current = after;
    setHist((h) => ({ past: [...h.past.slice(-199), { d: before, l: label }], future: [] }));
    touched(after);
  }, [touched]);
  const replaceDoc = useCallback((d: Doc, label = "Replace") => change(() => d, label), [change]);
  const commitDraft = useCallback((label = "Edit") => {
    setDraft((dr) => { if (dr && dr !== docRef.current) { const before = docRef.current; setDoc(dr); docRef.current = dr; setHist((h) => ({ past: [...h.past.slice(-199), { d: before, l: label }], future: [] })); touched(dr); } return null; });
  }, [touched]);
  const undo = useCallback(() => setHist((h) => {
    const last = h.past[h.past.length - 1]; if (!last) return h;
    const cur = docRef.current; setDoc(last.d); docRef.current = last.d; touched(last.d);
    return { past: h.past.slice(0, -1), future: [{ d: cur, l: last.l }, ...h.future] };
  }), [touched]);
  const redo = useCallback(() => setHist((h) => {
    const nx = h.future[0]; if (!nx) return h;
    const cur = docRef.current; setDoc(nx.d); docRef.current = nx.d; touched(nx.d);
    return { past: [...h.past, { d: cur, l: nx.l }], future: h.future.slice(1) };
  }), [touched]);
  const open = useCallback(async (id: string) => {
    if (projRef.current && saveState !== "saved") await save();
    const { row, doc: d } = await T.loadDoc(id);
    checkDoc(d);
    setProject(row); projRef.current = row; setDoc(d); docRef.current = d; setVersion(row.version); verRef.current = row.version;
    setHist({ past: [], future: [] }); setSel([]); setDraft(null); setSaveState("saved"); setSaveError(null);
    setPrepS({ ...emptyPrep(), moJobId: row.mo_job_id });
    let rec: { doc: Doc; at: string } | null = null;
    try { const raw = localStorage.getItem(LKEY(id)); if (raw) { const j = JSON.parse(raw); if (j?.doc && JSON.stringify(j.doc) !== JSON.stringify(d)) { checkDoc(j.doc); rec = { doc: j.doc, at: j.at }; } } } catch { rec = null; }
    setRecovery(rec);
  }, [T, save, saveState]);
  const close = useCallback(() => { setProject(null); projRef.current = null; setDoc(newDoc()); setHist({ past: [], future: [] }); setSel([]); setPrepS(emptyPrep()); setRecovery(null); }, []);
  // keep unsaved work: save before the tab closes, warn if it cannot
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (projRef.current && saveState !== "saved") { save(); e.preventDefault(); } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, [save, saveState]);
  const v = useMemo<Sess>(() => ({
    project, doc: draft ?? doc, version, saveState, saveError, sel, setSel, change, draft, setDraft, commitDraft, undo, redo,
    canUndo: hist.past.length > 0, canRedo: hist.future.length > 0, lastLabel: hist.past[hist.past.length - 1]?.l ?? "",
    open, close, save, replaceDoc, prep, setPrep: (fn) => setPrepS(fn),
    recovery, restoreRecovery: () => { if (recovery) { replaceDoc(recovery.doc, "Recovered unsaved work"); setRecovery(null); } },
    dropRecovery: () => { if (project) tryStore(() => localStorage.removeItem(LKEY(project.id))); setRecovery(null); },
  }), [project, draft, doc, version, saveState, saveError, sel, change, commitDraft, undo, redo, hist, open, close, save, replaceDoc, prep, recovery]);
  return <S.Provider value={v}>{children}</S.Provider>;
}
