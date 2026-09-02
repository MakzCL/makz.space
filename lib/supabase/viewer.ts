import "server-only";

import { cache } from "react";

import type { Preferences, Profile, Viewer } from "@/types";

import { serverClient } from "./server";

/**
 * The authenticated viewer for the current request, or null.
 *
 * Always resolved through getUser() — which revalidates the token with the
 * auth server — never from the cookie payload, which a client could forge.
 * Cached per request so the shell, the page and any nested segment share one
 * round trip.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await serverClient();
  if (!supabase) return null;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const [{ data: profile }, { data: preferences }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("preferences").select("*").eq("user_id", user.id).maybeSingle(),
  ]);

  if (!profile) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    profile: profile as Profile,
    preferences: (preferences as Preferences | null) ?? {
      user_id: user.id,
      appearance: "dark",
      motion: "full",
      show_activity: true,
      email_updates: false,
      updated_at: new Date().toISOString(),
    },
  };
});

/** Public profile lookup by username, honouring visibility. */
export async function getPublicProfile(username: string) {
  const supabase = await serverClient();
  if (!supabase) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username.toLowerCase())
    .maybeSingle();

  return (data as Profile | null) ?? null;
}
