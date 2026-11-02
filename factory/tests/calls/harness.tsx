// Test harness only (not shipped): two windows on one origin call each other through
// a BroadcastChannel stand-in for Supabase Realtime, using the real CallProvider.
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { ToastProvider } from "../../src/components/Toast";
import { CallProvider, useCalls } from "../../src/components/Calls";
import { StoreProvider, useHasStore } from "../../src/lib/store";
import "../../src/styles.css";

const q = new URLSearchParams(location.search);
const ME = q.get("me")!;
const A = "aaaaaaaa-0000-0000-0000-000000000001", B = "bbbbbbbb-0000-0000-0000-000000000002";
const CONV = "c0000000-0000-0000-0000-000000000001";
const now = new Date().toISOString();
const prof = (id: string, n: string) => ({ id, full_name: n, employee_code: "X", role: "operator", avatar_url: null, holiday_allowance: 28, active: true, created_at: now, status: "available", status_note: "", last_seen_at: now });
const data: Record<string, unknown[]> = {
  profiles: [prof(A, "Alice PC"), prof(B, "Bob Phone")],
  conversations: [{ id: CONV, kind: "direct", name: "", topic: "", direct_key: "k", created_by: A, last_message_at: now, created_at: now }],
  conversation_members: [A, B].map((u, i) => ({ id: `m${i}`, conversation_id: CONV, user_id: u, role: "member", last_read_at: now, muted: false, joined_at: now, created_at: now })),
};
const log: string[] = []; (window as unknown as { __log: string[] }).__log = log;

class FakeChannel {
  bc: BroadcastChannel; key: string; here = new Set<string>(); h: { kind: string; event: string; cb: (x: any) => void }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  constructor(public name: string, key: string) {
    this.key = key; this.bc = new BroadcastChannel(name);
    this.bc.onmessage = (e) => {
      const m = e.data;
      if (m.kind === "broadcast") { if (q.get("droprate") && Math.random() < Number(q.get("droprate"))) return; this.fire("broadcast", m.event, { payload: m.payload }); }
      else if (m.kind === "join" || m.kind === "here") {
        const isNew = !this.here.has(m.key); this.here.add(m.key);
        if (m.kind === "join") this.bc.postMessage({ kind: "here", key: this.key });
        if (isNew) setTimeout(() => this.fire("presence", "sync", {}), Number(q.get("presencelag") ?? 0));
      } else if (m.kind === "leave") { this.here.delete(m.key); this.fire("presence", "leave", { key: m.key }); this.fire("presence", "sync", {}); }
    };
  }
  fire(kind: string, event: string, x: unknown) { this.h.filter((h) => h.kind === kind && h.event === event).forEach((h) => h.cb(x)); }
  on(kind: string, f: { event: string }, cb: (x: any) => void) { this.h.push({ kind, event: f.event, cb }); return this; } // eslint-disable-line @typescript-eslint/no-explicit-any
  subscribe(cb: (s: string) => void) { setTimeout(() => cb("SUBSCRIBED"), 30); return this; }
  track() { this.here.add(this.key); this.bc.postMessage({ kind: "join", key: this.key }); this.fire("presence", "sync", {}); return Promise.resolve("ok"); }
  presenceState() { return Object.fromEntries([...this.here].map((k) => [k, [{}]])); }
  send(m: { event: string; payload: unknown }) { this.bc.postMessage({ kind: "broadcast", event: m.event, payload: m.payload }); return Promise.resolve("ok"); }
  close() { this.bc.postMessage({ kind: "leave", key: this.key }); this.bc.close(); }
}
const backend = {
  list: async (t: string) => data[t] ?? [],
  subscribe: () => () => {},
  accessToken: async () => null,
  rpc: async (fn: string, a: unknown) => { log.push(`rpc ${fn} ${JSON.stringify(a)}`); },
  insert: async (_t: string, row: Record<string, unknown>) => ({ id: "ca000000-0000-0000-0000-0000000000ff", started_at: new Date().toISOString(), ended_at: null, status: "ringing", created_at: now, ...row }),
  channel: (name: string, o: { presenceKey: string }) => new FakeChannel(name, o.presenceKey),
  removeChannel: (c: FakeChannel) => c.close(),
} as never;

function Expose() {
  const c = useCalls();
  useEffect(() => { (window as unknown as { __calls: unknown }).__calls = c; }, [c]);
  return null;
}
function Gate() { return useHasStore() ? <CallProvider><Expose /></CallProvider> : null; }
createRoot(document.getElementById("root")!).render(
  <ToastProvider><StoreProvider backend={backend} userId={ME} onMissingProfile={() => {}}><Gate /></StoreProvider></ToastProvider>,
);
(window as unknown as { __ids: unknown }).__ids = { A, B, CONV };
