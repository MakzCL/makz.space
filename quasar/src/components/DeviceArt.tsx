import { useEffect, useRef } from "react";
import { latestFrame, useFrame } from "../app/store";
import type { DeviceInfo } from "../lib/types";

/**
 * Draws a device's LED layout lit with its live colours: keycaps for
 * keyboards, glowing diffusers for everything else, on a soft body shape.
 */
export function DeviceArt({ device, padding = 14, body = true, desk = false, highlight }: { device: DeviceInfo; padding?: number; body?: boolean; desk?: boolean; highlight?: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const L = device.layout;

  const draw = (colors?: Uint8Array) => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const s = Math.min((W - padding * 2) / L.width, (H - padding * 2) / L.height);
    const ox = (W - L.width * s) / 2, oy = (H - L.height * s) / 2;

    if (body) {
      ctx.save();
      ctx.fillStyle = desk ? (device.kind === "mousepad" ? "rgba(6,6,12,0.35)" : "rgba(6,6,12,0.82)") : "rgba(255,255,255,0.035)";
      ctx.strokeStyle = desk ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      const k = device.kind;
      ctx.beginPath();
      if (k === "mouse") {
        const w = L.width * s, h = L.height * s;
        ctx.ellipse(ox + w / 2, oy + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      } else if (k === "fan") {
        const r = (L.width * s) / 2;
        ctx.arc(ox + r, oy + r, r, 0, Math.PI * 2);
        ctx.moveTo(ox + r + r * 0.35, oy + r);
        ctx.arc(ox + r, oy + r, r * 0.35, 0, Math.PI * 2);
      } else if (k === "headset") {
        const w = L.width * s, h = L.height * s;
        ctx.moveTo(ox + w * 0.1, oy + h * 0.75);
        ctx.bezierCurveTo(ox + w * 0.05, oy - h * 0.15, ox + w * 0.95, oy - h * 0.15, ox + w * 0.9, oy + h * 0.75);
        ctx.lineWidth = Math.max(2, 10 * Math.min(1, s * 2));
        ctx.strokeStyle = desk ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)";
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(ox, oy + h * 0.55, w * 0.2, h * 0.45, Math.min(14, w * 0.08));
        ctx.roundRect(ox + w * 0.8, oy + h * 0.55, w * 0.2, h * 0.45, Math.min(14, w * 0.08));
      } else {
        const pad = desk ? Math.max(1.5, (k === "keyboard" ? 4 : 2) * s) : k === "keyboard" ? 8 : 4;
        ctx.roundRect(ox - pad, oy - pad, L.width * s + pad * 2, L.height * s + pad * 2, desk ? Math.max(2, 6 * s) : k === "keyboard" ? 12 : 8);
      }
      ctx.fill("evenodd");
      ctx.lineWidth = 1;
      ctx.strokeStyle = desk ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)";
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalCompositeOperation = "lighter";
    L.leds.forEach((l, i) => {
      const r = colors ? colors[i * 3] : 40, g = colors ? colors[i * 3 + 1] : 40, b = colors ? colors[i * 3 + 2] : 60;
      const x = ox + l.x * s, y = oy + l.y * s;
      const isKey = l.w && l.h && device.kind === "keyboard";
      if (isKey) {
        const w = l.w! * s, h = l.h! * s;
        ctx.fillStyle = `rgba(${r},${g},${b},0.22)`;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.max(2, 3 * s * 0.2));
        ctx.fill();
        ctx.fillStyle = `rgba(${r},${g},${b},0.9)`;
        ctx.fillRect(x - w / 2 + 2, y + h / 2 - 2.2, w - 4, 1.6);
        ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
        ctx.beginPath();
        ctx.arc(x, y, Math.min(w, h) * 0.12, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const rad = Math.max(2.2, (l.w ? Math.min(l.w, l.h ?? l.w) * s * 0.5 : 4 * Math.max(s, 0.6)));
        const gr = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.6);
        gr.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
        gr.addColorStop(0.35, `rgba(${r},${g},${b},0.45)`);
        gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, rad * 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      if (highlight && l.label === highlight) {
        ctx.save();
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "#2ee6ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });
    ctx.globalCompositeOperation = "source-over";
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
