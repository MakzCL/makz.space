import { describe, expect, it } from "vitest";
import { formatEng, parseValue, toSpice } from "../src/core/units";
import { connectivity, netlistText } from "../src/connectivity/connectivity";
import { erc } from "../src/erc/erc";
import { annotate, moveItems, rotateParts } from "../src/schematic/ops";
import { saveFile, openFile, FileError } from "../src/storage/file";
import { B, divider } from "./helpers";

describe("units", () => {
  it("parses engineering notation", () => {
    expect(parseValue("10k")).toBe(10000); expect(parseValue("4k7")).toBeCloseTo(4700); expect(parseValue("2.2u")).toBeCloseTo(2.2e-6);
    expect(parseValue("1meg")).toBe(1e6); expect(parseValue("100n")).toBeCloseTo(1e-7); expect(parseValue("5V")).toBe(5); expect(parseValue("4R7")).toBeCloseTo(4.7);
    expect(parseValue("abc")).toBeNull(); expect(parseValue("10kk")).toBeNull(); expect(parseValue("")).toBeNull();
  });
  it("formats and writes SPICE values (M is milli in SPICE)", () => { expect(formatEng(0.00247, "V")).toBe("2.47 mV"); expect(toSpice(1e6)).toBe("1meg"); expect(toSpice(4.7e-9)).toBe("4.7n"); expect(toSpice(1e-3)).toBe("1m"); });
});
describe("connectivity", () => {
  it("divider has 3 nets with the expected pins", () => {
    const c = connectivity(divider().pr);
    expect(netlistText(divider().pr, c)).toBe("N$1: R1.1 V1.1\nN$2: R1.2 R2.1\nGND: R2.2 V1.2");
    expect(c.danglingEnds).toEqual([]);
  });
  it("crossing wires do not connect; a T junction does", () => {
    const b = new B(); b.wire([0, 0], [400, 0]); b.wire([200, -200], [200, 200], true);
    let c = connectivity(b.pr); expect(c.nets.filter((n) => n.wires.length).length).toBe(2); expect(c.junctions.length).toBe(0);
    const t = new B(); t.wire([0, 0], [400, 0]); t.wire([200, 0], [200, 300], true);
    c = connectivity(t.pr); expect(c.nets.filter((n) => n.wires.length).length).toBe(1); expect(c.junctions).toEqual([{ sheet: "S1", at: [200, 0] }]);
  });
  it("a pin sitting on a wire interior connects; same-name labels join nets", () => {
    const b = new B().part("R1", "RES", [0, 0]); b.wire([-400, 0], [-100, 0]);
    const p1 = b.pin("R1", "1"); expect(p1).toEqual([-200, 0]);
    expect(connectivity(b.pr).pinNet.get(`${b.ids.R1}:1`)).toBe(connectivity(b.pr).wireNet.get(b.pr.wires[0].id));
    const l = new B().part("R1", "RES", [0, 0]).part("R2", "RES", [0, 1000]); l.label(l.pin("R1", "2"), "SIG").label(l.pin("R2", "1"), "SIG");
    expect(connectivity(l.pr).pinNet.get(`${l.ids.R1}:2`)).toBe("SIG"); expect(connectivity(l.pr).pinNet.get(`${l.ids.R2}:1`)).toBe("SIG");
  });
  it("rotation moves pins; moving a part drags its wire ends and keeps the netlist", () => {
    const b = divider(); const before = netlistText(b.pr);
    const moved = moveItems(b.pr, new Set([b.ids.A]), 300, -200);
    expect(netlistText(moved)).toBe(before);
    expect(moved.wires.every((w) => w.pts.slice(1).every((p, i) => p[0] === w.pts[i][0] || p[1] === w.pts[i][1]))).toBe(true); // still orthogonal
    const r = rotateParts(b.pr, new Set([b.ids.A])); expect(netlistText(r)).toBe(before);
  });
});
describe("ERC", () => {
  it("clean divider has no errors (sources need no footprint)", () => { expect(erc(divider().pr).filter((f) => f.severity === "error")).toEqual([]); });
  it("detects a disconnected pin, a duplicate reference and a bad value", () => {
    const b = divider().part("R3", "RES", [2000, 0], 0, { value: "1x" });
    b.pr.parts = b.pr.parts.map((p) => (p.id === b.ids.R3 ? { ...p, ref: "R1" } : p));
    const f = erc(b.pr);
    expect(f.some((x) => x.rule === "unconnected-pin" && x.part === b.ids.R3)).toBe(true);
    expect(f.some((x) => x.rule === "duplicate-ref")).toBe(true);
    expect(f.some((x) => x.rule === "missing-value" && x.part === b.ids.R3)).toBe(true);
    expect(f.every((x) => Number.isFinite(x.at[0]) && x.sheet === "S1")).toBe(true);
    const fixed = annotate(b.pr); expect(erc(fixed).some((x) => x.rule === "duplicate-ref")).toBe(false);
  });
  it("op-amp input left open is an error; outputs fighting is an error", () => {
    const b = new B().part("U1", "OPAMP", [0, 0]);
    const f = erc(b.pr); expect(f.filter((x) => x.rule === "unconnected-input").length).toBe(4);
    const o = new B().part("U1", "OPAMP", [0, 0]).part("U2", "OPAMP", [0, 1000]); o.connect("U1", "1", "U2", "1");
    expect(erc(o.pr).some((x) => x.rule === "output-conflict")).toBe(true);
  });
});
describe("project file", () => {
  it("round-trips exactly and detects tampering", async () => {
    const pr = divider().pr; const text = await saveFile(pr);
    const back = (await openFile(text)).project; expect(back).toEqual(pr); expect(netlistText(back)).toBe(netlistText(pr));
    const bad = text.replace('"10k"', '"12k"');
    await expect(openFile(bad)).rejects.toBeInstanceOf(FileError);
    expect((await openFile(bad, { acceptChecksumMismatch: true })).warnings[0]).toMatch(/checksum/);
    await expect(openFile(text.replace('"schema": 1', '"schema": 99'))).rejects.toThrow(/newer/);
  });
});

import { niceRange } from "../src/ui/sim/Plot";
describe("plot axes", () => {
  it("expand to round 1-2-5 steps that contain the data", () => {
    expect(niceRange(-38.8, 2.9, 8)).toEqual([-40, 10, 10]); expect(niceRange(-38.8, 2.9, 10)).toEqual([-40, 5, 5]);
    expect(niceRange(0, 5.2, 8)).toEqual([0, 6, 1]);
    const [a, b, s] = niceRange(1.73, 1.74, 8); expect(a).toBeLessThanOrEqual(1.73); expect(b).toBeGreaterThanOrEqual(1.74); expect(s).toBeCloseTo(0.002, 12);
  });
});
