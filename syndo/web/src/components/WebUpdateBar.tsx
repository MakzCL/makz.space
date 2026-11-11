import { RefreshCw } from "lucide-react";
import { desktop } from "../desktop.ts";
import { applyWebUpdate, useWebUpdate } from "../webUpdate.ts";

/** A new web build is live. The desktop app shows its green title-bar button instead (see DesktopTitlebar). */
export function WebUpdateBar() {
  const ready = useWebUpdate();
  if (!ready || (desktop?.capabilities.customTitlebar && desktop.windowControl)) return null;
  return (
    <div className="web-update-bar" role="status">
      <span>A new version of SEND is ready.</span>
      <button className="btn sm primary" onClick={applyWebUpdate}><RefreshCw size={14} /> Update</button>
    </div>
  );
}
