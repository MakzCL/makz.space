import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import {
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabaseConfigured,
} from "./config";

/**
 * Server client bound to the request's cookie jar.
 *
 * "Remember me" is honoured here rather than in the browser: when the device
 * has not opted in, the auth cookies are rewritten as session cookies (no
 * Max-Age / Expires) so they die with the browser process. When it has, they
 * are capped at thirty days. Either way the token itself is issued, rotated
 * and validated by Supabase — nothing is stored by hand.
 */
export async function serverClient() {
  if (!supabaseConfigured) return null;

  const jar = await cookies();
  const remembered = jar.get(REMEMBER_COOKIE)?.value === "1";

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) {
            const scoped = { ...options, sameSite: "lax" as const, path: "/" };
            if (remembered) {
              scoped.maxAge = Math.min(
                options?.maxAge ?? REMEMBER_MAX_AGE,
                REMEMBER_MAX_AGE,
              );
            } else {
              delete scoped.maxAge;
              delete scoped.expires;
            }
            jar.set(name, value, scoped);
          }
        } catch {
          // Called from a Server Component render, where cookies are frozen.
          // Middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
