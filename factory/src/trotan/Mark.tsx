// TROTAN mark: an original geometric emblem (a beam striking a plate), not derived from any vendor's logo.
export function TrotanMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff7a2f" /><stop offset="1" stopColor="#ff2f5f" /></linearGradient></defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#11141b" />
      <path d="M18 18h28v7H35.5v21h-7V25H18z" fill="#f4f5f8" />
      <path d="M32 46l-9 8h18z" fill="url(#tg)" />
      <circle cx="32" cy="47" r="3.2" fill="#fff" />
    </svg>
  );
}
