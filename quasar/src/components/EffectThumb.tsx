import { useEffect, useRef } from "react";
import { Canvas, createEffect, idleCtx } from "../lib/fx";
import type { Params } from "../lib/fx";

// One shared animation loop for every thumbnail on screen.
const live = new Set<(t: number, dt: number) => void>();
let running = false;
let last = 0;
function loop(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  live.forEach((f) => f(now / 1000, dt));
  if (live.size) requestAnimationFrame(loop);
  else running = false;
}

/** A live, low-resolution render of an effect using the TS port. */
export function EffectThumb({ effect, params, w = 64, h = 36, className }: { effect: string; params: Params; w?: number; h?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const p = useRef(params);
  p.current = params;
  useEffect(() => {
    const el = ref.current!;
    el.width = w;
    el.height = h;
    const fx = createEffect(effect);
    if (!fx) return;
    const cv = new Canvas(w, h);
    const ctx = el.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    let pressT = 0;
    const tick = (t: number, dt: number) => {
      if (!visible) return;
      const c = idleCtx(t, dt, w / h);
      pressT += dt;
      if (pressT > 0.9 && effect === "ripple") {
        pressT = 0;
        c.presses = [{ u: Math.random(), v: Math.random() }];
      }
      fx(c, p.current, cv);
      const d = img.data;
      for (let i = 0, j = 0; i < cv.px.length; i += 3, j += 4) {
        d[j] = Math.min(255, cv.px[i] * 255);
        d[j + 1] = Math.min(255, cv.px[i + 1] * 255);
        d[j + 2] = Math.min(255, cv.px[i + 2] * 255);
        d[j + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    live.add(tick);
    if (!running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(loop);
    }
    return () => {
      live.delete(tick);
      io.disconnect();
    };
  }, [effect, w, h]);
  return <canvas ref={ref} className={className} />;
}
