import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { Session, type Input } from "../src/core/cad";
import { readDxf, writeDxf, writeSvg } from "../src/core/dxf";
import { bbox, boxOf, setBlocks, type Insert, type V } from "../src/core/geom";
const txt = (s: string): Input => ({ k: "text", s });
async function script(s: Session, cmd: string, ins: Input[]) { ins.forEach((i) => s.feed(i)); await s.run(cmd); }
const close = (p: V, q: V) => { expect(p[0]).toBeCloseTo(q[0], 6); expect(p[1]).toBeCloseTo(q[1], 6); };

async function boltDrawing() {
  const s = new Session(); await script(s, "c", [txt("0,0"), txt("3")]); await script(s, "l", [txt("-4,0"), txt("4,0"), { k: "enter" }]);
  await script(s, "b", [txt("BOLT"), txt("0,0"), txt("all"), { k: "enter" }]);
  await script(s, "i", [txt("bolt"), txt("50,20"), txt("2"), txt("90")]);
  return s;
}
describe("blocks", () => {
  it("BLOCK turns the selection into a block and places it; INSERT adds scaled, rotated copies", async () => {
    const s = await boltDrawing(); expect(Object.keys(s.d.blocks!)).toEqual(["BOLT"]); expect(s.d.ents).toHaveLength(2); expect(s.d.ents.every((e) => e.t === "insert")).toBe(true);
    const b = bbox(s.d.ents[1]); close([b[0], b[1]], [44, 12]); close([b[2], b[3]], [56, 28]); // radius 6, line rotated to vertical ±8
  });
  it("EXPLODE replaces a block reference with its objects in place", async () => {
    const s = await boltDrawing(); const id = s.d.ents[1].id; await script(s, "x", [{ k: "pick", id, p: [50, 20] }, { k: "enter" }]);
    const c = s.d.ents.find((e) => e.t === "circle")!; expect(c).toMatchObject({ c: [50, 20], r: 6 });
  });
  it("undo restores the block definitions too", async () => {
    const s = new Session(); await script(s, "c", [txt("0,0"), txt("3")]); await script(s, "b", [txt("A"), txt("0,0"), txt("all"), { k: "enter" }]);
    s.undo(); expect(s.d.blocks?.A).toBeUndefined(); expect(s.d.ents[0].t).toBe("circle");
  });
  it("refuses bad names and unknown blocks", async () => {
    const s = new Session(); await script(s, "i", [txt("x")]); expect(s.log.at(-1)).toMatch(/no blocks/);
    await script(s, "c", [txt("0,0"), txt("1")]); await script(s, "b", [txt("bad/name")]); expect(s.log.at(-1)).toMatch(/Block names/);
  });
  it("round-trips blocks and inserts through DXF and SVG", async () => {
    const s = await boltDrawing(); const dxf = writeDxf(s.d); fs.mkdirSync("tests/out", { recursive: true }); fs.writeFileSync("tests/out/blocks.dxf", dxf);
    const r = readDxf(dxf).drawing; expect(Object.keys(r.blocks ?? {})).toEqual(["BOLT"]); expect(r.blocks!.BOLT.ents).toHaveLength(2);
    const ins = r.ents.filter((e) => e.t === "insert") as Insert[]; expect(ins).toHaveLength(2); expect(ins[1]).toMatchObject({ name: "BOLT", p: [50, 20], k: 2 }); expect(ins[1].rot).toBeCloseTo(Math.PI / 2);
    setBlocks(s.d.blocks); const svg = writeSvg(s.d, boxOf(s.d.ents)!); expect(svg.match(/<circle/g)).toHaveLength(2);
  });
});
