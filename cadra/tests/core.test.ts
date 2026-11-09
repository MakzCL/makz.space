import { describe, expect, it } from "vitest";
import { dimGeometry, findSnap, intersections, offsetEnt, trimEnt, type Ent, type V, type Line, type Poly } from "../src/core/geom";
import { Session, arc3, type Input } from "../src/core/cad";

const L = (a: V, b: V, id = Math.random().toString(36)): Line => ({ id, layer: "0", t: "line", a, b });
const close = (p: V, q: V) => { expect(p[0]).toBeCloseTo(q[0], 6); expect(p[1]).toBeCloseTo(q[1], 6); };
const txt = (s: string): Input => ({ k: "text", s });
async function script(s: Session, cmd: string, ins: Input[]) { ins.forEach((i) => s.feed(i)); await s.run(cmd); }

describe("geometry", () => {
  it("intersects line/line, line/circle, line/arc", () => {
    close(intersections(L([0, 0], [10, 10]), L([0, 10], [10, 0]))[0], [5, 5]);
    expect(intersections(L([0, 0], [1, 0]), L([0, 1], [1, 1]))).toHaveLength(0);
    const xs = intersections(L([-10, 0], [10, 0]), { id: "c", layer: "0", t: "circle", c: [0, 0], r: 5 }).sort((a, b) => a[0] - b[0]);
    close(xs[0], [-5, 0]); close(xs[1], [5, 0]);
    const ax = intersections(L([-10, 0], [10, 0]), { id: "a", layer: "0", t: "arc", c: [0, 0], r: 5, a0: -Math.PI / 2, a1: Math.PI / 2 });
    expect(ax).toHaveLength(1); close(ax[0], [5, 0]);
  });
  it("trims the picked part of a line between two cutters", () => {
    const e = L([0, 0], [30, 0], "e"); const out = trimEnt(e, [L([10, -5], [10, 5]), L([20, -5], [20, 5])], [15, 0])!;
    expect(out).toHaveLength(2); close((out[0] as Line).b, [10, 0]); close((out[1] as Line).a, [20, 0]);
    expect(trimEnt(e, [], [15, 0])).toBeNull();
  });
  it("trims a circle into an arc", () => {
    const out = trimEnt({ id: "c", layer: "0", t: "circle", c: [0, 0], r: 5 }, [L([0, -10], [0, 10])], [5, 0])!;
    expect(out[0].t).toBe("arc"); const a = out[0] as Extract<Ent, { t: "arc" }>;
    close([Math.cos(a.a0), Math.sin(a.a0)], [0, 1]); close([Math.cos(a.a1), Math.sin(a.a1)], [0, -1]);
  });
  it("offsets lines, circles and mitred polylines toward the picked side", () => {
    const o = offsetEnt(L([0, 0], [10, 0]), 2, [5, 5]) as Line; close(o.a, [0, 2]); close(o.b, [10, 2]);
    const c = offsetEnt({ id: "c", layer: "0", t: "circle", c: [0, 0], r: 5 }, 2, [0, 1]) as Extract<Ent, { t: "circle" }>; expect(c.r).toBeCloseTo(3);
    const sq: Poly = { id: "p", layer: "0", t: "poly", pts: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
    const big = offsetEnt(sq, 1, [20, 5]) as Poly; close(big.pts[0], [-1, -1]); close(big.pts[2], [11, 11]);
  });
  it("prefers endpoint over nearest snap", () => {
    const s = findSnap([L([0, 0], [10, 0])], [0.4, 0.3], 1, new Set(["end", "near", "mid"]));
    expect(s?.kind).toBe("end"); close(s!.p, [0, 0]);
  });
  it("measures dimensions", () => {
    expect(dimGeometry({ id: "d", layer: "0", t: "dim", kind: "horizontal", p1: [0, 0], p2: [30, 40], at: [0, -10] }).value).toBeCloseTo(30);
    expect(dimGeometry({ id: "d", layer: "0", t: "dim", kind: "aligned", p1: [0, 0], p2: [30, 40], at: [0, -10] }).value).toBeCloseTo(50);
    expect(dimGeometry({ id: "d", layer: "0", t: "dim", kind: "diameter", p1: [0, 0], p2: [5, 0], at: [8, 0] }).text).toMatch(/10/);
  });
  it("finds the arc through three points", () => {
    const a = arc3([5, 0], [0, 5], [-5, 0])!; close(a.c, [0, 0]); expect(a.r).toBeCloseTo(5); expect(arc3([0, 0], [1, 1], [2, 2])).toBeNull();
  });
});

describe("command line", () => {
  it("parses absolute, relative and polar coordinates", () => {
    const s = new Session();
    expect(s.parsePoint("10,20", null)).toEqual([10, 20]);
    expect(s.parsePoint("@5,-5", [10, 10])).toEqual([15, 5]);
    close(s.parsePoint("@10<90", [1, 1])!, [1, 11]);
    close(s.parsePoint("7", [0, 0], [0, 3])!, [0, 7]);
    expect(s.parsePoint("abc", [0, 0])).toBeNull();
  });
  it("draws lines with Close, a rectangle and a circle, and undoes", async () => {
    const s = new Session();
    await script(s, "L", [txt("0,0"), txt("@100,0"), txt("@0,50"), txt("c")]);
    expect(s.d.ents.filter((e) => e.t === "line")).toHaveLength(3); close((s.d.ents[2] as Line).b, [0, 0]);
    await script(s, "rec", [txt("0,0"), txt("@40,20")]); const r = s.d.ents.at(-1) as Poly; expect(r.closed).toBe(true); close(r.pts[2], [40, 20]);
    await script(s, "circle", [txt("50,50"), txt("d"), txt("20")]); expect(s.d.ents.at(-1)).toMatchObject({ t: "circle", r: 10 });
    s.undo(); expect(s.d.ents).toHaveLength(4); s.redo(); expect(s.d.ents).toHaveLength(5);
  });
  it("moves, rotates, copies, mirrors and erases a selection", async () => {
    const s = new Session(); await script(s, "line", [txt("0,0"), txt("10,0"), { k: "enter" }]); const id = s.d.ents[0].id;
    await script(s, "move", [{ k: "pick", id, p: [5, 0] }, { k: "enter" }, txt("0,0"), txt("@5,5")]); close((s.d.ents[0] as Line).a, [5, 5]);
    await script(s, "ro", [{ k: "pick", id, p: [5, 5] }, { k: "enter" }, txt("5,5"), txt("90")]); close((s.d.ents[0] as Line).b, [5, 15]);
    await script(s, "co", [{ k: "pick", id, p: [5, 5] }, { k: "enter" }, txt("0,0"), txt("@10,0"), txt("@20,0"), { k: "enter" }]); expect(s.d.ents).toHaveLength(3);
    await script(s, "mirror", [txt("all"), { k: "enter" }, txt("0,0"), txt("0,10"), txt("y")]); expect(s.d.ents).toHaveLength(3); expect((s.d.ents[0] as Line).a[0]).toBeCloseTo(-5);
    await script(s, "erase", [txt("all"), { k: "enter" }]); expect(s.d.ents).toHaveLength(0);
  });
  it("trims, offsets and dimensions", async () => {
    const s = new Session(); await script(s, "l", [txt("0,0"), txt("30,0"), { k: "enter" }]); await script(s, "l", [txt("10,-5"), txt("10,5"), { k: "enter" }]);
    const h = s.d.ents[0].id; await script(s, "tr", [{ k: "pick", id: h, p: [25, 0] }, { k: "enter" }]); close((s.d.ents.find((e) => e.id === h) as Line).b, [10, 0]);
    await script(s, "o", [txt("3"), { k: "pick", id: h, p: [5, 0] }, txt("5,10"), { k: "enter" }]); close((s.d.ents.at(-1) as Line).a, [0, 3]);
    await script(s, "dli", [txt("0,0"), txt("10,0"), txt("5,-8")]); expect(s.d.ents.at(-1)).toMatchObject({ t: "dim", kind: "horizontal", layer: "Dimensions" });
    expect(s.log.at(-1)).toMatch(/= 10/);
  });
  it("cancels with Esc and reports unknown commands and bad input", async () => {
    const s = new Session(); await script(s, "line", [txt("0,0"), { k: "esc" }]); expect(s.log.at(-1)).toBe("*Cancel*"); expect(s.d.ents).toHaveLength(0);
    await s.run("frobnicate"); expect(s.log.at(-1)).toMatch(/Unknown command/);
    await script(s, "line", [txt("zz"), txt("0,0"), txt("1,1"), { k: "enter" }]); expect(s.log.some((l) => l.startsWith("Invalid point"))).toBe(true); expect(s.d.ents).toHaveLength(1);
  });
  it("refuses to edit objects on locked layers", async () => {
    const s = new Session(); await script(s, "l", [txt("0,0"), txt("1,0"), { k: "enter" }]); s.d.layers[0].locked = true;
    await script(s, "erase", [txt("all"), { k: "enter" }]); expect(s.d.ents).toHaveLength(1);
  });
});
