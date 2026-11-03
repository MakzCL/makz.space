import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import type { Backend, Change, JoinInfo, Row } from "./backend";
import { TABLES, type JoinLink, type Role, type TableName } from "./types";

/** History older than this is not loaded into the app (keeps phones fast). */
const WINDOW_DAYS = 120;
const TIME_COL: Partial<Record<TableName, string>> = {
  shifts: "clock_in", breaks: "started_at", work_sessions: "started_at",
  participants: "joined_at", invites: "created_at", announcements: "created_at",
  job_steps: "completed_at", stock_movements: "created_at",
  notifications: "created_at", messages: "created_at", message_reactions: "created_at", calls: "created_at", call_participants: "created_at",
};

/**
 * ADMIN-03: cost columns are not readable through the API. These tables are read
 * column by column, and the costs come from my_costs() — only for roles whose
 * Kortana access includes "Costs" (PO/supplier prices also for "Buy").
 */
const COST: Partial<Record<TableName, { col: string; cols: string }>> = {
  stock_items: { col: "avg_cost", cols: "id,sku,name,location,unit,quantity,min_quantity,updated_by,updated_at,created_at,kind,category,sale_price,supplier_id,supplier_code,lead_days,notes,archived,make_min,make_batch,barcode,tracking" },
  stock_movements: { col: "unit_cost", cols: "id,item_id,delta,after,reason,ref,note,user_id,created_at,job_id,source_type,source_id,location_id,lot_id" },
  po_lines: { col: "unit_cost", cols: "id,po_id,item_id,quantity,received,created_at" },
  item_suppliers: { col: "unit_cost", cols: "id,item_id,supplier_id,supplier_sku,lead_days,preferred,created_at" },
  stations: { col: "cost_per_hour", cols: "id,name,sort,in_default,created_at" },
  product_operations: { col: "fixed_cost", cols: "id,product_id,station_id,name,setup_minutes,unit_minutes,sort,created_at" },
};

export class SupabaseBackend implements Backend {
  sb: SupabaseClient;

  url: string;
  constructor(url: string, key: string) {
    this.url = url;
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  async currentUser() {
    // getSession() can wait on a token refresh; never let start-up hang on it.
    const timeout = new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 8000));
    const r = await Promise.race([this.sb.auth.getSession().then((x) => x.data.session?.user.id ?? null), timeout]).catch(() => null);
    if (r !== "timeout") return r;
    try {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      return key ? (JSON.parse(localStorage.getItem(key) ?? "null")?.user?.id ?? null) : null;
    } catch { return null; }
  }
  async signIn(email: string, password: string) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  async signUp(email: string, password: string, full_name: string) {
    const { data, error } = await this.sb.auth.signUp({
      email, password, options: { data: { full_name }, emailRedirectTo: location.origin },
    });
    if (error) throw error;
    return { needsConfirm: !data.session };
  }
  async resetPassword(email: string) {
    const { error } = await this.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (error) throw error;
  }
  async signOut() { await this.sb.auth.signOut(); }

  async list<T extends TableName>(table: T) {
    const cost = COST[table];
    let q = this.sb.from(table).select(cost?.cols ?? "*");
    const col = TIME_COL[table];
    const since = col ? new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString() : null;
    if (col) q = q.gte(col, since!);
    const [{ data, error }, costs] = await Promise.all([
      q.limit(5000),
      cost ? this.sb.rpc("my_costs", { p_table: table, p_since: since }) : Promise.resolve(null),
    ]);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (cost) {
      const map = (costs && !costs.error ? costs.data : null) as Record<string, number> | null;
      for (const r of rows) r[cost.col] = map ? map[r.id as string] ?? null : null;
    }
    return rows as unknown as Row<T>[];
  }
  async insert<T extends TableName>(table: T, row: Partial<Row<T>>) {
    const cost = COST[table];
    const { data, error } = await this.sb.from(table).insert(row as never).select(cost?.cols ?? "*").single();
    if (error) throw error;
    if (cost) (data as unknown as Record<string, unknown>)[cost.col] = (row as Record<string, unknown>)[cost.col] ?? null;
    return data as unknown as Row<T>;
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const cost = COST[table];
    const { data, error } = await this.sb.from(table).update(patch as never).eq("id", id).select(cost?.cols ?? "*").single();
    if (error) throw error;
    if (cost) (data as unknown as Record<string, unknown>)[cost.col] = (patch as Record<string, unknown>)[cost.col] ?? null;
    return data as unknown as Row<T>;
  }
  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq("id", id);
    if (error) throw error;
  }
  subscribe(onChange: (t: TableName, change?: Change) => void) {
    this.dropStale("factory-live");
    const ch = this.sb.channel("factory-live");
    for (const t of TABLES) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (p) => onChange(t, {
        type: p.eventType, row: (p.new && Object.keys(p.new).length ? p.new : null) as Record<string, unknown> | null,
        oldId: (p.old as { id?: string } | null)?.id ?? null,
      }));
    }
    ch.subscribe();
    return () => { this.sb.removeChannel(ch); };
  }
  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((evt) => {
      // Never call back into Supabase auth inside this callback — it holds the
      // auth lock, and getSession() would wait for it forever (stuck start-up).
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT" || evt === "USER_UPDATED") setTimeout(cb, 0);
    });
    return () => data.subscription.unsubscribe();
  }
  async uploadAvatar(userId: string, blob: Blob) {
    const path = `${userId}/avatar-${Date.now()}.webp`;
    const { error } = await this.sb.storage.from("avatars").upload(path, blob, {
      contentType: blob.type || "image/webp", upsert: true,
    });
    if (error) throw error;
    return this.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  }

  channel(name: string, opts?: { presenceKey?: string }) {
    this.dropStale(name);
    return this.sb.channel(name, { config: { broadcast: { self: false, ack: false }, presence: { key: opts?.presenceKey ?? "" } } });
  }
  /**
   * supabase-js hands back an existing channel with the same name, and adding
   * listeners to one that is already subscribed throws (blank-screen crash when
   * a chat/call is reopened before the old channel finished closing).
   * Always start from a fresh channel instead.
   */
  private dropStale(name: string) {
    const rt = this.sb.realtime as unknown as { channels: RealtimeChannel[]; getChannels(): RealtimeChannel[] };
    const old = rt.getChannels().find((c) => c.topic === `realtime:${name}`);
    if (!old) return;
    old.unsubscribe().catch(() => {});
    rt.channels = rt.channels.filter((c) => c !== old);
  }
  removeChannel(ch: ReturnType<SupabaseClient["channel"]>) { this.sb.removeChannel(ch); }
  async uploadChatFile(conversationId: string, file: Blob, name: string) {
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file";
    const path = `${conversationId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await this.sb.storage.from("chat").upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (error) throw error;
    return path;
  }
  async signedUrl(path: string) {
    const { data, error } = await this.sb.storage.from("chat").createSignedUrl(path, 60 * 60 * 6);
    if (error) throw error;
    return data.signedUrl;
  }
  async accessToken() { return (await this.sb.auth.getSession()).data.session?.access_token ?? null; }
  functionUrl(name: string) { return `${this.url.replace(/\/$/, "")}/functions/v1/${name}`; }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw error;
    return data as T;
  }

  async completeStage(jobId: string) {
    const { data, error } = await this.sb.rpc("complete_stage", { p_job: jobId });
    if (error) throw error;
    return data as "next" | "done";
  }

  async createJoinLink(role: Role, pin: string, hours: number, maxUses: number | null) {
    const { data, error } = await this.sb.rpc("create_join_link", { p_role: role, p_pin: pin, p_hours: hours, p_max_uses: maxUses });
    if (error) throw error;
    return data as JoinLink;
  }
  async joinInfo(code: string) {
    const { data, error } = await this.sb.rpc("join_link_info", { p_code: code });
    if (error) throw error;
    const r = (Array.isArray(data) ? data[0] : data) as JoinInfo | undefined;
    return r ?? { valid: false, reason: "not_found", role: "operator", inviter: "" };
  }
  async checkJoinPin(code: string, pin: string) {
    const { data, error } = await this.sb.rpc("check_join_pin", { p_code: code, p_pin: pin });
    if (error) throw error;
    return data === true;
  }
  async redeemJoin(code: string, pin: string) {
    const { data, error } = await this.sb.rpc("redeem_join_link", { p_code: code, p_pin: pin });
    if (error) throw error;
    if (data === "wrong_pin") throw new Error("Wrong PIN");
    if (data !== "ok") throw new Error("This invite link is no longer valid");
  }
}
