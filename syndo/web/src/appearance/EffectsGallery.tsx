import { Select } from "../components/Select.tsx";
import { useAppearance } from "./store.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { COSMETIC_COLLECTIONS, DEFAULT_PROFILE_THEME, type ProfileTheme } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { displayName, toast, useStore } from "../store.ts";
import { Wordmark } from "../components/ui.tsx";
import { CollectionArt } from "./CollectionArt.tsx";
import { AvatarDecoration, ProfileEffect } from "./motion/MotionView.tsx";
import { motionSupported } from "./motion/engine.ts";
import { COLLECTIONS, collectionTheme } from "./collections.ts";
import { CosmeticsEditor, ProfileCardView } from "./ProfileEditor.tsx";
import { normalizeTheme } from "./effects.tsx";

/** A tile's little profile card and avatar: still frames, coming alive while the tile is hovered or focused. */
function TilePreview({ id, motion }: { id: string; motion: boolean }) {
  const [live, setLive] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tile = ref.current?.closest(".collection-tile"); if (!tile) return;
    const on = () => setLive(true), off = () => setLive(false);
    tile.addEventListener("pointerenter", on); tile.addEventListener("pointerleave", off); tile.addEventListener("focusin", on); tile.addEventListener("focusout", off);
    return () => { tile.removeEventListener("pointerenter", on); tile.removeEventListener("pointerleave", off); tile.removeEventListener("focusin", on); tile.removeEventListener("focusout", off); };
  }, []);
  if (!motionSupported()) return <span ref={ref} style={{ display: "contents" }}><span className="collection-mini-card"><i/><span className="mini-lines"><b/><b/><b/></span><CollectionArt id={id} frame animate={motion} /></span><span className="collection-mini-avatar"><Wordmark/><CollectionArt id={id} animate={motion}/></span></span>;
  return <span ref={ref} style={{ display: "contents" }}>
    <span className="collection-mini-card motion"><ProfileEffect key={`${id}-${live}`} id={id} animate={motion && live} /><i/><span className="mini-lines"><b/><b/><b/></span></span>
    <span className="collection-mini-avatar"><Wordmark/><AvatarDecoration id={id} size={76} live={motion && live} /></span>
  </span>;
}

export function EffectsGallery({ initialGuild }: { initialGuild?: string }) {
  const motion = useAppearance(s => !s.resolved.reduceMotion && !s.global.data.a11y.lowPower && !s.device.a11y?.lowPower && !s.global.data.a11y.disableProfileEffects);
  const me = useStore(s => s.me)!;
  const guilds = useStore(s => s.guilds);
  const [scope, setScope] = useState(initialGuild ?? "global");
  const [theme, setTheme] = useState<ProfileTheme>(() => normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME);
  // What's saved on the server, so "Revert" and "decoration only" can start from it.
  const [saved, setSaved] = useState<ProfileTheme>(() => normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME);
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState(""), [limit, setLimit] = useState(24);
  const [filter, setFilter] = useState("All"), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (scope === "global") { const t = normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME; setTheme(t); setSaved(t); setLoading(false); return; }
    setLoading(true);
    api.get<any>(`/api/users/${me.id}/profile?guild_id=${scope}`).then(p => { if (!cancelled) { const t = normalizeTheme(p.member?.profile_theme ?? me.profile_theme) ?? DEFAULT_PROFILE_THEME; setTheme(t); setSaved(t); } }).catch(e => toast(errMsg(e), "error")).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(scope === "global" ? "/api/users/@me" : `/api/guilds/${scope}/members/@me`, { profile_theme: theme });
      setSaved(theme); toast("Profile effects saved.", "success");
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  const q = query.trim().toLowerCase();
  const matches = COLLECTIONS.filter(c=>(filter==="All"||(filter==="Flagships"?c.flagship:c.collectionId===filter))&&(!q||`${c.name} ${c.family} ${c.description}`.toLowerCase().includes(q)));
  const selected = COLLECTIONS.find(c=>c.id===(focus ?? theme.collection));
  const decoOnly = !!theme.avatarDeco && theme.avatarDeco !== theme.collection;
  const changed = JSON.stringify(theme) !== JSON.stringify(saved);
  return <div className="effects-studio">
    <header className="effects-heading"><span className="eyebrow">THE SEND COLLECTION</span><h3>Make an entrance.</h3><p>{COLLECTIONS.length} original bundles in {COSMETIC_COLLECTIONS.length} collections, each with a profile effect, an avatar decoration, a banner and matching colours.</p></header>
    <div className="effects-toolbar"><label className="field"><span className="field-l">Personalise</span><Select aria-label="Profile effects scope" value={scope} onChange={e => setScope(e.target.value)}><option value="global">My global profile</option>{Object.values(guilds).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></label><span className="effects-free">Every collection is included.</span></div>
    {loading ? <p role="status">Loading your server profile…</p> : <>
      <div className="effects-workbench"><div className="effects-showcase"><ProfileCardView d={{ user: {...me, profile_theme: theme}, name: displayName(me), username: me.username, pronouns: me.pronouns, bio: me.bio || "A little more you.", avatar: me.avatar, banner: me.banner, theme }} /><span className="effects-preview-caption">YOUR LIVE PREVIEW</span></div>
        <div className="effects-selection"><span className="eyebrow">{selected ? `${selected.family.toUpperCase()}${selected.flagship ? " · FLAGSHIP" : ""}` : "YOUR SIGNATURE"}</span><h4>{selected?.name ?? "Custom look"}</h4><p>{selected?.description ?? "Build your own combination with the controls below."}</p>
          {selected && <ul className="bundle-contents" aria-label="In this bundle"><li>Profile effect</li><li>Avatar decoration</li><li>Banner</li><li>Accent colours</li></ul>}
          {decoOnly && <p className="small">Avatar decoration: <strong>{COLLECTIONS.find(c=>c.id===theme.avatarDeco)?.name}</strong> · profile effect: <strong>{COLLECTIONS.find(c=>c.id===theme.collection)?.name ?? "none"}</strong></p>}
          <button className="btn primary" disabled={busy || !changed} onClick={save}>{busy ? "Saving…" : changed ? "Save effects" : "Saved"}</button>
          {selected && <button className="btn" onClick={()=>setTheme({ ...saved, avatarDeco: selected.id })}>Use only its avatar decoration</button>}
          <div className="row wrap">{changed && <button className="link" onClick={()=>{ setTheme(saved); setFocus(null); }}>Revert</button>}<button className="link muted" onClick={()=>{ setTheme({...DEFAULT_PROFILE_THEME}); setFocus(null); }}>Remove effects</button>{selected && <a className="link" href={`/fx?ids=${selected.id}`} target="_blank" rel="noreferrer">Share preview ↗</a>}</div>
          <small>Effects are public. Save here to apply them to your profile.</small></div>
      </div>
      <div className="catalog-tools"><label className="field"><span className="field-l">Find your collection</span><input type="search" aria-label="Search profile collections" placeholder="Moons, flames, neon, a favourite mood…" value={query} onChange={e=>{setQuery(e.target.value);setLimit(24);}}/></label></div>
      <div className="collection-chips" role="tablist" aria-label="Collections">{[["All","All",COLLECTIONS.length],["Flagships","Flagships",COLLECTIONS.filter(c=>c.flagship).length],...COSMETIC_COLLECTIONS.map(c=>[c.id,c.name,COLLECTIONS.filter(x=>x.collectionId===c.id).length] as const)].map(([id,name,n])=><button key={id} role="tab" aria-selected={filter===id} className={`chip ${filter===id?"on":""}`} onClick={()=>{setFilter(id as string);setLimit(24);}}>{name}<small>{n}</small></button>)}</div>
      {filter!=="All"&&filter!=="Flagships"&&<p className="muted small collection-blurb">{COSMETIC_COLLECTIONS.find(c=>c.id===filter)?.blurb}</p>}
      <p className="catalog-count" role="status">{matches.length} bundles</p>
      <div className="collection-grid">{matches.slice(0,limit).map(c=><button key={c.id} className={`collection-tile ${theme.collection===c.id?"selected":""}`} aria-pressed={theme.collection===c.id} aria-label={`Preview ${c.name}`} onClick={()=>{setTheme(collectionTheme(c));setFocus(c.id);}} style={{"--collection-color":c.primary,"--collection-shadow":c.secondary} as CSSProperties}>
        <span className={`collection-scene scene-${c.artKind??"original"}`}>{c.art&&<img className="collection-cover" src={c.art} alt="" loading="lazy" decoding="async"/>}<span className="collection-halo"/><TilePreview id={c.id} motion={motion}/><span className="collection-edition">{c.family}</span></span>
        <span className="collection-caption"><strong>{c.name}</strong><span>{theme.collection===c.id?"In preview":"Explore collection"}<span aria-hidden="true"> ↗</span></span></span>
      </button>)}</div>
      {limit<matches.length&&<button className="btn catalog-more" onClick={()=>setLimit(limit+24)}>Show 24 more</button>}
      {!matches.length&&<p className="muted">No bundles match this search.</p>}
      <details className="effects-custom"><summary>Fine tune your look <span>Colours, layers, rings & motion</span></summary><CosmeticsEditor value={theme} onChange={t=>setTheme(t)}/><button className="btn primary" onClick={save} disabled={busy}>Save custom look</button></details>
    </>}
  </div>;
}
