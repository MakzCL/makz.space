import { describe, expect, it } from "vitest";
import { dimGeometry, extendEnt, filletLines, chamferLines, type Line, type Arc, type V } from "../src/core/geom";
import { Session, type Input } from "../src/core/cad";
const L = (a: V, b: V, id = Math.random().toString(36)): Line => ({ id, layer: "0", t: "line", a, b });
const close = (p: V, q: V) => { expect(p[0]).toBeCloseTo(q[0], 6); expect(p[1]).toBeCloseTo(q[1], 6); };
const txt = (s: string): Input => ({ k: "text", s });
async function script(s: Session, cmd: string, ins: Input[]) { ins.forEach((i) => s.feed(i)); await s.run(cmd); }

describe("extend, fillet, chamfer, angular dimension", () => {
  it("extends a line to the nearest boundary in the picked direction", () => {
    const e = extendEnt(L([0, 0], [5, 0], "e"), [L([10, -5], [10, 5]), L([20, -5], [20, 5])], [4, 0]) as Line; close(e.b, [10, 0]); close(e.a, [0, 0]);
    const back = extendEnt(L([0, 0], [5, 0], "e"), [L([-3, -5], [-3, 5])], [1, 0]) as Line; close(back.a, [-3, 0]);
    expect(extendEnt(L([0, 0], [5, 0], "e"), [L([10, 1], [10, 5])], [4, 0])).toBeNull(); // boundary misses the line's path
  });
  it("extends an arc to a line", () => {
    const a: Arc = { id: "a", layer: "0", t: "arc", c: [0, 0], r: 10, a0: 0, a1: Math.PI / 4 };
    const e = extendEnt(a, [L([-20, 0.0001 + 0], [20, 0]), L([0, 0], [0, 20])], [7, 7]) as Arc; expect(e.a1).toBeCloseTo(Math.PI / 2, 6);
  });
  it("fillets a square corner with radius 2: tangent points and centre", () => {
    const r = filletLines(L([0, 0], [10, 0]), L([10, 0], [10, 10]), 2, [2, 0], [10, 8]); if (typeof r === "string") throw new Error(r);
    close(r.l1.b, [8, 0]); close(r.l2.a, [10, 2]); close(r.arc!.c, [8, 2]); expect(r.arc!.r).toBe(2);
    expect(((r.arc!.a1 - r.arc!.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(Math.PI / 2, 6);
    expect(filletLines(L([0, 0], [10, 0]), L([10, 0], [10, 10]), 50, [2, 0], [10, 8])).toMatch(/too large/);
    expect(filletLines(L([0, 0], [10, 0]), L([0, 1], [10, 1]), 1, [1, 0], [1, 1])).toMatch(/parallel/);
  });
  it("radius 0 fillet joins lines that do not meet", () => {
    const r = filletLines(L([0, 0], [8, 0]), L([10, 2], [10, 10]), 0, [1, 0], [10, 9]); if (typeof r === "string") throw new Error(r); close(r.l1.b, [10, 0]); close(r.l2.a, [10, 0]); expect(r.arc).toBeNull();
  });
  it("chamfers a corner with two distances", () => {
    const r = chamferLines(L([0, 0], [10, 0]), L([10, 0], [10, 10]), 3, 2, [1, 0], [10, 9]); if (typeof r === "string") throw new Error(r);
    close(r.edge.a, [7, 0]); close(r.edge.b, [10, 2]);
  });
  it("measures the angle between two lines on the picked side", () => {
    const g = dimGeometry({ id: "d", layer: "0", t: "dim", kind: "angular", c: [0, 0], p1: [10, 0], p2: [0, 10], at: [5, 5] }); expect(g.value).toBeCloseTo(90); expect(g.text).toBe("90°");
    const g2 = dimGeometry({ id: "d", layer: "0", t: "dim", kind: "angular", c: [0, 0], p1: [10, 0], p2: [0, 10], at: [-5, -5] }); expect(g2.value).toBeCloseTo(270);
  });
});

describe("new commands", () => {
  it("FILLET with the Radius option, CHAMFER with Distance", async () => {
    const s = new Session(); await script(s, "l", [txt("0,0"), txt("10,0"), txt("10,10"), { k: "enter" }]); const [a, b] = s.d.ents;
    await script(s, "f", [txt("r"), txt("2"), { k: "pick", id: a.id, p: [2, 0] }, { k: "pick", id: b.id, p: [10, 8] }]);
    expect(s.d.ents.find((e) => e.t === "arc")).toMatchObject({ r: 2 }); expect(s.filletR).toBe(2);
    const t = new Session(); await script(t, "l", [txt("0,0"), txt("10,0"), txt("10,10"), { k: "enter" }]); const [c, d] = t.d.ents;
    await script(t, "cha", [txt("d"), txt("3"), txt("3"), { k: "pick", id: c.id, p: [1, 0] }, { k: "pick", id: d.id, p: [10, 9] }]); expect(t.d.ents).toHaveLength(3);
  });
  it("EXTEND repeats until Enter", async () => {
    const s = new Session(); await script(s, "l", [txt("20,-5"), txt("20,5"), { k: "enter" }]); await script(s, "l", [txt("0,1"), txt("5,1"), { k: "enter" }]); await script(s, "l", [txt("0,-1"), txt("5,-1"), { k: "enter" }]);
    const [, x, y] = s.d.ents; await script(s, "ex", [{ k: "pick", id: x.id, p: [4, 1] }, { k: "pick", id: y.id, p: [4, -1] }, { k: "enter" }]);
    expect((s.d.ents[1] as Line).b[0]).toBeCloseTo(20); expect((s.d.ents[2] as Line).b[0]).toBeCloseTo(20);
  });
  it("ARRAYRECT and ARRAYPOLAR make the right number of copies in the right places", async () => {
    const s = new Session(); await script(s, "c", [txt("0,0"), txt("1")]);
    await script(s, "ar", [txt("all"), { k: "enter" }, txt("2"), txt("3"), txt("10"), txt("5")]); expect(s.d.ents).toHaveLength(6);
    expect(s.d.ents.map((e) => (e as { c: V }).c.join(",")).sort()).toEqual(["0,0", "0,10", "10,0", "10,10", "5,0", "5,10"].sort());
    const t = new Session(); await script(t, "c", [txt("10,0"), txt("1")]); await script(t, "pa", [txt("all"), { k: "enter" }, txt("0,0"), txt("4"), txt("360")]);
    expect(t.d.ents).toHaveLength(4); close((t.d.ents[2] as { c: V }).c, [-10, 0]);
  });
  it("DIMANGULAR between two lines", async () => {
    const s = new Session(); await script(s, "l", [txt("0,0"), txt("10,0"), { k: "enter" }]); await script(s, "l", [txt("0,0"), txt("@10<60"), { k: "enter" }]);
    const [a, b] = s.d.ents; await script(s, "dan", [{ k: "pick", id: a.id, p: [8, 0] }, { k: "pick", id: b.id, p: [4, 7] }, txt("@6<30")]); expect(s.log.at(-1)).toMatch(/= 60°/);
  });
});
