import { Fragment, type ReactNode } from "react";
import { create } from "zustand";

/** Open a dialog from anywhere (menus, gateway events). `render` gets a close function. */
const useModals = create<{ list: { id: number; render: (close: () => void) => ReactNode }[] }>(() => ({ list: [] }));
let seq = 0;
export function openModal(render: (close: () => void) => ReactNode) {
  const id = ++seq;
  useModals.setState((s) => ({ list: [...s.list, { id, render }] }));
  return () => useModals.setState((s) => ({ list: s.list.filter((m) => m.id !== id) }));
}
export function ModalHost() {
  const list = useModals((s) => s.list);
  return <>{list.map((m) => <Fragment key={m.id}>{m.render(() => useModals.setState((s) => ({ list: s.list.filter((x) => x.id !== m.id) })))}</Fragment>)}</>;
}
