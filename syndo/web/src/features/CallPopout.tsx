/**
 * Pop out a call into its own window (like Discord): everyone's tiles, screen shares and the call controls,
 * while the main window carries on with chat. It's a second view of the same call — same connection, same
 * streams — rendered into a window this page opens. Close it (or "Bring back") to return the call to SEND.
 */
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { ArrowDownLeft, Camera, CameraOff, Headphones, HeadphoneOff, Maximize, MessageCircle, Mic, MicOff, Monitor, MonitorOff, PhoneOff, UserPlus } from "lucide-react";
import { ChannelType } from "@send/shared";
import { ChannelGlyph } from "../components/ChannelGlyph.tsx";
import { openDialog } from "../components/Shell.tsx";
import { channelById, displayName, dmTitle, toast, useStore } from "../store.ts";
import { leaveVoice, setDeafened, setMuted, setWatching, stopScreenShare, toggleCamera, useVoice } from "../voice/session.ts";
import { VideoTile } from "../components/VoiceStage.tsx";
import { setTileOrder, sortTiles, useTileDrag, useTileOrder } from "./callLayout.ts";
import { navigate } from "../router.ts";

export const usePopout = create<{ channelId: string | null }>(() => ({ channelId: null }));
let win: Window | null = null, root: Root | null = null, cleanups: (() => void)[] = [];

function mirrorStyles(d: Document) {
  for (const n of document.head.querySelectorAll('link[rel="stylesheet"], style')) d.head.appendChild(n.cloneNode(true));
  const copyAttrs = (from: Element, to: Element) => { for (const a of [...to.attributes]) if (!from.hasAttribute(a.name)) to.removeAttribute(a.name); for (const a of [...from.attributes]) to.setAttribute(a.name, a.value); };
  copyAttrs(document.documentElement, d.documentElement); copyAttrs(document.body, d.body);
  d.body.classList.add("popout-body");
  // Themes and lazily-loaded styles change later: keep the window in step.
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList" && m.target === document.head) for (const n of m.addedNodes) if (n instanceof HTMLStyleElement || (n instanceof HTMLLinkElement && n.rel === "stylesheet")) d.head.appendChild(n.cloneNode(true));
      if (m.type === "attributes") { copyAttrs(document.documentElement, d.documentElement); copyAttrs(document.body, d.body); d.body.classList.add("popout-body"); }
    }
  });
  mo.observe(document.head, { childList: true });
  mo.observe(document.documentElement, { attributes: true });
  mo.observe(document.body, { attributes: true });
  cleanups.push(() => mo.disconnect());
}

export function closeCallPopout() {
  for (const c of cleanups.splice(0)) { try { c(); } catch { /* */ } }
  try { root?.unmount(); } catch { /* */ }
  root = null;
  if (win && !win.closed) win.close();
  win = null;
  usePopout.setState({ channelId: null });
}

export function openCallPopout(channelId: string) {
  if (win && !win.closed) { win.focus(); return; }
  const w = window.open("", "send-call", "popup,width=1040,height=680");
  if (!w) { toast("SEND couldn't open the call window. Allow pop-ups for this site, then try again.", "error"); return; }
  win = w;
  const d = w.document;
  d.open(); d.write("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>SEND call</title></head><body></body></html>"); d.close();
  mirrorStyles(d);
  const host = d.createElement("div"); host.className = "popout-root"; d.body.appendChild(host);
  root = createRoot(host);
  root.render(<PopoutCall channelId={channelId} win={w} />);
  usePopout.setState({ channelId });
  // The window closing (its X, or the call ending) brings the call back; so does this page going away.
  const poll = setInterval(() => { if (w.closed) closeCallPopout(); }, 500);
  const leaveMain = () => { if (!w.closed) w.close(); };
  window.addEventListener("pagehide", leaveMain);
  cleanups.push(() => clearInterval(poll), () => window.removeEventListener("pagehide", leaveMain));
  // Leaving the call closes the pop-out.
  const unsub = useVoice.subscribe((s) => { if (s.channelId !== channelId) closeCallPopout(); });
  cleanups.push(unsub);
}

function PopoutCall({ channelId, win: w }: { channelId: string; win: Window }) {
  const v = useVoice();
  const users = useStore((s) => s.users);
  const me = useStore((s) => s.me!);
  useStore((s) => s.guilds); useStore((s) => s.dms); // re-render when channels change
  const channel = channelById(channelId);
  const guildId: string | null = channel?.guild_id ?? null;
  const states = useStore(useShallow((s) => Object.values(s.voice).filter((x) => x.channel_id === channelId)));
  const [focus, setFocus] = useState<string | null>(null);
  const saved = useTileOrder((s) => s.order[channelId]);
  const keysRef = useRef<string[]>([]);
  const drag = useTileDrag(keysRef, (keys) => setTileOrder(channelId, keys));
  useEffect(() => { w.document.title = `${channel?.name ?? "Call"} — SEND`; }, [channel?.name]);

  type Tile = Parameters<typeof VideoTile>[0]["t"];
  let tiles: Tile[] = [{ key: `${me.id}:camera`, uid: me.id, name: displayName(me), track: v.localCamera, kind: "camera", speaking: v.localSpeaking, muted: v.muted, local: true }];
  if (v.localScreen) tiles.push({ key: `${me.id}:screen`, uid: me.id, name: `${displayName(me)} (your screen)`, track: v.localScreen, kind: "screen", speaking: false, muted: true, local: true });
  for (const p of Object.values(v.peers)) {
    tiles.push({ key: `${p.id}:camera`, uid: p.id, name: displayName(users[p.id]) || p.name, track: p.camera, kind: "camera", speaking: p.speaking, muted: p.micMuted, local: false });
    if (p.screen) tiles.push({ key: `${p.id}:screen`, uid: p.id, name: `${displayName(users[p.id]) || p.name}'s screen`, track: p.screen, kind: "screen", preview: !v.watching.includes(p.id), speaking: false, muted: !p.screenAudio, local: false });
  }
  for (const st of states) if (st.user_id !== me.id && !v.peers[st.user_id]) tiles.push({ key: `${st.user_id}:camera`, uid: st.user_id, name: displayName(users[st.user_id]) || "Connecting…", track: null, kind: "camera", speaking: false, muted: st.self_mute, local: false });
  tiles = sortTiles(tiles, saved);
  keysRef.current = tiles.map((t) => t.key);
  const focused = focus ? tiles.find((t) => t.key === focus && !t.preview) ?? null : null;
  const activate = (t: Tile) => { if (t.preview) setWatching(t.uid, true); else setFocus(t.key === focus ? null : t.key); };

  const share = () => {
    if (v.sharing) { stopScreenShare(); return; }
    // The Go Live picker lives in the main window.
    window.focus();
    navigate(`/channels/${guildId ?? "@me"}/${channelId}`);
    setTimeout(() => window.dispatchEvent(new CustomEvent("send:open-share")), 200);
  };

  // Like Discord's pop-out: the name and controls fade away while the mouse rests, and come back when it moves.
  const [idle, setIdle] = useState(false);
  const idleT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wake = () => { setIdle(false); clearTimeout(idleT.current); idleT.current = setTimeout(() => setIdle(true), 2500); };
  useEffect(() => { wake(); return () => clearTimeout(idleT.current); }, []);
  const title = channel ? (channel.guild_id ? channel.name : dmTitle(channel)) : "Call";
  const openChat = () => { window.focus(); navigate(`/channels/${guildId ?? "@me"}/${channelId}`); };
  const fullscreen = () => { const d = w.document; if (d.fullscreenElement) d.exitFullscreen().catch(() => {}); else d.documentElement.requestFullscreen?.().catch(() => {}); };

  return (
    <div className={`popout-call ${idle ? "idle" : ""}`} data-region="call" onMouseMove={wake} onMouseDown={wake}>
      <header className="popout-h">
        {channel && <ChannelGlyph c={channel} size={20} />}<span className="ellipsis">{title}</span>
        <button className="icon-btn popout-chat" onClick={openChat} aria-label="Show chat" title="Show Chat"><MessageCircle size={20} /></button>
      </header>
      <div className={`popout-tiles ${focused ? "focused" : ""}`}>
        {focused && <div className="popout-focus"><VideoTile t={focused} guildId={guildId} big popout onFocus={() => activate(focused)} /></div>}
        <div className={focused ? "tile-strip" : "popout-grid"} data-count={tiles.length} {...drag}>
          {tiles.filter((t) => t.key !== focused?.key).map((t) => <VideoTile key={t.key} t={t} guildId={guildId} popout onFocus={() => activate(t)} />)}
        </div>
      </div>
      <div className="call-controls popout-controls" role="toolbar" aria-label="Call controls">
        <div className="ctl-side left">
          {(guildId || channel?.type === ChannelType.GROUP_DM) && <button className="icon-btn ctl-mini" title="Invite to Voice" aria-label="Invite to Voice" onClick={() => { window.focus(); openDialog(guildId ? { kind: "invite", guildId, channelId } : { kind: "groupDm" }); }}><UserPlus size={20} /></button>}
        </div>
        <div className="ctl-group">
          <button className={`ctl ${v.muted ? "off" : ""}`} aria-pressed={v.muted} onClick={() => setMuted(!v.muted)} aria-label={v.muted ? "Unmute" : "Mute"} title={v.muted ? "Unmute" : "Mute"}>{v.muted ? <MicOff /> : <Mic />}</button>
          <button className={`ctl ${v.deafened ? "off" : ""}`} aria-pressed={v.deafened} onClick={() => setDeafened(!v.deafened)} aria-label={v.deafened ? "Undeafen" : "Deafen"} title={v.deafened ? "Undeafen" : "Deafen"}>{v.deafened ? <HeadphoneOff /> : <Headphones />}</button>
          <button className={`ctl ${v.camera ? "on" : ""}`} aria-pressed={v.camera} disabled={!v.grants?.video} onClick={() => toggleCamera()} aria-label={v.camera ? "Turn off camera" : "Turn on camera"} title={v.camera ? "Turn Off Camera" : "Turn On Camera"}>{v.camera ? <Camera /> : <CameraOff />}</button>
        </div>
        <div className="ctl-group">
          <button className={`ctl ${v.sharing ? "on" : ""}`} aria-pressed={v.sharing} disabled={!v.grants?.video} onClick={share} aria-label={v.sharing ? "Stop sharing" : "Share screen"} title={v.sharing ? "Stop Streaming" : "Share Your Screen"}>{v.sharing ? <MonitorOff /> : <Monitor />}</button>
        </div>
        <button className="ctl danger hang-up" onClick={() => leaveVoice()} aria-label="Leave call" title="Disconnect"><PhoneOff /></button>
        <div className="ctl-side right">
          <button className="icon-btn ctl-mini" onClick={() => { window.focus(); closeCallPopout(); }} aria-label="Pop in" title="Pop In"><ArrowDownLeft size={20} /></button>
          <button className="icon-btn ctl-mini" onClick={fullscreen} aria-label="Full screen" title="Full Screen"><Maximize size={20} /></button>
        </div>
      </div>
    </div>
  );
}
