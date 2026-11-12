// What each SK Suite application can actually read and write today. Levels are claims backed by the listed tests;
// "unsupported" entries are listed on purpose so a file is recognised and the user is told the truth.
import { Registry, type Adapter } from "./registry.ts";

const none = (id: string, app: Adapter["app"], formats: Adapter["formats"], label: string, why: string): Adapter =>
  ({ id, app, formats, label, read: "unsupported", write: "unsupported", versionsVerified: [], preserves: [], unsupported: ["everything"], limitations: [why], tests: [] });

export const ADAPTERS: Adapter[] = [
  // ---------------- TROTAN
  { id: "trotan.svg", app: "trotan", formats: ["svg", "svgz"], label: "SVG / SVGZ", read: "verified-round-trip", write: "verified-round-trip", versionsVerified: ["SVG 1.1 / 2 geometry"],
    preserves: ["paths (all commands, arcs converted to curves)", "rect/circle/ellipse/line/polyline/polygon", "groups and nested transforms", "<use> references", "embedded (data URI) images", "viewBox and physical units (mm, cm, in, pt, px at 96/in)", "stroke colour → layer"],
    unsupported: ["text elements (skipped and reported; convert to outlines first)", "linked images (skipped and reported)", "clip paths, masks, patterns, gradients, filters, markers (not applied)"],
    limitations: ["Each skipped element type is counted in the import notes"], tests: ["factory/tests/trotan/geom.test.ts: SVG import keeps real size…; SVG export → import round trip", "factory/tests/trotan/e2e.mjs step 3", "factory/tests/trotan/import.e2e.mjs (SVGZ; review of skipped text)"] },
  { id: "trotan.dxf", app: "trotan", formats: ["dxf"], label: "DXF (ASCII)", read: "verified-round-trip", write: "verified-round-trip", versionsVerified: ["R12–2018 ASCII"],
    preserves: ["LINE, LWPOLYLINE/POLYLINE with bulges, CIRCLE, ARC, ELLIPSE, SPLINE (as curves)", "blocks via INSERT", "$INSUNITS units (mm assumed and reported when missing)", "layers"], unsupported: ["TEXT/MTEXT", "DIMENSION", "HATCH", "SOLID", "POINT (all skipped and reported)"],
    limitations: ["Binary DXF is not read"], tests: ["factory/tests/trotan/geom.test.ts: DXF import: units, bulges, circles…; export → import round trip"] },
  { id: "trotan.raster", app: "trotan", formats: ["png", "jpeg", "bmp", "gif", "webp"], label: "Raster images", read: "partial-import", write: "unsupported", versionsVerified: ["PNG, GIF, WebP (tested)"],
    preserves: ["pixels (downscaled above 4000 px, with a warning)", "placed at 96 DPI with the size shown"], unsupported: ["embedded DPI", "colour profiles", "animation (first GIF frame only)"],
    limitations: ["JPEG and BMP use the browser's decoder and are not covered by an automated test yet"], tests: ["factory/tests/trotan/raster.e2e.mjs (PNG)", "factory/tests/trotan/import.e2e.mjs (GIF, WebP, renamed PNG)"] },
  { id: "trotan.project", app: "trotan", formats: ["trotan-project"], label: "TROTAN project", read: "verified-round-trip", write: "verified-round-trip", versionsVerified: ["format trotan v1"],
    preserves: ["everything in the TROTAN document"], unsupported: [], limitations: [], tests: ["factory/tests/trotan/geom.test.ts: project file: versioned, validated", "factory/tests/trotan/e2e.mjs step 7"] },
  none("trotan.cdr", "trotan", ["cdr", "cdt"], "CorelDRAW CDR / CDT", "Recognised with its version. Geometry import is the next milestone (see docs/SK_FILE_INTEROPERABILITY.md)."),
  none("trotan.cmx", "trotan", ["cmx"], "Corel CMX", "Recognised. Import planned with CDR."),
  none("trotan.pdf", "trotan", ["pdf", "ai"], "PDF / PDF-based Illustrator", "Recognised with its version. Vector import planned (needs a PDF content-stream interpreter)."),
  none("trotan.eps", "trotan", ["eps"], "EPS / PostScript Illustrator", "Recognised. Needs a PostScript interpreter; not planned in-browser."),
  none("trotan.tiff", "trotan", ["tiff"], "TIFF", "Recognised. Browsers cannot decode TIFF; needs a TIFF decoder."),
  none("trotan.psd", "trotan", ["psd"], "Photoshop PSD", "Recognised. Layered PSD import is an advanced, later feature."),
  none("trotan.hpgl", "trotan", ["hpgl"], "HPGL / PLT", "Recognised by content. Import planned (simple pen-plot commands)."),
  none("trotan.dwg", "trotan", ["dwg"], "DWG", "Recognised with its release. Needs a licensed DWG library (ODA or RealDWG)."),
  // ---------------- CADRA
  { id: "cadra.dxf", app: "cadra", formats: ["dxf"], label: "DXF (ASCII)", read: "verified-round-trip", write: "verified-round-trip", versionsVerified: ["writes R12 (AC1009); reads R12–R2018 ASCII"],
    preserves: ["LINE, CIRCLE, ARC, LWPOLYLINE, POLYLINE, TEXT, MTEXT, HATCH (polyline paths), DIMENSION (linear/aligned/radius/diameter)", "BLOCK/INSERT", "layers with colours", "$INSUNITS"],
    unsupported: ["splines", "bulges in LWPOLYLINE (drawn straight, reported)", "angular/ordinate dimensions", "3D entities"], limitations: ["Binary DXF is not read"],
    tests: ["cadra/tests/dxf.test.ts", "cadra/tests/blocks.test.ts", "cadra/tests/tools/check_dxf.py (ezdxf, 0 errors)", "cadra/tests/e2e/draft.mjs"] },
  { id: "cadra.native", app: "cadra", formats: ["cadra-drawing"], label: "CADRA drawing", read: "verified-round-trip", write: "verified-round-trip", versionsVerified: ["format cadra v1"], preserves: ["everything"], unsupported: [], limitations: [], tests: ["cadra/tests/dxf.test.ts: native format"] },
  none("cadra.dwg", "cadra", ["dwg"], "DWG", "Needs a licensed DWG SDK (ODA Drawings SDK or Autodesk RealDWG). A DXF parser is not DWG support."),
  none("cadra.step", "cadra", ["step", "iges"], "STEP / IGES", "Needs a B-rep kernel (Open CASCADE). Planned with CADRA solid modelling."),
  none("cadra.mesh", "cadra", ["stl", "stl-binary", "3mf"], "STL / 3MF", "Planned with the CADRA 3D viewport."),
  none("cadra.proprietary", "cadra", ["ole-cad", "f3d"], "SolidWorks / Inventor / Fusion", "Proprietary parametric formats. Even with a licensed reader, the feature tree would not be reconstructed — only solid bodies."),
  // ---------------- NUCLEUS
  { id: "nucleus.native", app: "nucleus", formats: ["nucleus-project"], label: "NUCLEUS project", read: "verified-round-trip", write: "verified-round-trip", versionsVerified: ["schema 1"], preserves: ["schematic, PCB, simulation settings"], unsupported: [], limitations: [], tests: ["nucleus/tests/core.test.ts (round-trip, tamper)", "nucleus/tests/e2e/pcb.mjs step 9"] },
  none("nucleus.proteus", "nucleus", ["proteus-legacy", "proteus-project"], "Proteus DSN / LYT / PDSPRJ", "Undocumented proprietary formats with no authorised parser. Migration path: export a netlist or Gerber from Proteus. Gerber is manufacturing artwork, not an editable project."),
  // ---------------- KORTANA / SK Factory
  { id: "kortana.csv", app: "kortana", formats: ["csv"], label: "CSV (stock import, report exports)", read: "partial-import", write: "partial-import", versionsVerified: [],
    preserves: ["rows with column matching by header aliases"], unsupported: ["schema validation report", "duplicate detection report"], limitations: ["Implemented in Inventory import and report exports; not covered by an automated test yet"], tests: [] },
  none("kortana.xlsx", "kortana", ["xlsx"], "Excel XLSX", "Recognised. Needs an XLSX reader."),
];

export const defaultRegistry = () => { const r = new Registry(); for (const a of ADAPTERS) r.register(a); return r; };
