// PCB tests: footprints match symbols, schematic → board transfer, ratsnest, DRC with known distances,
// autorouting to a DRC-clean board, and Gerber/Excellon output checked by gerbonara and gerbv (independent tools).
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEVICES } from "../src/library/devices";
import { FOOTPRINTS, footprint, mm } from "../src/pcb/footprints";
import { padsOf, ratsnest, sync } from "../src/pcb/board";
import { drc } from "../src/pcb/drc";
import { autoroute } from "../src/pcb/route";
import { fabFiles, zip, crc32 } from "../src/pcb/gerber";

import { ledBoardPlaced, ledBoardSchematic } from "../src/examples/examples";
const ledBoard = () => ledBoardSchematic().pr;
function placed() { const { b, board } = ledBoardPlaced(); return { pr: b.pr, board }; }

describe("footprints", () => {
  it("every library footprint exists and has a pad for every symbol pin", () => {
    for (const d of DEVICES) for (const name of d.footprints) {
      const f = footprint(name); expect(f, `${d.id} → ${name}`).toBeDefined();
      for (const pin of d.symbol.pins) expect(f!.pads.some((p) => p.name === pin.num), `${d.id} pin ${pin.num} in ${name}`).toBe(true);
    }
    expect(Object.keys(FOOTPRINTS).length).toBeGreaterThanOrEqual(26);
  });
  it("chip pads follow the package dimensions (0805: 1.825 mm between pad centres)", () => {
    const f = footprint("R_0805_2012Metric")!; expect(f.pads[1].at[0] - f.pads[0].at[0]).toBe(mm(1.825)); expect(f.smd).toBe(true);
    const dip = footprint("DIP-8_W7.62mm")!; expect(dip.pads[7].at[0] - dip.pads[0].at[0]).toBe(mm(7.62)); expect(dip.pads[0].drill).toBe(mm(0.8));
  });
});

describe("schematic → board", () => {
  it("transfers parts with footprints, skips simulation-only sources, reports changes", () => {
    const pr = ledBoard(); const { board, report } = sync(pr, null);
    expect(report.added.sort()).toEqual(["C1", "D1", "J1", "R1", "SW1"]); expect(report.missing).toEqual([]);
    const pr2 = { ...pr, parts: pr.parts.filter((p) => p.ref !== "C1") };
    const r2 = sync(pr2, board); expect(r2.report.removed).toEqual(["C1"]); expect(r2.board.parts.length).toBe(4);
  });
  it("ratsnest: 7 connections for 4 nets with 13 pads (button has two legs per terminal)", () => {
    const { pr, board } = placed();
    const w = ratsnest(board, pr);
    // VCC 3 pads → 2, LED_A 2 → 1, SW 3 (D1.2 + two SW1.1 legs) → 2, GND 5 (J1.2, two SW1.2 legs, C1.2) → 3 … minus none = 8
    const byNet = (n: string) => w.filter((x) => x.net === n).length;
    expect(byNet("VCC")).toBe(2); expect(byNet("LED_A")).toBe(1); expect(byNet("SW")).toBe(2); expect(byNet("GND")).toBe(3);
  });
});

describe("DRC", () => {
  it("measures clearance exactly and reports shorts", () => {
    const { pr, board } = placed();
    const pads = padsOf(board, pr); const r1 = pads.filter((p) => p.ref === "R1");
    // a track on another net 0.15 mm from R1 pad 2's right edge
    const p2 = r1.find((p) => p.name === "2")!; const x = p2.at[0] + p2.size[0] / 2 + mm(0.15) + mm(0.125);
    board.tracks.push({ id: "tx", layer: "F.Cu", a: [x, p2.at[1] - mm(2)], b: [x, p2.at[1] + mm(2)], width: mm(0.25), net: "GND" });
    let f = drc(board, pr).filter((d) => d.ids.includes("tx") && d.rule === "clearance");
    expect(f.length).toBe(1); expect(f[0].message).toMatch(/^Clearance 0\.15 mm < 0\.2 mm/);
    board.tracks[0].a = [p2.at[0], p2.at[1] - mm(2)]; board.tracks[0].b = [p2.at[0], p2.at[1] + mm(2)];
    f = drc(board, pr).filter((d) => d.ids.includes("tx")); expect(f.some((d) => d.rule === "short")).toBe(true);
  });
  it("flags parts outside the board, tiny vias and unrouted nets", () => {
    const { pr, board } = placed();
    board.vias.push({ id: "v1", at: [mm(35), mm(25)], drill: mm(0.2), dia: mm(0.4), net: "GND" });
    board.parts[0] = { ...board.parts[0], at: [mm(60), mm(5)] };
    const f = drc(board, pr); const rules = new Set(f.map((d) => d.rule));
    for (const r of ["outside", "drill", "annular", "unrouted"]) expect(rules.has(r as never), r).toBe(true);
  });
});

describe("autorouter", { timeout: 120000 }, () => {
  it("routes the board completely and the result passes DRC with no errors", () => {
    const { pr, board } = placed();
    const r = autoroute(board, pr);
    expect(r.failed).toEqual([]);
    expect(ratsnest(r.board, pr)).toEqual([]);
    const errs = drc(r.board, pr).filter((d) => d.severity === "error");
    expect(errs.map((e) => e.message)).toEqual([]);
    expect(r.board.tracks.length).toBeGreaterThan(5);
  });
});

const venv = "/opt/nuc-venv/bin/python";
const haveTools = (() => { try { execFileSync(venv, ["-c", "import gerbonara"]); execFileSync("gerbv", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
describe.skipIf(!haveTools)("Gerber / Excellon (checked by gerbonara and gerbv)", { timeout: 120000 }, () => {
  it("writes layers whose content matches the board exactly", () => {
    const { pr, board: b0 } = placed(); const board = autoroute(b0, pr).board;
    const files = fabFiles(board, pr, "led");
    const dir = mkdtempSync(join(tmpdir(), "nuc-fab-")); for (const f of files) writeFileSync(join(dir, f.name), f.text);
    const s = JSON.parse(execFileSync(venv, [join(__dirname, "tools/check_fab.py"), dir], { encoding: "utf8" }));
    const pads = padsOf(board, pr); const top = pads.filter((p) => p.layers.includes("F.Cu")).length, bot = pads.filter((p) => p.layers.includes("B.Cu")).length, tht = pads.filter((p) => p.drill).length;
    expect(s["led-F_Cu.gbr"].flashes).toBe(top + board.vias.length); expect(s["led-B_Cu.gbr"].flashes).toBe(bot + board.vias.length);
    expect(s["led-F_Cu.gbr"].lines + s["led-B_Cu.gbr"].lines).toBe(board.tracks.length);
    expect(s["led-F_Mask.gbr"].flashes).toBe(top); // vias tented
    expect(s["led-PTH.drl"].hits).toBe(tht + board.vias.length);
    expect(s["led-PTH.drl"].sizes_mm).toEqual([...new Set([...pads.filter((p) => p.drill).map((p) => p.drill! / 1e6), ...board.vias.map((v) => v.drill / 1e6)])].sort((a, c) => a - c));
    const [x0, y0, x1, y1] = s["led-Edge_Cuts.gbr"].bbox; expect(x1 - x0).toBeCloseTo(40.1, 3); expect(y1 - y0).toBeCloseTo(30.1, 3); // 40 × 30 board + 0.1 mm line
    expect(s["led-F_Silkscreen.gbr"].lines).toBeGreaterThan(20);
    for (const f of files.filter((x) => x.name.endsWith(".gbr") || x.name.endsWith(".drl"))) execFileSync("gerbv", ["-x", "png", "-o", join(dir, f.name + ".png"), join(dir, f.name)], { stdio: "ignore" });
    expect(files.find((f) => f.name === "led-pos.csv")!.text.split("\n")[1]).toMatch(/^C1,100n,C_0805_2012Metric,/);
  });
  it("zips files readably (CRC-32 of the standard test vector)", () => {
    expect(crc32(new TextEncoder().encode("123456789")).toString(16)).toBe("cbf43926");
    const z = zip([{ name: "a.txt", data: new TextEncoder().encode("hello") }]); const dir = mkdtempSync(join(tmpdir(), "nuc-zip-")); writeFileSync(join(dir, "t.zip"), z);
    expect(execFileSync("unzip", ["-p", join(dir, "t.zip"), "a.txt"], { encoding: "utf8" })).toBe("hello");
  });
});

describe("copper pour", { timeout: 120000 }, () => {
  it("a GND pour on the bottom joins every GND pad, keeps clearance (DRC clean) and appears as Gerber regions", async () => {
    const { pr, board: b0 } = placed();
    const { fillZones } = await import("../src/pcb/zones"); const { baseItems, padsOf: pads0, ratsnest: rn } = await import("../src/pcb/board");
    b0.zones = [{ id: "zg", net: "GND", layer: "B.Cu", thermal: true }];
    // the bottom pour joins the through-hole GND pads (J1, both SW1 legs); C1 is surface-mount on top, so it still needs a via
    expect(rn(b0, pr).filter((w) => w.net === "GND").map((w) => [w.from, w.to].sort().join(" ↔ "))).toEqual([expect.stringContaining("C1 pad 2")]);
    const routed = autoroute(b0, pr).board;
    expect(ratsnest(routed, pr)).toEqual([]);
    expect(drc(routed, pr).filter((d) => d.severity === "error").map((d) => d.message)).toEqual([]);
    const fills = fillZones(routed, baseItems(routed, pads0(routed, pr)));
    const { fillArea } = await import("../src/pcb/zones"); const area = fills[0].polys.reduce((a, p) => a + fillArea(p), 0);
    expect(area).toBeGreaterThan(600); expect(area).toBeLessThan(40 * 30);
    if (!haveTools) return;
    const dir = mkdtempSync(join(tmpdir(), "nuc-zone-")); for (const f of fabFiles(routed, pr, "z")) writeFileSync(join(dir, f.name), f.text);
    const s = JSON.parse(execFileSync(venv, [join(__dirname, "tools/check_fab.py"), dir], { encoding: "utf8" }));
    expect(s["z-B_Cu.gbr"].dark_regions).toBeGreaterThanOrEqual(fills[0].polys.length);
    expect(s["z-B_Cu.gbr"].regions).toBeGreaterThan(s["z-B_Cu.gbr"].dark_regions); // holes cleared around other nets
    execFileSync("gerbv", ["-x", "png", "-o", join(dir, "b.png"), join(dir, "z-B_Cu.gbr")], { stdio: "ignore" });
  });
});
