import { dispatch, useStore } from "./store.ts";
import { previewMode } from "./preview-mode.ts";

/**
 * Gateway connection with heartbeat and exponential-backoff reconnect.
 * After a reconnect the server sends a fresh READY; open channels then fetch
 * anything newer than their last known message (see actions.resyncOpenChannels),
 * so nothing is lost and nothing is duplicated (messages are keyed by id).
 */
let ws: WebSocket | null = null;
let hb: number | null = null;
let attempt = 0;
let stopped = false;
let lastSeq = 0;
let reconnectTimer: number | null = null;
let lastFrame = 0;
/** Frames are applied strictly in arrival order, even when one needs async decryption. */
let chain: Promise<void> = Promise.resolve();

export function connectGateway() {
  if (previewMode) return;
  stopped = false;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/gateway`);
  const sock = ws;
  lastFrame = Date.now();
  sock.onmessage = (e) => {
    lastFrame = Date.now();
    const f = JSON.parse(e.data);
    if (f.op === "hello") {
      if (hb) clearInterval(hb);
      const every = f.d.heartbeat_interval as number;
      hb = window.setInterval(() => {
        if (sock.readyState !== WebSocket.OPEN) return;
        // No frame (not even a heartbeat ack) for two intervals: the socket is dead even if the browser hasn't noticed.
        if (Date.now() - lastFrame > every * 2 + 5000) { sock.close(4000, "Heartbeat timeout"); return; }
        sock.send(JSON.stringify({ op: "heartbeat" }));
      }, every);
      return;
    }
    if (f.op === "heartbeat_ack") return;
    chain = chain.then(() => handle(sock, f)).catch((err) => console.error("[gateway]", err));
  };
  const handle = async (sock: WebSocket, f: any) => {
    if (sock !== ws) return;
    if (f.op === "error") { import("./store.ts").then((s) => s.toast(f.d?.message ?? "Something went wrong.", "error")); return; }
    if (f.op !== "dispatch") return;
    if (f.t === "MESSAGE_CREATE" || f.t === "MESSAGE_UPDATE") f.d = await (await import("./crypto/dm.ts")).decodeWire(f.d);
    lastSeq = f.s;
    if (f.t === "READY") {
      const wasReconnect = attempt > 0 || useStore.getState().conn === "reconnecting";
      attempt = 0;
      dispatch(f.t, f.d);
      if (wasReconnect) import("./actions.ts").then((a) => a.resyncOpenChannels());
      return;
    }
    if (f.t === "SESSION_REVOKED") { stopped = true; import("./actions.ts").then((a) => a.signedOut(f.d?.reason)); return; }
    dispatch(f.t, f.d);
  };
  sock.onclose = (e) => {
    if (hb) clearInterval(hb);
    if (sock !== ws) return;
    ws = null;
    if (stopped || e.code === 4004) return;
    if (e.code === 4001) { import("./actions.ts").then((a) => a.signedOut()); return; }
    useStore.setState({ conn: "reconnecting" });
    const delay = Math.min(30_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
    attempt++;
    reconnectTimer = window.setTimeout(connectGateway, delay);
  };
}

export function disconnectGateway() {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  ws?.close();
  ws = null;
}

export function gwSend(op: string, d?: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d }));
}

/** Reconnect now instead of waiting out the backoff timer. */
function reconnectNow() {
  if (stopped || previewMode) return;
  if (ws && Date.now() - lastFrame > 75_000) { const old = ws; ws = null; old.close(4000, "Stale"); }
  if (ws) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  attempt = Math.max(attempt, 1); // the next READY triggers a resync of open channels
  connectGateway();
}
// Reconnect promptly when the network comes back or the tab/laptop wakes up.
window.addEventListener("online", reconnectNow);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reconnectNow(); });
window.addEventListener("focus", reconnectNow);
export const gatewaySeq = () => lastSeq;
