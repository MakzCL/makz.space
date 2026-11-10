import { useShallow } from "zustand/react/shallow";
import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Gamepad2, Pause, Play, Rocket, X } from "lucide-react";
import type { Application, Channel } from "@syndo/shared";
import { api } from "../api.ts";
import { gwSend } from "../gateway.ts";
import { displayName, onEvent, useStore } from "../store.ts";
import { useVoice } from "../voice/session.ts";
import { Popover } from "../components/overlay.tsx";

/**
 * Activities in voice channels. State is shared peer-to-peer through the gateway
 * (op "activity_event", relayed only to people in the same channel and activity).
 * Built-in: Watch Together (YouTube), Sketch Board, Tic-Tac-Toe, Quick Trivia.
 * Apps can offer their own activity page, shown in a sandboxed frame.
 */

type Builtin = { id: string; name: string; description: string };
let catalog: { builtin: Builtin[]; apps: Application[] } | null = null;

const send = (data: unknown) => gwSend("activity_event", data);
function useActivityEvents(fn: (d: any, from: string) => void) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => onEvent("ACTIVITY_EVENT", (e) => ref.current(e.data, e.from)), []);
}

/** Open the activity picker from anywhere in the call (the bar button, the empty-call card). */
export const openActivityPicker = () => window.dispatchEvent(new Event("syndo:activity-picker"));

export function ActivityButton({ channel, ctl }: { channel: Channel; ctl?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const on = () => setOpen(true); window.addEventListener("syndo:activity-picker", on); return () => window.removeEventListener("syndo:activity-picker", on); }, []);
  const [list, setList] = useState(catalog);
  const btn = useRef<HTMLButtonElement>(null);
  const here = useVoice((v) => v.channelId === channel.id);
  const myAct = useStore((s) => s.voice[s.me?.id ?? ""]?.activity_id ?? null);
  const others = useStore(useShallow((s) => Object.values(s.voice).filter((x) => x.channel_id === channel.id && x.activity_id).map((x) => x.activity_id!)));
  useEffect(() => { if (open && !list) api.get<typeof catalog>("/api/activities").then((c) => { catalog = c; setList(c); }).catch(() => {}); }, [open, list]);
  if (!here) return null;
  const start = (id: string) => { gwSend("activity", { activity_id: id }); setOpen(false); };
  return <>
    <button ref={btn} className={ctl ? `ctl ${myAct ? "on" : ""}` : `icon-btn ${myAct ? "active" : ""}`} aria-label="Activities" title="Activities" aria-expanded={open} onClick={() => setOpen((v) => !v)}><Rocket size={ctl ? 22 : 20} /></button>
    {open && <Popover className="menu activity-menu" place={ctl ? "above" : "below"} label="Activities" anchor={() => btn.current} onClose={() => setOpen(false)}>
      <div className="act-title">Choose an Activity</div>
      {[...new Set(others)].filter((x) => x !== myAct).map((id) => <button key={`join-${id}`} role="menuitem" onClick={() => start(id)}><Gamepad2 size={16} /> Join {nameOf(id)} <small className="tag">LIVE</small></button>)}
      {(list?.builtin ?? []).map((a) => <button key={a.id} role="menuitem" onClick={() => start(a.id)}><Gamepad2 size={16} /><span><strong>{a.name}</strong><small className="muted block">{a.description}</small></span></button>)}
      {(list?.apps ?? []).map((a) => <button key={a.id} role="menuitem" onClick={() => start(`app-${a.id}`)}>{a.icon ? <img src={a.icon} alt="" className="act-ico" /> : <Gamepad2 size={16} />}<span><strong>{a.name}</strong><small className="muted block">{a.description}</small></span></button>)}
      {myAct && <button role="menuitem" className="danger" onClick={() => start(null as any)}><X size={16} /> Leave activity</button>}
    </Popover>}
  </>;
}
const nameOf = (id: string) => catalog?.builtin.find((b) => b.id === id)?.name ?? catalog?.apps.find((a) => `app-${a.id}` === id)?.name ?? "Activity";

export function ActivityHost({ channel }: { channel: Channel }) {
  const act = useStore((s) => s.voice[s.me?.id ?? ""]?.activity_id ?? null);
  const here = useVoice((v) => v.channelId === channel.id);
  if (!here || !act) return null;
  const close = () => gwSend("activity", { activity_id: null });
  return (
    <div className="activity-host" role="region" aria-label={nameOf(act)}>
      <header><Gamepad2 size={16} /> <strong>{nameOf(act)}</strong><Participants channel={channel} act={act} /><button className="icon-btn sm" aria-label="Leave activity" onClick={close}><X size={16} /></button></header>
      <div className="activity-body">
        {act === "watch" ? <WatchTogether /> : act === "sketch" ? <Sketch /> : act === "tictactoe" ? <TicTacToe /> : act === "trivia" ? <Trivia /> : act.startsWith("app-") ? <AppActivity appId={act.slice(4)} /> : <p className="muted pad">Unknown activity.</p>}
      </div>
    </div>
  );
}
function Participants({ channel, act }: { channel: Channel; act: string }) {
  const ids = useStore((s) => Object.values(s.voice).filter((x) => x.channel_id === channel.id && x.activity_id === act).map((x) => x.user_id).join(","));
  const users = useStore((s) => s.users);
  return <span className="muted small grow">{ids.split(",").filter(Boolean).map((id) => displayName(users[id])).join(", ")}</span>;
}

/* ---------------------------------------------------------------------- watch together -- */
declare global { interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void } }
let ytLoading: Promise<void> | null = null;
const loadYT = () => ytLoading ??= new Promise<void>((res) => {
  if (window.YT?.Player) return res();
  window.onYouTubeIframeAPIReady = () => res();
  const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
});
const ytId = (u: string) => /(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/.exec(u)?.[1] ?? (/^[\w-]{11}$/.test(u) ? u : null);

function WatchTogether() {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const applying = useRef(false);
  const [video, setVideo] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const state = () => { const p = player.current; return p?.getCurrentTime ? { type: "state", video, time: p.getCurrentTime(), playing: p.getPlayerState?.() === 1, at: Date.now() } : { type: "state", video, time: 0, playing: false, at: Date.now() }; };
  const apply = (d: any) => {
    if (d.video !== video) setVideo(d.video);
    const p = player.current; if (!p?.seekTo) return;
    applying.current = true;
    const t = d.time + (d.playing ? (Date.now() - d.at) / 1000 : 0);
    if (Math.abs((p.getCurrentTime?.() ?? 0) - t) > 1.5) p.seekTo(t, true);
    if (d.playing) p.playVideo(); else p.pauseVideo();
    setTimeout(() => { applying.current = false; }, 400);
  };
  useActivityEvents((d) => { if (d?.type === "hello") send(state()); else if (d?.type === "state") apply(d); });
  useEffect(() => { send({ type: "hello" }); }, []);
  useEffect(() => {
    if (!video || !host.current) return;
    let dead = false;
    loadYT().then(() => {
      if (dead || !host.current) return;
      player.current?.destroy?.();
      const el = document.createElement("div"); host.current.innerHTML = ""; host.current.appendChild(el);
      player.current = new window.YT.Player(el, { videoId: video, host: "https://www.youtube-nocookie.com", playerVars: { playsinline: 1, rel: 0 },
        events: { onStateChange: () => { if (!applying.current) send(state()); } } });
    });
    return () => { dead = true; };
  }, [video]); // eslint-disable-line react-hooks/exhaustive-deps
  const load = () => { const id = ytId(url.trim()); if (!id) return; setVideo(id); setUrl(""); setTimeout(() => send({ type: "state", video: id, time: 0, playing: true, at: Date.now() }), 50); };
  return <div className="watch">
    <div className="row"><input placeholder="Paste a YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") load(); }} aria-label="YouTube link" /><button className="btn primary sm" onClick={load}>Play</button>
      {video && <><button className="icon-btn sm" aria-label="Play for everyone" onClick={() => player.current?.playVideo()}><Play size={16} /></button><button className="icon-btn sm" aria-label="Pause for everyone" onClick={() => player.current?.pauseVideo()}><Pause size={16} /></button></>}</div>
    {video ? <div ref={host} className="watch-player" /> : <p className="muted pad">Paste a link to start watching together. Everyone in the activity sees the same moment.</p>}
  </div>;
}

/* ----------------------------------------------------------------------------- sketch -- */
type Stroke = { c: string; w: number; p: number[] };
function Sketch() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const cur = useRef<Stroke | null>(null);
  const [color, setColor] = useState("#3D6BFF");
  const [size, setSize] = useState(4);
  const draw = () => {
    const c = canvas.current; if (!c) return;
    const g = c.getContext("2d")!; g.clearRect(0, 0, c.width, c.height); g.lineCap = "round"; g.lineJoin = "round";
    for (const s of [...strokes.current, ...(cur.current ? [cur.current] : [])]) {
      g.strokeStyle = s.c; g.lineWidth = s.w; g.beginPath();
      for (let i = 0; i < s.p.length; i += 2) { const x = s.p[i]! * c.width, y = s.p[i + 1]! * c.height; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
  };
  useActivityEvents((d) => {
    if (d?.type === "hello") send({ type: "all", strokes: strokes.current.slice(-400) });
    else if (d?.type === "all" && !strokes.current.length) { strokes.current = d.strokes ?? []; draw(); }
    else if (d?.type === "stroke") { strokes.current.push(d.s); draw(); }
    else if (d?.type === "clear") { strokes.current = []; draw(); }
  });
  useEffect(() => { send({ type: "hello" }); const c = canvas.current!; const ro = new ResizeObserver(() => { c.width = c.clientWidth; c.height = c.clientHeight; draw(); }); ro.observe(c); return () => ro.disconnect(); }, []); // eslint-disable-line
  const pt = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  return <div className="sketch">
    <div className="row">{["#3D6BFF", "#FF5C5C", "#22CC88", "#FFC93C", "#FFFFFF", "#111111"].map((c) => <button key={c} className={`swatch ${c === color ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} onClick={() => setColor(c)} />)}
      <input type="range" min={2} max={24} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush size" />
      <button className="btn sm" onClick={() => { strokes.current = []; draw(); send({ type: "clear" }); }}><Eraser size={14} /> Clear</button></div>
    <canvas ref={canvas} className="sketch-canvas" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); cur.current = { c: color, w: size, p: pt(e) }; }}
      onPointerMove={(e) => { if (!cur.current) return; cur.current.p.push(...pt(e)); draw(); }}
      onPointerUp={() => { const s = cur.current; cur.current = null; if (s && s.p.length >= 2) { s.p = s.p.map((v) => Math.round(v * 1000) / 1000); strokes.current.push(s); send({ type: "stroke", s }); draw(); } }} />
  </div>;
}

/* ------------------------------------------------------------------------- tic-tac-toe -- */
function TicTacToe() {
  const me = useStore((s) => s.me!.id);
  const [st, setSt] = useState<{ b: (string | null)[]; x: string | null; o: string | null; turn: "x" | "o" }>({ b: Array(9).fill(null), x: null, o: null, turn: "x" });
  const users = useStore((s) => s.users);
  const share = (n: typeof st) => { setSt(n); send({ type: "state", st: n }); };
  useActivityEvents((d) => { if (d?.type === "hello") send({ type: "state", st }); else if (d?.type === "state") setSt(d.st); });
  useEffect(() => { send({ type: "hello" }); }, []);
  const lines = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winner = lines.map((l) => (st.b[l[0]!] && st.b[l[0]!] === st.b[l[1]!] && st.b[l[0]!] === st.b[l[2]!] ? st.b[l[0]!] : null)).find(Boolean) ?? null;
  const full = st.b.every(Boolean);
  const mySide = st.x === me ? "x" : st.o === me ? "o" : null;
  const play = (i: number) => {
    if (winner || st.b[i]) return;
    let n = { ...st, b: [...st.b] };
    if (!mySide) { if (!n.x) n.x = me; else if (!n.o) n.o = me; else return; }
    const side = n.x === me ? "x" : n.o === me ? "o" : null;
    if (side !== n.turn) return;
    n.b[i] = side; n.turn = side === "x" ? "o" : "x";
    share(n);
  };
  const name = (id: string | null) => (id ? displayName(users[id] ?? (id === me ? useStore.getState().me : null)) : "open seat — make a move to join");
  return <div className="ttt">
    <p className="muted small">✕ {name(st.x)} · ◯ {name(st.o)}</p>
    <div className="ttt-board">{st.b.map((c, i) => <button key={i} className={`ttt-c ${c ?? ""}`} onClick={() => play(i)} aria-label={`Square ${i + 1}${c ? `, ${c}` : ""}`}>{c === "x" ? "✕" : c === "o" ? "◯" : ""}</button>)}</div>
    <p>{winner ? `${winner === "x" ? "✕" : "◯"} wins!` : full ? "It's a draw." : `${st.turn === "x" ? "✕" : "◯"} to play`}</p>
    <button className="btn sm" onClick={() => share({ b: Array(9).fill(null), x: st.x, o: st.o, turn: "x" })}>New game</button>
  </div>;
}

/* ------------------------------------------------------------------------------ trivia -- */
const QUESTIONS: [string, string[], number][] = [
  ["Which planet is known as the Red Planet?", ["Venus", "Mars", "Jupiter", "Mercury"], 1],
  ["How many sides does a hexagon have?", ["5", "6", "7", "8"], 1],
  ["What is the largest ocean on Earth?", ["Atlantic", "Indian", "Pacific", "Arctic"], 2],
  ["Which element has the symbol O?", ["Gold", "Oxygen", "Osmium", "Iron"], 1],
  ["In which year did the first human land on the Moon?", ["1965", "1969", "1972", "1959"], 1],
  ["What is the capital of Japan?", ["Kyoto", "Osaka", "Tokyo", "Nagoya"], 2],
  ["How many continents are there?", ["5", "6", "7", "8"], 2],
  ["Which animal is the fastest on land?", ["Lion", "Cheetah", "Horse", "Greyhound"], 1],
  ["What do bees make?", ["Milk", "Honey", "Silk", "Wax only"], 1],
  ["Which instrument has 88 keys?", ["Guitar", "Violin", "Piano", "Flute"], 2],
  ["What is H2O?", ["Salt", "Water", "Hydrogen", "Ozone"], 1],
  ["Which is the longest river in the world?", ["Amazon", "Nile", "Yangtze", "Danube"], 1],
  ["How many minutes are in an hour?", ["30", "60", "90", "100"], 1],
  ["Who painted the Mona Lisa?", ["Van Gogh", "Picasso", "Leonardo da Vinci", "Monet"], 2],
  ["Which gas do plants take in?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], 2],
  ["What is the smallest prime number?", ["0", "1", "2", "3"], 2],
  ["Which country has the maple leaf on its flag?", ["Canada", "USA", "Sweden", "Austria"], 0],
  ["How many legs does a spider have?", ["6", "8", "10", "12"], 1],
  ["What is the hardest natural substance?", ["Gold", "Iron", "Diamond", "Quartz"], 2],
  ["Which language has the most native speakers?", ["English", "Spanish", "Mandarin Chinese", "Hindi"], 2],
];
function Trivia() {
  const me = useStore((s) => s.me!.id);
  const users = useStore((s) => s.users);
  const [st, setSt] = useState<{ q: number; order: number[]; answers: Record<string, number>; scores: Record<string, number>; reveal: boolean }>({ q: -1, order: [], answers: {}, scores: {}, reveal: false });
  const share = (n: typeof st) => { setSt(n); send({ type: "state", st: n }); };
  useActivityEvents((d, from) => {
    if (d?.type === "hello") send({ type: "state", st });
    else if (d?.type === "state") setSt(d.st);
    else if (d?.type === "answer") setSt((s) => (s.answers[from] !== undefined || s.reveal ? s : { ...s, answers: { ...s.answers, [from]: d.a } }));
  });
  useEffect(() => { send({ type: "hello" }); }, []);
  const order = useMemo(() => [...QUESTIONS.keys()].sort(() => Math.random() - 0.5).slice(0, 10), []);
  const q = st.q >= 0 ? QUESTIONS[st.order[st.q]!] : null;
  const next = () => {
    let scores = st.scores;
    if (q && !st.reveal) { scores = { ...scores }; for (const [u, a] of Object.entries(st.answers)) if (a === q[2]) scores[u] = (scores[u] ?? 0) + 1; return share({ ...st, scores, reveal: true }); }
    const o = st.order.length ? st.order : order;
    share({ q: st.q + 1, order: o, answers: {}, scores, reveal: false });
  };
  const answer = (i: number) => { if (st.answers[me] !== undefined || st.reveal) return; setSt((s) => ({ ...s, answers: { ...s.answers, [me]: i } })); send({ type: "answer", a: i }); };
  const done = st.q >= (st.order.length || 10);
  return <div className="trivia">
    {st.q < 0 ? <><p>Ten quick questions. Anyone can press Next.</p><button className="btn primary" onClick={() => share({ q: 0, order, answers: {}, scores: {}, reveal: false })}>Start</button></>
      : done || !q ? <><h3>Final scores</h3>{Object.entries(st.scores).sort((a, b) => b[1] - a[1]).map(([u, n]) => <p key={u}>{displayName(users[u] ?? (u === me ? useStore.getState().me : null))}: {n}</p>)}<button className="btn sm" onClick={() => share({ q: -1, order: [], answers: {}, scores: {}, reveal: false })}>Play again</button></>
      : <>
        <p className="muted small">Question {st.q + 1} of {st.order.length}</p>
        <h3>{q[0]}</h3>
        <div className="trivia-a">{q[1].map((a, i) => <button key={i} className={`btn ${st.answers[me] === i ? "active" : ""} ${st.reveal && i === q[2] ? "primary" : ""}`} onClick={() => answer(i)}>{a}</button>)}</div>
        <p className="muted small">{Object.keys(st.answers).length} answered</p>
        <button className="btn sm" onClick={next}>{st.reveal ? "Next question" : "Reveal answer"}</button>
      </>}
  </div>;
}

/* --------------------------------------------------------------------------- app frames -- */
function AppActivity({ appId }: { appId: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const app = catalog?.apps.find((a) => a.id === appId);
  const me = useStore((s) => s.me!);
  useActivityEvents((d, from) => frame.current?.contentWindow?.postMessage({ source: "send", type: "event", from, data: d }, "*"));
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.source !== "send-activity") return;
      if (e.data.type === "send") send(e.data.data);
      if (e.data.type === "ready") frame.current?.contentWindow?.postMessage({ source: "send", type: "hello", user: { id: me.id, name: displayName(me), avatar: me.avatar } }, "*");
    };
    window.addEventListener("message", on); return () => window.removeEventListener("message", on);
  }, [me]);
  if (!app?.activity_url) return <p className="muted pad">This activity isn't available.</p>;
  return <iframe ref={frame} className="app-activity" src={app.activity_url} title={app.name} sandbox="allow-scripts allow-same-origin allow-pointer-lock allow-forms" allow="autoplay; fullscreen; gamepad" />;
}
