import type { OpType } from "../geom/core";
import type { OpParams } from "../geom/laser";
/** Safety-relevant settings that must equal the approved profile (the server checks the same keys). */
export const PARAM_KEYS = ["power", "speed", "freq", "passes", "focus", "dpi", "air"] as const;
export const sameParams = (op: OpType, a: Partial<OpParams> | undefined, b: Partial<OpParams> | undefined) =>
  !!a && !!b && PARAM_KEYS.every((k) => (k === "dpi" && op !== "raster") || (a[k] ?? null) === (b[k] ?? null));
