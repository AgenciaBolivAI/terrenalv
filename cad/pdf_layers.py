"""Minimal PDF content interpreter that keeps CAD layer membership.

The plano is exported with one Form XObject per entity, each placed inside an
`/OC /ocN BDC ... EMC` block. PyMuPDF's get_drawings() flattens that and loses
the layer, so the stream is walked directly: track the CTM through q/Q/cm, track
the marked-content stack for the layer, and recurse into each XObject.
"""
import re
from collections import defaultdict
import fitz

TOKEN = re.compile(rb"""
      (?P<num>[-+]?\d*\.?\d+)
    | /(?P<name>[^\s/\[\]<>(){}]+)
    | (?P<op>[A-Za-z'"*][A-Za-z0-9'"*]*)
    | (?P<astart>\[) | (?P<aend>\])
    | \((?P<str>(?:\\.|[^\\)])*)\)
    | <(?P<hex>[0-9A-Fa-f\s]*)>
    | (?P<dstart><<) | (?P<dend>>>)
""", re.X | re.S)

QUOTE = chr(39)
DQUOTE = chr(34)


def mul(a, b):
    """Matrix a applied first, then b. Both are [a,b,c,d,e,f]."""
    return [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
            a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
            a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]]


def apply(m, x, y):
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


class Collector:
    def __init__(self):
        self.segments = defaultdict(list)   # layer xref -> [(x1,y1,x2,y2)]
        self.texts = defaultdict(list)      # layer xref -> [(x,y,text)]


class Interp:
    def __init__(self, doc, out):
        self.doc, self.out = doc, out
        self.depth = 0
        self._xobj_cache = {}
        self._prop_cache = {}

    def _refs(self, xref, path, cache):
        if xref in cache:
            return cache[xref]
        d = {}
        raw = self.doc.xref_get_key(xref, path)
        if raw[0] == 'dict':
            for name, num in re.findall(r'/([^\s/]+)\s+(\d+)\s+0\s+R', raw[1]):
                d[name] = int(num)
        cache[xref] = d
        return d

    def xobj_names(self, xref):
        return self._refs(xref, 'Resources/XObject', self._xobj_cache)

    def prop_names(self, xref):
        return self._refs(xref, 'Resources/Properties', self._prop_cache)

    def run(self, content, xref, ctm, layer):
        if self.depth > 12:
            return
        xobjs = self.xobj_names(xref)
        props = self.prop_names(xref)
        stack = []
        oc_stack = [layer]
        cur = list(ctm)
        ops = []
        nums = []          # numeric operands only: binary junk in a stream must
                           # never end up being read as a coordinate
        px = py = sx = sy = 0.0
        tm = None

        for m in TOKEN.finditer(content):
            g = m.lastgroup
            if g == 'num':
                v = float(m.group('num'))
                ops.append(v)
                nums.append(v)
                continue
            if g == 'name':
                ops.append(m.group('name').decode('latin1'))
                continue
            if g == 'str':
                ops.append(m.group('str').decode('latin1'))
                continue
            if g in ('astart', 'aend', 'dstart', 'dend', 'hex'):
                continue
            raw_op = m.group('op')
            if raw_op is None:
                continue
            op = raw_op.decode('latin1')

            if op == 'q':
                stack.append(list(cur))
            elif op == 'Q':
                if stack:
                    cur = stack.pop()
            elif op == 'cm' and len(nums) >= 6:
                cur = mul(nums[-6:], cur)
            elif op == 'm' and len(nums) >= 2:
                px, py = nums[-2], nums[-1]
                sx, sy = px, py
            elif op == 'l' and len(nums) >= 2:
                nx, ny = nums[-2], nums[-1]
                a = apply(cur, px, py)
                b = apply(cur, nx, ny)
                self.out.segments[oc_stack[-1]].append((a[0], a[1], b[0], b[1]))
                px, py = nx, ny
            elif op in ('c', 'v', 'y') and len(nums) >= 4:
                nx, ny = nums[-2], nums[-1]
                a = apply(cur, px, py)
                b = apply(cur, nx, ny)
                self.out.segments[oc_stack[-1]].append((a[0], a[1], b[0], b[1]))
                px, py = nx, ny
            elif op == 're' and len(nums) >= 4:
                x, y, w, h = nums[-4:]
                pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
                for i in range(4):
                    a = apply(cur, *pts[i])
                    b = apply(cur, *pts[(i + 1) % 4])
                    self.out.segments[oc_stack[-1]].append((a[0], a[1], b[0], b[1]))
                px, py = x, y
                sx, sy = x, y
            elif op == 'h':
                a = apply(cur, px, py)
                b = apply(cur, sx, sy)
                self.out.segments[oc_stack[-1]].append((a[0], a[1], b[0], b[1]))
                px, py = sx, sy
            elif op == 'BDC':
                lay = oc_stack[-1]
                if len(ops) >= 2 and ops[-2] == 'OC':
                    nm = ops[-1]
                    if isinstance(nm, str) and nm in props:
                        lay = props[nm]
                oc_stack.append(lay)
            elif op == 'BMC':
                oc_stack.append(oc_stack[-1])
            elif op == 'EMC':
                if len(oc_stack) > 1:
                    oc_stack.pop()
            elif op == 'BT':
                tm = [1, 0, 0, 1, 0, 0]
            elif op == 'ET':
                tm = None
            elif op == 'Tm' and len(nums) >= 6 and tm is not None:
                tm = list(nums[-6:])
            elif op in ('Td', 'TD') and len(nums) >= 2 and tm is not None:
                tm = mul([1, 0, 0, 1, nums[-2], nums[-1]], tm)
            elif op in ('Tj', QUOTE, DQUOTE) and tm is not None:
                s = ops[-1] if ops else ''
                if isinstance(s, str) and s.strip():
                    x, y = apply(mul(tm, cur), 0, 0)
                    self.out.texts[oc_stack[-1]].append((x, y, s))
            elif op == 'TJ' and tm is not None:
                s = ''.join(o for o in ops if isinstance(o, str))
                if s.strip():
                    x, y = apply(mul(tm, cur), 0, 0)
                    self.out.texts[oc_stack[-1]].append((x, y, s))
            elif op == 'Do' and ops and isinstance(ops[-1], str):
                nm = ops[-1]
                if nm in xobjs:
                    ox = xobjs[nm]
                    try:
                        sub = self.doc.xref_stream(ox)
                    except Exception:
                        sub = None
                    if sub:
                        m2 = list(cur)
                        mtx = self.doc.xref_get_key(ox, 'Matrix')
                        if mtx[0] == 'array':
                            vals = [float(v) for v in re.findall(r'[-+]?\d*\.?\d+', mtx[1])]
                            if len(vals) == 6:
                                m2 = mul(vals, cur)
                        self.depth += 1
                        self.run(sub, ox, m2, oc_stack[-1])
                        self.depth -= 1

            if op not in ('BDC', 'BMC'):
                ops = []
                nums = []


def extract(pdf):
    doc = fitz.open(pdf)
    page = doc[0]
    out = Collector()
    Interp(doc, out).run(page.read_contents(), page.xref, [1, 0, 0, 1, 0, 0], None)
    names = {k: v['name'] for k, v in doc.get_ocgs().items()}
    return out, names


if __name__ == '__main__':
    out, names = extract('cad/Urb. Ciudadela Prados del Sur_13-05-25.pdf')
    print('%-46s %9s %7s' % ('layer', 'segments', 'texts'))
    keys = set(out.segments) | set(out.texts)
    for k in sorted(keys, key=lambda k: -(len(out.segments.get(k, [])) + len(out.texts.get(k, [])))):
        label = str(names.get(k, k))[:46]
        print('%-46s %9d %7d' % (label, len(out.segments.get(k, [])), len(out.texts.get(k, []))))
