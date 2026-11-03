// TROTAN mark: the ecosystem "T" (same blade language as the SK and Kortana marks).
import { TLogo } from "../components/Logo";
export function TrotanMark({ size = 28, className }: { size?: number; bare?: boolean; className?: string }) {
  return <TLogo size={size} className={className} />;
}
