import { useRef } from "react";

/** A 270° arc dial, dragged around its centre. Value 0..1. */
export function Dial({ value, onChange, onCommit, label }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; label: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const R = 88, C = 105, START = 135, SWEEP = 270;
  const pt = (deg: number, r = R) => {
    const a = (deg * Math.PI) / 180;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const arc = (from: number, to: number) => {
    const [x0, y0] = pt(from), [x1, y1] = pt(to);
    return `M${x0} ${y0} A${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const end = START + SWEEP * value;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    const a = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    let d = (a - START + 360) % 360;
    if (d > SWEEP) d = d - SWEEP < (360 - SWEEP) / 2 ? SWEEP : 0;
    return Math.round((d / SWEEP) * 100) / 100;
  };
  let last = value;
  const ticks = Array.from({ length: 28 }, (_, i) => START + (SWEEP * i) / 27);
  const [kx, ky] = pt(end);
  return (
    <div className="dial">
      <svg
        ref={ref}
        viewBox="0 0 210 210"
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(value * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onChange((last = at(e)));
        }}
        onPointerMove={(e) => e.buttons && onChange((last = at(e)))}
        onPointerUp={() => onCommit?.(last)}
        onKeyDown={(e) => {
          const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.05 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.05 : 0;
          if (d) {
            const v = Math.min(1, Math.max(0, +(value + d).toFixed(2)));
            onChange(v);
            onCommit?.(v);
          }
        }}
      >
        {ticks.map((t, i) => {
          const [x0, y0] = pt(t, 100), [x1, y1] = pt(t, i % 3 === 0 ? 93 : 96);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={t <= end ? "#2ee6ff" : "rgba(255,255,255,.18)"} strokeWidth="1" />;
        })}
        <path d={arc(START, START + SWEEP)} stroke="rgba(255,255,255,.08)" strokeWidth="6" fill="none" />
        {value > 0 && <path d={arc(START, end)} stroke="#2ee6ff" strokeWidth="6" fill="none" style={{ filter: "drop-shadow(0 0 6px #2ee6ff)" }} />}
        <circle cx={kx} cy={ky} r="7" fill="#05070a" stroke="#e9fbff" strokeWidth="2" />
      </svg>
      <div className="val">
        <b>{Math.round(value * 100)}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}
