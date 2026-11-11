import { askConfirm, askText } from "./components/overlay.tsx";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { channelById, memberName, useStore } from "./store.ts";
import { emojiUrl } from "@syndo/shared";
import { ThirdPartyEmote } from "./features/Emotes.tsx";

/**
 * Message markdown → React elements. Never produces HTML strings, so message
 * content can't inject markup. Supports: **bold**, *italic*, _italic_,
 * __underline__, ~~strike~~, `code`, ```fenced code``` with highlighting,
 * ||spoilers||, > quotes, - / 1. lists, # headings, -# subtext, links (http/https only),
 * <@user>, <@&role>, <#channel>, @everyone, @here, <:custom:emoji>.
 */
export interface MdCtx { guildId: string | null; onMention?: (userId: string, el: HTMLElement) => void; onChannel?: (id: string) => void; mentionMe?: (id: string) => boolean }

/** Only emoji (custom or unicode, up to 30) → shown large, like Discord's "jumbo" emoji. */
const ONLY_EMOJI = /^(?:\s*(?:<a?:[A-Za-z0-9_]{2,32}:\d{1,20}>|<(?:7tv|bttv):[A-Za-z0-9_]{2,32}:[A-Za-z0-9]{24,26}>|\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}))+\s*$/u;
export function Markdown({ text, ctx }: { text: string; ctx: MdCtx }) {
  const jumbo = text.length < 900 && ONLY_EMOJI.test(text) && (text.match(/<a?:|<(?:7tv|bttv):|\p{Extended_Pictographic}|\p{Regional_Indicator}{2}/gu)?.length ?? 0) <= 30;
  return jumbo ? <span className="md-jumbo">{blocks(text, ctx)}</span> : <>{blocks(text, ctx)}</>;
}

/** A server's custom emoji, from any server (served by id). Falls back to :name: if it was deleted. */
export function CustomEmoji({ id, name, size }: { id: string; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <span className="md-emoji-missing" title={`:${name}:`}>:{name}:</span>;
  return <img className="md-emoji" src={emojiUrl(id)} alt={`:${name}:`} title={`:${name}:`} draggable={false} loading="lazy" style={size ? { width: size, height: size } : undefined} onError={() => setBroken(true)} />;
}

function blocks(text: string, ctx: MdCtx): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0, k = 0;
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(<span key={k++} className="md-p">{inlineLines(para, ctx)}</span>); para = []; } };
  while (i < lines.length) {
    const line = lines[i]!;
    const fence = line.match(/^```([\w+#-]*)\s*$/) ?? (line.startsWith("```") && !line.slice(3).includes("```") ? [line, ""] : null);
    if (fence) {
      flush();
      const lang = fence[1] ?? "";
      const body: string[] = [];
      const firstRest = line.match(/^```[\w+#-]*\s*$/) ? null : line.slice(3);
      if (firstRest) body.push(firstRest);
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      out.push(<CodeBlock key={k++} lang={lang} code={body.join("\n")} />);
      continue;
    }
    const inlineFence = line.match(/^```([\s\S]+)```$/);
    if (inlineFence) { flush(); out.push(<CodeBlock key={k++} lang="" code={inlineFence[1]!} />); i++; continue; }
    if (/^>>> /.test(line)) { flush(); out.push(<blockquote key={k++}>{blocks([line.slice(4), ...lines.slice(i + 1)].join("\n"), ctx)}</blockquote>); break; }
    if (/^> /.test(line) || line === ">") {
      flush();
      const q: string[] = [];
      while (i < lines.length && (/^> /.test(lines[i]!) || lines[i] === ">")) q.push(lines[i++]!.replace(/^> ?/, ""));
      out.push(<blockquote key={k++}>{blocks(q.join("\n"), ctx)}</blockquote>);
      continue;
    }
    const h = line.match(/^(#{1,3}) (.+)$/);
    if (h) { flush(); const Tag = (["h3", "h4", "h5"] as const)[h[1]!.length - 1]!; out.push(<Tag key={k++} className={`md-h md-h${h[1]!.length}`}>{inline(h[2]!, ctx)}</Tag>); i++; continue; }
    const sub = line.match(/^-# (.+)$/);
    if (sub) { flush(); out.push(<small key={k++} className="md-sub">{inline(sub[1]!, ctx)}</small>); i++; continue; }
    if (/^\s*([-*]|\d{1,3}\.) /.test(line)) {
      flush();
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      // A bulleted list followed by a numbered one (or the reverse) is two lists.
      while (i < lines.length && /^\s*([-*]|\d{1,3}\.) /.test(lines[i]!) && /^\s*\d/.test(lines[i]!) === ordered) items.push(lines[i++]!.replace(/^\s*([-*]|\d{1,3}\.) /, ""));
      const L = ordered ? "ol" : "ul";
      out.push(<L key={k++}>{items.map((it, j) => <li key={j}>{inline(it, ctx)}</li>)}</L>);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

function inlineLines(lines: string[], ctx: MdCtx) {
  return lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{inline(l, ctx)}</Fragment>);
}

const RULES: { re: RegExp; render: (m: RegExpExecArray, ctx: MdCtx, key: number) => ReactNode }[] = [
  { re: /^`([^`]+)`/, render: (m, _c, k) => <code key={k} className="md-code">{m[1]}</code> },
  { re: /^\|\|([\s\S]+?)\|\|/, render: (m, c, k) => <Spoiler key={k}>{inline(m[1]!, c)}</Spoiler> },
  { re: /^\*\*\*([\s\S]+?)\*\*\*/, render: (m, c, k) => <strong key={k}><em>{inline(m[1]!, c)}</em></strong> },
  { re: /^\*\*([\s\S]+?)\*\*/, render: (m, c, k) => <strong key={k}>{inline(m[1]!, c)}</strong> },
  { re: /^__([\s\S]+?)__/, render: (m, c, k) => <u key={k}>{inline(m[1]!, c)}</u> },
  { re: /^~~([\s\S]+?)~~/, render: (m, c, k) => <s key={k}>{inline(m[1]!, c)}</s> },
  { re: /^\*(?!\s)([\s\S]+?)\*/, render: (m, c, k) => <em key={k}>{inline(m[1]!, c)}</em> },
  { re: /^_(?!\s)([\s\S]+?)_(?![a-zA-Z0-9])/, render: (m, c, k) => <em key={k}>{inline(m[1]!, c)}</em> },
  { re: /^<@!?(\d{1,20})>/, render: (m, c, k) => <UserMention key={k} id={m[1]!} ctx={c} /> },
  { re: /^<@&(\d{1,20})>/, render: (m, c, k) => <RoleMention key={k} id={m[1]!} ctx={c} /> },
  { re: /^<#(\d{1,20})>/, render: (m, c, k) => <ChannelMention key={k} id={m[1]!} ctx={c} /> },
  { re: /^<t:(-?\d{1,13})(?::([tTdDfFR]))?>/, render: (m, _c, k) => <Timestamp key={k} unix={Number(m[1])} style={(m[2] ?? "f") as any} /> },
  { re: /^<a?:([a-zA-Z0-9_]{2,32}):(\d{1,20})>/, render: (m, _c, k) => <CustomEmoji key={k} id={m[2]!} name={m[1]!} /> },
  { re: /^<(7tv|bttv):([A-Za-z0-9_]{2,32}):([A-Za-z0-9]{24,26})>/, render: (m, _c, k) => <ThirdPartyEmote key={k} provider={m[1]!} name={m[2]!} id={m[3]!} /> },
  { re: /^@(everyone|here)\b/, render: (m, _c, k) => <span key={k} className="mention">@{m[1]}</span> },
  { re: /^<(https?:\/\/[^\s>]+)>/, render: (m, _c, k) => <SafeLink key={k} href={m[1]!} /> },
  { re: /^\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)/, render: (m, _c, k) => <SafeLink key={k} href={m[2]!} label={m[1]!} /> },
  { re: /^https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/, render: (m, _c, k) => <SafeLink key={k} href={m[0]} /> },
  { re: /^\\([*_~`|\\<>#-])/, render: (m, _c, k) => <Fragment key={k}>{m[1]}</Fragment> },
];
const SPECIAL = /[`|*_~<@h\\[]/;

function inline(text: string, ctx: MdCtx): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "", k = 0, i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (SPECIAL.test(ch)) {
      const rest = text.slice(i);
      let hit = false;
      for (const r of RULES) {
        const m = r.re.exec(rest);
        if (m) {
          if (buf) { out.push(buf); buf = ""; }
          out.push(r.render(m as RegExpExecArray, ctx, k++));
          i += m[0].length; hit = true; break;
        }
      }
      if (hit) continue;
    }
    buf += ch; i++;
  }
  if (buf) out.push(buf);
  return out;
}

/** <t:unix:style> — shown in each reader's own time zone and language (Discord's timestamp format). */
export function fmtStamp(unix: number, style: "t" | "T" | "d" | "D" | "f" | "F" | "R") {
  const d = new Date(unix * 1000);
  if (Number.isNaN(d.getTime())) return "Invalid date";
  if (style === "R") {
    const diff = (d.getTime() - Date.now()) / 1000, a = Math.abs(diff);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const [v, u] = a < 60 ? [diff, "second"] : a < 3600 ? [diff / 60, "minute"] : a < 86400 ? [diff / 3600, "hour"] : a < 2592000 ? [diff / 86400, "day"] : a < 31536000 ? [diff / 2592000, "month"] : [diff / 31536000, "year"];
    return rtf.format(Math.round(v), u as Intl.RelativeTimeFormatUnit);
  }
  const o: Record<string, Intl.DateTimeFormatOptions> = {
    t: { hour: "numeric", minute: "2-digit" }, T: { hour: "numeric", minute: "2-digit", second: "2-digit" }, d: { day: "2-digit", month: "2-digit", year: "numeric" },
    D: { day: "numeric", month: "long", year: "numeric" }, f: { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" },
    F: { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" },
  };
  return d.toLocaleString(undefined, o[style]);
}
function Timestamp({ unix, style }: { unix: number; style: "t" | "T" | "d" | "D" | "f" | "F" | "R" }) {
  const [, tick] = useState(0);
  useEffect(() => { if (style !== "R") return; const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, [style]);
  return <time className="md-time" dateTime={new Date(unix * 1000).toISOString()} title={fmtStamp(unix, "F")}>{fmtStamp(unix, style)}</time>;
}

function SafeLink({ href, label }: { href: string; label?: string }) {
  let ok = false;
  try { const u = new URL(href); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { /* */ }
  if (!ok) return <>{label ?? href}</>;
  const masked = label && label !== href;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc"
      onClick={(e) => { if (!masked) return; e.preventDefault(); askConfirm({ title: "Leaving SEND", body: `This link goes to:\n${href}\n\nOpen it?`, confirmLabel: "Visit site" }).then((ok) => { if (ok) window.open(href, "_blank", "noopener,noreferrer"); }); }}
      title={href}>{label ?? href}</a>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`spoiler ${open ? "open" : ""}`} role="button" tabIndex={0} aria-label={open ? undefined : "Spoiler, press to reveal"}
      onClick={() => setOpen(true)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setOpen(true)}>
      <span aria-hidden={!open}>{children}</span>
    </span>
  );
}

function UserMention({ id, ctx }: { id: string; ctx: MdCtx }) {
  const u = useStore((s) => s.users[id]);
  const me = useStore((s) => s.me?.id === id);
  return (
    <span className={`mention ${me ? "me" : ""}`} role="button" tabIndex={0}
      onClick={(e) => ctx.onMention?.(id, e.currentTarget)} onKeyDown={(e) => e.key === "Enter" && ctx.onMention?.(id, e.currentTarget)}>
      @{u ? memberName(ctx.guildId, u) : "unknown-user"}
    </span>
  );
}
function RoleMention({ id, ctx }: { id: string; ctx: MdCtx }) {
  const role = useStore((s) => (ctx.guildId ? s.guilds[ctx.guildId]?.roles.find((r) => r.id === id) : undefined));
  if (!role) return <span className="mention">@deleted-role</span>;
  return <span className="mention" style={role.color ? { color: role.color, background: role.color + "22" } : undefined}>@{role.name}</span>;
}
function ChannelMention({ id, ctx }: { id: string; ctx: MdCtx }) {
  const ch = channelById(id);
  if (!ch) return <span className="mention">#unknown</span>;
  return <span className="mention" role="link" tabIndex={0} onClick={() => ctx.onChannel?.(id)} onKeyDown={(e) => e.key === "Enter" && ctx.onChannel?.(id)}>#{ch.name}</span>;
}

/* --------------------------------------------------- syntax highlighting -- */
const KW: Record<string, string> = {
  js: "const let var function return if else for while do switch case break continue new class extends import from export default async await try catch finally throw typeof instanceof in of null undefined true false this yield",
  py: "def return if elif else for while in not and or import from as class try except finally raise with lambda None True False pass break continue yield global nonlocal async await is",
  rs: "fn let mut pub struct enum impl trait use mod match if else for while loop return self Self true false const static as where async await move ref",
  go: "func package import var const type struct interface map chan go defer return if else for range switch case break continue nil true false",
  sql: "select from where insert into values update set delete create table index join left right inner outer on group by order having limit offset as and or not null is in like returning with distinct union primary key references",
  sh: "if then else fi for do done while case esac function return export local echo in",
  c: "int char float double void return if else for while do switch case break continue struct typedef enum static const unsigned signed sizeof include define null true false class public private protected new delete namespace using template",
  css: "",
  json: "true false null",
};
const ALIAS: Record<string, string> = { javascript: "js", ts: "js", typescript: "js", tsx: "js", jsx: "js", python: "py", rust: "rs", golang: "go", bash: "sh", shell: "sh", zsh: "sh", cpp: "c", "c++": "c", java: "c", cs: "c", csharp: "c", postgres: "sql", scss: "css" };

function highlight(code: string, langIn: string): ReactNode[] {
  const lang = ALIAS[langIn.toLowerCase()] ?? langIn.toLowerCase();
  const kw = new Set((KW[lang] ?? "").split(" ").filter(Boolean));
  if (!KW[lang] && lang !== "css") return [code];
  const comment = lang === "py" || lang === "sh" ? /^#[^\n]*/ : lang === "sql" ? /^--[^\n]*/ : /^(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/;
  const out: ReactNode[] = [];
  let i = 0, k = 0, buf = "";
  const push = (cls: string, s: string) => { if (buf) { out.push(buf); buf = ""; } out.push(<span key={k++} className={`hl-${cls}`}>{s}</span>); };
  while (i < code.length) {
    const rest = code.slice(i);
    let m: RegExpExecArray | null;
    if ((m = comment.exec(rest))) { push("c", m[0]); i += m[0].length; continue; }
    if ((m = /^("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)/.exec(rest))) { push("s", m[0]); i += m[0].length; continue; }
    if ((m = /^\b\d[\d_.xXa-fA-F]*\b/.exec(rest))) { push("n", m[0]); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      const w = m[0];
      if (kw.has(lang === "sql" ? w.toLowerCase() : w)) push("k", w);
      else if (/^\s*\(/.test(code.slice(i + w.length))) push("f", w);
      else buf += w;
      i += w.length; continue;
    }
    buf += code[i++];
  }
  if (buf) out.push(buf);
  return out;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-pre">
      <button className="md-copy" onClick={() => { navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
        {copied ? "Copied" : "Copy"}
      </button>
      <pre><code aria-label={lang ? `${lang} code` : "code"}>{highlight(code, lang)}</code></pre>
    </div>
  );
}

/** Plain-text preview for notifications and reply snippets. */
export function plainText(s: string) {
  const st = useStore.getState();
  return s
    .replace(/<@!?(\d+)>/g, (_, id) => `@${st.users[id]?.display_name ?? st.users[id]?.username ?? "user"}`)
    .replace(/<t:(-?\d{1,13})(?::([tTdDfFR]))?>/g, (_, u, st) => fmtStamp(Number(u), (st ?? "f") as any))
    .replace(/<#(\d+)>/g, (_, id) => `#${channelById(id)?.name ?? "channel"}`)
    .replace(/<a?:([A-Za-z0-9_]{2,32}):\d{1,20}>/g, ":$1:")
    .replace(/<(?:7tv|bttv):([A-Za-z0-9_]{2,32}):[A-Za-z0-9]{24,26}>/g, ":$1:")
    .replace(/\|\|[\s\S]*?\|\|/g, "▒▒▒▒")
    .replace(/[*_~`]/g, "");
}
