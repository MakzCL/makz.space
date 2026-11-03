import { Copy, Hash, Lock, MessageSquare, Volume2, Megaphone, FolderPlus, Radio, MessageSquareText } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BRAND, ChannelType, type Channel, type Guild, type Invite, type User } from "@syndo/shared";
import { ApiError, api, errMsg } from "../api.ts";
import { openDm } from "../actions.ts";
import { navigate, setTitle, useRoute } from "../router.ts";
import { displayName, toast, useStore } from "../store.ts";
import { Avatar, Field, Mark, Modal, statusLabel } from "./ui.tsx";

const TEMPLATES = [
  { id: "default", label: "Start fresh", hint: "A text and a voice channel." },
  { id: "friends", label: "Friends", hint: "Hang out, photos, plans, a lounge." },
  { id: "study", label: "Study group", hint: "Notes, help and quiet rooms." },
  { id: "gaming", label: "Gaming", hint: "Clips, LFG and squad voice." },
  { id: "blank", label: "Blank", hint: "Just #general." },
];

export function CreateServer({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me!);
  const [name, setName] = useState(`${displayName(me)}'s place`);
  const [tpl, setTpl] = useState("default");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true); setErr(null);
    try { const g = await api.post<Guild>("/api/guilds", { name, template: tpl }); onClose(); navigate(`/channels/${g.id}`); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Create a server" onClose={onClose} footer={<button className="btn primary" disabled={busy || name.trim().length < 2} onClick={create}>{busy ? "Creating…" : "Create"}</button>}>
      <p className="muted">A home for your friends or community. Every feature is included — no boosts, no upgrades.</p>
      <Field label="Server name" error={err}><input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} /></Field>
      <fieldset className="tpl-grid"><legend className="field-l">Template</legend>
        {TEMPLATES.map((t) => (
          <label key={t.id} className={`tpl ${tpl === t.id ? "active" : ""}`}>
            <input type="radio" name="tpl" value={t.id} checked={tpl === t.id} onChange={() => setTpl(t.id)} />
            <strong>{t.label}</strong><small className="muted">{t.hint}</small>
          </label>
        ))}
      </fieldset>
      <hr />
      <Field label="Have an invite instead?">
        <div className="add-row"><input placeholder="https://…/invite/abcd1234 or abcd1234" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn" disabled={!code.trim()} onClick={() => { onClose(); navigate(`/invite/${code.trim().split("/").pop()}`); }}>Join</button></div>
      </Field>
    </Modal>
  );
}

export function InviteDialog({ guildId, channelId, onClose }: { guildId: string; channelId?: string; onClose: () => void }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const target = channelId && guild?.channels.some((c) => c.id === channelId && c.type !== ChannelType.CATEGORY) ? channelId : guild?.channels.find((c) => c.type === ChannelType.TEXT)?.id;
  const [age, setAge] = useState(7 * 86400); const [uses, setUses] = useState(0);
  const [inv, setInv] = useState<Invite | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    api.post<Invite>(`/api/channels/${target}/invites`, { max_age: age, max_uses: uses }).then(setInv).catch((e) => setErr(errMsg(e)));
  }, [target, age, uses]);
  const link = inv ? `${location.origin}/invite/${inv.code}` : "";
  return (
    <Modal title={`Invite friends to ${guild?.name ?? "server"}`} onClose={onClose}>
      {err ? <p className="danger-text">{err}</p> : (
        <>
          <Field label="Invite link">
            <div className="add-row"><input readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="btn primary" onClick={() => { navigator.clipboard.writeText(link); toast("Invite link copied.", "success"); }}><Copy size={16} /> Copy</button></div>
          </Field>
          <div className="row">
            <Field label="Expires after"><select value={age} onChange={(e) => setAge(+e.target.value)}>
              <option value={1800}>30 minutes</option><option value={3600}>1 hour</option><option value={86400}>1 day</option><option value={7 * 86400}>7 days</option><option value={30 * 86400}>30 days</option><option value={0}>Never</option>
            </select></Field>
            <Field label="Max uses"><select value={uses} onChange={(e) => setUses(+e.target.value)}>
              <option value={0}>No limit</option><option value={1}>1 use</option><option value={5}>5 uses</option><option value={10}>10 uses</option><option value={25}>25 uses</option><option value={100}>100 uses</option>
            </select></Field>
          </div>
          <p className="muted small">Changing these creates a new link. Old links keep working until they expire or are revoked in Server settings → Invites.</p>
        </>
      )}
    </Modal>
  );
}

const CH_TYPES = [
  { type: ChannelType.TEXT, label: "Text", hint: "Messages, images, files, opinions and puns.", Icon: Hash },
  { type: ChannelType.VOICE, label: "Voice", hint: "Hang out with voice, video and screen sharing.", Icon: Volume2 },
  { type: ChannelType.ANNOUNCEMENT, label: "Announcement", hint: "Important updates.", Icon: Megaphone },
  { type: ChannelType.STAGE, label: "Stage (preview)", hint: "Speakers and an audience. Speaker controls are in progress.", Icon: Radio },
  { type: ChannelType.FORUM, label: "Forum (preview)", hint: "Organised posts. Posts/tags are in progress.", Icon: MessageSquareText },
];

export function CreateChannel({ guildId, parentId, type: initial, onClose }: { guildId: string; parentId: string | null; type?: number; onClose: () => void }) {
  const isCat = initial === ChannelType.CATEGORY;
  const [type, setType] = useState<number>(initial ?? ChannelType.TEXT);
  const [name, setName] = useState(""); const [priv, setPriv] = useState(false); const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    try {
      const c = await api.post<Channel>(`/api/guilds/${guildId}/channels`, { name, type, parent_id: isCat ? null : parentId, private: priv });
      onClose(); if (c.type !== ChannelType.CATEGORY) navigate(`/channels/${guildId}/${c.id}`);
    } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <Modal title={isCat ? "Create category" : "Create channel"} onClose={onClose} footer={<button className="btn primary" disabled={!name.trim()} onClick={create}>Create</button>}>
      {!isCat && (
        <fieldset className="ch-types"><legend className="field-l">Channel type</legend>
          {CH_TYPES.map(({ type: t, label, hint, Icon }) => (
            <label key={t} className={`tpl row ${type === t ? "active" : ""}`}><input type="radio" name="ct" checked={type === t} onChange={() => setType(t)} /><Icon size={20} aria-hidden /><span><strong>{label}</strong><small className="block muted">{hint}</small></span></label>
          ))}
        </fieldset>
      )}
      {isCat && <FolderPlus size={28} aria-hidden className="muted" />}
      <Field label={isCat ? "Category name" : "Channel name"} error={err}><input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && create()} /></Field>
      <label className="toggle-row"><span><span className="toggle-l"><Lock size={14} /> Private</span><span className="field-h">Only you and roles you add in channel settings can see it.</span></span><input type="checkbox" role="switch" className="toggle" checked={priv} onChange={(e) => setPriv(e.target.checked)} /></label>
    </Modal>
  );
}

export function NewGroupDm({ onClose }: { onClose: () => void }) {
  const friends = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 1));
  const limits = useStore((s) => s.limits);
  const [picked, setPicked] = useState<string[]>([]); const [q, setQ] = useState("");
  const max = (limits?.max_group_dm_recipients ?? 10) - 1;
  const create = async () => {
    try {
      const c = picked.length === 1 ? null : await api.post<Channel>("/api/users/@me/channels", { recipients: picked });
      onClose();
      if (!c) openDm(picked[0]!); else { useStore.setState((s) => ({ dms: { ...s.dms, [c.id]: c } })); navigate(`/channels/@me/${c.id}`); }
    } catch (e) { toast(errMsg(e), "error"); }
  };
  return (
    <Modal title="Select friends" onClose={onClose} footer={<button className="btn primary" disabled={!picked.length} onClick={create}>{picked.length > 1 ? "Create group" : "Open conversation"}</button>}>
      <p className="muted small">You can add {max - picked.length} more.</p>
      <input autoFocus placeholder="Type a friend's name" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter friends" />
      <ul className="pick-list">
        {friends.filter((f) => !q || displayName(f.user).toLowerCase().includes(q.toLowerCase())).map((f) => (
          <li key={f.id}><label><Avatar user={f.user} size={28} /><span className="ellipsis">{displayName(f.user)} <small className="muted">@{f.user.username}</small></span>
            <input type="checkbox" checked={picked.includes(f.id)} disabled={!picked.includes(f.id) && picked.length >= max} onChange={(e) => setPicked(e.target.checked ? [...picked, f.id] : picked.filter((x) => x !== f.id))} /></label></li>
        ))}
        {!friends.length && <li className="muted">Add friends first — group conversations are friends-only.</li>}
      </ul>
    </Modal>
  );
}

interface Profile { user: User; created_at: string; custom_status: any; presence: string; relationship: number; mutual_guilds: { id: string; name: string }[]; mutual_friends: User[]; member: { nick: string | null; joined_at: string; avatar: string | null; bio: string | null; roles: string[] } | null }

export function ProfileCard({ userId, guildId, anchor, onClose }: { userId: string; guildId: string | null; anchor: HTMLElement; onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const meId = useStore((s) => s.me!.id);
  const guild = useStore((s) => (guildId ? s.guilds[guildId] : null));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useEffect(() => { api.get<Profile>(`/api/users/${userId}/profile${guildId ? `?guild_id=${guildId}` : ""}`).then(setP).catch((e) => { toast(errMsg(e), "error"); onClose(); }); }, [userId, guildId]); // eslint-disable-line
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(); const h = ref.current?.offsetHeight ?? 400; const w = 320;
    setPos({ top: Math.max(8, Math.min(window.innerHeight - h - 8, r.top)), left: r.right + w + 16 < window.innerWidth ? r.right + 8 : Math.max(8, r.left - w - 8) });
  }, [anchor, p]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  const theme = p?.user.profile_theme;
  const act = (fn: () => Promise<unknown>) => fn().then(() => api.get<Profile>(`/api/users/${userId}/profile`).then(setP)).catch((e) => toast(errMsg(e), "error"));
  return (
    <div ref={ref} className={`profile-card ${theme?.effect ? `fx-${theme.effect}` : ""}`} role="dialog" aria-label="Profile" style={{ ...pos, ...(theme ? { "--pc1": theme.primary, "--pc2": theme.secondary } as any : {}) }}>
      {!p ? <p className="muted pad">Loading…</p> : (
        <>
          <div className="pc-banner" style={p.user.banner ? { backgroundImage: `url(${p.user.banner})` } : { background: theme ? `linear-gradient(135deg, ${theme.primary}, ${theme.secondary})` : p.user.accent_color ?? "var(--accent)" }} />
          <div className="pc-av"><Avatar user={p.user} size={80} status={p.presence} src={p.member?.avatar} /></div>
          <div className="pc-body">
            <h2 className={theme?.nameStyle ? `name-${theme.nameStyle}` : ""}>{p.member?.nick || displayName(p.user)}</h2>
            <div className="muted">@{p.user.username}{p.user.pronouns && ` · ${p.user.pronouns}`}</div>
            {p.custom_status?.text && <p className="pc-status">{p.custom_status.emoji} {p.custom_status.text}</p>}
            {(p.member?.bio || p.user.bio) && <section><h3>About me</h3><p className="pre">{p.member?.bio || p.user.bio}</p></section>}
            <section><h3>Member since</h3><p className="small">{new Date(p.created_at).toLocaleDateString()}{p.member && guild && ` · joined ${guild.name} ${new Date(p.member.joined_at).toLocaleDateString()}`}</p></section>
            {p.member && guild && p.member.roles.length > 0 && <section><h3>Roles</h3><div className="role-chips">{guild.roles.filter((r) => p.member!.roles.includes(r.id)).sort((a, b) => b.position - a.position).map((r) => <span key={r.id} className="role-chip"><i style={{ background: r.color ?? "var(--textFaint)" }} />{r.name}</span>)}</div></section>}
            {userId !== meId && (p.mutual_guilds.length > 0 || p.mutual_friends.length > 0) && (
              <section><h3>Mutuals</h3><p className="small muted">{p.mutual_guilds.length} mutual server{p.mutual_guilds.length === 1 ? "" : "s"} · {p.mutual_friends.length} mutual friend{p.mutual_friends.length === 1 ? "" : "s"}</p>
                <p className="small">{p.mutual_guilds.map((g) => g.name).join(", ")}</p></section>
            )}
            {userId !== meId && (
              <div className="pc-actions">
                {p.relationship !== 2 && <button className="btn primary sm" onClick={() => { onClose(); openDm(userId); }}><MessageSquare size={14} /> Message</button>}
                {p.relationship === 0 && <button className="btn sm" onClick={() => act(() => api.post("/api/users/@me/relationships", { username: p.user.username }))}>Add friend</button>}
                {p.relationship === 3 && <button className="btn sm" onClick={() => act(() => api.put(`/api/users/@me/relationships/${userId}`, { type: 1 }))}>Accept request</button>}
                {p.relationship === 4 && <span className="muted small">Request sent</span>}
                {p.relationship !== 2 ? <button className="btn danger sm" onClick={() => confirm("Block this person?") && act(() => api.put(`/api/users/@me/relationships/${userId}`, { type: 2 }))}>Block</button>
                  : <button className="btn sm" onClick={() => act(() => api.del(`/api/users/@me/relationships/${userId}`))}>Unblock</button>}
              </div>
            )}
            <span className="sr-only">{statusLabel(p.presence)}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** /invite/:code landing page — works signed in or out. */
export function InvitePage() {
  const code = useRoute().params.code!;
  const conn = useStore((s) => s.conn);
  const [inv, setInv] = useState<Invite | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle("Invite"); api.get<Invite>(`/api/invites/${encodeURIComponent(code)}`).then(setInv).catch((e) => setErr(errMsg(e))); }, [code]);
  const accept = async () => {
    if (conn === "signed_out") { navigate(`/register?next=${encodeURIComponent(`/invite/${code}`)}`); return; }
    setBusy(true);
    try { const r = await api.post<{ guild_id: string }>(`/api/invites/${encodeURIComponent(code)}`); navigate(`/channels/${r.guild_id}`); }
    catch (e) { setErr(e instanceof ApiError ? e.message : errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <main className="auth">
      <div className="auth-art" aria-hidden><Mark size={220} /></div>
      <section className="auth-card invite-card" style={inv?.guild.banner ? { backgroundImage: `linear-gradient(var(--bg1) 40%, transparent), url(${inv.guild.banner})` } : undefined}>
        <div className="auth-brand"><Mark size={36} /><span>{BRAND.name}</span></div>
        {err ? <><h1>Invite unavailable</h1><p className="muted">{err}</p><button className="btn" onClick={() => navigate("/channels/@me")}>Continue to {BRAND.name}</button></> : !inv ? <p className="muted">Loading invite…</p> : (
          <>
            <div className="invite-icon">{inv.guild.icon ? <img src={inv.guild.icon} alt="" /> : <span>{inv.guild.name.slice(0, 2)}</span>}</div>
            <p className="muted">{inv.inviter ? `${displayName(inv.inviter)} invited you to join` : "You've been invited to join"}</p>
            <h1>{inv.guild.name}</h1>
            {inv.guild.description && <p>{inv.guild.description}</p>}
            <p className="muted small">{inv.guild.member_count} member{inv.guild.member_count === 1 ? "" : "s"}</p>
            <button className="btn primary" disabled={busy} onClick={accept}>{conn === "signed_out" ? "Create an account to join" : busy ? "Joining…" : "Accept invite"}</button>
            {conn === "signed_out" && <button className="link" onClick={() => navigate(`/login?next=${encodeURIComponent(`/invite/${code}`)}`)}>I already have an account</button>}
          </>
        )}
      </section>
    </main>
  );
}
