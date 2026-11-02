import { motion } from "motion/react";
import type { ReactNode } from "react";

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};
const angleOf = (d: Date) => (((d.getHours() % 12) * 60 + d.getMinutes() + d.getSeconds() / 60) / 720) * 360;

/** 12-hour clock dial with an arc from `from` to `to` — the shift at a glance. */
export function Dial({ from, to, size = 260, tone = "red", children, startIcon, endIcon }: {
  from: Date | null; to: Date; size?: number; tone?: "red" | "moon"; children?: ReactNode; startIcon?: ReactNode; endIcon?: ReactNode;
}) {
  const c = size / 2, R = c - 14, inner = R - 22;
  const a0 = from ? angleOf(from) : 0;
  let a1 = angleOf(to);
  let sweep = from ? (a1 - a0 + 360) % 360 : 0;
  if (from && to.getTime() - from.getTime() >= 12 * 3600e3) sweep = 359.9;
  a1 = a0 + sweep;
  const [x0, y0] = polar(c, c, R, a0), [x1, y1] = polar(c, c, R, a1);
  const arc = `M${x0} ${y0} A${R} ${R} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  const color = tone === "moon" ? "var(--moon)" : "var(--red)";
  return (
    <div className="dial" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={c} cy={c} r={R} fill="none" stroke="var(--surface-3)" strokeWidth="20" />
        <circle cx={c} cy={c} r={inner} fill="var(--bg)" />
        {Array.from({ length: 60 }, (_, i) => {
          const long = i % 5 === 0;
          const [ax, ay] = polar(c, c, inner - 6, i * 6), [bx, by] = polar(c, c, inner - (long ? 16 : 11), i * 6);
          return <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke={long ? "#c9cdeb" : "#454d8a"} strokeWidth={long ? 2 : 1} strokeLinecap="round" />;
        })}
        {[12, 3, 6, 9].map((n, i) => {
          const [x, y] = polar(c, c, inner - 30, i * 90);
          return <text key={n} x={x} y={y} textAnchor="middle" dominantBaseline="central" className="dial-num">{n}</text>;
        })}
        {from && sweep > 0.5 && (
          <motion.path d={arc} fill="none" stroke={color} strokeWidth="20" strokeLinecap="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.3, 0.7, 0.2, 1] }} />
        )}
      </svg>
      {from && <span className="dial-knob" style={{ left: x0, top: y0 }}>{startIcon}</span>}
      {from && <motion.span className="dial-knob end" style={{ left: x1, top: y1 }} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 1 }}>{endIcon}</motion.span>}
      <div className="dial-in">{children}</div>
    </div>
  );
}
