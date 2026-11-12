import { Keyboard, Plus, RotateCcw, X, Globe, AppWindow } from "lucide-react";
import { useEffect, useState } from "react";
import { updateSettings } from "../actions.ts";
import { desktop, globalPttError } from "../desktop.ts";
import { bindingsFor, comboFromEvent, isMac, normalize, overrides, prettyBinding, shortcutActions, useShortcutVersion, usersOf, type ShortcutAction } from "../shortcuts.ts";
import { updateVoiceSettings, useVoice } from "../voice/session.ts";
import { askConfirm } from "./overlay.tsx";
import { Modal } from "./ui.tsx";
import { Select } from "./Select.tsx";
import { openDialog } from "./Shell.tsx";

const groupsOf = () => { const m = new Map<string, ShortcutAction[]>(); for (const a of shortcutActions()) m.set(a.group, [...(m.get(a.group) ?? []), a]); return [...m.entries()]; };
const setBindings = (id: string, list: string[]) => {
  const next = { ...overrides(), [id]: list };
  const a = shortcutActions().find((x) => x.id === id);
  if (a && JSON.stringify(list) === JSON.stringify(a.defaults)) delete next[id]; // back to default: store nothing
  return updateSettings({ keybinds: next });
};
const pttName = (code: string) => code.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num ").replace("Left", " (left)").replace("Right", " (right)");

/** Captures the next key combination (or a supported mouse button) while active. */
function useRecorder(active: boolean, onCombo: (c: string, e: KeyboardEvent | MouseEvent) => void) {
  useEffect(() => {
    if (!active) return;
    document.body.dataset.recordingKeybind = "1";
    const key = (e: KeyboardEvent) => { if (e.isComposing) return; e.preventDefault(); e.stopImmediatePropagation(); const c = comboFromEvent(e); if (c) onCombo(c, e); };
    const mouse = (e: MouseEvent) => {
      if (![1, 3, 4].includes(e.button)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type !== "mouseup") return;
      const parts: string[] = []; if (isMac ? e.metaKey : e.ctrlKey) parts.push("Mod"); if (e.altKey) parts.push("Alt"); if (e.shiftKey) parts.push("Shift");
      onCombo(normalize([...parts, e.button === 1 ? "MouseMiddle" : e.button === 3 ? "MouseBack" : "MouseForward"].join("+")), e);
    };
    window.addEventListener("keydown", key, true); window.addEventListener("mousedown", mouse, true); window.addEventListener("mouseup", mouse, true); window.addEventListener("auxclick", mouse, true);
    return () => {
      delete document.body.dataset.recordingKeybind;
      window.removeEventListener("keydown", key, true); window.removeEventListener("mousedown", mouse, true); window.removeEventListener("mouseup", mouse, true); window.removeEventListener("auxclick", mouse, true);
    };
  }, [active]); // eslint-disable-line
}

export function KeybindsTab() {
  useShortcutVersion();
  const v = useVoice((s) => s.settings);
  const grants = useVoice((s) => s.grants);
  const [pttRec, setPttRec] = useState(false);
  useEffect(() => {
    if (!pttRec) return;
    document.body.dataset.recordingKeybind = "1";
    const k = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); updateVoiceSettings({ pttKey: e.code }); setPttRec(false); };
    window.addEventListener("keydown", k, true);
    return () => { delete document.body.dataset.recordingKeybind; window.removeEventListener("keydown", k, true); };
  }, [pttRec]);
  const custom = Object.keys(overrides()).length;
  return (
    <div className="keybinds">
      <h2>Keybinds</h2>
      <p className="muted">Shortcuts work only while {desktop ? "the SEND window" : "this tab"} is focused, unless marked <strong>Global</strong>. They never fire while you type plain text, and they follow your account to every device ({isMac ? "⌘" : "Ctrl"} becomes {isMac ? "Ctrl" : "⌘"} on {isMac ? "Windows and Linux" : "macOS"}).</p>

      <section className="kb-group">
        <h3>Voice</h3>
        <div className="kb-row">
          <div className="kb-label"><strong>Push to talk</strong>
            <small className="muted">{v.mode === "ptt" ? "Active (Voice & video → Input mode)" : "Turned off: switch Input mode to Push to talk to use it"}{grants && !grants.vad ? " · Required in this channel: voice activity isn't allowed here" : ""}</small>
            <span className={`kb-scope ${desktop?.capabilities.globalPtt ? "global" : ""}`}>{desktop?.capabilities.globalPtt ? <><Globe size={12} /> Global: works while SEND is in the background</> : <><AppWindow size={12} /> In SEND only{desktop ? "" : " (browsers can't see keys while another app is focused; use the desktop app for global push to talk)"}</>}</span>
            {globalPttError && <small className="danger-text">{globalPttError}</small>}
          </div>
          <div className="kb-binds">
            {pttRec ? <span className="kb-recording" role="status">Press any key… <button className="link" onClick={() => setPttRec(false)}>Cancel</button></span>
              : <><kbd className="kb-chip">{pttName(v.pttKey)}</kbd><button className="btn sm" onClick={() => setPttRec(true)}>Change</button></>}
          </div>
        </div>
        <div className="kb-row">
          <div className="kb-label"><strong>Release delay</strong><small className="muted">How long your mic stays open after you let go (prevents clipped words). Push to talk also releases when the window loses focus{desktop?.capabilities.globalPtt ? " (not in global mode)" : ""}, when you leave the call or when your session ends.</small></div>
          <div className="kb-binds"><Select aria-label="Release delay" value={String(v.pttReleaseDelay)} onChange={(e) => updateVoiceSettings({ pttReleaseDelay: +e.target.value })}>{[0, 100, 200, 400, 800].map((ms) => <option key={ms} value={ms}>{ms} ms</option>)}</Select></div>
        </div>
      </section>

      {groupsOf().map(([group, list]) => (
        <section key={group} className="kb-group">
          <h3>{group}</h3>
          {list.map((a) => <ActionRow key={a.id} a={a} />)}
        </section>
      ))}
      <div className="row wrap">
        <button className="btn danger" disabled={!custom} onClick={async () => { if (await askConfirm({ title: "Restore default keybinds?", body: `Your ${custom} customised shortcut${custom === 1 ? "" : "s"} go back to SEND's defaults. Push to talk is kept.`, confirmLabel: "Restore defaults", danger: true })) updateSettings({ keybinds: {} }); }}><RotateCcw size={14} /> Restore defaults</button>
      </div>
    </div>
  );
}

function ActionRow({ a }: { a: ShortcutAction }) {
  const list = bindingsFor(a.id);
  const custom = overrides()[a.id] !== undefined;
  const [rec, setRec] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  useRecorder(rec, (c) => { setPending(c); setRec(false); });
  const conflicts = pending ? usersOf(pending, a.id) : [];
  const reserved = pending && !desktop && ["Mod+W", "Mod+T", "Mod+N", "Mod+Shift+N", "Mod+Shift+T", "Mod+Q", "Mod+Tab", "Mod+Shift+Tab", "Mod+L", "Mod+R"].includes(pending);
  const plain = pending && !/^(Mod|Ctrl|Alt)\+/.test(pending) && pending.length === 1;
  const save = async () => {
    if (!pending) return;
    for (const other of conflicts) await setBindings(other.id, bindingsFor(other.id).filter((b) => b !== pending));
    await setBindings(a.id, [...list.filter((b) => b !== pending), pending]);
    setPending(null);
  };
  return (
    <div className="kb-row">
      <div className="kb-label"><strong>{a.label}</strong>
        {a.note && <small className="muted">{a.note}</small>}
        {a.browserReserved && !desktop && <small className="muted">Your browser keeps these keys for itself; they work in the desktop app.</small>}
      </div>
      <div className="kb-binds">
        {list.length === 0 && !pending && <span className="muted small">Disabled</span>}
        {list.map((b) => <span key={b} className="kb-chip"><kbd>{prettyBinding(b)}</kbd><button className="kb-x" aria-label={`Remove ${prettyBinding(b)} from ${a.label}`} onClick={() => setBindings(a.id, list.filter((x) => x !== b))}><X size={12} /></button></span>)}
        {rec ? <span className="kb-recording" role="status" aria-live="polite">Press a shortcut… <button className="link" onClick={() => setRec(false)}>Cancel</button></span>
          : pending ? (
            <span className="kb-pending">
              <kbd className="kb-chip new">{prettyBinding(pending)}</kbd>
              {conflicts.length > 0 && <small className="warn-text">Also used by “{conflicts.map((c) => c.label).join("”, “")}”. Saving moves it here.</small>}
              {reserved && <small className="warn-text">Browsers reserve this combination; it will only work in the desktop app.</small>}
              {plain && <small className="warn-text">A single key without Ctrl/Alt won't work while you're typing in a text box.</small>}
              <button className="btn primary sm" onClick={save}>Save</button><button className="btn sm" onClick={() => setPending(null)}>Cancel</button>
            </span>
          ) : <button className="btn sm" onClick={() => setRec(true)} aria-label={`Add a shortcut for ${a.label}`}><Plus size={14} /> Add</button>}
        {!rec && !pending && list.length > 0 && <button className="link small" onClick={() => setBindings(a.id, [])}>Disable</button>}
        {!rec && !pending && custom && <button className="link small" onClick={() => setBindings(a.id, a.defaults)} title={`Default: ${a.defaults.map(prettyBinding).join(", ") || "none"}`}>Reset</button>}
      </div>
    </div>
  );
}

/** Ctrl/⌘+/ overlay listing the current bindings. */
export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  useShortcutVersion();
  return (
    <Modal title={<><Keyboard size={20} /> Keyboard shortcuts</>} label="Keyboard shortcuts" wide onClose={onClose}
      footer={<button className="btn" onClick={() => { onClose(); openDialog({ kind: "userSettings", tab: "keybinds" }); }}>Customise keybinds</button>}>
      <div className="kb-help">
        {groupsOf().map(([group, list]) => (
          <section key={group}><h3>{group}</h3>
            <dl>{list.filter((a) => bindingsFor(a.id).length).map((a) => <div key={a.id}><dt>{a.label}</dt><dd>{bindingsFor(a.id).map((b) => <kbd key={b}>{prettyBinding(b)}</kbd>)}</dd></div>)}</dl>
          </section>
        ))}
        <section><h3>Messages</h3><dl>
          <div><dt>Edit your last message</dt><dd><kbd>↑</kbd> in an empty message box</dd></div>
          <div><dt>Send / new line</dt><dd><kbd>Enter</kbd> / <kbd>{prettyBinding("Shift+Enter")}</kbd></dd></div>
          <div><dt>Cancel reply or edit</dt><dd><kbd>Esc</kbd></dd></div>
          <div><dt>Delete without confirming</dt><dd>Hold <kbd>{isMac ? "⇧" : "Shift"}</kbd> and click Delete</dd></div>
          <div><dt>Mark unread from a message</dt><dd><kbd>{isMac ? "⌥" : "Alt"}</kbd>+click the message</dd></div>
          <div><dt>Previous / next image in the viewer</dt><dd><kbd>←</kbd> <kbd>→</kbd></dd></div>
        </dl></section>
      </div>
    </Modal>
  );
}
