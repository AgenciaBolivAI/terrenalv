"""Rebuild the plano's manzanas and lots from the CAD layers in the PDF.

Geometry comes from pdf_layers.py (layer-aware, so lot outlines are not mixed
with dimension lines or hatching). Labels come from PyMuPDF's text extractor,
which decodes the CAD fonts properly, and are matched to polygons by position.

Output: cad/plano.json — manzanas with their lots, in metres, plan space.
"""
import json
import math
import re
from collections import defaultdict

import fitz
import numpy as np

from pdf_layers import extract

PDF = 'cad/Urb. Ciudadela Prados del Sur_13-05-25.pdf'
PT_PER_M = 72.0 / 25.4 / 1500 * 1000        # 1:1500 → 1.88976 pt per metre
SNAP = 0.03
TOL = 0.05

LOT_LAYER = 'Urb. Dorita II - Lotes - Area Util'
MZ_LAYERS = {
    'Urb. Dorita II - Manzano - Area Util': 'residencial',
    'Urb. Dorita II - Manzano - Area Verde': 'area_verde',
    'Urb. Dorita II - Manzano - Area Equipamiento': 'equipamiento',
}


def key(x, y):
    return (round(x / SNAP), round(y / SNAP))


def node_segments(segs):
    """Split each segment where another segment's endpoint lies on it."""
    if not segs:
        return []
    S = np.array(segs, dtype=float)
    L = np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1])
    S = S[L > 1e-6]
    pts = np.vstack([S[:, :2], S[:, 2:]])
    q = np.round(pts / SNAP).astype(np.int64)
    _, idx = np.unique(q, axis=0, return_index=True)
    P = pts[np.sort(idx)]

    cell = 4.0
    grid = defaultdict(list)
    for i, (x, y) in enumerate(P):
        grid[(int(x // cell), int(y // cell))].append(i)

    out = []
    for (x1, y1, x2, y2) in S:
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        cand = set()
        steps = max(2, int(math.hypot(dx, dy) / cell) + 2)
        for s in range(steps + 1):
            t = s / steps
            cx, cy = int((x1 + dx * t) // cell), int((y1 + dy * t) // cell)
            for gx in (cx - 1, cx, cx + 1):
                for gy in (cy - 1, cy, cy + 1):
                    cand.update(grid.get((gx, gy), ()))
        ts = [0.0, 1.0]
        for i in cand:
            px, py = P[i]
            t = ((px - x1) * dx + (py - y1) * dy) / L2
            if t <= 1e-9 or t >= 1 - 1e-9:
                continue
            ex, ey = px - (x1 + dx * t), py - (y1 + dy * t)
            if ex * ex + ey * ey <= TOL * TOL:
                ts.append(t)
        ts = sorted(set(round(t, 9) for t in ts))
        for a, b in zip(ts, ts[1:]):
            out.append((x1 + dx * a, y1 + dy * a, x1 + dx * b, y1 + dy * b))
    return out


def faces_of(segs):
    pos, adj = {}, defaultdict(set)
    for (x1, y1, x2, y2) in segs:
        ka, kb = key(x1, y1), key(x2, y2)
        if ka == kb:
            continue
        pos.setdefault(ka, (x1, y1))
        pos.setdefault(kb, (x2, y2))
        adj[ka].add(kb)
        adj[kb].add(ka)
    order, index = {}, {}
    for v, nb in adj.items():
        vx, vy = pos[v]
        lst = sorted(nb, key=lambda w: math.atan2(pos[w][1] - vy, pos[w][0] - vx))
        order[v] = lst
        index[v] = {w: i for i, w in enumerate(lst)}
    out, seen = [], set()
    for v in adj:
        for w in adj[v]:
            if (v, w) in seen:
                continue
            ring, cur, prev = [], w, v
            while (prev, cur) not in seen:
                seen.add((prev, cur))
                ring.append(pos[cur])
                lst = order[cur]
                i = index[cur][prev]
                nxt = lst[(i - 1) % len(lst)]
                prev, cur = cur, nxt
                if len(ring) > 20000:
                    break
            if len(ring) >= 3:
                out.append(ring)
    return out


def area(r):
    s = 0.0
    for i in range(len(r)):
        x1, y1 = r[i]
        x2, y2 = r[(i + 1) % len(r)]
        s += x1 * y2 - x2 * y1
    return s / 2


def centroid(r):
    a = area(r)
    if abs(a) < 1e-9:
        xs = [p[0] for p in r]
        ys = [p[1] for p in r]
        return (sum(xs) / len(xs), sum(ys) / len(ys))
    cx = cy = 0.0
    for i in range(len(r)):
        x1, y1 = r[i]
        x2, y2 = r[(i + 1) % len(r)]
        f = x1 * y2 - x2 * y1
        cx += (x1 + x2) * f
        cy += (y1 + y2) * f
    return (cx / (6 * a), cy / (6 * a))


def inside(pt, ring):
    x, y = pt
    c = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if ((y1 > y) != (y2 > y)) and (x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-18) + x1):
            c = not c
    return c


def bbox(r):
    xs = [p[0] for p in r]
    ys = [p[1] for p in r]
    return (min(xs), min(ys), max(xs), max(ys))


def clean_ring(r, eps=0.02):
    """Drop duplicate and collinear vertices."""
    out = []
    for p in r:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    res = []
    n = len(out)
    for i in range(n):
        a, b, c = out[(i - 1) % n], out[i], out[(i + 1) % n]
        cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(cross) > 1e-3:
            res.append(b)
    return res if len(res) >= 3 else out


def main():
    out, names = extract(PDF)
    by_name = defaultdict(list)
    for xref, segs in out.segments.items():
        by_name[names.get(xref)].extend(segs)

    doc = fitz.open(PDF)
    page = doc[0]
    H = page.rect.height

    def to_page(p):
        """Content-stream space (y up) → page space (y down), as get_text uses."""
        return (p[0], H - p[1])

    # ---- lots -------------------------------------------------------------
    lot_faces = []
    for r in faces_of(node_segments(by_name.get(LOT_LAYER, []))):
        a = abs(area(r))
        m2 = a / PT_PER_M ** 2
        if 30 <= m2 <= 5000:
            lot_faces.append(clean_ring(r))
    print('lot faces          :', len(lot_faces))

    # ---- manzanas ---------------------------------------------------------
    mz_faces = []
    for layer, kind in MZ_LAYERS.items():
        segs = by_name.get(layer, [])
        if not segs:
            continue
        for r in faces_of(node_segments(segs)):
            a = abs(area(r))
            m2 = a / PT_PER_M ** 2
            if 300 <= m2 <= 200000:
                mz_faces.append((kind, clean_ring(r)))
    print('manzana faces      :', len(mz_faces))

    # ---- labels -----------------------------------------------------------
    words = page.get_text('words')
    mz_labels, lot_labels = [], []
    for w in words:
        x0, y0, x1, y1, t = w[0], w[1], w[2], w[3], w[4].strip()
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if re.fullmatch(r'M-?\d{1,3}', t):
            mz_labels.append((cx, cy, t.replace('M', 'M-').replace('M--', 'M-')))
        elif re.fullmatch(r'\d{1,3}', t):
            lot_labels.append((cx, cy, t))
    print('manzana labels     :', len(mz_labels))
    print('numeric labels     :', len(lot_labels))

    json.dump({
        'pt_per_m': PT_PER_M,
        'page_h': H,
        'lots': [[to_page(p) for p in r] for r in lot_faces],
        'manzanas': [{'kind': k, 'ring': [to_page(p) for p in r]} for k, r in mz_faces],
        'mz_labels': mz_labels,
        'lot_labels': lot_labels,
    }, open('cad/plano_raw.json', 'w'), separators=(',', ':'))
    print('wrote cad/plano_raw.json')


if __name__ == '__main__':
    main()
