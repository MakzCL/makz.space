/**
 * The sprite atlas for SEND Motion: every particle is painted here once, procedurally, at 128px per cell, in white
 * with its own shading (so one tint colours it). Animated creatures get several frames of a wing-beat cycle.
 * Nothing is downloaded; the atlas is built the first time an effect plays.
 */
export const CELL = 128, GRID = 8;

const STATIC = ["glow", "spark", "star", "snow", "petal", "leaf", "maple", "heart", "ember", "bubble", "drop", "confetti", "feather", "firefly",
  "smoke", "shard", "note", "coin", "ring", "diamond", "flame", "paw", "dust", "twinkle", "hex", "bit0", "bit1", "lantern", "rose", "cube", "streak", "wisp", "bolt"] as const;
const ANIMATED = { crow: 6, butterfly: 6, bat: 6, moth: 6 } as const;

export type SpriteName = (typeof STATIC)[number] | keyof typeof ANIMATED;
export const SPRITES: Record<SpriteName, { index: number; frames: number }> = {} as any;
{
  let i = 0;
  for (const s of STATIC) SPRITES[s] = { index: i++, frames: 1 };
  for (const [s, n] of Object.entries(ANIMATED)) { SPRITES[s as SpriteName] = { index: i, frames: n }; i += n; }
}

type C = CanvasRenderingContext2D;
const R = CELL / 2;

function radial(c: C, r: number, stops: [number, string][]) {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}

const paint: Record<(typeof STATIC)[number], (c: C) => void> = {
  glow(c) { c.fillStyle = radial(c, R, [[0, "rgba(255,255,255,1)"], [.18, "rgba(255,255,255,.62)"], [.45, "rgba(255,255,255,.18)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL); },
  dust(c) { c.fillStyle = radial(c, 22, [[0, "#fff"], [.35, "rgba(255,255,255,.85)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL); },
  spark(c) {
    c.fillStyle = radial(c, R * .55, [[0, "rgba(255,255,255,.55)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL);
    const ray = (len: number, w: number, a: number) => { c.save(); c.rotate(a); const g = c.createLinearGradient(0, -len, 0, len); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.beginPath(); c.moveTo(0, -len); c.quadraticCurveTo(w, 0, 0, len); c.quadraticCurveTo(-w, 0, 0, -len); c.fill(); c.restore(); };
    ray(R * .98, 5, 0); ray(R * .98, 5, Math.PI / 2); ray(R * .45, 3, Math.PI / 4); ray(R * .45, 3, -Math.PI / 4);
    c.fillStyle = radial(c, 10, [[0, "#fff"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-12, -12, 24, 24);
  },
  twinkle(c) { for (const a of [0, Math.PI / 2]) { c.save(); c.rotate(a); const g = c.createLinearGradient(0, -R, 0, R); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.5, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(-1.6, -R, 3.2, CELL); c.restore(); } c.fillStyle = radial(c, 16, [[0, "#fff"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-16, -16, 32, 32); },
  star(c) {
    c.fillStyle = radial(c, R, [[0, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL);
    c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 15 : 38, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath();
    c.lineJoin = "round"; c.lineWidth = 7; c.strokeStyle = "#fff"; c.fillStyle = radial(c, 38, [[0, "#fff"], [.7, "#f1f1f1"], [1, "#d4d4d4"]]); c.fill(); c.stroke();
  },
  snow(c) {
    c.fillStyle = radial(c, R, [[0, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL);
    c.strokeStyle = "#fff"; c.lineCap = "round"; c.lineWidth = 5;
    for (let k = 0; k < 6; k++) { c.save(); c.rotate(k * Math.PI / 3); c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -46);
      for (const [y, l] of [[-18, 11], [-31, 9], [-41, 5]] as const) { c.moveTo(0, y); c.lineTo(-l, y - l); c.moveTo(0, y); c.lineTo(l, y - l); }
      c.stroke(); c.restore(); }
    c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, 7, 0, 7); c.fill();
  },
  petal(c) {
    c.rotate(-.3); c.beginPath(); c.moveTo(0, 44); c.bezierCurveTo(-40, 18, -32, -34, -7, -44); c.lineTo(0, -34); c.lineTo(7, -44); c.bezierCurveTo(32, -34, 40, 18, 0, 44); c.closePath();
    const g = c.createLinearGradient(0, 44, 0, -44); g.addColorStop(0, "#ffffff"); g.addColorStop(.55, "#f4f4f4"); g.addColorStop(1, "#c9c9c9"); c.fillStyle = g; c.fill();
    c.strokeStyle = "rgba(160,160,160,.45)"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 40); c.quadraticCurveTo(-4, 0, 0, -30); c.stroke();
  },
  rose(c) {
    c.beginPath(); c.moveTo(0, 42); c.bezierCurveTo(-46, 22, -40, -40, 0, -40); c.bezierCurveTo(40, -40, 46, 22, 0, 42); c.closePath();
    c.fillStyle = radial(c, 50, [[0, "#ffffff"], [.6, "#e6e6e6"], [1, "#a8a8a8"]]); c.fill();
    c.strokeStyle = "rgba(255,255,255,.7)"; c.lineWidth = 2; c.beginPath(); c.arc(-6, -10, 22, 3.6, 5.2); c.stroke();
  },
  leaf(c) {
    c.rotate(.5); c.beginPath(); c.moveTo(0, -50); c.bezierCurveTo(30, -26, 28, 26, 0, 46); c.bezierCurveTo(-28, 26, -30, -26, 0, -50); c.closePath();
    const g = c.createLinearGradient(-26, 0, 26, 0); g.addColorStop(0, "#d8d8d8"); g.addColorStop(.5, "#ffffff"); g.addColorStop(1, "#bdbdbd"); c.fillStyle = g; c.fill();
    c.strokeStyle = "rgba(110,110,110,.55)"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, -44); c.lineTo(0, 56);
    for (let y = -30; y < 36; y += 13) { c.moveTo(0, y + 8); c.lineTo(-17, y - 4); c.moveTo(0, y + 8); c.lineTo(17, y - 4); } c.stroke();
  },
  maple(c) {
    const pts: [number, number][] = [[0, -52], [9, -30], [24, -38], [20, -16], [46, -22], [38, -6], [50, 4], [24, 12], [28, 28], [6, 18], [3, 40], [-3, 40], [-6, 18], [-28, 28], [-24, 12], [-50, 4], [-38, -6], [-46, -22], [-20, -16], [-24, -38], [-9, -30]];
    c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.lineJoin = "round";
    c.fillStyle = radial(c, 54, [[0, "#ffffff"], [.7, "#e8e8e8"], [1, "#b4b4b4"]]); c.fill();
    c.strokeStyle = "rgba(100,100,100,.5)"; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 50); c.lineTo(0, -44); c.moveTo(0, 8); c.lineTo(40, -16); c.moveTo(0, 8); c.lineTo(-40, -16); c.moveTo(0, 14); c.lineTo(22, 24); c.moveTo(0, 14); c.lineTo(-22, 24); c.stroke();
  },
  heart(c) {
    c.fillStyle = radial(c, R, [[0, "rgba(255,255,255,.3)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL);
    c.beginPath(); c.moveTo(0, 38); c.bezierCurveTo(-56, 0, -40, -46, 0, -20); c.bezierCurveTo(40, -46, 56, 0, 0, 38); c.closePath();
    c.fillStyle = radial(c, 48, [[0, "#ffffff"], [.6, "#ececec"], [1, "#9c9c9c"]]); c.fill();
    c.fillStyle = "rgba(255,255,255,.95)"; c.beginPath(); c.ellipse(-16, -18, 9, 5, -.7, 0, 7); c.fill();
  },
  ember(c) { c.scale(.45, 1); c.fillStyle = radial(c, R, [[0, "#fff"], [.15, "rgba(255,255,255,.95)"], [.4, "rgba(255,255,255,.35)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL); },
  bubble(c) {
    c.fillStyle = radial(c, 44, [[0, "rgba(255,255,255,.05)"], [.78, "rgba(255,255,255,.18)"], [.95, "rgba(255,255,255,.85)"], [1, "rgba(255,255,255,0)"]]); c.beginPath(); c.arc(0, 0, 44, 0, 7); c.fill();
    c.strokeStyle = "rgba(255,255,255,.9)"; c.lineWidth = 4; c.lineCap = "round"; c.beginPath(); c.arc(0, 0, 32, 3.7, 4.6); c.stroke();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(16, 20, 3.5, 0, 7); c.fill();
  },
  drop(c) { const g = c.createLinearGradient(0, -R, 0, R); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.85, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(-2.2, -R, 4.4, CELL); },
  streak(c) { const g = c.createLinearGradient(-R, 0, R, 0); g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(.75, "rgba(255,255,255,.8)"); g.addColorStop(.95, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, R, 3.4, 0, 0, 7); c.fill(); },
  confetti(c) { const g = c.createLinearGradient(-20, 0, 20, 0); g.addColorStop(0, "#d0d0d0"); g.addColorStop(.5, "#ffffff"); g.addColorStop(1, "#bbbbbb"); c.fillStyle = g; c.beginPath(); c.roundRect(-20, -30, 40, 60, 5); c.fill(); },
  feather(c) {
    c.rotate(.35); c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.moveTo(0, 54); c.quadraticCurveTo(-3, 0, 4, -54); c.stroke();
    for (let i = 0; i < 26; i++) { const t = i / 25, y = 46 - t * 96, w = Math.sin(t * Math.PI) * 22 + 4; c.strokeStyle = `rgba(255,255,255,${.55 + .4 * Math.sin(t * Math.PI)})`; c.lineWidth = 2.2;
      c.beginPath(); c.moveTo(0, y); c.quadraticCurveTo(-w * .6, y - 6, -w, y - 14); c.moveTo(1, y); c.quadraticCurveTo(w * .6, y - 6, w, y - 13); c.stroke(); }
  },
  firefly(c) { c.fillStyle = radial(c, R, [[0, "#fff"], [.08, "#fff"], [.25, "rgba(255,255,255,.45)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL); },
  smoke(c) {
    let s = 7; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 22; i++) { const a = rnd() * 6.28, d = rnd() * 26, r = 14 + rnd() * 22;
      c.fillStyle = radial(c, r, [[0, "rgba(255,255,255,.16)"], [1, "rgba(255,255,255,0)"]]); c.save(); c.translate(Math.cos(a) * d, Math.sin(a) * d); c.fillRect(-r, -r, r * 2, r * 2); c.restore(); }
  },
  wisp(c) {
    for (let i = 0; i < 18; i++) { const t = i / 17, x = Math.sin(t * 5) * 14, y = 46 - t * 92, r = 26 * (1 - t * .7);
      c.fillStyle = radial(c, r, [[0, `rgba(255,255,255,${.28 * (1 - t * .5)})`], [1, "rgba(255,255,255,0)"]]); c.save(); c.translate(x, y); c.fillRect(-r, -r, r * 2, r * 2); c.restore(); }
  },
  shard(c) {
    c.beginPath(); c.moveTo(0, -54); c.lineTo(18, -10); c.lineTo(10, 50); c.lineTo(-12, 40); c.lineTo(-18, -14); c.closePath();
    c.fillStyle = "rgba(255,255,255,.55)"; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 2.5; c.lineJoin = "round"; c.stroke();
    c.fillStyle = "rgba(255,255,255,.9)"; c.beginPath(); c.moveTo(0, -54); c.lineTo(18, -10); c.lineTo(2, 0); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,.3)"; c.beginPath(); c.moveTo(2, 0); c.lineTo(10, 50); c.lineTo(-12, 40); c.closePath(); c.fill();
  },
  diamond(c) {
    c.fillStyle = radial(c, R, [[0, "rgba(255,255,255,.3)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL);
    c.lineJoin = "round"; c.strokeStyle = "#fff"; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-34, -12); c.lineTo(-18, -32); c.lineTo(18, -32); c.lineTo(34, -12); c.lineTo(0, 38); c.closePath(); c.fillStyle = "rgba(255,255,255,.5)"; c.fill(); c.stroke();
    c.beginPath(); c.moveTo(-34, -12); c.lineTo(34, -12); c.moveTo(-18, -32); c.lineTo(-8, -12); c.lineTo(0, 38); c.lineTo(8, -12); c.lineTo(18, -32); c.stroke();
    c.fillStyle = "rgba(255,255,255,.95)"; c.beginPath(); c.moveTo(-18, -32); c.lineTo(-8, -12); c.lineTo(-34, -12); c.closePath(); c.fill();
  },
  coin(c) {
    c.fillStyle = radial(c, 46, [[0, "#ffffff"], [.75, "#e2e2e2"], [.86, "#9a9a9a"], [.93, "#f7f7f7"], [1, "#8a8a8a"]]); c.beginPath(); c.arc(0, 0, 44, 0, 7); c.fill();
    c.strokeStyle = "rgba(120,120,120,.6)"; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, 32, 0, 7); c.stroke();
    c.fillStyle = "rgba(255,255,255,.9)"; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 8 : 20, a = -Math.PI / 2 + i * Math.PI / 5; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.fill();
  },
  ring(c) { c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, R - 6, 0, 7); c.stroke(); c.strokeStyle = "rgba(255,255,255,.3)"; c.lineWidth = 10; c.stroke(); },
  flame(c) {
    c.beginPath(); c.moveTo(0, 50); c.bezierCurveTo(-34, 40, -30, 4, -10, -16); c.bezierCurveTo(-4, -28, 2, -40, 0, -56); c.bezierCurveTo(22, -30, 34, 0, 30, 22); c.bezierCurveTo(28, 40, 14, 50, 0, 50); c.closePath();
    const g = c.createLinearGradient(0, 50, 0, -56); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.6, "rgba(255,255,255,.7)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fill();
    c.fillStyle = radial(c, 24, [[0, "#fff"], [1, "rgba(255,255,255,0)"]]); c.save(); c.translate(0, 26); c.fillRect(-24, -24, 48, 48); c.restore();
  },
  paw(c) { c.fillStyle = "#fff"; c.beginPath(); c.ellipse(0, 14, 22, 18, 0, 0, 7); c.fill(); for (const [x, y, r] of [[-26, -10, 9], [-10, -26, 10], [10, -26, 10], [26, -10, 9]] as const) { c.beginPath(); c.ellipse(x, y, r, r * 1.25, x / 60, 0, 7); c.fill(); } },
  hex(c) { c.strokeStyle = "#fff"; c.lineWidth = 4; c.beginPath(); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; c.lineTo(Math.cos(a) * 40, Math.sin(a) * 40); } c.closePath(); c.stroke(); c.fillStyle = "rgba(255,255,255,.15)"; c.fill(); },
  bit0(c) { c.fillStyle = "#fff"; c.font = "bold 84px ui-monospace, monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("0", 0, 4); },
  bit1(c) { c.fillStyle = "#fff"; c.font = "bold 84px ui-monospace, monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("1", 0, 4); },
  note(c) { c.fillStyle = "#fff"; c.beginPath(); c.ellipse(-14, 30, 16, 12, -.4, 0, 7); c.fill(); c.fillRect(-1, -44, 6, 74); c.beginPath(); c.moveTo(5, -44); c.bezierCurveTo(30, -36, 34, -16, 22, -4); c.bezierCurveTo(26, -18, 16, -26, 5, -26); c.fill(); },
  lantern(c) {
    c.fillStyle = radial(c, R, [[0, "rgba(255,255,255,.45)"], [1, "rgba(255,255,255,0)"]]); c.fillRect(-R, -R, CELL, CELL);
    c.fillStyle = radial(c, 36, [[0, "#ffffff"], [.7, "#efefef"], [1, "#bdbdbd"]]); c.beginPath(); c.ellipse(0, 0, 26, 32, 0, 0, 7); c.fill();
    c.strokeStyle = "rgba(120,120,120,.5)"; c.lineWidth = 2; for (const x of [-13, 0, 13]) { c.beginPath(); c.ellipse(0, 0, Math.abs(x) + 1, 32, 0, 0, 7); c.stroke(); }
    c.fillStyle = "#9d9d9d"; c.fillRect(-12, -36, 24, 6); c.fillRect(-12, 30, 24, 6);
  },
  cube(c) {
    const s = 30; c.lineJoin = "round"; c.strokeStyle = "rgba(255,255,255,.95)"; c.lineWidth = 2;
    const face = (pts: number[][], col: string) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!))); c.closePath(); c.fillStyle = col; c.fill(); c.stroke(); };
    face([[0, -s], [s, -s / 2], [0, 0], [-s, -s / 2]], "#ffffff"); face([[-s, -s / 2], [0, 0], [0, s], [-s, s / 2]], "#bdbdbd"); face([[s, -s / 2], [0, 0], [0, s], [s, s / 2]], "#8e8e8e");
  },
  bolt(c) { c.fillStyle = "#fff"; c.beginPath(); c.moveTo(8, -54); c.lineTo(-20, 6); c.lineTo(0, 6); c.lineTo(-10, 54); c.lineTo(22, -10); c.lineTo(2, -10); c.closePath(); c.fill(); },
};

/** A creature at wing phase p (0…1 around a full beat). Drawn as a soft-edged silhouette with a little shading. */
function creature(c: C, kind: keyof typeof ANIMATED, p: number) {
  const beat = Math.sin(p * Math.PI * 2); // 1 = wings up, -1 = wings down
  if (kind === "crow" || kind === "bat") {
    const bat = kind === "bat";
    c.fillStyle = "#fff";
    // body
    c.beginPath(); c.ellipse(0, 4, bat ? 8 : 9, bat ? 12 : 15, 0, 0, 7); c.fill();
    if (!bat) { c.beginPath(); c.arc(0, -13, 7, 0, 7); c.fill(); c.beginPath(); c.moveTo(-3, -17); c.lineTo(0, -28); c.lineTo(3, -17); c.fill(); // head + beak (bird seen from below/front, flying up-screen)
      c.beginPath(); c.moveTo(-8, 14); c.lineTo(-11, 34); c.quadraticCurveTo(0, 38, 11, 34); c.lineTo(8, 14); c.fill(); } // tail fan
    else { c.beginPath(); c.moveTo(-6, -8); c.lineTo(-9, -20); c.lineTo(-2, -12); c.lineTo(2, -12); c.lineTo(9, -20); c.lineTo(6, -8); c.fill(); }
    for (const side of [-1, 1]) {
      c.save(); c.scale(side, 1);
      const lift = beat * 26, mid = beat * 12, fold = 1 - Math.max(0, -beat) * .25;
      c.beginPath(); c.moveTo(4, -4);
      if (bat) {
        c.quadraticCurveTo(22 * fold, -10 - mid, 30 * fold, -6 - lift); c.lineTo(52 * fold, -2 - lift * 1.1);
        c.quadraticCurveTo(46 * fold, 6 - lift * .6, 40 * fold, 12 - lift * .6); c.quadraticCurveTo(34 * fold, 6 - lift * .4, 28 * fold, 14 - lift * .4); c.quadraticCurveTo(20 * fold, 8 - mid * .3, 14 * fold, 16 - mid * .3); c.quadraticCurveTo(10, 8, 4, 8);
      } else {
        c.quadraticCurveTo(20 * fold, -8 - mid, 34 * fold, -6 - lift * .8); c.lineTo(58 * fold, -2 - lift);
        // primary feathers as fingers
        for (let f = 0; f < 5; f++) { const fx = 58 * fold - f * 6, fy = -2 - lift + f * 4; c.lineTo(fx - 2, fy + 6); c.lineTo(fx - 6, fy + 3); }
        c.quadraticCurveTo(24 * fold, 12 - mid * .4, 6, 8);
      }
      c.closePath(); c.fill(); c.restore();
    }
    // subtle sheen so tinting keeps some form
    c.globalCompositeOperation = "source-atop"; c.fillStyle = "rgba(0,0,0,.18)"; c.fillRect(-R, 0, CELL, R); c.globalCompositeOperation = "source-over";
    return;
  }
  // butterflies & moths: seen from above, wings foreshortened by the beat
  const open = .25 + .75 * (beat * .5 + .5), moth = kind === "moth";
  for (const side of [-1, 1]) {
    c.save(); c.scale(side * open, 1);
    const g = c.createRadialGradient(10, -8, 2, 18, -6, 40); g.addColorStop(0, "#ffffff"); g.addColorStop(.65, moth ? "#d9d9d9" : "#f2f2f2"); g.addColorStop(1, moth ? "#9a9a9a" : "#bdbdbd");
    c.fillStyle = g;
    c.beginPath(); c.moveTo(2, -4); c.bezierCurveTo(16, -40, 52, -40, 46, -12); c.bezierCurveTo(42, 2, 20, 2, 4, 0); c.fill();
    c.beginPath(); c.moveTo(2, 2); c.bezierCurveTo(30, 6, 36, 30, 22, 36); c.bezierCurveTo(12, 40, 6, 22, 2, 8); c.fill();
    c.fillStyle = "rgba(255,255,255,.95)"; c.beginPath(); c.arc(32, -20, 5, 0, 7); c.fill();
    c.strokeStyle = "rgba(90,90,90,.45)"; c.lineWidth = 1.3; c.beginPath(); c.moveTo(4, -2); c.lineTo(40, -26); c.moveTo(4, -1); c.lineTo(44, -10); c.moveTo(4, 4); c.lineTo(24, 30); c.stroke();
    c.restore();
  }
  c.fillStyle = "#a8a8a8"; c.beginPath(); c.ellipse(0, 4, 3, 16, 0, 0, 7); c.fill();
  c.strokeStyle = "#cfcfcf"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-1, -12); c.quadraticCurveTo(-6, -24, -10, -28); c.moveTo(1, -12); c.quadraticCurveTo(6, -24, 10, -28); c.stroke();
}

let atlas: HTMLCanvasElement | null = null;
export function spriteAtlas(): HTMLCanvasElement {
  if (atlas) return atlas;
  const cv = document.createElement("canvas"); cv.width = cv.height = CELL * GRID;
  const c = cv.getContext("2d")!;
  const cell = (i: number, f: () => void) => { c.save(); c.translate((i % GRID) * CELL + R, Math.floor(i / GRID) * CELL + R); c.beginPath(); c.rect(-R, -R, CELL, CELL); c.clip(); f(); c.restore(); };
  for (const s of STATIC) cell(SPRITES[s].index, () => paint[s](c));
  for (const [k, n] of Object.entries(ANIMATED)) for (let f = 0; f < n; f++) cell(SPRITES[k as SpriteName].index + f, () => creature(c, k as keyof typeof ANIMATED, f / n));
  return (atlas = cv);
}
