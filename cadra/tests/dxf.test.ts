import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { Session, type Input } from "../src/core/cad";
import { readDxf, writeDxf, writeSvg, readNative, writeNative } from "../src/core/dxf";
import { boxOf } from "../src/core/geom";
const txt = (s: string): Input => ({ k: "text", s });
async function script(s: Session, cmd: string, ins: Input[]) { ins.forEach((i) => s.feed(i)); await s.run(cmd); }
export async function sample() {
  const s = new Session();
  await script(s, "rec", [txt("0,0"), txt("@120,80")]);
  await script(s, "c", [txt("60,40"), txt("25")]);
  await script(s, "a", [txt("10,10"), txt("20,20"), txt("30,10")]);
  await script(s, "pl", [txt("0,100"), txt("@50,0"), txt("@0,20"), { k: "enter" }]);
  await script(s, "la", [txt("Notes")]);
  await script(s, "t", [txt("5,90"), txt("5"), txt("0"), txt("Bracket – CADRA")]);
  await script(s, "dli", [txt("0,0"), txt("120,0"), txt("60,-15")]);
  await script(s, "pol", [txt("6"), txt("150,40"), txt("15")]); const hex = s.d.ents.at(-1)!.id;
  await script(s, "h", [{ k: "pick", id: hex, p: [150, 55] }]);
  return s.d;
}
describe("DXF", () => {
  it("round-trips entities and layers through R12 DXF", async () => {
    const d = await sample(); const dxf = writeDxf(d); fs.mkdirSync("tests/out", { recursive: true }); fs.writeFileSync("tests/out/sample.dxf", dxf);
    const r = readDxf(dxf).drawing; const c = (t: string) => r.ents.filter((e) => e.t === t).length;
    expect(c("circle")).toBe(1); expect(c("arc")).toBe(1); expect(c("poly")).toBe(4); expect(c("text")).toBe(2); expect(c("line")).toBeGreaterThanOrEqual(3);
    expect(r.layers.map((l) => l.name)).toEqual(expect.arrayContaining(["0", "Dimensions", "Notes"]));
    const circ = r.ents.find((e) => e.t === "circle")!; expect(circ).toMatchObject({ c: [60, 40], r: 25 });
    expect(r.ents.find((e) => e.t === "text" && e.s.includes("CADRA"))?.layer).toBe("Notes");
  });
  it("reads a DXF written by another program (ezdxf R2018) when present", () => {
    const f = "tests/out/ezdxf.dxf"; if (!fs.existsSync(f)) return;
    const { drawing, skipped } = readDxf(fs.readFileSync(f, "utf8"));
    const c = (t: string) => drawing.ents.filter((e) => e.t === t).length;
    expect(c("line")).toBe(1); expect(c("circle")).toBe(1); expect(c("arc")).toBe(1); expect(c("poly")).toBe(1); expect(c("text")).toBe(2); expect(c("hatch")).toBe(1); expect(c("dim")).toBe(1);
    expect(drawing.layers.find((l) => l.name === "WALLS")?.color).toBe("#ff0000"); void skipped;
  });
  it("rejects files that are not DXF", () => { expect(() => readDxf("hello\nworld\n")).toThrow(); expect(() => readNative("{}")).toThrow(); });
  it("keeps everything in the native format and exports SVG", async () => {
    const d = await sample(); expect(readNative(writeNative(d))).toEqual(d);
    const svg = writeSvg(d, boxOf(d.ents)!); expect(svg).toContain("<circle"); expect(svg).toContain("Bracket"); fs.writeFileSync("tests/out/sample.svg", svg);
  });
});
