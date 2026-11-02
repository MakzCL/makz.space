import { SK_PATHS, SK_VIEWBOX } from "../components/Logo";

/** Kimera "K": the SK blade geometry — a cut, slanted stem plus the SK arm. */
export const K_PATHS = [
  "M178 66 L302 66 L236 330 C224 380 186 412 132 412 L92 412 Z",
  "M282 238 L572 72 C578 69 584 68 590 68 L682 68 C692 68 694 78 686 83 L458 238 L564 412 L448 412 C434 412 424 406 418 396 Z",
];

/** App mark: white K on a violet tile (icons, sign-in, Factory link). */
export function KimeraMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="k-mark" width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <defs><linearGradient id="kgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8366ff" /><stop offset="1" stopColor="#5a36e0" /></linearGradient></defs>
      <rect width="512" height="512" rx="112" fill="url(#kgrad)" />
      <g transform="translate(18 108) scale(0.61)" fill="#fff">{K_PATHS.map((d) => <path key={d} d={d} />)}</g>
    </svg>
  );
}

/** Header lockup: the Skalarki SK in brand red, then "Kimera". */
export function SkKimera({ height = 26 }: { height?: number }) {
  return (
    <span className="k-lockup">
      <svg viewBox={SK_VIEWBOX} height={height} width={height * 2.28} aria-label="Skalarki">{SK_PATHS.map((d) => <path key={d} d={d} fill="#e3342f" />)}</svg>
      <b>Kimera</b>
    </span>
  );
}
