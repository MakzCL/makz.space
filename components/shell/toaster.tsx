"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";

import { motionPreset, spring } from "@/motion/system";
import { cx } from "@/lib/utils";

export type ToastTone = "neutral" | "signal" | "fault";

interface Toast {
  id: number;
  label: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastValue {
  notify: (input: { label: string; detail?: string; tone?: ToastTone }) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const LIFETIME = 4200;

/**
 * Notifications as ledger entries, not cards: a hairline rule, an index tick,
 * a monospaced label. They stack from the bottom of the stage and are timed
 * out individually so a burst does not clear all at once.
 */
export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const notify = useCallback<ToastValue["notify"]>(
    ({ label, detail, tone = "neutral" }) => {
      seq.current += 1;
      const id = seq.current;
      setToasts((list) => [...list.slice(-3), { id, label, detail, tone }]);
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), LIFETIME),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const timer of map.values()) window.clearTimeout(timer);
      map.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        data-chrome
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-[calc(var(--unit-deck)+env(safe-area-inset-bottom))] left-0 z-[var(--z-toast)] flex w-full flex-col items-start gap-px px-[var(--unit-gutter)] pb-4 lg:left-[var(--unit-rail)] lg:w-auto lg:max-w-[26rem]"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.output
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 10, clipPath: "inset(0 100% 0 0)" }}
              animate={{ opacity: 1, y: 0, clipPath: "inset(0 0% 0 0)" }}
              exit={{ opacity: 0, y: -6, transition: motionPreset.fast }}
              transition={spring.glide}
              className={cx(
                "pointer-events-auto flex w-full items-center gap-3 border-t px-3 py-2.5 backdrop-blur-[2px]",
                toast.tone === "fault"
                  ? "border-t-[var(--color-signal)] bg-[var(--color-signal-12)]"
                  : "border-t-[var(--color-line-strong)] bg-[var(--color-raised)]",
              )}
            >
              <span
                aria-hidden
                className={cx(
                  "h-1.5 w-1.5 shrink-0",
                  toast.tone === "neutral"
                    ? "bg-[var(--color-paper-35)]"
                    : "bg-[var(--color-signal)]",
                )}
              />
              <span className="t-meta text-[var(--color-paper)]">{toast.label}</span>
              {toast.detail ? (
                <span className="t-meta truncate text-[var(--color-paper-35)]">
                  {toast.detail}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="t-micro ml-auto shrink-0 text-[var(--color-paper-35)] transition-colors duration-150 hover:text-[var(--color-paper)]"
              >
                Dismiss
              </button>
            </motion.output>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside Toaster");
  return context;
}
