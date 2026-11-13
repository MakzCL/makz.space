/**
 * The phone app's own screens, modelled on Discord's mobile app: the Messages home (search, Add Friends, people's
 * statuses, big conversation rows), the floating account card at the bottom of the drawer, and the "You" page.
 */
import { useEffect, useState } from "react";
import { Bell, Bookmark, ChevronDown, ChevronRight, Inbox as InboxIcon, Palette, Pencil, Phone, Plus, Search, Settings, Sparkles, UserPlus, Users } from "lucide-react";
import { ChannelType, type Channel } from "@send/shared";
import { api } from "../api.ts";
import { decodeWire } from "../crypto/dm.ts";
import { displayName, dmTitle, isUnread, useStore } from "../store.ts";
import { gwSend } from "../gateway.ts";
import { navigate } from "../router.ts";
import { Avatar, statusLabel } from "../components/ui.tsx";
import { openContextMenu } from "../components/overlay.tsx";
import { dmMenuItems } from "../components/menus.tsx";
import { openStudio } from "../appearance/Studio.tsx";
import { useShallow } from "zustand/react/shallow";

const EPOCH = 1767225600000n;
const idTime = (id: string) => { try { return Number((BigInt(id) >> 22n) + EPOCH); } catch { return 0; } };
export function ago(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "now"; if (s < 3600) return `${Math.floor(s / 60)}m`; if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`; if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`; return `${Math.floor(s / (86400 * 365))}y`;
}
type Dlg = (d: any) => void;

/** Messages home: title, search, Add Friends, a strip of what friends are up to, then conversations. */
export function MobileMessages({ current, onDialog }: { current: string; onDialog: Dlg }) {
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me)!;
  const readStates = useStore((s) => s.readStates);
  const pending = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 3).length);
  const callers = useStore(useShallow((s) => { const n: Record<string, number> = {}; for (const v of Object.values(s.voice)) if (s.dms[v.channel_id]) n[v.channel_id] = (n[v.channel_id] ?? 0) + 1; return n; }));
  const list = Object.values(dms).sort((a, b) => (BigInt(b.last_message_id ?? b.id) > BigInt(a.last_message_id ?? a.id) ? 1 : -1));
  // Friends with something to say: a custom status, or simply online.
  const active = useStore(useShallow((s) => Object.values(s.relationships).filter((r) => r.type === 1).map((r) => r.user ?? s.users[r.id]).filter(Boolean)
    .filter((u: any) => (s.presences[u.id] ?? "offline") !== "offline" || s.customStatuses?.[u.id]).slice(0, 12)));
  const statuses = useStore((s) => s.customStatuses ?? {});
  const messages = useStore((s) => s.messages);
  // Conversations not opened yet: fetch just their latest message for the preview line.
  const [latest, setLatest] = useState<Record<string, any>>({});
  useEffect(() => {
    let on = true;
    const need = list.filter((c) => c.last_message_id && !messages[c.id]?.list?.length && !(c.id in latest)).slice(0, 25);
    if (!need.length) return;
    setLatest((l) => { const n = { ...l }; for (const c of need) n[c.id] = null; return n; });
    for (const c of need) api.get<any[]>(`/api/channels/${c.id}/messages?limit=1`).then((r) => decodeWire(r)).then((r) => { if (on) setLatest((l) => ({ ...l, [c.id]: r[0] ?? null })); }).catch(() => {});
    return () => { on = false; };
  }, [list.map((c) => c.id + (c.last_message_id ?? "")).join()]); // eslint-disable-line
  const preview = (c: Channel) => {
    const last = messages[c.id]?.list?.at(-1) ?? latest[c.id];
    if (last) { const who = last.author?.id === me.id ? "You: " : c.type === ChannelType.GROUP_DM ? `${displayName(last.author)}: ` : ""; const body = last.content || (last.attachments?.length ? `${last.attachments.length} attachment${last.attachments.length > 1 ? "s" : ""}` : (last as any).sticker_items?.length || (last as any).stickers?.length ? "Sticker" : ""); return who + body; }
    const other = c.type === ChannelType.DM ? c.recipients?.[0] : null;
    const cs = other ? statuses[other.id] : null;
    return cs ? `${cs.emoji ?? ""} ${cs.text}`.trim() : c.type === ChannelType.GROUP_DM ? `${(c.recipients?.length ?? 0) + 1} members` : "";
  };
  return (
    <div className="m-home">
      <header className="m-home-h">
        <h2>Messages</h2>
        <div className="m-home-actions">
          <button className="m-round" aria-label="Search" onClick={() => window.dispatchEvent(new Event("send:quickswitcher"))}><Search size={22} /></button>
          <button className="m-pill" onClick={() => { navigate("/channels/@me"); setTimeout(() => window.dispatchEvent(new CustomEvent("send:friends-tab", { detail: "add" })), 30); window.dispatchEvent(new CustomEvent("send:nav", { detail: { open: false } })); }}><UserPlus size={20} /> Add Friends</button>
          <button className="m-round accent" aria-label="New group conversation" onClick={() => onDialog({ kind: "groupDm" })}><Plus size={24} /></button>
        </div>
      </header>
      <div className="m-home-scroll">
        {active.length > 0 && <div className="m-active" role="list" aria-label="Friends right now">{active.map((u: any) => {
          const cs = statuses[u.id];
          return <button key={u.id} role="listitem" className={`m-active-card ${cs ? "" : "slim"}`} onClick={async () => { const c = await api.post<Channel>("/api/users/@me/channels", { recipient_id: u.id }); navigate(`/channels/@me/${c.id}`); window.dispatchEvent(new CustomEvent("send:nav", { detail: { open: false } })); }}>
            {cs && <span className="m-active-emoji" aria-hidden>{cs.emoji || "💬"}</span>}
            <span className="m-active-who"><Avatar user={u} size={cs ? 36 : 52} status="" /><span className="ellipsis"><b>{displayName(u)}</b>{cs && <small className="ellipsis">{cs.text}</small>}</span></span>
          </button>;
        })}</div>}
        <nav className="m-quick" aria-label="Shortcuts">
          <button className={!current ? "on" : ""} onClick={() => navigate("/channels/@me")}><Users size={18} /> Friends{pending > 0 && <span className="badge inline">{pending}</span>}</button>
          <button onClick={() => window.dispatchEvent(new Event("send:inbox"))}><InboxIcon size={18} /> Inbox</button>
          <button className={current === "saved" ? "on" : ""} onClick={() => navigate("/channels/@me/saved")}><Bookmark size={18} /> Saved</button>
        </nav>
        <div className="m-dms">
          {list.map((c) => {
            const other = c.type === ChannelType.DM ? c.recipients?.[0] : null;
            const mentions = readStates[c.id]?.mention_count ?? 0;
            const unread = isUnread(c);
            const inCall = (callers[c.id] ?? 0) > 0;
            return (
              <button key={c.id} className={`side-dm m-dm ${current === c.id ? "active" : ""} ${unread ? "unread" : ""}`} onClick={() => navigate(`/channels/@me/${c.id}`)} onContextMenu={(e) => openContextMenu(e, dmMenuItems(c))}>
                {other ? <Avatar user={other} size={48} status="" /> : <span className="group-ico m-group-ico"><Users size={22} /></span>}
                <span className="m-dm-text">
                  <span className="m-dm-top"><b className="ellipsis">{other ? displayName(other) : dmTitle(c)}</b><time>{ago(idTime(c.last_message_id ?? c.id))}</time></span>
                  <span className="m-dm-sub ellipsis">{inCall ? <span className="dm-in-call"><Phone size={13} /> In a call · {callers[c.id]}</span> : preview(c)}</span>
                </span>
                {mentions > 0 && <span className="badge inline">{mentions}</span>}
              </button>
            );
          })}
          {!list.length && <p className="muted small pad">No conversations yet. Add a friend to start one.</p>}
        </div>
      </div>
    </div>
  );
}

/** The floating account card at the bottom of the drawer: avatar, name, status, a chevron for status and a bell for the inbox. */
export function MobileUserCard() {
  const me = useStore((s) => s.me)!;
  const [menu, setMenu] = useState(false);
  const status = me.custom_status ? `${me.custom_status.emoji ?? ""} ${me.custom_status.text}`.trim() : statusLabel(me.status);
  const setStatus = (st: string) => { gwSend("status", { status: st }); api.patch("/api/users/@me", { status: st }).catch(() => {}); setMenu(false); };
  return (
    <section className="m-usercard" aria-label="Your account">
      <button className="m-usercard-me" onClick={() => window.dispatchEvent(new Event("send:you"))} aria-label="Open your profile">
        <Avatar user={me} size={48} status={me.status === "invisible" ? "invisible" : me.status} />
        <span className="ellipsis"><b className="ellipsis">{displayName(me)}</b><small className="ellipsis">{status}</small></span>
      </button>
      <button className="m-round ghost" aria-label="Change status" aria-expanded={menu} onClick={(e) => openContextMenu(e, [
        ...(["online", "idle", "dnd", "invisible"] as const).map((s) => ({ label: statusLabel(s), checked: me.status === s, onSelect: () => setStatus(s) })),
        { kind: "separator" as const },
        { label: "Set custom status", onSelect: () => import("../features/live.tsx").then((m) => m.openCustomStatus()) },
      ])}><ChevronDown size={20} /></button>
      <button className="m-round ghost" aria-label="Inbox" onClick={() => window.dispatchEvent(new Event("send:inbox"))}><Bell size={22} /></button>
    </section>
  );
}

/** "You": your profile at a glance, with the shortcuts Discord keeps in its bottom bar. */
export function MobileYou({ onClose, onDialog }: { onClose: () => void; onDialog: Dlg }) {
  const me = useStore((s) => s.me)!;
  const friends = useStore((s) => Object.values(s.relationships).filter((r) => r.type === 1).length);
  const go = (fn: () => void) => () => { onClose(); setTimeout(fn, 60); };
  const since = new Date(idTime(me.id) || Date.now()).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="m-you" role="dialog" aria-modal="true" aria-label="You">
      <div className="m-you-banner" style={me.banner ? { backgroundImage: `url(${me.banner})` } : { background: me.accent_color ?? "linear-gradient(135deg, var(--accent), #8a6bff)" }}>
        <button className="m-round dark" aria-label="Close" data-panel-close onClick={onClose}><ChevronDown size={22} /></button>
        <button className="m-round dark" aria-label="Settings" onClick={go(() => onDialog({ kind: "userSettings" }))}><Settings size={20} /></button>
      </div>
      <div className="m-you-head">
        <span className="m-you-av"><Avatar user={me} size={96} status={me.status === "invisible" ? "invisible" : me.status} /></span>
        <button className="m-you-status" onClick={go(() => import("../features/live.tsx").then((m) => m.openCustomStatus()))}>
          {me.custom_status ? <>{me.custom_status.emoji} {me.custom_status.text}</> : <><Plus size={16} /> Add Status</>}
        </button>
      </div>
      <div className="m-you-body">
        <h2>{displayName(me)} <ChevronDown size={20} className="muted" /></h2>
        <p className="muted">{me.username}{me.pronouns ? ` · ${me.pronouns}` : ""}</p>
        <button className="btn primary m-you-edit" onClick={go(() => onDialog({ kind: "userSettings", tab: "profile" }))}><Pencil size={18} /> Edit Profile</button>
        <div className="m-card"><span>Member Since</span><b>{since}</b></div>
        <button className="m-card link" onClick={go(() => navigate("/channels/@me"))}><span>Friends</span><b>{friends}</b><ChevronRight size={20} /></button>
        {me.bio && <div className="m-card col"><span>About Me</span><p className="pre">{me.bio}</p></div>}
      </div>
      <nav className="m-dock" aria-label="Shortcuts">
        <button onClick={go(() => onDialog({ kind: "userSettings", tab: "effects" }))}><Sparkles size={22} /><span>Effects</span></button>
        <button onClick={go(() => openStudio("gallery"))}><Palette size={22} /><span>Studio</span></button>
        <button onClick={go(() => window.dispatchEvent(new Event("send:inbox")))}><InboxIcon size={22} /><span>Inbox</span></button>
        <button onClick={go(() => onDialog({ kind: "userSettings" }))}><Settings size={22} /><span>Settings</span></button>
      </nav>
    </div>
  );
}
