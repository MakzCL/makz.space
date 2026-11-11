import { useEffect, useRef, type ReactNode } from "react";
import { validateProfileTheme, type EffectLayer, type ProfileTheme, type User } from "@send/shared";
import { useStore } from "../store.ts";
import { useAppearance } from "./store.ts";

/**
 * Profile cosmetics. Everything is CSS or a small bounded canvas — no
 * uploaded code, no HTML. Message-list avatars use CSS-only rings
 * (GPU-composited, no React re-renders); particles only run on profile
 * cards, pause when off-screen or the tab is hidden, and stop entirely with
 * reduced motion, low power, or "disable profile effects".
 */
const cache = new WeakMap<object, ProfileTheme | null>();
export function normalizeTheme(t: unknown): ProfileTheme | null {
  if (!t || typeof t !== "object") return null;
  if (cache.has(t)) return cache.get(t)!;
  const v = validateProfileTheme(t).value;
  cache.set(t, v);
  return v;
}

/** The cosmetics to show for a user (server profile wins inside a server), after the viewer's own preferences. */
export function useCosmetics(user: User | null | undefined, serverTheme?: unknown): { theme: ProfileTheme | null; animate: boolean } {
  const meId = useStore((s) => s.me?.id);
  const a = useAppearance((s) => s.global.data.a11y);
  const reduce = useAppearance((s) => s.resolved.reduceMotion);
  const lowPower = useAppearance((s) => !!s.device.a11y?.lowPower || s.global.data.a11y.lowPower);
  const raw = serverTheme ?? user?.profile_theme;
  if (!user || !raw) return { theme: null, animate: false };
  if (a.disableOthersCosmetics && user.id !== meId) return { theme: null, animate: false };
  return { theme: normalizeTheme(raw), animate: !(reduce || lowPower || a.disableProfileEffects) };
}

export function decorClasses(t: ProfileTheme | null, animate: boolean) {
  if (!t) return "";
  return [t.ring.style !== "none" && `ring ring-${t.ring.style}`, t.decoration !== "none" && `deco deco-${t.decoration}`, `shape-${t.statusShape}`, !animate && "still"].filter(Boolean).join(" ");
}
export const decorVars = (t: ProfileTheme | null) => (t ? ({ "--ring": t.ring.color, "--ring-speed": `${3 / t.ring.speed}s`, "--pc1": t.primary, "--pc2": t.secondary } as React.CSSProperties) : undefined);

export function StyledName({ theme, animate, children }: { theme: ProfileTheme | null; animate: boolean; children: ReactNode }) {
  if (!theme || theme.nameStyle === "plain") return <>{children}</>;
  return (
    <span className={`name-${theme.nameStyle} ${theme.nameplate !== "none" ? `plate plate-${theme.nameplate}` : ""} ${animate ? "" : "still"}`}
      style={{ "--pc1": theme.primary, "--pc2": theme.nameColor2 ?? theme.secondary, "--name-glow": `${theme.nameGlow / 10}px` } as React.CSSProperties}>
      {children}
    </span>
  );
}

/** Canvas particle layers for profile cards. Bounded: ≤ 120 particles total, ≤ 30 fps, paused off-screen. */
export function EffectsLayer({ layers, animate, hovered }: { layers: EffectLayer[]; animate: boolean; hovered: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const active = layers.filter((l) => l.enabled && ["particles", "sparkle", "confetti", "snow"].includes(l.kind));
  useEffect(() => {
    const c = ref.current;
    if (!c || !animate || !active.length) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let raf = 0, visible = false, start = performance.now(), last = 0;
    const schedule = () => { if (!raf && visible && document.visibilityState === "visible") raf = requestAnimationFrame(frame); };
    const io = new IntersectionObserver(([e]) => { visible = !!e?.isIntersecting; if (!visible) { cancelAnimationFrame(raf); raf = 0; } else schedule(); });
    io.observe(c);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(c);
    type Pt = { x: number; y: number; vx: number; vy: number; r: number; life: number; layer: EffectLayer; hue: number };
    const pts: Pt[] = [];
    const spawn = (l: EffectLayer): Pt => {
      const w = c.width, h = c.height, s = l.speed * dpr;
      const base = { layer: l, life: 1, hue: Math.random() * 360, r: (1 + Math.random() * 2.5) * dpr * (0.5 + l.intensity / 100) };
      if (l.kind === "snow") return { ...base, x: Math.random() * w, y: -5, vx: (Math.random() - 0.5) * 0.3 * s, vy: (0.3 + Math.random() * 0.6) * s };
      if (l.kind === "confetti") return { ...base, x: Math.random() * w, y: -5, vx: (Math.random() - 0.5) * 1.2 * s, vy: (0.8 + Math.random()) * s };
      return { ...base, x: Math.random() * w, y: h + 5, vx: (Math.random() - 0.5) * 0.4 * s, vy: -(0.3 + Math.random() * 0.7) * s };
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.visibilityState !== "visible") return;
      schedule();
      if (now - last < 1000 / 30) return;
      const dt = Math.min(3, (now - (last || now - 33)) / 16.667); last = now;
      ctx.clearRect(0, 0, c.width, c.height);
      for (const l of active) {
        if (l.trigger === "hover" && !hovered) continue;
        if (!l.loop && (now - start) / 1000 > l.duration) continue;
        const want = Math.round(Math.min(120, 4 + l.density * 0.8));
        let n = 0;
        for (const p of pts) if (p.layer === l) n++;
        if (pts.length < 120 && n < want && Math.random() < 0.3 * dt) pts.push(spawn(l));
      }
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]!;
        p.x += p.vx * dt; p.y += p.vy * dt; p.life -= 0.004 * p.layer.speed * dt;
        if (p.life <= 0 || p.y < -10 || p.y > c.height + 10) { pts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life) * (0.4 + p.layer.intensity / 170);
        ctx.fillStyle = p.layer.kind === "confetti" ? `hsl(${p.hue} 90% 60%)` : p.layer.color;
        if (p.layer.kind === "sparkle") { const k = p.r * (1 + Math.sin(now / 200 + p.hue)); ctx.fillRect(p.x - k / 2, p.y - 0.5, k, 1); ctx.fillRect(p.x - 0.5, p.y - k / 2, 1, k); }
        else if (p.layer.kind === "confetti") ctx.fillRect(p.x, p.y, p.r * 1.6, p.r);
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
      }
    };
    const visibility = () => { if (document.visibilityState !== "visible") { cancelAnimationFrame(raf); raf = 0; } else { last = 0; schedule(); } };
    document.addEventListener("visibilitychange", visibility);
    if (hovered) start = performance.now();
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); document.removeEventListener("visibilitychange", visibility); };
  }, [animate, JSON.stringify(active), hovered]); // eslint-disable-line
  const css = layers.filter((l) => l.enabled && (l.kind === "glow" || l.kind === "aurora"));
  return (
    <>
      {css.map((l, i) => (
        <div key={i} className={`fx-layer fx-${l.kind} ${animate ? "" : "still"} ${l.trigger === "hover" ? "fx-hover" : ""}`} aria-hidden
          style={{ "--fx-color": l.color, "--fx-intensity": String(l.intensity / 100), "--fx-speed": `${8 / l.speed}s`, "--fx-iter": l.loop ? "infinite" : String(Math.max(1, Math.round(l.duration / (8 / l.speed)))) } as React.CSSProperties} />
      ))}
      {active.length > 0 && animate && <canvas ref={ref} className="fx-canvas" aria-hidden />}
    </>
  );
}
