"""Node the line soup, then recover faces.

CAD draws a lot's side line ending ON another line rather than at a shared
vertex, so the raw segments form a graph with almost no cycles (the first pass
found 201 faces for 12k edges). Splitting every segment at the endpoints that
lie on it makes the arrangement planar and the faces become the lots.
"""
import json, math
from collections import defaultdict
import numpy as np
import fitz

TOL = 0.05          # PDF units: a point this close to a segment lies on it
SNAP = 0.03

def key(x, y): return (round(x / SNAP), round(y / SNAP))

def load_segments(pdf, colours):
    doc = fitz.open(pdf)
    segs = []
    for path in doc[0].get_drawings():
        c = path.get('color')
        k = tuple(round(v, 3) for v in c) if c else None
        if k not in colours: continue
        for it in path['items']:
            if it[0] == 'l':
                segs.append((it[1].x, it[1].y, it[2].x, it[2].y))
            elif it[0] == 'qu':
                q = it[1]
                r = [(q.ul.x,q.ul.y),(q.ur.x,q.ur.y),(q.lr.x,q.lr.y),(q.ll.x,q.ll.y)]
                for i in range(4):
                    a, b = r[i], r[(i+1) % 4]
                    segs.append((a[0], a[1], b[0], b[1]))
    return np.array(segs, dtype=float)

def node_segments(segs):
    """Split every segment at any endpoint lying in its interior."""
    pts = np.vstack([segs[:, :2], segs[:, 2:]])
    # unique endpoints
    q = np.round(pts / SNAP).astype(np.int64)
    _, idx = np.unique(q, axis=0, return_index=True)
    P = pts[np.sort(idx)]

    cell = 4.0
    grid = defaultdict(list)
    for i, (x, y) in enumerate(P):
        grid[(int(x // cell), int(y // cell))].append(i)

    out = []
    for (x1, y1, x2, y2) in segs:
        dx, dy = x2 - x1, y2 - y1
        L2 = dx*dx + dy*dy
        if L2 < 1e-12: continue
        cand = set()
        steps = max(2, int(math.hypot(dx, dy) / cell) + 2)
        for s in range(steps + 1):
            t = s / steps
            cx, cy = int((x1 + dx*t) // cell), int((y1 + dy*t) // cell)
            for gx in (cx-1, cx, cx+1):
                for gy in (cy-1, cy, cy+1):
                    cand.update(grid.get((gx, gy), ()))
        ts = [0.0, 1.0]
        for i in cand:
            px, py = P[i]
            t = ((px-x1)*dx + (py-y1)*dy) / L2
            if t <= 1e-9 or t >= 1-1e-9: continue
            if abs((px - (x1+dx*t)))**2 + abs((py - (y1+dy*t)))**2 <= TOL*TOL:
                ts.append(t)
        ts = sorted(set(round(t, 9) for t in ts))
        for a, b in zip(ts, ts[1:]):
            out.append((x1+dx*a, y1+dy*a, x1+dx*b, y1+dy*b))
    return out

def faces_of(segs):
    pos, adj = {}, defaultdict(set)
    for (x1, y1, x2, y2) in segs:
        ka, kb = key(x1, y1), key(x2, y2)
        if ka == kb: continue
        pos.setdefault(ka, (x1, y1)); pos.setdefault(kb, (x2, y2))
        adj[ka].add(kb); adj[kb].add(ka)
    order, index = {}, {}
    for v, nb in adj.items():
        vx, vy = pos[v]
        lst = sorted(nb, key=lambda w: math.atan2(pos[w][1]-vy, pos[w][0]-vx))
        order[v] = lst; index[v] = {w: i for i, w in enumerate(lst)}
    out, seen = [], set()
    for v in adj:
        for w in adj[v]:
            if (v, w) in seen: continue
            ring, cur, prev = [], w, v
            while (prev, cur) not in seen:
                seen.add((prev, cur)); ring.append(pos[cur])
                lst = order[cur]; i = index[cur][prev]
                nxt = lst[(i-1) % len(lst)]
                prev, cur = cur, nxt
                if len(ring) > 20000: break
            if len(ring) >= 3: out.append(ring)
    return out

def area(r):
    s = 0.0
    for i in range(len(r)):
        x1, y1 = r[i]; x2, y2 = r[(i+1) % len(r)]
        s += x1*y2 - x2*y1
    return s/2

if __name__ == '__main__':
    pdf = 'cad/Urb. Ciudadela Prados del Sur_13-05-25.pdf'
    segs = load_segments(pdf, {(0.0, 0.0, 0.0)})
    print('black+red segments  :', len(segs))
    noded = node_segments(segs)
    print('after noding        :', len(noded))
    fs = faces_of(noded)
    pos_faces = [(abs(area(r)), r) for r in fs]
    pos_faces.sort(key=lambda t: -t[0])
    inner = [(a, r) for a, r in pos_faces[1:] if a > 0.5]   # [0] is the outer face
    inner.sort(key=lambda t: -t[0])
    print('faces               :', len(fs), '| positive:', len(inner))
    import statistics
    PT_PER_M = 72.0 / 25.4 / 1500 * 1000     # 1:1500 → 1.8898 pt per metre
    m2 = [a / PT_PER_M**2 for a, _ in inner]
    lots = [x for x in m2 if 40 <= x <= 3000]
    print('scale               :', round(PT_PER_M, 5), 'pt/m')
    print('faces in lot range  :', len(lots))
    if lots:
        print('lot m2 median       :', round(statistics.median(lots), 2))
        print('lot m2 p5/p95       :', round(np.percentile(lots,5),1), '/', round(np.percentile(lots,95),1))
        from collections import Counter
        print('most common m2      :', Counter(round(x) for x in lots).most_common(6))
    json.dump([{'a': a, 'ring': r} for a, r in inner], open('cad/faces.json', 'w'), separators=(',', ':'))
    print('wrote cad/faces.json')
