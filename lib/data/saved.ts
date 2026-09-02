import "server-only";

import { serverClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/supabase/viewer";
import type { SavedItem, SavedItemType } from "@/types";

/** Every record the viewer has kept, newest first. */
export async function listSaved(): Promise<SavedItem[]> {
  const viewer = await getViewer();
  if (!viewer) return [];

  const supabase = await serverClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("saved_items")
    .select("*")
    .eq("user_id", viewer.id)
    .order("created_at", { ascending: false });

  return (data as SavedItem[] | null) ?? [];
}

/** Whether one specific item is kept. Cheap enough to call per page. */
export async function isSaved(type: SavedItemType, slug: string) {
  const viewer = await getViewer();
  if (!viewer) return false;

  const supabase = await serverClient();
  if (!supabase) return false;

  const { data } = await supabase
    .from("saved_items")
    .select("id")
    .eq("user_id", viewer.id)
    .eq("item_type", type)
    .eq("item_slug", slug)
    .maybeSingle();

  return Boolean(data);
}
