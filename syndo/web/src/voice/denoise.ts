import type { VoiceSettings } from "./settings.ts";

/**
 * Built-in AI noise suppression (RNNoise, open source, runs on this device). The microphone goes through an
 * AudioWorklet before it is sent; the browser's own suppression is switched off meanwhile so the two don't stack.
 * The code and model only load the first time it is used. A Krisp SDK, once licensed, can slot in here the same way.
 */
export type Suppression = "deepfilter" | "rnnoise" | "standard" | "off";
export const SUPPRESSION_LABEL: Record<Suppression, string> = { deepfilter: "Advanced", rnnoise: "AI", standard: "Standard", off: "None" };

/* DeepFilterNet3 ("Advanced", the slot Discord gives Krisp): a stronger model than RNNoise, compiled to
   WebAssembly from deep-filter-rt (web/df3-wasm) and served by SEND itself (/df3/). About 11 MB, fetched the
   first time it's used and cached by the browser. */
let df3Module: Promise<ArrayBuffer> | null = null;
function loadDf3() {
  df3Module ??= (async () => {
    const res = await fetch("/df3/send-df3.wasm");
    if (!res.ok) throw new Error(`DeepFilterNet download failed (${res.status})`);
    return res.arrayBuffer();
  })();
  df3Module.catch(() => { df3Module = null; });
  return df3Module;
}
/** Start downloading the Advanced model in the background (e.g. when someone picks it in settings). */
export const preloadDeepFilter = () => { loadDf3().catch(() => {}); };

async function deepFilterNode(ctx: AudioContext, channels: number): Promise<AudioWorkletNode> {
  const [bytes] = await Promise.all([loadDf3(), ctx.audioWorklet.addModule("/df3/df3-worklet.js")]);
  const node = new AudioWorkletNode(ctx, "send-df3", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [channels] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("DeepFilterNet took too long to start")), 15000);
    node.port.onmessage = (e) => { if (e.data?.type === "ready") { clearTimeout(t); resolve(); } else if (e.data?.type === "error") { clearTimeout(t); reject(new Error(e.data.message)); } };
    node.port.postMessage({ type: "init", bytes: bytes.slice(0), attenLim: 100 }); // a copy: the download stays cached for the next call
  });
  return node;
}

let assets: Promise<{ worklet: string; wasm: ArrayBuffer; Node: typeof import("@sapphi-red/web-noise-suppressor").RnnoiseWorkletNode }> | null = null;
function load() {
  assets ??= (async () => {
    const [lib, worklet, url, simdUrl] = await Promise.all([
      import("@sapphi-red/web-noise-suppressor"),
      import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url").then((m) => m.default as string),
      import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url").then((m) => m.default as string),
      import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url").then((m) => m.default as string),
    ]);
    return { worklet, wasm: await lib.loadRnnoise({ url, simdUrl }), Node: lib.RnnoiseWorkletNode };
  })();
  assets.catch(() => { assets = null; });
  return assets;
}

/** Whether this browser can run it (AudioWorklet + WebAssembly). */
export const denoiseSupported = () => typeof AudioWorkletNode !== "undefined" && typeof WebAssembly !== "undefined";

/**
 * Returns the microphone track to send. With AI suppression on, that's a cleaned copy; stopping it also stops the
 * real microphone and frees the audio engine. Any failure falls back to the raw microphone so a call never goes silent.
 */
export async function denoiseTrack(raw: MediaStreamTrack, s: Pick<VoiceSettings, "suppression" | "stereo">): Promise<MediaStreamTrack> {
  if ((s.suppression !== "rnnoise" && s.suppression !== "deepfilter") || !denoiseSupported()) return raw;
  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" });
    if (ctx.sampleRate !== 48000) throw new Error("RNNoise needs 48 kHz");
    if (ctx.state !== "running") await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]).catch(() => {});
    if (ctx.state !== "running") throw new Error("audio engine suspended"); // a suspended engine would send silence
    let node: AudioWorkletNode & { destroy?: () => void };
    if (s.suppression === "deepfilter") {
      try { node = await deepFilterNode(ctx, s.stereo ? 2 : 1); }
      catch (e) { console.warn("DeepFilterNet unavailable, using RNNoise:", e); const a = await load(); await ctx.audioWorklet.addModule(a.worklet); node = new a.Node(ctx, { maxChannels: s.stereo ? 2 : 1, wasmBinary: a.wasm }); }
    } else { const a = await load(); await ctx.audioWorklet.addModule(a.worklet); node = new a.Node(ctx, { maxChannels: s.stereo ? 2 : 1, wasmBinary: a.wasm }); }
    const src = ctx.createMediaStreamSource(new MediaStream([raw]));
    const dest = ctx.createMediaStreamDestination(); dest.channelCount = s.stereo ? 2 : 1;
    src.connect(node).connect(dest);
    const out = dest.stream.getAudioTracks()[0]!;
    const c = ctx, stopOut = out.stop.bind(out);
    let done = false;
    out.stop = () => { stopOut(); if (done) return; done = true; raw.stop(); try { node.destroy ? node.destroy() : node.disconnect(); } catch { /* */ } src.disconnect(); c.close().catch(() => {}); };
    raw.addEventListener("ended", () => out.dispatchEvent(new Event("ended")));
    return out;
  } catch (e) {
    console.warn("Noise suppression unavailable, sending the microphone as is:", e);
    ctx?.close().catch(() => {});
    return raw;
  }
}
