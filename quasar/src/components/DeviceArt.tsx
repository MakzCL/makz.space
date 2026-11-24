import { useEffect, useRef } from "react";
import { latestFrame, useFrame } from "../app/store";
import type { DeviceInfo } from "../lib/types";
import { overhang, paintDevice } from "./art";

/**
 * A device drawn in detail (see art.ts) and lit with its live colours.
 * The art is fitted to the canvas with `padding` px around it; with
 * padding 0 the layout box plus its overhang fills the canvas exactly,
 * which is what the Studio desk relies on to keep LEDs aligned.
 */
export function DeviceArt({ device, padding = 14, highlight }: { device: DeviceInfo; padding?: number; highlight?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const L = device.layout;
  const ov = overhang(device.kind);

  const draw = (colors?: Uint8Array) => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const bw = L.width + ov * 2, bh = L.height + ov * 2;
    const s = Math.min((W - padding * 2) / bw, (H - padding * 2) / bh);
    const ox = (W - bw * s) / 2 + ov * s, oy = (H - bh * s) / 2 + ov * s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    paintDevice(ctx, device, { s: s * dpr, colors, legends: s * dpr > 2.2, t: performance.now() / 1000, highlight });
  };

  useFrame((f) => draw(f.devices.get(device.id)));
  useEffect(() => {
    draw(latestFrame()?.devices.get(device.id));
    const ro = new ResizeObserver(() => draw(latestFrame()?.devices.get(device.id)));
    ro.observe(ref.current!);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device.id, highlight]);
  return <canvas ref={ref} />;
}
