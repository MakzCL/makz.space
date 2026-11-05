import { onEvent, useStore } from "../store.ts";
import { useVoice } from "./session.ts";

/**
 * SEND's interface sounds — original, synthesised in the browser (no audio files).
 * Soft, rounded "bloops": a sine body with a quick pitch glide, a touch of triangle
 * for warmth, and a short echo, so they read clearly but never sound harsh.
 */
export type Sound =
  | "join" | "leave" | "userJoin" | "userLeave" | "move"
  | "mute" | "unmute" | "deafen" | "undeafen"
  | "streamStart" | "streamStop" | "viewerJoin"
  | "pttOn" | "pttOff" | "disconnect"
  | "message" | "mention"
  | "calling" | "ring" | "ended";

/** A note: start/end frequency (Hz), start time and length (s), loudness 0–1. */
type Note = { f: number; to?: number; at: number; len: number; vol?: number; wave?: OscillatorType };

const SOUNDS: Record<Sound, Note[]> = {
  // You join / leave a voice channel: a bright rising pair / a falling pair.
  join: [{ f: 520, to: 700, at: 0, len: .12 }, { f: 780, to: 1040, at: .09, len: .2 }],
  leave: [{ f: 760, to: 600, at: 0, len: .12 }, { f: 560, to: 400, at: .09, len: .22 }],
  // Someone else joins / leaves your channel: the same shapes, softer and higher.
  userJoin: [{ f: 880, to: 1100, at: 0, len: .09, vol: .6 }, { f: 1170, to: 1320, at: .07, len: .14, vol: .55 }],
  userLeave: [{ f: 1100, to: 900, at: 0, len: .09, vol: .6 }, { f: 820, to: 660, at: .07, len: .16, vol: .55 }],
  move: [{ f: 660, to: 880, at: 0, len: .1 }, { f: 880, to: 660, at: .1, len: .14 }],
  // Mic and headphones: short plucks, down for "off", up for "on".
  mute: [{ f: 620, to: 430, at: 0, len: .11, vol: .8 }],
  unmute: [{ f: 430, to: 640, at: 0, len: .11, vol: .8 }],
  deafen: [{ f: 520, to: 360, at: 0, len: .1, vol: .8 }, { f: 380, to: 260, at: .08, len: .14, vol: .7 }],
  undeafen: [{ f: 300, to: 420, at: 0, len: .1, vol: .8 }, { f: 460, to: 620, at: .08, len: .14, vol: .75 }],
  // Screen share: a little sparkle up / down.
  streamStart: [{ f: 660, at: 0, len: .08, vol: .6 }, { f: 880, at: .06, len: .08, vol: .6 }, { f: 1320, to: 1480, at: .12, len: .18, vol: .55 }],
  streamStop: [{ f: 1320, at: 0, len: .08, vol: .55 }, { f: 880, at: .06, len: .08, vol: .55 }, { f: 620, to: 520, at: .12, len: .18, vol: .55 }],
  viewerJoin: [{ f: 1240, to: 1480, at: 0, len: .1, vol: .4 }],
  // Push-to-talk: barely-there ticks.
  pttOn: [{ f: 1400, to: 1600, at: 0, len: .04, vol: .25, wave: "triangle" }],
  pttOff: [{ f: 1300, to: 1100, at: 0, len: .04, vol: .22, wave: "triangle" }],
  disconnect: [{ f: 700, to: 560, at: 0, len: .12 }, { f: 520, to: 400, at: .1, len: .12 }, { f: 380, to: 260, at: .2, len: .26 }],
  // Messages: a soft pop; mentions get a second, higher note.
  message: [{ f: 990, to: 1180, at: 0, len: .09, vol: .55 }, { f: 1480, at: .06, len: .12, vol: .35 }],
  mention: [{ f: 880, to: 1100, at: 0, len: .09, vol: .7 }, { f: 1320, to: 1480, at: .09, len: .16, vol: .6 }],
  // Calls.
  calling: [{ f: 520, to: 560, at: 0, len: .22, vol: .55 }, { f: 660, to: 700, at: .26, len: .3, vol: .55 }],
  ring: [{ f: 784, at: 0, len: .14 }, { f: 988, at: .15, len: .14 }, { f: 1175, at: .3, len: .22 }, { f: 988, at: .62, len: .14 }, { f: 1175, at: .77, len: .26 }],
  ended: [{ f: 660, to: 560, at: 0, len: .12 }, { f: 520, to: 440, at: .11, len: .14 }, { f: 420, to: 330, at: .23, len: .24 }],
};

let ctx: AudioContext | null = null;
let bus: { input: GainNode } | null = null;
function output() {
  ctx ??= new AudioContext();
  ctx.resume().catch(() => {});
  if (!bus) {
    // Dry signal plus a short, quiet echo for a little "room".
    const input = ctx.createGain(); input.gain.value = 1;
    const delay = ctx.createDelay(); delay.delayTime.value = .085;
    const fb = ctx.createGain(); fb.gain.value = .18;
    const wet = ctx.createGain(); wet.gain.value = .22;
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 5200;
    input.connect(tone).connect(ctx.destination);
    input.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(ctx.destination);
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

export function playSound(kind: Sound, volume = 1) {
  if (muted(kind)) return;
  try {
    const { ctx, input } = output();
    const now = ctx.currentTime + .005;
    const master = Math.min(1, Math.max(0, useVoice.getState().settings.soundVolume ?? 1)) * volume * .11;
    for (const n of SOUNDS[kind]) {
      const start = now + n.at, end = start + n.len, peak = master * (n.vol ?? 1);
      for (const [wave, mix] of [[n.wave ?? "sine", 1], ["triangle", .18]] as const) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = wave;
        osc.frequency.setValueAtTime(n.f, start);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, start + n.len * .8);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peak * mix, start + .008);
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
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = () => { if (timer) clearInterval(timer); timer = null; };
  onEvent("CALL_UPDATE", (call) => {
    stop();
    const me = useStore.getState().me;
    if (!me || me.status === "dnd") return;
    const incoming = call.ringing.includes(me.id), outgoing = useVoice.getState().channelId === call.channel_id && call.ringing.length > 0;
    if (!incoming && !outgoing) return;
    const sound = incoming ? "ring" : "calling";
    playSound(sound);
    timer = setInterval(() => playSound(sound), incoming ? 2600 : 3000);
  });
  onEvent("CALL_DELETE", () => { stop(); playSound("ended"); });
  useVoice.subscribe((next, prev) => { if (next.channelId !== prev.channelId && next.channelId === null) stop(); });

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
