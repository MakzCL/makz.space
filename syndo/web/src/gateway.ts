import { dispatch, useStore } from "./store.ts";

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

export function connectGateway() {
  stopped = false;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/gateway`);
  const sock = ws;
  sock.onmessage = (e) => {
    const f = JSON.parse(e.data);
    if (f.op === "hello") {
      if (hb) clearInterval(hb);
      hb = window.setInterval(() => sock.readyState === WebSocket.OPEN && sock.send(JSON.stringify({ op: "heartbeat" })), f.d.heartbeat_interval);
      return;
    }
    if (f.op === "error") { import("./store.ts").then((s) => s.toast(f.d?.message ?? "Something went wrong.", "error")); return; }
    if (f.op !== "dispatch") return;
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

// Reconnect promptly when the network comes back or the tab wakes up.
window.addEventListener("online", () => { if (!ws && !stopped) { attempt = 0; connectGateway(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !ws && !stopped) { attempt = 0; connectGateway(); } });
export const gatewaySeq = () => lastSeq;
