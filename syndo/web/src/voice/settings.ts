import { AUDIO_PRESETS, suggestedStreamBitrate } from "@syndo/shared";

/** Per-device media settings (kept in localStorage — devices differ per machine). */
export interface VoiceSettings {
  presetId: string;
  /** Opus target in bits/s. A request to the encoder, not a guarantee. */
  bitrate: number;
  stereo: boolean;
  dtx: boolean;
  red: boolean;
  echoCancellation: boolean;
  noiseSuppression: boolean;
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
  echoCancellation: speech.echoCancellation, noiseSuppression: speech.noiseSuppression, autoGainControl: speech.autoGainControl,
  inputDeviceId: "default", outputDeviceId: "default", videoDeviceId: "", inputGain: 1, mode: "vad", pttKey: "KeyV", pttReleaseDelay: 200,
  userVolumes: {}, cameraHeight: 720,
  stream: { height: 1080, fps: 30, bitrate: 0, contentHint: "detail", audio: true, codec: "auto" },
  suppressSoundEffects: false, soundVolume: .8, pttSounds: true, speakingColor: "#23a55a",
};

const KEY = "syndo.voice.v1";
export function loadVoiceSettings(): VoiceSettings {
  try { return { ...DEFAULT_VOICE, ...JSON.parse(localStorage.getItem(KEY) ?? "{}"), stream: { ...DEFAULT_VOICE.stream, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}").stream ?? {}) } }; }
  catch { return DEFAULT_VOICE; }
}
export function saveVoiceSettings(s: VoiceSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export function applyPreset(s: VoiceSettings, id: string): VoiceSettings {
  const p = AUDIO_PRESETS.find((x) => x.id === id);
  if (!p) return s;
  return { ...s, presetId: id, bitrate: p.bitrate, stereo: p.stereo, dtx: p.dtx, red: p.red, echoCancellation: p.echoCancellation, noiseSuppression: p.noiseSuppression, autoGainControl: p.autoGainControl };
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
  const desk = (window as any).syndoDesktop?.capabilities as { systemAudio?: boolean } | undefined;
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
