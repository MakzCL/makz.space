import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ListMusic, Music2, Pause, Play, Plus, SkipForward, Square, Volume2, VolumeX, X } from "lucide-react";
import { api, errMsg } from "../api.ts";
import { toast, useStore, type MusicState, type MusicTrack } from "../store.ts";
import { Range } from "../components/Range.tsx";
import { useVoice } from "./session.ts";

/**
 * SEND Music listener. The server runs the player for each voice room (queue, clock, timers); every client in the
 * room plays the same stream at the server's position. Deafening silences it, the voice output device is used,
 * and the volume is remembered per device.
 */
let el: HTMLAudioElement | null = null;
let loaded: string | null = null;
const VOL_KEY = "send.music.volume";
export const musicVolume = () => { try { const v = Number(localStorage.getItem(VOL_KEY)); return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.6; } catch { return 0.6; } };
export function setMusicVolume(v: number) { try { localStorage.setItem(VOL_KEY, String(v)); } catch { /* */ } if (el) el.volume = v; try { yt?.setVolume(Math.round(v * 100)); } catch { /* */ } }

const expected = (s: MusicState) => (s.position_ms + (s.paused ? 0 : Date.now() - s.received_at)) / 1000;

function audio(): HTMLAudioElement {
  if (el) return el;
  el = new Audio();
  el.preload = "auto";
  el.volume = musicVolume();
  (window as any).__sendMusic = el;
  el.addEventListener("loadedmetadata", () => {
    const s = current(); const t = s?.playing;
    if (s && t && t.id === loaded && t.duration == null && Number.isFinite(el!.duration) && el!.duration > 0)
      api.post(`/api/music/${s.channel_id}/duration`, { track_id: t.id, duration: el!.duration }).catch(() => {});
  });
  el.addEventListener("error", () => {
    const s = current(); const t = s?.playing;
    if (s && t && t.id === loaded) api.post(`/api/music/${s.channel_id}/error`, { track_id: t.id }).catch(() => {});
  });
  return el;
}

function current(): MusicState | null {
  const ch = useVoice.getState().channelId;
  return ch ? useStore.getState().music[ch] ?? null : null;
}

function sync() {
  const s = current();
  const v = useVoice.getState();
  if (!s?.playing || s.playing.kind === "youtube") { if (el) { el.pause(); el.removeAttribute("src"); el.load(); } loaded = null; return; }
  const a = audio();
  const out = v.settings.outputDeviceId;
  if (typeof (a as any).setSinkId === "function") (a as any).setSinkId(out && out !== "default" ? out : "").catch(() => {});
  a.muted = !!v.deafened;
  if (loaded !== s.playing.id) {
    loaded = s.playing.id;
    a.src = s.playing.stream_url;
    const seek = () => { a.currentTime = Math.max(0, expected(current() ?? s)); };
    a.addEventListener("loadedmetadata", seek, { once: true });
  } else if (Math.abs(a.currentTime - expected(s)) > 1.5 && a.readyState >= 1) a.currentTime = Math.max(0, expected(s));
  if (s.paused) a.pause();
  else if (a.paused) a.play().catch(() => { /* blocked until the next click: retried on the next sync */ });
}

/* ---------------------------------------------------------------------- YouTube -- */
/* YouTube tracks play in YouTube's own embedded player (its IFrame API), on each listener's screen, at the server's
   position. YouTube requires the player to stay visible (at least 200 x 200), so it's a small dock you can hide;
   hiding it stops YouTube tracks for you only. Nothing is downloaded from YouTube. */
let yt: any = null;
let ytLoading: Promise<any> | null = null;
function loadYouTube(): Promise<any> {
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  ytLoading ??= new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
    s.onerror = () => { ytLoading = null; reject(new Error("YouTube's player couldn't load.")); };
    document.head.appendChild(s);
  });
  return ytLoading;
}
const HIDE_KEY = "send.music.ytHidden";

/* The call screen's player has a spot for YouTube's player. The player itself is mounted once (here) and is only
   moved over that spot, so going between the call and a chat never reloads the song. */
let slot: HTMLElement | null = null;
const slotSubs = new Set<() => void>();
const setSlot = (el: HTMLElement | null) => { if (slot === el) return; slot = el; slotSubs.forEach((f) => f()); };
function useSlotRect(): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    let raf = 0;
    const read = () => { const r = slot?.getBoundingClientRect() ?? null; setRect((old) => (old && r && old.x === r.x && old.y === r.y && old.width === r.width && old.height === r.height) || (!old && !r) ? old : r); };
    const loop = () => { read(); raf = requestAnimationFrame(loop); };
    loop();
    slotSubs.add(read);
    return () => { cancelAnimationFrame(raf); slotSubs.delete(read); };
  }, []);
  return rect && rect.width > 0 ? rect : null;
}

function YouTubeDock({ s }: { s: MusicState }) {
  const host = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(HIDE_KEY) === "1"; } catch { return false; } });
  const [failed, setFailed] = useState<string | null>(null);
  const deafened = useVoice((v) => v.deafened);
  const t = s.playing!;
  const stateRef = useRef(s); stateRef.current = s;
  const loadedId = useRef<string | null>(null);
  const reported = useRef<string | null>(null);
  const align = () => {
    const p = yt, cur = stateRef.current, tr = cur.playing;
    if (!p?.getPlayerState || !tr?.video_id) return;
    const want = Math.max(0, expected(cur));
    if (loadedId.current !== tr.id) { loadedId.current = tr.id; p.loadVideoById({ videoId: tr.video_id, startSeconds: want }); }
    else if (Math.abs((p.getCurrentTime?.() ?? 0) - want) > 2 && p.getPlayerState() !== 3) p.seekTo(want, true);
    if (cur.paused) { if (p.getPlayerState() === 1) p.pauseVideo(); }
    else if (p.getPlayerState() !== 1 && p.getPlayerState() !== 3) p.playVideo();
    p.setVolume(Math.round(musicVolume() * 100));
    if (useVoice.getState().deafened) p.mute(); else p.unMute();
    const d = p.getDuration?.() ?? 0;
    if (tr.duration == null && d > 0 && reported.current !== tr.id) { reported.current = tr.id; api.post(`/api/music/${cur.channel_id}/duration`, { track_id: tr.id, duration: d }).catch(() => {}); }
  };
  useEffect(() => {
    if (hidden) return;
    let alive = true;
    loadYouTube().then((YT) => {
      if (!alive || !host.current) return;
      const cur = stateRef.current;
      loadedId.current = cur.playing?.id ?? null;
      yt = new YT.Player(host.current, {
        width: "100%", height: "100%", videoId: cur.playing?.video_id ?? undefined,
        playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(expected(cur)) },
        events: {
          onReady: () => { (window as any).__sendYT = yt; align(); },
          onStateChange: () => align(),
          onError: (e: any) => { const c = stateRef.current; if (c.playing) api.post(`/api/music/${c.channel_id}/error`, { track_id: c.playing.id, code: Number(e?.data) || 0 }).catch(() => {}); },
        },
      });
    }).catch((e) => setFailed(errMsg(e)));
    const timer = setInterval(align, 3000);
    return () => { alive = false; clearInterval(timer); try { yt?.destroy(); } catch { /* */ } yt = null; (window as any).__sendYT = null; loadedId.current = null; };
  }, [hidden]);
  useEffect(() => { align(); }, [s, deafened]);
  const setHide = (v: boolean) => { setHidden(v); try { v ? sessionStorage.setItem(HIDE_KEY, "1") : sessionStorage.removeItem(HIDE_KEY); } catch { /* */ } };
  const rect = useSlotRect();
  if (hidden) return <button className="yt-dock-pill" onClick={() => setHide(false)}><Music2 size={14} aria-hidden /> YouTube player hidden. Show it to listen</button>;
  // On the call screen it sits in the player's video spot; elsewhere it's a small window in the corner.
  const docked = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, right: "auto", bottom: "auto" } : undefined;
  return <div className={`yt-dock ${rect ? "in-slot" : ""}`} style={docked} role="region" aria-label="YouTube player">
    <div className="yt-dock-bar"><span className="ellipsis" title={t.title}>{t.title}</span>
      <button className="icon-btn sm" onClick={() => setHide(true)} aria-label="Hide the YouTube player (stops YouTube songs for you)" title="Hide (stops YouTube songs for you)"><X size={14} /></button></div>
    <div className="yt-dock-frame">{failed ? <p className="muted small">{failed}</p> : <div ref={host} />}</div>
  </div>;
}

/** Mounted once at the app root. */
export function MusicListener() {
  const channelId = useVoice((v) => v.channelId);
  const state = useStore((s) => (channelId ? s.music[channelId] : undefined));
  const deafened = useVoice((v) => v.deafened);
  const output = useVoice((v) => v.settings.outputDeviceId);
  useEffect(() => {
    if (!channelId) return;
    // Joining a room: fetch what's playing there (later changes arrive as MUSIC_STATE).
    api.get<MusicState>(`/api/music/${channelId}`).then((d) => useStore.setState((st) => ({ music: { ...st.music, [channelId]: { ...d, received_at: Date.now() } } }))).catch(() => {});
  }, [channelId]);
  useEffect(() => { sync(); }, [channelId, state, deafened, output]);
  useEffect(() => {
    const t = setInterval(sync, 5000);
    const resume = () => { if (el?.paused && current()?.playing && !current()?.paused) sync(); };
    window.addEventListener("pointerdown", resume);
    return () => { clearInterval(t); window.removeEventListener("pointerdown", resume); if (el) el.pause(); };
  }, []);
  return channelId && state?.active && state.playing?.kind === "youtube" && state.playing.video_id ? <YouTubeDock s={state} /> : null;
}

/* ------------------------------------------------------------------------- controls -- */
type Action = "play" | "pause" | "resume" | "skip" | "stop";
/** Same as typing the command in chat: same permissions and DJ rules, and the bot posts what happened. */
export async function musicControl(channelId: string, action: Action, query?: string) {
  try {
    const d = await api.post<MusicState>(`/api/music/${channelId}/control`, { action, ...(query ? { query } : {}) });
    useStore.setState((st) => ({ music: { ...st.music, [channelId]: { ...d, received_at: Date.now() } } }));
    return true;
  } catch (e) { toast(errMsg(e), "error"); return false; }
}

const clock = (sec: number | null) => sec == null || !Number.isFinite(sec) ? "?:??" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Seconds into the current track, ticking while it plays. */
function usePosition(s: MusicState | undefined) {
  const [, tick] = useState(0);
  useEffect(() => { if (!s?.playing || s.paused) return; const t = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(t); }, [s?.playing?.id, s?.paused]);
  if (!s?.playing) return 0;
  const p = expected(s);
  return s.playing.duration ? Math.min(p, s.playing.duration) : p;
}

function AddSong({ channelId, onDone, autoFocus }: { channelId: string; onDone?: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); const v = q.trim(); if (!v || busy) return;
    setBusy(true); const ok = await musicControl(channelId, "play", v); setBusy(false);
    if (ok) { setQ(""); onDone?.(); }
  };
  return <form className="music-add" onSubmit={submit}>
    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Song name, or a YouTube, Spotify or audio link" aria-label="Song name or audio link" maxLength={300} autoFocus={autoFocus} disabled={busy} />
    <button className="btn primary sm" disabled={busy || !q.trim()}>{busy ? "Finding…" : "Play"}</button>
  </form>;
}

const SOURCE_LABEL: Record<string, string> = { youtube: "YouTube", spotify: "Spotify", deezer: "Deezer", apple: "Apple Music", soundcloud: "SoundCloud", tidal: "Tidal", audius: "Audius" };
const origin = (t: MusicTrack) => t.via && SOURCE_LABEL[t.source] && t.source !== "youtube" ? `${SOURCE_LABEL[t.source]} via ${t.via}` : SOURCE_LABEL[t.source] ?? null;
const by = (t: MusicTrack) => [t.artist, origin(t), `asked by ${t.requester.name}`].filter(Boolean).join(" · ");

/** Lyrics for the song playing in the room, when the server has a lyrics provider. */
interface LyricsData { track_id: string; synced: { t: number; text: string }[] | null; plain: string | null; source: string }
function useLyrics(s: MusicState | undefined): LyricsData | null {
  const [data, setData] = useState<LyricsData | null>(null);
  const id = s?.playing?.kind ? s.playing.id : null;
  useEffect(() => {
    setData(null);
    if (!s?.lyrics || !id) return;
    let alive = true;
    api.get<LyricsData | null>(`/api/music/${s.channel_id}/lyrics`).then((d) => { if (alive && d && d.track_id === id) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, [id, s?.lyrics]); // eslint-disable-line
  return data;
}
/** The current and next lines, at the song's position (shown a moment early so they're read in time). */
function linesAt(l: LyricsData | null, posSec: number): { cur: string[]; next: string | null } | null {
  if (!l?.synced?.length) return null;
  const ms = posSec * 1000 + 250;
  let i = -1;
  for (let k = 0; k < l.synced.length; k++) { if (l.synced[k]!.t <= ms) i = k; else break; }
  const at = (k: number) => (k >= 0 && k < l.synced!.length ? l.synced![k]!.text : null);
  const cur = [at(i), at(i + 1)].filter((x): x is string => x != null);
  return { cur: i < 0 ? [at(0) ?? ""].filter(Boolean) : cur, next: at(i + 2) };
}
/** Index of the line being sung (shown a moment early so it's read in time), or -1 before the first line. */
function lineIndex(l: LyricsData | null, posSec: number) {
  if (!l?.synced?.length) return -1;
  const ms = posSec * 1000 + 250;
  let i = -1;
  for (let k = 0; k < l.synced.length; k++) { if (l.synced[k]!.t <= ms) i = k; else break; }
  return i;
}

/** All the song's lines in a column that scrolls up as the song goes; the current line is bright, others fade by distance. */
function LyricsScroller({ lyrics, index }: { lyrics: LyricsData; index: number }) {
  const box = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  const [y, setY] = useState(0);
  useLayoutEffect(() => {
    const b = box.current, l = list.current; if (!b || !l) return;
    const el = l.children[Math.max(0, index)] as HTMLElement | undefined; if (!el) return;
    setY(b.clientHeight * 0.42 - (el.offsetTop + el.offsetHeight / 2));
  }, [index, lyrics]);
  return <div className="ms-scroll" ref={box} aria-live="off">
    <div className="ms-lines" ref={list} style={{ transform: `translateY(${y}px)` }}>
      {lyrics.synced!.map((x, k) => { const d = k - Math.max(0, index); return <p key={k} className={d === 0 && index >= 0 ? "now" : d === 1 ? "soon" : d < 0 ? (d === -1 ? "past" : "gone") : "later"}>{x.text || "♪"}</p>; })}
    </div>
  </div>;
}

/** The song's progress: click or drag anywhere to jump there for everyone (arrow keys move 5 s). */
function SeekBar({ s, pos, dur, can }: { s: MusicState; pos: number; dur: number | null; can: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const seekable = can && !!dur && !!s.playing;
  const at = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (dur ?? 0); };
  const commit = (sec: number) => {
    const t = s.playing; if (!t) return;
    // Move locally straight away; the server's update follows for everyone.
    useStore.setState((st) => ({ music: { ...st.music, [s.channel_id]: { ...s, position_ms: sec * 1000, received_at: Date.now() } } }));
    api.post<MusicState>(`/api/music/${s.channel_id}/seek`, { track_id: t.id, position: sec }).catch((e) => toast(errMsg(e), "error"));
  };
  const shown = drag ?? pos;
  const pct = dur ? Math.min(100, (shown / dur) * 100) : 0;
  return <div className={`ms-progress mc-progress ${seekable ? "seekable" : ""} ${drag != null ? "dragging" : ""}`}>
    <span>{clock(shown)}</span>
    <div ref={bar} className="ms-bar" role={seekable ? "slider" : "progressbar"} tabIndex={seekable ? 0 : -1} aria-label="Track progress"
      aria-valuemin={0} aria-valuemax={Math.round(dur ?? 0)} aria-valuenow={Math.round(shown)} aria-valuetext={`${clock(shown)} of ${clock(dur)}`}
      onPointerDown={(e) => { if (!seekable) return; e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(at(e.clientX)); }}
      onPointerMove={(e) => { if (drag != null) setDrag(at(e.clientX)); }}
      onPointerUp={(e) => { if (drag == null) return; const v = at(e.clientX); setDrag(null); commit(v); }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => { if (!seekable) return; const step = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : 0; if (!step) return; e.preventDefault(); commit(Math.max(0, Math.min((dur ?? 0) - 1, pos + step))); }}>
      <i style={{ width: `${pct}%` }} />
      {seekable && <b className="ms-knob" style={{ left: `${pct}%` }} aria-hidden />}
    </div>
    <span>{clock(dur)}</span>
  </div>;
}

const thumb = (t: MusicTrack | null) => t?.video_id ? `https://i.ytimg.com/vi/${t.video_id}/hqdefault.jpg` : null;

/** The call screen's music player: background art, big synced lyrics, a progress bar and round buttons. */
export function MusicCard({ channelId }: { channelId: string }) {
  const s = useStore((st) => st.music[channelId]);
  const [, tick] = useState(0);
  useEffect(() => { if (!s?.playing || s.paused) return; const t = setInterval(() => tick((x) => x + 1), 250); return () => clearInterval(t); }, [s?.playing?.id, s?.paused]);
  const [vol, setVol] = useState(musicVolume);
  const [queueOpen, setQueueOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const before = useRef(vol || 0.6);
  const lyrics = useLyrics(s);
  const slotRef = useCallback((el: HTMLDivElement | null) => setSlot(el), []);
  useEffect(() => () => setSlot(null), []);
  if (!s?.active) return null;
  const t = s.playing, dur = t?.duration ?? null, can = !!s.controls;
  const pos = t ? Math.max(0, dur ? Math.min(expected(s), dur) : expected(s)) : 0;
  const lines = linesAt(lyrics, pos);
  const li = lineIndex(lyrics, pos);
  const changeVol = (v: number) => { setVol(v); setMusicVolume(v); if (v > 0) before.current = v; };
  const video = t?.kind === "youtube" && t.video_id;
  const art = thumb(t);
  return <section className={`music-card music-stage ${video ? "has-video" : ""}`} aria-label="SEND Music">
    <div className="ms-bg" style={art ? { backgroundImage: `url("${art}")` } : undefined} aria-hidden />
    {video && <div className="ms-video" ref={slotRef} aria-hidden />}
    <div className="ms-main">
      <div className="ms-top mc-text">
        {t ? <><strong className="ellipsis" title={t.title}>{t.page ? <a href={t.page} target="_blank" rel="noreferrer noopener">{t.title}</a> : t.title}</strong>
          <small className="ellipsis">{s.paused ? "Paused · " : ""}{by(t)}</small></>
          : <><strong>SEND Music</strong><small>Nothing playing. Add a song.</small></>}
      </div>
      <div className={`ms-lyrics ${lyrics?.synced?.length ? "scrolling" : ""}`} aria-live="off">
        {lyrics?.synced?.length ? <LyricsScroller lyrics={lyrics} index={li} /> : lines ? <>{lines.cur.map((x, k) => <p key={k} className={k === 0 ? "now" : "soon"}>{x || "♪"}</p>)}{lines.next != null && <p className="later">{lines.next || "♪"}</p>}</>
          : t ? <><p className="now">{t.title}</p>{t.artist && <p className="soon">{t.artist}</p>}{s.lyrics && lyrics?.plain && !lyrics.synced && <p className="later">Lyrics aren't timed for this song</p>}</>
          : <p className="now">Add a song to start</p>}
      </div>
      {t && <SeekBar s={s} pos={pos} dur={dur} can={can} />}
      <div className="ms-buttons">
        {can && <button className={`ms-btn glass ${adding ? "on" : ""}`} onClick={() => { setAdding(!adding); setQueueOpen(false); }} aria-expanded={adding} aria-label="Add a song" title="Add a song"><Plus size={20} strokeWidth={2.4} /></button>}
        <button className={`ms-btn glass ${queueOpen ? "on" : ""}`} onClick={() => { setQueueOpen(!queueOpen); setAdding(false); }} aria-expanded={queueOpen} aria-label="Queue" title="Queue"><ListMusic size={20} strokeWidth={2.2} />{s.queue.length > 0 && <span className="mc-count">{s.queue.length}</span>}</button>
        {t && can && <button className="ms-btn main" onClick={() => void musicControl(channelId, s.paused ? "resume" : "pause")} aria-label={s.paused ? "Resume" : "Pause"} title={s.paused ? "Resume" : "Pause"}>{s.paused ? <Play size={22} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} /> : <Pause size={22} fill="currentColor" strokeWidth={0} />}</button>}
        {t && can && <button className="ms-btn glass" onClick={() => void musicControl(channelId, "skip")} aria-label="Skip" title="Skip"><SkipForward size={20} fill="currentColor" strokeWidth={1.6} /></button>}
        {can && <button className="ms-btn glass stop" onClick={() => void musicControl(channelId, "stop")} aria-label="Stop and disconnect the music bot" title="Stop"><Square size={16} fill="currentColor" strokeWidth={0} /></button>}
      </div>
      {adding && <AddSong channelId={channelId} autoFocus onDone={() => setAdding(false)} />}
      {queueOpen && <div className="mc-queue">
        {s.queue.length ? <ol>{s.queue.slice(0, 50).map((q) => <li key={q.id}><span className="ellipsis">{q.title}</span><small className="muted ellipsis">{by(q)} · {clock(q.duration)}</small></li>)}</ol>
          : <p className="muted small">Nothing queued after this.</p>}
      </div>}
    </div>
    <div className="ms-corner">
      <div className="mc-vol">
        <button className="icon-btn sm" onClick={() => changeVol(vol > 0 ? 0 : before.current)} aria-label={vol > 0 ? "Mute music for me" : "Unmute music"} title={vol > 0 ? "Mute music for me" : "Unmute music"}>{vol > 0 ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <Range min={0} max={1} step={0.02} value={vol} onChange={(e) => changeVol(+e.target.value)} aria-label="Music volume, just for you" />
      </div>
      {lyrics && <small className="ms-credit">Lyrics from {lyrics.source}</small>}
    </div>
  </section>;
}

/** Header button on the call screen: start the music bot when it isn't in the room yet. */
export function MusicButton({ channelId, round }: { channelId: string; round?: boolean }) {
  const active = useStore((st) => !!st.music[channelId]?.active);
  const can = useStore((st) => !!st.music[channelId]?.controls);
  const [open, setOpen] = useState(false);
  if (active || !can) return null;
  return <div className="music-start">
    <button className={round ? `m-round ${open ? "light" : "dark"}` : `icon-btn ${open ? "on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Play music" title="Play music"><Music2 size={20} /></button>
    {open && <div className="music-start-pop" role="dialog" aria-label="Play music">
      <strong>Play music for the room</strong>
      <p className="muted small">Search by name, or paste a YouTube, Spotify, Deezer or Audius link. Playlists and albums work too.</p>
      <AddSong channelId={channelId} autoFocus onDone={() => setOpen(false)} />
    </div>}
  </div>;
}

/** Small now-playing line for the sidebar voice panel. */
export function MusicMini({ channelId }: { channelId: string }) {
  const s = useStore((st) => st.music[channelId]);
  if (!s?.active || !s.playing) return null;
  if (!s.controls) return <div className="music-mini"><Music2 size={14} aria-hidden /><span className="ellipsis" title={s.playing.title}>{s.paused ? "Paused: " : ""}{s.playing.title}</span></div>;
  return <div className="music-mini">
    <Music2 size={14} aria-hidden />
    <span className="ellipsis" title={s.playing.title}>{s.paused ? "Paused: " : ""}{s.playing.title}</span>
    <button className="icon-btn sm" onClick={() => void musicControl(channelId, s.paused ? "resume" : "pause")} aria-label={s.paused ? "Resume music" : "Pause music"}>{s.paused ? <Play size={14} /> : <Pause size={14} />}</button>
    <button className="icon-btn sm" onClick={() => void musicControl(channelId, "skip")} aria-label="Skip song"><SkipForward size={14} /></button>
  </div>;
}
