"""cad/plano.json -> seed/generated-geometry.json

Replaces the generated layout entirely: manzanas, lots, numbering and dimensions
now come from the surveyor's own CAD file, not from a pattern.
"""
import json
from collections import Counter

from shapely.geometry import Polygon

PLANO = 'cad/plano.json'
OUT = 'seed/generated-geometry.json'

# Grid ticks printed on the sheet put the site's SW corner here (EPSG:32720).
UTM = {'epsg': 32720, 'offsetE': 477400.0, 'offsetN': 7979700.0}


# Neighbouring lots share an edge that is not always coincident to the
# millimetre in the source, and rounding to centimetres can push it the wrong
# way. The database rejects ANY overlap, so lots are shrunk by 2 cm — slivers
# were up to a couple of cm wide. area_m2 is taken from the ORIGINAL polygon,
# so the recorded surface is unaffected; only the drawn ring moves 2 cm inward.
SHRINK_M = 0.02


def repair(ring, shrink=0.0):
    """Return a valid, positive-area ring, or None.

    A handful of faces come out self-intersecting where the CAD linework doubles
    back on itself. buffer(0) resolves those; anything still broken is dropped
    rather than pushed into the database.
    """
    p = Polygon(ring)
    if not p.is_valid or p.area <= 0:
        p = p.buffer(0)
        if p.is_empty:
            return None
        if p.geom_type == 'MultiPolygon':
            p = max(p.geoms, key=lambda g: g.area)
    if shrink:
        q = p.buffer(-shrink, join_style=2)
        if not q.is_empty and q.geom_type == 'Polygon' and q.area > 0:
            p = q
        elif not q.is_empty and q.geom_type == 'MultiPolygon':
            p = max(q.geoms, key=lambda g: g.area)
    if not p.is_valid or p.area <= 0:
        return None
    return [[round(x, 3), round(y, 3)] for x, y in list(p.exterior.coords)[:-1]]


def sector_for(x, width):
    if x > width * 0.92:
        return 'Acceso'
    if x > width * 0.66:
        return 'Este'
    if x > width * 0.33:
        return 'Centro'
    return 'Oeste'


def main():
    D = json.load(open(PLANO, encoding='utf-8'))
    mzs = D['manzanas']
    width = max(p[0] for m in mzs for p in m['ring'])

    out = []
    total = 0
    unnumbered = 0
    dropped = []
    enclosing = []
    for m in mzs:
        ring = repair(m['ring'])
        if ring is None:
            print('  descartada (anillo invalido):', m['code'])
            continue
        cx = sum(p[0] for p in ring) / len(ring)

        # Corner lots are the wider ones on this plano (12 m against 10 m); the
        # CAD marks them on a separate layer but that layer also carries the
        # corner-radius arcs, so the frontage is the reliable signal.
        fronts = [l['frontage_m'] for l in m['lots'] if l['frontage_m']]
        modal = Counter(round(f, 1) for f in fronts).most_common(1)[0][0] if fronts else 0

        lots = []
        for i, l in enumerate(sorted(m['lots'], key=lambda l: (int(l['number']) if l['number'] and l['number'].isdigit() else 10**6))):
            num = l['number']
            if not num:
                unnumbered += 1
                num = f'S{i + 1}'          # sin número en el plano
            lring = repair(l['ring'], SHRINK_M)
            if lring is None:
                dropped.append(f"{m['code']}/{num}")
                continue
            lots.append({
                'number': str(num),
                'ring': lring,
                'frontage_m': l['frontage_m'],
                'depth_m': l['depth_m'],
                'area_m2': l['area_m2'],
                'is_corner': bool(fronts) and round(l['frontage_m'], 1) > modal + 0.4,
            })
        # The face walk sometimes also returns the region ENCLOSING a run of
        # lots (M-1 "13" swallowed thirteen of its neighbours whole). Those are
        # not lots, and the database rejects the overlap outright. Drop any
        # polygon that contains another one.
        polys = [Polygon(l['ring']) for l in lots]
        drop = set()
        for a in range(len(polys)):
            for b in range(len(polys)):
                if a == b or a in drop or b in drop:
                    continue
                if polys[a].area <= polys[b].area:
                    continue
                inter = polys[a].intersection(polys[b]).area
                if inter > 0.95 * polys[b].area:
                    drop.add(a)
        if drop:
            enclosing.extend(f"{m['code']}/{lots[i]['number']}" for i in sorted(drop))
            lots = [l for i, l in enumerate(lots) if i not in drop]
        total += len(lots)

        out.append({
            'code': m['code'],
            'sector': sector_for(cx, width),
            'kind': m['kind'],
            'ring': ring,
            'subdivision_spec': {'origen': 'cad', 'archivo': 'Urb. Ciudadela Prados del Sur_13-05-25.dwg'},
            # Only the manzanas we could not lift cleanly need a human to look.
            'needs_review': bool(m.get('needs_review')) or len(lots) == 0 and m['kind'] == 'residencial',
            'lots': lots,
        })

    out.sort(key=lambda m: int(m['code'][2:]))
    json.dump({
        'generated_at': '2026-08-03T00:00:00Z',
        'utm': UTM,
        'manzanas': out,
        # Streets, railway and highway extracted from the CAD in the same
        # coordinate frame as the lots — see build_plano.py.
        #
        # Keep the REPAIRED ring, don't just use repair() as a pass/fail filter.
        # Two área verde rings cross themselves where the CAD polyline doubles
        # back; passing the original through made save_map_elements reject the
        # whole batch with INVALID_GEOMETRY, which left the map with stale
        # elements and no error anywhere near the cause.
        'elements': [
            {**e, 'ring': r}
            for e in D.get('elements', [])
            if (r := repair(e['ring']))
        ],
    }, open(OUT, 'w'), separators=(',', ':'))

    areas = [l['area_m2'] for m in out for l in m['lots']]
    print('manzanas        :', len(out))
    print('lots            :', total, '| sin numero en el plano:', unnumbered)
    print('corner lots     :', sum(1 for m in out for l in m['lots'] if l['is_corner']))
    print('lot area median :', sorted(areas)[len(areas) // 2])
    print('total lot area  : %.0f m2' % sum(areas))
    print('needs_review    :', sum(1 for m in out if m['needs_review']),
          [m['code'] for m in out if m['needs_review']])
    print('lotes descartados:', len(dropped), dropped[:8])
    print('regiones envolventes quitadas:', len(enclosing), enclosing[:10])
    print('wrote', OUT)


if __name__ == '__main__':
    main()
