import { useMemo, useState } from "react";
import { ChannelType, isVoiceType } from "@syndo/shared";
import { navigate } from "../router.ts";
import { displayName, dmTitle, useStore } from "../store.ts";
import { Modal } from "./ui.tsx";

/** Ctrl/Cmd+K: jump to any channel, conversation or server by name. */
export function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const guilds = useStore((s) => s.guilds);
  const dms = useStore((s) => s.dms);
  const [q, setQ] = useState(""); const [i, setI] = useState(0);
  const items = useMemo(() => {
    const out: { label: string; sub: string; href: string }[] = [];
    for (const c of Object.values(dms)) out.push({ label: c.type === ChannelType.DM ? displayName(c.recipients?.[0]) : dmTitle(c), sub: "Direct message", href: `/channels/@me/${c.id}` });
    for (const g of Object.values(guilds)) {
      out.push({ label: g.name, sub: "Server", href: `/channels/${g.id}` });
      for (const c of g.channels) if (c.type !== ChannelType.CATEGORY) out.push({ label: `${isVoiceType(c.type) ? "🔊 " : "#"}${c.name}`, sub: g.name, href: `/channels/${g.id}/${c.id}` });
    }
    const n = q.toLowerCase();
    return out.filter((x) => !n || x.label.toLowerCase().includes(n)).slice(0, 12);
  }, [guilds, dms, q]);
  const go = (href: string) => { navigate(href); onClose(); };
  return (
    <Modal title="Jump to" onClose={onClose}>
      <input autoFocus value={q} placeholder="Where would you like to go?" aria-label="Search channels and conversations" aria-controls="qs-list"
        onChange={(e) => { setQ(e.target.value); setI(0); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === "Enter" && items[i]) go(items[i]!.href); }} />
      <ul id="qs-list" className="qs" role="listbox">
        {items.map((x, k) => <li key={x.href} role="option" aria-selected={k === i}><button className={k === i ? "active" : ""} onClick={() => go(x.href)}><span className="ellipsis">{x.label}</span><small className="muted">{x.sub}</small></button></li>)}
      </ul>
    </Modal>
  );
}
