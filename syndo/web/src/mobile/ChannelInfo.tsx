/**
 * Phone channel page (tap the channel name), like Discord mobile: the channel's tile and name, quick actions, and tabs
 * for Members, Media, Pins, Links and Files. Media, links and files come from the channel's recent messages.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bell, BellOff, FileText, Link2, Lock, Search, Settings, Users } from "lucide-react";
import { ChannelType, type Channel, type Message } from "@send/shared";
import { api } from "../api.ts";
import { decodeWire } from "../crypto/dm.ts";
import { displayName, dmTitle, useStore } from "../store.ts";
import { Avatar } from "../components/ui.tsx";
import { ChannelGlyph } from "../components/ChannelGlyph.tsx";
import { openMediaViewer } from "../components/overlay.tsx";
import { ago } from "./MobileHome.tsx";

type Tab = "members" | "media" | "pins" | "links" | "files";
const EPOCH = 1767225600000n;
const idTime = (id: string) => { try { return Number((BigInt(id) >> 22n) + EPOCH); } catch { return 0; } };
const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"]/g;
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ChannelInfo({ channel, members, onClose, onSearch, onSettings, muted, onMute }: { channel: Channel; members: ReactNode; onClose: () => void; onSearch: () => void; onSettings?: () => void; muted: boolean; onMute: () => void }) {
  const [tab, setTab] = useState<Tab>("members");
  const cached = useStore((s) => s.messages[channel.id]?.list);
  const [fetched, setFetched] = useState<Message[] | null>(null);
  const [pins, setPins] = useState<Message[] | null>(null);
  useEffect(() => { if (tab !== "members" && tab !== "pins" && !fetched) api.get<Message[]>(`/api/channels/${channel.id}/messages?limit=100`).then((r) => decodeWire(r)).then(setFetched).catch(() => setFetched([])); }, [tab]); // eslint-disable-line
  useEffect(() => { if (tab === "pins" && !pins) api.get<Message[]>(`/api/channels/${channel.id}/pins`).then((r) => decodeWire(r)).then(setPins).catch(() => setPins([])); }, [tab]); // eslint-disable-line
  const all = useMemo(() => { const m = new Map<string, Message>(); for (const x of [...(fetched ?? []), ...((cached as Message[]) ?? [])]) m.set(x.id, x); return [...m.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)); }, [fetched, cached]);
  const media = all.flatMap((m) => (m.attachments ?? []).filter((a) => /^(image|video)\//.test(a.content_type)).map((a) => ({ a, m })));
  const files = all.flatMap((m) => (m.attachments ?? []).map((a) => ({ a, m })));
  const links = all.flatMap((m) => [...new Set((m.content ?? "").match(URL_RE) ?? [])].map((url) => ({ url, m, embed: (m.embeds ?? []).find((e) => e.url === url) })));
  const tabs: [Tab, string][] = [["members", "Members"], ["media", "Media"], ["pins", "Pins"], ["links", "Links"], ["files", "Files"]];
  const bar = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState({ x: 0, w: 0 });
  useEffect(() => { const b = bar.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`); if (b) { setInd({ x: b.offsetLeft, w: b.offsetWidth }); b.scrollIntoView({ inline: "nearest", block: "nearest" }); } }, [tab]);
  const title = channel.guild_id ? channel.name : dmTitle(channel);
  const kind = channel.type === ChannelType.DM ? "Direct Message" : channel.type === ChannelType.GROUP_DM ? "Group Chat" : channel.type === ChannelType.ANNOUNCEMENT ? "Announcement Channel" : "Text Channel";
  const loading = <p className="muted pad">Loading…</p>;
  const empty = (t: string) => <p className="muted pad m-info-empty">{t}</p>;
  return (
    <div className="m-info" role="dialog" aria-modal="true" aria-label={`${title} details`}>
      <header className="m-info-top">
        <button className="m-round ghost" aria-label="Back" data-panel-close onClick={onClose}><ArrowLeft size={24} /></button>
        <span className="grow" />
        <button className="m-round ghost" aria-label="Search" onClick={onSearch}><Search size={22} /></button>
        <button className="m-round ghost" aria-label={muted ? "Unmute" : "Mute"} onClick={onMute}>{muted ? <BellOff size={22} /> : <Bell size={22} />}</button>
        {onSettings && <button className="m-round ghost" aria-label="Channel settings" onClick={onSettings}><Settings size={22} /></button>}
      </header>
      <div className="m-info-id">
        <span className="m-info-tile">{channel.type === ChannelType.DM ? <Avatar user={channel.recipients?.[0]} size={48} status="" /> : channel.type === ChannelType.GROUP_DM ? <Users size={30} /> : <ChannelGlyph c={channel} size={34} />}</span>
        <span className="ellipsis"><b className="ellipsis">{title}</b><small>{kind}</small></span>
      </div>
      <div className="m-tabs" ref={bar} role="tablist">
        {tabs.map(([k, l]) => <button key={k} data-tab={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
        <i className="m-tabs-ind" style={{ transform: `translateX(${ind.x}px)`, width: ind.w }} aria-hidden />
      </div>
      <div className="m-info-body" key={tab}>
        {tab === "members" && <div className="m-info-members">{members}</div>}
        {tab === "media" && (!fetched ? loading : !media.length ? empty("Photos and videos shared here will show up here.") : <div className="m-media">{media.map(({ a, m }) => (
          <button key={a.id} className="m-media-cell" onClick={() => !a.encryption && openMediaViewer(media.filter((x) => !x.a.encryption).map((x) => ({ url: x.a.url, kind: x.a.content_type.startsWith("video") ? "video" : "image", name: x.a.filename })) as any, Math.max(0, media.filter((x) => !x.a.encryption).findIndex((x) => x.a.id === a.id)))}>
            {a.encryption ? <Lock size={22} /> : a.content_type.startsWith("video") ? <video src={a.url} muted preload="metadata" /> : <img src={a.url} alt={a.filename} loading="lazy" />}
            <span className="m-media-av"><Avatar user={m.author} size={26} status="" /></span>
          </button>))}</div>)}
        {tab === "pins" && (!pins ? loading : !pins.length ? empty("Nothing pinned yet.") : pins.map((m) => <Row key={m.id} m={m}><p className="m-row-text">{m.content || "Attachment"}</p></Row>))}
        {tab === "links" && (!fetched ? loading : !links.length ? empty("Links shared here will show up here.") : <div className="m-cards">{links.map(({ url, m, embed }, i) => (
          <a key={m.id + i} className="m-linkcard" href={url} target="_blank" rel="noreferrer">
            <span className="m-linkcard-art">{embed?.thumbnail?.url || embed?.image?.url ? <img src={embed.thumbnail?.url ?? embed.image?.url} alt="" loading="lazy" /> : <Link2 size={30} />}</span>
            <span className="m-linkcard-meta"><b className="ellipsis">{embed?.title || url.replace(/^https?:\/\//, "")}</b><small className="ellipsis link">{url}</small>
              <span className="m-who"><Avatar user={m.author} size={20} status="" /> {displayName(m.author)} · {ago(idTime(m.id))}</span></span>
          </a>))}</div>)}
        {tab === "files" && (!fetched ? loading : !files.length ? empty("Files shared here will show up here.") : <div className="m-cards">{files.map(({ a, m }) => (
          <a key={a.id} className="m-linkcard" href={a.encryption ? undefined : a.url} target="_blank" rel="noreferrer">
            <span className="m-linkcard-art">{!a.encryption && a.content_type.startsWith("image/") ? <img src={a.url} alt="" loading="lazy" /> : a.encryption ? <Lock size={28} /> : <FileText size={30} />}</span>
            <span className="m-linkcard-meta"><b className="ellipsis">{a.filename}</b><small>{size(a.size)}</small>
              <span className="m-who"><Avatar user={m.author} size={20} status="" /> {displayName(m.author)} · {ago(idTime(m.id))}</span></span>
          </a>))}</div>)}
      </div>
    </div>
  );
}

function Row({ m, children }: { m: Message; children: ReactNode }) {
  return <div className="m-row"><Avatar user={m.author} size={36} status="" /><div className="m-row-main"><span className="m-who"><b>{displayName(m.author)}</b> <small className="muted">{ago(idTime(m.id))}</small></span>{children}</div></div>;
}
