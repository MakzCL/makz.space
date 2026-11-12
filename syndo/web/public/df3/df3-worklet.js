// SEND: DeepFilterNet3 noise suppression in an AudioWorklet. The WebAssembly bytes (deep-filter-rt, model
// embedded, no imports) arrive from the page; audio comes in 128-sample blocks and DeepFilterNet works in
// 480-sample (10 ms) frames, so input is gathered into frames and the cleaned output is played back one frame
// later. Until the model is ready (or if it fails), the microphone passes through unchanged.
class SendDf3 extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ready = false; this.bypass = false;
    this.inBuf = new Float32Array(480); this.inLen = 0;
    this.outQ = new Float32Array(480 * 4); this.outRead = 0; this.outWrite = 480; // one frame of latency
    this.port.onmessage = async (e) => {
      const m = e.data || {};
      if (m.type === "init") {
        try {
          // The page sends the .wasm bytes (a compiled Module can't cross into the audio thread everywhere).
          const res = await WebAssembly.instantiate(m.bytes || m.module, {});
          const inst = res.instance || res;
          this.x = inst.exports;
          const n = this.x.df_init(m.attenLim ?? 100);
          if (n !== 480) throw new Error("unexpected frame size " + n);
          this.ready = true; this.port.postMessage({ type: "ready" });
        } catch (err) { this.port.postMessage({ type: "error", message: String(err && err.message || err) }); }
      } else if (m.type === "attenLim" && this.ready) this.x.df_set_atten_lim(m.value);
      else if (m.type === "bypass") this.bypass = !!m.value;
    };
  }
  frame() {
    const x = this.x, mem = new Float32Array(x.memory.buffer);
    const ip = x.df_input() >> 2, op = x.df_output() >> 2;
    mem.set(this.inBuf, ip);
    x.df_process();
    const out = new Float32Array(x.memory.buffer, op << 2, 480);
    const q = this.outQ, len = q.length;
    for (let i = 0; i < 480; i++) q[(this.outWrite + i) % len] = out[i];
    this.outWrite = (this.outWrite + 480) % len;
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    if (!output || !output[0]) return true;
    const src = input && input[0];
    if (!src) { for (const ch of output) ch.fill(0); return true; }
    // Mix to mono (DeepFilterNet runs on one channel); the same cleaned signal goes to every output channel.
    let mono = src;
    if (input.length > 1) { mono = new Float32Array(src.length); for (const ch of input) for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / input.length; }
    if (!this.ready || this.bypass) { for (const ch of output) ch.set(mono); return true; }
    const n = mono.length, q = this.outQ, len = q.length;
    for (let i = 0; i < n; i++) {
      this.inBuf[this.inLen++] = mono[i];
      if (this.inLen === 480) { this.frame(); this.inLen = 0; }
    }
    const o = output[0];
    for (let i = 0; i < n; i++) { o[i] = q[this.outRead]; this.outRead = (this.outRead + 1) % len; }
    for (let c = 1; c < output.length; c++) output[c].set(o);
    return true;
  }
}
registerProcessor("send-df3", SendDf3);
