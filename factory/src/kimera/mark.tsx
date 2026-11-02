import { K_PATHS, KLogo } from "../components/Logo";
export { K_PATHS };

/** App mark: the same navy tile as the Skalarki icon, with the violet→berry K. */
export function KimeraMark({ size = 30 }: { size?: number }) {
  return <img className="k-mark" src="/kimera.svg" width={size} height={size} alt="" />;
}

/** Header lockup: the Kimera K, then "Kimera". */
export function SkKimera({ height = 24 }: { height?: number }) {
  return <span className="k-lockup"><KLogo size={height} /><b>Kimera</b></span>;
}
