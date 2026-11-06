import { Camera, FileText, Image as ImageIcon, RefreshCw, Sticker as StickerIcon, Video, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLayer } from "../layers.ts";

/**
 * SEND's own attach sheet (Discord-style): a camera tile and big actions for photos & videos,
 * files and stickers. Selected items appear as thumbnails above the message box.
 * Browsers can't list the device gallery directly, so "Photos & videos" opens the system
 * photo picker (images and videos only); "Camera" is SEND's own in-app camera.
 */
export function AttachSheet({ onFiles, onClose, onStickers, onCamera, anchor }: { onFiles: (files: File[]) => void; onClose: () => void; onStickers?: () => void; onCamera: () => void; anchor?: HTMLElement | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(ref, onClose, { anchor: () => anchor });
  const setCamera = (_: true) => { onClose(); onCamera(); };
  const pick = (accept: string) => {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = true; i.accept = accept;
    i.onchange = () => { const files = [...(i.files ?? [])]; if (files.length) { onFiles(files); onClose(); } };
    i.click();
  };
  return createPortal(<div className="attach-back" data-layer>
    <div ref={ref} className="attach-sheet" role="dialog" aria-label="Add to your message">
      <span className="attach-grab" aria-hidden />
      <div className="attach-grid">
        <button className="attach-tile camera" onClick={() => setCamera(true)} aria-label="Take a photo or video"><Camera size={34} /><span>Camera</span></button>
        <button className="attach-tile" onClick={() => pick("image/*,video/*")} aria-label="Photos and videos"><ImageIcon size={30} /><span>Photos & videos</span></button>
        <button className="attach-tile" onClick={() => pick("*/*")} aria-label="Files"><FileText size={30} /><span>Files</span></button>
      </div>
      <div className="attach-actions">
        <button onClick={() => pick("image/*,video/*")}><ImageIcon size={26} /><span>Photos</span></button>
        <button onClick={() => setCamera(true)}><Camera size={26} /><span>Camera</span></button>
        <button onClick={() => pick("*/*")}><FileText size={26} /><span>Files</span></button>
        {onStickers && <button onClick={() => { onClose(); onStickers(); }}><StickerIcon size={26} /><span>Stickers</span></button>}
      </div>
    </div>
  </div>, document.body);
}

/** In-app camera: live preview, photo, video recording, front/back switch. */
export function CameraCapture({ onCapture, onClose }: { onCapture: (f: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<{ r: MediaRecorder; chunks: Blob[]; started: number } | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [mode, setMode] = useState<"photo" | "video">("photo");
  const [recording, setRecording] = useState(0);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        stream.current?.getTracks().forEach((t) => t.stop());
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: mode === "video" });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        setError("");
      } catch (e) { setError((e as Error)?.name === "NotAllowedError" ? "Allow camera access to take photos in SEND." : "The camera couldn't be started."); }
    })();
    return () => { alive = false; };
  }, [facing, mode]);
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { if (!recording) return; const t = setInterval(() => setRecording((x) => (x ? x + 1 : 0)), 1000); return () => clearInterval(t); }, [recording > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { rec.current?.r.state === "recording" && rec.current.r.stop(); stream.current?.getTracks().forEach((t) => t.stop()); onClose(); };
  const shoot = () => {
    const v = video.current; if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext("2d")!;
    if (facing === "user") { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0);
    setFlash(true); setTimeout(() => setFlash(false), 180);
    c.toBlob((b) => { if (!b) return; stream.current?.getTracks().forEach((t) => t.stop()); onCapture(new File([b], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })); }, "image/jpeg", 0.92);
  };
  const toggleRecord = () => {
    if (rec.current) { rec.current.r.stop(); return; }
    if (!stream.current) return;
    const type = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
    const r = new MediaRecorder(stream.current, type ? { mimeType: type, videoBitsPerSecond: 4_000_000 } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const mime = r.mimeType || "video/webm", ext = mime.includes("mp4") ? "mp4" : "webm";
      rec.current = null; setRecording(0);
      stream.current?.getTracks().forEach((t) => t.stop());
      onCapture(new File([new Blob(chunks, { type: mime })], `video-${Date.now()}.${ext}`, { type: mime.split(";")[0] }));
    };
    r.start(500); rec.current = { r, chunks, started: Date.now() }; setRecording(1);
  };
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return createPortal(<div className="camera-view" role="dialog" aria-label="Camera" data-layer>
    <video ref={video} className={facing === "user" ? "mirror" : ""} playsInline muted autoPlay />
    {flash && <div className="camera-flash" aria-hidden />}
    {error && <p className="camera-error" role="alert">{error}</p>}
    <div className="camera-top">
      <button className="camera-btn" onClick={close} aria-label="Close camera"><X size={24} /></button>
      {recording > 0 && <span className="camera-rec" role="status">● {mmss(recording - 1)}</span>}
      <button className="camera-btn" onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))} aria-label="Switch camera" disabled={recording > 0}><RefreshCw size={22} /></button>
    </div>
    <div className="camera-bottom">
      <div className="camera-modes" role="tablist">
        <button role="tab" aria-selected={mode === "photo"} disabled={recording > 0} onClick={() => setMode("photo")}><Camera size={16} /> Photo</button>
        <button role="tab" aria-selected={mode === "video"} disabled={recording > 0} onClick={() => setMode("video")}><Video size={16} /> Video</button>
      </div>
      <button className={`camera-shutter ${mode} ${recording ? "recording" : ""}`} onClick={mode === "photo" ? shoot : toggleRecord} aria-label={mode === "photo" ? "Take photo" : recording ? "Stop recording" : "Start recording"} disabled={!!error}><span /></button>
    </div>
  </div>, document.body);
}
