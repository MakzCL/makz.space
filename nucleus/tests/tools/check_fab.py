# Independent check of NUCLEUS fabrication files with gerbonara: prints a JSON summary per file.
import json, sys, os
from gerbonara import GerberFile, ExcellonFile
from gerbonara.graphic_objects import Flash, Line, Region
from gerbonara.utils import MM
d = sys.argv[1]; out = {}
for f in sorted(os.listdir(d)):
    p = os.path.join(d, f)
    if f.endswith('.gbr'):
        g = GerberFile.open(p)
        fl = [o for o in g.objects if isinstance(o, Flash)]; ln = [o for o in g.objects if isinstance(o, Line)]
        (x0, y0), (x1, y1) = g.bounding_box(MM) if not g.is_empty else ((0, 0), (0, 0))
        rg = [o for o in g.objects if isinstance(o, Region)]
        out[f] = {"flashes": len(fl), "lines": len(ln), "regions": len(rg), "dark_regions": sum(1 for o in rg if o.polarity_dark), "bbox": [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)],
                  "apertures": sorted({type(o.aperture).__name__ for o in g.objects if hasattr(o, 'aperture')})}
    elif f.endswith('.drl'):
        e = ExcellonFile.open(p)
        hits = list(e.drills())
        out[f] = {"hits": len(hits), "sizes_mm": sorted({round(h.tool.diameter, 4) for h in hits})}
print(json.dumps(out))
