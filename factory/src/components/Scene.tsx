import { motion } from "motion/react";
import type { ReactNode } from "react";

export type SceneKind = "factory" | "line" | "clock" | "lighthouse" | "warehouse" | "town" | "peaks" | "chart";

type Sky = { top: string; mid: string; low: string; sun: string; night: boolean; sunY: number };
function skyFor(h: number): Sky {
  if (h < 5 || h >= 21) return { top: "#070b2e", mid: "#141b55", low: "#2a2f7a", sun: "#f3e6c8", night: true, sunY: 52 };
  if (h < 8) return { top: "#141a5a", mid: "#5a3a86", low: "#f07a62", sun: "#ffe0c2", night: false, sunY: 128 };
  if (h < 17) return { top: "#1c2a86", mid: "#4058c4", low: "#f6a493", sun: "#fff1e4", night: false, sunY: 70 };
  return { top: "#121858", mid: "#6b3584", low: "#ee5b4a", sun: "#ffd2b4", night: false, sunY: 118 };
}

/** Flat, layered illustrations — the hero art for each screen. */
export function Scene({ kind = "factory", height = 190, hour, children, seed = 0, shift }: {
  kind?: SceneKind; height?: number; hour?: number; children?: ReactNode; seed?: number;
  /** Push the main subject right so a title on the left stays readable. */
  shift?: boolean;
}) {
  const push = shift ?? !!children;
  const s = skyFor(hour ?? new Date().getHours());
  const id = `sc-${kind}-${seed}`;
  const sx = (shift ?? !!children) ? 330 : 280 - (seed % 5) * 40;
  return (
    <div className="scene" style={{ height }}>
      <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMax slice" aria-hidden>
        <defs>
          <linearGradient id={`${id}-sky`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={s.top} /><stop offset="0.55" stopColor={s.mid} /><stop offset="1" stopColor={s.low} />
          </linearGradient>
        </defs>
        <rect width="400" height="220" fill={`url(#${id}-sky)`} />
        {s.night && [[40, 30], [90, 60], [150, 22], [210, 48], [330, 30], [370, 70], [250, 18], [120, 90]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 ? 1.2 : 1.8} fill="#fff" className="twinkle" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}
        {s.night ? (
          <g transform={`translate(${sx} ${s.sunY})`}>
            <circle r="18" fill={s.sun} />
            <circle r="16" cx="8" cy="-5" fill={s.top} />
          </g>
        ) : (
          <g>
            <circle cx={sx} cy={s.sunY} r="38" fill={s.sun} opacity="0.18" />
            <circle cx={sx} cy={s.sunY} r="24" fill={s.sun} />
          </g>
        )}
        {/* far ridge */}
        <path d="M0 150 L40 118 L78 140 L120 96 L165 136 L205 112 L250 142 L300 100 L345 132 L400 108 L400 220 L0 220Z" fill="#2c3184" opacity="0.85" />
        <path d="M0 168 C60 140 110 150 160 160 C220 172 270 142 330 148 C365 152 385 160 400 156 L400 220 L0 220Z" fill="#1d2268" />
        <g transform={push ? "translate(78 14) scale(0.92)" : undefined}><Foreground kind={kind} /></g>
        {!s.night && (
          <motion.path d="M0 0 q5 -5 10 0 q5 -5 10 0" stroke="#10133f" strokeWidth="2" fill="none" strokeLinecap="round"
            initial={{ x: 60, y: 60 }} animate={{ x: [60, 150, 230], y: [60, 46, 58] }}
            transition={{ duration: 14, repeat: Infinity, ease: "linear" }} />
        )}
        <path d="M0 196 C80 178 150 188 220 194 C290 200 340 182 400 186 L400 220 L0 220Z" fill="#11164a" />
      </svg>
      {children && <div className="scene-over">{children}</div>}
    </div>
  );
}

const DARK = "#141947";
const MID = "#1a2060";
const LIGHT_ON = "#ffd18a";

function Windows({ x, y, cols, rows, gap = 9 }: { x: number; y: number; cols: number; rows: number; gap?: number }) {
  const out: ReactNode[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const lit = (r * 7 + c * 3) % 4 !== 0;
    out.push(<rect key={`${r}-${c}`} x={x + c * gap} y={y + r * 9} width="5" height="4" rx="1" fill={lit ? LIGHT_ON : "#2b3176"} className={lit && (r + c) % 5 === 0 ? "flicker" : undefined} />);
  }
  return <>{out}</>;
}

function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <g className="smoke">
      {[0, 1, 2].map((i) => <circle key={i} cx={x} cy={y} r={5 + i * 2} fill="#fff" opacity="0.14" style={{ animationDelay: `${i * 1.3}s` }} />)}
    </g>
  );
}

function Foreground({ kind }: { kind: SceneKind }) {
  switch (kind) {
    case "factory":
      return (
        <g>
          <rect x="196" y="74" width="12" height="70" fill={DARK} /><rect x="194" y="70" width="16" height="6" fill="#e3342f" />
          <Smoke x={202} y={62} />
          <path d="M120 186 L120 130 L150 112 L150 130 L180 112 L180 130 L210 112 L210 130 L240 112 L240 130 L270 112 L270 186Z" fill={DARK} />
          <Windows x={130} y={142} cols={15} rows={3} />
          <rect x="280" y="140" width="56" height="46" fill={MID} /><Windows x={286} y={148} cols={6} rows={3} />
          <rect x="62" y="150" width="48" height="36" fill={MID} /><rect x="76" y="168" width="18" height="18" fill="#e3342f" />
        </g>
      );
    case "line":
      return (
        <g>
          <rect x="60" y="150" width="280" height="10" rx="5" fill={DARK} />
          {[80, 130, 180, 230, 280, 320].map((x) => <circle key={x} cx={x} cy="155" r="4" fill="#2e3486" />)}
          <g className="belt">{[90, 160, 230, 300].map((x) => <rect key={x} x={x} y="132" width="26" height="18" rx="3" fill={x === 160 ? "#e3342f" : "#e9e6f5"} />)}</g>
          <rect x="190" y="88" width="10" height="44" fill={DARK} /><rect x="176" y="84" width="38" height="10" rx="3" fill={DARK} /><path d="M188 132 l7 8 l7 -8z" fill="#e3342f" />
        </g>
      );
    case "clock":
      return (
        <g>
          <rect x="176" y="70" width="48" height="120" fill={DARK} /><path d="M170 72 L200 40 L230 72Z" fill={MID} />
          <circle cx="200" cy="98" r="16" fill="#f4efe6" /><line x1="200" y1="98" x2="200" y2="88" stroke={DARK} strokeWidth="2.5" strokeLinecap="round" className="hand-m" />
          <line x1="200" y1="98" x2="207" y2="98" stroke="#e3342f" strokeWidth="2.5" strokeLinecap="round" />
          <Windows x={186} y={126} cols={3} rows={5} gap={11} />
          <rect x="110" y="150" width="50" height="40" fill={MID} /><rect x="240" y="140" width="60" height="50" fill={MID} />
          <Windows x={248} y={148} cols={5} rows={3} />
        </g>
      );
    case "lighthouse":
      return (
        <g>
          <path d="M150 190 L250 190 L236 176 L164 176Z" fill={MID} />
          <path d="M186 176 L192 92 L208 92 L214 176Z" fill="#f4efe6" />
          <path d="M188 150 L212 150 L213 162 L187 162Z M190 118 L210 118 L211 130 L189 130Z" fill="#e3342f" />
          <rect x="188" y="78" width="24" height="14" fill={DARK} /><rect x="192" y="81" width="16" height="8" fill={LIGHT_ON} />
          <path d="M186 78 L200 66 L214 78Z" fill="#e3342f" />
          <path className="beam" d="M208 85 L400 50 L400 120Z" fill={LIGHT_ON} opacity="0.16" />
        </g>
      );
    case "warehouse":
      return (
        <g>
          <path d="M110 186 L110 120 L200 92 L290 120 L290 186Z" fill={DARK} />
          <rect x="170" y="140" width="60" height="46" fill={MID} />
          {[0, 1, 2, 3].map((i) => <line key={i} x1="170" x2="230" y1={148 + i * 10} y2={148 + i * 10} stroke="#2a3080" strokeWidth="2" />)}
          <rect x="300" y="160" width="26" height="26" fill="#e3342f" /><rect x="326" y="168" width="18" height="18" fill="#f4efe6" /><rect x="306" y="140" width="18" height="20" fill="#f4efe6" />
          <rect x="70" y="166" width="22" height="20" fill="#f4efe6" /><rect x="92" y="172" width="14" height="14" fill="#e3342f" />
        </g>
      );
    case "town":
      return (
        <g>
          {[[70, 150, 40], [118, 136, 46], [172, 158, 36], [214, 128, 52], [274, 148, 40], [320, 160, 34]].map(([x, y, w], i) => (
            <g key={i}><rect x={x} y={y} width={w} height={190 - y} fill={i % 2 ? DARK : MID} /><path d={`M${x - 3} ${y} L${x + w / 2} ${y - 16} L${x + w + 3} ${y}Z`} fill={i === 3 ? "#e3342f" : DARK} />
              <Windows x={x + 7} y={y + 8} cols={Math.floor(w / 12)} rows={2} gap={12} /></g>
          ))}
        </g>
      );
    case "peaks":
      return (
        <g>
          <path d="M60 190 L150 90 L200 140 L240 100 L330 190Z" fill={DARK} />
          <path d="M150 90 L168 110 L156 108 L146 116 L136 106Z M240 100 L254 116 L242 114 L232 112Z" fill="#f4efe6" />
          <line x1="150" y1="90" x2="150" y2="62" stroke="#f4efe6" strokeWidth="2" /><path d="M150 62 L170 68 L150 75Z" fill="#e3342f" className="flag" />
        </g>
      );
    case "chart":
      return (
        <g>
          {[[90, 40], [130, 70], [170, 55], [210, 95], [250, 80], [290, 112]].map(([x, h], i) => (
            <rect key={i} x={x} y={186 - h} width="28" height={h} rx="4" fill={i === 5 ? "#e3342f" : i % 2 ? DARK : MID} />
          ))}
        </g>
      );
  }
}

/** Illustration with folder tabs cut into its lower edge. */
export function SceneTabs<T extends string>({ kind, value, tabs, onChange, height = 180, title, sub, actions }: {
  kind: SceneKind; value: T; tabs: { value: T; label: ReactNode; aria?: string }[]; onChange: (v: T) => void;
  height?: number; title?: ReactNode; sub?: ReactNode; actions?: ReactNode;
}) {
  return (
    <div className="scene-head">
      <Scene kind={kind} height={height} shift={!!title}>
        {actions && <div className="scene-actions">{actions}</div>}
        {title && <div className="scene-title"><h1>{title}</h1>{sub && <p>{sub}</p>}</div>}
      </Scene>
      <div className="folder-tabs" role="tablist">
        {tabs.map((t) => (
          <button type="button" key={t.value} role="tab" aria-selected={value === t.value} aria-label={t.aria} title={t.aria} className={value === t.value ? "on" : ""} onClick={() => onChange(t.value)}>
            {value === t.value && <motion.i layoutId={`ft-${kind}`} className="folder-on" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
