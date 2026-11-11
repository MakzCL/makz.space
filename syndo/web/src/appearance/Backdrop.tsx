import { memo, useEffect, useRef, useState } from "react";
import type { Background } from "@syndo/shared";
import { activeBackground, assetUrl, rgba } from "./engine.ts";
import { useAppearance } from "./store.ts";

/**
 * Background layers, bottom to top (always this order):
 *   1. colour / gradient / image / video (with brightness, saturation, blur, fit, focal point, zoom)
 *   2. tint overlay (tint colour × overlay opacity)
 *   3. vignette
 *   4. "readable" overlay (accessibility) — dims busy wallpapers behind text
 * Panels are drawn above this with their own (possibly translucent) backgrounds.
 */
export function useActiveBackground(): { bg: Background | null; target: "app" | "chat" } {
  const t = useAppearance((s) => s.resolved.theme);
  const bg = activeBackground(t);
  return { bg, target: t.background?.target ?? "app" };
}

export const Backdrop = memo(function Backdrop({ bg, className = "" }: { bg: Background; className?: string }) {
  const readable = useAppearance((s) => s.global.data.a11y.readableOverlay && !s.safeMode);
  const animatedOk = useAppearance((s) => !(s.resolved.reduceMotion || s.global.data.a11y.disableAnimatedBackgrounds || s.device.a11y?.disableAnimatedBackgrounds || s.device.a11y?.lowPower || s.global.data.a11y.lowPower));
  const animatedTheme = useAppearance((s) => s.resolved.theme.effects.animatedBackground);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [bg.asset]);
  const filter = `brightness(${(bg.brightness ?? 100) / 100}) saturate(${(bg.saturation ?? 100) / 100})${bg.blur ? ` blur(${bg.blur}px)` : ""}`;
  const pos = `${bg.x ?? 50}% ${bg.y ?? 50}%`;
  const fit = bg.fit ?? "cover";
  const scale = bg.zoom && bg.zoom !== 1 ? `scale(${bg.zoom})` : undefined;
  const url = assetUrl(bg.asset);
  const poster = assetUrl(bg.poster);
  let media: React.ReactNode = null;
  const fallbackColor = bg.color ?? bg.gradient?.from ?? "var(--bg0)";
  if (bg.kind === "color") media = <div className="bd-fill" style={{ background: bg.color }} />;
  else if (bg.kind === "gradient" && bg.gradient) {
    const g = bg.gradient;
    const stops = [g.from, g.via, g.to].filter(Boolean).join(", ");
    media = <div className={`bd-fill ${animatedTheme && animatedOk ? "bd-animated" : ""}`} style={{ background: g.type === "radial" ? `radial-gradient(circle at ${pos}, ${stops})` : `linear-gradient(${g.angle}deg, ${stops})`, filter }} />;
  } else if ((bg.kind === "image" || bg.kind === "video") && url && !broken) {
    if (bg.kind === "video") media = <BgVideo src={url} poster={poster} playing={animatedOk} style={{ objectFit: fit === "tile" ? "cover" : fit === "stretch" ? "fill" : fit, objectPosition: pos, filter, transform: scale }} onError={() => setBroken(true)} />;
    else if (!animatedOk && poster) media = <div className="bd-fill" style={imgStyle(poster, fit, pos, filter, scale)} />;
    else if (!animatedOk) media = <StillImage src={url} fit={fit} pos={pos} filter={filter} scale={scale} onError={() => setBroken(true)} />;
    else media = <><div className="bd-fill" style={imgStyle(url, fit, pos, filter, scale)} /><img src={url} alt="" hidden onError={() => setBroken(true)} /></>;
  } else media = <div className="bd-fill" style={{ background: fallbackColor }} />; // missing/unsupported asset → colour fallback
  return (
    <div className={`backdrop ${className}`} aria-hidden>
      {media}
      {(bg.overlay ?? 0) > 0 && <div className="bd-fill" style={{ background: rgba(bg.tint ?? "#000000", bg.overlay ?? 0) }} />}
      {(bg.vignette ?? 0) > 0 && <div className="bd-fill" style={{ background: `radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,${(bg.vignette ?? 0) / 100}) 100%)` }} />}
      {readable && <div className="bd-fill bd-readable" />}
    </div>
  );
});

function imgStyle(url: string, fit: string, pos: string, filter: string, transform?: string): React.CSSProperties {
  return {
    backgroundImage: `url("${url}")`, backgroundPosition: pos, filter, transform,
    backgroundSize: fit === "tile" ? "auto" : fit === "stretch" ? "100% 100%" : fit, backgroundRepeat: fit === "tile" ? "repeat" : "no-repeat",
  };
}

/** Animated image shown as its first frame (reduced motion / disabled animation / hidden tab). Bounded decode size. */
function StillImage({ src, fit, pos, filter, scale, onError }: { src: string; fit: string; pos: string; filter: string; scale?: string; onError: () => void }) {
  const [still, setStill] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      const max = 2560, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { if (alive && b) setStill(URL.createObjectURL(b)); }, "image/webp", 0.9);
    };
    img.onerror = onError;
    img.src = src;
    return () => { alive = false; };
  }, [src]); // eslint-disable-line
  useEffect(() => () => { if (still) URL.revokeObjectURL(still); }, [still]);
  return still ? <div className="bd-fill" style={imgStyle(still, fit, pos, filter, scale)} /> : null;
}

/** Muted, looping video background; paused when the tab is hidden, in low power, or with reduced motion. */
function BgVideo({ src, poster, playing, style, onError }: { src: string; poster: string | null; playing: boolean; style: React.CSSProperties; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current; if (!v) return;
    const sync = () => { if (playing && document.visibilityState === "visible") v.play().catch(() => {}); else v.pause(); };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, [playing]);
  return <video ref={ref} className="bd-fill bd-video" src={src} poster={poster ?? undefined} muted loop playsInline preload="metadata" style={style} onError={onError} disablePictureInPicture />;
}
