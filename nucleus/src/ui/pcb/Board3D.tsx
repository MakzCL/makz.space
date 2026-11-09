// 3D board view (loaded on demand): solder-masked FR-4 with plated holes, copper under the mask, exposed pads,
// silkscreen and simple package bodies. Drag to orbit, right-drag to pan, wheel to zoom.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { CU, THICK, type Model3D } from "../../pcb/model3d";

type Cam = "iso" | "top" | "bottom" | "front";
const MASK = "#1d6b3c", MASK_CU = "#2f8f55", GOLD = "#d4ad52", SILK = "#f2f3f5";

export default function Board3D({ model, onClose }: { model: Model3D; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null); const api = useRef<{ view: (c: Cam) => void; show: (k: "bodies" | "silk", v: boolean) => void } | null>(null);
  const [bodies, setBodies] = useState(true); const [silk, setSilk] = useState(true); const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const el = host.current!; let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch { setErr("3D needs WebGL, which this computer's graphics driver does not provide."); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(el.clientWidth, el.clientHeight); el.appendChild(renderer.domElement); renderer.domElement.dataset.testid = "board3d-canvas";
    const scene = new THREE.Scene(); scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0b1033");
    const [W, H] = model.size; const xs = model.outline.map((p) => p[0]), zs = model.outline.map((p) => p[1]); const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const root = new THREE.Group(); root.position.set(-cx, 0, -cz); scene.add(root);
    // board slab with holes: shape in (x, z) extruded along y
    const shape = new THREE.Shape(model.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const h of model.holes) { const p = new THREE.Path(); p.absarc(h.at[0], -h.at[1], h.d / 2, 0, Math.PI * 2, true); shape.holes.push(p); }
    const slab = new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 24 }); slab.rotateX(-Math.PI / 2);
    root.add(new THREE.Mesh(slab, [new THREE.MeshStandardMaterial({ color: MASK, roughness: 0.55 }), new THREE.MeshStandardMaterial({ color: "#c9b98f", roughness: 0.9 })]));
    // copper: tracks under mask (lighter green), pads and via rings exposed (gold)
    const under: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [];
    const ySide = (s: "top" | "bottom") => (s === "top" ? THICK + CU / 2 + 0.002 : -CU / 2 - 0.002);
    const flat = (g: THREE.BufferGeometry, x: number, z: number, y: number, rot = 0) => { g.rotateY(rot); g.translate(x, y, z); return g; };
    for (const c of model.copper) {
      const sides: ("top" | "bottom")[] = c.side === "both" ? ["top", "bottom"] : [c.side];
      for (const s of sides) {
        if (c.kind === "track" && c.b) { const dx = c.b[0] - c.a[0], dz = c.b[1] - c.a[1], L = Math.hypot(dx, dz);
          under.push(flat(new THREE.BoxGeometry(L, CU, c.w), (c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2, ySide(s), -Math.atan2(dz, dx)));
          for (const e of [c.a, c.b]) under.push(flat(new THREE.CylinderGeometry(c.w / 2, c.w / 2, CU, 16), e[0], e[1], ySide(s))); }
        else if (c.kind === "via") gold.push(flat(new THREE.CylinderGeometry(c.w / 2, c.w / 2, CU, 20), c.a[0], c.a[1], ySide(s)));
        else if (c.kind === "pad" && c.b) { const [w, h] = c.b;
          if (c.shape === "circle") gold.push(flat(new THREE.CylinderGeometry(w / 2, w / 2, CU, 24), c.a[0], c.a[1], ySide(s)));
          else if (c.shape === "oval") { const r = Math.min(w, h) / 2, l = Math.abs(w - h); gold.push(flat(new THREE.BoxGeometry(w > h ? l : w, CU, w > h ? h : l), c.a[0], c.a[1], ySide(s)));
            for (const k of [-1, 1]) gold.push(flat(new THREE.CylinderGeometry(r, r, CU, 20), c.a[0] + (w > h ? (k * l) / 2 : 0), c.a[1] + (w > h ? 0 : (k * l) / 2), ySide(s))); }
          else gold.push(flat(new THREE.BoxGeometry(w, CU, h), c.a[0], c.a[1], ySide(s))); }
      }
    }
    for (const h of model.holes) if (h.plated) gold.push(flat(new THREE.CylinderGeometry(h.d / 2 + 0.01, h.d / 2 + 0.01, THICK, 20, 1, true), h.at[0], h.at[1], THICK / 2));
    if (under.length) root.add(new THREE.Mesh(mergeGeometries(under), new THREE.MeshStandardMaterial({ color: MASK_CU, roughness: 0.5 })));
    if (gold.length) root.add(new THREE.Mesh(mergeGeometries(gold), new THREE.MeshStandardMaterial({ color: GOLD, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide })));
    // silkscreen as thin strips
    const silkG: THREE.BufferGeometry[] = [];
    for (const s of model.silk) { const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = Math.hypot(dx, dz); if (L < 1e-6) continue; silkG.push(flat(new THREE.BoxGeometry(L + 0.15, 0.01, 0.15), (s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, s.side === "top" ? THICK + CU + 0.01 : -CU - 0.01, -Math.atan2(dz, dx))); }
    const silkM = silkG.length ? new THREE.Mesh(mergeGeometries(silkG), new THREE.MeshStandardMaterial({ color: SILK, roughness: 0.8 })) : null; if (silkM) root.add(silkM);
    // package bodies and leads
    const parts = new THREE.Group(); root.add(parts);
    for (const b of model.bodies) {
      const [sx, sz, sy] = b.size; const g = new THREE.Group(); const dir = b.side === "top" ? 1 : -1; const base = b.side === "top" ? THICK + CU : -CU;
      const mat = new THREE.MeshStandardMaterial({ color: b.color, roughness: 0.45, metalness: 0.05 }); const topMat = b.top ? new THREE.MeshStandardMaterial({ color: b.top, roughness: 0.4, metalness: 0.3 }) : mat;
      let mesh: THREE.Object3D;
      if (b.kind === "cyl") { const m = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 32), [mat, topMat, mat]); m.position.y = sy / 2; mesh = m; }
      else if (b.kind === "dome") { const r = sx / 2; const grp = new THREE.Group(); const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.08, sy - r, 32), new THREE.MeshPhysicalMaterial({ color: b.color, roughness: 0.15, transmission: 0.3, thickness: 1 })); cyl.position.y = (sy - r) / 2;
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), cyl.material); cap.position.y = sy - r; grp.add(cyl, cap); mesh = grp; }
      else if (b.kind === "cylX") { const m = new THREE.Mesh(new THREE.CylinderGeometry(sz / 2, sz / 2, sx, 24), mat); m.rotation.z = Math.PI / 2; m.position.y = sy / 2; mesh = m; }
      else { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), [mat, mat, topMat, mat, mat, mat]); m.position.y = sy / 2; mesh = m; }
      g.add(mesh); g.position.set(b.at[0], base + dir * b.lift, b.at[1]); g.rotation.y = (b.rotDeg * Math.PI) / 180; if (dir < 0) g.scale.y = -1; g.userData.ref = b.ref; parts.add(g);
    }
    const pinG = new Map<string, THREE.BufferGeometry[]>(); for (const p of model.pins) { const l = pinG.get(p.color) ?? []; l.push(flat(new THREE.BoxGeometry(p.size[0], p.h, p.size[1]), p.at[0], p.at[1], p.side === "top" ? THICK + p.h / 2 : -p.h / 2)); pinG.set(p.color, l); }
    for (const [col, gs] of pinG) parts.add(new THREE.Mesh(mergeGeometries(gs), new THREE.MeshStandardMaterial({ color: col, metalness: 0.8, roughness: 0.3 })));
    // light and camera
    scene.add(new THREE.HemisphereLight("#ffffff", "#30364f", 1.6)); const sun = new THREE.DirectionalLight("#ffffff", 2.2); sun.position.set(W, Math.max(W, H) * 1.5, H); scene.add(sun); const fill = new THREE.DirectionalLight("#b8c4ff", 0.7); fill.position.set(-W, -Math.max(W, H), -H); scene.add(fill);
    const R = Math.hypot(W, H); const cam = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, R / 100, R * 20);
    const ctl = new OrbitControls(cam, renderer.domElement); ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.screenSpacePanning = true; ctl.maxDistance = R * 8; ctl.minDistance = R / 20;
    const view = (c: Cam) => { const d = R * 1.6; const p = { iso: [d * 0.55, d * 0.75, d * 0.75], top: [0, d, 0.001], bottom: [0, -d, 0.001], front: [0, d * 0.25, d] }[c]; cam.position.set(p[0], p[1], p[2]); cam.up.set(0, 1, 0); ctl.target.set(0, THICK / 2, 0); ctl.update(); };
    view("iso");
    api.current = { view, show: (k, v) => { if (k === "bodies") parts.visible = v; else if (silkM) silkM.visible = v; } };
    let raf = 0; const loop = () => { raf = requestAnimationFrame(loop); ctl.update(); renderer.render(scene, cam); }; loop();
    const ro = new ResizeObserver(() => { const w = el.clientWidth, h = el.clientHeight; if (!w || !h) return; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }); ro.observe(el);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); ctl.dispose(); scene.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); const mt = m.material; (Array.isArray(mt) ? mt : mt ? [mt] : []).forEach((x) => x.dispose()); }); renderer.dispose(); renderer.domElement.remove(); api.current = null; };
  }, [model]);
  useEffect(() => { api.current?.show("bodies", bodies); }, [bodies]); useEffect(() => { api.current?.show("silk", silk); }, [silk]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="n-3d" role="dialog" aria-label="3D board view" data-testid="board3d">
      <div className="n-3dbar">
        <b>3D view</b><span className="n-dim">{model.size[0].toFixed(1)} × {model.size[1].toFixed(1)} × {THICK} mm · {model.bodies.length} parts · drag to orbit, right-drag to pan, wheel to zoom</span>
        <span className="n-3dsp" />
        {(["iso", "top", "bottom", "front"] as Cam[]).map((c) => <button key={c} type="button" className="n-btn" onClick={() => api.current?.view(c)} data-testid={`board3d-${c}`}>{{ iso: "Isometric", top: "Top", bottom: "Bottom", front: "Front" }[c]}</button>)}
        <label className="n-chk"><input type="checkbox" checked={bodies} onChange={(e) => setBodies(e.target.checked)} />Components</label>
        <label className="n-chk"><input type="checkbox" checked={silk} onChange={(e) => setSilk(e.target.checked)} />Silkscreen</label>
        <button type="button" className="n-btn" onClick={onClose} data-testid="board3d-close">Close</button>
      </div>
      {err ? <div className="n-3derr">{err}</div> : <div className="n-3dhost" ref={host} />}
    </div>
  );
}
