// Runs ngspice (WASM) off the UI thread.
import { runSpice } from "../../simulation/engine";
self.onmessage = async (e: MessageEvent<{ id: number; deck: string }>) => {
  try { const r = await runSpice(e.data.deck, 10 * 60 * 1000); (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, r }); }
  catch (err) { (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, error: (err as Error).message }); }
};
