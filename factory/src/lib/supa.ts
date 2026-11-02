import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Backend, JoinInfo, Row } from "./backend";
import { TABLES, type JoinLink, type Role, type TableName } from "./types";

/** History older than this is not loaded into the app (keeps phones fast). */
const WINDOW_DAYS = 120;
const TIME_COL: Partial<Record<TableName, string>> = {
  shifts: "clock_in", breaks: "started_at", work_sessions: "started_at",
  participants: "joined_at", invites: "created_at", announcements: "created_at",
  orders: "created_at", job_steps: "completed_at", stock_movements: "created_at",
};

export class SupabaseBackend implements Backend {
  sb: SupabaseClient;

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  }

  async currentUser() {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
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
    let q = this.sb.from(table).select("*");
    const col = TIME_COL[table];
    if (col) q = q.gte(col, new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString());
    const { data, error } = await q.limit(5000);
    if (error) throw error;
    return (data ?? []) as Row<T>[];
  }
  async insert<T extends TableName>(table: T, row: Partial<Row<T>>) {
    const { data, error } = await this.sb.from(table).insert(row as never).select().single();
    if (error) throw error;
    return data as Row<T>;
  }
  async update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>) {
    const { data, error } = await this.sb.from(table).update(patch as never).eq("id", id).select().single();
    if (error) throw error;
    return data as Row<T>;
  }
  async remove(table: TableName, id: string) {
    const { error } = await this.sb.from(table).delete().eq("id", id);
    if (error) throw error;
  }
  subscribe(onChange: (t: TableName) => void) {
    const ch = this.sb.channel("factory-live");
    for (const t of TABLES) {
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => onChange(t));
    }
    ch.subscribe();
    return () => { this.sb.removeChannel(ch); };
  }
  onAuthChange(cb: () => void) {
    const { data } = this.sb.auth.onAuthStateChange((evt) => {
      if (evt === "SIGNED_IN" || evt === "SIGNED_OUT" || evt === "USER_UPDATED") cb();
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
