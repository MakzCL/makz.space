import { AnimatePresence, animate, motion, useMotionValue } from "motion/react";
import { Mic, MicOff, MonitorUp, Phone, PhoneOff, RefreshCw, Video, VideoOff } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
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
 * - Signalling travels over a Supabase Realtime room `call:<id>`; presence in
 *   that room tells us who is in the call.
 *
 * Negotiation, kept deliberately simple and deterministic:
 * - Of each pair, the person with the smaller id is the OFFERER. Only the offerer
 *   creates the audio + video transceivers (always both, so cameras/screens can be
 *   switched later with replaceTrack and no renegotiation).
 * - The ANSWERER never adds transceivers of its own: it takes the ones the offer
 *   creates and attaches its microphone/camera to them. That way its media always
 *   travels on the negotiated slots.
 * - Camera / mic / screen state is sent as a message ("state"), so the other side
 *   shows the avatar instead of a frozen last frame when a camera goes off.
 * - Peers are dropped on an explicit "bye" or a presence leave (never because a
 *   presence list was briefly behind). A failed connection is restarted by the
 *   offerer; the answerer "knocks" to ask for a fresh offer.
 */
const STUN: RTCIceServer[] = [
  { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] },
];
const TURN_URL = import.meta.env.VITE_TURN_URL as string | undefined;
let iceCache: { servers: RTCIceServer[]; at: number } | null = null;

/** Video sender limits: camera vs. screen share (higher frame rate + bit rate). */
const CAM = { maxBitrate: 1_500_000, maxFramerate: 30 };
const SCREEN = { maxBitrate: 6_000_000, maxFramerate: 30 };
const NO_ANSWER_MS = 45_000;

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

/** A call is worth joining if someone is in it, or it started ringing in the last 75 s. */
export function isLive(k: Call, parts: { call_id: string; left_at: string | null }[]) {
  if (k.status === "ended") return false;
  if (parts.some((p) => p.call_id === k.id && !p.left_at)) return true;
  return Date.now() - new Date(k.started_at).getTime() < 75_000;
}

interface PeerState { cam: boolean; mic: boolean; share: boolean }
interface Peer { pc: RTCPeerConnection; stream: MediaStream; queued: RTCIceCandidateInit[]; offerer: boolean }
interface Live {
  call: Call; local: MediaStream | null; peers: Record<string, MediaStream>; states: Record<string, PeerState>;
  muted: boolean; camOff: boolean; sharing: boolean; front: boolean; started: number; connectedAt: number | null;
}

interface Ctx {
  current: Live | null;
  start: (o: { conversationId?: string; eventId?: string; kind: "voice" | "video" }) => Promise<void>;
  join: (c: Call) => Promise<void>;
}
const CallCtx = createContext<Ctx>({ current: null, start: async () => {}, join: async () => {} });
export const useCalls = () => useContext(CallCtx);

async function tuneVideo(sender: RTCRtpSender, screen: boolean) {
  try {
    const p = sender.getParameters();
    if (!p.encodings?.length) p.encodings = [{}];
    const lim = screen ? SCREEN : CAM;
    p.encodings[0]!.maxBitrate = lim.maxBitrate;
    p.encodings[0]!.maxFramerate = lim.maxFramerate;
    (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = "balanced";
    await sender.setParameters(p);
  } catch { /* not supported before the connection is up — retried on connect */ }
}

export function CallProvider({ children }: { children: ReactNode }) {
  const { db, me, backend, refresh, ready } = useStore();
  const toast = useToast();
  const [live, setLive] = useState<Live | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const peers = useRef<Map<string, Peer>>(new Map());
  const states = useRef<Map<string, PeerState>>(new Map());
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const knockTimers = useRef<Map<string, number>>(new Map());
  const room = useRef<ReturnType<typeof backend.channel> | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const iceRef = useRef<RTCIceServer[]>(STUN);
  const liveRef = useRef<Live | null>(null);
  liveRef.current = live;

  const sync = useCallback(() => setLive((l) => {
    if (!l) return l;
    const ps = Object.fromEntries([...peers.current.entries()].map(([k, p]) => [k, p.stream]));
    const connected = [...peers.current.values()].some((p) => p.pc.connectionState === "connected");
    return { ...l, peers: ps, states: Object.fromEntries(states.current), connectedAt: l.connectedAt ?? (connected ? Date.now() : null) };
  }), []);

  const signal = useCallback((to: string, type: string, data?: unknown) => {
    room.current?.send({ type: "broadcast", event: "signal", payload: { from: me.id, to, type, data } });
  }, [me.id]);

  /** What my video slot should carry right now: the screen, the camera, or nothing. */
  const outgoingVideo = useCallback(() => {
    const l = liveRef.current;
    if (screenRef.current && l?.sharing) return screenRef.current;
    if (l?.camOff) return null;
    return localRef.current?.getVideoTracks()[0] ?? null;
  }, []);

  const myState = useCallback((): PeerState => {
    const l = liveRef.current;
    return { cam: !!l && !l.camOff && !!localRef.current?.getVideoTracks()[0], mic: !!l && !l.muted, share: !!l?.sharing };
  }, []);
  const sendState = useCallback((to = "*") => signal(to, "state", myState()), [signal, myState]);

  const drop = useCallback((uid: string) => {
    const p = peers.current.get(uid);
    clearTimeout(knockTimers.current.get(uid)); knockTimers.current.delete(uid);
    if (!p) return;
    p.pc.onconnectionstatechange = null; p.pc.ontrack = null; p.pc.onicecandidate = null;
    p.pc.close(); peers.current.delete(uid); states.current.delete(uid); sync();
  }, [sync]);

  const makePeer = useCallback((uid: string, offerer: boolean) => {
    const pc = new RTCPeerConnection({ iceServers: iceRef.current });
    const p: Peer = { pc, stream: new MediaStream(), queued: pendingIce.current.get(uid) ?? [], offerer };
    pendingIce.current.delete(uid);
    peers.current.set(uid, p);
    if (offerer) {
      const local = localRef.current;
      const streams = local ? [local] : [];
      pc.addTransceiver(local?.getAudioTracks()[0] ?? "audio", { direction: "sendrecv", streams });
      const v = pc.addTransceiver(outgoingVideo() ?? "video", { direction: "sendrecv", streams });
      tuneVideo(v.sender, !!liveRef.current?.sharing);
    }
    pc.onicecandidate = (e) => { if (e.candidate) signal(uid, "ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      e.track.onmute = sync; e.track.onunmute = sync;
      sync();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") {
        sendState(uid);
        const vs = pc.getTransceivers().find((x) => x.receiver.track.kind === "video");
        if (vs) tuneVideo(vs.sender, !!liveRef.current?.sharing);
      }
      if (st === "failed") {
        if (p.offerer) restart(uid); // eslint-disable-line @typescript-eslint/no-use-before-define
        else signal(uid, "knock");
      }
      sync();
    };
    sync();
    return p;
  }, [outgoingVideo, sendState, signal, sync]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Offerer side: open (or re-open) the connection to `uid`. */
  const call = useCallback(async (uid: string) => {
    if (peers.current.get(uid)) drop(uid);
    const p = makePeer(uid, true);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    signal(uid, "offer", offer);
  }, [drop, makePeer, signal]);

  const restart = useCallback(async (uid: string) => {
    const p = peers.current.get(uid);
    if (!p || !p.offerer) return call(uid);
    try {
      const offer = await p.pc.createOffer({ iceRestart: true });
      await p.pc.setLocalDescription(offer);
      signal(uid, "offer", offer);
    } catch { call(uid); }
  }, [call, signal]);

  const leave = useCallback(async (opts?: { quiet?: boolean }) => {
    const l = liveRef.current;
    if (l && !opts?.quiet) playEnded();
    signal("*", "bye");
    for (const uid of [...peers.current.keys()]) drop(uid);
    for (const tm of knockTimers.current.values()) clearTimeout(tm);
    knockTimers.current.clear(); pendingIce.current.clear(); states.current.clear();
    localRef.current?.getTracks().forEach((tr) => tr.stop());
    screenRef.current?.stop(); screenRef.current = null;
    localRef.current = null;
    if (room.current) { backend.removeChannel(room.current); room.current = null; }
    setLive(null);
    if (l) { await backend.rpc("leave_call", { p_call: l.call.id }).catch(() => {}); refresh("calls"); refresh("call_participants"); }
  }, [backend, drop, refresh, signal]);

  /** Microphone (+ camera for video). Asked for before anything is created, so a refused permission leaves nothing behind. */
  const getMedia = useCallback(async (kind: Call["kind"]): Promise<MediaStream | null> => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: kind === "video" ? { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } : false,
      });
    } catch {
      try { const a = await navigator.mediaDevices.getUserMedia({ audio: true }); if (kind === "video") toast(t("Camera not available — joining with sound only"), "info"); return a; }
      catch { toast(t("Allow the microphone to join calls — tap the lock icon by the address, or Settings → Apps → your browser → Permissions"), "error"); return null; }
    }
  }, [toast]);

  const enter = useCallback(async (c: Call, media?: MediaStream) => {
    if (liveRef.current) { if (liveRef.current.call.id === c.id) return; await leave({ quiet: true }); }
    const local = media ?? await getMedia(c.kind);
    if (!local) return;
    localRef.current = local;
    iceRef.current = await iceServers(await backend.accessToken());
    try { await backend.rpc("join_call", { p_call: c.id }); }
    catch (e) { local.getTracks().forEach((tr) => tr.stop()); localRef.current = null; toast(t((e as Error).message), "error"); return; }
    const camOff = !local.getVideoTracks()[0];
    const l: Live = { call: c, local, peers: {}, states: {}, muted: false, camOff, sharing: false, front: true, started: Date.now(), connectedAt: null };
    liveRef.current = l; setLive(l);
    const ch = backend.channel(`call:${c.id}`, { presenceKey: me.id });
    room.current = ch;
    ch.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const s = payload as { from: string; to: string; type: string; data: unknown };
      if (s.from === me.id || (s.to !== me.id && s.to !== "*")) return;
      try {
        if (s.type === "offer") {
          let p = peers.current.get(s.from);
          if (p && p.offerer) { drop(s.from); p = undefined; }
          if (!p) p = makePeer(s.from, false);
          await p.pc.setRemoteDescription(s.data as RTCSessionDescriptionInit);
          // Attach my mic/camera to the slots the offer created.
          const local2 = localRef.current;
          for (const tr of p.pc.getTransceivers()) {
            const kind = tr.receiver.track.kind;
            tr.direction = "sendrecv";
            const track = kind === "audio" ? local2?.getAudioTracks()[0] ?? null : outgoingVideo();
            if (tr.sender.track !== track) await tr.sender.replaceTrack(track).catch(() => {});
            if (local2) tr.sender.setStreams?.(local2);
            if (kind === "video") tuneVideo(tr.sender, !!liveRef.current?.sharing);
          }
          for (const q of p.queued.splice(0)) await p.pc.addIceCandidate(q).catch(() => {});
          const ans = await p.pc.createAnswer();
          await p.pc.setLocalDescription(ans);
          signal(s.from, "answer", ans);
        } else if (s.type === "answer") {
          const p = peers.current.get(s.from);
          if (!p || p.pc.signalingState !== "have-local-offer") return;
          await p.pc.setRemoteDescription(s.data as RTCSessionDescriptionInit);
          for (const q of p.queued.splice(0)) await p.pc.addIceCandidate(q).catch(() => {});
        } else if (s.type === "ice") {
          const p = peers.current.get(s.from);
          const cand = s.data as RTCIceCandidateInit;
          if (p?.pc.remoteDescription) await p.pc.addIceCandidate(cand).catch(() => {});
          else if (p) p.queued.push(cand);
          else pendingIce.current.set(s.from, [...(pendingIce.current.get(s.from) ?? []), cand]);
        } else if (s.type === "state") {
          states.current.set(s.from, s.data as PeerState); sync();
        } else if (s.type === "knock") {
          if (me.id < s.from) call(s.from);
        } else if (s.type === "bye") {
          drop(s.from);
        }
      } catch (e) { console.warn("signal", s.type, e); }
    });
    const meet = () => {
      const here = Object.keys(ch.presenceState()).filter((u) => u !== me.id);
      for (const u of here) {
        if (peers.current.has(u)) continue;
        if (me.id < u) call(u);
        else if (!knockTimers.current.has(u)) {
          // They should call me; if no offer arrives soon, ask for one.
          knockTimers.current.set(u, window.setTimeout(() => { knockTimers.current.delete(u); if (!peers.current.has(u)) signal(u, "knock"); }, 2500));
        }
      }
    };
    ch.on("presence", { event: "sync" }, meet);
    ch.on("presence", { event: "leave" }, ({ key }: { key: string }) => { if (key && key !== me.id) drop(key); });
    ch.subscribe((st) => { if (st === "SUBSCRIBED") { ch.track({ at: Date.now() }); sendState(); } });
  }, [backend, call, drop, getMedia, leave, makePeer, me.id, outgoingVideo, sendState, signal, sync, toast]);

  const start = useCallback(async (o: { conversationId?: string; eventId?: string; kind: "voice" | "video" }) => {
    const media = await getMedia(o.kind);
    if (!media) return;
    try {
      const existing = db.calls.find((k) => isLive(k, db.call_participants) && ((o.conversationId && k.conversation_id === o.conversationId) || (o.eventId && k.event_id === o.eventId)));
      const c = existing ?? await backend.insert("calls", { conversation_id: o.conversationId ?? null, event_id: o.eventId ?? null, started_by: me.id, kind: o.kind, status: "ringing" });
      await enter(c, media);
    } catch (e) { media.getTracks().forEach((tr) => tr.stop()); toast(t((e as Error).message), "error"); }
  }, [backend, db.calls, db.call_participants, enter, getMedia, me.id, toast]);

  /* ---- controls (used by the call screen) ---- */
  const replaceVideo = useCallback(async () => {
    const track = outgoingVideo();
    for (const p of peers.current.values()) {
      const tr = p.pc.getTransceivers().find((x) => x.receiver.track.kind === "video");
      if (!tr) continue;
      await tr.sender.replaceTrack(track).catch(() => {});
      tuneVideo(tr.sender, !!liveRef.current?.sharing);
    }
  }, [outgoingVideo]);

  const set = useCallback((patch: Partial<Live>) => {
    const l = liveRef.current; if (!l) return;
    const n = { ...l, ...patch }; liveRef.current = n; setLive(n);
  }, []);

  const controls = useMemo(() => ({
    toggleMute: () => {
      const l = liveRef.current; if (!l) return;
      localRef.current?.getAudioTracks().forEach((tr) => (tr.enabled = l.muted));
      set({ muted: !l.muted }); sendState();
    },
    toggleCam: async () => {
      const l = liveRef.current; if (!l) return;
      const local = localRef.current;
      if (!l.camOff) {
        // Off: stop sending and release the camera (its light goes off), tell everyone.
        const v = local?.getVideoTracks()[0];
        set({ camOff: true }); await replaceVideo();
        if (v && local) { local.removeTrack(v); v.stop(); }
        set({ local: local ? new MediaStream(local.getTracks()) : null }); localRef.current = liveRef.current?.local ?? null;
        sendState(); return;
      }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: l.front ? "user" : "environment", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
        const v = s.getVideoTracks()[0]!;
        const next = new MediaStream([...(local?.getAudioTracks() ?? []), v]);
        localRef.current = next; set({ camOff: false, local: next });
        await replaceVideo(); sendState();
      } catch { toast(t("Camera not available"), "error"); }
    },
    flip: async () => {
      const l = liveRef.current; if (!l || l.camOff) return;
      try {
        const old = localRef.current?.getVideoTracks()[0];
        old?.stop(); // some phones can't open both cameras at once
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: l.front ? "environment" : "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
        const nv = s.getVideoTracks()[0]!;
        const next = new MediaStream([...(localRef.current?.getAudioTracks() ?? []), nv]);
        localRef.current = next; set({ front: !l.front, local: next });
        await replaceVideo();
      } catch { toast(t("Could not switch camera"), "error"); }
    },
    share: async () => {
      const l = liveRef.current; if (!l) return;
      if (l.sharing) {
        screenRef.current?.stop(); screenRef.current = null;
        set({ sharing: false }); await replaceVideo(); sendState(); return;
      }
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30, max: 60 }, width: { ideal: 1920, max: 2560 }, height: { ideal: 1080, max: 1440 } },
          audio: false,
        });
        const tr = s.getVideoTracks()[0]!;
        try { tr.contentHint = "detail"; } catch { /* older browsers */ }
        tr.onended = () => { if (screenRef.current === tr) { screenRef.current = null; set({ sharing: false }); replaceVideo(); sendState(); } };
        screenRef.current = tr;
        set({ sharing: true }); await replaceVideo(); sendState();
      } catch { /* cancelled */ }
    },
  }), [replaceVideo, sendState, set, toast]);

  // Leave cleanly if the tab closes.
  useEffect(() => {
    const bye = () => { const l = liveRef.current; if (l) { signal("*", "bye"); backend.rpc("leave_call", { p_call: l.call.id }).catch(() => {}); } };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, [backend, signal]);

  // The call was ended (e.g. the other person hung up a 1:1 call): leave too.
  const myCall = live ? db.calls.find((k) => k.id === live.call.id) : undefined;
  useEffect(() => { if (myCall?.status === "ended" && liveRef.current) leave(); }, [myCall?.status, leave]);

  // Answer straight from the notification (Answer button) or a ?answer=<call> link.
  const answerById = useCallback((id: string) => {
    const k = db.calls.find((x) => x.id === id);
    if (k && k.status !== "ended") enter(k);
    else if (k) toast(t("That call has ended"), "info");
  }, [db.calls, enter, toast]);
  const pendingAnswer = useRef<string | null>(new URLSearchParams(location.search).get("answer"));
  useEffect(() => {
    const id = pendingAnswer.current;
    if (!id || !ready || !db.calls.some((x) => x.id === id)) return;
    pendingAnswer.current = null;
    const q = new URLSearchParams(location.search); q.delete("answer");
    history.replaceState(null, "", location.pathname + (q.toString() ? `?${q}` : ""));
    answerById(id);
  }, [ready, db.calls, answerById]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.type === "answer" && e.data.call_id) answerById(e.data.call_id);
      if (e.data?.type === "decline" && e.data.call_id) setDismissed((d) => new Set(d).add(e.data.call_id));
    };
    navigator.serviceWorker?.addEventListener("message", on);
    return () => navigator.serviceWorker?.removeEventListener("message", on);
  }, [answerById]);

  // Incoming: a call in one of my chats/meetings that is ringing and I am not in.
  const ringing = useMemo(() => db.calls.find((k) => k.status !== "ended" && k.started_by !== me.id && !dismissed.has(k.id)
    && Date.now() - new Date(k.started_at).getTime() < 75_000 && live?.call.id !== k.id
    && !db.call_participants.some((p) => p.call_id === k.id && p.user_id === me.id && !p.left_at)
    && (k.conversation_id ? db.conversation_members.some((m) => m.conversation_id === k.conversation_id && m.user_id === me.id) : true)), [db.calls, db.call_participants, db.conversation_members, dismissed, me.id, live]);

  const ctx = useMemo<Ctx>(() => ({ current: live, start, join: enter }), [live, start, enter]);
  return (
    <CallCtx.Provider value={ctx}>
      {children}
      <AnimatePresence>{ringing && !live && <Incoming key={ringing.id} call={ringing} onAccept={() => enter(ringing)} onDecline={() => setDismissed((d) => new Set(d).add(ringing.id))} />}</AnimatePresence>
      <AnimatePresence>{live && <CallScreen key="call" live={live} controls={controls} onLeave={() => leave()} />}</AnimatePresence>
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
    const stop = setTimeout(onDecline, 60000);
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
type Controls = { toggleMute: () => void; toggleCam: () => Promise<void>; flip: () => Promise<void>; share: () => Promise<void> };

function CallScreen({ live, controls, onLeave }: { live: Live; controls: Controls; onLeave: () => void }) {
  const { person, db } = useStore();
  const toast = useToast();
  const screen = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const ctrl = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const ids = Object.keys(live.peers);
  const conv = db.conversations.find((c) => c.id === live.call.conversation_id);
  const ev = db.events.find((e) => e.id === live.call.event_id);
  const direct = conv?.kind === "direct";
  const everConnected = live.connectedAt !== null;

  // "Calling…" tone only before anyone has picked up — never after someone hangs up.
  const waiting = ids.length === 0 && !everConnected;
  useEffect(() => { if (!waiting) return; return ringOutgoing(); }, [waiting]);
  const prevCount = useRef(0);
  useEffect(() => {
    if (ids.length > prevCount.current) playJoined();
    else if (ids.length < prevCount.current && ids.length > 0) playEnded();
    prevCount.current = ids.length;
  }, [ids.length]);

  // 1:1: when the other person hangs up, the call is over for me too.
  useEffect(() => {
    if (!direct || !everConnected || ids.length > 0) return;
    const tm = setTimeout(onLeave, 1500); // allow a moment for a reconnect blip
    return () => clearTimeout(tm);
  }, [direct, everConnected, ids.length, onLeave]);
  // Nobody answered.
  useEffect(() => {
    if (everConnected || ids.length > 0) return;
    const tm = setTimeout(() => { toast(direct ? t("No answer") : t("Nobody joined"), "info"); onLeave(); }, NO_ANSWER_MS);
    return () => clearTimeout(tm);
  }, [everConnected, ids.length, direct, onLeave, toast]);
  // Group call: alone for a minute after everyone left → end.
  useEffect(() => {
    if (direct || !everConnected || ids.length > 0) return;
    const tm = setTimeout(onLeave, 60_000);
    return () => clearTimeout(tm);
  }, [direct, everConnected, ids.length, onLeave]);

  const secs = Math.floor((now - (live.connectedAt ?? live.started)) / 1000);
  const title = ev?.title ?? (direct ? person(ids[0] ?? db.conversation_members.find((m) => m.conversation_id === conv?.id && m.user_id !== live.call.started_by)?.user_id)?.full_name : conv?.name) ?? t("Call");
  const canShare = typeof navigator.mediaDevices?.getDisplayMedia === "function" && window.matchMedia("(min-width: 1024px)").matches;
  const status = ids.length ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")} · ${t("{n} in call", { n: ids.length + 1 })}`
    : everConnected ? t("Everyone else has left") : t("Calling…");

  return (
    <motion.div ref={screen} className="call-screen" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <div ref={top} className="call-top"><b>{title}</b><small>{status}</small></div>
      <div className={`call-grid n${Math.min(ids.length, 4)}`}>
        {ids.map((uid) => <Tile key={uid} stream={live.peers[uid]!} state={live.states[uid]} name={person(uid)?.full_name ?? ""} p={person(uid)} />)}
        {!ids.length && <div className="call-wait"><Avatar p={person(direct ? db.conversation_members.find((m) => m.conversation_id === conv!.id && m.user_id !== live.call.started_by)?.user_id ?? live.call.started_by : live.call.started_by)} size={96} /><p>{everConnected ? t("Everyone else has left") : t("Waiting for others to join…")}</p></div>}
      </div>
      {live.local && !live.camOff && <SelfView stream={live.local} mirror={live.front} bounds={screen} top={top} bottom={ctrl} />}
      <div ref={ctrl} className="call-ctrl">
        <CtrlBtn on={!live.muted} onClick={controls.toggleMute} label={live.muted ? t("Unmute") : t("Mute")}>{live.muted ? <MicOff size={22} /> : <Mic size={22} />}</CtrlBtn>
        <CtrlBtn on={!live.camOff} onClick={controls.toggleCam} label={live.camOff ? t("Camera on") : t("Camera off")}>{live.camOff ? <VideoOff size={22} /> : <Video size={22} />}</CtrlBtn>
        {!live.camOff && !canShare && <CtrlBtn on onClick={controls.flip} label={t("Switch camera")}><RefreshCw size={22} /></CtrlBtn>}
        {canShare && <CtrlBtn on={!live.sharing} onClick={controls.share} label={live.sharing ? t("Stop sharing") : t("Share screen")}><MonitorUp size={22} /></CtrlBtn>}
        <motion.button type="button" className="ctrl hang" whileTap={{ scale: 0.9 }} onClick={onLeave} aria-label={t("Leave call")} title={t("Leave call")}><PhoneOff size={24} /></motion.button>
      </div>
    </motion.div>
  );
}

function CtrlBtn({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return <motion.button type="button" className={`ctrl ${on ? "" : "off"}`} whileTap={{ scale: 0.9 }} onClick={onClick} aria-label={label} title={label}>{children}</motion.button>;
}

function Tile({ stream, state, name, p }: { stream: MediaStream; state?: PeerState; name: string; p: ReturnType<ReturnType<typeof useStore>["person"]> }) {
  const v = useRef<HTMLVideoElement>(null);
  const [flowing, setFlowing] = useState(false);
  useEffect(() => {
    if (v.current && v.current.srcObject !== stream) { v.current.srcObject = stream; v.current.play().catch(() => {}); }
    const check = () => setFlowing(stream.getVideoTracks().some((tr) => tr.readyState === "live" && !tr.muted));
    check();
    const tracks = stream.getVideoTracks();
    tracks.forEach((tr) => { tr.addEventListener("mute", check); tr.addEventListener("unmute", check); });
    stream.addEventListener("addtrack", check);
    const i = setInterval(check, 1000);
    return () => { clearInterval(i); tracks.forEach((tr) => { tr.removeEventListener("mute", check); tr.removeEventListener("unmute", check); }); stream.removeEventListener("addtrack", check); };
  }, [stream]);
  // Their own report wins: camera off → avatar, never a frozen last frame.
  const show = flowing && (state ? state.cam || state.share : true);
  return (
    <div className={`tile-v ${state?.share ? "sharing" : ""}`}>
      <video ref={v} autoPlay playsInline style={{ opacity: show ? 1 : 0 }} />
      {!show && <div className="tile-av"><Avatar p={p} size={88} /></div>}
      <span className="tile-name">{state && !state.mic && <MicOff size={13} />}{name}</span>
    </div>
  );
}

/** Your own camera: drag it anywhere, it settles in the nearest corner and never leaves the screen. */
function SelfView({ stream, mirror, bounds, top, bottom }: {
  stream: MediaStream; mirror: boolean; bounds: RefObject<HTMLDivElement | null>; top: RefObject<HTMLDivElement | null>; bottom: RefObject<HTMLDivElement | null>;
}) {
  const v = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0), y = useMotionValue(0);
  const corner = useRef<"tl" | "tr" | "bl" | "br">("br");
  useEffect(() => { if (v.current) { v.current.srcObject = stream; v.current.play().catch(() => {}); } }, [stream]);

  const spot = useCallback((c: "tl" | "tr" | "bl" | "br") => {
    const s = bounds.current?.getBoundingClientRect(), el = box.current?.getBoundingClientRect();
    if (!s || !el) return { x: 0, y: 0 };
    const m = 12;
    const minY = (top.current?.getBoundingClientRect().bottom ?? s.top) - s.top + m;
    const maxY = (bottom.current?.getBoundingClientRect().top ?? s.bottom) - s.top - el.height - m;
    return { x: c[1] === "l" ? m : s.width - el.width - m, y: c[0] === "t" ? minY : Math.max(minY, maxY) };
  }, [bounds, top, bottom]);
  const settle = useCallback((c: "tl" | "tr" | "bl" | "br", smooth: boolean) => {
    corner.current = c;
    const p = spot(c);
    if (smooth) { animate(x, p.x, { type: "spring", stiffness: 420, damping: 34 }); animate(y, p.y, { type: "spring", stiffness: 420, damping: 34 }); }
    else { x.set(p.x); y.set(p.y); }
  }, [spot, x, y]);
  useLayoutEffect(() => { settle(corner.current, false); }, [settle]);
  useEffect(() => { const r = () => settle(corner.current, false); window.addEventListener("resize", r); return () => window.removeEventListener("resize", r); }, [settle]);

  return (
    <motion.div ref={box} className="self-view" style={{ x, y }} drag dragConstraints={bounds} dragElastic={0.08} dragMomentum={false}
      onDragEnd={() => {
        const s = bounds.current?.getBoundingClientRect(), el = box.current?.getBoundingClientRect();
        if (!s || !el) return;
        const cx = el.left + el.width / 2 - s.left, cy = el.top + el.height / 2 - s.top;
        settle(`${cy < s.height / 2 ? "t" : "b"}${cx < s.width / 2 ? "l" : "r"}` as "tl", true);
      }}>
      <video ref={v} autoPlay playsInline muted style={{ transform: mirror ? "scaleX(-1)" : "none" }} />
    </motion.div>
  );
}
