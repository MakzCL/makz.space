import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getViewer } from "@/lib/supabase/viewer";
import { supabaseConfigured } from "@/lib/supabase/config";
import { NotConfigured } from "@/features/account/not-configured";
import { SectionHead } from "@/components/ui/section-head";
import { SettingsConsole } from "@/features/settings/settings-console";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  if (!supabaseConfigured) return <NotConfigured />;

  const viewer = await getViewer();
  if (!viewer) redirect("/account?next=/settings");

  return (
    <>
      <SectionHead
        index="··"
        name="Settings"
        lede="Six panels. Appearance and motion apply the moment you touch them; everything else saves when you say so."
        readouts={[
          { label: "Account", value: `@${viewer.profile.username}` },
          { label: "Visibility", value: viewer.profile.profile_visibility.toUpperCase() },
        ]}
      />
      <div className="mt-8 md:mt-12">
        <SettingsConsole viewer={viewer} />
      </div>
    </>
  );
}
