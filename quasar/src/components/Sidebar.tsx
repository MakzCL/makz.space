import { motion } from "motion/react";
import { Boxes, Command, Gauge, Layers, Palette, Plug, Settings2, Sparkles, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useStore, type Route } from "../app/store";
import { kindIcon } from "./icons";

function Item({ icon, label, active, onClick, right }: { icon: ReactNode; label: string; active: boolean; onClick: () => void; right?: ReactNode }) {
  return (
    <button className={`nav${active ? " on" : ""}`} onClick={onClick}>
      {active && <motion.span layoutId="nav-pill" className="pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
      {icon}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {right}
    </button>
  );
}

export function Sidebar() {
  const { route, go, snap } = useStore();
  const is = (p: Route["page"], id?: string) => route.page === p && (!id || (route.page === "device" && route.id === id));
  return (
    <nav className="sidebar">
      <Item icon={<Gauge size={17} />} label="Rig" active={is("rig")} onClick={() => go({ page: "rig" })} right={<span className="count">{snap.devices.length}</span>} />
      <Item icon={<Layers size={17} />} label="Lighting Studio" active={is("studio")} onClick={() => go({ page: "studio" })} />
      <Item icon={<Sparkles size={17} />} label="Effects" active={is("library")} onClick={() => go({ page: "library" })} />
      <Item icon={<Command size={17} />} label="Macros" active={is("macros")} onClick={() => go({ page: "macros" })} right={<span className="count">{snap.macros.length}</span>} />
      <Item icon={<UserRound size={17} />} label="Profiles" active={is("profiles")} onClick={() => go({ page: "profiles" })} />
      <Item icon={<Plug size={17} />} label="Integrations" active={is("integrations")} onClick={() => go({ page: "integrations" })} />

      <div className="group">Devices</div>
      {snap.devices.map((d) => {
        const Icon = kindIcon[d.info.kind] ?? Boxes;
        return <Item key={d.info.id} icon={<Icon size={16} />} label={d.info.name} active={is("device", d.info.id)} onClick={() => go({ page: "device", id: d.info.id })} />;
      })}
      {!snap.devices.length && <div className="dim" style={{ padding: "4px 10px", fontSize: 12 }}>No devices yet</div>}

      <div className="foot">
        <Item icon={<Settings2 size={17} />} label="Settings" active={is("settings")} onClick={() => go({ page: "settings" })} />
        <Item icon={<Palette size={17} />} label={`v${snap.version} · ${snap.platform}`} active={false} onClick={() => go({ page: "settings" })} />
      </div>
    </nav>
  );
}
