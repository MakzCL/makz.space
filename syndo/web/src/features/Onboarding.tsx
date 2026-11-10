import { useEffect, useState } from "react";
import { Check, ScrollText } from "lucide-react";
import type { Guild, Onboarding as OB } from "@syndo/shared";
import { api, errMsg } from "../api.ts";
import { navigate } from "../router.ts";
import { toast } from "../store.ts";
import { Modal } from "../components/ui.tsx";

const cache = new Map<string, OB>();
const seenKey = (g: string) => `send.onboarded.${g}`;

/** New members: rules screening (required), then questions that give roles, then the welcome screen. */
export function OnboardingGate({ guild }: { guild: Guild }) {
  const [ob, setOb] = useState<OB | null>(cache.get(guild.id) ?? null);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(seenKey(guild.id)) === "1"; } catch { return false; } });
  const pending = !!guild.me.pending;
  useEffect(() => {
    if (cache.has(guild.id)) { setOb(cache.get(guild.id)!); return; }
    if (!pending && dismissed) return;
    api.get<OB>(`/api/guilds/${guild.id}/onboarding`).then((o) => { cache.set(guild.id, o); setOb(o); }).catch(() => {});
  }, [guild.id, pending, dismissed]);
  if (!ob) return null;
  const needsRules = pending && !!ob.screening?.enabled;
  const hasFlow = ob.enabled && ob.prompts.length > 0;
  const fresh = Date.now() - new Date(guild.me.joined_at).getTime() < 7 * 86400_000;
  if (!needsRules && (dismissed || !fresh || (!hasFlow && !ob.welcome))) return null;
  const done = () => { try { localStorage.setItem(seenKey(guild.id), "1"); } catch { /* */ } setDismissed(true); };
  return <Flow guild={guild} ob={ob} needsRules={needsRules} onDone={done} />;
}

function Flow({ guild, ob, needsRules, onDone }: { guild: Guild; ob: OB; needsRules: boolean; onDone: () => void }) {
  const steps = [...(needsRules ? ["rules"] : []), ...(ob.enabled ? ob.prompts.map((p) => p.id) : []), ...(ob.welcome ? ["welcome"] : [])];
  const [i, setI] = useState(0);
  const [agree, setAgree] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const step = steps[i];
  const prompt = ob.prompts.find((p) => p.id === step);
  const submit = async () => {
    setBusy(true);
    try { await api.post(`/api/guilds/${guild.id}/onboarding/complete`, { accept_rules: agree || !needsRules, answers }); return true; }
    catch (e) { toast(errMsg(e), "error"); return false; } finally { setBusy(false); }
  };
  const next = async () => {
    const lastQuestion = !steps.slice(i + 1).some((s) => s !== "welcome");
    if (step !== "welcome" && lastQuestion) { if (!(await submit())) return; }
    if (i + 1 >= steps.length) onDone(); else setI(i + 1);
  };
  const close = () => { if (needsRules && step === "rules") return; onDone(); };
  return (
    <Modal title={step === "rules" ? <><ScrollText size={20} /> {guild.name} — rules</> : step === "welcome" ? `Welcome to ${guild.name}!` : prompt?.title} label="Server onboarding" onClose={close}
      footer={<><span className="muted small grow">{steps.length > 1 ? `${i + 1} of ${steps.length}` : ""}</span>
        {step !== "rules" && step !== "welcome" && !prompt?.required && <button className="btn" onClick={next}>Skip</button>}
        <button className="btn primary" disabled={busy || (step === "rules" && !agree) || (!!prompt?.required && !(answers[prompt.id]?.length))} onClick={next}>{i + 1 >= steps.length ? "Finish" : "Next"}</button></>}>
      {step === "rules" && <>
        {ob.screening?.description && <p>{ob.screening.description}</p>}
        <ol className="rules-list">{ob.screening!.rules.map((r, k) => <li key={k}>{r}</li>)}</ol>
        <label className="row agree"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I've read and agree to the rules</label>
        <p className="muted small">You can read the server, but you can't send messages, react or join voice until you agree.</p>
      </>}
      {prompt && <div className={`ob-options ${prompt.single_select ? "single" : ""}`}>{prompt.options.map((o) => {
        const on = (answers[prompt.id] ?? []).includes(o.id);
        return <button key={o.id} className={`ob-option ${on ? "on" : ""}`} aria-pressed={on} onClick={() => setAnswers((a) => { const cur = a[prompt.id] ?? []; return { ...a, [prompt.id]: prompt.single_select ? (on ? [] : [o.id]) : on ? cur.filter((x) => x !== o.id) : [...cur, o.id] }; })}>
          {o.emoji && <span className="ob-emoji">{o.emoji}</span>}<span><strong>{o.title}</strong>{o.description && <small className="muted block">{o.description}</small>}</span>{on && <Check size={16} />}
        </button>; })}</div>}
      {step === "welcome" && ob.welcome && <>
        <p>{ob.welcome.description}</p>
        <div className="welcome-list">{ob.welcome.channels.map((w) => { const c = guild.channels.find((x) => x.id === w.channel_id); return c ? <button key={w.channel_id} className="result" onClick={() => { onDone(); navigate(`/channels/${guild.id}/${c.id}`); }}><span>{w.emoji ?? "#"}</span> <strong>{w.description}</strong> <span className="muted">#{c.name}</span></button> : null; })}</div>
      </>}
    </Modal>
  );
}
