import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "../app/store";

type Health = Awaited<ReturnType<ReturnType<typeof useStore>["api"]["health"]>>;

/** Problems QUASAR can see and the user can fix, with the fix attached. */
export function HealthNotes() {
  const { api, toast } = useStore();
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    if (!api.desktop) return;
    let alive = true;
    const tick = () => api.health().then((x) => alive && setH(x)).catch(() => {});
    tick();
    const t = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [api]);
  if (!h) return null;
  const notes = [];
  if (h.other_openrgb > 0)
    notes.push(
      <div key="dup" className="card pad row" style={{ gap: 12, alignItems: "flex-start", borderColor: "rgba(255,181,71,.4)" }}>
        <AlertTriangle size={18} color="var(--amber)" style={{ flex: "none", marginTop: 2 }} />
        <div style={{ fontSize: 13 }}>
          <b>Another OpenRGB is running.</b>{" "}
          <span className="muted">
            QUASAR runs its own copy. Two copies fight over the same devices, so devices go missing or ignore colours. Close the other OpenRGB, including from the system tray (right-click → Exit), then press Rescan.
          </span>
        </div>
      </div>,
    );
  if (h.smbus === "needs-admin")
    notes.push(
      <div key="admin" className="card pad row" style={{ gap: 12, alignItems: "flex-start" }}>
        <ShieldCheck size={18} color="var(--ion)" style={{ flex: "none", marginTop: 2 }} />
        <div style={{ fontSize: 13, flex: 1 }}>
          <b>RAM lighting is hidden.</b>{" "}
          <span className="muted">Memory (and some motherboard) lighting sits on a bus Windows only opens to administrators. Restart QUASAR as administrator once; Windows will ask to confirm.</span>
        </div>
        <button className="btn sm primary" onClick={() => api.relaunchElevated().catch((e) => toast(String(e)))}>
          Restart as administrator
        </button>
      </div>,
    );
  if (h.smbus === "pawnio-missing")
    notes.push(
      <div key="pawn" className="card pad row" style={{ gap: 12, alignItems: "flex-start" }}>
        <ShieldCheck size={18} color="var(--ion)" style={{ flex: "none", marginTop: 2 }} />
        <div style={{ fontSize: 13, flex: 1 }}>
          <b>RAM lighting needs the PawnIO driver.</b>{" "}
          <span className="muted">OpenRGB reads memory lighting through PawnIO, a small signed driver. Install it from pawnio.eu, then restart QUASAR as administrator.</span>
        </div>
        <a className="btn sm" href="https://pawnio.eu" target="_blank" rel="noreferrer">pawnio.eu</a>
        {!h.elevated && (
          <button className="btn sm primary" onClick={() => api.relaunchElevated().catch((e) => toast(String(e)))}>
            Restart as administrator
          </button>
        )}
      </div>,
    );
  if (!notes.length) return null;
  return <div className="col" style={{ gap: 10, marginBottom: 16 }}>{notes}</div>;
}
