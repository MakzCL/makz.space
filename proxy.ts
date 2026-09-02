import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import {
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  supabaseConfigured,
} from "@/lib/supabase/config";

/** Routes that require a session. Everything else is open. */
const PROTECTED = ["/settings", "/saved"];

/**
 * Refreshes the Supabase session on every navigation so an expired access
 * token is rotated before a Server Component reads it, and gates the
 * authenticated routes. This is what makes "stay signed in" work without
 * ever touching localStorage.
 *
 * Runs as the Next.js proxy (formerly middleware) — before any route is
 * matched, so the refreshed cookies are already on the request.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!supabaseConfigured) return response;

  const remembered = request.cookies.get(REMEMBER_COOKIE)?.value === "1";

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list) {
        for (const { name, value } of list) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
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
          response.cookies.set(name, value, scoped);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && PROTECTED.some((route) => pathname.startsWith(route))) {
    const url = request.nextUrl.clone();
    url.pathname = "/account";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/account") {
    const url = request.nextUrl.clone();
    url.pathname = `/u/me`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets, image optimiser output and the
     * favicon — those never carry a session and would only add latency.
     */
    "/((?!_next/static|_next/image|fonts/|favicon.png|robots.txt|sitemap.xml|manifest.webmanifest).*)",
  ],
};
