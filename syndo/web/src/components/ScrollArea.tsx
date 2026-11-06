import { useEffect, useId, useRef, useState, type HTMLAttributes, type PointerEvent, type ReactNode } from "react";

/** Native scrolling with a quiet, draggable beam instead of platform chrome. */
export function ScrollArea({ children, className = "", viewportClassName = "", ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; viewportClassName?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ y: number; top: number } | null>(null);
  const id = useId();
  const [active, setActive] = useState(false);
  const [metrics, setMetrics] = useState({ progress: 0, ratio: 1, height: 0 });
  const measure = () => {
    const el = viewport.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setMetrics({ progress: max > 0 ? Math.max(0, Math.min(1, el.scrollTop / max)) : 0, ratio: el.scrollHeight ? Math.min(1, el.clientHeight / el.scrollHeight) : 1, height: el.clientHeight - 16 });
  };
  const wake = () => {
    setActive(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!drag.current) setActive(false); }, 850);
  };
  useEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (content.current) observer.observe(content.current);
    return () => { observer.disconnect(); if (timer.current) clearTimeout(timer.current); };
  }, []);
  const fullLength = Math.min(96, Math.max(32, metrics.height * metrics.ratio));
  const length = active ? fullLength : Math.min(32, fullLength);
  const position = metrics.progress * Math.max(0, metrics.height - length);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const el = viewport.current;
    if (!el || !drag.current) return;
    el.scrollTop = drag.current.top + (event.clientY - drag.current.y) / Math.max(1, metrics.height - fullLength) * (el.scrollHeight - el.clientHeight);
  };
  const release = () => { drag.current = null; wake(); };
  return <div className={`scroll-area ${className}`} data-scrolling={active || undefined}>
    <div {...props} id={props.id ?? id} className={`scroll-viewport ${viewportClassName}`} ref={viewport} onScroll={() => { measure(); wake(); }}>
      <div className="scroll-content" ref={content}>{children}</div>
    </div>
    {metrics.ratio < 1 && <div className="scroll-beam-track" ref={track} onPointerDown={(event) => {
      if (event.target !== event.currentTarget || !viewport.current) return;
      const rect = event.currentTarget.getBoundingClientRect();
      viewport.current.scrollTop = Math.max(0, Math.min(1, (event.clientY - rect.top - fullLength / 2) / Math.max(1, rect.height - fullLength))) * (viewport.current.scrollHeight - viewport.current.clientHeight);
      wake();
    }}>
      <div className="scroll-beam" role="scrollbar" aria-label="Scroll panel" aria-controls={props.id ?? id} aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(metrics.progress * 100)} tabIndex={0}
        style={{ height: length, transform: `translateY(${position}px)` }}
        onPointerDown={(event) => { event.preventDefault(); drag.current = { y: event.clientY, top: viewport.current?.scrollTop ?? 0 }; event.currentTarget.setPointerCapture(event.pointerId); wake(); }}
        onPointerMove={move} onPointerUp={release} onPointerCancel={release}
        onKeyDown={(event) => {
          const el = viewport.current;
          if (!el) return;
          const moves: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: el.clientHeight * .8, PageUp: -el.clientHeight * .8, Home: -el.scrollHeight, End: el.scrollHeight };
          if (event.key in moves) { event.preventDefault(); el.scrollTop += moves[event.key]; wake(); }
        }} />
    </div>}
  </div>;
}
