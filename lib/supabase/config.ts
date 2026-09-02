/**
 * Supabase configuration, read once and validated loudly.
 *
 * Both values below are publishable by design — the anon key is safe in the
 * browser because every table is protected by row level security. The
 * service role key is never imported anywhere in this codebase.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the environment is configured well enough to talk to Supabase. */
export const supabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

export function assertSupabaseConfigured(): void {
  if (!supabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local — see .env.example.",
    );
  }
}

/** Cookie that records whether this device asked to be remembered. */
export const REMEMBER_COOKIE = "makz-remember";
/** Thirty days, in seconds. */
export const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30;
