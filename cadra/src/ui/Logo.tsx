// CADRA mark: a drafting arc and a dimension line on a rounded tile (favicon-style, like the other suite apps).
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0e1440" />
      <path d="M44 18a20 20 0 1 0 0 28" fill="none" stroke="#5ec8ff" strokeWidth="7" strokeLinecap="round" />
      <path d="M30 32h22M48 27v10" stroke="#f0b54a" strokeWidth="4" strokeLinecap="round" />
      <circle cx="30" cy="32" r="3.5" fill="#f0b54a" />
    </svg>
  );
}
