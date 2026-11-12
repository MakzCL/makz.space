/**
 * Compatibility with names from before the app was renamed from Syndo to SEND. Imported first in main.tsx,
 * before anything else runs.
 *
 * 1. Desktop app: installed versions up to 0.6.x expose `window.syndoDesktop` / `window.syndoLocal`; newer
 *    ones use `window.sendDesktop` / `window.sendLocal`. Alias the old names so the rest of the app only
 *    looks at the new ones.
 */
{
  const w = window as unknown as Record<string, unknown>;
  for (const [now, before] of [["sendDesktop", "syndoDesktop"], ["sendLocal", "syndoLocal"]]) if (!w[now] && w[before]) w[now] = w[before];
}

/**
 * 2. Settings saved in the browser before the rename used "syndo." keys (theme snapshot, voice settings,
 * collapsed categories, drafts…). Copy them to their "send." names once per browser, before anything reads
 * them. The old keys are left in place so rolling the web app
 * back to an earlier release doesn't lose anyone's settings.
 */
const OLD = "syndo.", NEW = "send.", DONE = "send.storage-migrated.v1";
for (const pick of [() => localStorage, () => sessionStorage]) {
  try {
    const store = pick();
    if (store.getItem(DONE)) continue;
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(OLD)) keys.push(k); }
    for (const k of keys) {
      const target = NEW + k.slice(OLD.length), value = store.getItem(k);
      if (value !== null && store.getItem(target) === null) store.setItem(target, value);
    }
    store.setItem(DONE, "1");
  } catch { /* storage blocked (private mode): nothing to move */ }
}
export {};
