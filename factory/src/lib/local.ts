import type { Backend, JoinInfo, Row } from "./backend";
import { seedDB } from "./seed";
import type { DB, JoinLink, Profile, Role, TableName } from "./types";

const KEY = "skf-demo-db-v3";
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
      role: "operator", avatar_url: null, holiday_allowance: 28, active: false, created_at: new Date().toISOString(),
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
  private link(code: string) { return this.db.join_links.find((l) => l.code === code.trim().toUpperCase()); }
  private status(l: JoinLink | undefined): JoinInfo["reason"] {
    if (!l) return "not_found";
    if (l.revoked) return "revoked";
    if (new Date(l.expires_at).getTime() < Date.now()) return "expired";
    if (l.max_uses !== null && l.uses >= l.max_uses) return "used_up";
    if (l.failed >= 10) return "locked";
    return "ok";
  }
  async createJoinLink(role: Role, pin: string, hours: number, maxUses: number | null) {
    const me = await this.currentUser();
    const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
    const l: JoinLink = {
      id: crypto.randomUUID(), code, pin, role, created_by: me!, max_uses: maxUses, uses: 0, failed: 0, revoked: false,
      expires_at: new Date(Date.now() + hours * 3600e3).toISOString(), created_at: new Date().toISOString(),
    };
    this.db.join_links.push(l);
    this.changed("join_links");
    return structuredClone(l);
  }
  async joinInfo(code: string): Promise<JoinInfo> {
    await wait(250);
    const l = this.link(code);
    const reason = this.status(l);
    return { valid: reason === "ok", reason, role: l?.role ?? "operator", inviter: this.db.profiles.find((p) => p.id === l?.created_by)?.full_name ?? "" };
  }
  async checkJoinPin(code: string, pin: string) {
    await wait(300);
    const l = this.link(code);
    if (this.status(l) !== "ok") return false;
    if (l!.pin !== pin) { l!.failed++; this.changed("join_links"); return false; }
    return true;
  }
  async redeemJoin(code: string, pin: string) {
    const me = await this.currentUser();
    const l = this.link(code);
    if (!me || this.status(l) !== "ok") throw new Error("This invite link is no longer valid");
    if (l!.pin !== pin) { l!.failed++; this.changed("join_links"); throw new Error("Wrong PIN"); }
    const p = this.db.profiles.find((x) => x.id === me)!;
    if (!p.active) { p.active = true; p.role = l!.role; }
    l!.uses++;
    this.changed("join_links"); this.changed("profiles");
  }

  async uploadAvatar(_id: string, blob: Blob) {
    return await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
}
