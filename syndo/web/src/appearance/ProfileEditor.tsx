import { CollectionArt } from "./CollectionArt.tsx";
import { Range } from "../components/Range.tsx";
import { ArrowDown, ArrowUp, Plus, Trash2, Pencil } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import {
  DECORATIONS, DEFAULT_PROFILE_THEME, EFFECT_KINDS, ENTRANCES, FRAMES, NAMEPLATES, NAME_STYLES, P, RING_STYLES, STATUS_SHAPES, has,
  type EffectLayer, type ProfileTheme, type User,
} from "@syndo/shared";
import { api, errMsg, upload } from "../api.ts";
import { displayName, guildPerms, toast, useStore } from "../store.ts";
import { Avatar } from "../components/ui.tsx";
import { EffectsLayer, StyledName, normalizeTheme, useCosmetics } from "./effects.tsx";

const LABEL: Record<string, string> = {
  none: "None", solid: "Solid", dual: "Two-tone", spin: "Spinning", pulse: "Pulse", rainbow: "Prism", dashed: "Dashed",
  gradient: "Gradient", holo: "Holographic", neon: "Neon", glass: "Glass", sharp: "Sharp hex",
  halo: "Sun halo", sprout: "Sprout", starlight: "Starlight", bubbles: "Chat bubbles", socks: "Odd socks", hexes: "Hexes", orbit: "Orbit",
  shimmer: "Shimmer", plain: "Plain", glow: "Glow", outline: "Outline", circle: "Circle", square: "Square", diamond: "Diamond", hex: "Hexagon",
  fade: "Fade in", rise: "Rise", pop: "Pop", slide: "Slide", particles: "Floating particles", sparkle: "Sparkles", confetti: "Confetti", aurora: "Aurora", snow: "Snow",
  pan: "Slow pan",
};
const opts = (xs: readonly string[]) => xs.map((x) => <option key={x} value={x}>{LABEL[x] ?? x}</option>);

/** Everything a profile card needs, from either the global profile or a server profile. */
export interface CardData { user: User; name: string; username: string; pronouns: string; bio: string; avatar: string | null; banner: string | null; theme: ProfileTheme | null; status?: string | null; extra?: React.ReactNode }

export function ProfileCardView({ d, serverTheme, statusDot }: { d: CardData; serverTheme?: unknown; statusDot?: string | null }) {
  const { theme, animate } = useCosmetics(d.user, serverTheme ?? d.theme);
  const [hover, setHover] = useState(false);
  const t = theme;
  return (
    <div className={`pcv ${t ? `frame-${t.frame} enter-${animate ? t.entrance : "none"}` : ""}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={t ? ({ "--pc1": t.primary, "--pc2": t.secondary } as React.CSSProperties) : undefined}>
      <div className={`pc-banner ${t && animate && t.bannerAnimation !== "none" ? `banner-${t.bannerAnimation}` : ""}`}
        style={d.banner ? { backgroundImage: `url(${d.banner})` } : { background: t ? `linear-gradient(135deg, ${t.primary}, ${t.secondary})` : d.user.accent_color ?? "var(--accent)" }} />
      {t?.collection && <CollectionArt id={t.collection} frame animate={animate} />}
      {t && t.effects.length > 0 && <EffectsLayer layers={t.effects} animate={animate} hovered={hover} />}
      <div className="pc-av"><Avatar user={d.user} size={80} status={statusDot ?? undefined} src={d.avatar} serverTheme={t} /></div>
      <div className="pc-body">
        <h2><StyledName theme={t} animate={animate}>{d.name}</StyledName></h2>
        <div className="muted">@{d.username}{d.pronouns && ` · ${d.pronouns}`}</div>
        {d.status && <p className="pc-status">{d.status}</p>}
        {d.bio && <section><h3>About me</h3><p className="pre">{d.bio}</p></section>}
        {d.extra}
      </div>
    </div>
  );
}

export function ProfileMediaEdit({ children, avatar, banner }: { children: React.ReactNode; avatar: React.ChangeEventHandler<HTMLInputElement>; banner: React.ChangeEventHandler<HTMLInputElement> }) {
  const av = useRef<HTMLInputElement>(null), bg = useRef<HTMLInputElement>(null);
  const accept = "image/png,image/jpeg,image/gif,image/webp,image/avif";
  return <div className="profile-media-edit">{children}
    <input hidden type="file" ref={av} accept={accept} onChange={avatar} aria-label="Upload avatar image or GIF"/>
    <input hidden type="file" ref={bg} accept={accept} onChange={banner} aria-label="Upload banner image or GIF"/>
    <button className="profile-pencil profile-banner-pencil" aria-label="Edit banner" title="Upload image or GIF" onClick={() => bg.current?.click()}><Pencil size={15}/></button>
    <button className="profile-pencil profile-avatar-pencil" aria-label="Edit avatar" title="Upload image or GIF" onClick={() => av.current?.click()}><Pencil size={15}/></button>
  </div>;
}

/* ----------------------------------------------------------- cosmetics -- */
export function CosmeticsEditor({ value, onChange }: { value: ProfileTheme; onChange: (t: ProfileTheme) => void }) {
  const v = value;
  const set = (p: Partial<ProfileTheme>) => onChange({ ...v, ...p });
  const setLayer = (i: number, p: Partial<EffectLayer>) => set({ effects: v.effects.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const move = (i: number, d: number) => { const e = [...v.effects]; const j = i + d; if (j < 0 || j >= e.length) return; [e[i], e[j]] = [e[j]!, e[i]!]; set({ effects: e }); };
  const maxDur = Math.max(4, ...v.effects.map((l) => l.duration));
  return (
    <div className="stack cosm">
      <div className="row wrap">
        <label>Colour 1 <input type="color" value={v.primary} onChange={(e) => set({ primary: e.target.value.toUpperCase() })} /></label>
        <label>Colour 2 <input type="color" value={v.secondary} onChange={(e) => set({ secondary: e.target.value.toUpperCase() })} /></label>
      </div>
      <div className="grid2">
        <label className="field"><span className="field-l">Avatar ring</span><select value={v.ring.style} onChange={(e) => set({ ring: { ...v.ring, style: e.target.value as ProfileTheme["ring"]["style"] } })}>{opts(RING_STYLES)}</select></label>
        <label className="field"><span className="field-l">Ring colour / speed</span><span className="row"><input type="color" value={v.ring.color} onChange={(e) => set({ ring: { ...v.ring, color: e.target.value.toUpperCase() } })} /><Range min={0.25} max={3} step={0.25} value={v.ring.speed} onChange={(e) => set({ ring: { ...v.ring, speed: +e.target.value } })} aria-label="Ring speed" /></span></label>
        <label className="field"><span className="field-l">Profile frame</span><select value={v.frame} onChange={(e) => set({ frame: e.target.value as ProfileTheme["frame"] })}>{opts(FRAMES)}</select></label>
        <label className="field"><span className="field-l">Avatar decoration</span><select value={v.decoration} onChange={(e) => set({ decoration: e.target.value as ProfileTheme["decoration"] })}>{opts(DECORATIONS)}</select></label>
        <label className="field"><span className="field-l">Display-name style</span><select value={v.nameStyle} onChange={(e) => set({ nameStyle: e.target.value as ProfileTheme["nameStyle"] })}>{opts(NAME_STYLES)}</select></label>
        <label className="field"><span className="field-l">Name glow</span><Range min={0} max={100} value={v.nameGlow} onChange={(e) => set({ nameGlow: +e.target.value })} /></label>
        <label className="field"><span className="field-l">Nameplate</span><select value={v.nameplate} onChange={(e) => set({ nameplate: e.target.value as ProfileTheme["nameplate"] })}>{opts(NAMEPLATES)}</select></label>
        <label className="field"><span className="field-l">Status indicator shape</span><select value={v.statusShape} onChange={(e) => set({ statusShape: e.target.value as ProfileTheme["statusShape"] })}>{opts(STATUS_SHAPES)}</select></label>
        <label className="field"><span className="field-l">Card entrance</span><select value={v.entrance} onChange={(e) => set({ entrance: e.target.value as ProfileTheme["entrance"] })}>{opts(ENTRANCES)}</select></label>
        <label className="field"><span className="field-l">Banner animation</span><select value={v.bannerAnimation} onChange={(e) => set({ bannerAnimation: e.target.value as ProfileTheme["bannerAnimation"] })}>{opts(["none", "pan", "shimmer"])}</select></label>
      </div>
      <h4>Effect layers <small className="muted">drawn bottom to top; up to 6</small></h4>
      <div className="timeline" aria-label="Effect timeline">
        {v.effects.map((l, i) => (
          <div key={i} className={`tl-row ${l.enabled ? "" : "off"}`}>
            <span className="tl-name">{LABEL[l.kind]}</span>
            <span className="tl-track"><i style={{ width: `${(l.duration / maxDur) * 100}%`, background: l.color }} />{l.loop && <em>↻</em>}{l.trigger === "hover" && <em>hover</em>}</span>
          </div>
        ))}
      </div>
      {v.effects.map((l, i) => (
        <fieldset key={i} className="layer">
          <legend>{i + 1}. {LABEL[l.kind]}</legend>
          <div className="row wrap">
            <label className="row"><input type="checkbox" checked={l.enabled} onChange={(e) => setLayer(i, { enabled: e.target.checked })} /> On</label>
            <select value={l.kind} onChange={(e) => setLayer(i, { kind: e.target.value as EffectLayer["kind"] })} aria-label="Effect">{opts(EFFECT_KINDS)}</select>
            <input type="color" value={l.color} onChange={(e) => setLayer(i, { color: e.target.value.toUpperCase() })} aria-label="Effect colour" />
            <select value={l.trigger} onChange={(e) => setLayer(i, { trigger: e.target.value as EffectLayer["trigger"] })} aria-label="When"><option value="always">Always on</option><option value="hover">On hover</option></select>
            <label className="row"><input type="checkbox" checked={l.loop} onChange={(e) => setLayer(i, { loop: e.target.checked })} /> Loop</label>
            <button className="icon-btn sm" onClick={() => move(i, -1)} aria-label="Move layer up"><ArrowUp size={14} /></button>
            <button className="icon-btn sm" onClick={() => move(i, 1)} aria-label="Move layer down"><ArrowDown size={14} /></button>
            <button className="icon-btn sm danger" onClick={() => set({ effects: v.effects.filter((_, k) => k !== i) })} aria-label="Remove layer"><Trash2 size={14} /></button>
          </div>
          <div className="grid2">
            <label className="slide"><span>Intensity</span><Range min={0} max={100} value={l.intensity} onChange={(e) => setLayer(i, { intensity: +e.target.value })} /></label>
            <label className="slide"><span>Speed</span><Range min={0.25} max={3} step={0.25} value={l.speed} onChange={(e) => setLayer(i, { speed: +e.target.value })} /></label>
            <label className="slide"><span>Duration {l.duration}s</span><Range min={0.5} max={30} step={0.5} value={l.duration} onChange={(e) => setLayer(i, { duration: +e.target.value })} /></label>
            <label className="slide"><span>Density</span><Range min={0} max={100} value={l.density} onChange={(e) => setLayer(i, { density: +e.target.value })} /></label>
          </div>
        </fieldset>
      ))}
      {v.effects.length < 6 && <button className="btn sm" onClick={() => set({ effects: [...v.effects, { kind: "sparkle", enabled: true, color: v.primary, intensity: 50, speed: 1, duration: 4, loop: true, trigger: "always", density: 40 }] })}><Plus size={14} /> Add effect layer</button>}
      <p className="muted small">Effects are free and built in; there's no code in profiles. Viewers can turn off other people's effects, and they stop automatically with reduced motion.</p>
    </div>
  );
}

/* --------------------------------------------------------------- editor -- */
export function ProfileEditor({ embedded }: { embedded?: boolean }) {
  const me = useStore((s) => s.me)!;
  const guilds = useStore((s) => s.guilds);
  const [tab, setTab] = useState<string>("global");
  return (
    <div className="stack">
      <h3>Profile {embedded && <small className="muted">— public, saved immediately with “Save profile”</small>}</h3>
      <div className="tabs" role="tablist" aria-label="Which profile">
        <button role="tab" aria-selected={tab === "global"} className={tab === "global" ? "active" : ""} onClick={() => setTab("global")}>Global profile</button>
        <select value={tab === "global" ? "" : tab} onChange={(e) => setTab(e.target.value || "global")} aria-label="Edit a server profile">
          <option value="">Server profile…</option>{Object.values(guilds).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>
      {tab === "global" ? <GlobalProfile key="g" /> : <ServerProfile key={tab} guildId={tab} />}
      <p className="muted small">Your username (@{me.username}) always shows under any decorative name, so styling can't be used to impersonate someone.</p>
    </div>
  );
}

function GlobalProfile() {
  const me = useStore((s) => s.me)!;
  const [f, setF] = useState({ display_name: me.display_name ?? "", bio: me.bio, pronouns: me.pronouns, status: me.custom_status?.text ?? "" });
  const [theme, setTheme] = useState<ProfileTheme>(normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME);
  const [pct, setPct] = useState<number | null>(null);
  const file = (kind: "avatar" | "banner") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const x = e.target.files?.[0]; if (!x) return; const fd = new FormData(); fd.append("file", x);
    upload(`/api/users/@me/${kind}`, fd, setPct).promise.then(() => toast("Updated.", "success")).catch((er) => toast(errMsg(er), "error")).finally(() => setPct(null));
    e.target.value = "";
  };
  const save = async () => {
    try { await api.patch("/api/users/@me", { display_name: f.display_name || null, bio: f.bio, pronouns: f.pronouns, custom_status: f.status ? { text: f.status } : null, profile_theme: theme }); toast("Profile saved.", "success"); }
    catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <div className="profile-editor">
      <div className="stack">
        <label className="field"><span className="field-l">Display name</span><input value={f.display_name} maxLength={32} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
        <label className="field"><span className="field-l">Pronouns</span><input value={f.pronouns} maxLength={40} onChange={(e) => setF({ ...f, pronouns: e.target.value })} /></label>
        <label className="field"><span className="field-l">About me</span><textarea value={f.bio} maxLength={400} rows={3} onChange={(e) => setF({ ...f, bio: e.target.value })} /></label>
        <label className="field"><span className="field-l">Status</span><input value={f.status} maxLength={128} onChange={(e) => setF({ ...f, status: e.target.value })} /></label>
        {pct !== null && <progress max={1} value={pct} />}
        <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent("syndo:studio", { detail: { section: "effects" } }))}>Explore profile effects</button>
        <button className="btn primary" onClick={save}>Save profile</button>
      </div>
      <div className="stack">
        <small className="muted">Preview — how others see you</small>
        <ProfileMediaEdit avatar={file("avatar")} banner={file("banner")}><ProfileCardView d={{ user: { ...me, profile_theme: theme }, name: f.display_name || me.username, username: me.username, pronouns: f.pronouns, bio: f.bio, avatar: me.avatar, banner: me.banner, theme, status: f.status }} /></ProfileMediaEdit>
      </div>
    </div>
  );
}

interface SP { nick: string | null; bio: string | null; pronouns: string | null; status: string | null; theme: ProfileTheme | null }
function ServerProfile({ guildId }: { guildId: string }) {
  const me = useStore((s) => s.me)!;
  const guild = useStore((s) => s.guilds[guildId]);
  const [d, setD] = useState<SP | null>(null);
  const [server, setServer] = useState<{ avatar: string | null; banner: string | null }>({ avatar: null, banner: null });
  const load = () => api.get<any>(`/api/users/${me.id}/profile?guild_id=${guildId}`).then((p) => {
    const m = p.member ?? {};
    setD({ nick: m.nick ?? null, bio: m.bio ?? null, pronouns: m.pronouns ?? null, status: m.custom_status?.text ?? null, theme: m.profile_theme ? normalizeTheme(m.profile_theme) : null });
    setServer({ avatar: m.avatar ?? null, banner: m.banner ?? null });
  }).catch((e) => toast(errMsg(e), "error"));
  useEffect(() => { load(); }, [guildId]); // eslint-disable-line
  if (!guild || !d) return <p className="muted">Loading…</p>;
  const canNick = has(guildPerms(guild), P.CHANGE_NICKNAME) || has(guildPerms(guild), P.MANAGE_NICKNAMES);
  const U = ({ k, label, children }: { k: keyof SP; label: string; children: React.ReactNode }) => (
    <div className="sp-field">
      <label className="row small"><input type="checkbox" checked={d[k] === null} onChange={(e) => setD({ ...d, [k]: e.target.checked ? null : k === "theme" ? normalizeTheme(me.profile_theme) ?? DEFAULT_PROFILE_THEME : (k === "nick" ? displayName(me) : k === "bio" ? me.bio : k === "pronouns" ? me.pronouns : me.custom_status?.text ?? "") })} /> Use global value</label>
      <span className="field-l">{label}</span>
      {d[k] === null ? <span className="muted small">Using your global {label.toLowerCase()}</span> : children}
    </div>
  );
  const media = (kind: "avatar" | "banner") => (
    <div className="sp-field">
      <span className="field-l">Server {kind}</span>
      <div className="row wrap">
        <label className="btn sm">Upload<input type="file" hidden accept="image/png,image/jpeg,image/gif,image/webp,image/avif" onChange={(e) => { const x = e.target.files?.[0]; if (!x) return; const fd = new FormData(); fd.append("file", x); upload(`/api/guilds/${guildId}/members/@me/${kind}`, fd, () => {}).promise.then(load).catch((er) => toast(errMsg(er), "error")); e.target.value = ""; }} /></label>
        {server[kind] ? <button className="btn sm" onClick={() => api.del(`/api/guilds/${guildId}/members/@me/${kind}`).then(load)}>Use global {kind}</button> : <span className="muted small">Using your global {kind}</span>}
      </div>
    </div>
  );
  const save = async () => {
    try {
      await api.patch(`/api/guilds/${guildId}/members/@me`, { ...(canNick ? { nick: d.nick } : {}), bio: d.bio, pronouns: d.pronouns, custom_status: d.status ? { text: d.status } : null, profile_theme: d.theme });
      toast(`Server profile for ${guild.name} saved. Your global profile is unchanged.`, "success");
    } catch (e) { toast(errMsg(e), "error"); }
  };
  const theme = d.theme ?? normalizeTheme(me.profile_theme);
  return (
    <div className="profile-editor">
      <div className="stack">
        <p className="muted small">Only shown inside <strong>{guild.name}</strong>. Editing here never changes your global profile.</p>
        <U k="nick" label="Nickname">{canNick ? <input value={d.nick ?? ""} maxLength={32} onChange={(e) => setD({ ...d, nick: e.target.value })} /> : <span className="muted small">This server doesn't let you change your nickname.</span>}</U>
        
        <U k="pronouns" label="Pronouns"><input value={d.pronouns ?? ""} maxLength={40} onChange={(e) => setD({ ...d, pronouns: e.target.value })} /></U>
        <U k="bio" label="Bio"><textarea value={d.bio ?? ""} maxLength={400} rows={3} onChange={(e) => setD({ ...d, bio: e.target.value })} /></U>
        <U k="status" label="Status"><input value={d.status ?? ""} maxLength={128} onChange={(e) => setD({ ...d, status: e.target.value })} /></U>
        <button className="btn" onClick={() => window.dispatchEvent(new CustomEvent("syndo:studio", { detail: { section: "effects", target: { kind: "guild", id: guildId, label: guild.name } } }))}>Explore server profile effects</button>
        <div className="row"><button className="btn primary" onClick={save}>Save server profile</button>
          <button className="btn" onClick={async () => { if (!confirm("Reset your whole server profile to your global profile?")) return; await api.patch(`/api/guilds/${guildId}/members/@me`, { bio: null, pronouns: null, custom_status: null, profile_theme: null, ...(canNick ? { nick: null } : {}) }); await api.del(`/api/guilds/${guildId}/members/@me/avatar`); await api.del(`/api/guilds/${guildId}/members/@me/banner`); load(); }}>Reset server profile</button></div>
      </div>
      <div className="stack">
        <small className="muted">Preview — how members of {guild.name} see you</small>
        <ProfileMediaEdit avatar={e => { const x = e.target.files?.[0]; if (x) { const fd = new FormData(); fd.append("file", x); upload(`/api/guilds/${guildId}/members/@me/avatar`, fd, () => {}).promise.then(load).catch(er => toast(errMsg(er), "error")); } e.target.value = ""; }} banner={e => { const x = e.target.files?.[0]; if (x) { const fd = new FormData(); fd.append("file", x); upload(`/api/guilds/${guildId}/members/@me/banner`, fd, () => {}).promise.then(load).catch(er => toast(errMsg(er), "error")); } e.target.value = ""; }}><ProfileCardView d={{ user: me, name: d.nick || displayName(me), username: me.username, pronouns: d.pronouns ?? me.pronouns, bio: d.bio ?? me.bio, avatar: server.avatar ?? me.avatar, banner: server.banner ?? me.banner, theme, status: d.status ?? me.custom_status?.text }} serverTheme={theme} /></ProfileMediaEdit>
      </div>
    </div>
  );
}
