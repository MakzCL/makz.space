import { useEffect, useRef } from "react";
import { useFrame } from "../app/store";

/** The live lighting canvas, upscaled smoothly. */
export function Preview({ className = "preview", onPress }: { className?: string; onPress?: (u: number, v: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<ImageData | null>(null);
  useFrame((f) => {
    const c = ref.current;
    if (!c) return;
    if (c.width !== f.w || c.height !== f.h) {
      c.width = f.w;
      c.height = f.h;
      img.current = null;
    }
    const ctx = c.getContext("2d")!;
    const im = (img.current ??= ctx.createImageData(f.w, f.h));
    const d = im.data;
    for (let i = 0, j = 0; i < f.canvas.length; i += 3, j += 4) {
      d[j] = f.canvas[i];
      d[j + 1] = f.canvas[i + 1];
      d[j + 2] = f.canvas[i + 2];
      d[j + 3] = 255;
    }
    ctx.putImageData(im, 0, 0);
  });
  useEffect(() => {
    if (ref.current) ref.current.style.imageRendering = "auto";
  }, []);
  return (
    <canvas
      ref={ref}
      className={className}
      onPointerDown={
        onPress &&
        ((e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPress((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        })
      }
    />
  );
}

/** A heavily blurred copy of the canvas behind the whole app. */
export function Ambient() {
  return <Preview className="ambient" />;
}
