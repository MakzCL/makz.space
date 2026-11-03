import { Keyboard, ScanLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { scanFeedback, useWedgeScanner } from "../lib/scan";
import { Btn, Sheet } from "./ui";

/* Camera scanning (phones/tablets) with a typed-code fallback. Handheld scanners work without
 * opening this: useWedgeScanner catches their keystrokes wherever scanning is offered. */

type Detector = { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type Stop = () => void;

async function startCamera(video: HTMLVideoElement, onCode: (c: string) => void): Promise<Stop> {
  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  if (BD) {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = stream; await video.play();
    const det = new BD({ formats: ["code_128", "ean_13", "ean_8", "upc_a", "upc_e", "code_39", "qr_code", "data_matrix", "itf"] });
    let live = true;
    const tick = async () => {
      if (!live) return;
      try { const r = await det.detect(video); if (r[0]?.rawValue) onCode(r[0].rawValue); } catch { /* frame not ready */ }
      setTimeout(tick, 120);
    };
    tick();
    return () => { live = false; stream.getTracks().forEach((x) => x.stop()); video.srcObject = null; };
  }
  // iPhone / Firefox: ZXing in the browser (loaded only when the camera opens)
  const zx = await import("@zxing/library");
  const hints = new Map<import("@zxing/library").DecodeHintType, unknown>([[zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.EAN_13, zx.BarcodeFormat.EAN_8, zx.BarcodeFormat.UPC_A,
    zx.BarcodeFormat.UPC_E, zx.BarcodeFormat.CODE_39, zx.BarcodeFormat.QR_CODE, zx.BarcodeFormat.DATA_MATRIX, zx.BarcodeFormat.ITF]], [zx.DecodeHintType.TRY_HARDER, true]]);
  const reader = new zx.BrowserMultiFormatReader(hints, 150);
  await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (res) => { if (res) onCode(res.getText()); });
  return () => reader.reset();
}

/** Sheet with the live camera. `onCode` returns true if the code was used (green) or false (red). */
export function ScanSheet({ open, onClose, onCode, title, hint, continuous = true }: {
  open: boolean; onClose: () => void; onCode: (code: string) => boolean | void; title?: string; hint?: string; continuous?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState("");
  const [last, setLast] = useState<{ code: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState("");
  const recent = useRef(new Map<string, number>());
  const cb = useRef(onCode); cb.current = onCode;
  const handle = (code: string) => {
    const now = Date.now();
    if ((recent.current.get(code) ?? 0) > now - 1500) return; // same label still in view
    recent.current.set(code, now);
    const ok = cb.current(code) !== false;
    scanFeedback(ok); setLast({ code, ok });
    if (ok && !continuous) onClose();
  };
  useEffect(() => {
    if (!open || !video.current) return;
    let stop: Stop | null = null, dead = false;
    setErr(""); setLast(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr(t("This browser can't use the camera — type the code instead.")); return; }
    startCamera(video.current, handle).then((s) => { if (dead) s(); else stop = s; })
      .catch((e) => setErr(e?.name === "NotAllowedError" ? t("Camera access was refused — allow it in the browser settings, or type the code.") : t("No camera found — type the code instead.")));
    return () => { dead = true; stop?.(); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Sheet open={open} onClose={onClose} title={<span className="row gap-s"><ScanLine size={18} />{title ?? t("Scan")}</span>}>
      <div className="stack">
        <div className="scan-view">
          <video ref={video} playsInline muted />
          <div className="scan-aim"><i /></div>
          {last && <div className={`scan-last ${last.ok ? "ok" : "bad"}`}>{last.code}</div>}
        </div>
        {hint && <small className="muted">{hint}</small>}
        {err && <p className="hint red-t">{err}</p>}
        <form className="row gap" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { handle(typed.trim()); setTyped(""); } }}>
          <input className="grow" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("…or type the code")} aria-label={t("Code")} />
          <Btn type="submit" tone="soft" icon={<Keyboard size={16} />}>{t("Use")}</Btn>
        </form>
      </div>
    </Sheet>
  );
}

/** A Scan button that opens the camera; while mounted it also listens to handheld scanners. */
export function ScanButton({ onCode, title, hint, small, continuous, wedge = true, label }: {
  onCode: (code: string) => boolean | void; title?: string; hint?: string; small?: boolean; continuous?: boolean; wedge?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  useWedgeScanner((c) => { const ok = onCode(c) !== false; scanFeedback(ok); }, wedge && !open);
  return (
    <>
      <Btn small={small} tone="soft" icon={<ScanLine size={16} />} onClick={() => setOpen(true)}>{label ?? t("Scan")}</Btn>
      <ScanSheet open={open} onClose={() => setOpen(false)} onCode={onCode} title={title} hint={hint} continuous={continuous} />
    </>
  );
}
