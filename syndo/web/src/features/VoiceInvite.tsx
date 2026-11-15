/**
 * Inviting people into a call from inside SEND.
 *
 * The sheet lists your conversations and friends with an Invite button each: pressing it sends that person (or group)
 * a message with the call's invite link, which shows as a "Join Voice" card. Pressing the card puts them straight into
 * the call, joining the server first if they aren't in it yet. The link can also go out by share, copy, QR code,
 * text message or email.
 */
import { Check, Link2, Mail, MessageSquareText, QrCode, Search, Share2, Users, Volume2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { ChannelType, type Channel, type Invite, type User } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { publicOrigin } from "../origin.ts";
import { navigate } from "../router.ts";
import { displayName, dmTitle, toast, useStore } from "../store.ts";
import { Avatar, Modal } from "../components/ui.tsx";
import { openDialog } from "../components/Shell.tsx";
import { isPhone } from "../mobile.ts";
import { joinVoice, useVoice } from "../voice/session.ts";

const VOICE_TYPES: number[] = [ChannelType.VOICE, ChannelType.STAGE];
export const isVoiceChannel = (type: number | undefined) => type != null && VOICE_TYPES.includes(type);

const INVITE_AGE = 7 * 86400;
/** One link per call while the app is open, so a second Invite press doesn't make a new one. */
const links = new Map<string, Promise<Invite>>();
/** Who you've already invited to which call (this visit). */
const sentTo = new Map<string, Set<string>>();

function inviteFor(channelId: string) {
  let p = links.get(channelId);
  if (!p) {
    p = api.post<Invite>(`/api/channels/${channelId}/invites`, { max_age: INVITE_AGE, max_uses: 0 });
    p.catch(() => links.delete(channelId));
    links.set(channelId, p);
  }
  return p;
}

type Target = { key: string; kind: "dm"; channel: Channel; name: string; user: User | null; group: boolean } | { key: string; kind: "friend"; user: User; name: string };

export function VoiceInviteSheet({ guildId, channelId, onClose }: { guildId: string; channelId: string; onClose: () => void }) {
  const guild = useStore((s) => s.guilds[guildId]);
  const channel = guild?.channels.find((c) => c.id === channelId);
  const dms = useStore((s) => s.dms);
  const relationships = useStore((s) => s.relationships);
  const meId = useStore((s) => s.me?.id);
  const inCallIds = useStore((s) => Object.values(s.voice).filter((v) => v.channel_id === channelId).map((v) => v.user_id).sort().join(","));
  const inCall = useMemo(() => new Set(inCallIds.split(",").filter(Boolean)), [inCallIds]);
  const [inv, setInv] = useState<Invite | null>(null); const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(""); const [qr, setQr] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(() => new Set(sentTo.get(channelId)));
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { inviteFor(channelId).then(setInv).catch((e) => setErr(errMsg(e))); }, [channelId]);
  const link = inv ? `${publicOrigin}/invite/${inv.code}` : "";
  const where = channel?.name ?? guild?.name ?? "the call";

  // Conversations first (most recent on top), then friends you have no conversation with yet.
  const targets = useMemo<Target[]>(() => {
    const out: Target[] = []; const covered = new Set<string>();
    const convs = Object.values(dms).filter((c) => c.type === ChannelType.DM || c.type === ChannelType.GROUP_DM)
      .sort((a, b) => (BigInt(b.last_message_id ?? b.id) > BigInt(a.last_message_id ?? a.id) ? 1 : -1));
    for (const c of convs) {
      const group = c.type === ChannelType.GROUP_DM;
      const other = group ? null : (c.recipients ?? []).find((u) => u.id !== meId) ?? null;
      if (!group && (!other || inCall.has(other.id) || relationships[other.id]?.type === 2)) continue;
      if (other) covered.add(other.id);
      out.push({ key: other ? `u${other.id}` : `c${c.id}`, kind: "dm", channel: c, name: group ? dmTitle(c) : displayName(other), user: other, group });
    }
    for (const r of Object.values(relationships)) {
      if (r.type !== 1 || covered.has(r.id) || inCall.has(r.id)) continue;
      out.push({ key: `u${r.id}`, kind: "friend", user: r.user, name: displayName(r.user) });
    }
    return out;
  }, [dms, relationships, meId, inCall]);
  const shown = q.trim() ? targets.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()) || (t.user?.username ?? "").toLowerCase().includes(q.trim().toLowerCase())) : targets;

  const send = async (t: Target) => {
    if (!inv) return;
    setBusy(t.key);
    try {
      let cid: string;
      if (t.kind === "dm") cid = t.channel.id;
      else {
        const c = await api.post<Channel>("/api/users/@me/channels", { recipient_id: t.user.id });
        useStore.setState((s) => ({ dms: { ...s.dms, [c.id]: c } }));
        cid = c.id;
      }
      await api.post(`/api/channels/${cid}/messages`, { content: link });
      const next = new Set(sent).add(t.key); setSent(next); sentTo.set(channelId, next);
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(null); }
  };
  const copy = () => navigator.clipboard?.writeText(link).then(() => toast("Invite link copied.", "success")).catch(() => toast(link, "info"));
  const share = () => navigator.share?.({ title: `Join me in ${where}`, text: `Join me in ${where} on SEND`, url: link }).catch(() => { /* closed */ });
  const showQr = async () => { if (qr) { setQr(null); return; } setQr(await QRCode.toDataURL(link, { margin: 1, width: 220, color: { dark: "#0E1220", light: "#FFFFFF" } })); };
  const text = encodeURIComponent(`Join me in ${where} on SEND: ${link}`);
  const editLink = () => { onClose(); openDialog({ kind: "invite", guildId, channelId, link: true }); };

  return (
    <Modal title="Invite a friend" onClose={onClose} className="vinv">
      {err ? <p className="danger-text">{err}</p> : <>
        <div className="vinv-share" role="group" aria-label="Share the invite">
          {typeof navigator.share === "function" && <button className="vinv-act" disabled={!inv} onClick={share}><span><Share2 size={22} /></span>Share Invite</button>}
          <button className="vinv-act" disabled={!inv} onClick={copy}><span><Link2 size={22} /></span>Copy Link</button>
          <button className={`vinv-act ${qr ? "on" : ""}`} disabled={!inv} onClick={showQr} aria-pressed={!!qr}><span><QrCode size={22} /></span>QR Code</button>
          {isPhone() && <a className="vinv-act" aria-disabled={!inv} href={inv ? `sms:?&body=${text}` : undefined}><span><MessageSquareText size={22} /></span>Messages</a>}
          <a className="vinv-act" aria-disabled={!inv} href={inv ? `mailto:?subject=${encodeURIComponent(`Join me in ${where}`)}&body=${text}` : undefined}><span><Mail size={22} /></span>Email</a>
        </div>
        {qr && <div className="vinv-qr"><img src={qr} alt="QR code for the invite link" width={220} height={220} /><small className="muted">Scan with a phone camera to join.</small></div>}
        <label className="vinv-search"><Search size={18} aria-hidden /><input autoFocus={!isPhone()} placeholder={`Invite friends to ${where}`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search friends and conversations" /></label>
        <p className="vinv-note">Your invite link expires in 7 days. <button className="link" onClick={editLink}>Edit invite link.</button></p>
        <ul className="vinv-list">
          {shown.map((t) => {
            const done = sent.has(t.key);
            return (
              <li key={t.key}>
                {t.kind === "dm" && t.group ? <span className="vinv-group" aria-hidden><Users size={20} /></span> : <Avatar user={t.user} size={40} />}
                <span className="vinv-name ellipsis">{t.name}</span>
                <button className={`btn sm ${done ? "vinv-sent" : ""}`} disabled={!inv || done || busy === t.key} onClick={() => send(t)}>
                  {done ? <><Check size={16} /> Sent</> : busy === t.key ? "Sending…" : "Invite"}
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="muted vinv-empty">{q ? "Nobody matches that name." : "No conversations or friends to invite yet. Share the link instead."}</li>}
        </ul>
      </>}
    </Modal>
  );
}

/* ------------------------------------------------------------- invite cards in messages -- */
const HOSTS = new Set([new URL(publicOrigin).host, location.host, "syndo.makz.space"]);
const LINK_RE = /https?:\/\/([^\s/]+)\/invite\/([A-Za-z0-9-]{3,32})(?![A-Za-z0-9-])/g;

/** Invite codes for SEND's own invite links in a message (at most three). */
export function inviteCodes(content: string | null | undefined): string[] {
  if (!content) return [];
  const out: string[] = [];
  for (const m of content.matchAll(LINK_RE)) if (HOSTS.has(m[1]!) && !out.includes(m[2]!)) out.push(m[2]!);
  return out.slice(0, 3);
}
/** The message is nothing but one invite link: show just the card. */
export const onlyInviteLink = (content: string | null | undefined) => !!content && inviteCodes(content).length === 1 && /^\s*https?:\/\/\S+\s*$/.test(content);

const previews = new Map<string, Promise<Invite>>();
const preview = (code: string) => {
  let p = previews.get(code);
  if (!p) { p = api.get<Invite>(`/api/invites/${encodeURIComponent(code)}`); p.catch(() => setTimeout(() => previews.delete(code), 30_000)); previews.set(code, p); }
  return p;
};

export function InviteCards({ content, mine }: { content: string | null | undefined; mine: boolean }) {
  const codes = inviteCodes(content);
  if (!codes.length) return null;
  return <>{codes.map((c) => <InviteCardView key={c} code={c} mine={mine} />)}</>;
}

function InviteCardView({ code, mine }: { code: string; mine: boolean }) {
  const [inv, setInv] = useState<Invite | null>(null); const [gone, setGone] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; preview(code).then((i) => live && setInv(i)).catch(() => live && setGone(true)); return () => { live = false; }; }, [code]);
  const member = useStore((s) => (inv ? !!s.guilds[inv.guild.id] : false));
  const ch = inv?.channel ?? null;
  const voice = isVoiceChannel(ch?.type);
  const peopleIds = useStore((s) => (ch && voice ? Object.values(s.voice).filter((v) => v.channel_id === ch.id).map((v) => v.user_id).join(",") : ""));
  const users = useStore((s) => s.users); const self = useStore((s) => s.me);
  const people = peopleIds ? peopleIds.split(",").map((id) => (id === self?.id ? self : users[id]) ?? null) : [];
  const here = useVoice((v) => !!ch && v.channelId === ch.id && v.status !== "error");
  const chName = useStore((s) => (ch && inv ? s.guilds[inv.guild.id]?.channels.find((c) => c.id === ch.id)?.name ?? ch.name : null));

  if (gone) return <div className="inv-card dead"><p className="muted small">This invite has expired or is no longer valid.</p></div>;
  if (!inv) return <div className="inv-card loading" aria-busy="true"><span className="inv-ic" /><span className="muted small">Loading invite…</span></div>;

  const go = async () => {
    setBusy(true);
    try {
      if (!member) await api.post(`/api/invites/${encodeURIComponent(code)}`);
      const target = ch ? `/channels/${inv.guild.id}/${ch.id}` : `/channels/${inv.guild.id}`;
      navigate(target);
      if (voice && ch) await joinVoice(ch.id);
    } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  const head = voice ? (mine ? "You sent an invite to join a voice channel" : "You've been invited to join a voice channel") : (mine ? "You sent an invite to join a server" : "You've been invited to join a server");
  const label = voice ? (here ? "In the call" : busy ? "Joining…" : "Join Voice") : member ? "Joined" : busy ? "Joining…" : "Join";
  return (
    <div className={`inv-card ${voice ? "voice" : ""}`}>
      <div className="inv-head">{head}</div>
      <div className="inv-body">
        <span className="inv-ic">{inv.guild.icon ? <img src={inv.guild.icon} alt="" /> : <b>{inv.guild.name.slice(0, 2)}</b>}</span>
        <span className="inv-text">
          <strong className="ellipsis">{voice && chName ? <><Volume2 size={16} aria-hidden /> {chName}</> : inv.guild.name}</strong>
          <small className="muted ellipsis">{voice ? <>{inv.guild.name}{people.length ? ` · ${people.length} in the call` : ""}</> : `${inv.guild.member_count} member${inv.guild.member_count === 1 ? "" : "s"}`}</small>
        </span>
        {voice && people.length > 0 && <span className="inv-people" aria-hidden>{people.slice(0, 4).map((u, i) => <Avatar key={u?.id ?? i} user={u} size={24} plain />)}</span>}
        <button className={`btn ${voice ? "join-voice" : "primary"}`} disabled={busy || here} onClick={go}>{label}</button>
      </div>
    </div>
  );
}
