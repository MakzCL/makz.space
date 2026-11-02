import type { Profile } from "../lib/types";
import { ROLE_META } from "../lib/roles";

export const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

function hueOf(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

export function Avatar({ p, size = 40, ring, status }: {
  p?: Profile | null; size?: number; ring?: boolean; status?: "working" | "break" | "on" | "off";
}) {
  const name = p?.full_name ?? "?";
  const h = hueOf(name);
  return (
    <span className={`avatar ${ring ? "ring" : ""}`} style={{
      width: size, height: size, fontSize: size * 0.38,
      ["--ring" as string]: p ? ROLE_META[p.role].hue : "var(--muted)",
      background: p?.avatar_url ? undefined : `linear-gradient(135deg, hsl(${h} 80% 68%), hsl(${(h + 50) % 360} 75% 60%))`,
    }} title={name}>
      {p?.avatar_url ? <img src={p.avatar_url} alt="" draggable={false} /> : initials(name)}
      {status && status !== "off" && <i className={`dot ${status}`} />}
    </span>
  );
}

export function AvatarStack({ people, size = 28, max = 4 }: { people: (Profile | undefined)[]; size?: number; max?: number }) {
  const list = people.filter(Boolean) as Profile[];
  return (
    <span className="avatar-stack">
      {list.slice(0, max).map((p) => <Avatar key={p.id} p={p} size={size} />)}
      {list.length > max && <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.36 }}>+{list.length - max}</span>}
    </span>
  );
}
