import type { Metadata } from "next";

import { Access } from "@/features/account/access";
import { supabaseConfigured } from "@/lib/supabase/config";
import { NotConfigured } from "@/features/account/not-configured";

export const metadata: Metadata = {
  title: "Access",
  description: "Sign in to MAKZ, or create an account.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/account" },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  if (!supabaseConfigured) return <NotConfigured />;

  const rawMode = typeof params.mode === "string" ? params.mode : "enter";
  const mode =
    rawMode === "create" || rawMode === "recover" ? rawMode : "enter";

  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const next =
    rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")
      ? rawNext
      : undefined;

  const fault = typeof params.fault === "string" ? params.fault : undefined;

  return <Access initialMode={mode} next={next} fault={fault} />;
}
