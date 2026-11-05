import { playCallSound } from "./sounds.ts";
import { CloudflareCall, type IceServer } from "./cloudflare.ts";
import { create } from "zustand";
import type {
  LocalAudioTrack, LocalVideoTrack, Room, LocalTrackPublication, RemoteParticipant, RemoteTrack,
  RemoteTrackPublication, VideoCodec,
} from "livekit-client";
// LiveKit is only needed on servers that use it (the hosted app uses Cloudflare calls), so it's
// loaded on first join instead of shipping in the startup bundle.
type LiveKit = typeof import("livekit-client");
let LK: LiveKit;
export const livekit = () => LK;
async function loadLiveKit() { LK ??= await import("livekit-client"); return LK; }
import { api, errMsg } from "../api.ts";
import { gwSend } from "../gateway.ts";
import { toast, useStore } from "../store.ts";
import { DEFAULT_VOICE, loadVoiceSettings, saveVoiceSettings, streamBitrate, type VoiceSettings } from "./settings.ts";

/**
 * Voice / video / screen sharing over a LiveKit SFU.
 *
 * Audio: Opus at 48 kHz. Bitrate, stereo, DTX, RED and the three processing
 * stages are user settings. Requested values are shown next to what the
 * encoder negotiated and what is measured on the wire (diagnostics.ts) —
 * a selector is never treated as a guarantee.
 *
 * Screen share: resolution/frame-rate targets or "Source" (no resize
 * constraint; the capture's native size). Simulcast layers let weaker viewers
 * receive a smaller layer without lowering everyone else's quality.
 */
export interface Peer { id: string; name: string; speaking: boolean; micMuted: boolean; camera: MediaStreamTrack | null; screen: MediaStreamTrack | null; screenAudio: boolean; quality: string }
export type VoiceStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

interface VS {
  channelId: string | null;
  status: VoiceStatus;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  sharing: boolean;
  pttActive: boolean;
  localSpeaking: boolean;
  peers: Record<string, Peer>;
  localCamera: MediaStreamTrack | null;
  localScreen: MediaStreamTrack | null;
  settings: VoiceSettings;
  grants: { speak: boolean; video: boolean; vad: boolean } | null;
  focus: string | null; // "<identity>:screen" | "<identity>:camera"
  layout: "grid" | "focus";
}

export const useVoice = create<VS>(() => ({
  channelId: null, status: "idle", error: null, muted: false, deafened: false, camera: false, sharing: false, pttActive: false, localSpeaking: false,
  peers: {}, localCamera: null, localScreen: null, settings: loadVoiceSettings(), grants: null, focus: null, layout: "grid",
}));
const set = useVoice.setState;
const get = useVoice.getState;

let cf: CloudflareCall | null = null;
let room: Room | null = null;
let micTrack: LocalAudioTrack | null = null;
let gainCtx: { ctx: AudioContext; gain: GainNode; dest: MediaStreamAudioDestinationNode; raw: MediaStreamTrack } | null = null;
let joinToken = 0;

export const currentRoom = () => room;
export const currentCloudflare = () => cf;

function reportState() {
  const s = get();
  gwSend("voice_state", s.channelId ? { channel_id: s.channelId, self_mute: s.muted || (s.settings.mode === "ptt" && !s.pttActive), self_deaf: s.deafened, self_video: s.camera, self_stream: s.sharing } : { channel_id: null });
}

/**
 * Show (or clear) my own name under the voice channel immediately, instead of
 * waiting for the server to echo VOICE_STATE_UPDATE back. The echo then simply
 * overwrites this with the authoritative state.
 */
function showSelf(channelId: string | null) {
  const st = useStore.getState();
  const me = st.me;
  if (!me) return;
  const voice = { ...st.voice };
  if (!channelId) {
    if (!voice[me.id]) return;
    delete voice[me.id];
  } else {
    const s = get();
    const guildId = Object.values(st.guilds).find((g) => g.channels.some((c) => c.id === channelId))?.id ?? null;
    const prev = voice[me.id];
    voice[me.id] = {
      ...(prev?.channel_id === channelId ? prev : {}),
      user_id: me.id, channel_id: channelId, guild_id: guildId,
      self_mute: s.muted || (s.settings.mode === "ptt" && !s.pttActive), self_deaf: s.deafened,
      self_video: false, self_stream: false,
      server_mute: prev?.channel_id === channelId ? prev.server_mute : false,
      server_deaf: prev?.channel_id === channelId ? prev.server_deaf : false,
    } as typeof voice[string];
  }
  useStore.setState({ voice });
}

/** Leave voice: clear my name tag locally and tell the server first, then tear media down. */
function announceLeave() {
  showSelf(null);
  gwSend("voice_state", { channel_id: null });
}

function peerFrom(p: RemoteParticipant): Peer {
  const cam = p.getTrackPublication(LK.Track.Source.Camera);
  const scr = p.getTrackPublication(LK.Track.Source.ScreenShare);
  const scrA = p.getTrackPublication(LK.Track.Source.ScreenShareAudio);
  const mic = p.getTrackPublication(LK.Track.Source.Microphone);
  return {
    id: p.identity, name: p.name || p.identity, speaking: p.isSpeaking,
    micMuted: !mic || mic.isMuted,
    camera: cam?.isSubscribed && !cam.isMuted ? cam.track?.mediaStreamTrack ?? null : null,
    screen: scr?.isSubscribed && !scr.isMuted ? scr.track?.mediaStreamTrack ?? null : null,
    screenAudio: !!scrA?.isSubscribed,
    quality: p.connectionQuality,
  };
}
function syncPeers() {
  if (!room) return;
  const peers: Record<string, Peer> = {};
  for (const p of room.remoteParticipants.values()) peers[p.identity] = peerFrom(p);
  set({ peers, localSpeaking: room.localParticipant.isSpeaking });
}

/* ------------------------------------------------------------ audio out -- */
const audioEls = new Map<string, HTMLAudioElement>();
function attachAudio(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
  if (track.kind !== LK.Track.Kind.Audio) return;
  const el = track.attach() as HTMLAudioElement;
  el.dataset.identity = p.identity;
  el.dataset.source = pub.source;
  document.body.appendChild(el);
  audioEls.set(pub.trackSid, el);
  applyOutput();
}
function detachAudio(track: RemoteTrack, pub: RemoteTrackPublication) {
  track.detach().forEach((e) => e.remove());
  audioEls.delete(pub.trackSid);
}
function applyOutput() {
  const s = get();
  for (const el of audioEls.values()) {
    const id = el.dataset.identity!;
    const key = el.dataset.source === LK.Track.Source.ScreenShareAudio ? `${id}:stream` : id;
    const v = s.deafened ? 0 : (s.settings.userVolumes[key] ?? 1);
    el.volume = Math.min(1, v);
    el.muted = s.deafened;
    if (s.settings.outputDeviceId && typeof (el as any).setSinkId === "function") (el as any).setSinkId(s.settings.outputDeviceId === "default" ? "" : s.settings.outputDeviceId).catch(() => {});
  }
  // Volumes above 100% use LiveKit's WebAudio gain per participant.
  if (room) for (const p of room.remoteParticipants.values()) {
    const v = s.deafened ? 0 : (s.settings.userVolumes[p.identity] ?? 1);
    try { p.setVolume(v, LK.Track.Source.Microphone); } catch { /* */ }
    try { p.setVolume(s.deafened ? 0 : (s.settings.userVolumes[`${p.identity}:stream`] ?? 1), LK.Track.Source.ScreenShareAudio); } catch { /* */ }
  }
}

/* ------------------------------------------------------------- mic ------- */
async function buildMic(s: VoiceSettings): Promise<LocalAudioTrack> {
  const constraints: MediaTrackConstraints = {
    deviceId: s.inputDeviceId && s.inputDeviceId !== "default" ? { exact: s.inputDeviceId } : undefined,
    echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl,
    channelCount: s.stereo ? 2 : 1, sampleRate: 48000, sampleSize: 16,
  };
  if (s.inputGain === 1) return LK.createLocalAudioTrack(constraints as any);
  // Input gain via WebAudio; the processed track is what gets published.
  const raw = (await navigator.mediaDevices.getUserMedia({ audio: constraints })).getAudioTracks()[0]!;
  const ctx = new AudioContext({ sampleRate: 48000 });
  const src = ctx.createMediaStreamSource(new MediaStream([raw]));
  const gain = ctx.createGain(); gain.gain.value = s.inputGain;
  const dest = ctx.createMediaStreamDestination(); dest.channelCount = s.stereo ? 2 : 1;
  src.connect(gain).connect(dest);
  gainCtx = { ctx, gain, dest, raw };
  return new LK.LocalAudioTrack(dest.stream.getAudioTracks()[0]!, constraints, true);
}

async function publishMic() {
  if (!room || !get().grants?.speak) return;
  const s = get().settings;
  if (micTrack) { await room.localParticipant.unpublishTrack(micTrack, true).catch(() => {}); micTrack = null; }
  if (gainCtx) { gainCtx.raw.stop(); gainCtx.ctx.close().catch(() => {}); gainCtx = null; }
  micTrack = await buildMic(s);
  await room.localParticipant.publishTrack(micTrack, {
    source: LK.Track.Source.Microphone,
    audioPreset: { maxBitrate: s.bitrate },
    dtx: s.dtx, red: s.red, forceStereo: s.stereo,
    stopMicTrackOnMute: false,
  });
  const muted = get().muted || (s.mode === "ptt" && !get().pttActive);
  if (muted) await micTrack.mute();
}

/** Apply new audio settings. Bitrate alone is changed live; stereo/DTX/RED/processing need a re-publish (SDP-level). */
export async function updateVoiceSettings(patch: Partial<VoiceSettings>) {
  const prev = get().settings;
  const next = { ...prev, ...patch, stream: { ...prev.stream, ...(patch.stream ?? {}) } };
  set({ settings: next });
  saveVoiceSettings(next);
  applyOutput();
  if (cf) { await cf.applySettings(prev,next).catch(e=>toast(`Couldn’t apply call settings: ${errMsg(e)}`,"error")); return; }
  if (!room || !micTrack) return;
  const needsRepublish = (["stereo", "dtx", "red", "echoCancellation", "noiseSuppression", "autoGainControl", "inputDeviceId"] as const).some((k) => prev[k] !== next[k])
    || (prev.inputGain === 1) !== (next.inputGain === 1);
  if (needsRepublish) { await publishMic().catch((e) => toast(`Couldn't apply audio settings: ${errMsg(e)}`, "error")); return; }
  if (gainCtx && prev.inputGain !== next.inputGain) gainCtx.gain.gain.value = next.inputGain;
  if (prev.bitrate !== next.bitrate) {
    const sender = micTrack.sender;
    if (sender) {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0]!.maxBitrate = next.bitrate;
      await sender.setParameters(params).catch(() => publishMic());
    }
  }
}

/* ------------------------------------------------------------- join ------ */
export async function joinVoice(channelId: string) {
  if (get().channelId === channelId && get().status !== "error") return;
  playCallSound("join");
  await leaveVoice({ switching: true });
  const my = ++joinToken;
  set({ channelId, status: "connecting", error: null, peers: {}, camera: false, sharing: false });
  // Show me under the channel now and tell everyone else now — media connects in the background.
  showSelf(channelId);
  reportState();
  // Ask for the microphone while the token request is in flight instead of after it.
  const mic = prewarmMic();
  try {
    const t = await api.post<{ provider?: string; session?: string; ice_servers?: IceServer[]; url: string; token: string; grants: { speak: boolean; video: boolean; vad: boolean } }>("/api/voice/token", { channel_id: channelId });
    if (my !== joinToken) { mic.discard(); return; }
    set({ grants: t.grants });
    if (!t.grants.vad && get().settings.mode === "vad") set({ settings: { ...get().settings, mode: "ptt" } });
    if (t.provider === "cloudflare" && t.session) { const call = new CloudflareCall(t.session, t.ice_servers ?? []); cf=call; call.preMic = t.grants.speak ? mic.stream : (mic.discard(), null); await call.start(); if(my!==joinToken){call.close();return;} reportState(); return; }
    mic.discard(); // LiveKit opens its own track below
    await loadLiveKit();
    if (my !== joinToken) return;
    const r = new LK.Room({
      adaptiveStream: true, // subscribe to the layer that fits the element on screen
      dynacast: true, // stop encoding layers nobody watches
      audioOutput: { deviceId: get().settings.outputDeviceId === "default" ? undefined : get().settings.outputDeviceId },
      disconnectOnPageLeave: true,
    });
    room = r;
    r.on(LK.RoomEvent.TrackSubscribed, (track, pub, p) => { attachAudio(track, pub, p); syncPeers(); })
      .on(LK.RoomEvent.TrackUnsubscribed, (track, pub) => { detachAudio(track, pub); syncPeers(); })
      .on(LK.RoomEvent.TrackMuted, syncPeers).on(LK.RoomEvent.TrackUnmuted, syncPeers)
      .on(LK.RoomEvent.ParticipantConnected, syncPeers).on(LK.RoomEvent.ParticipantDisconnected, syncPeers)
      .on(LK.RoomEvent.ActiveSpeakersChanged, syncPeers)
      .on(LK.RoomEvent.ConnectionQualityChanged, syncPeers)
      .on(LK.RoomEvent.Reconnecting, () => set({ status: "reconnecting" }))
      .on(LK.RoomEvent.Reconnected, () => { set({ status: "connected" }); reportState(); })
      .on(LK.RoomEvent.MediaDevicesError, (e) => toast(deviceError(e), "error"))
      .on(LK.RoomEvent.Disconnected, (reason) => {
        if (room !== r) return;
        cleanup();
        set({ status: "idle", channelId: null });
        announceLeave();
        if (reason !== undefined && reason !== 1 /* CLIENT_INITIATED */) toast("You were disconnected from voice.", "info");
      });
    r.localParticipant.on(LK.ParticipantEvent.IsSpeakingChanged, (sp) => set({ localSpeaking: sp }));
    await r.connect(t.url, t.token, { autoSubscribe: true });
    if (my !== joinToken) { r.disconnect(); return; }
    set({ status: "connected" });
    try { await publishMic(); }
    catch (e) { toast(deviceError(e), "error"); set({ muted: true }); }
    syncPeers();
    applyOutput();
    reportState();
  } catch (e) {
    mic.discard();
    if (my !== joinToken) return;
    if (cf) { cf.close(); cf = null; }
    cleanup();
    set({ status: "error", error: errMsg(e) });
    toast(errMsg(e), "error");
    // We announced the join up front; take it back so nobody sees me in a channel I never reached.
    announceLeave();
  }
}

/** Start getUserMedia early (same constraints the call uses). The call takes the stream if it wants it. */
function prewarmMic() {
  const s = get().settings;
  let used = false;
  const stream = navigator.mediaDevices?.getUserMedia
    ? navigator.mediaDevices.getUserMedia({ audio: micConstraints(s), video: false })
    : Promise.reject(new Error("Microphone not available"));
  stream.catch(() => {}); // a refusal is reported when the call actually uses it
  return {
    get stream() { used = true; return stream; },
    discard() { if (used) return; used = true; stream.then((m) => m.getTracks().forEach((tr) => tr.stop()), () => {}); },
  };
}

export function micConstraints(s: VoiceSettings): MediaTrackConstraints {
  return {
    deviceId: s.inputDeviceId && s.inputDeviceId !== "default" ? { exact: s.inputDeviceId } : undefined,
    echoCancellation: s.echoCancellation, noiseSuppression: s.noiseSuppression, autoGainControl: s.autoGainControl,
    channelCount: s.stereo ? 2 : 1, sampleRate: 48000,
  };
}

function cleanup() {
  for (const el of audioEls.values()) el.remove();
  audioEls.clear();
  get().localCamera?.stop(); get().localScreen?.stop();
  if (gainCtx) { gainCtx.raw.stop(); gainCtx.ctx.close().catch(() => {}); gainCtx = null; }
  micTrack?.stop(); micTrack = null;
  room = null;
  set({ peers: {}, localCamera: null, localScreen: null, camera: false, sharing: false, focus: null });
}

export async function leaveVoice(opts: { switching?: boolean } = {}) {
  joinToken++;
  const had = get().channelId;
  // The name tag disappears and the server hears about it before any media teardown.
  // (When switching channels, the join that follows announces the new channel itself.)
  if (had && !opts.switching) announceLeave();
  if (cf) { cf.close(); cf = null; }
  const r = room;
  if (r) {
    // Stop every capture so the browser's camera/mic/screen indicators turn off.
    for (const pub of r.localParticipant.trackPublications.values()) pub.track?.stop();
    await r.disconnect(true).catch(() => {});
  }
  cleanup();
  if (had && !opts.switching) playCallSound("leave");
  // Push-to-talk never stays "held" across calls, disconnects or session changes.
  if (pttTimer) { clearTimeout(pttTimer); pttTimer = null; }
  set({ channelId: null, status: "idle", error: null, pttActive: false });
}

// Closing the tab / app: say goodbye right away so others don't see me linger until the socket times out.
window.addEventListener("pagehide", () => { if (get().channelId) { gwSend("voice_state", { channel_id: null }); cf?.close(); } });

/* -------------------------------------------------------- local toggles -- */
export async function setMuted(muted: boolean) {
  if (muted !== get().muted) playCallSound(muted ? "mute" : "unmute");
  set({ muted });
  cf?.mute();
  if (micTrack) muted ? await micTrack.mute() : get().settings.mode === "vad" && await micTrack.unmute();
  reportState();
}
export function setDeafened(d: boolean) {
  if (d !== get().deafened) playCallSound(d ? "deafen" : "undeafen");
  set({ deafened: d, muted: d ? true : get().muted });
  if (d && micTrack) micTrack.mute();
  cf?.mute(); cf?.output();
  applyOutput(); reportState();
}
export function setUserVolume(key: string, v: number) {
  updateVoiceSettings({ userVolumes: { ...get().settings.userVolumes, [key]: Math.max(0, Math.min(2, v)) } });
}

/**
 * Push-to-talk. In a browser it works while the window has focus. In the
 * desktop app the shell reports the key globally (even when SEND is in the
 * background), using the same press/release functions.
 */
let pttTimer: number | null = null;
export function pttPress() {
  const s = get();
  if ((!room && !cf) || s.settings.mode !== "ptt") return;
  if (pttTimer) { clearTimeout(pttTimer); pttTimer = null; }
  if (s.pttActive) return;
  set({ pttActive: true });
  cf?.mute();
  if (!s.muted && !s.deafened) micTrack?.unmute();
  reportState();
}
export function pttRelease() {
  const s = get();
  if ((!room && !cf) || s.settings.mode !== "ptt" || !s.pttActive) return;
  if (pttTimer) clearTimeout(pttTimer);
  pttTimer = window.setTimeout(() => { pttTimer = null; set({ pttActive: false }); cf?.mute(); micTrack?.mute(); reportState(); }, s.settings.pttReleaseDelay);
}
const globalPtt = () => !!(window as any).syndoDesktop?.capabilities?.globalPtt && get().settings.mode === "ptt";
window.addEventListener("keydown", (e) => {
  const s = get();
  if (e.code !== s.settings.pttKey || e.repeat || globalPtt()) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  pttPress();
});
window.addEventListener("keyup", (e) => { if (e.code === get().settings.pttKey && !globalPtt()) pttRelease(); });
// Rebinding the key (or leaving PTT mode) while it's held must not leave the mic open.
useVoice.subscribe((s, prev) => { if (s.pttActive && (s.settings.pttKey !== prev.settings.pttKey || s.settings.mode !== "ptt")) { set({ pttActive: false }); cf?.mute(); micTrack?.mute(); reportState(); } });
// In a browser, losing focus means we can no longer see the key — release. The desktop shell keeps listening.
window.addEventListener("blur", () => { if (!globalPtt() && get().pttActive) { set({ pttActive: false }); cf?.mute(); micTrack?.mute(); reportState(); } });

export async function setMode(mode: "vad" | "ptt") {
  await updateVoiceSettings({ mode });
  cf?.mute();
  if (!micTrack) return;
  if (mode === "ptt") await micTrack.mute(); else if (!get().muted) await micTrack.unmute();
  reportState();
}

export async function toggleCamera() {
  if (cf) { if (!get().grants?.video) return; await cf.camera(); reportState(); return; }
  if (!room) return;
  if (!get().grants?.video) { toast("You don't have permission to use video here.", "error"); return; }
  const on = !get().camera;
  try {
    const s = get().settings;
    const pub = await room.localParticipant.setCameraEnabled(on, {
      deviceId: s.videoDeviceId || undefined,
      resolution: { width: Math.round((s.cameraHeight * 16) / 9), height: s.cameraHeight, frameRate: 30 },
    }, { simulcast: true, videoCodec: "vp8" });
    set({ camera: on, localCamera: on ? pub?.track?.mediaStreamTrack ?? null : null });
  } catch (e) { toast(deviceError(e), "error"); set({ camera: false, localCamera: null }); }
  reportState();
}

export async function switchDevice(kind: "audioinput" | "audiooutput" | "videoinput", deviceId: string) {
  const key = kind === "audioinput" ? "inputDeviceId" : kind === "audiooutput" ? "outputDeviceId" : "videoDeviceId";
  await updateVoiceSettings({ [key]: deviceId } as Partial<VoiceSettings>);
  if (!room) return;
  if (kind === "videoinput" && get().camera) await room.switchActiveDevice("videoinput", deviceId).catch((e) => toast(deviceError(e), "error"));
  if (kind === "audiooutput") await room.switchActiveDevice("audiooutput", deviceId).catch(() => applyOutput());
}

/* ----------------------------------------------------------- screen share -- */
let screenPubs: LocalTrackPublication[] = [];

export async function startScreenShare() {
  if (cf) { if (!get().grants?.video) return; await cf.screen(); reportState(); return; }
  if (!room) return;
  if (!get().grants?.video) { toast("You don't have permission to share your screen here.", "error"); return; }
  const st = get().settings.stream;
  const source = st.height === "source";
  try {
    const tracks = await LK.createLocalScreenTracks({
      audio: st.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } as any : false,
      // Source: no resolution constraint → the browser captures at the surface's native size.
      resolution: source ? undefined : { width: Math.round((st.height as number) * 16 / 9), height: st.height as number, frameRate: st.fps },
      contentHint: st.contentHint,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: st.audio ? "include" : "exclude",
      preferCurrentTab: false,
      video: source ? { frameRate: st.fps } as any : undefined,
    } as any);
    const video = tracks.find((t) => t.kind === LK.Track.Kind.Video) as LocalVideoTrack | undefined;
    if (!video) throw new Error("No screen was selected.");
    const settings = video.mediaStreamTrack.getSettings();
    const capH = settings.height ?? 1080;
    const capW = settings.width ?? Math.round(capH * 16 / 9);
    // Keep the captured aspect ratio; for fixed targets only scale DOWN to the target height (never up).
    const maxBitrate = Math.min(streamBitrate(st, capH), (window as any).__syndoLimits?.max_stream_bitrate_kbps * 1000 || Infinity);
    const codec: VideoCodec | undefined = st.codec === "auto" ? (supportsCodec("video/AV1") ? "av1" : supportsCodec("video/VP9") ? "vp9" : "h264") : (st.codec as VideoCodec);
    const lowH = Math.min(capH, 720);
    const pub = await room.localParticipant.publishTrack(video, {
      source: LK.Track.Source.ScreenShare,
      videoCodec: codec,
      backupCodec: true, // viewers that can't decode the primary codec get a compatible one
      screenShareEncoding: { maxBitrate, maxFramerate: st.fps, priority: "high" },
      // Simulcast: a smaller layer for constrained viewers (where the codec uses simulcast; SVC codecs use layers instead).
      screenShareSimulcastLayers: capH > 720 ? [{ width: Math.round(capW * lowH / capH), height: lowH, encoding: { maxBitrate: Math.round(maxBitrate / 4), maxFramerate: Math.min(st.fps, 30) } } as any] : [],
      degradationPreference: st.contentHint === "detail" ? "maintain-resolution" : "maintain-framerate",
      simulcast: true,
    } as any);
    screenPubs = [pub];
    const audio = tracks.find((t) => t.kind === LK.Track.Kind.Audio);
    if (audio) screenPubs.push(await room.localParticipant.publishTrack(audio, { source: LK.Track.Source.ScreenShareAudio, dtx: false, red: false, audioPreset: { maxBitrate: 128_000 }, forceStereo: true } as any));
    else if (st.audio) toast("The shared surface didn't include audio. Tab audio needs a Chromium browser; system audio is only available on Windows.", "info");
    video.mediaStreamTrack.addEventListener("ended", () => stopScreenShare());
    set({ sharing: true, localScreen: video.mediaStreamTrack });
  } catch (e) {
    const msg = (e as Error)?.name === "NotAllowedError" ? "Screen sharing was cancelled or blocked." : `Couldn't start screen sharing: ${errMsg(e)}`;
    toast(msg, "info");
  }
  reportState();
}

export async function stopScreenShare() {
  if (cf) { await cf.stopScreen(); reportState(); return; }
  if (room) for (const p of screenPubs) { if (p.track) { p.track.stop(); await room.localParticipant.unpublishTrack(p.track, true).catch(() => {}); } }
  screenPubs = [];
  get().localScreen?.stop();
  set({ sharing: false, localScreen: null });
  reportState();
}

/** Change the shared surface without stopping (browser picker). */
export async function switchScreenSource() { await stopScreenShare(); await startScreenShare(); }

function supportsCodec(mime: string) {
  try { return !!RTCRtpSender.getCapabilities?.("video")?.codecs.some((c) => c.mimeType.toLowerCase() === mime.toLowerCase()); } catch { return false; }
}

export function deviceError(e: unknown): string {
  const n = (e as Error)?.name;
  if (n === "NotAllowedError") return "Permission denied. Allow microphone/camera access in your browser's site settings, then try again.";
  if (n === "NotFoundError" || n === "OverconstrainedError") return "No matching device was found. Check that it's plugged in, or pick another in Voice & Video settings.";
  if (n === "NotReadableError") return "The device is in use by another app or couldn't be started.";
  return errMsg(e);
}

// Server-driven changes.
import("../store.ts").then(({ onEvent }) => {
  onEvent("VOICE_DISCONNECTED", () => { if (get().channelId) { leaveVoice(); toast("You were removed from the voice channel.", "info"); } });
  onEvent("VOICE_MOVE", (d) => joinVoice(d.channel_id));
  onEvent("VOICE_MEDIA_UPDATE", (d) => { if (cf && get().channelId === d.channel_id) cf.pollNow(); });
});
// Device hot-plug: fall back to the default device if the selected one disappears.
navigator.mediaDevices?.addEventListener?.("devicechange", async () => {
  const s = get().settings;
  const list = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  if (s.inputDeviceId !== "default" && !list.some((d) => d.deviceId === s.inputDeviceId)) {
    toast("Your microphone was disconnected — switched to the default device.", "info");
    await updateVoiceSettings({ inputDeviceId: "default" });
  }
});
export { DEFAULT_VOICE };
