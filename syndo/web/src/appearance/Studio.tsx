import { ScrollArea } from "../components/ScrollArea.tsx";
import { Range } from "../components/Range.tsx";
import { Copy, Download, Heart, ImagePlus, Redo2, RefreshCcw, Trash2, Undo2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_A11Y, FONTS, PRESETS, REGIONS, CSS_CLASSES, mergeDeep, readabilityIssues, resolveAppearance, validateCustomCss, validateThemeDoc,
  validateThemePartial, type A11yPrefs, type Background, type Issue, type RegionId, type ThemeDoc,
} from "@syndo/shared";
import { api, errMsg, upload } from "../api.ts";
import { displayName, dmTitle, toast, useStore } from "../store.ts";
import { Backdrop } from "./Backdrop.tsx";
import { BoolField, ColorField, RangeField, SelectField, TargetCtx, ctxOf, resetSection, useField, useTarget, type Target } from "./controls.tsx";
import { assetUrl, themeCss } from "./engine.ts";
import { ProfileEditor } from "./ProfileEditor.tsx";
import { Wordmark } from "../components/ui.tsx";
import {
  applyDraft, beginDraft, cancelDraft, editDraft, effective, isDirty, loadAssets, redo, resetAppearance, resolveFor, scopeKey, setDevice, themeFor, undo,
  useAppearance, type Asset,
} from "./store.ts";

const SECTIONS = [
  ["gallery", "Theme gallery"], ["colors", "Colours & type"], ["panels", "Panels & transparency"], ["backgrounds", "Backgrounds"], ["layout", "Layout"],
  ["profile", "Profile & effects"], ["servers", "Per-server"], ["conversations", "Per-conversation"], ["presets", "Presets & import/export"],
  ["access", "Accessibility & performance"], ["advanced", "Advanced"],
] as const;
type Section = (typeof SECTIONS)[number][0];
const SECTION_KEYS: Partial<Record<Section, string[]>> = { colors: ["colors", "typography"], panels: ["panels"], backgrounds: ["background", "effects"], layout: ["layout"], advanced: ["customCss"] };

export function openStudio(section?: Section, target?: Target) { window.dispatchEvent(new CustomEvent("syndo:studio", { detail: { section, target } })); }

export function Studio({ initial, initialTarget, onClose }: { initial?: Section; initialTarget?: Target; onClose: () => void }) {
  const [section, setSection] = useState<Section>(initial ?? "gallery");
  const [target, setTarget] = useState<Target>(initialTarget ?? { kind: "global" });
  const [region, setRegion] = useState<RegionId>("chat");
  const [showPreview, setShowPreview] = useState(false);
  const draft = useAppearance((s) => s.draft);
  const past = useAppearance((s) => s.past.length), future = useAppearance((s) => s.future.length);
  const saveState = useAppearance((s) => s.saveState);
  useEffect(() => { beginDraft(); return () => { if (useAppearance.getState().draft) cancelDraft(); }; }, []);
  // Preview the scope being edited in the live app too (reverts on Cancel).
  useEffect(() => { useAppearance.setState({ previewCtx: target.kind === "global" ? null : ctxOf(target) }); }, [target]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !(e.target as HTMLElement).matches("input,textarea")) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if (e.key === "Escape") { e.stopPropagation(); close(); }
    };
    window.addEventListener("keydown", k, true); return () => window.removeEventListener("keydown", k, true);
  }); // eslint-disable-line
  const close = () => { if (isDirty() && !confirm("Discard your unsaved appearance changes?")) return; cancelDraft(); onClose(); };
  const apply = async () => { if (await applyDraft()) onClose(); };
  void draft;
  const sectionKeys = SECTION_KEYS[section];

  return (
    <TargetCtx.Provider value={target}>
      <div className="studio-back" data-region="settings" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
        <div className={`studio ${showPreview ? "" : "studio-without-preview"}`} role="dialog" aria-modal="true" aria-label="SEND Studio">
          <header className="studio-h">
            <h2 className="studio-brand" aria-label="SEND Studio"><Wordmark /><span>Studio</span></h2>
            <TargetPicker target={target} onChange={setTarget} />
            <div className="row studio-actions">
              <button className="btn sm studio-preview-toggle" aria-expanded={showPreview} aria-controls="studio-live-preview" onClick={() => setShowPreview((v) => !v)}>Preview</button>
              <button className="icon-btn" onClick={undo} disabled={!past} aria-label="Undo" title="Undo (Ctrl+Z)"><Undo2 size={18} /></button>
              <button className="icon-btn" onClick={redo} disabled={!future} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Redo2 size={18} /></button>
              <span className={`save-state ss-${saveState}`} role="status">{isDirty() ? "Unsaved changes" : saveState === "error" ? "Save failed" : "Saved"}</span>
              <button className="btn" onClick={close}>Cancel</button>
              <button className="btn primary" onClick={apply} disabled={!isDirty()}>Apply</button>
            </div>
          </header>
          <div className="studio-body">
            <ScrollArea className="studio-nav-area" viewportClassName="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Studio sections">
              {SECTIONS.map(([id, label]) => <button key={id} role="tab" aria-selected={section === id} className={section === id ? "active" : ""} onClick={() => setSection(id)}>{label}</button>)}
            </ScrollArea>
            <ScrollArea className="studio-editor-area" viewportClassName="studio-editor" role="tabpanel">
              {section === "gallery" && <Gallery />}
              {section === "colors" && <ColorsSection />}
              {section === "panels" && <PanelsSection region={region} setRegion={setRegion} />}
              {section === "backgrounds" && <BackgroundsSection />}
              {section === "layout" && <LayoutSection />}
              {section === "profile" && <ProfileEditor embedded />}
              {section === "servers" && <ScopeList kind="guild" onPick={(t) => { setTarget(t); setSection("colors"); }} />}
              {section === "conversations" && <ScopeList kind="channel" onPick={(t) => { setTarget(t); setSection("backgrounds"); }} />}
              {section === "presets" && <PresetsSection />}
              {section === "access" && <AccessSection />}
              {section === "advanced" && <AdvancedSection />}
              <footer className="studio-f">
                {sectionKeys && <button className="btn sm" onClick={() => resetSection(target, sectionKeys)}><RefreshCcw size={14} /> Reset this section{target.kind !== "global" ? " for this scope" : ""}</button>}
                <button className="btn sm danger" onClick={() => { if (confirm(target.kind === "global" ? "Reset your whole global look to the SEND default? (Accessibility settings are kept.)" : `Remove all overrides for ${target.label}?`)) editDraft((d) => target.kind === "global" ? { ...d, global: { ...d.global, themeId: "syndo-glass", overrides: {}, customCssEnabled: false } } : { ...d, scopes: { ...d.scopes, [scopeKey(target.kind, target.id)]: null } }); }}>Reset all{target.kind !== "global" ? " for this scope" : ""}</button>
              </footer>
            </ScrollArea>
            {showPreview && <ScrollArea id="studio-live-preview" className="studio-preview-area" viewportClassName="studio-preview-wrap" role="complementary" aria-label="Live preview">
              <Preview onRegion={(r) => { setRegion(r); setSection("panels"); }} selected={section === "panels" ? region : null} />
            </ScrollArea>}
          </div>
        </div>
      </div>
    </TargetCtx.Provider>
  );
}

function TargetPicker({ target, onChange }: { target: Target; onChange: (t: Target) => void }) {
  const guilds = useStore((s) => s.guilds);
  const dms = useStore((s) => s.dms);
  const val = target.kind === "global" ? "global" : `${target.kind}:${target.id}`;
  return (
    <label className="target-pick">
      <span className="sr-only">Editing</span>
      <select value={val} onChange={(e) => {
        const v = e.target.value;
        if (v === "global") return onChange({ kind: "global" });
        const [k, id] = v.split(":") as ["guild" | "channel", string];
        if (k === "guild") onChange({ kind: "guild", id, label: guilds[id]?.name ?? "Server" });
        else { const c = dms[id] ?? Object.values(guilds).flatMap((g) => g.channels).find((c) => c.id === id); onChange({ kind: "channel", id, guildId: c?.guild_id ?? null, label: c ? (c.guild_id ? `#${c.name}` : dmTitle(c)) : "Conversation" }); }
      }} aria-label="Which appearance you're editing">
        <option value="global">Editing: my global look</option>
        <optgroup label="A server (personal override)">{Object.values(guilds).map((g) => <option key={g.id} value={`guild:${g.id}`}>{g.name}</option>)}</optgroup>
        <optgroup label="A conversation (personal override)">{Object.values(dms).map((c) => <option key={c.id} value={`channel:${c.id}`}>{dmTitle(c)}</option>)}</optgroup>
        <optgroup label="A channel (personal override)">{Object.values(guilds).flatMap((g) => g.channels.filter((c) => c.type === 0).map((c) => <option key={c.id} value={`channel:${c.id}`}>{g.name} / #{c.name}</option>))}</optgroup>
      </select>
    </label>
  );
}

/* -------------------------------------------------------------- gallery -- */
const thumbResolved = (t: ThemeDoc) => resolveAppearance({ theme: t, global: {}, a11y: { ...DEFAULT_A11Y, minContrast: false } });

function Gallery() {
  const presets = useAppearance((s) => s.presets);
  const themeId = useAppearance((s) => (s.draft ?? { global: s.global.data }).global.themeId);
  const [filter, setFilter] = useState("all");
  const all = [...PRESETS.map((p) => ({ key: p.meta.id, doc: p, mine: false })), ...presets.map((p) => ({ key: `preset:${p.id}`, doc: p.data, mine: true }))];
  const tags = ["all", "dark", "light", "glass", "wallpaper", "layout", "mine"];
  const shown = all.filter((x) => filter === "all" || (filter === "mine" ? x.mine : filter === "light" || filter === "dark" ? x.doc.meta.scheme === filter : x.doc.meta.tags.some((t) => t.includes(filter)) || (filter === "layout" && x.doc.layout.nav === "horizontal")));
  const css = useMemo(() => all.map((x) => themeCss(`.thumb-${CSS.escape(x.key)}`, thumbResolved(x.doc))).join("\n"), [presets]); // eslint-disable-line
  return (
    <div className="stack">
      <h3>Theme gallery</h3>
      <p className="muted small">Every theme is free and fully editable. Applying a theme keeps your own overrides on top; use “Reset all” to start clean.</p>
      <div className="chips" role="radiogroup" aria-label="Filter themes">{tags.map((t) => <button key={t} role="radio" aria-checked={filter === t} className={`chip ${filter === t ? "on" : ""}`} onClick={() => setFilter(t)}>{t}</button>)}</div>
      <style>{css}</style>
      <div className="gallery">
        {shown.map(({ key, doc, mine }) => (
          <article key={key} className={`theme-card ${themeId === key ? "current" : ""}`}>
            <ThemeThumb id={key} doc={doc} />
            <div className="tc-body">
              <strong>{doc.meta.name}</strong> <span className={`tag ${doc.meta.scheme}`}>{doc.meta.scheme}</span>
              <p className="muted small">{doc.meta.description}</p>
              <div className="chips">{doc.meta.tags.slice(0, 4).map((t) => <span key={t} className="chip sm">{t}</span>)}</div>
              <div className="row wrap">
                <button className="btn primary sm" onClick={() => editDraft((d) => ({ ...d, global: { ...d.global, themeId: key, ...(doc.meta.scheme === "light" ? {} : {}) } }))} aria-pressed={themeId === key}>{themeId === key ? "Applied (preview)" : "Use"}</button>
                <button className="btn sm" onClick={async () => { try { await api.post("/api/appearance/presets", { name: `${doc.meta.name} copy`, data: { ...doc, meta: { ...doc.meta, id: "custom" } } }); toast("Duplicated into your presets.", "success"); } catch (e) { toast(errMsg(e), "error"); } }}><Copy size={14} /> Duplicate</button>
                {mine && <button className="btn sm danger" onClick={() => confirm(`Delete preset ${doc.meta.name}?`) && api.del(`/api/appearance/presets/${key.slice(7)}`).catch((e) => toast(errMsg(e), "error"))}><Trash2 size={14} /></button>}
              </div>
            </div>
          </article>
        ))}
      </div>
      <FollowSystem />
    </div>
  );
}

function FollowSystem() {
  const g = useAppearance((s) => (s.draft ?? { global: s.global.data }).global);
  return (
    <div className="card stack">
      <label className="toggle-row"><span><span className="toggle-l">Follow system light/dark</span><span className="field-h">Switch between two themes automatically.</span></span>
        <input type="checkbox" role="switch" className="toggle" checked={g.followSystem} onChange={(e) => editDraft((d) => ({ ...d, global: { ...d.global, followSystem: e.target.checked } }))} /></label>
      {g.followSystem && <label className="field"><span className="field-l">Light theme</span>
        <select value={g.lightThemeId ?? "syndo-paper"} onChange={(e) => editDraft((d) => ({ ...d, global: { ...d.global, lightThemeId: e.target.value } }))}>{PRESETS.map((p) => <option key={p.meta.id} value={p.meta.id}>{p.meta.name}</option>)}</select></label>}
    </div>
  );
}

/** A miniature app rendered with the theme's real tokens. */
function ThemeThumb({ id, doc }: { id: string; doc: ThemeDoc }) {
  const bg = doc.background?.dark ?? doc.background?.light;
  const horiz = doc.layout.nav === "horizontal";
  return (
    <div className={`thumb thumb-${id} ${horiz ? "h" : ""}`} aria-hidden>
      {bg && bg.kind !== "none" && <Backdrop bg={bg} />}
      <div className="t-rail" /><div className="t-side"><i /><i /><i className="on" /><i /></div>
      <div className="t-chat"><div className="t-head" /><p className="t-msg"><b /><span /></p><p className="t-msg me"><b /><span /></p><p className="t-msg"><b /><span className="short" /></p><div className="t-comp" /></div>
    </div>
  );
}

/* -------------------------------------------------------------- colours -- */
function ColorsSection() {
  const target = useTarget();
  const r = resolveFor(ctxOf(target), effective()).resolved;
  const warn = readabilityIssues(r.theme);
  return (
    <div className="stack">
      <h3>Colours</h3>
      {warn.length > 0 && <div className="warn-box" role="alert"><strong>Readability</strong><ul>{warn.map((w) => <li key={w.path}>{w.path}: {w.message}</li>)}</ul><small>“Keep text readable” in Accessibility automatically adjusts body text.</small></div>}
      <div className="grid2">
        <ColorField path="colors.accent" label="Accent" /><ColorField path="colors.accent2" label="Second accent" />
        <ColorField path="colors.bg0" label="Deepest surface" /><ColorField path="colors.bg1" label="Sidebars" />
        <ColorField path="colors.bg2" label="Messages" /><ColorField path="colors.bg3" label="Inputs & cards" />
        <ColorField path="colors.line" label="Lines & borders" /><ColorField path="colors.text" label="Text" />
        <ColorField path="colors.textMuted" label="Secondary text" /><ColorField path="colors.textFaint" label="Faint text" />
        <ColorField path="colors.mention" label="Mention highlight" /><ColorField path="colors.link" label="Links" />
        <ColorField path="colors.danger" label="Danger" /><ColorField path="colors.success" label="Success / online" />
      </div>
      {target.kind === "global" && (<>
        <h3>Typography</h3>
        <SelectField path="typography.font" label="Font" options={Object.entries(FONTS).map(([k, f]) => [k, f.label] as const)} hint="Fonts come from your device; nothing is downloaded from third parties." />
        <RangeField path="typography.size" label="Font size" min={12} max={22} unit="px" />
        <RangeField path="typography.lineHeight" label="Line height" min={1.1} max={2} step={0.05} />
        <RangeField path="typography.letterSpacing" label="Letter spacing" min={-1} max={2} step={0.1} unit="px" />
      </>)}
      {target.kind !== "global" && <p className="muted small">Fonts and layout are global settings; per-server and per-conversation looks change colours, panels, backgrounds and message style.</p>}
    </div>
  );
}

/* --------------------------------------------------------------- panels -- */
function PanelsSection({ region, setRegion }: { region: RegionId; setRegion: (r: RegionId) => void }) {
  const info = REGIONS.find((r) => r.id === region)!;
  const base = `panels.${region}`;
  const grad = useField<{ to: string; angle: number } | null>(`${base}.gradient`);
  const img = useField<string | null>(`${base}.image`);
  const [pick, setPick] = useState(false);
  return (
    <div className="stack">
      <h3>Panels & transparency</h3>
      <p className="muted small">Pick a region in the live preview (it doubles as an interface map) or from this list. Opacity only affects a panel's <em>background layer</em> — text, icons and controls stay fully opaque. Lower opacity reveals what's underneath inside {""}SEND (the wallpaper and lower panels). Seeing through to your desktop is a separate native option, available only in the Windows desktop app.</p>
      <div className="region-list" role="listbox" aria-label="Interface regions">
        {REGIONS.map((r) => <button key={r.id} role="option" aria-selected={r.id === region} className={r.id === region ? "active" : ""} onClick={() => setRegion(r.id)}>{r.label}<small className="muted block">{r.hint}</small></button>)}
      </div>
      <h4>{info.label}</h4>
      <ColorField path={`${base}.bg`} label="Background colour" />
      <RangeField path={`${base}.opacity`} label="Background opacity" min={0} max={100} unit="%" />
      <div className="sf-row">
        <div className="sf-label"><span>Gradient</span><small className="sf-src">{grad.overridden ? "Overridden here" : "Inherited"}</small></div>
        <div className="sf-input">
          <input type="checkbox" checked={!!grad.value} onChange={(e) => grad.set(e.target.checked ? { to: "#3D6BFF", angle: 135 } : null)} aria-label="Use a gradient" />
          {grad.value && <><input type="color" value={grad.value.to.slice(0, 7)} onChange={(e) => grad.set({ ...grad.value!, to: e.target.value.toUpperCase() })} aria-label="Gradient end colour" />
            <Range min={0} max={360} value={grad.value.angle} onChange={(e) => grad.set({ ...grad.value!, angle: +e.target.value })} aria-label="Gradient angle" /></>}
        </div>
        <button className="icon-btn sm" onClick={grad.reset} disabled={!grad.overridden} aria-label="Reset gradient"><RefreshCcw size={14} /></button>
      </div>
      <RangeField path={`${base}.blur`} label="Backdrop blur" min={0} max={40} unit="px" hint="Blurs what's behind a translucent panel. Turned down by “Reduce blur” and low-power mode." />
      <ColorField path={`${base}.border`} label="Border colour" />
      <RangeField path={`${base}.borderOpacity`} label="Border opacity" min={0} max={100} unit="%" />
      <RangeField path={`${base}.borderWidth`} label="Border thickness" min={0} max={6} unit="px" />
      <RangeField path={`${base}.radius`} label="Corner radius" min={0} max={40} unit="px" />
      <RangeField path={`${base}.shadow`} label="Shadow strength" min={0} max={100} />
      <div className="sf-row">
        <div className="sf-label"><span>Background image</span><small className="sf-src">{img.overridden ? "Overridden here" : "Inherited"}</small></div>
        <div className="sf-input">{img.value ? <img className="mini-asset" src={assetUrl(img.value) ?? ""} alt="" /> : <span className="muted small">None</span>}<button className="btn sm" onClick={() => setPick(true)}>Choose…</button>{img.value && <button className="btn sm" onClick={() => img.set(null)}>Remove</button>}</div>
        <button className="icon-btn sm" onClick={img.reset} disabled={!img.overridden} aria-label="Reset image"><RefreshCcw size={14} /></button>
      </div>
      {pick && <AssetPicker onPick={(ref) => { img.set(ref); setPick(false); }} onClose={() => setPick(false)} />}
      <h4>Text & icons (optional)</h4>
      <ColorField path={`${base}.text`} label="Text colour override" />
      <ColorField path={`${base}.icon`} label="Icon colour override" />
    </div>
  );
}

/* ---------------------------------------------------------- backgrounds -- */
const BUILTIN_WALLPAPERS = [["builtin:dunes", "Dunes"], ["builtin:frost", "Frost"], ["builtin:grid", "Neon grid"], ["builtin:canvas", "Canvas"], ["builtin:hexfield", "Hex field"], ["builtin:waves", "Waves"]] as const;

function BackgroundsSection() {
  const target = useTarget();
  const [variant, setVariant] = useState<"dark" | "light">("dark");
  return (
    <div className="stack">
      <h3>Background {target.kind !== "global" && <small className="muted">for {target.label} — only you see this</small>}</h3>
      <SelectField path="background.target" label="Wallpaper sits behind" options={[["app", "The whole app (panels reveal it)"], ["chat", "Only the message area"]]} />
      <div className="tabs" role="tablist">{(["dark", "light"] as const).map((v) => <button key={v} role="tab" aria-selected={variant === v} className={variant === v ? "active" : ""} onClick={() => setVariant(v)}>{v === "dark" ? "For dark themes" : "For light themes"}</button>)}</div>
      <BackgroundEditor path={`background.${variant}`} />
      <BoolField path="effects.animatedBackground" label="Animate gradient backgrounds" hint="Slow drift. Always still with reduced motion or low power." />
      <Library />
    </div>
  );
}

function BackgroundEditor({ path }: { path: string }) {
  const f = useField<Background | null>(path);
  const bg: Background = f.value ?? { kind: "none" };
  const set = (patch: Partial<Background>) => f.set({ fit: "cover", x: 50, y: 50, zoom: 1, brightness: 100, saturation: 100, blur: 0, tint: "#000000", overlay: 0, vignette: 0, ...bg, ...patch } as Background);
  const [pick, setPick] = useState<null | "asset" | "poster">(null);
  const focal = useRef<HTMLDivElement>(null);
  return (
    <div className="card stack">
      <div className="row wrap">
        {(["none", "color", "gradient", "image", "video"] as const).map((k) => <label key={k} className={`chip ${bg.kind === k ? "on" : ""}`}><input type="radio" name={`kind-${path}`} checked={bg.kind === k} onChange={() => set({ kind: k, color: bg.color ?? "#1A2136", gradient: bg.gradient ?? { from: "#3D6BFF", via: null, to: "#FF8A6B", angle: 135, type: "linear" } })} className="sr-only" />{k}</label>)}
        <button className="btn sm" onClick={f.reset} disabled={!f.overridden}>Reset to inherited</button>
      </div>
      {bg.kind === "color" && <label className="row">Colour <input type="color" value={(bg.color ?? "#1A2136").slice(0, 7)} onChange={(e) => set({ color: e.target.value.toUpperCase() })} /></label>}
      {bg.kind === "gradient" && bg.gradient && (
        <div className="row wrap">
          <label>From <input type="color" value={bg.gradient.from.slice(0, 7)} onChange={(e) => set({ gradient: { ...bg.gradient!, from: e.target.value.toUpperCase() } })} /></label>
          <label>Via <input type="color" value={(bg.gradient.via ?? bg.gradient.from).slice(0, 7)} onChange={(e) => set({ gradient: { ...bg.gradient!, via: e.target.value.toUpperCase() } })} /></label>
          <label>To <input type="color" value={bg.gradient.to.slice(0, 7)} onChange={(e) => set({ gradient: { ...bg.gradient!, to: e.target.value.toUpperCase() } })} /></label>
          <label>Angle <Range min={0} max={360} value={bg.gradient.angle} onChange={(e) => set({ gradient: { ...bg.gradient!, angle: +e.target.value } })} /></label>
          <select value={bg.gradient.type} onChange={(e) => set({ gradient: { ...bg.gradient!, type: e.target.value as "linear" | "radial" } })} aria-label="Gradient type"><option value="linear">Linear</option><option value="radial">Radial</option></select>
        </div>
      )}
      {(bg.kind === "image" || bg.kind === "video") && (<>
        <div className="row wrap">
          <button className="btn sm" onClick={() => setPick("asset")}><ImagePlus size={14} /> {bg.asset ? "Change" : "Choose"} {bg.kind}</button>
          {BUILTIN_WALLPAPERS.map(([ref, name]) => bg.kind === "image" && <button key={ref} className={`wp-chip ${bg.asset === ref ? "on" : ""}`} style={{ backgroundImage: `url(${assetUrl(ref)})` }} onClick={() => set({ asset: ref })} aria-label={`Built-in wallpaper ${name}`} title={name} />)}
          <button className="btn sm" onClick={() => setPick("poster")}>Still fallback…</button>
        </div>
        <p className="muted small">Fit, focal point and zoom. Click or drag in the box to set the focal point.</p>
        <div className="row wrap">
          <select value={bg.fit ?? "cover"} onChange={(e) => set({ fit: e.target.value as Background["fit"] })} aria-label="Fit"><option value="cover">Cover</option><option value="contain">Contain</option><option value="tile">Tile</option><option value="stretch">Stretch</option></select>
          <div ref={focal} className="focal" role="slider" tabIndex={0} aria-label="Focal point" aria-valuetext={`${bg.x ?? 50}% across, ${bg.y ?? 50}% down`}
            onPointerDown={(e) => { const r = focal.current!.getBoundingClientRect(); const fn = (ev: PointerEvent | React.PointerEvent) => set({ x: Math.round(Math.min(100, Math.max(0, ((ev.clientX - r.left) / r.width) * 100))), y: Math.round(Math.min(100, Math.max(0, ((ev.clientY - r.top) / r.height) * 100))) }); fn(e); const mv = (ev: PointerEvent) => fn(ev); window.addEventListener("pointermove", mv); window.addEventListener("pointerup", () => window.removeEventListener("pointermove", mv), { once: true }); }}
            onKeyDown={(e) => { const d = e.shiftKey ? 10 : 2; if (e.key === "ArrowLeft") set({ x: Math.max(0, (bg.x ?? 50) - d) }); if (e.key === "ArrowRight") set({ x: Math.min(100, (bg.x ?? 50) + d) }); if (e.key === "ArrowUp") set({ y: Math.max(0, (bg.y ?? 50) - d) }); if (e.key === "ArrowDown") set({ y: Math.min(100, (bg.y ?? 50) + d) }); }}
            style={{ backgroundImage: bg.asset ? `url(${assetUrl(bg.asset)})` : undefined }}>
            <i style={{ left: `${bg.x ?? 50}%`, top: `${bg.y ?? 50}%` }} />
          </div>
        </div>
        <Slide label="Zoom" v={bg.zoom ?? 1} min={0.5} max={4} step={0.05} on={(v) => set({ zoom: v })} unit="×" />
      </>)}
      {bg.kind !== "none" && (<>
        <Slide label="Brightness" v={bg.brightness ?? 100} min={0} max={200} on={(v) => set({ brightness: v })} unit="%" />
        <Slide label="Saturation" v={bg.saturation ?? 100} min={0} max={200} on={(v) => set({ saturation: v })} unit="%" />
        <Slide label="Blur" v={bg.blur ?? 0} min={0} max={40} on={(v) => set({ blur: v })} unit="px" />
        <div className="row"><label>Overlay tint <input type="color" value={(bg.tint ?? "#000000").slice(0, 7)} onChange={(e) => set({ tint: e.target.value.toUpperCase() })} /></label></div>
        <Slide label="Overlay opacity" v={bg.overlay ?? 0} min={0} max={100} on={(v) => set({ overlay: v })} unit="%" />
        <Slide label="Vignette" v={bg.vignette ?? 0} min={0} max={100} on={(v) => set({ vignette: v })} unit="%" />
      </>)}
      {pick && <AssetPicker video={bg.kind === "video" && pick === "asset"} onPick={(ref) => { set(pick === "asset" ? { asset: ref } : { poster: ref }); setPick(null); }} onClose={() => setPick(null)} />}
    </div>
  );
}

function Slide({ label, v, min, max, step = 1, on, unit = "" }: { label: string; v: number; min: number; max: number; step?: number; on: (v: number) => void; unit?: string }) {
  return <label className="slide"><span>{label}</span><Range min={min} max={max} step={step} value={v} onChange={(e) => on(+e.target.value)} aria-valuetext={`${v}${unit}`} /><output>{step < 1 ? v.toFixed(2) : v}{unit}</output></label>;
}

/* -------------------------------------------------------------- library -- */
function Library({ onPick, video }: { onPick?: (ref: string) => void; video?: boolean }) {
  const assets = useAppearance((s) => s.assets);
  const storage = useAppearance((s) => s.storage);
  const [pct, setPct] = useState<number | null>(null);
  const [cur, setCur] = useState<{ cancel: () => void } | null>(null);
  useEffect(() => { if (!assets) loadAssets(); }, [assets]);
  const refresh = () => { loadAssets(); api.get<any>("/api/appearance").then((r) => useAppearance.setState({ storage: r.storage })).catch(() => {}); };
  const send = (file: File, replace?: Asset) => {
    if (storage && file.size > storage.max_file) { toast(`That file is larger than ${Math.round(storage.max_file / 1048576)} MB.`, "error"); return; }
    const fd = new FormData(); fd.append("file", file);
    const u = upload<Asset>(replace ? `/api/appearance/assets/${replace.id.slice(1)}` : "/api/appearance/assets", fd, setPct);
    if (replace) { /* PUT via XHR isn't supported by upload(); use fetch */ }
    setCur(u);
    u.promise.then(() => { toast(replace ? "Replaced." : "Added to your library.", "success"); refresh(); }).catch((e) => toast(errMsg(e), "error")).finally(() => { setPct(null); setCur(null); });
  };
  const replace = async (a: Asset, file: File) => {
    const fd = new FormData(); fd.append("file", file);
    try { const r = await fetch(`/api/appearance/assets/${a.id.slice(1)}`, { method: "PUT", body: fd, headers: { "x-syndo-client": "1" } }); if (!r.ok) throw new Error((await r.json()).message); toast("Replaced everywhere it's used.", "success"); refresh(); } catch (e) { toast(errMsg(e), "error"); }
  };
  const del = async (a: Asset) => {
    try { await api.del(`/api/appearance/assets/${a.id.slice(1)}`); refresh(); }
    catch (e: any) { if (e?.status === 409 && confirm(e.message)) { await api.del(`/api/appearance/assets/${a.id.slice(1)}?force=1`).catch((x) => toast(errMsg(x), "error")); refresh(); } else if (e?.status !== 409) toast(errMsg(e), "error"); }
  };
  const list = (assets ?? []).filter((a) => (video === undefined ? true : video ? a.kind === "video" : a.kind === "image"));
  return (
    <div className="stack">
      <h4>Your background library <small className="muted">private — only you can load these</small></h4>
      {storage && <div className="usage"><progress max={storage.quota} value={storage.used} aria-label="Storage used" /><small className="muted">{(storage.used / 1048576).toFixed(1)} MB of {Math.round(storage.quota / 1048576)} MB · {storage.count} items</small></div>}
      <div className="row wrap">
        <label className="btn sm"><Upload size={14} /> Upload image, GIF or video<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif,video/mp4,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ""; }} /></label>
        {pct !== null && <><progress max={1} value={pct} /><button className="btn sm" onClick={() => cur?.cancel()}>Cancel</button></>}
        <button className="btn sm" onClick={async () => { const r = await api.post<{ removed: number; freed: number }>("/api/appearance/assets/cleanup").catch((e) => { toast(errMsg(e), "error"); return null; }); if (r) { toast(`Removed ${r.removed} unused item(s), freed ${(r.freed / 1048576).toFixed(1)} MB. Favourites and anything in use are kept.`, "success"); refresh(); } }}>Clean up unused</button>
      </div>
      <div className="lib-grid">
        {list.map((a) => (
          <figure key={a.id} className="lib-item">
            {a.kind === "video" ? <video src={a.url} muted preload="metadata" /> : <img src={a.url} alt={a.name || "Background"} loading="lazy" decoding="async" />}
            <figcaption>
              <span className="ellipsis small">{a.name || a.id}</span><small className="muted">{(a.size / 1048576).toFixed(1)} MB{a.animated ? " · animated" : ""}{a.references?.length ? ` · used ${a.references.length}×` : ""}</small>
              <div className="row">
                {onPick && <button className="btn primary sm" onClick={() => onPick(a.id)}>Use</button>}
                <button className={`icon-btn sm ${a.favorite ? "on-danger" : ""}`} aria-pressed={a.favorite} aria-label="Favourite" onClick={() => api.patch(`/api/appearance/assets/${a.id.slice(1)}`, { favorite: !a.favorite }).then(refresh)}><Heart size={14} /></button>
                <label className="icon-btn sm" title="Replace file" aria-label="Replace file"><RefreshCcw size={14} /><input type="file" hidden accept="image/*,video/mp4,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) replace(a, f); e.target.value = ""; }} /></label>
                <button className="icon-btn sm danger" aria-label="Delete" onClick={() => del(a)}><Trash2 size={14} /></button>
              </div>
            </figcaption>
          </figure>
        ))}
        {assets && !list.length && <p className="muted small">Nothing here yet.</p>}
      </div>
    </div>
  );
}

function AssetPicker({ onPick, onClose, video }: { onPick: (ref: string) => void; onClose: () => void; video?: boolean }) {
  return (
    <div className="picker-pop" role="dialog" aria-label="Choose a background">
      <header className="row"><strong>Choose {video ? "a video" : "an image"}</strong><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      {!video && <div className="row wrap">{BUILTIN_WALLPAPERS.map(([ref, name]) => <button key={ref} className="wp-chip big" style={{ backgroundImage: `url(${assetUrl(ref)})` }} onClick={() => onPick(ref)} title={name} aria-label={`Built-in ${name}`} />)}</div>}
      <Library onPick={onPick} video={video} />
    </div>
  );
}

/* --------------------------------------------------------------- layout -- */
function LayoutSection() {
  const target = useTarget();
  if (target.kind !== "global") return <p className="muted">Layout is global (with optional per-device overrides in Accessibility & performance). Switch to “my global look” to edit it.</p>;
  return (
    <div className="stack">
      <h3>Navigation</h3>
      <SelectField path="layout.nav" label="Server navigation" options={[["vertical", "Vertical rail (left)"], ["horizontal", "Horizontal bar (top)"]]} />
      <SelectField path="layout.railColumns" label="Rail columns" options={[[1, "1 column"], [2, "2 columns"], [3, "3 columns"]]} hint="Vertical rail only." />
      <RangeField path="layout.sidebarWidth" label="Channel sidebar width" min={180} max={420} unit="px" />
      <RangeField path="layout.memberWidth" label="Member list width" min={180} max={400} unit="px" />
      <BoolField path="layout.showSidebar" label="Show channel sidebar" hint="When hidden, a button keeps navigation and your settings reachable." />
      <BoolField path="layout.showMembers" label="Show member list by default" />
      <h3>Messages</h3>
      <SelectField path="layout.messageStyle" label="Message style" options={[["list", "Traditional list"], ["bubbles", "Bubbles"]]} />
      <SelectField path="layout.density" label="Spacing" options={[["compact", "Compact"], ["cozy", "Comfortable"], ["spacious", "Spacious"], ["custom", "Custom"]]} />
      <RangeField path="layout.spacing" label="Custom spacing" min={0} max={16} unit="px" />
      <RangeField path="layout.avatarSize" label="Avatar size" min={24} max={56} unit="px" />
      <BoolField path="layout.grouping" label="Group consecutive messages" />
      <SelectField path="layout.timestamps" label="Timestamps" options={[["always", "Always"], ["hover", "On hover"], ["none", "Hidden"]]} />
      <SelectField path="layout.timeFormat" label="Time format" options={[["12h", "12-hour"], ["24h", "24-hour"], ["relative", "Relative (5 min ago)"]]} />
      <SelectField path="layout.unreadStyle" label="Unread indicator" options={[["pill", "Pill"], ["dot", "Dot"], ["bar", "Bar"]]} />
      <SelectField path="layout.mentionStyle" label="Mention highlight" options={[["tint", "Tinted background"], ["bar", "Side bar"], ["outline", "Outline"]]} />
      <SelectField path="layout.statusStyle" label="Status indicator" options={[["dot", "Dot"], ["ring", "Ring around avatar"], ["square", "Square"]]} />
      <h3>Panels</h3>
      <SelectField path="layout.panelStyle" label="Panel style" options={[["flat", "Flat"], ["rounded", "Rounded"], ["floating", "Floating panels"]]} />
      <RangeField path="layout.radius" label="Corner rounding" min={0} max={28} unit="px" />
      <RangeField path="layout.gap" label="Panel gaps (floating)" min={0} max={24} unit="px" />
      <RangeField path="layout.margin" label="Outer margin (floating)" min={0} max={32} unit="px" />
      <RangeField path="layout.scale" label="Interface scale" min={0.8} max={1.3} step={0.05} unit="×" />
    </div>
  );
}

/* ------------------------------------------------------ servers & DMs -- */
function ScopeList({ kind, onPick }: { kind: "guild" | "channel"; onPick: (t: Target) => void }) {
  const guilds = useStore((s) => s.guilds);
  const dms = useStore((s) => s.dms);
  const draftScopes = useAppearance((s) => s.draft?.scopes);
  const saved = useAppearance((s) => s.scopes);
  const scopes: Record<string, unknown> = draftScopes ?? Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, v.data]));
  const has = (k: string) => !!scopes[k];
  return (
    <div className="stack">
      <h3>{kind === "guild" ? "Per-server appearance" : "Per-conversation appearance"}</h3>
      <p className="muted small">{kind === "guild" ? "Your personal look inside a server. Server icons and banners chosen by its admins are separate and never replace your accessibility settings." : "Personal wallpaper, transparency, accent and message style for one DM, group or channel. Only you see it. To suggest a shared look, use the conversation's Appearance panel — others must accept it."}</p>
      <ul className="scope-list">
        {kind === "guild" ? Object.values(guilds).map((g) => (
          <li key={g.id}><button onClick={() => onPick({ kind: "guild", id: g.id, label: g.name })}>{g.name}</button>{has(scopeKey("guild", g.id)) && <span className="tag">customised</span>}</li>
        )) : [...Object.values(dms).map((c) => ({ c, label: dmTitle(c) })), ...Object.values(guilds).flatMap((g) => g.channels.filter((c) => c.type === 0).map((c) => ({ c, label: `${g.name} / #${c.name}` })))].map(({ c, label }) => (
          <li key={c.id}><button onClick={() => onPick({ kind: "channel", id: c.id, guildId: c.guild_id, label })}>{label}</button>{has(scopeKey("channel", c.id)) && <span className="tag">customised</span>}</li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------- presets & import -- */
function PresetsSection() {
  const [name, setName] = useState("");
  const [includeAssets, setIncludeAssets] = useState(false);
  const [imp, setImp] = useState<{ doc: ThemeDoc | null; issues: Issue[]; assets: Record<string, { mime: string; name: string; data: string }> } | null>(null);
  const currentDoc = (): ThemeDoc => {
    const r = resolveFor({ guildId: null, channelId: null }).resolved.theme;
    return { ...r, meta: { ...r.meta, id: "custom", name: name || "My theme", author: displayName(useStore.getState().me) } };
  };
  const exportDoc = async () => {
    const doc: any = currentDoc();
    if (includeAssets) {
      const refs = [...new Set([...JSON.stringify(doc).matchAll(/"(a\d+)"/g)].map((m) => m[1]!))];
      const assets: Record<string, unknown> = {};
      for (const ref of refs) {
        const blob = await (await fetch(assetUrl(ref)!)).blob();
        if (blob.size > 8 * 1048576) { toast(`Skipped a large asset (${(blob.size / 1048576).toFixed(1)} MB) — packages include files up to 8 MB.`, "info"); continue; }
        assets[ref] = { mime: blob.type, name: ref, data: await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]!); fr.readAsDataURL(blob); }) };
      }
      doc.assets = assets;
    } else {
      // Personal images are left out by default; their slots fall back to colours on import.
      const strip = (o: any): any => (Array.isArray(o) ? o.map(strip) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^a\d+$/.test(v) ? null : strip(v)])) : o);
      Object.assign(doc, strip(doc));
    }
    // Only the global look is exported — never per-conversation settings, labels or conversation ids.
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(doc.meta.name || "theme").replace(/[^\w-]+/g, "-")}.syndo-theme.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const readImport = async (file: File) => {
    if (file.size > 40 * 1048576) return toast("Theme packages are limited to 40 MB.", "error");
    try {
      const raw = JSON.parse(await file.text());
      const assets = raw.assets && typeof raw.assets === "object" ? raw.assets : {};
      delete raw.assets;
      const { doc, issues } = validateThemeDoc(raw);
      setImp({ doc, issues, assets });
    } catch { setImp({ doc: null, issues: [{ path: "", level: "error", message: file.name.endsWith(".css") ? "This is a CSS file. SEND themes are JSON packages; theme files made for other apps aren't compatible." : "This file isn't valid JSON." }], assets: {} }); }
  };
  const finishImport = async (applyNow: boolean) => {
    if (!imp?.doc) return;
    let doc = imp.doc;
    try {
      // Upload packaged assets into the library (validated by type and size on the server), then rewrite references.
      for (const [ref, a] of Object.entries(imp.assets)) {
        if (!/^a\d+$/.test(ref) || typeof a?.data !== "string") continue;
        const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
        const fd = new FormData(); fd.append("file", new Blob([bytes], { type: a.mime }), a.name || "asset");
        const up = await upload<{ id: string }>("/api/appearance/assets", fd, () => {}).promise;
        doc = JSON.parse(JSON.stringify(doc).replaceAll(`"${ref}"`, `"${up.id}"`));
      }
      const saved = await api.post<{ id: string }>("/api/appearance/presets", { name: doc.meta.name, data: doc });
      if (applyNow) editDraft((d) => ({ ...d, global: { ...d.global, themeId: `preset:${saved.id}` } }));
      toast(applyNow ? "Imported — previewing now. Press Apply to keep it." : "Imported into your presets.", "success");
      setImp(null); loadAssets();
    } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <div className="stack">
      <h3>Save current look as a preset</h3>
      <div className="add-row"><input placeholder="Preset name" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} aria-label="Preset name" />
        <button className="btn primary" onClick={async () => { try { await api.post("/api/appearance/presets", { name: name || "My theme", data: currentDoc() }); toast("Preset saved.", "success"); } catch (e) { toast(errMsg(e), "error"); } }}>Save preset</button></div>
      <h3>Export</h3>
      <label className="row"><input type="checkbox" checked={includeAssets} onChange={(e) => setIncludeAssets(e.target.checked)} /> Include my images in the file (up to 8 MB each)</label>
      <p className="muted small">Exports your global look as a versioned <code>.syndo-theme.json</code>. Per-conversation settings, labels and conversation ids are never exported.</p>
      <button className="btn" onClick={exportDoc}><Download size={14} /> Export theme</button>
      <h3>Import</h3>
      <label className="btn"><Upload size={14} /> Choose a theme file<input type="file" hidden accept=".json,application/json,.css" onChange={(e) => { const f = e.target.files?.[0]; if (f) readImport(f); e.target.value = ""; }} /></label>
      <p className="muted small">Supported: SEND theme packages (v2) and v1 exports. Not supported: BetterDiscord or other apps' <code>.theme.css</code> files — they target another app's structure and are rejected rather than half-applied.</p>
      {imp && (
        <div className="card stack">
          <strong>{imp.doc ? `“${imp.doc.meta.name}”` : "Can't import this file"}</strong>
          {imp.doc && <small className="muted">{imp.doc.meta.author ? `by ${imp.doc.meta.author} · ` : ""}{imp.doc.meta.version ? `v${imp.doc.meta.version} · ` : ""}{imp.doc.meta.license ?? "no licence stated"} · {Object.keys(imp.assets).length} packaged image(s)</small>}
          {imp.issues.length > 0 && <ul className="issues">{imp.issues.slice(0, 20).map((i, k) => <li key={k} className={i.level}>{i.level === "error" ? "✕" : "!"} <code>{i.path || "file"}</code> {i.message}</li>)}</ul>}
          {imp.doc && <div className="row"><button className="btn primary" onClick={() => finishImport(true)} disabled={imp.issues.some((i) => i.level === "error")}>Import & preview</button><button className="btn" onClick={() => finishImport(false)} disabled={imp.issues.some((i) => i.level === "error")}>Import to presets</button></div>}
          <button className="link" onClick={() => setImp(null)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- accessibility -- */
function AccessSection() {
  const g = useAppearance((s) => (s.draft ?? { global: s.global.data }).global);
  const device = useAppearance((s) => s.device);
  const setA = (p: Partial<A11yPrefs>) => editDraft((d) => ({ ...d, global: { ...d.global, a11y: { ...d.global.a11y, ...p } } }));
  const T = ({ k, label, hint }: { k: keyof A11yPrefs; label: string; hint?: string }) => (
    <label className="toggle-row"><span><span className="toggle-l">{label}</span>{hint && <span className="field-h">{hint}</span>}</span><input type="checkbox" role="switch" className="toggle" checked={!!g.a11y[k]} onChange={(e) => setA({ [k]: e.target.checked } as Partial<A11yPrefs>)} /></label>
  );
  return (
    <div className="stack">
      <h3>Accessibility — always wins over any theme</h3>
      <label className="field"><span className="field-l">Reduced motion</span><select value={g.a11y.reducedMotion} onChange={(e) => setA({ reducedMotion: e.target.value as A11yPrefs["reducedMotion"] })}><option value="system">Follow my system</option><option value="on">Always reduce</option><option value="off">Allow motion</option></select></label>
      <T k="highContrast" label="High contrast" />
      <T k="minContrast" label="Keep text readable" hint="Automatically adjusts text colour when a theme's contrast is too low." />
      <T k="readableOverlay" label="Readable overlay for busy wallpapers" hint="Adds a calm layer behind text. One click fix for loud backgrounds." />
      <T k="disableAnimatedBackgrounds" label="Disable animated backgrounds" hint="Shows a still frame instead." />
      <T k="disableProfileEffects" label="Disable profile effects" />
      <T k="disableOthersCosmetics" label="Hide other people's cosmetics" hint="Shows everyone with plain avatars and names. Usernames are always visible." />
      <label className="field"><span className="field-l">Blur</span><select value={g.a11y.blur} onChange={(e) => setA({ blur: e.target.value as A11yPrefs["blur"] })}><option value="full">Full</option><option value="reduced">Reduced</option><option value="off">Off</option></select></label>
      <T k="lowPower" label="Low-power mode" hint="Turns off blur, animation and video backgrounds everywhere." />
      <h3>This device only</h3>
      <p className="muted small">Not synced — useful for a laptop on battery or a small screen. Overrides your synced settings on this device.</p>
      <label className="toggle-row"><span className="toggle-l">Low power on this device</span><input type="checkbox" role="switch" className="toggle" checked={!!device.a11y?.lowPower} onChange={(e) => setDevice({ ...device, a11y: { ...device.a11y, lowPower: e.target.checked } })} /></label>
      <label className="toggle-row"><span className="toggle-l">No animated backgrounds on this device</span><input type="checkbox" role="switch" className="toggle" checked={!!device.a11y?.disableAnimatedBackgrounds} onChange={(e) => setDevice({ ...device, a11y: { ...device.a11y, disableAnimatedBackgrounds: e.target.checked } })} /></label>
      <label className="field"><span className="field-l">Server navigation on this device</span><select value={device.layout?.nav ?? ""} onChange={(e) => setDevice({ ...device, layout: { ...device.layout, nav: (e.target.value || undefined) as any } })}><option value="">Use synced setting</option><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option></select></label>
      <label className="field"><span className="field-l">Interface scale on this device</span><select value={device.layout?.scale ?? ""} onChange={(e) => setDevice({ ...device, layout: { ...device.layout, scale: e.target.value ? +e.target.value : undefined } })}><option value="">Use synced setting</option>{[0.85, 0.9, 1, 1.1, 1.2, 1.3].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}</select></label>
      <label className="field"><span className="field-l">Spacing on this device</span><select value={device.layout?.density ?? ""} onChange={(e) => setDevice({ ...device, layout: { ...device.layout, density: (e.target.value || undefined) as any } })}><option value="">Use synced setting</option><option value="compact">Compact</option><option value="cozy">Comfortable</option><option value="spacious">Spacious</option></select></label>
      <h3>Recovery</h3>
      <p className="small">If a theme ever makes SEND hard to use: press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>R</kbd> anywhere for safe appearance mode, open <code>/?safe-appearance=1</code>, or use the “Reset appearance” button on the sign-in screen and in the user menu.</p>
      <button className="btn danger" onClick={() => confirm("Reset all appearance settings (global, servers and conversations) to the default? Presets and your library are kept.") && resetAppearance("all")}>Reset appearance everywhere</button>
    </div>
  );
}

/* ------------------------------------------------------------- advanced -- */
function AdvancedSection() {
  const target = useTarget();
  const draft = useAppearance((s) => s.draft);
  const g = (draft ?? { global: useAppearance.getState().global.data }).global;
  const ov = target.kind === "global" ? g.overrides : draft?.scopes[scopeKey(target.kind, target.id)]?.overrides ?? {};
  const [json, setJson] = useState(() => JSON.stringify(ov, null, 2));
  const [issues, setIssues] = useState<Issue[]>([]);
  const css = g.overrides.customCss ?? "";
  const cssCheck = useMemo(() => validateCustomCss(css ?? ""), [css]);
  return (
    <div className="stack">
      <h3>Theme tokens (JSON)</h3>
      <p className="muted small">The documented schema (see THEMES.md): <code>colors</code>, <code>panels.&lt;region&gt;</code>, <code>typography</code>, <code>layout</code>, <code>background</code>, <code>effects</code>, <code>conversation</code>. Unknown keys are ignored, invalid values rejected with the path.</p>
      <textarea className="code-area" rows={14} value={json} onChange={(e) => setJson(e.target.value)} spellCheck={false} aria-label="Theme overrides JSON" />
      <div className="row"><button className="btn" onClick={() => {
        try {
          const { value, issues } = validateThemePartial(JSON.parse(json));
          setIssues(issues);
          if (issues.some((i) => i.level === "error")) return;
          editDraft((d) => target.kind === "global" ? { ...d, global: { ...d.global, overrides: value } } : { ...d, scopes: { ...d.scopes, [scopeKey(target.kind, target.id)]: { ...(d.scopes[scopeKey(target.kind, target.id)] ?? {}), overrides: value } } });
        } catch { setIssues([{ path: "", message: "Not valid JSON.", level: "error" }]); }
      }}>Preview JSON</button><button className="btn" onClick={() => setJson(JSON.stringify(ov, null, 2))}>Reload from editor</button></div>
      {issues.length > 0 && <ul className="issues">{issues.map((i, k) => <li key={k} className={i.level}><code>{i.path || "root"}</code> {i.message}</li>)}</ul>}
      {target.kind === "global" && (<>
        <h3>Custom CSS (advanced, opt-in)</h3>
        <label className="toggle-row"><span><span className="toggle-l">Enable custom CSS</span><span className="field-h">Restricted to visual properties on documented hooks. No imports, URLs, at-rules or layout changes. Safe mode ignores it.</span></span>
          <input type="checkbox" role="switch" className="toggle" checked={g.customCssEnabled} onChange={(e) => editDraft((d) => ({ ...d, global: { ...d.global, customCssEnabled: e.target.checked } }))} /></label>
        {g.customCssEnabled && (<>
          <textarea className="code-area" rows={10} value={css} spellCheck={false} aria-label="Custom CSS" placeholder={`[data-region="chat"] .msg-name { letter-spacing: 0.5px; }\n.mention { border-radius: 8px; }`}
            onChange={(e) => editDraft((d) => ({ ...d, global: { ...d.global, overrides: { ...d.global.overrides, customCss: e.target.value } } }))} />
          {cssCheck.errors.length ? <ul className="issues">{cssCheck.errors.map((e, k) => <li key={k} className="error">{e}</li>)}</ul> : css && <p className="ok-text small">Valid — applied in the preview.</p>}
          <details><summary className="small">Documented hooks</summary><p className="small">Regions: {REGIONS.map((r) => <code key={r.id}>[data-region="{r.id}"] </code>)}</p><p className="small">Classes: {CSS_CLASSES.map((c) => <code key={c}>.{c} </code>)}</p></details>
        </>)}
      </>)}
    </div>
  );
}

/* --------------------------------------------------------------- preview -- */
/** Realistic mock built from the app's own classes; regions are clickable (interface map). */
function Preview({ onRegion, selected }: { onRegion: (r: RegionId) => void; selected: RegionId | null }) {
  const me = useStore((s) => s.me);
  const R = ({ id, className, children }: { id: RegionId; className: string; children?: React.ReactNode }) => (
    <div data-region={id} className={`${className} pv-region ${selected === id ? "pv-sel" : ""}`} role="button" tabIndex={0} aria-label={`Edit ${REGIONS.find((r) => r.id === id)?.label}`}
      onClick={(e) => { e.stopPropagation(); onRegion(id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onRegion(id); } }}>{children}</div>
  );
  return (
    <div className="pv" data-region="app" onClick={() => onRegion("app")}>
      <PreviewBackdrop />
      <R id="rail" className="pv-rail">{[0, 1, 2].map((i) => <span key={i} className={`pv-g ${i === 1 ? "on" : ""}`} />)}</R>
      <R id="sidebar" className="pv-side"><b className="pv-gname">Sunrise Club</b>{["general", "photos", "plans"].map((c, i) => <span key={c} className={`side-ch ${i === 0 ? "active" : ""}`}># {c}</span>)}<span className="side-ch">🔊 Lounge</span>
        <R id="userPanel" className="pv-user"><i className="pv-av" style={{ background: "var(--accent)" }} /><span>{me ? displayName(me) : "You"}</span></R></R>
      <div className="pv-main">
        <R id="header" className="pv-head"><b># general</b><span className="muted small">Say hello!</span></R>
        <R id="chat" className="pv-chat msgs">
          <div className="msg"><div className="msg-row"><i className="pv-av" style={{ background: "#FF8A6B" }} /><div className="msg-body"><div className="msg-head"><span className="msg-name">Amara</span><time className="muted small">Today at 9:41</time></div><div className="msg-content">Movie night at 8? 🍿</div></div></div></div>
          <div className="msg mine"><div className="msg-row"><i className="pv-av" style={{ background: "var(--accent)" }} /><div className="msg-body"><div className="msg-head"><span className="msg-name">{me ? displayName(me) : "You"}</span></div><div className="msg-content">Yes! I'll bring snacks <span className="mention">@Amara</span></div></div></div></div>
          <div className="msg mentioned"><div className="msg-row"><i className="pv-av" style={{ background: "#2FBF71" }} /><div className="msg-body"><div className="msg-head"><span className="msg-name">Bodhi</span></div><div className="msg-content">Count me in — <a href="#preview" onClick={(e) => e.preventDefault()}>trailer</a> <code className="md-code">8pm</code></div><div className="reactions"><span className="reaction me">🎉 3</span></div></div></div></div>
        </R>
        <R id="composer" className="pv-comp composer"><span className="muted">Message #general</span></R>
      </div>
      <R id="members" className="pv-members"><small className="side-sec">Online — 3</small>{["Amara", "Bodhi", "Cy"].map((n) => <span key={n} className="member"><i className="pv-av sm" />{n}</span>)}</R>
      <div className="pv-float">
        <R id="profileCard" className="pv-card"><div className="pv-banner" /><b>Amara</b><small className="muted">@amara · she/her</small></R>
        <R id="call" className="pv-call"><span className="ctl sm" /><span className="ctl sm" /><span className="ctl sm danger" /></R>
        <R id="overlay" className="pv-menu"><span>Invite people</span><span>Settings</span></R>
        <R id="panels" className="pv-panel"><small>Pinned</small></R>
      </div>
    </div>
  );
}

function PreviewBackdrop() {
  const t = useAppearance((s) => s.resolved.theme);
  const bg = (t.meta.scheme === "light" ? t.background.light ?? t.background.dark : t.background.dark ?? t.background.light) ?? null;
  return bg && bg.kind !== "none" ? <Backdrop bg={bg} className="pv-bd" /> : null;
}
export { mergeDeep, themeFor };
