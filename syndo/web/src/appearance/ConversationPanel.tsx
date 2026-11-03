import { X } from "lucide-react";
import { ChannelType, type Background, type Channel, type ConversationPrefs, type ScopeAppearance } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { displayName, dmTitle, toast, useStore } from "../store.ts";
import { assetUrl } from "./engine.ts";
import { openStudio } from "./Studio.tsx";
import { scopeKey, updateScope, useAppearance } from "./store.ts";

/**
 * Appearance for one conversation or channel. Personal by default and saved
 * as you change it (autosave, with visible state). Sharing is a separate,
 * explicit proposal that each participant accepts for themselves.
 */
export function ConversationPanel({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const key = scopeKey("channel", channel.id);
  const scope = useAppearance((s) => s.scopes[key]?.data) ?? { overrides: {} };
  const saveState = useAppearance((s) => s.saveState);
  const shared = useAppearance((s) => s.shared.filter((x) => x.channel_id === channel.id));
  const meId = useStore((s) => s.me?.id);
  const users = useStore((s) => s.users);
  const conv: ConversationPrefs = scope.conversation ?? {};
  const bg = (scope.overrides.background as any)?.dark as Background | undefined;
  const patch = (fn: (s: ScopeAppearance) => ScopeAppearance) => updateScope(key, (s) => fn({ ...s, overrides: s.overrides ?? {} }));
  const setConv = (p: Partial<ConversationPrefs>) => patch((s) => ({ ...s, conversation: { ...(s.conversation ?? {}), ...p } }));
  const setBg = (b: Background | null) => patch((s) => ({ ...s, overrides: { ...s.overrides, background: b ? { dark: b, light: b, target: "chat" } : undefined } as any }));
  const isDm = channel.type === ChannelType.DM || channel.type === ChannelType.GROUP_DM;
  const propose = async () => {
    try { await api.post(`/api/channels/${channel.id}/theme-proposals`, { data: { ...scope.overrides } }); toast("Proposed. Others will see it and can accept it for themselves.", "success"); }
    catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <aside className="side-panel appearance-panel" data-region="panels" aria-label="Conversation appearance">
      <header className="panel-h"><h3>Appearance</h3><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
      <p className="muted small">Only you see these settings for {channel.guild_id ? `#${channel.name}` : dmTitle(channel)}. <span className={`save-state ss-${saveState}`}>{saveState === "saving" || saveState === "pending" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}</span></p>
      {isDm && channel.type === ChannelType.DM && (
        <label className="field"><span className="field-l">Your label for this conversation</span>
          <input value={conv.label ?? ""} maxLength={64} placeholder={displayName(channel.recipients?.[0])} onChange={(e) => setConv({ label: e.target.value || null })} />
          <span className="field-h">Shown only to you, always next to their real name.</span></label>
      )}
      <span className="field-l">Wallpaper</span>
      <div className="row wrap">
        <button className={`wp-chip ${!bg ? "on" : ""}`} onClick={() => setBg(null)} aria-label="No wallpaper (global)">∅</button>
        {["#1B2440", "#2A1B3D", "#123B33", "#3B1E1E"].map((c) => <button key={c} className={`wp-chip ${bg?.kind === "color" && bg.color === c ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setBg({ kind: "color", color: c })} />)}
        {[["#3D6BFF", "#FF8A6B"], ["#0F3B2E", "#3A1C71"], ["#FFC93C", "#FF5E7E"]].map(([a, b]) => <button key={a} className="wp-chip" style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} aria-label={`Gradient ${a} to ${b}`} onClick={() => setBg({ kind: "gradient", gradient: { from: a!, via: null, to: b!, angle: 135, type: "linear" }, overlay: 20, tint: "#000000" })} />)}
        {["builtin:dunes", "builtin:waves", "builtin:hexfield"].map((r) => <button key={r} className={`wp-chip ${bg?.asset === r ? "on" : ""}`} style={{ backgroundImage: `url(${assetUrl(r)})` }} aria-label={`Wallpaper ${r.slice(8)}`} onClick={() => setBg({ kind: "image", asset: r, fit: "cover", overlay: 25, tint: "#000000" })} />)}
      </div>
      <label className="slide"><span>Chat surface opacity</span><input type="range" min={0} max={100} value={conv.chatOpacity ?? 100} onChange={(e) => setConv({ chatOpacity: +e.target.value })} /><output>{conv.chatOpacity ?? 100}%</output></label>
      <label className="row">Accent <input type="color" value={(scope.overrides.colors as any)?.accent ?? "#3D6BFF"} onChange={(e) => patch((s) => ({ ...s, overrides: { ...s.overrides, colors: { ...(s.overrides.colors ?? {}), accent: e.target.value.toUpperCase() } } }))} /></label>
      <label className="field"><span className="field-l">Messages</span><select value={conv.messageStyle ?? ""} onChange={(e) => setConv({ messageStyle: (e.target.value || undefined) as any })}><option value="">Use global</option><option value="list">Traditional list</option><option value="bubbles">Bubbles</option></select></label>
      {(conv.messageStyle === "bubbles") && (
        <div className="row wrap">
          <label>Mine <input type="color" value={conv.bubbles?.mine ?? "#3D6BFF"} onChange={(e) => setConv({ bubbles: { ...conv.bubbles, mine: e.target.value.toUpperCase() } })} /></label>
          <label>Theirs <input type="color" value={conv.bubbles?.theirs ?? "#232C45"} onChange={(e) => setConv({ bubbles: { ...conv.bubbles, theirs: e.target.value.toUpperCase() } })} /></label>
          <label className="slide"><span>Radius</span><input type="range" min={0} max={28} value={conv.bubbles?.radius ?? 16} onChange={(e) => setConv({ bubbles: { ...conv.bubbles, radius: +e.target.value } })} /></label>
          <label className="slide"><span>Spacing</span><input type="range" min={0} max={24} value={conv.bubbles?.spacing ?? 4} onChange={(e) => setConv({ bubbles: { ...conv.bubbles, spacing: +e.target.value } })} /></label>
        </div>
      )}
      <label className="toggle-row"><span className="toggle-l">Compact here</span><input type="checkbox" role="switch" className="toggle" checked={!!conv.compact} onChange={(e) => setConv({ compact: e.target.checked })} /></label>
      <div className="row wrap">
        <button className="btn sm" onClick={() => openStudio("backgrounds", { kind: "channel", id: channel.id, guildId: channel.guild_id, label: channel.guild_id ? `#${channel.name}` : dmTitle(channel) })}>More in Studio…</button>
        <button className="btn sm danger" onClick={() => updateScope(key, () => null)}>Reset to global</button>
      </div>
      {isDm && (
        <section className="stack">
          <h4>Shared theme</h4>
          <p className="muted small">Suggest your look to everyone here. It applies for each person only after they accept, and their own settings still win.</p>
          <button className="btn sm" onClick={propose} disabled={!Object.keys(scope.overrides).length}>Propose my look</button>
          {shared.map((t) => (
            <div key={t.id} className="card small">
              <strong>{t.proposer_id === meId ? "Your proposal" : `${displayName(users[t.proposer_id])} suggested a shared look`}</strong>
              <div className="row wrap">
                {t.proposer_id === meId ? <button className="btn sm" onClick={() => api.del(`/api/theme-proposals/${t.id}`)}>Withdraw</button> : <>
                  <button className={`btn sm ${t.my_vote ? "primary" : ""}`} onClick={() => api.post(`/api/theme-proposals/${t.id}/accept`)}>{t.my_vote ? "Accepted" : "Accept"}</button>
                  <button className="btn sm" onClick={() => api.post(`/api/theme-proposals/${t.id}/decline`)}>{t.my_vote === false ? "Declined" : "Decline"}</button></>}
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
