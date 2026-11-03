// Virtual instruments. They only display solver output — nothing here is generated or animated.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { formatEng, parseValue } from "../../core/units";
import { device } from "../../library/devices";
import { Plot, toCsv, COLORS, type Series } from "./Plot";
import type { SimApi } from "./useSim";

export function Multimeter({ sim }: { sim: SimApi }) {
  const S = useStore(); const r = S.sim;
  const nets = S.con.nets.filter((n) => n.pins.length).map((n) => n.name).sort();
  const [mode, setMode] = useState<"dcv" | "acv" | "dci">("dcv");
  const [pos, setPos] = useState<string>(""); const [neg, setNeg] = useState("GND"); const [elem, setElem] = useState("");
  const selNet = (() => { const id = [...S.sel][0]; return id ? S.con.wireNet.get(id) ?? S.con.labelNet.get(id) ?? null : null; })();
  const a = (pos && nets.includes(pos) ? pos : "") || selNet || nets.find((n) => n !== "GND") || "";
  const reading = useMemo(() => {
    if (!r) return { text: "— —", sub: "Run a simulation (DC operating point or transient)" };
    if (mode === "dci") {
      const p = S.pr.parts.find((x) => x.ref === elem); if (!p) return { text: "— —", sub: "Choose a source or resistor" };
      const d = device(p.device);
      if (d.category === "Source") { const i = r.branchI.get((p.ref[0].toUpperCase() === "V" ? p.ref : `V${p.ref}`).toLowerCase()); if (!i) return { text: "n/a", sub: "No branch current in this result" }; const v = -i[i.length - 1]; return { text: formatEng(v, "A", 5), sub: `Current delivered by ${p.ref} (from the solver)` }; }
      if (d.id === "RES") { const va = r.netV.get(S.con.pinNet.get(`${p.id}:1`) ?? "")?.re, vb = r.netV.get(S.con.pinNet.get(`${p.id}:2`) ?? "")?.re; const R = parseValue(p.props.value ?? ""); if (!va || !vb || !R) return { text: "n/a", sub: "Resistor not connected" }; const i = (va[va.length - 1] - vb[vb.length - 1]) / R; return { text: formatEng(i, "A", 5), sub: `Through ${p.ref}, pin 1 → 2 (Ohm's law on solved node voltages)` }; }
      return { text: "n/a", sub: "Current is available for sources and resistors" };
    }
    const va = r.netV.get(a)?.re, vb = neg === "GND" ? null : r.netV.get(neg)?.re;
    if (!va) return { text: "— —", sub: `${a || "?"} is not in the result` };
    const series = va.map((v, i) => v - (vb ? vb[i] : 0));
    if (mode === "dcv") { const last = series[series.length - 1]; return { text: formatEng(last, "V", 5), sub: r.analysis === "op" ? "DC operating point" : `${r.analysis.toUpperCase()} — last point · min ${formatEng(Math.min(...series), "V", 4)} · max ${formatEng(Math.max(...series), "V", 4)}` }; }
    if (r.analysis !== "tran" || !r.axis) return { text: "n/a", sub: "AC volts need a transient run" };
    const t = r.axis.values; let s2 = 0, s1 = 0; for (let i = 1; i < t.length; i++) { const dt = t[i] - t[i - 1]; const m = (series[i] + series[i - 1]) / 2; s1 += m * dt; s2 += ((series[i] ** 2 + series[i - 1] ** 2) / 2) * dt; }
    const T = t[t.length - 1] - t[0]; const mean = s1 / T; const rms = Math.sqrt(Math.max(0, s2 / T - mean * mean));
    return { text: formatEng(rms, "V", 5), sub: `AC RMS over the whole run (DC removed: mean ${formatEng(mean, "V", 4)})` };
  }, [r, mode, a, neg, elem, S.pr, S.con]);
  return (
    <div className="n-dmm" data-testid="multimeter">
      <div className="n-dmm-face"><div className="n-dmm-mode">{mode === "dcv" ? "DC V" : mode === "acv" ? "AC V rms" : "DC A"}</div><div className="n-dmm-val" data-testid="dmm-value">{reading.text}</div><div className="n-dmm-sub">{reading.sub}{S.simStale ? " · design changed since this run" : ""}</div></div>
      <div className="n-dmm-ctl">
        <div className="n-seg">{(["dcv", "acv", "dci"] as const).map((m) => <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{m === "dcv" ? "V⎓" : m === "acv" ? "V~" : "A⎓"}</button>)}</div>
        {mode !== "dci" ? <>
          <label>+ <select className="n-in" value={a} onChange={(e) => setPos(e.target.value)} data-testid="dmm-pos">{nets.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>− <select className="n-in" value={neg} onChange={(e) => setNeg(e.target.value)}>{nets.map((n) => <option key={n}>{n}</option>)}</select></label>
          {selNet && <button type="button" className="n-btn small" onClick={() => setPos(selNet)}>Use selected net ({selNet})</button>}
        </> : <label>Through <select className="n-in" value={elem} onChange={(e) => setElem(e.target.value)}><option value="">choose…</option>{S.pr.parts.filter((p) => ["Source"].includes(device(p.device).category) || p.device === "RES").map((p) => <option key={p.id}>{p.ref}</option>)}</select></label>}
        <button type="button" className="n-btn small" onClick={() => sim.run(r?.analysis === "tran" ? "tran" : "op")} disabled={sim.state === "running" || sim.state === "starting"}>Measure</button>
      </div>
    </div>
  );
}

export function Scope({ dark, sim }: { dark: string; sim: SimApi }) {
  const S = useStore(); const r = S.sim;
  const nets = S.con.nets.filter((n) => n.pins.length && n.name !== "GND").map((n) => n.name).sort();
  const [ch, setCh] = useState<{ net: string; on: boolean; vdiv: string; off: string }[]>([0, 1, 2, 3].map((i) => ({ net: nets[i] ?? "", on: i < 2, vdiv: "2", off: "0" })));
  const [tdiv, setTdiv] = useState(""); const [trig, setTrig] = useState({ src: 0, level: "0", edge: "rise" as "rise" | "fall", on: false });
  const [hold, setHold] = useState<typeof r>(null);
  const data = hold ?? (r?.analysis === "tran" ? r : null);
  const series: Series[] = useMemo(() => {
    if (!data?.axis) return [];
    const t = data.axis.values; let t0 = t[0];
    if (trig.on) { const v = data.netV.get(ch[trig.src].net)?.re; const L = parseValue(trig.level) ?? 0; if (v) for (let i = 1; i < v.length; i++) if (trig.edge === "rise" ? v[i - 1] < L && v[i] >= L : v[i - 1] > L && v[i] <= L) { t0 = t[i]; break; } }
    return ch.map((c, i) => ({ c, i })).filter(({ c }) => c.on && data.netV.get(c.net)).map(({ c, i }) => {
      const k = parseValue(c.vdiv) || 1, off = parseValue(c.off) ?? 0;
      return { name: `CH${i + 1} ${c.net} (${formatEng(k, "V", 3)}/div)`, color: COLORS[i], x: t.map((x) => x - t0), y: data.netV.get(c.net)!.re.map((v) => (v + off) / k) };
    });
  }, [data, ch, trig]);
  const span = data?.axis ? data.axis.values[data.axis.values.length - 1] - data.axis.values[0] : 0;
  const td = parseValue(tdiv) ?? span / 10;
  return (
    <div className="n-scope" data-testid="scope">
      <div className="n-scope-ctl">
        {ch.map((c, i) => <div key={i} className="n-ch" style={{ borderColor: COLORS[i] }}>
          <label><input type="checkbox" checked={c.on} onChange={(e) => setCh(ch.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} /> CH{i + 1}</label>
          <select className="n-in" value={c.net} onChange={(e) => setCh(ch.map((x, j) => (j === i ? { ...x, net: e.target.value } : x)))} data-testid={`scope-ch${i + 1}`}><option value="">—</option>{nets.map((n) => <option key={n}>{n}</option>)}</select>
          <input className="n-in mono" value={c.vdiv} title="Volts per division" onChange={(e) => setCh(ch.map((x, j) => (j === i ? { ...x, vdiv: e.target.value } : x)))} />
        </div>)}
        <div className="n-ch"><label>Time/div</label><input className="n-in mono" placeholder={formatEng(span / 10, "s", 3)} value={tdiv} onChange={(e) => setTdiv(e.target.value)} /></div>
        <div className="n-ch"><label><input type="checkbox" checked={trig.on} onChange={(e) => setTrig({ ...trig, on: e.target.checked })} /> Trigger</label>
          <select className="n-in" value={trig.src} onChange={(e) => setTrig({ ...trig, src: Number(e.target.value) })}>{ch.map((_, i) => <option key={i} value={i}>CH{i + 1}</option>)}</select>
          <input className="n-in mono" value={trig.level} title="Trigger level (V)" onChange={(e) => setTrig({ ...trig, level: e.target.value })} />
          <select className="n-in" value={trig.edge} onChange={(e) => setTrig({ ...trig, edge: e.target.value as "rise" | "fall" })}><option value="rise">↑</option><option value="fall">↓</option></select></div>
        <button type="button" className={`n-btn small ${hold ? "on" : ""}`} onClick={() => setHold(hold ? null : r)} disabled={!r}>{hold ? "Release" : "Hold"}</button>
        <button type="button" className="n-btn small" disabled={!series.length} onClick={() => dl("scope.csv", toCsv("time_s", series.map((s, i) => ({ ...s, y: s.y.map((v) => v * (parseValue(ch[i]?.vdiv) || 1)) }))))}>CSV</button>
        <button type="button" className="n-btn small primary" onClick={() => sim.run("tran")} disabled={sim.state === "running" || sim.state === "starting"} data-testid="scope-run">Run transient</button>
      </div>
      {series.length ? <Plot series={series} xUnit="s" yUnit="div" xRange={[0, td * 10]} yRange={[-4, 4]} divisions={[10, 8]} dark={dark} testid="scope-plot" />
        : <p className="n-dim n-pad">{r && r.analysis !== "tran" ? "The oscilloscope shows transient results — set the analysis to Transient and run." : "Choose channels and run a transient analysis. Traces are the solver's own samples."}</p>}
    </div>
  );
}
export function dl(name: string, text: string, type = "text/csv") { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

export function Graph({ dark }: { dark: string }) {
  const S = useStore(); const r = S.sim;
  const nets = S.con.nets.filter((n) => n.pins.length && n.name !== "GND").map((n) => n.name).sort();
  const [traces, setTraces] = useState<string[]>([]);
  const shown = traces.length ? traces : nets.slice(0, 3);
  if (!r || r.analysis === "op" || !r.axis) return <div className="n-pad"><h3>Analysis graph</h3><p className="n-dim">Run a transient, AC or DC-sweep analysis (Simulation menu). Graphs show every point the solver returned, tied to project revision and run time.</p></div>;
  const x = r.axis.values; const ac = r.analysis === "ac";
  const mag: Series[] = shown.filter((n) => r.netV.get(n)).map((n, i) => { const v = r.netV.get(n)!; return { name: ac ? `|V(${n})| dB` : `V(${n})`, color: COLORS[i % COLORS.length], x, y: ac ? v.re.map((re, k) => 20 * Math.log10(Math.hypot(re, v.im?.[k] ?? 0))) : v.re }; });
  const ph: Series[] = ac ? shown.filter((n) => r.netV.get(n)).map((n, i) => { const v = r.netV.get(n)!; return { name: `∠V(${n})°`, color: COLORS[i % COLORS.length], x, y: v.re.map((re, k) => (Math.atan2(v.im?.[k] ?? 0, re) * 180) / Math.PI) }; }) : [];
  return (
    <div className="n-graph" data-testid="graph">
      <div className="n-graph-h"><b>{r.analysis === "tran" ? "Transient" : ac ? "AC small-signal" : "DC sweep"}</b><span className="n-dim">solved {new Date(r.at).toLocaleTimeString()} · project rev {r.revision}{S.simStale ? " · design changed since" : ""}</span>
        <div className="n-trace-pick">{nets.map((n) => <label key={n}><input type="checkbox" checked={shown.includes(n)} onChange={(e) => setTraces(e.target.checked ? [...shown, n] : shown.filter((x) => x !== n))} /> {n}</label>)}</div>
        <button type="button" className="n-btn small" onClick={() => dl(`${r.analysis}.csv`, toCsv(r.axis!.name, ac ? [...mag, ...ph] : mag))}>Export CSV</button>
        <button type="button" className="n-btn small" onClick={() => { const c = document.querySelector<HTMLCanvasElement>("[data-testid=graph] canvas"); if (c) { const a = document.createElement("a"); a.href = c.toDataURL("image/png"); a.download = `${r.analysis}.png`; a.click(); } }}>Export PNG</button></div>
      <Plot series={mag} xUnit={r.axis.unit} yUnit={ac ? "dB" : "V"} logX={ac && S.pr.sim.ac.type !== "lin"} dark={dark} height={ac ? 240 : 360} />
      {ac && <Plot series={ph} xUnit="Hz" yUnit="°" logX={S.pr.sim.ac.type !== "lin"} dark={dark} height={200} />}
    </div>
  );
}
