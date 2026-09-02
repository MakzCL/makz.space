"use client";

import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL, supabaseConfigured } from "./config";

let cached: ReturnType<typeof createBrowserClient> | null = null;

/**
 * Browser client. Sessions live in cookies written by @supabase/ssr, never in
 * localStorage, so the server renders the same authenticated state the client
 * sees and nothing sensitive is readable by injected script.
 */
export function browserClient() {
  if (!supabaseConfigured) return null;
  cached ??= createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return cached;
}
