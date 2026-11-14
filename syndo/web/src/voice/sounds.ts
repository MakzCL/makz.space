import { onEvent, useStore } from "../store.ts";
import { useVoice } from "./session.ts";

/**
 * SEND's interface sounds — original, synthesised in the browser (no audio files).
 * Styled after the feel of Discord's: short tuned "mallet" notes (a sine with soft overtones that ring out
 * quickly), small two- or three-note melodies going up for on/join and down for off/leave, and a gentle level
 * that sits under voices. The melodies are SEND's own.
 */
export type Sound =
  | "join" | "leave" | "userJoin" | "userLeave" | "move"
  | "mute" | "unmute" | "deafen" | "undeafen"
  | "streamStart" | "streamStop" | "viewerJoin"
  | "pttOn" | "pttOff" | "disconnect"
  | "message" | "mention"
  | "calling" | "ring" | "ended";

/** A note: pitch (Hz, optional glide target), start (s), ring time (s), loudness 0–1, timbre. */
type Note = { f: number; to?: number; at: number; len: number; vol?: number; tone?: "mallet" | "bell" | "soft" | "tick" };

// Note names → Hz, so the melodies read like music.
const N = { G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880, B5: 987.8, C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568, A6: 1760 };

const SOUNDS: Record<Sound, Note[]> = {
  // You join / leave a voice channel: two bright notes up / down.
  join: [{ f: N.D5, at: 0, len: .28 }, { f: N.A5, at: .075, len: .42 }],
  leave: [{ f: N.A5, at: 0, len: .28 }, { f: N.D5, at: .075, len: .42 }],
  // Someone else joins / leaves: the same idea, a fourth higher and a little softer.
  userJoin: [{ f: N.G5, at: 0, len: .24, vol: .8 }, { f: N.D6, at: .07, len: .36, vol: .8 }],
  userLeave: [{ f: N.D6, at: 0, len: .24, vol: .8 }, { f: N.G5, at: .07, len: .36, vol: .8 }],
  move: [{ f: N.E5, at: 0, len: .2 }, { f: N.A5, at: .07, len: .2 }, { f: N.E5, at: .14, len: .3 }],
  // Mic and headphones: low, rounded blips — down for off, up for on.
  mute: [{ f: N.D5, at: 0, len: .14, vol: .85, tone: "soft" }, { f: N.A4, at: .055, len: .22, vol: .85, tone: "soft" }],
  unmute: [{ f: N.A4, at: 0, len: .14, vol: .85, tone: "soft" }, { f: N.D5, at: .055, len: .22, vol: .85, tone: "soft" }],
  deafen: [{ f: N.E5, at: 0, len: .13, vol: .85, tone: "soft" }, { f: N.B4, at: .055, len: .13, vol: .85, tone: "soft" }, { f: N.G4, at: .11, len: .26, vol: .85, tone: "soft" }],
  undeafen: [{ f: N.G4, at: 0, len: .13, vol: .85, tone: "soft" }, { f: N.B4, at: .055, len: .13, vol: .85, tone: "soft" }, { f: N.E5, at: .11, len: .26, vol: .85, tone: "soft" }],
  // Going live: a quick rising sparkle / falling for stop.
  streamStart: [{ f: N.C5, at: 0, len: .16, vol: .7 }, { f: N.E5, at: .06, len: .16, vol: .7 }, { f: N.G5, at: .12, len: .16, vol: .7 }, { f: N.C6, at: .18, len: .4, vol: .75, tone: "bell" }],
  streamStop: [{ f: N.C6, at: 0, len: .16, vol: .7 }, { f: N.G5, at: .06, len: .16, vol: .7 }, { f: N.E5, at: .12, len: .16, vol: .7 }, { f: N.C5, at: .18, len: .4, vol: .75 }],
  viewerJoin: [{ f: N.A5, at: 0, len: .18, vol: .5, tone: "bell" }, { f: N.E6, at: .06, len: .26, vol: .45, tone: "bell" }],
  // Push-to-talk: barely-there ticks.
  pttOn: [{ f: 1600, at: 0, len: .035, vol: .3, tone: "tick" }],
  pttOff: [{ f: 1200, at: 0, len: .035, vol: .26, tone: "tick" }],
  disconnect: [{ f: N.A5, at: 0, len: .18 }, { f: N.E5, at: .09, len: .18 }, { f: N.A4, at: .18, len: .4 }],
  // Messages: a short, high two-note "blip"; mentions ring a bit longer.
  message: [{ f: N.C6, at: 0, len: .12, vol: .7, tone: "bell" }, { f: N.G6, at: .045, len: .22, vol: .55, tone: "bell" }],
  mention: [{ f: N.E6, at: 0, len: .14, vol: .8, tone: "bell" }, { f: N.A6, at: .055, len: .3, vol: .7, tone: "bell" }],
  // Calls: an outgoing "calling" pulse and a friendly incoming ring.
  calling: [{ f: N.E5, at: 0, len: .3, vol: .6 }, { f: N.A5, at: .32, len: .45, vol: .6 }],
  ring: [{ f: N.E5, at: 0, len: .2 }, { f: N.A5, at: .14, len: .2 }, { f: N.C6, at: .28, len: .2 }, { f: N.B5, at: .42, len: .2 }, { f: N.A5, at: .56, len: .45 },
    { f: N.E5, at: 1.1, len: .2 }, { f: N.A5, at: 1.24, len: .2 }, { f: N.C6, at: 1.38, len: .5 }],
  ended: [{ f: N.C6, at: 0, len: .2 }, { f: N.G5, at: .1, len: .2 }, { f: N.C5, at: .2, len: .45 }],
};

/** Overtones per timbre: [multiple of the pitch, level, how fast it fades vs. the note]. */
const TIMBRES: Record<NonNullable<Note["tone"]>, [number, number, number][]> = {
  mallet: [[1, 1, 1], [2, .28, .55], [3.01, .09, .35], [4.2, .05, .2]],
  bell: [[1, 1, 1], [2.76, .18, .5], [5.4, .07, .3]],
  soft: [[1, 1, 1], [2, .12, .5]],
  tick: [[1, 1, 1], [3, .4, .6]],
};

let ctx: AudioContext | null = null;
let bus: { input: GainNode } | null = null;
function output() {
  ctx ??= new AudioContext();
  ctx.resume().catch(() => {});
  if (!bus) {
    // A gentle compressor keeps chords even, then a short, quiet room echo.
    const input = ctx.createGain(); input.gain.value = 1;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = .002; comp.release.value = .12;
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 7000;
    const delay = ctx.createDelay(); delay.delayTime.value = .07;
    const fb = ctx.createGain(); fb.gain.value = .12;
    const wet = ctx.createGain(); wet.gain.value = .12;
    input.connect(comp).connect(tone);
    tone.connect(ctx.destination);
    tone.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(ctx.destination);
    bus = { input };
  }
  return { ctx, input: bus.input };
}

function muted(kind: Sound) {
  const s = useStore.getState(), v = useVoice.getState();
  if (v.settings.suppressSoundEffects) return true;
  const prefs = (s.me?.settings as any)?.notifications;
  if (prefs?.sounds === false) return true;
  if ((kind === "pttOn" || kind === "pttOff") && v.settings.pttSounds === false) return true;
  return false;
}

/** Loudness at 100%: about Discord's level — clear, but under people's voices. */
const LEVEL = .2;

export function playSound(kind: Sound, volume = 1) {
  if (muted(kind)) return;
  try {
    const { ctx, input } = output();
    const now = ctx.currentTime + .005;
    const master = Math.min(1, Math.max(0, useVoice.getState().settings.soundVolume ?? 1)) * volume * LEVEL;
    for (const n of SOUNDS[kind]) {
      const start = now + n.at, peak = master * (n.vol ?? 1);
      for (const [mul, level, fade] of TIMBRES[n.tone ?? "mallet"]) {
        const end = start + Math.max(.03, n.len * fade);
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(n.f * mul, start);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to * mul, start + n.len * .8);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peak * level, start + .004);
        gain.gain.exponentialRampToValueAtTime(.0001, end);
        osc.connect(gain).connect(input);
        osc.start(start); osc.stop(end + .02);
      }
    }
  } catch { /* Audio is optional; never interfere with a call. */ }
}
/** Older name, kept for existing callers. */
export const playCallSound = (kind: Sound) => playSound(kind);

export function initCallSounds() {
  // Ringing never goes on forever: at most 30 s per call (Discord-like), and the caller's "calling" tone stops as
  // soon as someone picks up. A call that already rang out doesn't start ringing again on later updates.
  const MAX_RING_MS = 30_000;
  let timer: ReturnType<typeof setInterval> | null = null, stopAt = 0, ringingFor: string | null = null;
  const rangOut = new Set<string>();
  const stop = () => { if (timer) clearInterval(timer); timer = null; ringingFor = null; };
  const someoneElseJoined = (channelId: string) => {
    const s = useStore.getState(); return Object.values(s.voice).some((v) => v.channel_id === channelId && v.user_id !== s.me?.id);
  };
  onEvent("CALL_UPDATE", (call) => {
    const me = useStore.getState().me;
    const key = `${call.channel_id}:${call.started_at ?? ""}`;
    const incoming = !!me && call.ringing.includes(me.id) && useVoice.getState().channelId !== call.channel_id;
    const outgoing = useVoice.getState().channelId === call.channel_id && call.ringing.length > 0 && !someoneElseJoined(call.channel_id);
    if (!me || me.status === "dnd" || (!incoming && !outgoing) || rangOut.has(key)) { if (ringingFor === call.channel_id || !timer) stop(); return; }
    if (timer && ringingFor === call.channel_id) return; // already ringing for this call: keep the same 30 s window
    stop();
    ringingFor = call.channel_id; stopAt = Date.now() + MAX_RING_MS;
    const sound = incoming ? "ring" : "calling";
    playSound(sound);
    timer = setInterval(() => {
      const still = useVoice.getState().channelId;
      if (Date.now() >= stopAt || (incoming && still === call.channel_id) || (!incoming && (still !== call.channel_id || someoneElseJoined(call.channel_id)))) { rangOut.add(key); stop(); return; }
      playSound(sound);
    }, incoming ? 2600 : 3000);
  });
  onEvent("CALL_DELETE", (d: any) => { if (!d || !ringingFor || d.channel_id === ringingFor) { stop(); playSound("ended"); } });
  useVoice.subscribe((next, prev) => { if (next.channelId !== prev.channelId) stop(); });
  useStore.subscribe((s, p) => { if (ringingFor && s.voice !== p.voice && useVoice.getState().channelId === ringingFor && someoneElseJoined(ringingFor)) stop(); });

  // Other people joining / leaving the voice channel I'm in, and starting / stopping a stream.
  let room: string | null = null, since = 0;
  let here = new Map<string, boolean>(); // user → streaming
  const others = (channelId: string | null) => {
    const s = useStore.getState(), out = new Map<string, boolean>();
    if (!channelId || !s.me) return out;
    for (const v of Object.values(s.voice)) if (v.channel_id === channelId && v.user_id !== s.me.id) out.set(v.user_id, !!v.self_stream);
    return out;
  };
  const check = () => {
    const channelId = useVoice.getState().channelId;
    const now = others(channelId);
    if (channelId !== room) { room = channelId; since = Date.now(); here = now; return; }
    // Right after joining, the existing members "arrive" — that's not news.
    if (Date.now() - since > 1200) {
      let joined = false, left = false, streamOn = false, streamOff = false;
      for (const [u, streaming] of now) { if (!here.has(u)) joined = true; else if (streaming && !here.get(u)) streamOn = true; else if (!streaming && here.get(u)) streamOff = true; }
      for (const u of here.keys()) if (!now.has(u)) left = true;
      if (joined) playSound("userJoin"); else if (left) playSound("userLeave");
      else if (streamOn) playSound("streamStart", .8); else if (streamOff) playSound("streamStop", .8);
    }
    here = now;
  };
  useStore.subscribe((s, p) => { if (s.voice !== p.voice) check(); });
  useVoice.subscribe((s, p) => {
    if (s.channelId !== p.channelId) check();
    if (s.channelId && s.sharing !== p.sharing) playSound(s.sharing ? "streamStart" : "streamStop");
    if (s.channelId && s.pttActive !== p.pttActive && s.settings.mode === "ptt") playSound(s.pttActive ? "pttOn" : "pttOff");
    if (p.status === "connected" && s.status === "reconnecting") playSound("disconnect", .7);
  });
}
