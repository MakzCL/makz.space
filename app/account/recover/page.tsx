import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/supabase/viewer";
import { supabaseConfigured } from "@/lib/supabase/config";
import { NotConfigured } from "@/features/account/not-configured";
import { NewPassword } from "@/features/account/new-password";

export const metadata: Metadata = {
  title: "Set a new password",
  robots: { index: false, follow: false },
};

/**
 * Reached only through the recovery link, which has already exchanged its
 * code for a session at /auth/callback. Without that session there is nothing
 * to update, so the visitor is sent back to request a fresh link.
 */
export default async function RecoverPage() {
  if (!supabaseConfigured) return <NotConfigured />;

  const viewer = await getViewer();
  if (!viewer) redirect("/account?mode=recover&fault=expired");

  return <NewPassword email={viewer.email} />;
}
