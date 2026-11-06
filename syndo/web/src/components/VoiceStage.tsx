import { MobileNavButton } from "./ui.tsx";
import { contextMenuKey, tileMenuItems } from "./callMenus.tsx";
import { userMenuItems } from "./menus.tsx";
import { ProfileCard } from "./Dialogs.tsx";
import { Popover, openContextMenu } from "./overlay.tsx";
import { Range } from "./Range.tsx";
import { Select } from "./Select.tsx";
import { useShallow } from "zustand/react/shallow";
import { Activity, Music2, Camera, CameraOff, Headphones, HeadphoneOff, Maximize, Mic, MicOff, Monitor, MonitorOff, PhoneOff, PictureInPicture2, Pin, RefreshCw, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { P, STREAM_FPS, STREAM_HEIGHTS, has, type Channel, type Guild, type SoundboardSound } from "@syndo/shared";
import { playSoundboard, soundsFor } from "../expressions.ts";
import { setTitle } from "../router.ts";
import { can, displayName, guildPerms, useStore } from "../store.ts";
import { collect, opusFmtp, type Diagnostics } from "../voice/diagnostics.ts";
import { captureCapabilities } from "../voice/settings.ts";
import { joinVoice, leaveVoice, setDeafened, setMuted, setUserVolume, startScreenShare, stopScreenShare, switchScreenSource, toggleCamera, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { Avatar } from "./ui.tsx";
import { isPhone } from "../mobile.ts";
import { ChannelGlyph } from "./ChannelGlyph.tsx";

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
    <header className="ch-h m-only"><MobileNavButton /><ChannelGlyph c={channel} size={22} /><h1 className="ellipsis">{channel.name}</h1></header>
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
      <header className="ch-h"><MobileNavButton /><ChannelGlyph c={channel} size={22} /><h1 className="ellipsis">{channel.name}</h1>
        <span className={`conn-pill cs-${v.status}`} role="status">{{ idle: "Disconnected", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…", error: v.error ?? "Error" }[v.status]}</span>
        <div className="ch-actions">
          <button className={`icon-btn ${v.layout === "grid" ? "active" : ""}`} onClick={() => useVoice.setState({ layout: v.layout === "grid" ? "focus" : "grid", focus: v.layout === "grid" ? (tiles.find((t) => t.kind === "screen")?.key ?? null) : null })} aria-label="Toggle layout">{v.layout === "grid" ? "Grid" : "Focus"}</button>
          <button className={`icon-btn ${diag ? "active" : ""}`} aria-pressed={diag} aria-label="Connection diagnostics" onClick={() => setDiag(!diag)}><Activity size={20} /></button>
        </div>
      </header>
      {v.error && <p className="call-notice" role="status">{v.error}</p>}
      {v.sharing && <div className="sharing-ind big" role="status"><Monitor size={16} /> You are sharing your screen{st.audio ? " with audio" : ""}. <button className="link" onClick={stopScreenShare}>Stop</button></div>}
      <div className={`tiles ${focused ? "focused" : ""}`} data-count={tiles.length}>
        {focused && <VideoTile t={focused} guildId={guild?.id ?? null} big onFocus={() => useVoice.setState({ focus: null })} />}
        <div className={focused ? "tile-strip" : "tile-grid"}>
          {tiles.filter((t) => t.key !== focused?.key).map((t) => <VideoTile key={t.key} t={t} guildId={guild?.id ?? null} onFocus={() => useVoice.setState({ focus: t.key, layout: "focus" })} />)}
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
        {guild && guild.sounds !== undefined && <SoundboardButton channel={channel} guild={guild} />}
        <button className="ctl danger" onClick={() => leaveVoice()} aria-label="Leave call"><PhoneOff /></button>
      </div>
    </div>
  );
}

export function VideoTile({ t, big, onFocus, guildId }: { guildId: string | null; t: { key: string; uid: string; name: string; track: MediaStreamTrack | null; kind: string; speaking: boolean; muted: boolean; local: boolean }; big?: boolean; onFocus: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLElement>(null);
  const [profile, setProfile] = useState(false);
  const users = useStore((s) => s.users);
  const me = useStore(s => s.me);
  const vol = useVoice((s) => s.settings.userVolumes[t.kind === "screen" ? `${t.uid}:stream` : t.uid] ?? 1);
  const [menu, setMenu] = useState(false);
  const volBtn = useRef<HTMLButtonElement>(null);
  const tint = useImageTint((t.local ? me : users[t.uid])?.avatar ?? null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.srcObject = t.track ? new MediaStream([t.track]) : null;
  }, [t.track]);
  const fullscreen = () => tileRef.current?.requestFullscreen?.();
  const pip = () => (ref.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })?.requestPictureInPicture?.();
  const context = (e: { clientX?: number; clientY?: number; preventDefault(): void; stopPropagation(): void }) => {
    e.stopPropagation(); setMenu(false);
    const user = t.local ? me : users[t.uid];
    openContextMenu({ clientX: e.clientX, clientY: e.clientY, currentTarget: tileRef.current, preventDefault: () => e.preventDefault() }, tileMenuItems({
      uid: t.uid, screen: t.kind === "screen", local: t.local, focused: !!big, hasVideo: !!t.track,
      onFocus, onFullscreen: fullscreen,
      onPip: ref.current && "requestPictureInPicture" in ref.current && document.pictureInPictureEnabled ? pip : undefined,
      onProfile: user ? () => setProfile(true) : undefined,
      participantItems: user ? userMenuItems(user, { guildId, onProfile: () => setProfile(true) }) : [],
    }));
  };
  return (
    <figure ref={tileRef} tabIndex={0} aria-label={t.name} aria-haspopup="menu" className={`tile ${t.speaking ? "speaking" : ""} ${big ? "big" : ""} k-${t.kind}`} style={tint ? ({ "--tile-bg": tint } as React.CSSProperties) : undefined}
      onContextMenu={context} onKeyDown={e => { if (e.target === e.currentTarget) contextMenuKey(e, () => context(e)); }} onDoubleClick={() => { void fullscreen()?.catch(() => {}); }}>
      {t.track ? <video ref={ref} autoPlay playsInline muted className={t.local && t.kind === "camera" ? "mirror" : ""} /> : <div className="tile-av"><Avatar user={t.local ? me : users[t.uid]} size={big ? 120 : isPhone() ? 104 : 72} /></div>}
      <figcaption>{t.muted && t.kind === "camera" && <MicOff size={14} aria-label="muted" />}{t.kind === "screen" && <span className="live">LIVE</span>}<span className="ellipsis">{t.name}</span></figcaption>
      <div className="tile-tools">
        <button className="icon-btn sm" onClick={onFocus} aria-label={big ? "Unfocus" : `Focus ${t.name}`}><Pin size={14} /></button>
        {t.track && <button className="icon-btn sm" onClick={() => { void fullscreen()?.catch(() => {}); }} aria-label="Fullscreen"><Maximize size={14} /></button>}
        {t.track && "requestPictureInPicture" in HTMLVideoElement.prototype && <button className="icon-btn sm" onClick={() => { void pip()?.catch(() => {}); }} aria-label="Picture in picture"><PictureInPicture2 size={14} /></button>}
        {!t.local && <button ref={volBtn} className="icon-btn sm" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label={`Volume for ${t.name}`}><Volume2 size={14} /></button>}
      </div>
      {profile && tileRef.current && <ProfileCard userId={t.uid} guildId={guildId} anchor={tileRef.current} onClose={() => setProfile(false)} />}
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

/** Soundboard: this server's sounds first, then sounds from my other servers. Played to everyone in the channel. */
function SoundboardButton({ channel, guild }: { channel: Channel; guild: Guild }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const v = useVoice(useShallow((s) => ({ volume: s.settings.soundboardVolume ?? .7, muted: !!s.settings.soundboardMuted })));
  useStore((s) => Object.values(s.guilds).map((g) => g.sounds?.length ?? 0).join(",")); // re-render when sounds change
  const allowed = can(channel, P.USE_SOUNDBOARD) && can(channel, P.SPEAK);
  const { here, others } = soundsFor(guild.id);
  const external = can(channel, P.USE_EXTERNAL_EMOJIS);
  const tile = (s: SoundboardSound) => <button key={s.id} className="sb-play" onClick={() => playSoundboard(channel.id, s)} title={`${s.name} · ${(s.duration_ms / 1000).toFixed(1)} s`}><span className="sb-emoji" aria-hidden>{s.emoji || "🔊"}</span><span className="ellipsis">{s.name}</span></button>;
  return <div className="ctl-wrap">
    <button ref={btn} className={`ctl ${open ? "on" : ""}`} aria-expanded={open} aria-haspopup="dialog" aria-label="Soundboard" title={allowed ? "Soundboard" : "You can't use the soundboard here"} disabled={!allowed} onClick={() => setOpen((o) => !o)}><Music2 /></button>
    {open && <Popover className="sb-panel" role="dialog" label="Soundboard" anchor={() => btn.current} onClose={() => setOpen(false)}>
      <div className="sb-head"><strong>Soundboard</strong><label className="row small muted"><Volume2 size={14} aria-hidden /><Range aria-label="Soundboard volume for me" min={0} max={1} step={0.05} value={v.muted ? 0 : v.volume} onChange={(e) => updateVoiceSettings({ soundboardVolume: +e.target.value, soundboardMuted: +e.target.value === 0 })} /></label></div>
      {here.length ? <><h4 className="picker-sec">{guild.name}</h4><div className="sb-grid compact">{here.map(tile)}</div></> : <p className="muted small">This server has no sounds yet.{has(guildPerms(guild), P.MANAGE_EXPRESSIONS) ? " Add some in Server settings → Soundboard." : ""}</p>}
      {external && others.map((g) => <div key={g.guildId}><h4 className="picker-sec">{g.guildName}</h4><div className="sb-grid compact">{g.sounds.map(tile)}</div></div>)}
      <p className="muted small">Everyone in the call hears it (unless they've deafened or turned the soundboard down).</p>
    </Popover>}
  </div>;
}

/** The average colour of a picture (for call cards, like Discord's tinted tiles). Null until known. */
function useImageTint(url: string | null) {
  const [tint, setTint] = useState<string | null>(null);
  useEffect(() => {
    if (!url) { setTint(null); return; }
    let alive = true;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas"); c.width = c.height = 16;
        const g = c.getContext("2d", { willReadFrequently: true })!; g.drawImage(img, 0, 0, 16, 16);
        const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gr = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3]! < 128) continue; r += d[i]!; gr += d[i + 1]!; b += d[i + 2]!; n++; }
        if (alive && n) setTint(`rgb(${Math.round(r / n)} ${Math.round(gr / n)} ${Math.round(b / n)})`);
      } catch { /* cross-origin or unsupported: keep the default card */ }
    };
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return tint;
}
