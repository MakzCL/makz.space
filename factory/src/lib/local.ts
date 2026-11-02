import type { Backend, Row } from "./backend";
import { seedDB } from "./seed";
import type { DB, Profile, TableName } from "./types";

const KEY = "skf-demo-db-v2";
const USER = "skf-demo-user";
const chan = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("skf-demo") : null;

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DB;
  } catch { /* fall through to a fresh seed */ }
  const db = seedDB();
  save(db);
  return db;
}
function save(db: DB) {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* storage full or blocked */ }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Demo mode: the whole factory lives in this browser. Open two tabs as two people to try team jobs. */
export class LocalBackend implements Backend {
  mode = "demo" as const;
  private db: DB = load();
  private listeners = new Set<(t: TableName) => void>();
  private authListeners = new Set<() => void>();

  constructor() {
    chan?.addEventListener("message", (e: MessageEvent<TableName | "*">) => {
      this.db = load();
      const t = e.data;
      if (t === "*") this.listeners.forEach((l) => (Object.keys(this.db) as TableName[]).forEach(l));
      else this.listeners.forEach((l) => l(t));
    });
  }

  private changed(t: TableName) {
    save(this.db);
    chan?.postMessage(t);
    queueMicrotask(() => this.listeners.forEach((l) => l(t)));
  }

  private get me() {
    try { return sessionStorage.getItem(USER) ?? localStorage.getItem(USER); } catch { return null; }
  }
  private setMe(id: string | null) {
    try {
      if (id) { sessionStorage.setItem(USER, id); localStorage.setItem(USER, id); }
      else { sessionStorage.removeItem(USER); localStorage.removeItem(USER); }
    } catch { /* ignore */ }
    this.authListeners.forEach((l) => l());
  }

  async currentUser() {
    const id = this.me;
    return id && this.db.profiles.some((p) => p.id === id) ? id : null;
  }
  demoStaff(): Profile[] { return this.db.profiles; }
  async signInAs(id: string) { await wait(350); this.setMe(id); }
  async signIn(email: string) {
    await wait(500);
    const name = email.split("@")[0]!.toLowerCase();
    const p = this.db.profiles.find((x) => x.full_name.toLowerCase().split(" ")[0] === name);
    if (!p) throw new Error("Demo mode: use a first name, e.g. karol@skalarki.demo — or pick a gateway below.");
    this.setMe(p.id);
  }
  async signUp(_email: string, _pw: string, fullName: string) {
    await wait(500);
    const n = this.db.profiles.length + 20;
    const p: Profile = {
      id: crypto.randomUUID(), full_name: fullName || "New starter", employee_code: `OP-0${n}`,
      role: "operator", avatar_url: null, holiday_allowance: 28, created_at: new Date().toISOString(),
    };
    this.db.profiles.push(p);
    this.changed("profiles");
    this.setMe(p.id);
    return { needsConfirm: false };
  }
  async resetPassword() { await wait(300); }
  async signOut() { this.setMe(null); }
  resetDemo() {
    this.db = seedDB(); save(this.db); chan?.postMessage("*"); this.setMe(null);
  }

  async list<T extends TableName>(table: T) {
    return structuredClone(this.db[table]) as Row<T>[];
  }
  async insert<T extends TableName>(table: T, row: Partial<Row<T>>) {
    const now = new Date().toISOString();
    const full = { id: crypto.randomUUID(), created_at: now, ...row } as unknown as Row<T>;
    (this.db[table] as Row<T>[]).push(full);
    this.changed(table);
    return structuredClone(full);
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const rows = this.db[table] as Row<T>[];
    const i = rows.findIndex((r) => (r as { id: string }).id === id);
    if (i < 0) throw new Error("Not found");
    rows[i] = { ...rows[i]!, ...patch };
    this.changed(table);
    return structuredClone(rows[i]!);
  }
  async remove(table: TableName, id: string) {
    const d = this.db as unknown as Record<string, { id: string }[]>;
    d[table] = d[table]!.filter((r) => r.id !== id);
    this.changed(table);
  }
  subscribe(cb: (t: TableName) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  onAuthChange(cb: () => void) { this.authListeners.add(cb); return () => { this.authListeners.delete(cb); }; }
  async uploadAvatar(_id: string, blob: Blob) {
    return await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
}
