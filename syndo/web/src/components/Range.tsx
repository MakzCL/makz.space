import type { CSSProperties, InputHTMLAttributes } from "react";

/** Keep native range semantics and keyboard behaviour, replace only its skin. */
export function Range({ style, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const min = Number(props.min ?? 0), max = Number(props.max ?? 100), value = Number(props.value ?? props.defaultValue ?? min);
  const progress = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  return <input {...props} type="range" className={`send-range ${props.className ?? ""}`} style={{ ...style, "--range-progress": `${progress}%` } as CSSProperties} />;
}
