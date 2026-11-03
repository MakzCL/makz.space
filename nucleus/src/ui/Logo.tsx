// NUCLEUS mark: an original hexagonal cell with a solid core and one orbit. Flat, single colour.
export function Logo({ size = 22, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2.5 27.7 9.25v13.5L16 29.5 4.3 22.75V9.25Z" fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <ellipse cx="16" cy="16" rx="8.6" ry="3.6" fill="none" stroke={color} strokeWidth="1.6" transform="rotate(-30 16 16)" />
      <circle cx="16" cy="16" r="3.1" fill={color} />
    </svg>
  );
}
