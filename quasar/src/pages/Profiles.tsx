import { motion } from "motion/react";
import { Check, Copy, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useStore } from "../app/store";
import { EffectThumb } from "../components/EffectThumb";
import { Swatch } from "../components/controls";
import type { Profile } from "../lib/types";

export function Profiles() {
  const { snap, setSnap, api, toast } = useStore();
  const save = async (p: Profile) => setSnap(await api.saveProfile(p));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{snap.settings.auto_switch ? "Auto-switch on" : "Auto-switch off"}</div>
          <h1>Profiles</h1>
          <p>A profile is a lighting scene plus every device's settings. Link apps and QUASAR switches when they start.</p>
        </div>
        <div className="spacer" />
        <button
          className="btn primary"
          onClick={async () => {
            const base = snap.profiles.find((p) => p.id === snap.active_profile)!;
            await save({ ...structuredClone(base), id: `p-${Date.now().toString(36)}`, name: "New profile", apps: [], accent: "#2eff8c" });
            toast("Profile created");
          }}
        >
          <Plus size={15} /> New profile
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
        {snap.profiles.map((p, i) => (
          <ProfileCard key={p.id} p={p} i={i} active={p.id === snap.active_profile} onSave={save} />
        ))}
      </div>
    </div>
  );
}

function ProfileCard({ p, i, active, onSave }: { p: Profile; i: number; active: boolean; onSave: (p: Profile) => void }) {
  const { api, setSnap, toast } = useStore();
  const [app, setApp] = useState("");
  const top = p.scene.layers.find((l) => l.enabled);
  return (
    <motion.div className="card" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} style={{ overflow: "hidden", borderColor: active ? p.accent : undefined, boxShadow: active ? `0 0 40px -18px ${p.accent}` : undefined }}>
      <div style={{ position: "relative", height: 110 }}>
        {top ? <EffectThumb effect={top.effect} params={top.params} w={96} h={32} className="fill" /> : null}
        <style>{`.fill{width:100%;height:100%;display:block}`}</style>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg,transparent,rgba(17,17,28,.95))" }} />
        <div className="row" style={{ position: "absolute", left: 16, right: 16, bottom: 10 }}>
          <Swatch value={p.accent} onChange={(c) => onSave({ ...p, accent: c })} />
          <input className="input" style={{ flex: 1, background: "transparent", border: 0, fontWeight: 700, fontSize: 17, padding: 0 }} defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && onSave({ ...p, name: e.target.value })} />
          {active ? (
            <span className="badge live">Active</span>
          ) : (
            <button className="btn sm" onClick={async () => setSnap(await api.activateProfile(p.id))}>
              <Check size={13} /> Use
            </button>
          )}
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <div className="label" style={{ marginBottom: 8 }}>Linked apps</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {p.apps.map((a) => (
            <span key={a} className="badge" style={{ height: 26, fontSize: 12, fontFamily: "var(--mono)" }}>
              {a}
              <X size={12} style={{ cursor: "pointer" }} onClick={() => onSave({ ...p, apps: p.apps.filter((x) => x !== a) })} />
            </span>
          ))}
          {!p.apps.length && <span className="dim" style={{ fontSize: 12 }}>Manual only</span>}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (app.trim()) onSave({ ...p, apps: [...p.apps, app.trim()] });
            setApp("");
          }}
        >
          <input className="input" style={{ flex: 1, height: 32 }} placeholder="game.exe" value={app} onChange={(e) => setApp(e.target.value)} />
          <button className="btn sm" type="submit"><Plus size={13} /> Link</button>
        </form>
        <div className="sep" />
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="dim" style={{ fontSize: 12 }}>{p.scene.layers.length} {p.scene.layers.length === 1 ? "layer" : "layers"} · {Math.round(p.brightness * 100)}% brightness</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn sm icon ghost" aria-label="Duplicate" onClick={() => onSave({ ...structuredClone(p), id: `p-${Date.now().toString(36)}`, name: `${p.name} copy` })}><Copy size={14} /></button>
            <button
              className="btn sm icon ghost danger"
              aria-label="Delete"
              onClick={async () => {
                try {
                  setSnap(await api.deleteProfile(p.id));
                } catch (e) {
                  toast(String(e));
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
