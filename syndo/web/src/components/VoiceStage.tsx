import { MobileNavButton } from "./ui.tsx";
import { Popover } from "./overlay.tsx";
import { Range } from "./Range.tsx";
import { Select } from "./Select.tsx";
import { useShallow } from "zustand/react/shallow";
import { Activity, Camera, CameraOff, Headphones, HeadphoneOff, Maximize, Mic, MicOff, Monitor, MonitorOff, PhoneOff, PictureInPicture2, Pin, RefreshCw, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { STREAM_FPS, STREAM_HEIGHTS, type Channel, type Guild } from "@syndo/shared";
import { setTitle } from "../router.ts";
import { displayName, useStore } from "../store.ts";
import { collect, opusFmtp, type Diagnostics } from "../voice/diagnostics.ts";
import { captureCapabilities } from "../voice/settings.ts";
import { joinVoice, leaveVoice, setDeafened, setMuted, setUserVolume, startScreenShare, stopScreenShare, switchScreenSource, toggleCamera, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { Avatar } from "./ui.tsx";

/** The call surface for guild voice channels and DM calls: tiles, focus/grid layouts, controls, diagnostics. */
export function VoiceStage({ channel, guild }: { channel: Channel; guild: Guild | null }) {
  const v = useVoice();
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me!);
  const states = useStore(useShallow((s) => Object.values(s.voice).filter((x) => x.channel_id === channel.id)));
  const [diag, setDiag] = useState(false);
  const [shareMenu, setShareMenu] = useState(false);
  const here = v.channelId === channel.id;
  useEffect(() => setTitle(`${channel.name ?? "Call"}${guild ? ` · ${guild.name}` : ""}`), [channel, guild]);

  if (!here) return (
    <div className="stage-idle">
    <header className="ch-h m-only"><MobileNavButton /><Volume2 size={22} aria-hidden /><h1 className="ellipsis">{channel.name}</h1></header>
    <div className="stage-empty">
      <h1>{channel.name}</h1>
      <p className="muted">{states.length ? `${states.length} ${states.length === 1 ? "person is" : "people are"} here.` : "No one is here yet."}</p>
      <div className="row">{states.map((s) => <Avatar key={s.user_id} user={users[s.user_id]} size={48} />)}</div>
      <button className="btn primary" onClick={() => joinVoice(channel.id)}>Join voice</button>
    </div>
    </div>
  );

  type Tile = { key: string; uid: string; name: string; track: MediaStreamTrack | null; kind: "camera" | "screen"; speaking: boolean; muted: boolean; local: boolean };
  const tiles: Tile[] = [];
  tiles.push({ key: `${me.id}:camera`, uid: me.id, name: displayName(me), track: v.localCamera, kind: "camera", speaking: v.localSpeaking, muted: v.muted, local: true });
  if (v.localScreen) tiles.push({ key: `${me.id}:screen`, uid: me.id, name: `${displayName(me)} (your screen)`, track: v.localScreen, kind: "screen", speaking: false, muted: true, local: true });
  for (const p of Object.values(v.peers)) {
    tiles.push({ key: `${p.id}:camera`, uid: p.id, name: displayName(users[p.id]) || p.name, track: p.camera, kind: "camera", speaking: p.speaking, muted: p.micMuted, local: false });
    if (p.screen) tiles.push({ key: `${p.id}:screen`, uid: p.id, name: `${displayName(users[p.id]) || p.name}'s screen`, track: p.screen, kind: "screen", speaking: false, muted: !p.screenAudio, local: false });
  }
  // Show cached participants as soon as the gateway announces them, before media negotiation.
  for(const state of states)if(state.user_id!==me.id&&!v.peers[state.user_id])tiles.push({key:`${state.user_id}:camera`,uid:state.user_id,name:displayName(users[state.user_id])||"Connecting…",track:null,kind:"camera",speaking:false,muted:state.self_mute,local:false});
  const focused = v.focus ? tiles.find((t) => t.key === v.focus) : null;
  const caps = captureCapabilities();
  const st = v.settings.stream;

  return (
    <div className="stage" data-region="call">
      <header className="ch-h"><MobileNavButton /><Volume2 size={22} aria-hidden /><h1 className="ellipsis">{channel.name}</h1>
        <span className={`conn-pill cs-${v.status}`} role="status">{{ idle: "Disconnected", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…", error: v.error ?? "Error" }[v.status]}</span>
        <div className="ch-actions">
          <button className={`icon-btn ${v.layout === "grid" ? "active" : ""}`} onClick={() => useVoice.setState({ layout: v.layout === "grid" ? "focus" : "grid", focus: v.layout === "grid" ? (tiles.find((t) => t.kind === "screen")?.key ?? null) : null })} aria-label="Toggle layout">{v.layout === "grid" ? "Grid" : "Focus"}</button>
          <button className={`icon-btn ${diag ? "active" : ""}`} aria-pressed={diag} aria-label="Connection diagnostics" onClick={() => setDiag(!diag)}><Activity size={20} /></button>
        </div>
      </header>
      {v.error && <p className="call-notice" role="status">{v.error}</p>}
      {v.sharing && <div className="sharing-ind big" role="status"><Monitor size={16} /> You are sharing your screen{st.audio ? " with audio" : ""}. <button className="link" onClick={stopScreenShare}>Stop</button></div>}
      <div className={`tiles ${focused ? "focused" : ""}`} data-count={tiles.length}>
        {focused && <VideoTile t={focused} big onFocus={() => useVoice.setState({ focus: null })} />}
        <div className={focused ? "tile-strip" : "tile-grid"}>
          {tiles.filter((t) => t.key !== focused?.key).map((t) => <VideoTile key={t.key} t={t} onFocus={() => useVoice.setState({ focus: t.key, layout: "focus" })} />)}
        </div>
      </div>
      {diag && <DiagPanel />}
      <div className="call-controls" role="toolbar" aria-label="Call controls">
        <button className={`ctl ${v.muted ? "off" : ""}`} aria-pressed={v.muted} onClick={() => setMuted(!v.muted)} aria-label={v.muted ? "Unmute" : "Mute"} disabled={!v.grants?.speak}>{v.muted ? <MicOff /> : <Mic />}</button>
        <button className={`ctl ${v.deafened ? "off" : ""}`} aria-pressed={v.deafened} onClick={() => setDeafened(!v.deafened)} aria-label={v.deafened ? "Undeafen" : "Deafen"}>{v.deafened ? <HeadphoneOff /> : <Headphones />}</button>
        <button className={`ctl ${v.camera ? "on" : ""}`} aria-pressed={v.camera} onClick={toggleCamera} aria-label={v.camera ? "Turn camera off" : "Turn camera on"} disabled={!v.grants?.video}>{v.camera ? <Camera /> : <CameraOff />}</button>
        <div className="ctl-wrap">
          <button className={`ctl ${v.sharing ? "on" : ""}`} aria-pressed={v.sharing} disabled={!v.grants?.video || !caps.canShare} title={caps.canShare ? undefined : "This browser can't share screens."}
            onClick={() => (v.sharing ? stopScreenShare() : setShareMenu(!shareMenu))} aria-label={v.sharing ? "Stop sharing" : "Share screen"}>{v.sharing ? <MonitorOff /> : <Monitor />}</button>
          {v.sharing && <button className="ctl sm" onClick={switchScreenSource} aria-label="Switch shared window"><RefreshCw size={16} /></button>}
          {shareMenu && !v.sharing && (
            <div className="share-menu" role="dialog" aria-label="Screen share quality">
              <h3>Share your screen</h3>
              <label>Resolution <Select value={String(st.height)} onChange={(e) => updateVoiceSettings({ stream: { ...st, height: e.target.value === "source" ? "source" : +e.target.value } })}>{STREAM_HEIGHTS.map((h) => <option key={h} value={h}>{h}p</option>)}<option value="source">Source</option></Select></label>
              <label>Frame rate <Select value={st.fps} onChange={(e) => updateVoiceSettings({ stream: { ...st, fps: +e.target.value as any } })}>{STREAM_FPS.map((f) => <option key={f} value={f}>{f} fps</option>)}</Select></label>
              <label>Optimise for <Select value={st.contentHint} onChange={(e) => updateVoiceSettings({ stream: { ...st, contentHint: e.target.value as any } })}><option value="detail">Text & detail</option><option value="motion">Motion</option></Select></label>
              <label className="row"><input type="checkbox" checked={st.audio} onChange={(e) => updateVoiceSettings({ stream: { ...st, audio: e.target.checked } })} /> Include audio {!caps.tabAudio && <small className="muted">(not supported in this browser)</small>}</label>
              <p className="muted small">Your browser will ask which screen, window or tab to share.</p>
              <button className="btn primary" onClick={() => { setShareMenu(false); startScreenShare(); }}>Go live</button>
            </div>
          )}
        </div>
        <button className="ctl danger" onClick={() => leaveVoice()} aria-label="Leave call"><PhoneOff /></button>
      </div>
    </div>
  );
}

function VideoTile({ t, big, onFocus }: { t: { key: string; uid: string; name: string; track: MediaStreamTrack | null; kind: string; speaking: boolean; muted: boolean; local: boolean }; big?: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const users = useStore((s) => s.users);
  const me = useStore(s => s.me);
  const vol = useVoice((s) => s.settings.userVolumes[t.kind === "screen" ? `${t.uid}:stream` : t.uid] ?? 1);
  const [menu, setMenu] = useState(false);
  const volBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.srcObject = t.track ? new MediaStream([t.track]) : null;
  }, [t.track]);
  const fullscreen = () => ref.current?.parentElement?.requestFullscreen?.();
  const pip = () => (ref.current as any)?.requestPictureInPicture?.().catch(() => {});
  return (
    <figure className={`tile ${t.speaking ? "speaking" : ""} ${big ? "big" : ""} k-${t.kind}`} onDoubleClick={fullscreen}>
      {t.track ? <video ref={ref} autoPlay playsInline muted className={t.local && t.kind === "camera" ? "mirror" : ""} /> : <div className="tile-av"><Avatar user={t.local ? me : users[t.uid]} size={big ? 120 : 72} /></div>}
      <figcaption>{t.muted && t.kind === "camera" && <MicOff size={14} aria-label="muted" />}{t.kind === "screen" && <span className="live">LIVE</span>}<span className="ellipsis">{t.name}</span></figcaption>
      <div className="tile-tools">
        <button className="icon-btn sm" onClick={onFocus} aria-label={big ? "Unfocus" : `Focus ${t.name}`}><Pin size={14} /></button>
        {t.track && <button className="icon-btn sm" onClick={fullscreen} aria-label="Fullscreen"><Maximize size={14} /></button>}
        {t.track && "requestPictureInPicture" in HTMLVideoElement.prototype && <button className="icon-btn sm" onClick={pip} aria-label="Picture in picture"><PictureInPicture2 size={14} /></button>}
        {!t.local && <button ref={volBtn} className="icon-btn sm" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={`Volume for ${t.name}`}><Volume2 size={14} /></button>}
      </div>
      {menu && <Popover className="vol-pop" role="dialog" label={`Volume for ${t.name}`} anchor={() => volBtn.current} onClose={() => setMenu(false)}><label className="small">{t.kind === "screen" ? "Stream volume" : "User volume"} {Math.round(vol * 100)}%<Range min={0} max={2} step={0.05} value={vol} onChange={(e) => setUserVolume(t.kind === "screen" ? `${t.uid}:stream` : t.uid, +e.target.value)} /></label></Popover>}
    </figure>
  );
}

function DiagPanel() {
  const [d, setD] = useState<Diagnostics | null>(null);
  const s = useVoice((v) => v.settings);
  useEffect(() => { let alive = true; const tick = async () => { const r = await collect().catch(() => null); if (alive) setD(r); }; tick(); const t = setInterval(tick, 1000); return () => { alive = false; clearInterval(t); }; }, []);
  const op = d?.audio ? opusFmtp(d.audio.fmtp) : null;
  return (
    <aside className="diag" aria-label="Diagnostics">
      <h3>Diagnostics</h3>
      {!d ? <p className="muted small">Collecting…</p> : (
        <>
          <p className="small">Path: <strong>{d.candidate ?? "…"}</strong></p>
          {d.audio && (
            <table className="caps small"><caption>Your microphone</caption><tbody>
              <tr><td>Codec</td><td>{d.audio.codec} {d.audio.clockRate ? `${d.audio.clockRate / 1000} kHz` : ""}</td></tr>
              <tr><td>Requested</td><td>{d.audio.requestedKbps} kbps · {s.stereo ? "stereo" : "mono"} · DTX {s.dtx ? "on" : "off"}</td></tr>
              <tr><td>Negotiated</td><td>{op ? `${op.stereo ? "stereo" : "mono"} · DTX ${op.dtx ? "on" : "off"} · FEC ${op.fec ? "on" : "off"}${op.maxAvgBitrate ? ` · cap ${Math.round(op.maxAvgBitrate / 1000)} kbps` : ""}` : "—"}</td></tr>
              <tr><td>Measured send</td><td>{d.audio.sendKbps ?? "…"} kbps</td></tr>
              <tr><td>Loss / jitter / RTT</td><td>{d.audio.packetLossPct ?? "—"}% / {d.audio.jitterMs ?? "—"} ms / {d.audio.rttMs ?? "—"} ms</td></tr>
            </tbody></table>
          )}
          {d.screen && (
            <table className="caps small"><caption>Your screen share ({d.screen.codec})</caption><tbody>
              <tr><td>Captured</td><td>{d.screen.capture ? `${d.screen.capture.width}×${d.screen.capture.height} @ ${d.screen.capture.fps} fps` : "—"}</td></tr>
              {d.screen.layers.map((l) => <tr key={l.rid}><td>Layer {l.rid}</td><td>{l.width}×{l.height} @ {l.fps ?? "—"} fps · {l.kbps ?? "…"} kbps{l.limitation && l.limitation !== "none" ? ` · limited by ${l.limitation}` : ""}{!l.active ? " · paused (no viewers)" : ""}</td></tr>)}
            </tbody></table>
          )}
          {d.inbound.length > 0 && (
            <table className="caps small"><caption>Receiving</caption><thead><tr><th>From</th><th>What</th><th>Quality</th><th>Loss</th></tr></thead><tbody>
              {d.inbound.map((i, k) => <tr key={k}><td>{i.identity}</td><td>{i.source} ({i.codec}{i.channels ? `, ${i.channels}ch` : ""})</td><td>{i.kind === "video" ? `${i.width}×${i.height} @ ${i.fps ?? "—"} fps, ` : ""}{i.kbps ?? "…"} kbps{i.dropped ? `, ${i.dropped} dropped` : ""}</td><td>{i.lossPct ?? "—"}% / {i.jitterMs ?? "—"} ms</td></tr>)}
            </tbody></table>
          )}
          <p className="muted small">Requested settings are targets. Opus varies its rate with the sound; congestion control and the other side's capabilities can lower video and audio quality.</p>
        </>
      )}
    </aside>
  );
}
