import { MobileNavButton } from "./ui.tsx";
import { contextMenuKey, tileMenuItems } from "./callMenus.tsx";
import { userMenuItems } from "./menus.tsx";
import { ProfileCard } from "./Dialogs.tsx";
import { Popover, openContextMenu } from "./overlay.tsx";
import { Range } from "./Range.tsx";
import { useShallow } from "zustand/react/shallow";
import { Activity, Music2, Camera, CameraOff, Headphones, HeadphoneOff, Maximize, Mic, MicOff, Monitor, MonitorOff, PhoneOff, PictureInPicture2, Pin, RefreshCw, Volume2, VolumeX, EyeOff, ExternalLink, UserPlus, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { P, has, type Channel, type Guild, type SoundboardSound } from "@send/shared";
import { playSoundboard, soundsFor } from "../expressions.ts";
import { setTitle } from "../router.ts";
import { can, displayName, guildPerms, useStore } from "../store.ts";
import { openDialog } from "./Shell.tsx";
import { collect, opusFmtp, type Diagnostics } from "../voice/diagnostics.ts";
import { captureCapabilities } from "../voice/settings.ts";
import { ShareDialog } from "./ShareDialog.tsx";
import { closeCallPopout, openCallPopout, usePopout } from "../features/CallPopout.tsx";
import { setTileOrder, sortTiles, useTileDrag, useTileOrder } from "../features/callLayout.ts";
import { nativeCapture } from "../voice/nativeCapture.ts";
import { joinVoice, leaveVoice, setDeafened, setMuted, setUserVolume, setWatching, startScreenShare, stopScreenShare, switchScreenSource, toggleCamera, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { Avatar } from "./ui.tsx";
import { isPhone } from "../mobile.ts";
import { ChannelGlyph } from "./ChannelGlyph.tsx";
import { StageView } from "../features/Stage.tsx";
import { ActivityButton, ActivityHost } from "../features/Activities.tsx";
import { VoiceStatusEditor } from "../features/VoiceExtras.tsx";
import { ChannelType } from "@send/shared";
import { CameraGroup, ChatToggle, InviteCard, MessagePreviews, MicGroup, MoreButton } from "../features/CallControls.tsx";
import { CallChat } from "./ChannelView.tsx";

/** The call surface for guild voice channels and DM calls: tiles, focus/grid layouts, controls, diagnostics. */
export function VoiceStage({ channel, guild }: { channel: Channel; guild: Guild | null }) {
  const v = useVoice();
  const [gridRef, gridStyle] = useBestGrid();
  // A stream that ended has to be chosen again when it comes back (Discord resets "watching" too).
  const streamers = Object.values(v.peers).filter((p) => p.screen).map((p) => p.id).join(",");
  useEffect(() => { const live = new Set(streamers.split(",")); const keep = v.watching.filter((u) => live.has(u)); if (keep.length !== v.watching.length) useVoice.setState({ watching: keep }); }, [streamers]); // eslint-disable-line
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me!);
  const states = useStore(useShallow((s) => Object.values(s.voice).filter((x) => x.channel_id === channel.id)));
  const [diag, setDiag] = useState(false);
  const tileKeysRef = useRef<string[]>([]);
  const [shareMenu, setShareMenu] = useState(false);
  // The call chat stays open or closed the way you left it.
  const [chat, setChatRaw] = useState(() => { try { return localStorage.getItem("send.callChat") === "1"; } catch { return false; } });
  const setChat = (on: boolean) => { setChatRaw(on); try { localStorage.setItem("send.callChat", on ? "1" : "0"); } catch { /* private mode */ } };
  const here = v.channelId === channel.id;
  const savedOrder = useTileOrder((s) => s.order[channel.id]);
  const drag = useTileDrag(tileKeysRef, (keys) => setTileOrder(channel.id, keys));
  useEffect(() => setTitle(`${channel.name ?? "Call"}${guild ? ` · ${guild.name}` : ""}`), [channel, guild]);
  // The pop-out window's share button opens the Go Live picker here.
  useEffect(() => { const on = () => setShareMenu(true); window.addEventListener("send:open-share", on); return () => window.removeEventListener("send:open-share", on); }, []);
  const popped = usePopout((p) => p.channelId === channel.id) && here;

  if (!here) return (
    <div className="stage-idle">
    <header className="ch-h m-only"><MobileNavButton /><ChannelGlyph c={channel} size={22} /><h1 className="ellipsis">{channel.name}</h1></header>
    <div className="stage-empty">
      <h1>{channel.name}</h1>
      {channel.type === ChannelType.STAGE && useStore.getState().stages[channel.id] && <p className="stage-topic">🔴 Live: {useStore.getState().stages[channel.id]!.topic}</p>}
      {channel.voice_status && <p className="voice-status-line">{channel.voice_status}</p>}
      <p className="muted">{states.length ? `${states.length} ${states.length === 1 ? "person is" : "people are"} here.` : "No one is here yet."}</p>
      <div className="row">{states.map((s) => <Avatar key={s.user_id} user={users[s.user_id]} size={48} />)}</div>
      <button className="btn primary" onClick={() => joinVoice(channel.id)}>{channel.type === ChannelType.STAGE ? "Join stage" : "Join voice"}</button>
    </div>
    </div>
  );

  if (popped) return (
    <div className="stage stage-popped" data-region="call">
      <header className="ch-h"><MobileNavButton /><ChannelGlyph c={channel} size={22} /><h1 className="ellipsis">{channel.name}</h1></header>
      <div className="stage-empty">
        <ExternalLink size={40} aria-hidden />
        <h2>The call is in its own window</h2>
        <p className="muted">You're still connected. Close that window or bring it back to see the call here.</p>
        <div className="row"><button className="btn primary" onClick={() => closeCallPopout()}>Bring it back</button><button className="btn danger" onClick={() => leaveVoice()}>Leave call</button></div>
      </div>
      {shareMenu && !v.sharing && <ShareDialog onClose={() => setShareMenu(false)} />}
    </div>
  );

  if (channel.type === ChannelType.STAGE) return <div className="stage" data-region="call"><header className="ch-h"><MobileNavButton /><ChannelGlyph c={channel} size={22} /><h1 className="ellipsis">{channel.name}</h1></header><StageView channel={channel} guild={guild} /></div>;
  type Tile = { key: string; uid: string; name: string; track: MediaStreamTrack | null; kind: "camera" | "screen"; speaking: boolean; muted: boolean; local: boolean; preview?: boolean };
  const tiles: Tile[] = [];
  tiles.push({ key: `${me.id}:camera`, uid: me.id, name: displayName(me), track: v.localCamera, kind: "camera", speaking: v.localSpeaking, muted: v.muted, local: true });
  if (v.localScreen) tiles.push({ key: `${me.id}:screen`, uid: me.id, name: `${displayName(me)} (your screen)`, track: v.localScreen, kind: "screen", speaking: false, muted: true, local: true });
  for (const p of Object.values(v.peers)) {
    tiles.push({ key: `${p.id}:camera`, uid: p.id, name: displayName(users[p.id]) || p.name, track: p.camera, kind: "camera", speaking: p.speaking, muted: p.micMuted, local: false });
    if (p.screen) tiles.push({ key: `${p.id}:screen`, uid: p.id, name: `${displayName(users[p.id]) || p.name}'s screen`, track: p.screen, kind: "screen", preview: !v.watching.includes(p.id), speaking: false, muted: !p.screenAudio, local: false });
  }
  // Show cached participants as soon as the gateway announces them, before media negotiation.
  for(const state of states)if(state.user_id!==me.id&&!v.peers[state.user_id])tiles.push({key:`${state.user_id}:camera`,uid:state.user_id,name:displayName(users[state.user_id])||"Connecting…",track:null,kind:"camera",speaking:false,muted:state.self_mute,local:false});
  // "…" menu view options: hide my own tile, hide people without video (never hide everyone).
  const others = tiles.filter((t) => !t.local);
  const alone = others.length === 0;
  let shown = tiles.filter((t) => v.settings.callShowSelf || !t.local || t.kind === "screen");
  if (!v.settings.callShowNonVideo) { const withVideo = shown.filter((t) => t.track); if (withVideo.length) shown = withVideo; }
  if (!shown.length) shown = tiles.slice(0, 1);
  // Your own arrangement (drag tiles around), remembered per call.
  shown = sortTiles(shown, savedOrder);
  // Like Discord: a stream you aren't watching can't be the focused tile.
  tileKeysRef.current = shown.map((t) => t.key);
  const focused = v.focus ? shown.find((t) => t.key === v.focus && !t.preview) ?? null : null;
  // Click a tile to focus it, click the focused one to go back to the grid; a stream preview starts watching.
  const activate = (t: Tile) => { if (t.preview) setWatching(t.uid, true); else useVoice.setState(t.key === v.focus ? { focus: null } : { focus: t.key, layout: "focus" }); };
  const chatOn = chat && !!guild;
  const caps = captureCapabilities();

  return (
    <div className={`stage ${chatOn ? "with-chat" : ""}`} data-region="call">
      <div className="stage-main">
      <header className="ch-h"><MobileNavButton /><ChannelGlyph c={channel} size={22} /><h1 className="ellipsis">{channel.name}</h1>
        <span className={`conn-pill cs-${v.status}`} role="status">{{ idle: "Disconnected", connecting: "Connecting…", connected: "Connected", reconnecting: "Reconnecting…", error: v.error ?? "Error" }[v.status]}</span>
        {guild && <VoiceStatusEditor channel={channel} />}
        <div className="ch-actions">
          {guild && <ChatToggle channel={channel} open={chatOn} onToggle={() => setChat(!chatOn)} />}
        </div>
      </header>
      {v.error && <p className="call-notice" role="status">{v.error}</p>}
      <div className={`tiles ${focused ? "focused" : ""}`} data-count={shown.length + (alone && guild ? 1 : 0)}>
        {/* Focused: the big tile, the members toggle and strip move together as one centred group. */}
        {focused ? <div className={`focus-area ${v.hideStrip || shown.length < 2 ? "no-strip" : ""}`}>
          <VideoTile t={focused} guildId={guild?.id ?? null} big onFocus={() => activate(focused)} />
          {shown.length > 1 && <button className="strip-toggle" onClick={() => useVoice.setState({ hideStrip: !v.hideStrip })} aria-expanded={!v.hideStrip} title={v.hideStrip ? "Show members" : "Hide members"} aria-label={v.hideStrip ? "Show members" : "Hide members"}>{v.hideStrip ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>}
          {!v.hideStrip && shown.length > 1 && <div className="tile-strip" {...drag}>
            {shown.filter((t) => t.key !== focused.key).map((t) => <VideoTile key={t.key} t={t} guildId={guild?.id ?? null} onFocus={() => activate(t)} />)}
          </div>}
        </div> : <div ref={gridRef} style={gridStyle} className="tile-grid" {...drag}>
          {shown.map((t) => <VideoTile key={t.key} t={t} guildId={guild?.id ?? null} onFocus={() => activate(t)} />)}
          {alone && guild && <InviteCard channel={channel} guild={guild} />}
        </div>}
      </div>
      <ActivityHost channel={channel} />
      {diag && <DiagPanel />}
      {guild && <MessagePreviews channel={channel} chatOpen={chatOn} onOpen={() => setChat(true)} />}
      <div className="call-controls" role="toolbar" aria-label="Call controls">
        <div className="ctl-group">
          <MicGroup />
          <CameraGroup />
        </div>
        <div className="ctl-group">
          <div className="ctl-wrap">
            <button className={`ctl ${v.sharing ? "on" : ""}`} aria-pressed={v.sharing} disabled={!v.grants?.video || !caps.canShare} title={caps.canShare ? (v.sharing ? "Stop sharing" : "Share your screen") : "This browser can't share screens."}
              onClick={() => (v.sharing ? stopScreenShare() : setShareMenu(!shareMenu))} aria-label={v.sharing ? "Stop sharing" : "Share screen"}>{v.sharing ? <MonitorOff /> : <Monitor />}</button>
            {v.sharing && <button className="ctl sm" onClick={() => { if (nativeCapture()) { stopScreenShare().then(() => setShareMenu(true)); } else switchScreenSource(); }} aria-label="Switch shared window"><RefreshCw size={16} /></button>}
            {shareMenu && !v.sharing && <ShareDialog onClose={() => setShareMenu(false)} />}
          </div>
          <ActivityButton channel={channel} ctl />
          {guild && guild.sounds !== undefined && <SoundboardButton channel={channel} guild={guild} />}
          <MoreButton channel={channel} guild={guild} onDiag={() => setDiag(!diag)} />
        </div>
        <button className="ctl danger hang-up" onClick={() => leaveVoice()} aria-label="Leave call" title="Disconnect"><PhoneOff /></button>
        {/* Like Discord: invite on the left; pop out and full screen on the right. */}
        <div className="ctl-side left">
          {(guild ? can(channel, P.CREATE_INVITE) : channel.type === ChannelType.GROUP_DM) && <button className="icon-btn ctl-mini" title="Invite to Voice" aria-label="Invite to Voice"
            onClick={() => guild ? openDialog({ kind: "invite", guildId: guild.id, channelId: channel.id }) : openDialog({ kind: "groupDm" })}><UserPlus size={20} /></button>}
        </div>
        <div className="ctl-side right">
          <button className="icon-btn ctl-mini" title="Pop Out" aria-label="Pop Out" onClick={() => openCallPopout(channel.id)}><ExternalLink size={20} /></button>
          <button className="icon-btn ctl-mini" title="Full Screen" aria-label="Full Screen" onClick={(e) => { const st = (e.currentTarget.closest(".stage") as HTMLElement | null); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else st?.requestFullscreen?.().catch(() => {}); }}><Maximize size={20} /></button>
        </div>
      </div>
      </div>
      {chatOn && <CallChat channel={channel} onClose={() => setChat(false)} />}
    </div>
  );
}

export function VideoTile({ t, big, onFocus, guildId, popout }: { popout?: boolean; guildId: string | null; t: { key: string; uid: string; name: string; track: MediaStreamTrack | null; kind: string; speaking: boolean; muted: boolean; local: boolean; preview?: boolean }; big?: boolean; onFocus: () => void }) {
  // In the pop-out window, menus and pop-ups (which open in the main window) are left out.
  const ref = useRef<HTMLVideoElement>(null);
  const tileRef = useRef<HTMLElement>(null);
  const [profile, setProfile] = useState(false);
  const users = useStore((s) => s.users);
  const me = useStore(s => s.me);
  const vol = useVoice((s) => s.settings.userVolumes[t.kind === "screen" ? `${t.uid}:stream` : t.uid] ?? 1);
  const [menu, setMenu] = useState(false);
  const volBtn = useRef<HTMLButtonElement>(null);
  const hoverT = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Clicking the speaker mutes/unmutes this person or stream for you (the volume you had comes back).
  const volKey = t.kind === "screen" ? `${t.uid}:stream` : t.uid;
  const toggleMute = () => {
    clearTimeout(hoverT.current); setMenu(false);
    if (vol > 0) { try { sessionStorage.setItem(`send.vol.before.${volKey}`, String(vol)); } catch { /* */ } setUserVolume(volKey, 0); }
    else { let back = 1; try { back = +(sessionStorage.getItem(`send.vol.before.${volKey}`) ?? 1) || 1; } catch { /* */ } setUserVolume(volKey, back); }
  };
  const tint = useImageTint((t.local ? me : users[t.uid])?.avatar ?? null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.srcObject = t.track ? new MediaStream([t.track]) : null;
  }, [t.track]);
  // The focused tile takes the video's own shape, so a screen share has no black bars around it.
  const [ar, setAr] = useState<number | null>(null);
  const measure = () => { const el = ref.current; if (el && el.videoWidth && el.videoHeight) setAr(el.videoWidth / el.videoHeight); };
  const fullscreen = () => tileRef.current?.requestFullscreen?.();
  const pip = () => (ref.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> })?.requestPictureInPicture?.();
  const watched = t.kind === "screen" && !t.local && !t.preview;
  const context = (e: { clientX?: number; clientY?: number; preventDefault(): void; stopPropagation(): void }) => {
    e.stopPropagation(); setMenu(false);
    const user = t.local ? me : users[t.uid];
    openContextMenu({ clientX: e.clientX, clientY: e.clientY, currentTarget: tileRef.current, preventDefault: () => e.preventDefault() }, tileMenuItems({
      uid: t.uid, screen: t.kind === "screen", local: t.local, focused: !!big, hasVideo: !!t.track && !t.preview,
      onFocus, onFullscreen: fullscreen,
      onWatch: t.preview ? () => setWatching(t.uid, true) : undefined, onStopWatching: watched ? () => setWatching(t.uid, false) : undefined,
      onPip: ref.current && "requestPictureInPicture" in ref.current && document.pictureInPictureEnabled ? pip : undefined,
      onProfile: user ? () => setProfile(true) : undefined,
      participantItems: user ? userMenuItems(user, { guildId, onProfile: () => setProfile(true) }) : [],
    }));
  };
  return (
    <figure ref={tileRef} data-key={t.key} tabIndex={0} aria-label={t.preview ? `${t.name}. Watch stream` : t.name} aria-haspopup="menu" className={`tile ${t.speaking ? "speaking" : ""} ${big ? "big" : ""} ${t.track ? "has-video" : ""} ${t.preview ? "preview" : ""} k-${t.kind}`} style={{ ...(tint ? { "--tile-bg": tint } : {}), ...(big && ar && t.track ? { "--ar": ar } : {}) } as React.CSSProperties}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button, input, a, .vol-pop")) onFocus(); }}
      onContextMenu={popout ? undefined : context} onKeyDown={e => { if (e.target !== e.currentTarget) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFocus(); return; } if (!popout) contextMenuKey(e, () => context(e)); }}
      onDoubleClick={() => { if (!t.preview) void fullscreen()?.catch(() => {}); }}>
      {t.track ? <video ref={ref} autoPlay playsInline muted onLoadedMetadata={measure} onResize={measure} className={t.local && t.kind === "camera" ? "mirror" : ""} /> : <div className="tile-av"><Avatar user={t.local ? me : users[t.uid]} size={big ? 120 : isPhone() ? 104 : 72} /></div>}
      {t.preview && <div className="watch-cta"><button className="btn primary" onClick={onFocus}>Watch Stream</button></div>}
      <figcaption>{t.muted && t.kind === "camera" && <MicOff size={14} aria-label="muted" />}{t.kind === "screen" && <span className="live">LIVE</span>}<span className="ellipsis tile-name">{t.name}</span></figcaption>
      <div className="tile-tools">
        {!t.preview && <button className="icon-btn sm" onClick={onFocus} aria-label={big ? "Unfocus" : `Focus ${t.name}`}><Pin size={14} /></button>}
        {watched && <button className="icon-btn sm" onClick={() => setWatching(t.uid, false)} aria-label="Stop watching" title="Stop watching"><EyeOff size={14} /></button>}
        {t.track && !t.preview && <button className="icon-btn sm" onClick={() => { void fullscreen()?.catch(() => {}); }} aria-label="Fullscreen"><Maximize size={14} /></button>}
        {t.track && !t.preview && "requestPictureInPicture" in HTMLVideoElement.prototype && <button className="icon-btn sm" onClick={() => { void pip()?.catch(() => {}); }} aria-label="Picture in picture"><PictureInPicture2 size={14} /></button>}
        {!t.local && !t.preview && <button ref={volBtn} className={`icon-btn sm ${vol === 0 ? "vol-muted" : ""}`}
          onClick={toggleMute} onMouseEnter={() => { if (!popout) hoverT.current = setTimeout(() => setMenu(true), 450); }} onMouseLeave={() => clearTimeout(hoverT.current)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!popout) setMenu(true); }}
          aria-pressed={vol === 0} aria-label={vol === 0 ? `Unmute ${t.kind === "screen" ? "stream" : t.name}` : `Mute ${t.kind === "screen" ? "stream" : t.name}`}
          title={vol === 0 ? "Click to unmute · hover for volume" : "Click to mute · hover for volume"}>{vol === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>}
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
              <tr><td>Negotiated</td><td>{op ? `${op.stereo ? "stereo" : "mono"} · DTX ${op.dtx ? "on" : "off"} · FEC ${op.fec ? "on" : "off"}${op.maxAvgBitrate ? ` · cap ${Math.round(op.maxAvgBitrate / 1000)} kbps` : ""}` : "-"}</td></tr>
              <tr><td>Measured send</td><td>{d.audio.sendKbps ?? "…"} kbps</td></tr>
              <tr><td>Loss / jitter / RTT</td><td>{d.audio.packetLossPct ?? "-"}% / {d.audio.jitterMs ?? "-"} ms / {d.audio.rttMs ?? "-"} ms</td></tr>
            </tbody></table>
          )}
          {d.screen && (
            <table className="caps small"><caption>Your screen share ({d.screen.codec})</caption><tbody>
              <tr><td>Captured</td><td>{d.screen.capture ? `${d.screen.capture.width}×${d.screen.capture.height} @ ${d.screen.capture.fps} fps` : "-"}</td></tr>
              {d.screen.layers.map((l) => <tr key={l.rid}><td>Layer {l.rid}</td><td>{l.width}×{l.height} @ {l.fps ?? "-"} fps · {l.kbps ?? "…"} kbps{l.limitation && l.limitation !== "none" ? ` · limited by ${l.limitation}` : ""}{!l.active ? " · paused (no viewers)" : ""}</td></tr>)}
            </tbody></table>
          )}
          {d.inbound.length > 0 && (
            <table className="caps small"><caption>Receiving</caption><thead><tr><th>From</th><th>What</th><th>Quality</th><th>Loss</th></tr></thead><tbody>
              {d.inbound.map((i, k) => <tr key={k}><td>{i.identity}</td><td>{i.source} ({i.codec}{i.channels ? `, ${i.channels}ch` : ""})</td><td>{i.kind === "video" ? `${i.width}×${i.height} @ ${i.fps ?? "-"} fps, ` : ""}{i.kbps ?? "…"} kbps{i.dropped ? `, ${i.dropped} dropped` : ""}</td><td>{i.lossPct ?? "-"}% / {i.jitterMs ?? "-"} ms</td></tr>)}
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

/**
 * Discord-style grid: pick the number of columns that makes 16:9 tiles as large as possible for the space
 * there is — side by side in a wide window, stacked in a tall one — and centre them. Phones keep their own
 * stacked layout (styles.css).
 */
function useBestGrid(): [(el: HTMLDivElement | null) => void, React.CSSProperties | undefined] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<React.CSSProperties>();
  useEffect(() => {
    if (!el) return;
    const fit = () => {
      if (isPhone()) { setStyle(undefined); return; }
      const n = el.querySelectorAll(":scope > .tile, :scope > .invite-card").length || 1;
      const gap = 8, W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      let best = { cols: 1, w: 0 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 16 / 9);
        if (w > best.w) best = { cols, w };
      }
      const w = Math.max(120, Math.floor(best.w));
      // Wrapping rows of equal tiles, centred — a shorter last row sits in the middle, like Discord.
      setStyle((s) => ((s as any)?.["--tile-w"] === `${w}px` ? s : { display: "flex", flexWrap: "wrap", justifyContent: "center", alignContent: "center", "--tile-w": `${w}px` } as React.CSSProperties));
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(el);
    const mo = new MutationObserver(fit); mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [el]);
  return [setEl, style];
}
