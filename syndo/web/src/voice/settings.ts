import { AUDIO_PRESETS, suggestedStreamBitrate } from "@send/shared";
import type { Suppression } from "./denoise.ts";

/** Per-device media settings (kept in localStorage — devices differ per machine). */
export interface VoiceSettings {
  presetId: string;
  /** Opus target in bits/s. A request to the encoder, not a guarantee. */
  bitrate: number;
  stereo: boolean;
  dtx: boolean;
  red: boolean;
  echoCancellation: boolean;
  /** Browser noise suppression; follows `suppression` ("standard"). Kept for older saved settings. */
  noiseSuppression: boolean;
  /** Noise suppression: AI (RNNoise, built in), the browser's standard one, or none. */
  suppression: Suppression;
  autoGainControl: boolean;
  inputDeviceId: string;
  outputDeviceId: string;
  videoDeviceId: string;
  inputGain: number; // 0..2
  mode: "vad" | "ptt";
  pttKey: string;
  pttReleaseDelay: number;
  userVolumes: Record<string, number>; // 0..2
  cameraHeight: number;
  stream: StreamSettings;
  suppressSoundEffects: boolean;
  /** Interface sound volume 0..1. */
  soundVolume: number;
  /** Ticks when push-to-talk opens/closes. */
  pttSounds: boolean;
  /** Ring shown around speaking people (sidebar voice list and the call stage). */
  speakingColor: string;
  /** Soundboard: how loud other people's sounds play for me (0..1), or off entirely. */
  soundboardVolume: number;
  soundboardMuted: boolean;
  /** Call view options from the "…" menu. */
  callShowSelf: boolean;
  callShowNonVideo: boolean;
  callMessagePreviews: boolean;
}
export interface StreamSettings {
  height: number | "source";
  fps: 15 | 30 | 60;
  bitrate: number; // bits/s, 0 = suggested
  contentHint: "detail" | "motion";
  audio: boolean;
  codec: "auto" | "vp9" | "h264" | "av1" | "vp8";
}

const speech = AUDIO_PRESETS[0]!;
export const DEFAULT_VOICE: VoiceSettings = {
  presetId: speech.id, bitrate: speech.bitrate, stereo: speech.stereo, dtx: speech.dtx, red: speech.red,
  echoCancellation: speech.echoCancellation, noiseSuppression: false, suppression: speech.noiseSuppression ? "rnnoise" : "off", autoGainControl: speech.autoGainControl,
  inputDeviceId: "default", outputDeviceId: "default", videoDeviceId: "", inputGain: 1, mode: "vad", pttKey: "KeyV", pttReleaseDelay: 200,
  userVolumes: {}, cameraHeight: 720,
  stream: { height: 1080, fps: 30, bitrate: 0, contentHint: "detail", audio: true, codec: "auto" },
  suppressSoundEffects: false, soundVolume: 1, pttSounds: true, speakingColor: "#23a55a", soundboardVolume: .7, soundboardMuted: false, callShowSelf: true, callShowNonVideo: true, callMessagePreviews: true,
};

const KEY = "send.voice.v1";
export function loadVoiceSettings(): VoiceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    // Settings saved before the suppression choice existed: keep "off" for people who turned it off, otherwise use the AI one.
    if (!saved.suppression) saved.suppression = saved.noiseSuppression === false ? "off" : "rnnoise";
    if (!["deepfilter", "rnnoise", "standard", "off"].includes(saved.suppression)) saved.suppression = "rnnoise";
    saved.noiseSuppression = saved.suppression === "standard";
    return { ...DEFAULT_VOICE, ...saved, stream: { ...DEFAULT_VOICE.stream, ...(saved.stream ?? {}) } };
  }
  catch { return DEFAULT_VOICE; }
}
export function saveVoiceSettings(s: VoiceSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export function applyPreset(s: VoiceSettings, id: string): VoiceSettings {
  const p = AUDIO_PRESETS.find((x) => x.id === id);
  if (!p) return s;
  return { ...s, presetId: id, bitrate: p.bitrate, stereo: p.stereo, dtx: p.dtx, red: p.red, echoCancellation: p.echoCancellation, ...suppressionFor(p.noiseSuppression ? (s.suppression === "off" ? "rnnoise" : s.suppression) : "off"), autoGainControl: p.autoGainControl };
}

export function suppressionFor(v: Suppression): Pick<VoiceSettings, "suppression" | "noiseSuppression"> {
  return { suppression: v, noiseSuppression: v === "standard" };
}

export function streamBitrate(st: StreamSettings, capturedHeight: number) {
  return st.bitrate || suggestedStreamBitrate(st.height === "source" ? capturedHeight : st.height, st.fps);
}

/** What this browser can actually do — shown honestly instead of pretending. */
export function captureCapabilities() {
  const ua = navigator.userAgent;
  const chromium = /Chrome\/|Chromium\/|Edg\//.test(ua) && !/OPR\//.test(ua);
  const firefox = /Firefox\//.test(ua);
  const safari = /Safari\//.test(ua) && !chromium;
  const mobile = /Android|iPhone|iPad|iPod/.test(ua);
  const isWin = /Windows/.test(ua), isMac = /Mac OS X/.test(ua) && !mobile, isLinux = /Linux/.test(ua) && !/Android/.test(ua);
  const canShare = !!navigator.mediaDevices?.getDisplayMedia && !mobile;
  const desk = (window as any).sendDesktop?.capabilities as { systemAudio?: boolean } | undefined;
  return {
    canShare,
    tabAudio: canShare && chromium,
    systemAudio: canShare && ((chromium && isWin) || !!desk?.systemAudio),
    desktopApp: !!desk,
    windowAudio: false,
    linuxNote: isLinux && chromium ? "On Linux, Chromium can share tab audio; whole-system audio depends on PipeWire and browser version." : null,
    macNote: isMac ? "macOS browsers can't capture system audio; tab audio works in Chromium browsers." : null,
    firefox, safari, chromium, mobile,
    setSinkId: typeof (HTMLMediaElement.prototype as any).setSinkId === "function",
  };
}

/**
 * Audio constraints for screen sharing. Sound is captured untouched (no echo cancellation etc.), and
 * `restrictOwnAudio` asks the browser to leave SEND's own sound — the call you're in, notification
 * sounds — out of a shared screen's system audio, so the people watching don't hear themselves back.
 * Supported by Chromium browsers and the desktop app on Windows/macOS.
 */
export function screenAudioConstraints(): MediaTrackConstraints {
  const supported = !!(navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined)?.restrictOwnAudio;
  return { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(supported ? { restrictOwnAudio: true } : {}) } as MediaTrackConstraints;
}
/** True when a captured screen-audio track may still include SEND's own sound. */
export function screenAudioMayEcho(track: MediaStreamTrack | null | undefined) {
  if (!track) return false;
  const st = track.getSettings() as MediaTrackSettings & { restrictOwnAudio?: boolean; displaySurface?: string };
  // A browser tab only carries that tab's sound; whole screens and windows carry the system's.
  return st.displaySurface !== "browser" && st.restrictOwnAudio !== true;
}
export const SCREEN_ECHO_NOTE = "This browser can't keep SEND's own sound out of a shared screen, so people may hear the call echo. Share a tab, or use Chrome, Edge or the SEND desktop app.";

/**
 * What to share. "window", "browser" (a tab) and "monitor" open the system picker with that tab chosen first (browsers and
 * WebView2 don't let a page list windows or screens itself); "device" streams a capture card or camera
 * as the stream, with its matching audio input when it has one.
 */
export type ShareSource = { kind: "window" } | { kind: "browser" } | { kind: "monitor" } | { kind: "device"; deviceId: string }
  /** A screen or window picked in SEND's own picker (desktop app). */
  | { kind: "native"; id: string };

export async function captureShare(st: StreamSettings, src: ShareSource = { kind: "window" }): Promise<MediaStream> {
  const h = st.height === "source" ? undefined : st.height;
  if (src.kind === "native") {
    const { nativeCapture, nativeShareStream } = await import("./nativeCapture.ts");
    const api = nativeCapture();
    if (!api) throw new Error("This version of the SEND app can't share this way.");
    return nativeShareStream(api, src.id, st);
  }
  if (src.kind === "device") {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    const cam = devices.find((d) => d.kind === "videoinput" && d.deviceId === src.deviceId);
    // A capture card shows up as a video input and an audio input in the same group.
    const mic = st.audio && cam?.groupId ? devices.find((d) => d.kind === "audioinput" && d.groupId === cam.groupId && d.deviceId !== "default" && d.deviceId !== "communications") : undefined;
    return navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: src.deviceId }, ...(h ? { height: { ideal: h } } : {}), frameRate: { ideal: st.fps } },
      audio: mic ? { deviceId: { exact: mic.deviceId }, ...screenAudioConstraints() } : false,
    });
  }
  return navigator.mediaDevices.getDisplayMedia({
    video: { ...(h ? { height: { ideal: h } } : {}), frameRate: { ideal: st.fps }, displaySurface: src.kind },
    audio: st.audio ? screenAudioConstraints() : false,
    ...(st.audio ? { systemAudio: "include" } : {}),
    selfBrowserSurface: "exclude", surfaceSwitching: "include", preferCurrentTab: false,
  } as DisplayMediaStreamOptions);
}
/** Device captures don't carry SEND's sound, so only screen captures can echo. */
export function shareMayEcho(src: ShareSource | undefined, track: MediaStreamTrack | null | undefined) {
  // Devices carry no SEND sound; the desktop app's own capture leaves SEND's sound out itself.
  return src?.kind !== "device" && src?.kind !== "native" && screenAudioMayEcho(track);
}
