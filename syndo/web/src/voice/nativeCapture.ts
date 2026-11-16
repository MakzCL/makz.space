/**
 * Screen sharing through the SEND desktop app's own capture (desktop 0.7+, Windows), so sharing uses SEND's
 * picker instead of the system one. The app sends JPEG frames and 48 kHz stereo sound; they're turned into
 * normal video/audio tracks here (WebCodecs + MediaStreamTrackGenerator, both in WebView2), so the rest of the
 * call code treats them like any other screen share.
 */
import type { NativeCaptureApi, NativeSource } from "../desktop.ts";
import type { StreamSettings } from "./settings.ts";

export const nativeCapture = (): NativeCaptureApi | null => {
  const d = (window as any).sendDesktop;
  return d?.capture && typeof (window as any).MediaStreamTrackGenerator === "function" && typeof (window as any).VideoFrame === "function" ? d.capture : null;
};
export type { NativeSource };

export async function nativeShareStream(api: NativeCaptureApi, sourceId: string, st: StreamSettings): Promise<MediaStream> {
  const Gen = (window as any).MediaStreamTrackGenerator;
  const vGen = new Gen({ kind: "video" }) as MediaStreamTrack & { writable: WritableStream };
  const aGen = st.audio ? new Gen({ kind: "audio" }) as MediaStreamTrack & { writable: WritableStream } : null;
  const vw = vGen.writable.getWriter(), aw = aGen?.writable.getWriter();
  let ended = false, t0 = 0, audioTs = 0, session: { id: number; ack(): void; stop(): void } | null = null;
  const end = (byStop = false) => {
    if (ended) return; ended = true;
    session?.stop();
    vw.close().catch(() => {}); aw?.close().catch(() => {});
    for (const t of [vGen, aGen]) if (t && t.readyState !== "ended") { try { MediaStreamTrack.prototype.stop.call(t); } catch { /* */ } if (!byStop) t.dispatchEvent(new Event("ended")); }
  };
  // Stopping either track (leaving the call, "Stop sharing") stops the capture in the app.
  for (const t of [vGen, aGen]) if (t) { const own = t.stop.bind(t); t.stop = () => { own(); end(true); }; }
  let busy = false;
  const onVideo = async (buf: ArrayBuffer) => {
    if (ended) return;
    if (!buf || buf.byteLength === 0) { end(); return; } // the shared window closed
    if (busy) { session?.ack(); return; } // still drawing the previous frame: skip this one
    busy = true;
    try {
      const bmp = await createImageBitmap(new Blob([buf], { type: "image/jpeg" }));
      if (!t0) t0 = performance.now();
      const frame = new (window as any).VideoFrame(bmp, { timestamp: Math.round((performance.now() - t0) * 1000) });
      bmp.close();
      await vw.write(frame);
    } catch { /* a bad frame: skip it */ }
    finally { busy = false; session?.ack(); }
  };
  const onAudio = (buf: ArrayBuffer) => {
    if (ended || !aw || !buf?.byteLength) return;
    const data = new Float32Array(buf), frames = data.length / 2;
    try {
      const ad = new (window as any).AudioData({ format: "f32", sampleRate: 48000, numberOfFrames: frames, numberOfChannels: 2, timestamp: audioTs, data });
      audioTs += Math.round((frames / 48000) * 1e6);
      aw.write(ad).catch(() => {});
    } catch { /* skip */ }
  };
  const maxHeight = st.height === "source" ? 2160 : st.height;
  session = await api.start(sourceId, { fps: st.fps, maxHeight, quality: st.contentHint === "detail" ? 90 : 82, audio: st.audio }, onVideo, onAudio);
  vGen.contentHint = st.contentHint;
  return new MediaStream(aGen ? [vGen, aGen] : [vGen]);
}
