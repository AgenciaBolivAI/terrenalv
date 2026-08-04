"""Turn the CAD plano into the seed geometry.

Pipeline:
  1. pdf_layers  — walk the content stream keeping CAD layer membership, so lot
                   outlines are not mixed with dimension lines or hatching.
  2. node+faces  — the export draws each boundary as loose segments; split them
                   at touching endpoints and recover the planar faces = lots.
  3. labels      — PyMuPDF decodes the CAD text; a lot takes the number printed
                   inside it, a manzana the "M-nn" printed inside its lots.
  4. metres      — 1:1500, so 1 m = 72/25.4/1500*1000 = 1.88976 pt. Verified: the
                   median face comes out at 300.0 m², the plano's stated lot.

Writes cad/plano.json: manzanas, each with kind, ring and lots (number, ring,
frontage, depth, area) — all in metres, +X east, +Y north, origin at the site's
south-west corner.
"""
import json
import math
import re
import sys
from collections import Counter, defaultdict

import fitz
import numpy as np
from shapely.geometry import MultiPoint, Polygon
from shapely.ops import unary_union

sys.path.insert(0, 'cad')
import build_lots as BL
from pdf_layers import extract

PDF = 'cad/Urb. Ciudadela Prados del Sur_13-05-25.pdf'
PT_PER_M = 72.0 / 25.4 / 1500 * 1000

# Connectivity tolerances. These only decide which endpoints are the SAME
# vertex; the coordinates kept are the originals, so precision is unaffected.
# 1.0 pt = 0.53 m, far below the 10 m spacing between lot lines.
SNAP, TOL = 1.0, 2.0

LOT_LAYER = 'Urb. Dorita II - Lotes - Area Util'
VERDE = 'Urb. Dorita II - Manzano - Area Verde'
EQUIP = 'Urb. Dorita II - Manzano - Area Equipamiento'
FERREA = 'Lev - Linea Ferrea'

# Areas the plano prints for the manzanas that carry no lots. Used only to pick
# which of the overlapping faces on the hatch layers is actually the block.
RESERVED_M2 = {
    'M-16': 7163.25, 'M-31': 7311.72, 'M-49': 9202.53, 'M-54': 8271.84,
    'M-67': 11040.96, 'M-77': 22422.23, 'M-79': 10559.88, 'M-84': 1891.29,
    'M-85': 8641.31, 'M-88': 13146.60,
}


def layers():
    out, names = extract(PDF)
    by = defaultdict(list)
    for xref, segs in out.segments.items():
        by[names.get(xref)].extend(segs)
    return by


def faces(segs, lo_m2, hi_m2):
    BL.SNAP, BL.TOL = SNAP, TOL
    rings = []
    for r in BL.faces_of(BL.node_segments(segs)):
        a = abs(BL.area(r)) / PT_PER_M ** 2
        if lo_m2 <= a <= hi_m2:
            c = BL.clean_ring(r, eps=0.05)
            if len(c) >= 3:
                rings.append(c)
    return rings


def main():
    by = layers()
    doc = fitz.open(PDF)
    page = doc[0]
    H = page.rect.height

    def flip(r):
        return [(x, H - y) for x, y in r]

    lot_rings = [flip(r) for r in faces(by[LOT_LAYER], 30, 5000)]
    print('lot faces            :', len(lot_rings))

    # Labels, in page space.
    mz_labels, num_labels = [], []
    for w in page.get_text('words'):
        t = w[4].strip()
        c = ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2)
        if re.fullmatch(r'M-?\d{1,3}', t):
            mz_labels.append((c[0], c[1], 'M-' + re.sub(r'\D', '', t)))
        elif re.fullmatch(r'\d{1,3}', t):
            num_labels.append((c[0], c[1], t))
    print('manzana labels       :', len(mz_labels))
    print('number labels        :', len(num_labels))

    polys = [Polygon(r) for r in lot_rings]
    for i, p in enumerate(polys):
        if not p.is_valid:
            polys[i] = p.buffer(0)

    bb = np.array([p.bounds for p in polys])

    def containing(cx, cy):
        cand = np.nonzero((bb[:, 0] - 0.5 <= cx) & (bb[:, 2] + 0.5 >= cx) &
                          (bb[:, 1] - 0.5 <= cy) & (bb[:, 3] + 0.5 >= cy))[0]
        for i in cand:
            if BL.inside((cx, cy), lot_rings[i]):
                return int(i)
        return None

    # lot number for each face
    lot_number = {}
    for (cx, cy, t) in num_labels:
        i = containing(cx, cy)
        if i is not None and i not in lot_number:
            lot_number[i] = t
    print('faces numbered       :', len(lot_number))

    # manzana code for each face: the M-nn label sits inside one of its lots, so
    # flood-fill the code across lots that touch.
    owner = {}
    for (cx, cy, code) in mz_labels:
        i = containing(cx, cy)
        if i is not None:
            owner[i] = code

    tree_idx = defaultdict(list)
    CELL = 40.0
    for i, p in enumerate(polys):
        x0, y0, x1, y1 = p.bounds
        for gx in range(int(x0 // CELL), int(x1 // CELL) + 1):
            for gy in range(int(y0 // CELL), int(y1 // CELL) + 1):
                tree_idx[(gx, gy)].append(i)

    def neighbours(i):
        p = polys[i]
        x0, y0, x1, y1 = p.bounds
        seen = set()
        for gx in range(int(x0 // CELL) - 1, int(x1 // CELL) + 2):
            for gy in range(int(y0 // CELL) - 1, int(y1 // CELL) + 2):
                seen.update(tree_idx.get((gx, gy), ()))
        out = []
        for j in seen:
            if j == i:
                continue
            if p.distance(polys[j]) < 1.0:          # < 0.53 m apart ⇒ same manzana
                out.append(j)
        return out

    assigned = dict(owner)
    frontier = list(owner.keys())
    while frontier:
        nxt = []
        for i in frontier:
            for j in neighbours(i):
                if j not in assigned:
                    assigned[j] = assigned[i]
                    nxt.append(j)
        frontier = nxt
    print('faces assigned to mz :', len(assigned), 'of', len(polys))

    groups = defaultdict(list)
    for i, code in assigned.items():
        groups[code].append(i)

    # área verde / equipamiento manzanas carry no lots.
    extra = []
    for layer, kind in ((VERDE, 'area_verde'), (EQUIP, 'equipamiento')):
        for r in faces(by[layer], 1500, 60000):
            extra.append((kind, flip(r)))
    print('verde/equip faces    :', len(extra))

    # ---- to metres, origin at the SW corner of everything we keep ----------
    allpts = [p for r in lot_rings for p in r] + [p for _, r in extra for p in r]
    minx = min(p[0] for p in allpts)
    maxy = max(p[1] for p in allpts)

    def m(r):
        return [[round((x - minx) / PT_PER_M, 2), round((maxy - y) / PT_PER_M, 2)] for x, y in r]

    def dims(ring_m):
        """Frontage and depth from the oriented bounding box."""
        pts = np.array(ring_m)
        best = None
        for i in range(len(pts)):
            d = pts[(i + 1) % len(pts)] - pts[i]
            n = np.hypot(*d)
            if n < 1e-6:
                continue
            u = d / n
            v = np.array([-u[1], u[0]])
            pu = pts @ u
            pv = pts @ v
            w, h = pu.max() - pu.min(), pv.max() - pv.min()
            if best is None or w * h < best[0]:
                best = (w * h, w, h)
        if not best:
            return (0.0, 0.0)
        _, w, h = best
        return (round(min(w, h), 2), round(max(w, h), 2))

    manzanas = []
    for code, idxs in sorted(groups.items(), key=lambda kv: int(kv[0][2:])):
        lots = []
        for i in idxs:
            rm = m(lot_rings[i])
            f, d = dims(rm)
            lots.append({
                'number': lot_number.get(i),
                'ring': rm,
                'frontage_m': f,
                'depth_m': d,
                'area_m2': round(Polygon(rm).area, 2),
            })
        u = unary_union([polys[i] for i in idxs]).buffer(0.4).buffer(-0.4)
        if u.geom_type == 'MultiPolygon':
            u = max(u.geoms, key=lambda g: g.area)
        ring = m(list(u.exterior.coords)[:-1])
        manzanas.append({'code': code, 'kind': 'residencial', 'ring': ring, 'lots': lots})

    # Kind comes from the plano's own "AREA VERDE" / "AREA EQUIPAMIENTO" text,
    # attributed to the nearest M-nn label. Guessing by proximity to a polygon
    # mislabelled M-84, which the sheet marks equipamiento.
    label_pos = {c: (x, y) for x, y, c in mz_labels}
    kind_by_code = {}
    for w in page.get_text('words'):
        t = w[4].upper()
        kind = 'area_verde' if t.startswith('VERDE') else 'equipamiento' if t.startswith('EQUIPAM') else None
        if not kind:
            continue
        cx, cy = (w[0] + w[2]) / 2, (w[1] + w[3]) / 2
        best, bd = None, 1e18
        for code, (mx, my) in label_pos.items():
            d = math.hypot(mx - cx, my - cy)
            if d < bd:
                best, bd = code, d
        if best and bd < 80:            # the label sits inside its own manzana
            kind_by_code[best] = kind
    print('kinds from plano text:', {k: kind_by_code[k] for k in sorted(kind_by_code, key=lambda c: int(c[2:]))})

    # A manzana with lots is residential regardless (M-77 and M-79 carry both
    # sellable lots and a reserved area on the sheet's own summary table).
    for mzn in manzanas:
        if not mzn['lots'] and mzn['code'] in kind_by_code:
            mzn['kind'] = kind_by_code[mzn['code']]

    # The reserved manzanas have no lots at all, so take their outline from the
    # verde/equipamiento layers: the face that CONTAINS the M-nn label.
    used = {mz['code'] for mz in manzanas}
    for code in [f'M-{i}' for i in range(1, 89) if f'M-{i}' not in used]:
        if code not in label_pos:
            print('  no label for', code)
            continue
        cx, cy = label_pos[code]
        # These layers carry a hatch symbol inside the block AND, in places, a
        # larger enclosing region, so several faces contain the label. Neither
        # "smallest" nor "largest" is right — smallest gave M-67 the hatch glyph
        # (24% of its area), largest gave M-84 831%. The sheet prints the area of
        # every reserved manzana, so pick the containing face that matches it.
        # Candidates: faces containing the label, plus any face close to it —
        # on a small block like M-84 the "M-84" text is printed 15 m OUTSIDE the
        # polygon, so containment alone finds nothing. Among the candidates take
        # the one whose area matches what the sheet prints; several faces overlap
        # because these layers also carry a hatch symbol.
        want = RESERVED_M2.get(code)
        probe = Polygon([(cx - 0.1, cy - 0.1), (cx + 0.1, cy - 0.1), (cx + 0.1, cy + 0.1)])
        pick = None
        for kind, r in extra:
            poly = Polygon(r)
            d_m = poly.distance(probe) / PT_PER_M
            if not (BL.inside((cx, cy), r) or d_m < 60):
                continue
            a = poly.area / PT_PER_M ** 2
            err = abs(a - want) / want if want else -a
            if pick is None or err < pick[3]:
                pick = (kind, r, a, err)
        if pick and want and pick[3] > 0.15:
            print(f'  {code}: best face {pick[2]:.0f} m2 vs plano {want:.0f} m2 — descartada')
            pick = None
        review = False
        if pick is None:
            # No closed face contains the label — M-77's boundary is drawn as an
            # open polyline and never closes on any layer. Taking the nearest
            # face instead handed it a COPY of M-79's polygon, so two manzanas
            # sat on top of each other. Fall back to the convex hull of the real
            # linework around the label: still the surveyor's geometry, just not
            # a closed ring, and flagged for review.
            kind = kind_by_code.get(code, 'area_verde')
            layer = VERDE if kind == 'area_verde' else EQUIP
            near = []
            for (x1, y1, x2, y2) in by[layer]:
                for (px, py) in ((x1, H - y1), (x2, H - y2)):
                    if abs(px - cx) < 420 and abs(py - cy) < 260:
                        near.append((px, py))
            if len(near) < 3:
                print('  cannot place', code)
                continue
            hull = MultiPoint(near).convex_hull
            if hull.geom_type != 'Polygon':
                print('  cannot place', code)
                continue
            pick = (kind, list(hull.exterior.coords)[:-1], hull.area, 1.0)
            review = True
        manzanas.append({
            'code': code,
            'kind': kind_by_code.get(code, pick[0]),
            'ring': m(pick[1]),
            'lots': [],
            'needs_review': review,
        })

    manzanas.sort(key=lambda mz: int(mz['code'][2:]))

    # ---- elements: streets, railway, highway — from the CAD, same frame -----
    # The first publish shipped elements:[] and the old invented street grid
    # survived a rolled-back delete, so the Trillo and calles sat at positions
    # from the superseded parametric model. Everything below comes from the
    # survey layers, converted with the SAME m() transform as the lots.

    def to_m_pts(segs):
        pts = []
        for (x1, y1, x2, y2) in segs:
            for (px, py) in ((x1, y1), (x2, y2)):
                pts.append(((px - minx) / PT_PER_M, (maxy - (H - py)) / PT_PER_M))
        return pts

    def orient_rect(pts, width=None, pad=0.0):
        """Oriented bounding rectangle of a point cloud (metres)."""
        P = np.array(pts)
        c = P.mean(0)
        _, _, Vt = np.linalg.svd(P - c)
        ax, pp = Vt[0], Vt[1]
        t = (P - c) @ ax
        s = (P - c) @ pp
        t0, t1 = t.min() - pad, t.max() + pad
        s0, s1 = (-width / 2, width / 2) if width else (s.min(), s.max())
        return [[round(v[0], 2), round(v[1], 2)] for v in
                (c + t0 * ax + s0 * pp, c + t1 * ax + s0 * pp,
                 c + t1 * ax + s1 * pp, c + t0 * ax + s1 * pp)]

    elements = []

    # Street mat: the streets ARE the space between manzanas, so close the
    # union of all manzanas (28 m shuts every 13–30 m street) and paint it as
    # calle underneath — ElementsLayer renders before ManzanaGroup, and
    # manzanas have opaque fills.
    mz_polys = []
    for mz in manzanas:
        p = Polygon(mz['ring'])
        mz_polys.append(p if p.is_valid else p.buffer(0))
    union = unary_union(mz_polys)
    closed = union.buffer(28).buffer(-28).simplify(0.5)
    mats = list(closed.geoms) if closed.geom_type == 'MultiPolygon' else [closed]
    for g in mats:
        ring = [[round(x, 2), round(y, 2)] for x, y in list(g.exterior.coords)[:-1]]
        elements.append({'kind': 'calle', 'name': 'Calle S/N', 'ring': ring, 'props': {}})

    # Áreas verdes that belong to no reserved manzana (the two at the west
    # ends of M-3/M-4). Skip faces inside a manzana we already emitted.
    for kind, r in extra:
        rm = [(x - 0, y - 0) for x, y in [( (px - minx) / PT_PER_M, (maxy - py) / PT_PER_M ) for px, py in r]]
        c = (sum(p[0] for p in rm) / len(rm), sum(p[1] for p in rm) / len(rm))
        if any(BL.inside(c, mz['ring']) for mz in manzanas if not mz['lots']):
            continue
        if kind == 'area_verde' and 1500 <= Polygon(rm).area <= 5000:
            elements.append({'kind': 'area_verde', 'name': 'Área Verde',
                             'ring': [[round(x, 2), round(y, 2)] for x, y in rm], 'props': {}})

    # Railway: the survey's own track (Lev - Linea Ferrea), a tilted band
    # crossing the strip near the east end — not the straight corridor the old
    # model invented. Width comes from the drawn band itself.
    fer = to_m_pts(by[FERREA])
    if fer:
        P = np.array(fer)
        cmean = P.mean(0)
        _, _, Vt = np.linalg.svd(P - cmean)
        spread = ((P - cmean) @ Vt[1])
        w = float(spread.max() - spread.min())
        elements.append({'kind': 'avenida', 'name': 'Trillo (vía férrea)',
                         'ring': orient_rect(fer, width=max(w, 6.0), pad=15.0),
                         'props': {'railway': True, 'width_m': round(max(w, 6.0), 1)}})
        print('railway band width   : %.1f m' % w)

    # Highway: its west edge is the full-height diagonal on the Manzano - Area
    # Util layer just east of M-1/M-2; the sheet labels the corridor
    # "SANTA CRUZ - CAMIRI 100.00". Extend 100 m east of that edge.
    # Two ~860 pt diagonals live on this layer: one bounding the body at the
    # railway, one east of M-1/M-2. The highway is the EASTERNMOST.
    edges = [s for s in by['Urb. Dorita II - Manzano - Area Util']
             if math.hypot(s[2] - s[0], s[3] - s[1]) > 700]
    if edges:
        (x1, y1, x2, y2) = max(edges, key=lambda s: max(s[0], s[2]))
        a = ((x1 - minx) / PT_PER_M, (maxy - (H - y1)) / PT_PER_M)
        b = ((x2 - minx) / PT_PER_M, (maxy - (H - y2)) / PT_PER_M)
        d = np.array(b) - np.array(a)
        d = d / np.hypot(*d)
        n = np.array([d[1], -d[0]])
        if n[0] < 0:
            n = -n                      # east of the edge
        W = 100.0
        ring = [a, b, tuple(np.array(b) + n * W), tuple(np.array(a) + n * W)]
        elements.append({'kind': 'avenida', 'name': 'Carretera Santa Cruz — Camiri',
                         'ring': [[round(x, 2), round(y, 2)] for x, y in ring],
                         'props': {'highway': True, 'width_m': W}})
        print('highway edge         : (%.0f,%.0f)->(%.0f,%.0f) m' % (a[0], a[1], b[0], b[1]))

    for g in mats:
        ring = [[round(x, 2), round(y, 2)] for x, y in list(g.exterior.coords)[:-1]]
        elements.append({'kind': 'perimetro', 'name': 'Perímetro', 'ring': ring, 'props': {}})

    total_lots = sum(len(mz['lots']) for mz in manzanas)
    print()
    print('manzanas             :', len(manzanas))
    print('lots                 :', total_lots)
    print('elements             :', len(elements),
          Counter(e['kind'] for e in elements))
    json.dump({'manzanas': manzanas, 'elements': elements},
              open('cad/plano.json', 'w'), separators=(',', ':'))
    print('wrote cad/plano.json')


if __name__ == '__main__':
    main()
