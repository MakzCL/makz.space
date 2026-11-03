import { useEffect, useRef } from "react";
import { symbolBox } from "../../core/geom";
import { connectivity } from "../../connectivity/connectivity";
import { newProject } from "../../core/project";
import { drawPart, LIGHT, DARK } from "../schematic/render";
const EMPTY = connectivity(newProject("preview"));
export function SymbolPreview({ device, dark, size = 180 }: { device: string; dark: boolean; size?: number }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = c.current!; const dpr = devicePixelRatio || 1; cv.width = size * dpr; cv.height = size * dpr;
    const ctx = cv.getContext("2d")!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = dark ? DARK.paper : LIGHT.paper; ctx.fillRect(0, 0, size, size);
    const b = symbolBox(device); const w = b.x1 - b.x0 + 300, h = b.y1 - b.y0 + 360; const s = Math.min(size / w, size / h);
    drawPart(ctx, { id: "pv", ref: "", device, sheet: "S1", at: [0, 0], rot: 0, mirror: false, props: {} }, { s, x: size / 2 - ((b.x0 + b.x1) / 2) * s, y: size / 2 - ((b.y0 + b.y1) / 2) * s }, { theme: dark ? DARK : LIGHT, sel: new Set(), hover: null, netHighlight: null, con: EMPTY }, false);
  }, [device, dark, size]);
  return <canvas ref={c} style={{ width: size, height: size }} className="n-preview" />;
}
