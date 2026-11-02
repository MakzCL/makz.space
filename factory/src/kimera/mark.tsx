import { K_PATHS, KLogo } from "../components/Logo";
export { K_PATHS };

/** App mark: white K on a violet tile (icons, sign-in, Factory link). */
export function KimeraMark({ size = 30 }: { size?: number }) {
  return (
    <svg className="k-mark" width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <defs><linearGradient id="kgrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8366ff" /><stop offset="1" stopColor="#5a36e0" /></linearGradient></defs>
      <rect width="512" height="512" rx="112" fill="url(#kgrad)" />
      <g transform="translate(27 122) scale(0.56)" fill="#fff">{K_PATHS.map((d) => <path key={d} d={d} />)}</g>
    </svg>
  );
}

/** Header lockup: the Kimera K, then "Kimera". */
export function SkKimera({ height = 24 }: { height?: number }) {
  return <span className="k-lockup"><KLogo size={height} /><b>Kimera</b></span>;
}
