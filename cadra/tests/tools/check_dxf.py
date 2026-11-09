# Validate CADRA's DXF with ezdxf (independent reader) and write an ezdxf-made R2018 file for the import test.
import sys, ezdxf
from ezdxf import recover
doc, aud = recover.readfile(sys.argv[1])
errs = [str(e) for e in aud.errors]
msp = doc.modelspace(); cnt = {}
for e in msp: cnt[e.dxftype()] = cnt.get(e.dxftype(), 0) + 1
print("version", doc.dxfversion, "errors", len(errs), errs[:5]); print("entities", cnt); print("layers", sorted(l.dxf.name for l in doc.layers))
c = next(e for e in msp if e.dxftype() == "CIRCLE"); assert abs(c.dxf.radius - 25) < 1e-9 and tuple(c.dxf.center)[:2] == (60, 40)
assert not errs, errs
n = ezdxf.new("R2018", setup=True); n.layers.add("WALLS", color=1); m = n.modelspace()
m.add_line((0, 0), (100, 0), dxfattribs={"layer": "WALLS"}); m.add_circle((50, 50), 10); m.add_arc((0, 0), 20, 0, 90)
m.add_lwpolyline([(0, 0), (10, 0), (10, 10)], close=True); m.add_text("Hello", height=3).set_placement((5, 5)); m.add_mtext("Multi\\Pline", dxfattribs={"char_height": 2})
h = m.add_hatch(color=2); h.paths.add_polyline_path([(0, 0), (20, 0), (20, 20), (0, 20)], is_closed=True)
m.add_linear_dim(base=(0, -10), p1=(0, 0), p2=(100, 0)).render()
n.saveas(sys.argv[2]); print("wrote", sys.argv[2])
