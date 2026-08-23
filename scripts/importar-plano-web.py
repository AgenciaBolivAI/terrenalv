"""Importar una urbanización desde la página de plano del sistema anterior.

El cliente entregó su sistema actual para migrarlo. Cada página de plano trae,
embebido en el HTML:

  * el DIBUJO del plano en SVG (las manzanas, las calles, las cotas impresas
    en cada lado) — que es lo que el comprador realmente mira para saber
    dónde termina su lote;
  * un PUNTO por lote, con su id (M<manzana>L<lote>);
  * una FICHA por lote: superficie, precio, cuota inicial, tipo (avenida /
    esquina) y, si está vendido, el comprador y su saldo.

Lo que NO trae es el polígono de cada lote: el lote es un punto. Por eso acá se
le arma a cada lote un rectángulo del tamaño de SU superficie real, centrado en
su punto, y se marca `needs_review`: sirve como área clicable y da el área
correcta, pero los lados no son los del levantamiento. Los lados verdaderos los
muestra el dibujo del plano, que se guarda aparte y se dibuja debajo.

La escala sale del propio plano: las áreas verdes y de equipamiento llevan su
superficie impresa ("12.687,24 m²"), así que comparar esa cifra con el área del
polígono correspondiente da los metros por unidad de dibujo. En Alto Los Pinos
cuatro etiquetas independientes coincidieron dentro del 0,6 %.

  python scripts/importar-plano-web.py <archivo.html> <slug-del-proyecto> [--aplicar]

Sin --aplicar solo informa lo que haría.
"""

import io
import json
import math
import os
import re
import statistics as st
import sys
import urllib.request


# ---------------------------------------------------------------- utilidades
def shoelace(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def casco_convexo(pts):
    """Envolvente convexa (Andrew monotone chain)."""
    p = sorted(set(pts))
    if len(p) <= 2:
        return p

    def media(vueltas):
        r = []
        for q in vueltas:
            while len(r) >= 2 and ((r[-1][0] - r[-2][0]) * (q[1] - r[-2][1])
                                   - (r[-1][1] - r[-2][1]) * (q[0] - r[-2][0])) <= 0:
                r.pop()
            r.append(q)
        return r[:-1]

    return media(p) + media(reversed(p))


# ------------------------------------------------------------------- parseo
def leer_svg(html):
    return html[html.find('<svg'):html.rfind('</svg>')]


def puntos_de_lote(svg):
    """{IDPRODUCTO: (x, y)} en unidades del dibujo.

    La clave es el id del círculo sin el prefijo `L_`, que es exactamente el
    IDPRODUCTO de la ficha (`L_47M6M01L01` ↔ `47M6M01L01`). Se une por ahí y no
    por manzana/lote porque el plano tiene DOS unidades vecinales (47M y 47N)
    con la misma numeración de manzanas: uniendo por manzana/lote, la mitad de
    los lotes se pisa con la otra mitad y desaparece sin que nada falle.
    """
    out = {}
    for m in re.finditer(r'<circle id="L_([^"]+)"[^>]*cx="([\d.\-]+)"[^>]*cy="([\d.\-]+)"', svg):
        out[m.group(1).strip()] = (float(m.group(2)), float(m.group(3)))
    return out


def fichas(html):
    """Una ficha por lote, tal como la trae el sistema anterior."""
    objs, i = [], 0
    while True:
        i = html.find('"SUPERFICIE"', i)
        if i == -1:
            break
        a = html.rfind('{', 0, i)
        d, j = 0, a
        while j < len(html):
            if html[j] == '{':
                d += 1
            elif html[j] == '}':
                d -= 1
                if d == 0:
                    break
            j += 1
        try:
            objs.append(json.loads(html[a:j + 1]))
        except Exception:
            pass
        i = j
    return objs


def calibrar(svg):
    """Metros por unidad de dibujo, según las superficies impresas en el plano.

    Solo se aceptan las etiquetas que caen sobre un polígono real: las que
    nombran una zona sin polígono se emparejan con la figura equivocada y dan
    valores absurdos. Si menos de dos coinciden, no se inventa una escala.
    """
    polys = []
    for m in re.finditer(r'<polygon[^>]*points="([^"]+)"', svg):
        nums = [float(v) for v in re.findall(r'-?\d+\.?\d*', m.group(1))]
        pts = list(zip(nums[0::2], nums[1::2]))
        if len(pts) >= 3:
            polys.append((shoelace(pts),
                          (sum(p[0] for p in pts) / len(pts),
                           sum(p[1] for p in pts) / len(pts))))
    if not polys:
        return None, []

    candidatas = []
    for m in re.finditer(
            r'<text\b[^>]*transform="translate\(\s*([\d.\-]+)[\s,]+([\d.\-]+)[^"]*"[^>]*>(.*?)</text>',
            svg, re.S):
        x, y = float(m.group(1)), float(m.group(2))
        cuerpo = ' '.join(re.findall(r'<tspan[^>]*>(.*?)</tspan>', m.group(3), re.S))
        plano = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', cuerpo)).strip()
        mm = re.search(r'([\d]{1,3}(?:\.[\d]{3})*,\d{2})', plano)
        if mm and 'm' in plano.lower():
            val = float(mm.group(1).replace('.', '').replace(',', '.'))
            area_vb, _ = min(polys, key=lambda p: (p[1][0] - x) ** 2 + (p[1][1] - y) ** 2)
            if area_vb > 0:
                candidatas.append(math.sqrt(val / area_vb))
    if len(candidatas) < 2:
        return None, candidatas

    base = st.median(sorted(candidatas)[:max(2, len(candidatas) // 2)])
    buenas = [v for v in candidatas if abs(v - base) / base < 0.10]
    if len(buenas) < 2:
        return None, candidatas
    return st.median(buenas), buenas


# ------------------------------------------------------------------ armado
def rectangulo(cx, cy, area_m2, escala, frente=None, fondo=None):
    """Rectángulo del área real, centrado en el punto del lote.

    Sin frente/fondo declarados se usa 3:4, la proporción habitual de un lote
    de loteamiento. El ÁREA es la real; la forma es una aproximación, y por eso
    el lote queda marcado para revisión.
    """
    if frente and fondo and frente > 0 and fondo > 0:
        f, d = frente, fondo
    else:
        f = math.sqrt(area_m2 * 0.75)
        d = area_m2 / f
    hf, hd = (f / 2) / escala, (d / 2) / escala
    return [[cx - hf, cy - hd], [cx + hf, cy - hd], [cx + hf, cy + hd], [cx - hf, cy + hd]]


def a_metros(pt, escala, orig):
    """Unidades de dibujo → metros, con Y hacia arriba y origen en la esquina."""
    return [round((pt[0] - orig[0]) * escala, 3), round((orig[1] - pt[1]) * escala, 3)]


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(2)
    ruta, slug = sys.argv[1], sys.argv[2]
    aplicar = '--aplicar' in sys.argv

    html = io.open(ruta, encoding='utf8', errors='replace').read()
    svg = leer_svg(html)
    escala, muestras = calibrar(svg)
    if not escala:
        print(f'No se pudo calibrar la escala ({len(muestras)} etiqueta(s) útil(es)).')
        print('Sin escala no se importa: los lotes saldrían con un tamaño inventado.')
        sys.exit(1)

    pts = puntos_de_lote(svg)
    fs = fichas(html)
    por_clave = {}
    for o in fs:
        pid = str(o.get('IDPRODUCTO') or '').strip()
        if pid:
            por_clave[pid] = o

    comunes = sorted(set(pts) & set(por_clave))
    print(f'escala      : {escala:.4f} m/unidad  ({len(muestras)} etiquetas coincidentes)')
    print(f'puntos      : {len(pts)}')
    print(f'fichas      : {len(por_clave)}')
    print(f'cruzan      : {len(comunes)}')
    solo_pts = len(pts) - len(comunes)
    solo_fic = len(por_clave) - len(comunes)
    if solo_pts or solo_fic:
        print(f'  sin ficha: {solo_pts}   sin punto: {solo_fic}  (no se importan)')

    xs = [p[0] for p in pts.values()]
    ys = [p[1] for p in pts.values()]
    orig = (min(xs), max(ys))

    manzanas = {}
    for pid in comunes:
        o = por_clave[pid]
        uv = (re.match(r'^\d+([A-Z]\d+)', pid) or [None, 'X'])[1]
        mz = f"{uv}-{str(o.get('NROMANZANO') or '').strip().zfill(2)}"
        lt = str(o.get('NROLOTE') or '').strip().lstrip('0') or '0' 
        try:
            area = float(o.get('SUPERFICIE') or 0)
        except ValueError:
            area = 0
        if area <= 0:
            continue
        cx, cy = pts[pid]

        def num(k):
            try:
                v = float(o.get(k) or 0)
                return v if v > 0 else None
            except ValueError:
                return None

        anillo_vb = rectangulo(cx, cy, area, escala, num('FRENTE'), num('FONDO'))
        manzanas.setdefault(mz, []).append({
            'number': lt,
            'ring': [a_metros(p, escala, orig) for p in anillo_vb],
            'area_m2': round(area, 2),
            'frontage_m': num('FRENTE'),
            'depth_m': num('FONDO'),
            'is_corner': 'ESQUINA' in str(o.get('TIPOLOTE') or '').upper(),
            'is_manual_geom': True,
            'needs_review': True,
            'precio': (lambda v: round(v, 2) if v else None)(num('PRECIOUNIT')),
            'vendido': bool(str(o.get('IDVENTA') or '').strip()),
            '_vb': [tuple(p) for p in anillo_vb],
        })

    total = sum(len(v) for v in manzanas.values())
    m2 = sum(l['area_m2'] for v in manzanas.values() for l in v)
    vendidos = sum(1 for v in manzanas.values() for l in v if l['vendido'])
    print(f'\nmanzanas    : {len(manzanas)}')
    print(f'lotes       : {total}   ({vendidos} vendidos)')
    print(f'superficie  : {m2:,.0f} m2   promedio {m2/max(total,1):,.1f} m2')

    salida = f'{slug}-import.json'
    payload = {
        'slug': slug,
        'escala_m_por_unidad': round(escala, 4),
        'manzanas': [
            {'code': f'M-{mz}',
             'ring': [a_metros(p, escala, orig)
                      for p in casco_convexo([tuple(q) for l in lotes for q in l['_vb']])],
             'lots': [{k: v for k, v in l.items() if k != '_vb'} for l in lotes]}
            for mz, lotes in sorted(manzanas.items())
        ],
    }
    io.open(salida, 'w', encoding='utf8').write(json.dumps(payload, ensure_ascii=False))
    print(f'\nescrito {salida}  ({os.path.getsize(salida):,} bytes)')
    if not aplicar:
        print('(ensayo: no se tocó la base — agregá --aplicar)')


if __name__ == '__main__':
    main()
