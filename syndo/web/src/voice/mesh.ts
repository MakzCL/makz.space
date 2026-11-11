import { gwSend } from "../gateway.ts";
import { onEvent, toast, useStore } from "../store.ts";
import { primeCallAudio, type IceServer } from "./cloudflare.ts";
import { deviceError, micConstraints, useVoice, type Peer } from "./session.ts";
import { SCREEN_ECHO_NOTE, screenAudioMayEcho, screenAudioConstraints, streamBitrate, type VoiceSettings } from "./settings.ts";

/**
 * Direct (peer-to-peer) calls — the SK Factory call model, adapted to SEND:
 * - Everyone in the voice channel connects to everyone else (mesh; fine for small calls). Media goes
 *   device ↔ device, through Cloudflare's TURN relay only when a network needs it.
 * - Who's in the call comes from SEND's voice states; offers/answers/ICE travel over the SEND gateway
 *   (`call_signal`, only relayed between two people in the same voice channel).
 * - Deterministic negotiation: of each pair, the smaller user id is the OFFERER and creates every slot up
 *   front — mic, camera, screen sound, screen video — so media switches with replaceTrack and never needs
 *   renegotiation. The ANSWERER attaches its tracks to the slots the offer created.
 * - Camera and screen use separate video slots, so both can be on at once. Versions before that had one
 *   video slot (screen, else camera); they don't send `v: 2` in their state, and get that old layout.
 * - Camera/mic/screen state is sent as a "state" message. A failed connection is restarted by the
 *   offerer; the answerer "knocks" to ask for a fresh offer. Peers drop on "bye" or when they leave.
 * - Remote audio plays straight through <audio> elements; WebAudio (if running) only measures levels.
 */
const CAM = { maxBitrate: 1_500_000, maxFramerate: 30 };
/** `v: 2` = sends camera and screen on separate video slots. */
interface PState { cam: boolean; mic: boolean; share: boolean; shareAudio?: boolean; v?: number }
interface MPeer { pc: RTCPeerConnection; stream: MediaStream; queued: RTCIceCandidateInit[]; offerer: boolean; audio: HTMLAudioElement; screenAudio: HTMLAudioElement; state: PState; analyser?: AnalyserNode }

export class MeshCall {
  peers = new Map<string, MPeer>();
  pendingIce = new Map<string, RTCIceCandidateInit[]>();
  knocks = new Map<string, number>();
  mic: MediaStreamTrack | null = null;
  local: MediaStream | null = null;
  cam: MediaStreamTrack | null = null;
  screenTrack: MediaStreamTrack | null = null;
  /** Sound of the shared screen/tab/window (slots: mic, camera, screen sound, screen video). */
  screenSound: MediaStreamTrack | null = null;
  preMic: Promise<MediaStream> | null = null;
  stopped = false;
  localLevel: AnalyserNode | null = null;
  speakTimer: ReturnType<typeof setInterval> | null = null;
  off: (() => void)[] = [];
  me: string;

  constructor(public channelId: string, public ice: IceServer[]) {
    this.me = useStore.getState().me!.id;
    (globalThis as any).__sendCall = this; // debugging handle (stats in the console)
    if (!this.ice.length) this.ice = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  }

  /* ------------------------------------------------------------ start -- */
  async start() {
    const v = useVoice.getState();
    if (v.grants?.speak) {
      try {
        const early = this.preMic; this.preMic = null;
        const stream = early ? await early.catch(() => navigator.mediaDevices.getUserMedia({ audio: micConstraints(v.settings), video: false })) : await navigator.mediaDevices.getUserMedia({ audio: micConstraints(v.settings), video: false });
        if (this.stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        this.mic = stream.getAudioTracks()[0] ?? null;
        this.local = new MediaStream(this.mic ? [this.mic] : []);
        this.mute();
        this.measureLocal();
      } catch (e) { const message = deviceError(e); useVoice.setState({ muted: true, error: message }); toast(message, "error"); }
    }
    if (this.stopped) return;
    this.local ??= new MediaStream();
    useVoice.setState({ status: "connected" });
    this.off.push(onEvent("CALL_SIGNAL", (d: any) => { if (d.channel_id === this.channelId) this.onSignal(d.from, d.type, d.data); }));
    // Meet whoever is (or comes) into the channel; drop whoever leaves.
    const unsub = useStore.subscribe((s, p) => { if (s.voice !== p.voice) this.meet(); });
    this.off.push(unsub);
    this.speaking();
    this.meet();
  }

  private others() {
    return Object.values(useStore.getState().voice).filter((x) => x.channel_id === this.channelId && x.user_id !== this.me).map((x) => x.user_id);
  }
  private meet() {
    if (this.stopped) return;
    const here = new Set(this.others());
    for (const uid of [...this.peers.keys()]) if (!here.has(uid)) this.drop(uid);
    for (const uid of here) {
      if (this.peers.has(uid)) continue;
      if (this.me < uid) this.call(uid);
      else if (!this.knocks.has(uid)) this.knocks.set(uid, window.setTimeout(() => { this.knocks.delete(uid); if (!this.peers.has(uid) && !this.stopped) this.signal(uid, "knock"); }, 2500));
    }
    this.sync();
  }

  /* -------------------------------------------------------- signalling -- */
  private signal(to: string, type: string, data?: unknown) { gwSend("call_signal", { to, type, data }); }
  private myState(): PState { const v = useVoice.getState(); return { cam: !!this.cam && v.camera, mic: !!this.mic && !v.muted, share: !!this.screenTrack, shareAudio: !!this.screenSound, v: 2 }; }
  sendState(to?: string) { const st = this.myState(); if (to) this.signal(to, "state", st); else for (const uid of this.peers.keys()) this.signal(uid, "state", st); }
  /** What a single-video-slot (older) peer gets: the screen while sharing, else the camera. */
  private outgoingVideo() { return this.screenTrack ?? this.cam ?? null; }
  private slots(pc: RTCPeerConnection, kind: "audio" | "video") { return pc.getTransceivers().filter((t) => t.receiver.track.kind === kind); }
  /** Both ends send camera and screen on their own slots (otherwise: the older one-slot layout). */
  private dual(p: MPeer) { return p.state.v === 2 && this.slots(p.pc, "video").length >= 2; }
  /** Put my camera, screen and screen sound on this connection's slots. */
  private async attach(p: MPeer) {
    const [first, second] = this.dual(p) ? [this.cam, this.screenTrack] : [this.outgoingVideo(), null];
    for (const [i, tr] of this.slots(p.pc, "video").entries()) {
      const track = i === 0 ? first : i === 1 ? second : null;
      if (tr.sender.track !== track) await tr.sender.replaceTrack(track).catch(() => {});
      this.tuneVideo(tr.sender);
    }
    const sound = this.slots(p.pc, "audio")[1];
    if (sound && sound.sender.track !== this.screenSound) await sound.sender.replaceTrack(this.screenSound).catch(() => {});
  }

  private makePeer(uid: string, offerer: boolean): MPeer {
    const pc = new RTCPeerConnection({ iceServers: this.ice as RTCIceServer[], bundlePolicy: "max-bundle" });
    const audio = document.createElement("audio");
    audio.autoplay = true; (audio as any).playsInline = true; audio.dataset.call = "1"; audio.dataset.user = uid;
    document.body.appendChild(audio);
    const screenAudio = document.createElement("audio");
    screenAudio.autoplay = true; (screenAudio as any).playsInline = true; screenAudio.dataset.call = "1"; screenAudio.dataset.user = uid; screenAudio.dataset.source = "screen";
    document.body.appendChild(screenAudio);
    const p: MPeer = { pc, stream: new MediaStream(), queued: this.pendingIce.get(uid) ?? [], offerer, audio, screenAudio, state: { cam: false, mic: true, share: false } };
    this.pendingIce.delete(uid);
    this.peers.set(uid, p);
    if (offerer) {
      const streams = this.local ? [this.local] : [];
      pc.addTransceiver(this.mic ?? "audio", { direction: "sendrecv", streams });
      // Until their state says otherwise, assume the one-video-slot layout of older versions.
      const v = pc.addTransceiver(this.outgoingVideo() ?? "video", { direction: "sendrecv", streams });
      this.tuneVideo(v.sender);
      pc.addTransceiver(this.screenSound ?? "audio", { direction: "sendrecv", streams });
      pc.addTransceiver("video", { direction: "sendrecv", streams });
    }
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(uid, "ice", e.candidate.toJSON()); };
    pc.ontrack = (e) => {
      if (!p.stream.getTracks().includes(e.track)) p.stream.addTrack(e.track);
      if (e.track.kind === "audio") {
        // First audio slot = their microphone, second = their screen's sound.
        const isScreen = pc.getTransceivers().filter((t) => t.receiver.track.kind === "audio").indexOf(e.transceiver) === 1;
        const el = isScreen ? screenAudio : audio;
        el.srcObject = new MediaStream([e.track]);
        el.play().catch(() => {});
        if (!isScreen) this.measurePeer(p, e.track);
        this.output();
      }
      e.track.onmute = () => this.sync(); e.track.onunmute = () => this.sync();
      this.sync();
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "connected") { this.sendState(uid); audio.play().catch(() => {}); screenAudio.play().catch(() => {}); }
      if (st === "failed") { if (p.offerer) this.restart(uid); else this.signal(uid, "knock"); }
      this.sync();
    };
    return p;
  }

  private async call(uid: string) {
    if (this.peers.get(uid)) this.drop(uid);
    const p = this.makePeer(uid, true);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.signal(uid, "offer", offer);
    this.sync();
  }
  private async restart(uid: string) {
    const p = this.peers.get(uid);
    if (!p || !p.offerer) return this.call(uid);
    try { const offer = await p.pc.createOffer({ iceRestart: true }); await p.pc.setLocalDescription(offer); this.signal(uid, "offer", offer); }
    catch { this.call(uid); }
  }
  private drop(uid: string) {
    const p = this.peers.get(uid);
    clearTimeout(this.knocks.get(uid)); this.knocks.delete(uid);
    if (!p) return;
    p.pc.onconnectionstatechange = null; p.pc.ontrack = null; p.pc.onicecandidate = null;
    p.pc.close(); p.audio.srcObject = null; p.audio.remove(); p.screenAudio.srcObject = null; p.screenAudio.remove();
    this.peers.delete(uid);
    this.sync();
  }

  private async onSignal(from: string, type: string, data: any) {
    if (this.stopped || from === this.me) return;
    try {
      if (type === "offer") {
        let p = this.peers.get(from);
        if (p && p.offerer) { this.drop(from); p = undefined; }
        if (!p) p = this.makePeer(from, false);
        await p.pc.setRemoteDescription(data);
        // Attach my mic, camera and screen to the slots the offer created.
        for (const tr of p.pc.getTransceivers()) { tr.direction = "sendrecv"; if (this.local) tr.sender.setStreams?.(this.local); }
        const mic = this.slots(p.pc, "audio")[0];
        if (mic && mic.sender.track !== this.mic) await mic.sender.replaceTrack(this.mic).catch(() => {});
        await this.attach(p);
        for (const q of p.queued.splice(0)) await p.pc.addIceCandidate(q).catch(() => {});
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        this.signal(from, "answer", ans);
        this.applyBitrate(p.pc);
      } else if (type === "answer") {
        const p = this.peers.get(from);
        if (!p || p.pc.signalingState !== "have-local-offer") return;
        await p.pc.setRemoteDescription(data);
        for (const q of p.queued.splice(0)) await p.pc.addIceCandidate(q).catch(() => {});
        this.applyBitrate(p.pc);
      } else if (type === "ice") {
        const p = this.peers.get(from);
        if (p?.pc.remoteDescription) await p.pc.addIceCandidate(data).catch(() => {});
        else if (p) p.queued.push(data);
        else this.pendingIce.set(from, [...(this.pendingIce.get(from) ?? []), data]);
      } else if (type === "state") {
        const p = this.peers.get(from);
        if (p) {
          const was = this.dual(p);
          p.state = { cam: !!data?.cam, mic: data?.mic !== false, share: !!data?.share, shareAudio: !!data?.shareAudio, v: Number(data?.v) || 1 };
          if (this.dual(p) !== was) await this.attach(p);
          this.sync();
        }
      } else if (type === "knock") {
        if (this.me < from) this.call(from);
      } else if (type === "bye") {
        this.drop(from);
      }
    } catch (e) { console.warn("call signal", type, e); }
  }

  /* ------------------------------------------------------- store sync -- */
  private sync() {
    if (this.stopped) return;
    const users = useStore.getState().users, prev = useVoice.getState().peers;
    const out: Record<string, Peer> = {};
    for (const [uid, p] of this.peers) {
      const live = (t?: MediaStreamTrack | null) => (t && t.readyState === "live" && !t.muted ? t : null);
      let camera: MediaStreamTrack | null, screen: MediaStreamTrack | null;
      if (this.dual(p)) {
        const [first, second] = this.slots(p.pc, "video").map((t) => live(t.receiver.track));
        camera = p.state.cam ? first ?? null : null;
        screen = p.state.share ? second ?? null : null;
      } else {
        // Older version: one video slot carrying their screen while sharing, else their camera.
        const video = live(p.stream.getVideoTracks().find((t) => live(t)));
        const showVideo = video && (p.state.cam || p.state.share) ? video : null;
        camera = p.state.share ? null : showVideo; screen = p.state.share ? showVideo : null;
      }
      out[uid] = {
        id: uid, name: users[uid]?.display_name ?? users[uid]?.username ?? uid, speaking: prev[uid]?.speaking ?? false, micMuted: !p.state.mic,
        camera, screen, screenAudio: !!p.state.share && !!p.state.shareAudio,
        quality: p.pc.connectionState === "connected" ? "good" : p.pc.connectionState,
      };
    }
    useVoice.setState({ peers: out });
  }

  /* ------------------------------------------------------------ audio -- */
  mute() { const s = useVoice.getState(); if (this.mic) this.mic.enabled = !s.muted && !s.deafened && (s.settings.mode !== "ptt" || s.pttActive); this.sendState(); }
  output() {
    const s = useVoice.getState();
    for (const [uid, p] of this.peers) {
      const el = p.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
      el.muted = s.deafened;
      el.volume = Math.max(0, Math.min(1, s.settings.userVolumes[uid] ?? 1));
      const sink = s.settings.outputDeviceId === "default" ? "" : s.settings.outputDeviceId;
      if (el.setSinkId && el.sinkId !== sink) el.setSinkId(sink).catch(() => {});
      const sa = p.screenAudio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
      sa.muted = s.deafened;
      sa.volume = Math.max(0, Math.min(1, s.settings.userVolumes[`${uid}:stream`] ?? 1));
      if (sa.setSinkId && sa.sinkId !== sink) sa.setSinkId(sink).catch(() => {});
    }
  }
  private measureLocal() {
    const ctx = primeCallAudio();
    if (!ctx || ctx.state !== "running" || !this.mic) return;
    try { const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(new MediaStream([this.mic])).connect(an); this.localLevel = an; } catch { /* levels unavailable */ }
  }
  private measurePeer(p: MPeer, track: MediaStreamTrack) {
    const ctx = primeCallAudio();
    if (!ctx || ctx.state !== "running") return;
    try { const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(new MediaStream([track])).connect(an); p.analyser = an; } catch { /* levels unavailable */ }
  }
  private speaking() {
    const buf = new Float32Array(512), held = new Map<string, number>();
    const level = (an: AnalyserNode) => { an.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!; return Math.sqrt(sum / buf.length); };
    this.speakTimer = setInterval(() => {
      if (this.stopped) return;
      const now = Date.now(), st = useVoice.getState();
      if (this.localLevel) { if (level(this.localLevel) > .012) held.set("@me", now); const on = now - (held.get("@me") ?? 0) < 350 && !st.muted && !st.deafened && (st.settings.mode !== "ptt" || st.pttActive); if (st.localSpeaking !== on) useVoice.setState({ localSpeaking: on }); }
      let changed = false; const peers = { ...st.peers };
      for (const [uid, p] of this.peers) {
        if (!p.analyser || !peers[uid]) continue;
        if (level(p.analyser) > .012) held.set(uid, now);
        const on = now - (held.get(uid) ?? 0) < 350;
        if (peers[uid]!.speaking !== on) { peers[uid] = { ...peers[uid]!, speaking: on }; changed = true; }
      }
      if (changed) useVoice.setState({ peers });
    }, 100);
  }

  async applySettings(prev: VoiceSettings, next: VoiceSettings) {
    this.output();
    const capture = (["inputDeviceId", "stereo", "echoCancellation", "noiseSuppression", "autoGainControl"] as const).some((k) => prev[k] !== next[k]);
    if (capture && this.mic) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(next), video: false });
      const track = s.getAudioTracks()[0]!; const old = this.mic;
      this.mic = track; this.local = new MediaStream([track, ...(this.outgoingVideo() ? [this.outgoingVideo()!] : [])]);
      for (const p of this.peers.values()) { const tr = p.pc.getTransceivers().find((t) => t.receiver.track.kind === "audio"); await tr?.sender.replaceTrack(track).catch(() => {}); }
      old.stop(); this.mute(); this.localLevel = null; this.measureLocal();
    }
    if (prev.bitrate !== next.bitrate) for (const p of this.peers.values()) this.applyBitrate(p.pc);
    const st = next.stream;
    if (this.screenTrack && JSON.stringify(prev.stream) !== JSON.stringify(st)) await this.screenTrack.applyConstraints({ height: st.height === "source" ? undefined : { ideal: st.height }, frameRate: { ideal: st.fps } }).catch(() => {});
  }
  private applyBitrate(pc: RTCPeerConnection) {
    const bitrate = useVoice.getState().settings.bitrate;
    const tr = pc.getTransceivers().find((t) => t.receiver.track.kind === "audio");
    const p = tr?.sender.getParameters(); if (!tr || !p) return;
    if (!p.encodings?.length) p.encodings = [{}];
    p.encodings[0]!.maxBitrate = bitrate;
    tr.sender.setParameters(p).catch(() => {});
  }
  private tuneVideo(sender: RTCRtpSender) {
    try {
      const p = sender.getParameters(); if (!p.encodings?.length) p.encodings = [{}];
      const screen = !!this.screenTrack && sender.track === this.screenTrack, st = useVoice.getState().settings.stream;
      p.encodings[0]!.maxBitrate = screen ? streamBitrate(st, this.screenTrack?.getSettings().height ?? 1080) : CAM.maxBitrate;
      p.encodings[0]!.maxFramerate = screen ? st.fps : CAM.maxFramerate;
      sender.setParameters(p).catch(() => {});
    } catch { /* not ready yet */ }
  }
  private async replaceVideo() {
    for (const p of this.peers.values()) await this.attach(p);
    this.sendState();
  }

  /* ------------------------------------------------------- camera/screen -- */
  async camera() {
    if (this.cam) { this.cam.stop(); this.cam = null; useVoice.setState({ camera: false, localCamera: null }); await this.replaceVideo(); return; }
    const s = useVoice.getState().settings;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: s.videoDeviceId ? { exact: s.videoDeviceId } : undefined, height: { ideal: s.cameraHeight }, facingMode: "user" }, audio: false });
      this.cam = stream.getVideoTracks()[0]!;
      this.cam.onended = () => { this.cam = null; useVoice.setState({ camera: false, localCamera: null }); this.replaceVideo(); };
      useVoice.setState({ camera: true, localCamera: this.cam });
      await this.replaceVideo();
    } catch (e) { toast(deviceError(e), "error"); }
  }
  async screen() {
    const st = useVoice.getState().settings.stream;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { height: st.height === "source" ? undefined : { ideal: st.height }, frameRate: { ideal: st.fps } },
        audio: st.audio ? screenAudioConstraints() : false, ...(st.audio ? { systemAudio: "include" } : {}) } as DisplayMediaStreamOptions);
      this.screenTrack = stream.getVideoTracks()[0]!;
      this.screenSound = stream.getAudioTracks()[0] ?? null;
      if (screenAudioMayEcho(this.screenSound)) toast(SCREEN_ECHO_NOTE, "info");
      if (st.audio && !this.screenSound) toast("The shared screen didn't include sound. Tab audio needs a Chromium browser; whole-system audio is Windows-only (or the SEND desktop app).", "info");
      this.screenTrack.contentHint = st.contentHint;
      this.screenTrack.onended = () => { this.stopScreen().catch(() => {}); };
      useVoice.setState({ sharing: true, localScreen: this.screenTrack });
      await this.replaceVideo();
    } catch (e) { if ((e as Error)?.name !== "NotAllowedError") toast(deviceError(e), "error"); }
  }
  async stopScreen() {
    this.screenTrack?.stop(); this.screenTrack = null;
    this.screenSound?.stop(); this.screenSound = null;
    useVoice.setState({ sharing: false, localScreen: null });
    await this.replaceVideo();
  }
  pollNow() { /* nothing to poll: peers come from voice states */ }

  close() {
    this.stopped = true;
    for (const uid of this.peers.keys()) this.signal(uid, "bye");
    for (const uid of [...this.peers.keys()]) this.drop(uid);
    for (const t of this.knocks.values()) clearTimeout(t);
    this.knocks.clear(); this.pendingIce.clear();
    this.off.forEach((f) => f()); this.off = [];
    if (this.speakTimer) clearInterval(this.speakTimer);
    this.preMic?.then((m) => m.getTracks().forEach((t) => t.stop()), () => {}); this.preMic = null;
    this.mic?.stop(); this.cam?.stop(); this.screenTrack?.stop(); this.screenSound?.stop(); this.screenSound = null;
    this.mic = this.cam = this.screenTrack = null;
  }
}
