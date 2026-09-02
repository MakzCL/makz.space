"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};
const onClient = () => true;
const onServer = () => false;

/**
 * False during server rendering and the hydration pass, true afterwards.
 *
 * Used to gate anything whose value cannot agree between the two — relative
 * timestamps, clocks, pointer capabilities. Implemented as an external store
 * rather than an effect so React handles the transition itself and nothing
 * re-renders in a cascade.
 */
export function useMounted() {
  return useSyncExternalStore(never, onClient, onServer);
}
