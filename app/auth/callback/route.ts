import { NextResponse, type NextRequest } from "next/server";

import { serverClient } from "@/lib/supabase/server";

/**
 * The single landing point for every link Supabase emails: confirmation,
 * magic recovery and email change. The one-time code is exchanged for a
 * session server-side, so the token never lands in browser history or a
 * client bundle.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/u/me";
  // Only ever redirect within this origin.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!code) {
    return NextResponse.redirect(
      new URL("/account?fault=missing-code", url.origin),
    );
  }

  const supabase = await serverClient();
  if (!supabase) {
    return NextResponse.redirect(
      new URL("/account?fault=not-configured", url.origin),
    );
  }

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/account?fault=expired", url.origin));
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
