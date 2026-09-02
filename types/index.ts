export type Appearance = "system" | "dark" | "day";
export type MotionSetting = "full" | "reduced";
export type ProfileVisibility = "public" | "private";
export type UserRole = "member" | "admin";

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  role: UserRole;
  profile_visibility: ProfileVisibility;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

export interface Preferences {
  user_id: string;
  appearance: Appearance;
  motion: MotionSetting;
  show_activity: boolean;
  email_updates: boolean;
  updated_at: string;
}

export type SavedItemType = "work" | "frame" | "game" | "stream";

export interface SavedItem {
  id: string;
  user_id: string;
  item_type: SavedItemType;
  item_slug: string;
  item_title: string;
  item_href: string;
  created_at: string;
}

export type ActivityKind =
  | "account.created"
  | "profile.updated"
  | "item.saved"
  | "item.unsaved";

export interface ActivityEntry {
  id: string;
  user_id: string;
  kind: ActivityKind;
  subject: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Viewer {
  id: string;
  email: string | null;
  profile: Profile;
  preferences: Preferences;
}

/* ---- CONTENT ----------------------------------------------------------- */

export interface WorkRecord {
  slug: string;
  index: string;
  title: string;
  subtitle: string;
  discipline: string[];
  year: string;
  status: "active" | "shipped" | "archived" | "ongoing";
  client: string;
  role: string;
  summary: string;
  cover: MediaAsset;
  gallery: MediaAsset[];
  sections: RecordSection[];
  stack: string[];
  timeline: TimelineEntry[];
  credits: { role: string; name: string }[];
  links: { label: string; href: string; external?: boolean }[];
}

export interface RecordSection {
  heading: string;
  index: string;
  body: string[];
  aside?: { label: string; value: string }[];
  media?: MediaAsset[];
}

export interface TimelineEntry {
  phase: string;
  label: string;
  detail: string;
}

export interface MediaAsset {
  src: string;
  alt: string;
  /** CSS aspect-ratio for the frame the asset is composed into. */
  aspect: string;
  /** contain = the artwork is the subject; cover = the image is environment. */
  fit: "contain" | "cover";
  caption?: string;
  meta?: string;
}

export interface FrameRecord {
  slug: string;
  index: string;
  title: string;
  subject: string;
  series: string;
  year: string;
  medium: string;
  asset: MediaAsset;
}

export interface GameRecord {
  slug: string;
  index: string;
  title: string;
  platform: string;
  status: "running" | "scheduled" | "idle";
  role: string;
  detail: string;
  facts: { label: string; value: string }[];
  links: { label: string; href: string; external?: boolean }[];
  probe?: { kind: "minecraft"; host: string };
}

export interface StreamStatus {
  online: boolean;
  viewers: number;
  title: string | null;
  startedAt: string | null;
  streamUrl: string;
  chatUrl: string;
  checkedAt: string;
}

export interface MinecraftStatus {
  online: boolean;
  players: { online: number; max: number } | null;
  version: string | null;
  motd: string | null;
  checkedAt: string;
}
