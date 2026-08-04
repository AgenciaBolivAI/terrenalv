"""Rebuild lot polygons from the plano PDF's line soup.

The CAD export draws every lot boundary as an independent 2-point segment, so
the polygons have to be recovered as faces of the planar graph the segments
form. Standard half-edge traversal: at each vertex take the next edge clockwise
from the reverse of the one you arrived on, and you walk exactly one face.
"""
import json, math, sys
from collections import defaultdict
import fitz

SNAP = 0.03  # PDF units; CAD endpoints coincide to well under this

def key(x, y):
    return (round(x / SNAP), round(y / SNAP))

def load_segments(pdf, colour):
    doc = fitz.open(pdf)
    segs = []
    for path in doc[0].get_drawings():
        c = path.get('color')
        if c is None or tuple(round(v, 3) for v in c) != colour:
            continue
        for it in path['items']:
            if it[0] == 'l':
                segs.append(((it[1].x, it[1].y), (it[2].x, it[2].y)))
            elif it[0] == 'qu':
                q = it[1]
                ring = [(q.ul.x, q.ul.y), (q.ur.x, q.ur.y), (q.lr.x, q.lr.y), (q.ll.x, q.ll.y)]
                for i in range(4):
                    segs.append((ring[i], ring[(i + 1) % 4]))
    return segs

def build(segs):
    pos, adj = {}, defaultdict(set)
    for a, b in segs:
        ka, kb = key(*a), key(*b)
        if ka == kb:
            continue
        pos.setdefault(ka, a); pos.setdefault(kb, b)
        adj[ka].add(kb); adj[kb].add(ka)
    return pos, adj

def faces(pos, adj):
    # Outgoing edges per vertex sorted by angle, so "next clockwise" is O(1).
    order, index = {}, {}
    for v, nbrs in adj.items():
        vx, vy = pos[v]
        lst = sorted(nbrs, key=lambda w: math.atan2(pos[w][1] - vy, pos[w][0] - vx))
        order[v] = lst
        index[v] = {w: i for i, w in enumerate(lst)}

    out, seen = [], set()
    for v in adj:
        for w in adj[v]:
            if (v, w) in seen:
                continue
            ring, cur, prev = [], w, v
            while True:
                seen.add((prev, cur))
                ring.append(pos[cur])
                lst = order[cur]
                i = index[cur][prev]
                nxt = lst[(i - 1) % len(lst)]   # next clockwise from the way back
                prev, cur = cur, nxt
                if (prev, cur) in seen:
                    break
                if len(ring) > 5000:
                    break
            if len(ring) >= 3:
                out.append(ring)
    return out

def area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
        s += x1 * y2 - x2 * y1
    return s / 2

if __name__ == '__main__':
    pdf = 'cad/Urb. Ciudadela Prados del Sur_13-05-25.pdf'
    segs = load_segments(pdf, (0.0, 1.0, 0.0))
    print('green segments:', len(segs))
    pos, adj = build(segs)
    print('vertices:', len(pos))
    fs = faces(pos, adj)
    signed = [(area(r), r) for r in fs]
    inner = [(a, r) for a, r in signed if a > 0]      # y grows downward → CW rings are positive
    print('faces total:', len(fs), '| positive-area faces:', len(inner))
    inner.sort(key=lambda t: -t[0])
    print('largest 5 areas (pdf^2):', [round(a, 1) for a, _ in inner[:5]])
    import statistics
    areas = [a for a, _ in inner]
    print('median area:', round(statistics.median(areas), 2))
    json.dump([{'a': a, 'ring': r} for a, r in inner],
              open('cad/faces.json', 'w'), separators=(',', ':'))
    print('wrote cad/faces.json')
