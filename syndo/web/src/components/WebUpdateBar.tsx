import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { applyWebUpdate, useWebUpdate } from "../webUpdate.ts";
import { desktop } from "../desktop.ts";

/** "A new version is ready" card. Roomy on phones, compact at the top of wider screens. "Later" hides it for this session. */
export function WebUpdateBar() {
  const ready = useWebUpdate();
  const [later, setLater] = useState(() => { try { return sessionStorage.getItem("send.update.later") === "1"; } catch { return false; } });
  if (!ready || later || (desktop?.capabilities.customTitlebar && desktop.windowControl)) return null;
  const dismiss = () => { setLater(true); try { sessionStorage.setItem("send.update.later", "1"); } catch { /* storage may be blocked */ } };
  return (
    <div className="web-update" role="status" aria-live="polite">
      <span className="web-update-ico" aria-hidden><Sparkles size={18} /></span>
      <div className="web-update-text"><strong>Update ready</strong><span>A new version of SEND is ready. Updating takes a second.</span></div>
      <div className="web-update-actions">
        <button className="btn ghost" onClick={dismiss}>Later</button>
        <button className="btn primary" onClick={applyWebUpdate}><RefreshCw size={15} /> Update now</button>
      </div>
    </div>
  );
}
