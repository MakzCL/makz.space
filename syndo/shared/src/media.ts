/**
 * Media quality presets. These are *requests* to the encoder, never promises:
 * Opus is variable-rate (silence and simple signals use far less), the SFU and
 * congestion control can lower the send rate, and the remote endpoint may not
 * decode everything. Clients show requested vs. negotiated vs. measured.
 */

export interface AudioPreset {
  id: string;
  label: string;
  /** Target Opus bitrate in bits per second (maxBitrate on the sender). */
  bitrate: number;
  stereo: boolean;
  /** DTX saves bandwidth during silence; harmful for music. */
  dtx: boolean;
  /** Opus in-band FEC: resilience to packet loss at a small bitrate cost. */
  fec: boolean;
  /** Processing defaults; every flag stays individually switchable. */
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** RED (redundant audio) — extra resilience on lossy links, doubles audio traffic. */
  red: boolean;
}

export const AUDIO_BITRATES_KBPS = [32, 64, 96, 128, 192, 256, 320, 384, 510] as const;

export const AUDIO_PRESETS: AudioPreset[] = [
  { id: "speech", label: "Speech: clear voice", bitrate: 64_000, stereo: false, dtx: true, fec: true, red: true, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  { id: "speech-hq", label: "Speech HQ", bitrate: 128_000, stereo: false, dtx: true, fec: true, red: true, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  { id: "music", label: "Music: stereo fidelity", bitrate: 256_000, stereo: true, dtx: false, fec: true, red: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  { id: "music-max", label: "Music max", bitrate: 384_000, stereo: true, dtx: false, fec: false, red: false, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
];

export interface StreamPreset {
  id: string;
  label: string;
  /** null height = Source: request the captured surface's native size. */
  height: number | null;
  fps: number;
  /** Max video bitrate in bits per second for the top layer. */
  bitrate: number;
  /** "detail" keeps resolution (text), "motion" keeps frame rate (games/video). */
  contentHint: "detail" | "motion";
}

export const STREAM_HEIGHTS = [720, 1080, 1440, 2160] as const;
export const STREAM_FPS = [15, 30, 60] as const;

/** Reasonable starting bitrates per resolution/fps (bits/s). Operators can cap via InstanceLimits. */
export function suggestedStreamBitrate(height: number, fps: number): number {
  const base: Record<number, number> = { 720: 2_500_000, 1080: 5_000_000, 1440: 9_000_000, 2160: 16_000_000 };
  const b = base[height] ?? Math.round((height / 1080) ** 2 * 5_000_000);
  return Math.round(fps >= 60 ? b * 1.6 : fps <= 15 ? b * 0.6 : b);
}

export const CAMERA_PRESETS = [
  { id: "360p", height: 360, fps: 30, bitrate: 600_000 },
  { id: "720p", height: 720, fps: 30, bitrate: 1_700_000 },
  { id: "1080p", height: 1080, fps: 30, bitrate: 3_000_000 },
] as const;
