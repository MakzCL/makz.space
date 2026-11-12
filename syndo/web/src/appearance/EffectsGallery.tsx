import { Select } from "../components/Select.tsx";
import { useAppearance } from "./store.ts";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DEFAULT_PROFILE_THEME, PROFILE_CATALOG, type ProfileTheme } from "@send/shared";
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
  const [query, setQuery] = useState(""), [limit, setLimit] = useState(24), [upcoming, setUpcoming] = useState(false);
  const [filter, setFilter] = useState("All"), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (scope === "global") { setTheme(normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME); setLoading(false); return; }
    setLoading(true);
    api.get<any>(`/api/users/${me.id}/profile?guild_id=${scope}`).then(p => { if (!cancelled) setTheme(normalizeTheme(p.member?.profile_theme ?? me.profile_theme) ?? DEFAULT_PROFILE_THEME); }).catch(e => toast(errMsg(e), "error")).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope]);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch(scope === "global" ? "/api/users/@me" : `/api/guilds/${scope}/members/@me`, { profile_theme: theme });
      toast("Profile effects saved.", "success");
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  const matches = COLLECTIONS.filter(c=>(filter==="All"||c.family===filter)&&`${c.name} ${c.family} ${c.description}`.toLowerCase().includes(query.toLowerCase()));
  const pending = PROFILE_CATALOG.filter(c=>!c.ready&&(filter==="All"||c.category===filter)&&`${c.name} ${c.category} ${c.brief}`.toLowerCase().includes(query.toLowerCase()));
  const selected = COLLECTIONS.find(c=>c.id===theme.collection);
  return <div className="effects-studio">
    <header className="effects-heading"><span className="eyebrow">THE SEND COLLECTION</span><h3>Make an entrance.</h3><p>Original collections, familiar worlds, and motion made for SEND.</p></header>
    <div className="effects-toolbar"><label className="field"><span className="field-l">Personalise</span><Select aria-label="Profile effects scope" value={scope} onChange={e => setScope(e.target.value)}><option value="global">My global profile</option>{Object.values(guilds).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</Select></label><span className="effects-free">Every collection is included.</span></div>
    {loading ? <p role="status">Loading your server profile…</p> : <>
      <div className="effects-workbench"><div className="effects-showcase"><ProfileCardView d={{ user: {...me, profile_theme: theme}, name: displayName(me), username: me.username, pronouns: me.pronouns, bio: me.bio || "A little more you.", avatar: me.avatar, banner: me.banner, theme }} /><span className="effects-preview-caption">YOUR LIVE PREVIEW</span></div>
        <div className="effects-selection"><span className="eyebrow">YOUR SIGNATURE</span><h4>{COLLECTIONS.find(c=>c.id===theme.collection)?.name ?? "Custom look"}</h4><p>{COLLECTIONS.find(c=>c.id===theme.collection)?.description ?? "Build your own combination with the controls below."}</p><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save effects"}</button><button className="link muted" onClick={()=>setTheme({...DEFAULT_PROFILE_THEME})}>Remove effects</button><small>Effects are public. Save here to apply them to your profile.</small>{selected?.source && <a className="collection-credit" href={selected.source} target="_blank" rel="noreferrer">Artwork: {selected.artTitle} ↗</a>}</div>
      </div>
      <div className="catalog-tools"><label className="field"><span className="field-l">Find your collection</span><input type="search" aria-label="Search profile collections" placeholder="Games, cars, films, a favourite world…" value={query} onChange={e=>{setQuery(e.target.value);setLimit(24);}}/></label><label className="field"><span className="field-l">Category</span><Select aria-label="Collection category" value={filter} onChange={e=>{setFilter(e.target.value);setLimit(24);}}>{["All",...new Set([...COLLECTIONS.map(c=>c.family),...PROFILE_CATALOG.map(c=>c.category)])].map(f=><option key={f}>{f}</option>)}</Select></label></div>
      <p className="catalog-count" role="status">{matches.length} collections ready to preview</p>
      <div className="collection-grid">{matches.slice(0,limit).map(c=><button key={c.id} className={`collection-tile ${theme.collection===c.id?"selected":""}`} aria-pressed={theme.collection===c.id} aria-label={`Preview ${c.name}`} onClick={()=>setTheme(collectionTheme(c))} style={{"--collection-color":c.primary,"--collection-shadow":c.secondary} as CSSProperties}>
        <span className={`collection-scene scene-${c.artKind??"original"}`}>{c.art&&<img className="collection-cover" src={c.art} alt="" loading="lazy" decoding="async"/>}<span className="collection-halo"/><TilePreview id={c.id} motion={motion}/><span className="collection-edition">{c.family}</span></span>
        <span className="collection-caption"><strong>{c.name}</strong><span>{theme.collection===c.id?"In preview":"Explore collection"}<span aria-hidden="true"> ↗</span></span></span>
      </button>)}</div>
      {limit<matches.length&&<button className="btn catalog-more" onClick={()=>setLimit(limit+24)}>Show 24 more</button>}
      {!matches.length&&<p className="muted">No ready collections match this search.</p>}
      <details className="catalog-upcoming" open={upcoming} onToggle={e=>setUpcoming(e.currentTarget.open)}><summary>Requested collections · {pending.length} in preparation</summary>{upcoming&&<><p className="muted">These keep your requested designs on the list. They will become selectable as their artwork and animation are completed.</p><div className="upcoming-grid">{pending.map(c=><div key={c.id}><strong>{c.name}</strong><small>{c.brief}</small><span>In preparation</span></div>)}</div></>}</details>
      <details className="effects-custom"><summary>Fine tune your look <span>Colours, layers, rings & motion</span></summary><CosmeticsEditor value={theme} onChange={t=>setTheme(t)}/><button className="btn primary" onClick={save} disabled={busy}>Save custom look</button></details>
    </>}
  </div>;
}
