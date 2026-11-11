import { Camera, CameraOff, ChevronDown, ChevronUp, Headphones, HeadphoneOff, MessageCircle, Mic, MicOff, MoreHorizontal, Rocket, Settings, UserPlus, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { P, type Channel, type Guild, type Message } from "@send/shared";
import { openContextMenu, type MenuItem } from "../components/overlay.tsx";
import { Modal } from "../components/ui.tsx";
import { openDialog } from "../components/Shell.tsx";
import { can, displayName, useStore } from "../store.ts";
import { setDeafened, setMuted, switchDevice, toggleCamera, updateVoiceSettings, useVoice } from "../voice/session.ts";
import { openActivityPicker } from "./Activities.tsx";

/* Discord-style call controls: split mic/camera buttons with device menus, a "…" menu with view options,
   a chat toggle, the "invite people" card for an empty call and message previews over the call. */

const openSettings = () => openDialog({ kind: "userSettings", tab: "voice" });

/** Open a menu just above (or below) a control, the way the call bar's chevrons do. */
function menuAt(at: DOMRect, items: MenuItem[]) {
  openContextMenu({ clientX: Math.max(1, at.left), clientY: at.top - 8 }, items);
}
const rectOf = (e: ReactMouseEvent<HTMLElement>) => e.currentTarget.getBoundingClientRect();

async function devices(kind: MediaDeviceKind) {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind && d.deviceId); } catch { return []; }
}
const label = (d: MediaDeviceInfo, i: number, fallback: string) => d.label || `${fallback} ${i + 1}`;
function deviceItems(list: MediaDeviceInfo[], current: string, kind: "audioinput" | "audiooutput" | "videoinput", fallback: string): MenuItem[] {
  if (!list.length) return [{ label: "No devices found", disabled: true }];
  const sel = list.some((d) => d.deviceId === current) ? current : list[0]!.deviceId;
  return list.map((d, i) => ({ label: label(d, i, fallback), checked: d.deviceId === sel, onSelect: () => void switchDevice(kind, d.deviceId) }));
}
const nameOf = (list: MediaDeviceInfo[], id: string, fallback: string) => {
  const i = list.findIndex((d) => d.deviceId === id);
  return i >= 0 ? label(list[i]!, i, fallback) : list[0] ? label(list[0], 0, fallback) : "Default";
};

export function MicGroup() {
  const v = useVoice();
  const open = async (e: ReactMouseEvent<HTMLElement>) => {
    const at = rectOf(e);
    const [ins, outs] = await Promise.all([devices("audioinput"), devices("audiooutput")]);
    menuAt(at, [
      { label: "Input Device", hint: nameOf(ins, v.settings.inputDeviceId, "Microphone"), submenu: deviceItems(ins, v.settings.inputDeviceId, "audioinput", "Microphone") },
      ...(outs.length ? [{ label: "Output Device", hint: nameOf(outs, v.settings.outputDeviceId, "Speaker"), submenu: deviceItems(outs, v.settings.outputDeviceId, "audiooutput", "Speaker") } as MenuItem] : []),
      { label: "Input Mode", hint: v.settings.mode === "ptt" ? "Push to Talk" : "Voice Activity", submenu: [
        { label: "Voice Activity", checked: v.settings.mode === "vad", onSelect: () => void import("../voice/session.ts").then((m) => m.setMode("vad")) },
        { label: "Push to Talk", checked: v.settings.mode === "ptt", onSelect: () => void import("../voice/session.ts").then((m) => m.setMode("ptt")) },
      ] },
      { kind: "separator" },
      { label: v.deafened ? "Undeafen" : "Deafen", icon: v.deafened ? <HeadphoneOff size={16} /> : <Headphones size={16} />, onSelect: () => setDeafened(!v.deafened) },
      { label: "Voice Settings", icon: <Settings size={16} />, onSelect: openSettings },
    ]);
  };
  return (
    <div className="ctl-pill" role="group" aria-label="Microphone">
      <button className={`ctl-seg ${v.muted ? "off" : ""}`} aria-pressed={v.muted} onClick={() => setMuted(!v.muted)} aria-label={v.muted ? "Unmute" : "Mute"} title={v.muted ? "Unmute" : "Mute"} disabled={!v.grants?.speak}>{v.muted ? <MicOff /> : <Mic />}</button>
      <button className="ctl-chev" onClick={open} aria-haspopup="menu" aria-label="Microphone options"><ChevronDown size={18} /></button>
    </div>
  );
}

export function CameraGroup() {
  const v = useVoice();
  const [preview, setPreview] = useState(false);
  const open = async (e: ReactMouseEvent<HTMLElement>) => {
    const at = rectOf(e);
    const cams = await devices("videoinput");
    menuAt(at, [
      { label: "Camera", hint: nameOf(cams, v.settings.videoDeviceId, "Camera"), submenu: deviceItems(cams, v.settings.videoDeviceId, "videoinput", "Camera") },
      { kind: "separator" },
      { label: "Preview Camera", onSelect: () => setPreview(true) },
      { label: "Video Settings", icon: <Settings size={16} />, onSelect: openSettings },
    ]);
  };
  return (
    <div className="ctl-pill" role="group" aria-label="Camera">
      <button className={`ctl-seg ${v.camera ? "on" : ""}`} aria-pressed={v.camera} onClick={toggleCamera} aria-label={v.camera ? "Turn camera off" : "Turn camera on"} title={v.camera ? "Turn camera off" : "Turn camera on"} disabled={!v.grants?.video}>{v.camera ? <Camera /> : <CameraOff />}</button>
      <button className="ctl-chev" onClick={open} aria-haspopup="menu" aria-label="Camera options"><ChevronUp size={18} /></button>
      {preview && <CameraPreview onClose={() => setPreview(false)} />}
    </div>
  );
}

function CameraPreview({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const id = useVoice((v) => v.settings.videoDeviceId);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null, gone = false;
    navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : true }).then((s) => {
      if (gone) { s.getTracks().forEach((t) => t.stop()); return; }
      stream = s; if (ref.current) ref.current.srcObject = s;
    }).catch(() => setErr("The camera couldn't be started."));
    return () => { gone = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [id]);
  return (
    <Modal title="Preview Camera" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      {err ? <p className="muted">{err}</p> : <video ref={ref} className="cam-preview" autoPlay playsInline muted />}
    </Modal>
  );
}

/** The "…" button: invite, view options and settings. */
export function MoreButton({ channel, guild, onDiag }: { channel: Channel; guild: Guild | null; onDiag: () => void }) {
  const v = useVoice();
  const s = v.settings;
  return (
    <button className="ctl" aria-haspopup="menu" aria-label="More options" title="More" onClick={(e) => menuAt(rectOf(e), [
      ...(guild && can(channel, P.CREATE_INVITE) ? [{ label: "Invite to Voice", icon: <UserPlus size={16} />, onSelect: () => openDialog({ kind: "invite", guildId: guild.id, channelId: channel.id }) } as MenuItem, { kind: "separator" } as MenuItem] : []),
      { label: "Grid view", checked: v.layout === "grid", onSelect: () => useVoice.setState({ layout: v.layout === "grid" ? "focus" : "grid", focus: null }) },
      { label: "Show My Own Camera", checked: s.callShowSelf, onSelect: () => void updateVoiceSettings({ callShowSelf: !s.callShowSelf }) },
      { label: "Show Non-Video Participants", checked: s.callShowNonVideo, onSelect: () => void updateVoiceSettings({ callShowNonVideo: !s.callShowNonVideo }) },
      ...(guild ? [{ label: "Show New Message Previews", checked: s.callMessagePreviews, onSelect: () => void updateVoiceSettings({ callMessagePreviews: !s.callMessagePreviews }) } as MenuItem] : []),
      { kind: "separator" },
      { label: "Connection diagnostics", onSelect: onDiag },
      { label: "Voice and Video Settings", icon: <Settings size={16} />, onSelect: openSettings },
    ])}><MoreHorizontal /></button>
  );
}

/** Chat toggle in the call header, with an unread dot when the call chat has news. */
export function ChatToggle({ channel, open, onToggle }: { channel: Channel; open: boolean; onToggle: () => void }) {
  const unread = useStore((s) => { const rs = s.readStates[channel.id]; return !!channel.last_message_id && (!rs?.last_read_id || BigInt(channel.last_message_id) > BigInt(rs.last_read_id)); });
  return <button className={`icon-btn chat-toggle ${open ? "active" : ""}`} aria-pressed={open} aria-label={open ? "Hide chat" : "Show chat"} title="Chat" onClick={onToggle}><MessageCircle size={20} />{unread && !open && <i className="dot" aria-hidden />}</button>;
}

/** Shown as a tile while you're alone in the call. */
export function InviteCard({ channel, guild }: { channel: Channel; guild: Guild | null }) {
  return (
    <figure className="tile invite-card">
      <CallArt />
      <figcaption className="invite-actions">
        {guild && can(channel, P.CREATE_INVITE) && <button className="btn" onClick={() => openDialog({ kind: "invite", guildId: guild.id, channelId: channel.id })}><UserPlus size={18} /> Invite to Voice</button>}
        <button className="btn" onClick={openActivityPicker}><Rocket size={18} /> Choose Activity</button>
      </figcaption>
    </figure>
  );
}

/** Original illustration: a speech bubble, a headset and sparkles. */
function CallArt() {
  return (
    <svg className="call-art" viewBox="0 0 240 150" aria-hidden>
      <defs>
        <linearGradient id="ca-b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7C8CFF" /><stop offset="1" stopColor="#B36BFF" /></linearGradient>
        <linearGradient id="ca-h" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3DDC97" /><stop offset="1" stopColor="#1C9C8A" /></linearGradient>
      </defs>
      <path d="M44 30h96a18 18 0 0 1 18 18v38a18 18 0 0 1-18 18H86l-22 18v-18H44a18 18 0 0 1-18-18V48a18 18 0 0 1 18-18z" fill="url(#ca-b)" />
      <circle cx="68" cy="67" r="7" fill="#fff" /><circle cx="92" cy="67" r="7" fill="#fff" /><circle cx="116" cy="67" r="7" fill="#fff" />
      <g transform="translate(150 50)">
        <path d="M8 44V36a34 34 0 0 1 68 0v8" fill="none" stroke="url(#ca-h)" strokeWidth="9" strokeLinecap="round" />
        <rect x="0" y="40" width="20" height="34" rx="8" fill="url(#ca-h)" /><rect x="64" y="40" width="20" height="34" rx="8" fill="url(#ca-h)" />
      </g>
      <path d="M200 20l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#FFD166" /><path d="M22 112l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FF8FB1" />
    </svg>
  );
}

/** A small bubble over the call when someone writes in its chat while the chat is closed. */
export function MessagePreviews({ channel, chatOpen, onOpen }: { channel: Channel; chatOpen: boolean; onOpen: () => void }) {
  const on = useVoice((v) => v.settings.callMessagePreviews);
  const last = useStore((s) => { const l = s.messages[channel.id]?.list; return l?.length ? l[l.length - 1] : null; }) as Message | null;
  const me = useStore((s) => s.me?.id);
  const users = useStore((s) => s.users);
  const [shown, setShown] = useState<Message | null>(null);
  const seen = useRef<string | null>(last?.id ?? null);
  useEffect(() => {
    if (!last || last.id === seen.current) return;
    seen.current = last.id;
    if (chatOpen || !on || last.author.id === me || (last as any)._state) return;
    setShown(last);
    const t = setTimeout(() => setShown(null), 6000);
    return () => clearTimeout(t);
  }, [last?.id]); // eslint-disable-line
  if (!shown || chatOpen) return null;
  return (
    <div className="msg-preview" role="status">
      <button className="msg-preview-body" onClick={() => { setShown(null); onOpen(); }}>
        <strong>{displayName(users[shown.author.id] ?? shown.author)}</strong>
        <span className="ellipsis">{shown.content || (shown.attachments?.length ? "Sent an attachment" : "Sent a message")}</span>
      </button>
      <button className="icon-btn sm" aria-label="Dismiss" onClick={() => setShown(null)}><X size={14} /></button>
    </div>
  );
}
