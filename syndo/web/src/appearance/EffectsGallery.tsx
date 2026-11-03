import { useAppearance } from "./store.ts";
import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_PROFILE_THEME, type ProfileTheme } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { displayName, toast, useStore } from "../store.ts";
import { Wordmark } from "../components/ui.tsx";
import { CollectionArt } from "./CollectionArt.tsx";
import { COLLECTIONS, collectionTheme } from "./collections.ts";
import { CosmeticsEditor, ProfileCardView } from "./ProfileEditor.tsx";
import { normalizeTheme } from "./effects.tsx";

export function EffectsGallery({ initialGuild }: { initialGuild?: string }) {
  const motion = useAppearance(s => !s.resolved.reduceMotion && !s.global.data.a11y.lowPower && !s.device.a11y?.lowPower && !s.global.data.a11y.disableProfileEffects);
  const me = useStore(s => s.me)!;
  const guilds = useStore(s => s.guilds);
  const [scope, setScope] = useState(initialGuild ?? "global");
  const [theme, setTheme] = useState<ProfileTheme>(() => normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME);
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
  return <div className="effects-studio">
    <header className="effects-heading"><span className="eyebrow">THE SEND COLLECTION</span><h3>Make an entrance.</h3><p>Original artwork. Layered motion. A profile that feels like you.</p></header>
    <div className="effects-toolbar"><label className="field"><span className="field-l">Personalise</span><select aria-label="Profile effects scope" value={scope} onChange={e => setScope(e.target.value)}><option value="global">My global profile</option>{Object.values(guilds).map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><span className="effects-free">Every collection is included.</span></div>
    {loading ? <p role="status">Loading your server profile…</p> : <>
      <div className="effects-workbench"><div className="effects-showcase"><ProfileCardView d={{ user: {...me, profile_theme: theme}, name: displayName(me), username: me.username, pronouns: me.pronouns, bio: me.bio || "A little more you.", avatar: me.avatar, banner: me.banner, theme }} /><span className="effects-preview-caption">YOUR LIVE PREVIEW</span></div>
        <div className="effects-selection"><span className="eyebrow">YOUR SIGNATURE</span><h4>{COLLECTIONS.find(c=>c.id===theme.collection)?.name ?? "Custom look"}</h4><p>{COLLECTIONS.find(c=>c.id===theme.collection)?.description ?? "Build your own combination with the controls below."}</p><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save effects"}</button><button className="link muted" onClick={()=>setTheme({...DEFAULT_PROFILE_THEME})}>Remove effects</button><small>Effects are public. Save here to apply them to your profile.</small></div>
      </div>
      <div className="collection-filters" role="group" aria-label="Filter effect collections">{["All", "Celestial", "Botanical", "Ethereal", "Elemental", "Dark", "Ornamental"].map(f=><button key={f} className={filter===f?"selected":""} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f}</button>)}</div>
      <div className="collection-grid">{COLLECTIONS.filter(c=>filter==="All"||c.family===filter).map(c=><button key={c.id} className={`collection-tile ${theme.collection===c.id?"selected":""}`} aria-pressed={theme.collection===c.id} aria-label={`Preview ${c.name}`} onClick={()=>setTheme(collectionTheme(c))} style={{"--collection-color":c.primary,"--collection-shadow":c.secondary} as CSSProperties}>
        <span className="collection-scene"><span className="collection-halo"/><span className="collection-mini-card"><i/><span className="mini-lines"><b/><b/><b/></span><CollectionArt id={c.id} frame animate={motion} /></span><span className="collection-mini-avatar"><Wordmark/><CollectionArt id={c.id} animate={motion}/></span><span className="collection-edition">{c.family}</span></span>
        <span className="collection-caption"><strong>{c.name}</strong><span>{theme.collection===c.id?"In preview":"Explore collection"}<span aria-hidden="true"> ↗</span></span></span>
      </button>)}</div>
      <details className="effects-custom"><summary>Fine tune your look <span>Colours, layers, rings & motion</span></summary><CosmeticsEditor value={theme} onChange={t=>setTheme(t)}/><button className="btn primary" onClick={save} disabled={busy}>Save custom look</button></details>
    </>}
  </div>;
}
