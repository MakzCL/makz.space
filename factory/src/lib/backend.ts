import type { RealtimeChannel } from "@supabase/supabase-js";
import type { JoinLink, Role, TableName, Tables } from "./types";

export interface DeviceSession { id: string; created_at: string; last_active: string; user_agent: string | null; ip: string | null; current: boolean }
export interface JoinInfo { valid: boolean; reason: "ok" | "expired" | "revoked" | "used_up" | "locked" | "not_found"; role: Role; inviter: string }

export type Row<T extends TableName> = Tables[T];
export interface Change { type: "INSERT" | "UPDATE" | "DELETE"; row: Record<string, unknown> | null; oldId: string | null }

export interface Backend {
  /** Resolve the signed-in user id, or null. */
  currentUser(): Promise<string | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, fullName: string): Promise<{ needsConfirm: boolean }>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Signed-in devices of the current person (newest activity first; the current one is flagged). */
  listSessions(): Promise<DeviceSession[]>;
  /** End one of the current person's sessions (another device). */
  endSession(id: string): Promise<boolean>;
  /** Sign out every other device, or every device including this one. */
  signOutScope(scope: "others" | "global"): Promise<void>;

  list<T extends TableName>(table: T): Promise<Row<T>[]>;
  insert<T extends TableName>(table: T, row: Partial<Row<T>>): Promise<Row<T>>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  remove(table: TableName, id: string): Promise<void>;
  /** Called with the table that changed (from anyone, anywhere), plus the row when known. */
  subscribe(onChange: (table: TableName, change?: Change) => void): () => void;
  /** Realtime room for presence, typing and call signalling. */
  channel(name: string, opts?: { presenceKey?: string }): RealtimeChannel;
  removeChannel(ch: RealtimeChannel): void;
  uploadChatFile(conversationId: string, file: Blob, name: string): Promise<string>;
  signedUrl(path: string): Promise<string>;
  functionUrl(name: string): string;
  /** Current sign-in token (for our own services, e.g. the call relay). */
  accessToken(): Promise<string | null>;
  onAuthChange(cb: () => void): () => void;
  uploadAvatar(userId: string, blob: Blob): Promise<string>;

  /** Call a database function (stock moves, imports, receiving). */
  rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Routed (Shopify) job: the current station is finished — pass it on. */
  completeStage(jobId: string): Promise<"next" | "done">;

  /** Invite links: the boss makes one unique link per person; every link uses the same PIN. */
  createJoinLink(role: Role, pin: string, hours: number, maxUses: number | null): Promise<JoinLink>;
  joinInfo(code: string): Promise<JoinInfo>;
  checkJoinPin(code: string, pin: string): Promise<boolean>;
  /** Activates the signed-in (pending) account with the link's role. */
  redeemJoin(code: string, pin: string): Promise<void>;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** The shared PIN for every invite link (the database enforces it too). */
export const JOIN_PIN = "101010";

export async function createBackend(): Promise<Backend> {
  if (!url || !key) throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time");
  const { SupabaseBackend } = await import("./supa");
  return new SupabaseBackend(url, key);
}
