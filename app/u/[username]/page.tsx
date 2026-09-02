import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getPublicProfile, getViewer } from "@/lib/supabase/viewer";
import { serverClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { NotConfigured } from "@/features/account/not-configured";
import { ProfileView } from "@/features/profile/profile-view";
import { SITE } from "@/lib/site";
import type { ActivityEntry, SavedItem } from "@/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  if (username === "me") {
    return { title: "Profile", robots: { index: false, follow: false } };
  }

  const profile = await getPublicProfile(username);
  if (!profile || profile.profile_visibility !== "public") {
    return { title: "Profile", robots: { index: false, follow: false } };
  }

  const name = profile.display_name || profile.username;
  return {
    title: name,
    description: profile.bio ?? `${name} on ${SITE.name}.`,
    alternates: { canonical: `/u/${profile.username}` },
    robots: { index: true, follow: true },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  if (!supabaseConfigured) return <NotConfigured />;

  const viewer = await getViewer();

  // /u/me is a convenience alias so links can be written before the handle
  // is known. It never renders — it resolves and redirects.
  if (username === "me") {
    if (!viewer) redirect("/account?next=/u/me");
    redirect(`/u/${viewer.profile.username}`);
  }

  const profile = await getPublicProfile(username);
  if (!profile) notFound();

  const isOwner = viewer?.id === profile.id;

  // Row level security already hides private profiles from other accounts,
  // but the 404 keeps their existence unconfirmed either way.
  if (profile.profile_visibility === "private" && !isOwner) notFound();

  const supabase = await serverClient();

  const [savedResult, activityResult, activityPublic] = await Promise.all([
    isOwner && supabase
      ? supabase
          .from("saved_items")
          .select("*")
          .eq("user_id", profile.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as SavedItem[] }),
    supabase
      ? supabase
          .from("activity")
          .select("*")
          .eq("user_id", profile.id)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] as ActivityEntry[] }),
    // `preferences` is private, so a visitor cannot read the owner's
    // show_activity flag directly. The definer function answers the one
    // question they are allowed to ask about it.
    isOwner || !supabase
      ? Promise.resolve({ data: null })
      : supabase.rpc("activity_is_public", { account: profile.id }),
  ]);

  // Saved records are private: only the owner's own page lists them.
  const saved = (savedResult.data as SavedItem[] | null) ?? [];
  const activity = (activityResult.data as ActivityEntry[] | null) ?? [];
  const showActivity = isOwner || activityPublic.data === true;

  return (
    <ProfileView
      profile={profile}
      saved={saved}
      activity={showActivity ? activity : []}
      isOwner={isOwner}
      showActivity={showActivity}
    />
  );
}
