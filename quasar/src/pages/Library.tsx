import { motion } from "motion/react";
import { useState } from "react";
import { useStore } from "../app/store";
import { EffectThumb } from "../components/EffectThumb";
import { Seg } from "../components/controls";
import { defaults } from "./Studio";
import type { Category } from "../lib/types";

const CAT_COLOR: Record<Category, string> = { essentials: "var(--cyan)", ambient: "var(--violet)", reactive: "var(--pink)", audio: "var(--amber)", screen: "var(--green)", game: "var(--red)" };

export function Library() {
  const { library, profile, api, updateProfile, go, toast } = useStore();
  const [cat, setCat] = useState<"all" | Category>("all");
  const list = library.filter((e) => cat === "all" || e.category === cat);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{library.length} effects</div>
          <h1>Effects</h1>
          <p>Every effect runs across all your devices at once. Pick one to make it the base of “{profile.name}”.</p>
        </div>
      </div>
      <div style={{ marginBottom: 18 }}>
        <Seg value={cat} options={[["all", "All"], ["essentials", "Essentials"], ["ambient", "Ambient"], ["reactive", "Reactive"], ["audio", "Audio"], ["screen", "Screen"], ["game", "Game"]]} onChange={setCat} />
      </div>
      <div className="libgrid">
        {list.map((e, i) => (
          <motion.button
            key={e.id}
            className="card fxcard"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.025 }}
            onClick={() => {
              const scene = { layers: [{ id: `l${Date.now().toString(36)}`, effect: e.id, params: defaults(library, e.id), blend: "normal" as const, opacity: 1, enabled: true }] };
              api.setScene(scene);
              updateProfile((p) => ({ ...p, scene }));
              toast(`${e.name} applied to ${profile.name}`);
              go({ page: "studio" });
            }}
          >
            <EffectThumb effect={e.id} params={defaults(library, e.id)} w={96} h={54} />
            <div className="body">
              <div className="cat" style={{ color: CAT_COLOR[e.category] }}>{e.category}</div>
              <b>{e.name}</b>
              <p>{e.description}</p>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
