// Parses SVG/DXF off the main thread so large files never freeze the editor.
import { importSvg } from "../geom/svg";
import { importDxf } from "../geom/dxf";
self.onmessage = (e: MessageEvent<{ kind: "svg" | "dxf"; text: string }>) => {
  try {
    const r = e.data.kind === "svg" ? importSvg(e.data.text) : importDxf(e.data.text);
    (self as unknown as Worker).postMessage({ ok: true, result: r });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
