import { useEffect, useState } from "react";
import { create } from "zustand";
import type { Guild } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { toast } from "../store.ts";

/* 7TV and BTTV emotes. Global sets are built in; a server can link a channel's set or turn them off.
   Messages carry `<7tv:name:id>` / `<bttv:name:id>`; images come from our server (cached there), never the providers. */

export interface Emote { id: string; name: string; animated: boolean; provider: "7tv" | "bttv" }
interface Settings { enabled: boolean; seventv_set?: string | null; twitch_id?: string | null; label?: string | null }
interface State { global: Emote[] | null; guild: Record<string, { settings: Settings; emotes: Emote[] }> }
export const useEmotes = create<State>(() => ({ global: null, guild: {} }));

let loadingGlobal: Promise<void> | null = null;
const loadingGuild = new Map<string, Promise<void>>();
export function loadEmotes(guildId?: string | null) {
  if (!useEmotes.getState().global && !loadingGlobal) loadingGlobal = api.get<{ emotes: Emote[] }>("/api/emotes/global").then((r) => useEmotes.setState({ global: r.emotes })).catch(() => { loadingGlobal = null; });
  if (guildId && !useEmotes.getState().guild[guildId] && !loadingGuild.has(guildId)) {
    loadingGuild.set(guildId, api.get<{ settings: Settings; emotes: Emote[] }>(`/api/guilds/${guildId}/emotes`)
      .then((r) => useEmotes.setState((s) => ({ guild: { ...s.guild, [guildId]: r } }))).catch(() => { loadingGuild.delete(guildId); }));
  }
}

export const emoteToken = (e: Emote) => `<${e.provider}:${e.name}:${e.id}>`;
export const emoteUrl = (provider: string, id: string) => `/api/emotes/img/${provider}/${id}`;
export const EMOTE_TOKEN = /^<(7tv|bttv):([A-Za-z0-9_]{2,32}):([A-Za-z0-9]{24,26})>/;
export const parseEmoteToken = (t: string) => { const m = t.match(EMOTE_TOKEN); return m ? { provider: m[1]!, name: m[2]!, id: m[3]! } : null; };

/** Emote groups offered in a channel: the server's linked set first, then the global sets (unless the server turned them off). */
export function emoteGroups(guildId?: string | null): { key: string; title: string; emotes: Emote[] }[] {
  const s = useEmotes.getState();
  const g = guildId ? s.guild[guildId] : null;
  if (g && g.settings.enabled === false) return [];
  const out: { key: string; title: string; emotes: Emote[] }[] = [];
  if (g?.emotes.length) out.push({ key: "linked", title: g.settings.label ? `${g.settings.label} · 7TV / BTTV` : "Server emotes", emotes: g.emotes });
  const global = s.global ?? [];
  const seven = global.filter((e) => e.provider === "7tv"), bttv = global.filter((e) => e.provider === "bttv");
  if (seven.length) out.push({ key: "7tv", title: "7TV", emotes: seven });
  if (bttv.length) out.push({ key: "bttv", title: "BTTV", emotes: bttv });
  return out;
}

export function ThirdPartyEmote({ provider, id, name, size }: { provider: string; id: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="md-emoji-missing" title={`:${name}:`}>:{name}:</span>;
  return <img className="md-emoji md-emote" src={emoteUrl(provider, id)} alt={`:${name}:`} title={`:${name}: · ${provider === "7tv" ? "7TV" : "BTTV"}`} draggable={false} loading="lazy" style={size ? { height: size } : undefined} onError={() => setBroken(true)} />;
}

/** Server settings → 7TV and BTTV. */
export function EmotesTab({ guild }: { guild: Guild }) {
  const data = useEmotes((s) => s.guild[guild.id]);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadEmotes(guild.id); }, [guild.id]);
  const save = async (body: { enabled?: boolean; source?: string | null }) => {
    setBusy(true);
    try {
      const r = await api.patch<{ settings: Settings; emotes: Emote[] }>(`/api/guilds/${guild.id}/emotes`, body);
      useEmotes.setState((s) => ({ guild: { ...s.guild, [guild.id]: r } }));
      if (body.source) { setSource(""); toast(`Linked ${r.settings.label ?? "the emote set"}: ${r.emotes.length} emotes.`, "success"); }
    } catch (e) { toast(errMsg(e), "error"); }
    finally { setBusy(false); }
  };
  if (!data) return <p className="muted">Loading…</p>;
  const s = data.settings;
  const linked = !!(s.seventv_set || s.twitch_id);
  return (
    <div className="stack emotes-tab">
      <p className="muted">Members can use 7TV and BTTV emotes by typing <code>:name:</code> or picking them from the emoji menu. The global sets are built in, and you can add a Twitch channel's emotes too.</p>
      <label className="row"><input type="checkbox" checked={s.enabled !== false} disabled={busy} onChange={(e) => save({ enabled: e.target.checked })} /> Allow 7TV and BTTV emotes in this server</label>
      {s.enabled !== false && <>
        <h3>Channel emote set</h3>
        {linked ? (
          <div className="row wrap">
            <span><strong>{s.label ?? "Linked set"}</strong> <span className="muted small">· {data.emotes.length} emotes{s.twitch_id ? " · 7TV and BTTV" : " · 7TV"}</span></span>
            <button className="btn sm" disabled={busy} onClick={() => save({ source: null })}>Remove</button>
          </div>
        ) : <p className="muted small">No channel set linked.</p>}
        <label className="field"><span className="field-l">{linked ? "Link a different set" : "Link a set"}</span>
          <div className="add-row"><input value={source} onChange={(e) => setSource(e.target.value)} placeholder="7tv.app/users/… or a Twitch user ID" />
            <button className="btn primary" disabled={busy || !source.trim()} onClick={() => save({ source })}>{busy ? "Linking…" : "Link"}</button></div></label>
        <p className="muted small">Paste a 7TV profile link to get both that channel's 7TV and BTTV emotes, or a 7TV emote-set link for just that set.</p>
        {data.emotes.length > 0 && <div className="emote-preview">{data.emotes.slice(0, 60).map((e) => <ThirdPartyEmote key={e.provider + e.id} provider={e.provider} id={e.id} name={e.name} size={28} />)}</div>}
      </>}
    </div>
  );
}
