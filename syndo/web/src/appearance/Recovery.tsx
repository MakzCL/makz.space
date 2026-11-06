import { resetAppearance, setSafeMode, useAppearance } from "./store.ts";

/**
 * Always-available recovery. Rendered outside the themed app tree with
 * inline styles only, so no theme or custom CSS can hide or restyle it.
 */
const box: React.CSSProperties = {
  position: "fixed", zIndex: 2147483000, left: 12, bottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
  background: "#FFF6D6", color: "#141A2B", border: "2px solid #141A2B", borderRadius: 8, padding: "8px 12px", font: "600 14px system-ui, sans-serif", maxWidth: "calc(100vw - 24px)",
};
const btn: React.CSSProperties = { font: "700 14px system-ui, sans-serif", background: "#141A2B", color: "#FFFFFF", border: 0, borderRadius: 6, padding: "6px 10px", cursor: "pointer" };

export function RecoveryBanner() {
  const safe = useAppearance((s) => s.safeMode);
  if (!safe) return null;
  return (
    <div role="alert" style={box}>
      <span>Safe appearance mode — your themes are paused.</span>
      <button style={btn} onClick={() => resetAppearance("all")}>Reset appearance</button>
      <button style={{ ...btn, background: "#FFFFFF", color: "#141A2B", border: "2px solid #141A2B" }} onClick={() => setSafeMode(false)}>Exit safe mode</button>
    </div>
  );
}

/** Small button for screens where the user may not reach settings (sign-in, broken layouts). */
export function ResetAppearanceLink() {
  return (
    <button style={{ ...btn, background: "transparent", color: "inherit", border: "1px solid currentColor", opacity: 0.8 }}
      onClick={() => { setSafeMode(true); }} title="Pause custom appearance (Ctrl+Shift+Alt+R)">
      Reset appearance
    </button>
  );
}
