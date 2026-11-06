import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./ui.tsx";
import { Range } from "./Range.tsx";

/**
 * Crop-to-size editor for avatars (square, shown circular) and banners (SEND's 16:5 profile banner).
 * - Drag (mouse/touch/pen) to reposition, wheel or pinch to zoom, keyboard: arrows move (Shift = faster), +/- zoom, 0 reset.
 * - The frame shows exactly what will be saved. Nothing is uploaded until "Apply" succeeds, so the old image stays until then.
 * - Static images are cropped and resized (never upscaled past the selected area). Animated GIFs (and animated WebP where the
 *   browser can decode frames) are re-encoded frame by frame so the animation is kept. When that isn't possible the editor
 *   says so and lets the person choose — it never silently flattens an animation.
 */
export type CropKind = "avatar" | "banner";
export const CROP_SPEC = {
  avatar: { w: 512, h: 512, gifMax: 320, label: "avatar" },
  banner: { w: 1280, h: 400, gifMax: 960, label: "banner" }, // matches the 16:5 banner in profile cards (320×100)
} as const;
const LIMIT = 10 * 1024 * 1024;

type Source = { url: string; w: number; h: number; animated: boolean; kind: "gif" | "webp" | "still" };
async function inspect(file: File): Promise<Source> {
  const url = URL.createObjectURL(file);
  const img = new Image(); img.decoding = "async"; img.src = url;
  await img.decode().catch(() => { throw new Error("This file couldn't be opened as an image."); });
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer());
  let animated = false, kind: Source["kind"] = "still";
  if (file.type === "image/gif" || (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46)) {
    kind = "gif"; let frames = 0; // count image descriptors that follow a graphic control extension
    for (let i = 0; i < head.length - 3 && frames < 2; i++) if (head[i] === 0x21 && head[i + 1] === 0xf9 && head[i + 2] === 0x04) frames++;
    animated = frames > 1;
  } else if (file.type === "image/webp" || (head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50)) {
    kind = "webp"; const s = new TextDecoder("latin1").decode(head.slice(0, 64 * 1024)); animated = s.includes("ANIM");
  }
  return { url, w: img.naturalWidth, h: img.naturalHeight, animated, kind };
}

export function CropEditor({ file, kind, onCancel, onSave }: { file: File; kind: CropKind; onCancel: () => void; onSave: (out: File) => Promise<void> }) {
  const spec = CROP_SPEC[kind];
  const [src, setSrc] = useState<Source | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: kind === "avatar" ? 300 : 480, h: kind === "avatar" ? 300 : 150 });
  const [animChoice, setAnimChoice] = useState<null | "unsupported">(null);
  useEffect(() => { let u: string | null = null; inspect(file).then((s) => { u = s.url; setSrc(s); }).catch((e) => setErr(e.message)); return () => { if (u) URL.revokeObjectURL(u); }; }, [file]);
  // Fit the frame to small screens while keeping the exact aspect ratio.
  useLayoutEffect(() => {
    const fit = () => { const max = Math.min(kind === "avatar" ? 300 : 480, window.innerWidth - 80); setBox({ w: max, h: Math.round(max * (spec.h / spec.w)) }); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, [kind]); // eslint-disable-line
  const base = src ? Math.max(box.w / src.w, box.h / src.h) : 1; // "cover" scale at zoom 1
  const s = base * zoom;
  const clamp = (o: { x: number; y: number }, sc = s) => src ? { x: Math.min(0, Math.max(box.w - src.w * sc, o.x)), y: Math.min(0, Math.max(box.h - src.h * sc, o.y)) } : o;
  const reset = () => { if (!src) return; setZoom(1); setOff({ x: (box.w - src.w * base) / 2, y: (box.h - src.h * base) / 2 }); };
  useEffect(reset, [src, box.w, box.h]); // eslint-disable-line
  const zoomTo = (z: number, cx = box.w / 2, cy = box.h / 2) => {
    if (!src) return; const nz = Math.max(1, Math.min(6, z)), ns = base * nz;
    // keep the point under the cursor (or the centre) still while zooming
    setOff((o) => clamp({ x: cx - ((cx - o.x) / s) * ns, y: cy - ((cy - o.y) / s) * ns }, ns)); setZoom(nz);
  };
  const pointers = useRef(new Map<number, { x: number; y: number }>()), pinch = useRef<{ d: number; z: number } | null>(null);
  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), z: zoom }; } };
  const move = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId); if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) { const [a, b] = [...pointers.current.values()]; zoomTo(pinch.current.z * Math.hypot(a!.x - b!.x, a!.y - b!.y) / pinch.current.d); return; }
    setOff((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
  };
  const up = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null; };
  useEffect(() => { // non-passive wheel so the page doesn't scroll while zooming
    const el = stage.current; if (!el) return;
    const w = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomTo(zoom * Math.exp(-e.deltaY / 400), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener("wheel", w, { passive: false }); return () => el.removeEventListener("wheel", w);
  });
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 8;
    const k: Record<string, () => void> = {
      ArrowLeft: () => setOff((o) => clamp({ ...o, x: o.x + step })), ArrowRight: () => setOff((o) => clamp({ ...o, x: o.x - step })),
      ArrowUp: () => setOff((o) => clamp({ ...o, y: o.y + step })), ArrowDown: () => setOff((o) => clamp({ ...o, y: o.y - step })),
      "+": () => zoomTo(zoom * 1.15), "=": () => zoomTo(zoom * 1.15), "-": () => zoomTo(zoom / 1.15), "0": reset,
    };
    if (k[e.key]) { e.preventDefault(); k[e.key]!(); }
  };
  /** The selected rectangle in source pixels. */
  const rect = () => ({ sx: -off.x / s, sy: -off.y / s, sw: box.w / s, sh: box.h / s });
  const outSize = (max: number) => { const r = rect(); const w = Math.max(1, Math.round(Math.min(max, r.sw))); return { w, h: Math.max(1, Math.round(w * spec.h / spec.w)) }; };

  const apply = async (mode: "auto" | "still" | "original" = "auto") => {
    if (!src) return;
    setErr(null);
    try {
      let out: File;
      if (mode === "original") out = file;
      else if (src.animated && mode === "auto") {
        setBusy("Preparing animation…");
        const encoded = await cropAnimated(file, src, rect(), (m) => setBusy(m), (scale) => outSize(Math.round(spec.gifMax * scale)));
        if (!encoded) { setBusy(null); setAnimChoice("unsupported"); return; }
        out = encoded;
      } else {
        setBusy("Cropping…");
        out = await cropStill(src, rect(), outSize(spec.w), file.name);
      }
      if (out.size > LIMIT) throw new Error(`The result is ${(out.size / 1048576).toFixed(1)} MB; the limit is 10 MB. Try a shorter or smaller animation.`);
      setBusy("Uploading…");
      await onSave(out); // the previous image stays until this succeeds
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save the image."); }
    finally { setBusy(null); }
  };

  const o = outSize(src?.animated ? spec.gifMax : spec.w);
  const small = src && (rect().sw < (kind === "avatar" ? 128 : 600));
  const title = kind === "avatar" ? "Edit avatar" : "Edit banner";
  return (
    <Modal title={title} label={title} onClose={() => !busy && onCancel()} wide={kind === "banner"}
      footer={<>
        <button className="btn" onClick={onCancel} disabled={!!busy}>Cancel</button>
        <button className="btn primary" onClick={() => apply()} disabled={!src || !!busy}>{busy ?? "Apply"}</button>
      </>}>
      <div className={`crop crop-${kind}`}>
        {err && <p className="field-e" role="alert">{err}</p>}
        {!src && !err && <p className="muted">Opening image…</p>}
        {src && <>
          <div ref={stage} className="crop-stage" style={{ width: box.w, height: box.h }} tabIndex={0} role="group"
            aria-label={`Crop area for your ${spec.label}. Drag or use the arrow keys to move, plus and minus to zoom, 0 to reset.`}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key} onDoubleClick={reset}>
            <img src={src.url} alt="" draggable={false} style={{ width: src.w * s, height: src.h * s, transform: `translate(${off.x}px, ${off.y}px)` }} />
            <div className="crop-mask" aria-hidden />
            {kind === "banner" && <div className="crop-avatar-hint" aria-hidden title="Your avatar overlaps this corner" />}
          </div>
          <div className="crop-controls">
            <button className="icon-btn" onClick={() => zoomTo(zoom / 1.2)} aria-label="Zoom out"><Minus size={16} /></button>
            <Range min={1} max={6} step={0.01} value={zoom} onChange={(e) => zoomTo(+e.target.value)} aria-label="Zoom" />
            <button className="icon-btn" onClick={() => zoomTo(zoom * 1.2)} aria-label="Zoom in"><Plus size={16} /></button>
            <button className="btn sm" onClick={reset}><RotateCcw size={14} /> Reset</button>
          </div>
          <CropPreview kind={kind} src={src} rect={rect()} />
          <p className="muted small">
            Saves at {o.w}×{o.h}{src.animated ? (src.kind === "gif" ? " as an animated GIF (animation kept)" : " as an animated GIF (converted from WebP to keep the animation)") : ""}.
            {small ? " The selected area is smaller than the full size, so it's saved at its own resolution rather than upscaled." : ""}
          </p>
          {animChoice === "unsupported" && (
            <div className="notice" role="alert">
              <p><strong>This browser can't re-encode this animation.</strong> Cropping it would turn it into a still image. Choose what to do:</p>
              <div className="row wrap">
                <button className="btn" onClick={() => apply("original")} disabled={!!busy}>Keep the animation (upload uncropped, centred)</button>
                <button className="btn" onClick={() => apply("still")} disabled={!!busy}>Save the cropped first frame as a still</button>
              </div>
            </div>
          )}
        </>}
      </div>
    </Modal>
  );
}

function CropPreview({ kind, src, rect }: { kind: CropKind; src: Source; rect: { sx: number; sy: number; sw: number; sh: number } }) {
  // Pure CSS previews of the exact crop at real display sizes (message row, member list, popout, call tile).
  const style = (w: number, h: number) => ({ width: w, height: h, backgroundImage: `url(${src.url})`, backgroundSize: `${(src.w * w) / rect.sw}px ${(src.h * h) / rect.sh}px`, backgroundPosition: `${(-rect.sx * w) / rect.sw}px ${(-rect.sy * h) / rect.sh}px` });
  if (kind === "avatar") return (
    <div className="crop-previews" aria-label="Previews">
      {[96, 40, 24].map((n) => <span key={n} className="crop-prev-av" style={style(n, n)} title={`${n}px`} />)}
      <span className="muted small">Popout · messages · member list</span>
    </div>
  );
  return (
    <div className="crop-previews" aria-label="Preview">
      <div className="crop-prev-card"><span className="crop-prev-banner" style={style(240, 75)} /><span className="crop-prev-av" /></div>
      <span className="muted small">Profile popout (your avatar sits over the lower-left corner)</span>
    </div>
  );
}

async function cropStill(src: Source, r: { sx: number; sy: number; sw: number; sh: number }, out: { w: number; h: number }, name: string) {
  const img = new Image(); img.src = src.url; await img.decode();
  const c = document.createElement("canvas"); c.width = out.w; c.height = out.h;
  const x = c.getContext("2d")!; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, out.w, out.h);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/webp", 0.92));
  const b = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!b) throw new Error("Couldn't encode the cropped image.");
  return new File([b], name.replace(/\.[^.]+$/, "") + (b.type === "image/webp" ? ".webp" : ".png"), { type: b.type });
}

type Frame = { canvas: OffscreenCanvas | HTMLCanvasElement; delay: number };
/** Decode every frame as a full composited image. GIF via gifuct-js; animated WebP via WebCodecs ImageDecoder when available. */
async function decodeFrames(file: File, src: Source, progress: (m: string) => void): Promise<Frame[] | null> {
  const mk = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
  if (src.kind === "gif") {
    const { parseGIF, decompressFrames } = await import("gifuct-js");
    const gif = parseGIF(await file.arrayBuffer());
    const frames = decompressFrames(gif, true);
    if (frames.length > 400) throw new Error(`This GIF has ${frames.length} frames; the limit for cropping is 400.`);
    const W = gif.lsd.width, H = gif.lsd.height, comp = mk(W, H), cx = comp.getContext("2d")!, patch = mk(1, 1), px = patch.getContext("2d")!;
    const out: Frame[] = []; let restore: ImageData | null = null, prev: (typeof frames)[number] | null = null;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      if (prev?.disposalType === 2) cx.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      else if (prev?.disposalType === 3 && restore) cx.putImageData(restore, 0, 0);
      restore = f.disposalType === 3 ? cx.getImageData(0, 0, W, H) : null;
      patch.width = f.dims.width; patch.height = f.dims.height;
      px.putImageData(new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height), 0, 0);
      cx.drawImage(patch, f.dims.left, f.dims.top);
      const snap = mk(W, H); snap.getContext("2d")!.drawImage(comp, 0, 0);
      out.push({ canvas: snap, delay: Math.max(20, f.delay || 100) });
      prev = f;
      if (i % 10 === 0) { progress(`Reading frames… ${i + 1}/${frames.length}`); await new Promise((r) => setTimeout(r)); }
    }
    return out;
  }
  const ID = (window as any).ImageDecoder;
  if (!ID || !(await ID.isTypeSupported?.(file.type || "image/webp"))) return null;
  const dec = new ID({ data: file.stream(), type: file.type || "image/webp" });
  await dec.tracks.ready; const n = dec.tracks.selectedTrack.frameCount;
  if (n > 400) throw new Error(`This animation has ${n} frames; the limit for cropping is 400.`);
  const out: Frame[] = [];
  for (let i = 0; i < n; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    const c = mk(image.displayWidth, image.displayHeight); c.getContext("2d")!.drawImage(image, 0, 0);
    out.push({ canvas: c, delay: Math.max(20, Math.round((image.duration ?? 100000) / 1000)) }); image.close();
    if (i % 10 === 0) { progress(`Reading frames… ${i + 1}/${n}`); await new Promise((r) => setTimeout(r)); }
  }
  dec.close?.();
  return out;
}

async function cropAnimated(file: File, src: Source, r: { sx: number; sy: number; sw: number; sh: number }, progress: (m: string) => void, size: (scale: number) => { w: number; h: number }): Promise<File | null> {
  const frames = await decodeFrames(file, src, progress).catch((e) => { throw e; });
  if (!frames) return null;
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  // Try full size first; shrink if the result would exceed the upload limit.
  for (const scale of [1, 0.75, 0.5]) {
    const { w, h } = size(scale);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true })!; x.imageSmoothingQuality = "high";
    const enc = GIFEncoder();
    for (let i = 0; i < frames.length; i++) {
      x.clearRect(0, 0, w, h); x.drawImage(frames[i]!.canvas as CanvasImageSource, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
      const { data } = x.getImageData(0, 0, w, h);
      const palette = quantize(data, 256, { format: "rgba4444", oneBitAlpha: true });
      const index = applyPalette(data, palette, "rgba4444");
      const t = palette.findIndex((p: number[]) => p[3] === 0);
      enc.writeFrame(index, w, h, { palette, delay: frames[i]!.delay, transparent: t >= 0, transparentIndex: Math.max(0, t), dispose: t >= 0 ? 2 : -1 });
      if (i % 5 === 0) { progress(`Encoding frames… ${i + 1}/${frames.length}`); await new Promise((res) => setTimeout(res)); }
    }
    enc.finish();
    const bytes = enc.bytes();
    if (bytes.length <= LIMIT) return new File([new Uint8Array(bytes)], file.name.replace(/\.[^.]+$/, "") + ".gif", { type: "image/gif" });
  }
  throw new Error("Even at a smaller size the animation is over 10 MB. Try a shorter clip.");
}

/** Resolve after the user picks a file for `kind`, crops it, and `upload` succeeds. */
export function useCropUpload(upload: (kind: CropKind, file: File) => Promise<void>) {
  const [pending, setPending] = useState<{ kind: CropKind; file: File } | null>(null);
  const editor = useMemo(() => pending && <CropEditor key={pending.file.name + pending.file.size} file={pending.file} kind={pending.kind} onCancel={() => setPending(null)} onSave={async (f) => { await upload(pending.kind, f); setPending(null); }} />, [pending]); // eslint-disable-line
  return { open: (kind: CropKind, file: File) => setPending({ kind, file }), editor };
}
