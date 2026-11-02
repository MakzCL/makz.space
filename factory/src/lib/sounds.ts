/**
 * Call sounds, synthesised with Web Audio (no files, work offline).
 * Soft sine tones with gentle attack/release so nothing is harsh.
 */
let ctx: AudioContext | null = null;
const ac = () => {
  try { ctx ??= new AudioContext(); if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; } catch { return null; }
};

function tone(freq: number, at: number, dur: number, vol = 0.08, type: OscillatorType = "sine") {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  o.connect(g).connect(c.destination);
  const t0 = c.currentTime + at;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
  g.gain.setValueAtTime(vol, t0 + Math.max(0.03, dur - 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** Repeats `play` every `every` ms until the returned stop() is called. */
function loop(play: () => void, every: number) {
  play();
  const i = setInterval(play, every);
  return () => clearInterval(i);
}

/** Incoming call: soft two-note chime, twice, every 3 s. */
export const ringIncoming = () => loop(() => {
  [[659.25, 0], [783.99, 0.18], [659.25, 0.6], [783.99, 0.78]].forEach(([f, d]) => tone(f!, d!, 0.32, 0.07));
}, 3000);

/** Outgoing "connecting": UK-style gentle double burr every 3 s. */
export const ringOutgoing = () => loop(() => {
  [0, 0.6].forEach((d) => { tone(400, d, 0.4, 0.035); tone(450, d, 0.4, 0.035); });
}, 3000);

/** Someone joined: short rising pair. */
export const playJoined = () => { tone(523.25, 0, 0.14, 0.07); tone(783.99, 0.12, 0.22, 0.07); };

/** Call ended / someone left: short falling pair. */
export const playEnded = () => { tone(659.25, 0, 0.16, 0.07); tone(440, 0.14, 0.3, 0.06); };

/** Clock in / out reminder: one soft, low two-note chime. */
export const playClock = () => { tone(587.33, 0, 0.35, 0.045); tone(783.99, 0.22, 0.5, 0.04); };
