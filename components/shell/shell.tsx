import type { ReactNode } from "react";

import { getViewer } from "@/lib/supabase/viewer";
import { readStreamStatus } from "@/lib/status";

import { AmbientGrid } from "./ambient-grid";
import { CommandPaletteProvider } from "./command-palette";
import { Connection } from "./connection";
import { Cursor } from "./cursor";
import { Deck } from "./deck";
import { Dock } from "./dock";
import { EnvironmentProvider } from "./environment";
import { Ledger } from "./ledger";
import { LiveStatusProvider } from "./live-status";
import { Rail } from "./rail";
import { Stage } from "./stage";
import { StageScrollProvider } from "./stage-scroll";
import { Toaster } from "./toaster";

/**
 * THE SHELL
 *
 * Everything outside the stage is rendered once and never again. Routes
 * replace only the stage's contents, which is what makes navigation feel like
 * changing view in an application rather than fetching a document.
 *
 * Layout is a fixed viewport grid — ledger, then rail plus stage, then deck or
 * dock — so no section can ever push the chrome off screen.
 */
export async function Shell({ children }: { children: ReactNode }) {
  const [viewer, stream] = await Promise.all([getViewer(), readStreamStatus()]);

  return (
    <EnvironmentProvider viewer={viewer}>
      <LiveStatusProvider initial={stream}>
        <Toaster>
          <CommandPaletteProvider>
            <StageScrollProvider>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[var(--z-cursor)] focus:border focus:border-[var(--color-signal)] focus:bg-[var(--color-base)] focus:px-4 focus:py-2 focus:text-[0.8rem]"
            >
              Skip to content
            </a>

            <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden">
              <AmbientGrid />
              <Ledger />
              <Connection />
              <div className="relative flex min-h-0 flex-1">
                <Rail />
                <div className="relative min-w-0 flex-1">{<Stage>{children}</Stage>}</div>
              </div>
              <Deck />
              <Dock />
            </div>

            <Cursor />
            </StageScrollProvider>
          </CommandPaletteProvider>
        </Toaster>
      </LiveStatusProvider>
    </EnvironmentProvider>
  );
}
