import { AnimatePresence, motion } from "motion/react";
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, RefreshCw, Video, VideoOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "../lib/i18n";
import { buzz } from "../lib/prefs";
import { playEnded, playJoined, ringIncoming, ringOutgoing } from "../lib/sounds";
import { useStore } from "../lib/store";
import type { Call } from "../lib/types";
import { Avatar } from "./Avatar";
import { useToast } from "./Toast";

/*
 * Calls: voice/video for 1:1 chats, group chats and meetings.
 * - The `calls` row rings everyone (DB trigger → notification/push).
 * - Media is peer-to-peer WebRTC (mesh: fine for small groups).
 * - Signalling (offer/answer/ICE) travels over a Supabase Realtime room
 *   `call:<id>`; presence in that room tells us who is in the call.
 * - Of each pair, the person with the smaller id makes the offer, so two
 *   people never offer to each other at the same time.
 */
const STUN: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];
const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined;
let iceCache: { servers: RTCIceServer[]; at: number } | null = null;

/** STUN + Cloudflare TURN relay (short-lived login from our Worker), so calls connect on mobile data too. */
async function iceServers(token: string | null): Promise<RTCIceServer[]> {
  if (iceCache && Date.now() - iceCache.at < 6 * 3600e3) return iceCache.servers;
  if (!TURN_URL || !token) return STUN;
  try {
    const r = await fetch(TURN_URL, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return STUN;
    const j = await r.json() as { iceServers?: RTCIceServer | RTCIceServer[] };
    const relay = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    const servers = [...STUN, ...relay];
    iceCache = { servers, at: Date.now() };
    return servers;
  } catch { return STUN; }
}

/** A call is worth joining if someone is in it, or it started ringing in the last minute. */
export function isLive(k: Call, parts: { call_id: string; left_at: string | null }[]) {
  if (k.status === "ended") return false;
  if (parts.some((p) => p.call_id === k.id && !p.left_at)) return true;
  return Date.now() - new Date(k.started_at).getTime() < 60000;
}

interface Peer { pc: RTCPeerConnection; stream: MediaStream; queued: RTCIceCandidateInit[] }
interface Live { call: Call; local: MediaStream | null; peers: Record<string, MediaStream>; muted: boolean; camOff: boolean; sharing: boolean; front: boolean; started: number }

interface Ctx {
  current: Live | null;
  start: (o: { conversationId?: string; eventId?: string; kind: "voice" | "video" }) => Promise<void>;
  join: (c: Call) => Promise<void>;
}
const CallCtx = createContext<Ctx>({ current: null, start: async () => {}, join: async () => {} });
export const useCalls = () => useContext(CallCtx);

export function CallProvider({ children }: { children: ReactNode }) {
  const { db, me, backend, refresh } = useStore();
  const toast = useToast();
  const [live, setLive] = useState<Live | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const peers = useRef<Map<string, Peer>>(new Map());
  const room = useRef<ReturnType<typeof backend.channel> | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const iceRef = useRef<RTCIceServer[]>(STUN);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;

  const sync = useCallback(() => setLive((l) => l && ({ ...l, peers: Object.fromEntries([...peers.current.entries()].map(([k, p]) => [k, p.stream])) })), []);

  const signal = useCallback((to: string, type: string, data: unknown) => {
    room.current?.send({ type: "broadcast", event: "signal", payload: { from: me.id, to, type, data } });
  }, [me.id]);

  const peerFor = useCallback((uid: string) => {
    let p = peers.current.get(uid);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    p = { pc, stream: new MediaStream(), queued: [] };
    peers.current.set(uid, p);
    // Always negotiate audio + video, so cameras/screens can be switched on later without renegotiating.
    const local = localRef.current;
    const a = local?.getAudioTracks()[0], v = local?.getVideoTracks()[0];
    if (a && local) pc.addTrack(a, local); else pc.addTransceiver("audio", { direction: "sendrecv" });
    if (v && local) pc.addTrack(v, local); else pc.addTransceiver("video", { direction: "sendrecv" });
    pc.onicecandidate = (e) => { if (e.candidate) signal(uid, "ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => { if (!p!.stream.getTracks().includes(e.track)) p!.stream.addTrack(e.track); sync(); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") { pc.restartIce?.(); } if (pc.connectionState === "closed") drop(uid); };
    sync();
    return p;
  }, [signal, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  const drop = useCallback((uid: string) => {
    const p = peers.current.get(uid);
    if (!p) return;
    p.pc.close(); peers.current.delete(uid); sync();
  }, [sync]);

  const call = useCallback(async (uid: string) => {
    const p = peerFor(uid);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    signal(uid, "offer", offer);
  }, [peerFor, signal]);

  const leave = useCallback(async () => {
    const l = liveRef.current;
    if (l) playEnded();
    for (const uid of [...peers.current.keys()]) drop(uid);
    localRef.current?.getTracks().forEach((tr) => tr.stop());
    localRef.current = null;
    if (room.current) { backend.removeChannel(room.current); room.current = null; }
    setLive(null);
    if (l) { await backend.rpc("leave_call", { p_call: l.call.id }).catch(() => {}); refresh("calls"); }
  }, [backend, drop, refresh]);

  /** Microphone (+ camera for video). Asked for before anything is created, so a refused permission leaves nothing behind. */
  const getMedia = useCallback(async (kind: Call["kind"]): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: kind === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } } : false });
    } catch {
      try { const a = await navigator.mediaDevices.getUserMedia({ audio: true }); if (kind === "video") toast(t("Camera not available — joining with sound only"), "info"); return a; }
      catch { toast(t("Allow the microphone to join calls — tap the lock icon by the address, or Settings → Apps → your browser → Permissions"), "error"); return null; }
    }
  }, [toast]);

  const enter = useCallback(async (c: Call, media?: MediaStream) => {
    if (liveRef.current) { if (liveRef.current.call.id === c.id) return; await leave(); }
    const local = media ?? await getMedia(c.kind);
    if (!local) return;
    localRef.current = local;
    iceRef.current = await iceServers(await backend.accessToken());
    await backend.rpc("join_call", { p_call: c.id });
    setLive({ call: c, local, peers: {}, muted: false, camOff: c.kind === "voice", sharing: false, front: true, started: Date.now() });
    const ch = backend.channel(`call:${c.id}`, { presenceKey: me.id });
    room.current = ch;
    ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const s = payload as { from: string; to: string; type: string; data: unknown };
      if (s.to !== me.id) return;
      const p = peerFor(s.from);
      try {
        if (s.type === "offer") {
          await p.pc.setRemoteDescription(s.data as RTCSessionDescriptionInit);
          for (const q of p.queued.splice(0)) await p.pc.addIceCandidate(q).catch(() => {});
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          signal(s.from, "answer", ans);
        } else if (s.type === "answer") {
          await p.pc.setRemoteDescription(s.data as RTCSessionDescriptionInit);
          for (const q of p.queued.splice(0)) await p.pc.addIceCandidate(q).catch(() => {});
        } else if (s.type === "ice") {
          if (p.pc.remoteDescription) await p.pc.addIceCandidate(s.data as RTCIceCandidateInit).catch(() => {});
          else p.queued.push(s.data as RTCIceCandidateInit);
        }
      } catch (e) { console.warn("signal", e); }
    });
    ch.on("presence", { event: "sync" }, () => {
      const here = Object.keys(ch.presenceState()).filter((u) => u !== me.id);
      for (const u of here) if (!peers.current.has(u) && me.id < u) call(u);
      for (const u of [...peers.current.keys()]) if (!here.includes(u)) drop(u);
    });
    ch.subscribe((st) => { if (st === "SUBSCRIBED") ch.track({ at: Date.now() }); });
  }, [backend, call, drop, getMedia, leave, me.id, peerFor, signal]);

  const start = useCallback(async (o: { conversationId?: string; eventId?: string; kind: "voice" | "video" }) => {
    const media = await getMedia(o.kind);
    if (!media) return;
    try {
      const existing = db.calls.find((k) => isLive(k, db.call_participants) && ((o.conversationId && k.conversation_id === o.conversationId) || (o.eventId && k.event_id === o.eventId)));
      const c = existing ?? await backend.insert("calls", { conversation_id: o.conversationId ?? null, event_id: o.eventId ?? null, started_by: me.id, kind: o.kind, status: "ringing" });
      await enter(c, media);
    } catch (e) { media.getTracks().forEach((tr) => tr.stop()); toast(t((e as Error).message), "error"); }
  }, [backend, db.calls, db.call_participants, enter, getMedia, me.id, toast]);

  // Leave cleanly if the tab closes.
  useEffect(() => {
    const bye = () => { const l = liveRef.current; if (l) backend.rpc("leave_call", { p_call: l.call.id }).catch(() => {}); };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [backend]);

  // Incoming: a call in one of my chats/meetings that started in the last minute and I am not in.
  const ringing = useMemo(() => db.calls.find((k) => k.status !== "ended" && k.started_by !== me.id && !dismissed.has(k.id)
    && Date.now() - new Date(k.started_at).getTime() < 60000 && live?.call.id !== k.id
    && !db.call_participants.some((p) => p.call_id === k.id && p.user_id === me.id && !p.left_at)
    && (k.conversation_id ? db.conversation_members.some((m) => m.conversation_id === k.conversation_id && m.user_id === me.id) : true)), [db.calls, db.call_participants, db.conversation_members, dismissed, me.id, live]);

  const ctx = useMemo<Ctx>(() => ({ current: live, start, join: enter }), [live, start, enter]);
  return (
    <CallCtx.Provider value={ctx}>
      {children}
      <AnimatePresence>{ringing && !live && <Incoming key={ringing.id} call={ringing} onAccept={() => enter(ringing)} onDecline={() => setDismissed((d) => new Set(d).add(ringing.id))} />}</AnimatePresence>
      <AnimatePresence>{live && <CallScreen key="call" live={live} setLive={setLive} peers={peers.current} localRef={localRef} onLeave={leave} />}</AnimatePresence>
    </CallCtx.Provider>
  );
}

/* --------------------------------------------------------------- ringing -- */
function Incoming({ call, onAccept, onDecline }: { call: Call; onAccept: () => void; onDecline: () => void }) {
  const { person, db } = useStore();
  const who = person(call.started_by);
  const conv = db.conversations.find((c) => c.id === call.conversation_id);
  const ev = db.events.find((e) => e.id === call.event_id);
  useEffect(() => {
    const stopRing = ringIncoming();
    buzz([400, 200, 400]);
    const vib = setInterval(() => buzz([400, 200, 400]), 3000);
    const stop = setTimeout(onDecline, 45000);
    return () => { stopRing(); clearInterval(vib); clearTimeout(stop); };
  }, [onDecline]);
  return (
    <motion.div className="incoming" initial={{ y: -120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -120, opacity: 0 }}>
      <Avatar p={who} size={52} />
      <div className="grow">
        <b>{who?.full_name ?? t("Someone")}</b>
        <small>{ev ? t("Meeting: {title}", { title: ev.title }) : conv?.kind === "group" ? `${conv.name} · ` : ""}{call.kind === "voice" ? t("Voice call") : t("Video call")}</small>
      </div>
      <motion.button type="button" className="ring-btn no" whileTap={{ scale: 0.9 }} onClick={onDecline} aria-label={t("Decline")}><PhoneOff size={22} /></motion.button>
      <motion.button type="button" className="ring-btn yes" whileTap={{ scale: 0.9 }} animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} onClick={onAccept} aria-label={t("Answer")}>
        {call.kind === "voice" ? <Phone size={22} /> : <Video size={22} />}
      </motion.button>
    </motion.div>
  );
}

/* ------------------------------------------------------------ in a call -- */
function CallScreen({ live, setLive, peers, localRef, onLeave }: {
  live: Live; setLive: (f: (l: Live | null) => Live | null) => void; peers: Map<string, Peer>; localRef: React.MutableRefObject<MediaStream | null>; onLeave: () => void;
}) {
  const { person, db } = useStore();
  const toast = useToast();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const ids = Object.keys(live.peers);
  // Sounds: "connecting" tone while alone, chime when people join or leave.
  const alone = ids.length === 0;
  useEffect(() => { if (!alone) return; return ringOutgoing(); }, [alone]);
  const prevCount = useRef(0);
  useEffect(() => {
    if (ids.length > prevCount.current) playJoined();
    else if (ids.length < prevCount.current) playEnded();
    prevCount.current = ids.length;
  }, [ids.length]);
  const conv = db.conversations.find((c) => c.id === live.call.conversation_id);
  const ev = db.events.find((e) => e.id === live.call.event_id);
  const secs = Math.floor((now - live.started) / 1000);
  const title = ev?.title ?? (conv?.kind === "direct" ? person(ids[0])?.full_name : conv?.name) ?? t("Call");

  const replaceVideo = async (track: MediaStreamTrack | null) => {
    for (const p of peers.values()) {
      const tr = p.pc.getTransceivers().find((x) => x.receiver.track?.kind === "video");
      if (tr) await tr.sender.replaceTrack(track).catch(() => {});
    }
  };
  const toggleMute = () => { localRef.current?.getAudioTracks().forEach((tr) => (tr.enabled = live.muted)); setLive((l) => l && { ...l, muted: !l.muted }); };
  const toggleCam = async () => {
    let v = localRef.current?.getVideoTracks()[0];
    if (!v) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: live.front ? "user" : "environment" } });
        v = s.getVideoTracks()[0]!; localRef.current?.addTrack(v); await replaceVideo(v);
        setLive((l) => l && { ...l, camOff: false, local: localRef.current });
      } catch { toast(t("Camera not available"), "error"); }
      return;
    }
    v.enabled = live.camOff;
    await replaceVideo(live.camOff ? v : null);
    setLive((l) => l && { ...l, camOff: !l.camOff });
  };
  const flip = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: live.front ? "environment" : "user" } });
      const nv = s.getVideoTracks()[0]!;
      const old = localRef.current?.getVideoTracks()[0];
      if (old) { localRef.current!.removeTrack(old); old.stop(); }
      localRef.current?.addTrack(nv); await replaceVideo(nv);
      setLive((l) => l && { ...l, front: !l.front, local: localRef.current });
    } catch { toast(t("Could not switch camera"), "error"); }
  };
  const share = async () => {
    if (live.sharing) {
      await replaceVideo(localRef.current?.getVideoTracks()[0] ?? null);
      setLive((l) => l && { ...l, sharing: false });
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const tr = s.getVideoTracks()[0]!;
      tr.onended = () => { replaceVideo(localRef.current?.getVideoTracks()[0] ?? null); setLive((l) => l && { ...l, sharing: false }); };
      await replaceVideo(tr);
      setLive((l) => l && { ...l, sharing: true });
    } catch { /* cancelled */ }
  };
  const canShare = typeof navigator.mediaDevices?.getDisplayMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;

  return (
    <motion.div className="call-screen" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <div className="call-top"><b>{title}</b><small>{ids.length ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · ${t("{n} in call", { n: ids.length + 1 })}` : t("Calling…")}</small></div>
      <div className={`call-grid n${Math.min(ids.length, 4)}`}>
        {ids.map((uid) => <Tile key={uid} stream={live.peers[uid]!} name={person(uid)?.full_name ?? ""} p={person(uid)} />)}
        {!ids.length && <div className="call-wait"><Avatar p={person(conv?.kind === "direct" ? db.conversation_members.find((m) => m.conversation_id === conv.id && m.user_id !== live.call.started_by)?.user_id ?? live.call.started_by : live.call.started_by)} size={96} /><p>{t("Waiting for others to join…")}</p></div>}
      </div>
      {live.local && <SelfView stream={live.local} off={live.camOff} />}
      <div className="call-ctrl">
        <CtrlBtn on={!live.muted} onClick={toggleMute} label={live.muted ? t("Unmute") : t("Mute")}>{live.muted ? <MicOff size={22} /> : <Mic size={22} />}</CtrlBtn>
        <CtrlBtn on={!live.camOff} onClick={toggleCam} label={live.camOff ? t("Camera on") : t("Camera off")}>{live.camOff ? <VideoOff size={22} /> : <Video size={22} />}</CtrlBtn>
        {!live.camOff && !canShare && <CtrlBtn on onClick={flip} label={t("Switch camera")}><RefreshCw size={22} /></CtrlBtn>}
        {canShare && <CtrlBtn on={live.sharing} onClick={share} label={live.sharing ? t("Stop sharing") : t("Share screen")}><MonitorUp size={22} /></CtrlBtn>}
        <motion.button type="button" className="ctrl hang" whileTap={{ scale: 0.9 }} onClick={onLeave} aria-label={t("Leave call")}><PhoneOff size={24} /></motion.button>
      </div>
    </motion.div>
  );
}

function CtrlBtn({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return <motion.button type="button" className={`ctrl ${on ? "" : "off"}`} whileTap={{ scale: 0.9 }} onClick={onClick} aria-label={label} title={label}>{children}</motion.button>;
}

function Tile({ stream, name, p }: { stream: MediaStream; name: string; p: ReturnType<ReturnType<typeof useStore>["person"]> }) {
  const v = useRef<HTMLVideoElement>(null);
  const [hasVideo, setHasVideo] = useState(false);
  useEffect(() => {
    if (v.current && v.current.srcObject !== stream) v.current.srcObject = stream;
    const check = () => setHasVideo(stream.getVideoTracks().some((tr) => tr.enabled && tr.readyState === "live" && !tr.muted));
    check();
    const i = setInterval(check, 1000);
    return () => clearInterval(i);
  }, [stream]);
  return (
    <div className="tile-v">
      <video ref={v} autoPlay playsInline style={{ opacity: hasVideo ? 1 : 0 }} />
      {!hasVideo && <div className="tile-av"><Avatar p={p} size={88} /></div>}
      <span className="tile-name">{name}</span>
    </div>
  );
}

function SelfView({ stream, off }: { stream: MediaStream; off: boolean }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (v.current) v.current.srcObject = stream; }, [stream]);
  return <motion.div className="self-view" drag dragMomentum={false} style={{ opacity: off ? 0 : 1 }}><video ref={v} autoPlay playsInline muted /></motion.div>;
}
