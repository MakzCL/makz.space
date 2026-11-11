import { Hash, Image, Megaphone, MessageSquare, Radio, Volume2, type LucideProps } from "lucide-react";
import { ChannelType, type Channel } from "@send/shared";
import { CustomEmoji } from "../markdown.tsx";

const DEFAULT_ICON: Record<number, typeof Hash> = { [ChannelType.TEXT]: Hash, [ChannelType.VOICE]: Volume2, [ChannelType.ANNOUNCEMENT]: Megaphone, [ChannelType.STAGE]: Radio, [ChannelType.FORUM]: MessageSquare, [ChannelType.MEDIA]: Image };

/** A channel's icon: its chosen emoji (unicode or custom), else the default # / speaker / … icon. */
export function ChannelGlyph({ c, size = 18, className }: { c: Pick<Channel, "type" | "icon_emoji">; size?: number; className?: string }) {
  const e = c.icon_emoji;
  if (e) {
    const custom = e.match(/^<a?:([A-Za-z0-9_]{2,32}):(\d{1,20})>$/);
    return <span className={`ch-emoji ${className ?? ""}`} style={{ fontSize: Math.round(size * .95), width: size + 2, height: size + 2 }} aria-hidden>{custom ? <CustomEmoji id={custom[2]!} name={custom[1]!} size={size} /> : e}</span>;
  }
  const Icon = DEFAULT_ICON[c.type] ?? Hash;
  return <Icon size={size} aria-hidden className={className} {...({} as LucideProps)} />;
}
