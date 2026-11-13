import { useEffect, useMemo, useRef, useState } from "react";
import { Sim, addView, getRenderer, kick, stillFrame, type View } from "./engine.ts";
import { sceneFor } from "./recipes.ts";
import { collectionById } from "../collections.ts";

const dprCap = (max: number) => Math.min(max, window.devicePixelRatio || 1);

function useVisible(ref: React.RefObject<Element | null>) {
  const [v, setV] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setV(!!e?.isIntersecting), { rootMargin: "60px" });
    io.observe(el); return () => io.disconnect();
  }, [ref]);
  return v;
}

/**
 * A collection's profile effect, laid over a profile card: the atmosphere and hero object sit behind the card's text,
 * particles and creatures fly over it. Plays its entrance when the card appears, then loops. Without motion it
 * shows a still frame; without WebGL2 it renders nothing (the caller keeps the vector frame).
 */
export function ProfileEffect({ id, animate }: { id: string; animate: boolean }) {
  const info = sceneFor(id);
  const back = useRef<HTMLCanvasElement>(null), front = useRef<HTMLCanvasElement>(null);
  const visible = useVisible(back);
  const sim = useMemo(() => (info ? new Sim(info.scene, "card") : null), [id]); // eslint-disable-line
  const [still, setStill] = useState<string | null>(null);

  useEffect(() => {
    const b = back.current, f = front.current; if (!sim || !b || !f || !animate || !getRenderer()) return;
    const card = b.parentElement!;
    const measure = () => {
      const r = card.getBoundingClientRect(), a = card.querySelector(".pc-av .avatar")?.getBoundingClientRect();
      const W = b.clientWidth || r.width, H = b.clientHeight || r.height; if (!W || !H) return;
      const k = W / r.width || 1; // the card may be CSS-scaled (gallery preview)
      sim.resize(W, H, a ? { x: (a.left + a.width / 2 - r.left) * k, y: (a.top + a.height / 2 - r.top) * k } : { x: W * .18, y: H * .25 });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(card);
    const born = performance.now();
    if (sim.t === 0) sim.intro();
    const mk = (canvas: HTMLCanvasElement, kind: "back" | "front", dpr: number): View => ({ sim, kind, canvas, ctx: canvas.getContext("2d")!, visible: false, dpr, born });
    const vb = mk(b, "back", dprCap(1.5)), vf = mk(f, "front", dprCap(2));
    const offB = addView(vb), offF = addView(vf);
    (b as any).__views = [vb, vf];
    return () => { ro.disconnect(); offB(); offF(); };
  }, [sim, animate]);

  useEffect(() => {
    const vs: View[] | undefined = (back.current as any)?.__views;
    if (vs) { for (const v of vs) v.visible = visible; if (visible) kick(); }
  }, [visible, sim, animate]);

  useEffect(() => {
    if (animate || !info || !back.current) { setStill(null); return; }
    const el = back.current, w = Math.round(el.clientWidth * dprCap(2)), h = Math.round(el.clientHeight * dprCap(2));
    if (!w || !h) return;
    let on = true; stillFrame(id, info.scene, "card", w, h).then((u) => on && setStill(u));
    return () => { on = false; };
  }, [animate, id]); // eslint-disable-line

  if (!info) return null;
  return <>
    <canvas ref={back} className="motion-back" aria-hidden="true" />
    <canvas ref={front} className="motion-front" aria-hidden="true" />
    {still && <img className="motion-still" src={still} alt="" aria-hidden="true" />}
    <Emblem id={id} animate={animate} heroRight={(info.scene.hero?.x ?? 0) > .5} />
  </>;
}

/** The collection's own logo or artwork, worn on the card like a patch: logos glow in the effect's colour, covers sit in a small frame. */
function Emblem({ id, animate, heroRight }: { id: string; animate: boolean; heroRight: boolean }) {
  const c = collectionById(id);
  if (!c?.art) return null;
  return <span className={`motion-emblem emblem-${c.artKind ?? "cover"} ${heroRight ? "left" : "right"} ${animate ? "" : "still"}`} aria-hidden="true" style={{ "--emblem": c.primary } as React.CSSProperties}>
    <img src={c.art} alt="" loading="lazy" decoding="async" />
  </span>;
}

/** A collection's avatar decoration: live while it matters (profile cards, hover), a cached still frame everywhere else. */
export function AvatarDecoration({ id, size, live }: { id: string; size: number; live: boolean }) {
  const info = sceneFor(id);
  const ref = useRef<HTMLCanvasElement>(null);
  const visible = useVisible(ref);
  const sim = useMemo(() => (info && live ? new Sim(info.scene, "deco") : null), [id, live]); // eslint-disable-line
  const [still, setStill] = useState<string | null>(null);
  const px = Math.round(size * 1.4 * dprCap(2));

  useEffect(() => {
    const c = ref.current; if (!sim || !c || !getRenderer()) return;
    sim.resize(size * 1.4, size * 1.4); sim.warm(1.5);
    const v: View = { sim, kind: "deco", canvas: c, ctx: c.getContext("2d")!, visible: false, dpr: dprCap(2), born: performance.now() - 5000 };
    (c as any).__view = v;
    return addView(v);
  }, [sim, size]);
  useEffect(() => { const v: View | undefined = (ref.current as any)?.__view; if (v) { v.visible = visible; if (visible) kick(); } }, [visible, sim]);

  useEffect(() => {
    if (!info || !getRenderer()) return;
    let on = true; stillFrame(id, info.scene, "deco", px, px).then((u) => on && setStill(u));
    return () => { on = false; };
  }, [id, px]); // eslint-disable-line

  if (!info) return null;
  return <>
    {still && <img className={`motion-deco ${live ? "under" : ""}`} src={still} alt="" aria-hidden="true" />}
    {live && <canvas ref={ref} className="motion-deco" aria-hidden="true" />}
    {size >= 40 && (() => { const c = collectionById(id); return c?.art ? <span className={`motion-badge badge-${c.artKind ?? "cover"}`} aria-hidden="true" style={{ "--emblem": c.primary } as React.CSSProperties}><img src={c.art} alt="" loading="lazy" decoding="async" /></span> : null; })()}
  </>;
}
