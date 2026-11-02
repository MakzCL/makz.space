import type { Profile, TableName, Tables } from "./types";

export type Row<T extends TableName> = Tables[T];

export interface Backend {
  mode: "demo" | "cloud";
  /** Resolve the signed-in user id, or null. */
  currentUser(): Promise<string | null>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string, fullName: string): Promise<{ needsConfirm: boolean }>;
  resetPassword(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Demo only: enter as a seeded staff member. */
  signInAs?(id: string): Promise<void>;
  demoStaff?(): Profile[];
  resetDemo?(): void;

  list<T extends TableName>(table: T): Promise<Row<T>[]>;
  insert<T extends TableName>(table: T, row: Partial<Row<T>>): Promise<Row<T>>;
  update<T extends TableName>(table: T, id: string, patch: Partial<Row<T>>): Promise<Row<T>>;
  remove(table: TableName, id: string): Promise<void>;
  /** Called with the table that changed (from anyone, anywhere). */
  subscribe(onChange: (table: TableName) => void): () => void;
  onAuthChange(cb: () => void): () => void;
  uploadAvatar(userId: string, blob: Blob): Promise<string>;
}

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export async function createBackend(): Promise<Backend> {
  if (url && key) {
    const { SupabaseBackend } = await import("./supa");
    return new SupabaseBackend(url, key);
  }
  const { LocalBackend } = await import("./local");
  return new LocalBackend();
}
