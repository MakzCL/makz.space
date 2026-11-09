import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Clapperboard, Slash, X } from "lucide-react";
import { CommandOptionType, P, type ApplicationCommand, type Channel } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { can, toast, useStore } from "../store.ts";
import { useLayer } from "../layers.ts";
import { openCreateThread, openPollComposer } from "./Threads.tsx";

/**
 * Slash commands in the message box: SEND's own (/shrug, /me, /poll, /gif…) and the commands of
 * apps installed in the server. Typing "/" lists them; Enter runs one.
 */

interface BuiltIn { name: string; description: string; usage?: string; run: (rest: string, ch: Channel) => Promise<string | boolean> | string | boolean; available?: (ch: Channel) => boolean }
const BUILTIN: BuiltIn[] = [
  { name: "shrug", description: "Appends ¯\\_(ツ)_/¯ to your message.", usage: "[message]", run: (r) => `${r} ¯\\_(ツ)_/¯`.trim() },
  { name: "tableflip", description: "Appends (╯°□°)╯︵ ┻━┻ to your message.", usage: "[message]", run: (r) => `${r} (╯°□°)╯︵ ┻━┻`.trim() },
  { name: "unflip", description: "Appends ┬─┬ノ( º _ ºノ) to your message.", usage: "[message]", run: (r) => `${r} ┬─┬ノ( º _ ºノ)`.trim() },
  { name: "lenny", description: "Appends ( ͡° ͜ʖ ͡°) to your message.", usage: "[message]", run: (r) => `${r} ( ͡° ͜ʖ ͡°)`.trim() },
  { name: "me", description: "Displays text with emphasis.", usage: "<message>", run: (r) => (r ? `_${r}_` : true) },
  { name: "spoiler", description: "Marks your message as a spoiler.", usage: "<message>", run: (r) => (r ? `||${r}||` : true) },
  { name: "silent", description: "Sends without notifying anyone.", usage: "<message>", run: (r) => (r ? `@silent ${r}` : true) },
  { name: "poll", description: "Create a poll.", run: (_r, ch) => { openPollComposer(ch); return true; }, available: (ch) => !ch.guild_id || can(ch, P.SEND_POLLS) },
  { name: "gif", description: "Search for a GIF.", usage: "<search>", run: (r) => { window.dispatchEvent(new CustomEvent("syndo:gif", { detail: r })); return true; } },
  { name: "thread", description: "Start a thread in this channel.", usage: "<name>", run: async (r, ch) => {
    if (!r) { openCreateThread(ch); return true; }
    try { const t = await api.post<Channel>(`/api/channels/${ch.id}/threads`, { name: r.slice(0, 100) }); const { putThreads } = await import("../store.ts"); putThreads([t]); (await import("../router.ts")).navigate(`/channels/${ch.guild_id}/${t.id}`); } catch (e) { toast(errMsg(e), "error"); }
    return true;
  }, available: (ch) => !!ch.guild_id && can(ch, P.CREATE_PUBLIC_THREADS) },
  { name: "nick", description: "Change your nickname in this server.", usage: "[new nickname]", run: async (r, ch) => {
    try { await api.patch(`/api/guilds/${ch.guild_id}/members/@me`, { nick: r || null }); toast(r ? `Your nickname is now ${r}.` : "Nickname removed.", "success"); } catch (e) { toast(errMsg(e), "error"); }
    return true;
  }, available: (ch) => !!ch.guild_id },
];

const cache = new Map<string, { at: number; list: ApplicationCommand[] }>();
async function appCommands(guildId: string) {
  const c = cache.get(guildId);
  if (c && Date.now() - c.at < 60_000) return c.list;
  const list = await api.get<ApplicationCommand[]>(`/api/guilds/${guildId}/commands`).catch(() => []);
  cache.set(guildId, { at: Date.now(), list });
  return list;
}

/** "/cmd a:1 b:two words" → options. A single option can be given without its name. */
function parseOptions(cmd: ApplicationCommand, rest: string) {
  const opts = cmd.options.filter((o) => o.type !== CommandOptionType.SUB_COMMAND && o.type !== CommandOptionType.SUB_COMMAND_GROUP);
  const out: { name: string; type: number; value: string | number | boolean }[] = [];
  const keyed = [...rest.matchAll(/(?:^|\s)([-_\p{Ll}\p{N}]{1,32}):/gu)];
  const cast = (o: (typeof opts)[number], v: string) => (o.type === CommandOptionType.INTEGER ? parseInt(v, 10) : o.type === CommandOptionType.NUMBER ? Number(v) : o.type === CommandOptionType.BOOLEAN ? /^(true|yes|1|on)$/i.test(v) : (v.match(/^<[@#]&?!?(\d+)>$/)?.[1] ?? v));
  if (!keyed.length && rest.trim() && opts.length) out.push({ name: opts[0]!.name, type: opts[0]!.type, value: cast(opts[0]!, rest.trim()) });
  keyed.forEach((k, i) => {
    const o = opts.find((x) => x.name === k[1]);
    const from = k.index! + k[0].length, to = keyed[i + 1]?.index ?? rest.length;
    if (o) out.push({ name: o.name, type: o.type, value: cast(o, rest.slice(from, to).trim()) });
  });
  const missing = opts.filter((o) => o.required && !out.some((x) => x.name === o.name));
  return { options: out, missing };
}

export function useSlashCommands(channel: Channel, text: string, setText: (v: string) => void, textarea: RefObject<HTMLTextAreaElement | null>) {
  const id = useId();
  const [apps, setApps] = useState<ApplicationCommand[]>([]);
  const [sel, setSel] = useState(0);
  const [dismissed, setDismissed] = useState("");
  useEffect(() => { if (channel.guild_id) appCommands(channel.guild_id).then(setApps); else setApps([]); }, [channel.guild_id]);
  const m = /^\/([-_\p{Ll}\p{N}]*)$/u.exec(text);
  const active = !!m && dismissed !== text;
  const q = m?.[1]?.toLowerCase() ?? "";
  const options = useMemo(() => {
    if (!active) return [];
    const b = BUILTIN.filter((c) => (c.available?.(channel) ?? true) && c.name.startsWith(q)).map((c) => ({ key: `b:${c.name}`, name: c.name, description: c.description, usage: c.usage ?? "", app: "SEND" }));
    const a = can(channel, P.USE_APPLICATION_COMMANDS) ? apps.filter((c) => c.type === 1 && c.name.startsWith(q)).map((c) => ({ key: `a:${c.id}`, name: c.name, description: c.description, usage: c.options.map((o) => (o.required ? `${o.name}:` : `[${o.name}:]`)).join(" "), app: c.app?.name ?? "App" })) : [];
    return [...a, ...b].slice(0, 25);
  }, [active, q, apps, channel]);
  useEffect(() => { setSel(0); }, [q]);
  const index = Math.min(sel, Math.max(0, options.length - 1));
  const choose = (o: { name: string }) => { const v = `/${o.name} `; setText(v); requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(v.length, v.length); }); };
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!active || !options.length || e.nativeEvent.isComposing) return false;
    if (e.key === "Escape") { e.preventDefault(); setDismissed(text); return true; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setSel((index + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length); return true; }
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") { e.preventDefault(); choose(options[index]!); return true; }
    return false;
  };
  /** Run "/name rest". Returns text to send, true when handled, or false to send as typed. */
  const run = async (content: string): Promise<string | boolean> => {
    const mm = /^\/([-_\p{Ll}\p{N}]{1,32})(?:\s+([\s\S]*))?$/u.exec(content);
    if (!mm) return false;
    const [, name, rest = ""] = mm;
    const app = can(channel, P.USE_APPLICATION_COMMANDS) ? apps.find((c) => c.name === name && c.type === 1) : null;
    if (app) {
      const { options, missing } = parseOptions(app, rest);
      if (missing.length) { toast(`/${name} needs: ${missing.map((o) => `${o.name}:`).join(" ")}`, "error"); return true; }
      try { await api.post("/api/interactions", { type: 2, application_id: app.application_id, channel_id: channel.id, data: { name, type: 1, options } }); }
      catch (e) { toast(errMsg(e), "error"); }
      return true;
    }
    const b = BUILTIN.find((c) => c.name === name && (c.available?.(channel) ?? true));
    if (!b) return false;
    return await b.run(rest.trim(), channel);
  };
  const popup = active && options.length ? (
    <div className="mention-popup cmd-popup" id={id} role="listbox" aria-label="Commands">
      <p className="muted small"><Slash size={12} /> Commands · ↑↓ · Tab to pick · Enter to run</p>
      {options.map((o, i) => (
        <div key={o.key} id={`${id}-${i}`} role="option" aria-selected={i === index} className={`mention-option ${i === index ? "selected" : ""}`} onMouseEnter={() => setSel(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)}>
          <strong>/{o.name}</strong> <span className="muted small">{o.usage}</span><span className="muted small ellipsis grow">{o.description}</span><small className="tag">{o.app}</small>
        </div>
      ))}
    </div>
  ) : null;
  return { popup, onKeyDown, run };
}

/* ------------------------------------------------------------------- extra composer buttons -- */
export function ComposerExtras({ channel, onSendGif }: { channel: Channel; onSendGif: (url: string) => void }) {
  const [gif, setGif] = useState<{ q: string } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { const on = (e: Event) => setGif({ q: String((e as CustomEvent).detail ?? "") }); window.addEventListener("syndo:gif", on); return () => window.removeEventListener("syndo:gif", on); }, []);
  const canPoll = !channel.guild_id || can(channel, P.SEND_POLLS);
  return <>
    <button ref={btn} className={`icon-btn ${gif ? "active" : ""}`} aria-label="GIFs" title="GIFs" aria-expanded={!!gif} onClick={() => setGif((g) => (g ? null : { q: "" }))}><Clapperboard size={20} /></button>
    {canPoll && <button className="icon-btn d-only" aria-label="Create a poll" title="Poll" onClick={() => openPollComposer(channel)}><BarChart3 size={20} /></button>}
    {gif && <GifPicker anchor={btn.current} initial={gif.q} onPick={(u) => { setGif(null); onSendGif(u); }} onClose={() => setGif(null)} />}
  </>;
}

interface Gif { id: string; title: string; url: string; preview: string; gif: string; mp4: string | null; width: number | null; height: number | null }
function GifPicker({ anchor, initial, onPick, onClose }: { anchor: HTMLElement | null; initial: string; onPick: (url: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { anchor: () => anchor });
  const [q, setQ] = useState(initial);
  const [res, setRes] = useState<{ results: Gif[]; next: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fav = useStore((s) => ((s.me?.settings as any)?.favorite_gifs ?? []) as string[]);
  const [tab, setTab] = useState<"search" | "favorites">("search");
  const [pos, setPos] = useState<React.CSSProperties>();
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = anchor.getBoundingClientRect(), w = ref.current.offsetWidth, h = ref.current.offsetHeight, m = 8;
    setPos({ position: "fixed", left: Math.max(m, Math.min(innerWidth - w - m, r.right - w)), top: r.top - h - 8 >= m ? r.top - h - 8 : Math.min(innerHeight - h - m, r.bottom + 8) });
  }, [anchor, res]);
  useEffect(() => {
    if (tab !== "search") return;
    const t = setTimeout(() => api.get<{ results: Gif[]; next: string | null }>(`/api/gifs?q=${encodeURIComponent(q)}`).then((r) => { setRes(r); setError(null); }).catch((e) => setError(errMsg(e))), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, tab]);
  const toggleFav = async (url: string) => {
    const { updateSettings } = await import("../actions.ts");
    updateSettings({ favorite_gifs: fav.includes(url) ? fav.filter((x) => x !== url) : [url, ...fav].slice(0, 100) });
  };
  return createPortal(
    <div ref={ref} className="picker gif-picker" role="dialog" aria-label="GIFs" data-layer style={pos}>
      <div className="picker-h"><input autoFocus placeholder="Search GIFs" value={q} onChange={(e) => { setQ(e.target.value); setTab("search"); }} aria-label="Search GIFs" /><button className="icon-btn sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
      <div className="seg"><button aria-selected={tab === "search"} onClick={() => setTab("search")}>{q ? "Results" : "Trending"}</button><button aria-selected={tab === "favorites"} onClick={() => setTab("favorites")}>Favorites ({fav.length})</button></div>
      <div className="picker-scroll gif-grid">
        {tab === "favorites" ? (fav.length ? fav.map((u) => <GifTile key={u} src={u} onPick={() => onPick(u)} fav onFav={() => toggleFav(u)} />) : <p className="muted small pad">Star a GIF to keep it here.</p>)
          : error ? <p className="muted small pad">{error}</p>
          : !res ? <p className="muted small pad">Loading…</p>
          : res.results.map((g) => <GifTile key={g.id} src={g.preview || g.gif} onPick={() => onPick(g.url || g.gif)} fav={fav.includes(g.url || g.gif)} onFav={() => toggleFav(g.url || g.gif)} />)}
      </div>
    </div>, document.body);
}
function GifTile({ src, onPick, fav, onFav }: { src: string; onPick: () => void; fav: boolean; onFav: () => void }) {
  return <div className="gif-tile"><button onClick={onPick} aria-label="Send GIF"><img src={src} alt="" loading="lazy" /></button><button className={`gif-fav ${fav ? "on" : ""}`} aria-label={fav ? "Remove from favorites" : "Add to favorites"} onClick={onFav}>★</button></div>;
}
