import { Select } from "../components/Select.tsx";
import { useMemo, useState } from "react";
import { BarChart3, Check, CornerUpRight, Hash, MessageSquare, Play, ShieldAlert, Sparkles, Radio, X } from "lucide-react";
import { MessageType, P, type Channel, type Embed, type Message, type MessageComponent } from "@send/shared";
import { api, errMsg } from "../api.ts";
import { Markdown } from "../markdown.tsx";
import { navigate } from "../router.ts";
import { can, channelById, memberName, toast, useStore } from "../store.ts";
import { fmtTime } from "../components/ui.tsx";
import { openMediaViewer } from "../components/overlay.tsx";

/* ----------------------------------------------------------------------------- embeds -- */
const hexOr = (c: string | null | undefined) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined);

export function Embeds({ m, channel }: { m: Message; channel: Channel }) {
  const list = m.embeds ?? [];
  const me = useStore((s) => s.me?.id);
  if (!list.length) return null;
  const canHide = m.author.id === me || (!!channel.guild_id && can(channel, P.MANAGE_MESSAGES));
  const hide = () => api.patch(`/api/channels/${channel.id}/messages/${m.id}/flags`, { suppress_embeds: true }).catch((e) => toast(errMsg(e), "error"));
  // A message that is only a link to an image/GIF shows just the media.
  return <div className="embeds">{list.map((e, i) => <EmbedView key={i} e={e} onHide={canHide ? hide : undefined} />)}</div>;
}

function EmbedView({ e, onHide }: { e: Embed; onHide?: () => void }) {
  const [play, setPlay] = useState(false);
  if (e.type === "image" || e.type === "gifv") {
    const url = e.image?.url ?? e.thumbnail?.url;
    if (!url) return null;
    return <button className="embed-media" onClick={() => openMediaViewer([{ url, filename: "image", content_type: "image/png", width: e.image?.width ?? null, height: e.image?.height ?? null }], 0)} aria-label="Open image">
      <img src={url} alt="" loading="lazy" decoding="async" />
    </button>;
  }
  const yt = e.video?.embed;
  return (
    <div className={`embed ${e.type}`} style={{ borderLeftColor: hexOr(e.color) }}>
      {onHide && <button className="embed-x icon-btn sm" aria-label="Remove embed" title="Remove embeds" onClick={onHide}><X size={14} /></button>}
      <div className="embed-grid">
        <div className="embed-text">
          {e.site_name && <div className="embed-site">{e.site_name}</div>}
          {e.author && <div className="embed-author">{e.author.icon_url && <img src={e.author.icon_url} alt="" />}{e.author.url ? <a href={e.author.url} target="_blank" rel="noopener noreferrer nofollow">{e.author.name}</a> : e.author.name}</div>}
          {e.title && (e.url ? <a className="embed-title" href={e.url} target="_blank" rel="noopener noreferrer nofollow ugc">{e.title}</a> : <div className="embed-title">{e.title}</div>)}
          {e.description && <div className="embed-desc">{e.type === "rich" ? <Markdown text={e.description} ctx={{ guildId: null }} /> : e.description}</div>}
          {!!e.fields?.length && <div className="embed-fields">{e.fields.map((f, i) => <div key={i} className={`embed-field ${f.inline ? "inline" : ""}`}><strong>{f.name}</strong><div><Markdown text={f.value} ctx={{ guildId: null }} /></div></div>)}</div>}
        </div>
        {e.thumbnail?.url && !yt && !e.image && <img className="embed-thumb" src={e.thumbnail.url} alt="" loading="lazy" />}
      </div>
      {yt ? (
        <div className="embed-video">
          {play ? <iframe src={yt} title={e.title ?? "Video"} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" />
            : <button className="embed-play" onClick={() => setPlay(true)} aria-label={`Play ${e.title ?? "video"}`}>{e.thumbnail?.url && <img src={e.thumbnail.url} alt="" loading="lazy" />}<span><Play size={28} fill="currentColor" /></span></button>}
        </div>
      ) : e.video?.url ? <video className="embed-video-file" src={e.video.url} controls preload="metadata" />
        : e.image?.url ? <button className="embed-image" onClick={() => openMediaViewer([{ url: e.image!.url, filename: "image", content_type: "image/png", width: e.image!.width ?? null, height: e.image!.height ?? null }], 0)}><img src={e.image.url} alt="" loading="lazy" /></button> : null}
      {(e.footer || e.timestamp) && <div className="embed-footer muted small">{e.footer?.icon_url && <img src={e.footer.icon_url} alt="" />}{e.footer?.text}{e.footer && e.timestamp ? " • " : ""}{e.timestamp && fmtTime(e.timestamp)}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------------------- polls -- */
function timeLeft(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Poll closed";
  const h = Math.floor(ms / 3600_000), d = Math.floor(h / 24);
  return d >= 1 ? `${d}d left` : h >= 1 ? `${h}h left` : `${Math.max(1, Math.round(ms / 60000))}m left`;
}

export function PollView({ m, channel }: { m: Message; channel: Channel }) {
  const p = m.poll!;
  const me = useStore((s) => s.me?.id);
  const voted = p.answers.some((a) => a.me);
  const ended = p.finalized || new Date(p.expires_at).getTime() <= Date.now();
  const [pick, setPick] = useState<number[]>([]);
  const [results, setResults] = useState(false);
  const [busy, setBusy] = useState(false);
  const show = ended || voted || results;
  const max = Math.max(1, ...p.answers.map((a) => a.votes));
  const vote = async (ids: number[]) => {
    setBusy(true);
    try { await api.put(`/api/channels/${channel.id}/polls/${m.id}/votes`, { answer_ids: ids }); setPick([]); }
    catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); }
  };
  return (
    <div className="poll" role="group" aria-label={`Poll: ${p.question}`}>
      <div className="poll-q">{p.question}</div>
      <div className="muted small">{p.allow_multiselect ? "Select one or more answers" : "Select one answer"}</div>
      <div className="poll-answers">
        {p.answers.map((a) => {
          const pct = p.total_votes ? Math.round((a.votes / p.total_votes) * 100) : 0;
          const chosen = pick.includes(a.id);
          return show ? (
            <div key={a.id} className={`poll-a result ${a.me ? "me" : ""} ${ended && a.votes === max && a.votes > 0 ? "win" : ""}`}>
              <i style={{ width: `${pct}%` }} aria-hidden />
              <span className="poll-e">{a.emoji}</span><span className="ellipsis">{a.text}</span>
              {a.me && <Check size={14} aria-label="your vote" />}
              <span className="poll-n">{a.votes} · {pct}%</span>
            </div>
          ) : (
            <button key={a.id} className={`poll-a ${chosen ? "chosen" : ""}`} role={p.allow_multiselect ? "checkbox" : "radio"} aria-checked={chosen} disabled={busy}
              onClick={() => setPick((x) => (p.allow_multiselect ? (x.includes(a.id) ? x.filter((y) => y !== a.id) : [...x, a.id]) : [a.id]))}>
              <span className="poll-e">{a.emoji}</span><span className="ellipsis">{a.text}</span><span className={`poll-box ${p.allow_multiselect ? "sq" : ""}`} aria-hidden>{chosen && <Check size={12} />}</span>
            </button>
          );
        })}
      </div>
      <div className="poll-foot">
        <span className="muted small">{p.total_votes} vote{p.total_votes === 1 ? "" : "s"} · {timeLeft(p.expires_at)}</span>
        {!ended && !voted && !results && <button className="link small" onClick={() => setResults(true)}>Show results</button>}
        {!ended && results && !voted && <button className="link small" onClick={() => setResults(false)}>Go back to vote</button>}
        {!ended && voted && <button className="link small" onClick={() => vote([])}>Remove vote</button>}
        {!ended && m.author.id === me && <button className="link small" onClick={() => api.post(`/api/channels/${channel.id}/polls/${m.id}/expire`).catch((e) => toast(errMsg(e), "error"))}>End poll now</button>}
        {!show && <button className="btn primary sm" disabled={!pick.length || busy} onClick={() => vote(pick)}>Vote</button>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- forwards & crossposts -- */
export function Snapshot({ m, mdCtx }: { m: Message; mdCtx: any }) {
  const s = m.snapshot!;
  const origin = channelById(s.origin.channel_id);
  return (
    <div className="fwd">
      <div className="fwd-label muted small"><CornerUpRight size={13} /> Forwarded</div>
      <div className="fwd-body">
        {s.content && <Markdown text={s.content} ctx={mdCtx} />}
        {s.attachments.map((a) => a.content_type.startsWith("image/") ? <img key={a.id} className="fwd-img" src={a.url} alt={a.filename} loading="lazy" /> : <a key={a.id} className="att-file" href={a.url} download={a.filename}>{a.filename}</a>)}
        {s.embeds.map((e, i) => <EmbedView key={i} e={e} />)}
        <button className="fwd-origin muted small" onClick={() => origin && navigate(`/channels/${s.origin.guild_id ?? "@me"}/${s.origin.channel_id}/${s.origin.message_id}`)} disabled={!origin}>
          {s.origin.channel_name ? <><Hash size={12} />{s.origin.channel_name} · </> : null}{fmtTime(s.created_at)}
        </button>
      </div>
    </div>
  );
}

export function SourceTag({ m }: { m: Message }) {
  if (!m.source) return null;
  return <span className="tag server" title={`Published from ${m.source.guild_name} #${m.source.channel_name}`}>SERVER</span>;
}

/* -------------------------------------------------------------------------- thread chip -- */
export function ThreadChip({ m, guildId }: { m: Message; guildId: string | null }) {
  const t = m.thread!;
  const live = useStore((s) => s.threads[t.id]?.thread);
  const count = live?.message_count ?? t.message_count;
  return (
    <button className="thread-chip" onClick={() => navigate(`/channels/${guildId ?? "@me"}/${t.id}`)}>
      <MessageSquare size={16} aria-hidden />
      <strong className="ellipsis">{t.name}</strong>
      <span className="link small">{count} message{count === 1 ? "" : "s"} ›</span>
      {(live?.last_activity_at ?? t.last_activity_at) && <span className="muted small">{fmtTime(live?.last_activity_at ?? t.last_activity_at!)}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------- app messages -- */
export function InteractionLine({ m, guildId }: { m: Message; guildId: string | null }) {
  if (!m.interaction) return null;
  return <div className="ix-line muted small"><Sparkles size={12} aria-hidden /> <strong>{m.interaction.user ? memberName(guildId, m.interaction.user) : "Someone"}</strong> used <span className="cmd-name">/{m.interaction.name}</span></div>;
}

export function Components({ m, channel }: { m: Message; channel: Channel }) {
  const rows = (m.components ?? []).filter((r) => r.type === 1);
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows.length || !m.application_id) return null;
  const fire = async (c: MessageComponent, values?: string[]) => {
    setBusy(c.custom_id ?? "x");
    try { await api.post("/api/interactions", { type: 3, application_id: m.application_id, channel_id: channel.id, data: { custom_id: c.custom_id, values, message_id: m.id } }); }
    catch (e) { toast(errMsg(e), "error"); } finally { setTimeout(() => setBusy(null), 600); }
  };
  return (
    <div className="components">
      {rows.slice(0, 5).map((row, i) => (
        <div key={i} className="comp-row">
          {(row.components ?? []).slice(0, 5).map((c, j) => c.type === 2 ? (
            c.style === 5 && c.url
              ? <a key={j} className="comp-btn s5" href={c.url} target="_blank" rel="noopener noreferrer nofollow">{c.emoji} {c.label}</a>
              : <button key={j} className={`comp-btn s${c.style ?? 2}`} disabled={c.disabled || busy === c.custom_id} onClick={() => fire(c)}>{c.emoji} {c.label}</button>
          ) : c.type === 3 ? (
            <Select key={j} className="comp-select" disabled={c.disabled || !!busy} defaultValue="" onChange={(e) => fire(c, [e.target.value])} aria-label={c.placeholder ?? "Choose"}>
              <option value="" disabled>{c.placeholder ?? "Make a selection"}</option>
              {(c.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.emoji ? `${o.emoji} ` : ""}{o.label}</option>)}
            </Select>
          ) : null)}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- system messages -- */
export function extraSystemText(m: Message, channel: Channel, who: React.ReactNode): React.ReactNode | null {
  let j: any = {};
  try { j = m.content.startsWith("{") ? JSON.parse(m.content) : {}; } catch { /* */ }
  switch (m.type) {
    case MessageType.THREAD_CREATED:
      return <>{who} started a thread: <button className="link" onClick={() => m.thread && navigate(`/channels/${channel.guild_id}/${m.thread.id}`)}><strong>{m.content}</strong></button>. <button className="link" onClick={() => window.dispatchEvent(new CustomEvent("send:panel", { detail: "threads" }))}>See all threads</button>.</>;
    case MessageType.POLL_RESULT:
      return <><BarChart3 size={14} aria-hidden /> {who}'s poll <button className="link" onClick={() => navigate(`/channels/${channel.guild_id ?? "@me"}/${channel.id}/${j.poll_message_id}`)}><strong>{j.question}</strong></button> has closed. {j.winner ? <>The winner is <strong>{j.winner}</strong> with {j.winner_votes} of {j.total_votes} votes.</> : "Nobody voted."}</>;
    case MessageType.AUTOMOD_ACTION:
      return <span className="automod-alert"><ShieldAlert size={14} aria-hidden /> <strong>AutoMod</strong> {j.blocked ? "blocked a message" : "flagged a message"} from {who} in <button className="link" onClick={() => navigate(`/channels/${channel.guild_id}/${j.channel_id}`)}>#{channelById(j.channel_id)?.name ?? "channel"}</button> · rule <strong>{j.rule}</strong> · matched “{j.matched}”<blockquote>{j.content}</blockquote></span>;
    case MessageType.STAGE_START: return <><Radio size={14} aria-hidden /> {who} started the stage <strong>{m.content}</strong>.</>;
    case MessageType.STAGE_END: return <><Radio size={14} aria-hidden /> {who} ended the stage.</>;
    case MessageType.STAGE_SPEAKER: return <>{who} is now a speaker.</>;
    case MessageType.STAGE_TOPIC: return <>{who} changed the stage topic to <strong>{m.content}</strong>.</>;
    case MessageType.BOOST: return <>✨ {who} just boosted the server!</>;
    case MessageType.BOOST_TIER: return <>✨ {who} just boosted the server! It reached <strong>Level {m.content}</strong>!</>;
    case MessageType.CHANNEL_FOLLOW_ADD: return <>{who} added <strong>{m.content}</strong> to this channel. Its most important updates will show up here.</>;
    default: return null;
  }
}

/* ------------------------------------------------------------------------ image grid -- */
/** Two or more images/videos in one message lay out as a grid, like Discord. */
export function useGridClass(m: Message) {
  return useMemo(() => {
    const n = m.attachments.filter((a) => /^(image|video)\//.test(a.content_type)).length;
    return n >= 2 ? `att-grid n${Math.min(n, 10)}` : "";
  }, [m.attachments]);
}
