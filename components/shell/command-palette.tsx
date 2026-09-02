"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";

interface PaletteValue {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: boolean;
}

const PaletteContext = createContext<PaletteValue | null>(null);

/**
 * THE COMMAND INTERFACE
 *
 * This module is only the shortcut: ⌘K, Ctrl+K, or "/" when nothing else has
 * focus. The console it opens is a separate chunk, fetched the first time it
 * is actually needed, so the shell stays small for the visitors who never
 * press it.
 */
const Palette = dynamic(() => import("./palette-panel").then((m) => m.Palette), {
  ssr: false,
});

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  const open = useCallback(() => {
    setEverOpened(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    setEverOpened(true);
    setIsOpen((value) => !value);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isK = event.key.toLowerCase() === "k";
      if (isK && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setEverOpened(true);
        setIsOpen((value) => !value);
        return;
      }
      // "/" opens it too, unless the visitor is already typing somewhere.
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        const target = event.target as HTMLElement | null;
        if (target?.closest("input,textarea,[contenteditable]")) return;
        event.preventDefault();
        setEverOpened(true);
        setIsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const value = useMemo(() => ({ open, close, toggle, isOpen }), [close, isOpen, open, toggle]);

  return (
    <PaletteContext.Provider value={value}>
      {children}
      {everOpened ? <Palette open={isOpen} onClose={close} /> : null}
    </PaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const context = useContext(PaletteContext);
  if (!context) {
    throw new Error("useCommandPalette must be used inside CommandPaletteProvider");
  }
  return context;
}
