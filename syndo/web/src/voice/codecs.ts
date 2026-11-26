/**
 * Video codec choice for calls.
 *
 * Browsers offer VP8 first, which is encoded and decoded on the processor: a 1080p screen share kept a core or more
 * busy for the person sharing and for everyone watching. H.264 is decoded (and on almost every Windows PC, Mac and
 * phone also encoded) by the graphics chip's video engine, so the same stream costs a small fraction of the CPU.
 * "auto" puts H.264 first wherever the browser has it; the other codecs stay listed after it as a fallback.
 */
type Want = "auto" | "h264" | "vp8" | "vp9" | "av1";

const MIME: Record<Exclude<Want, "auto">, string> = { h264: "video/h264", vp8: "video/vp8", vp9: "video/vp9", av1: "video/av1" };

/** The video codecs this browser can receive, best first for `want`. Null where codec choice isn't supported. */
export function orderedVideoCodecs(want: Want = "auto"): RTCRtpCodec[] | null {
  const caps = (RTCRtpReceiver as any).getCapabilities?.("video")?.codecs as RTCRtpCodec[] | undefined;
  if (!caps?.length) return null;
  const target = MIME[want === "auto" ? "h264" : want];
  const score = (c: RTCRtpCodec) => {
    const mime = c.mimeType.toLowerCase();
    if (mime !== target) return 0;
    const f = (c.sdpFmtpLine ?? "").toLowerCase();
    // For H.264: packetization-mode=1 and the constrained-baseline profile every hardware decoder takes.
    return 10 + (f.includes("packetization-mode=1") ? 4 : 0) + (f.includes("profile-level-id=42e0") ? 2 : 0) + (f.includes("profile-level-id=4200") ? 1 : 0);
  };
  if (!caps.some((c) => score(c) > 0)) return null;
  return caps.map((c, i) => ({ c, i, s: score(c) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.c);
}

/** Put the preferred codec first on a video transceiver (no-op where unsupported). */
export function preferVideoCodec(tr: RTCRtpTransceiver, want: Want = "auto") {
  const list = orderedVideoCodecs(want);
  if (!list || typeof (tr as any).setCodecPreferences !== "function") return;
  try { tr.setCodecPreferences(list); } catch { /* keep the browser's order */ }
}
