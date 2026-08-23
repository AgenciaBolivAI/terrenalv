"""Reconstruir manzanas y lotes desde el PDF de un plano CAD.

El núcleo ya estaba escrito y probado contra el plano real de Prados del Sur
(2.078 lotes, 88 manzanas, lote mediano 300,00 m² exactos). Lo que faltaba para
que fuera una función del producto y no un script mío es que dejara de estar
atado a ESE plano: `build_plano.py` tenía escritos a mano el nombre de la capa
de lotes ('Urb. Dorita II - Lotes - Area Util') y la escala 1:1500.

Ningún topógrafo nombra las capas igual, así que acá se hace al revés:
  1. `analizar()` abre el PDF y dice QUÉ capas trae, cuántas líneas tiene cada
     una y qué polígonos cerrados forman, con sus áreas.
  2. Con eso la persona elige cuál es la capa de lotes, cuál el área verde y
     cuál el equipamiento — o acepta la que el propio análisis propone.
  3. `extraer()` reconstruye la geometría de las capas elegidas.

El paso 2 no se puede saltar de forma honesta: adivinar la capa y equivocarse
crea lotes que no existen, y eso recién se descubre cuando alguien intenta
vender uno.
"""

import math
from collections import defaultdict

import numpy as np

from . import geom as G
from .pdf_layers import extract


# Escalas de plano usuales en Bolivia. Un PDF exportado de CAD no dice su
# escala, así que se deduce comparando el área que dan los polígonos contra el
# tamaño que razonablemente tiene un lote urbano.
ESCALAS = [500, 750, 1000, 1250, 1500, 2000, 2500]

# Un lote urbano de loteamiento está entre estos límites. Fuera de esto casi
# siempre es una manzana entera, un área verde o un marco del dibujo.
LOTE_MIN_M2 = 80.0
LOTE_MAX_M2 = 5000.0


def pt_por_metro(escala: float) -> float:
    """Puntos PDF por metro real. 72 pt/pulgada, 25,4 mm/pulgada."""
    return 72.0 / 25.4 / escala * 1000


# Valores con los que se reconstruyó bien el plano real. No son los que trae
# geom.py por defecto (0,03 / 0,05): esos son para segmentos leídos con
# get_drawings(), y acá las coordenadas vienen de recorrer el stream de
# contenido, que las entrega en otra magnitud. Con los valores chicos no se
# une ni un solo polígono.
SNAP = 3.0
TOL = 6.0


def _anillos(segs, snap=SNAP, tol=TOL):
    """Polígonos cerrados que forman las líneas sueltas de una capa."""
    if len(segs) < 3:
        return []
    G.SNAP, G.TOL = snap, tol
    # node_segments indexa como matriz (segs[:, :2]): una lista de Python no
    # sirve y falla con TypeError.
    return G.faces_of(G.node_segments(np.asarray(segs, dtype=float)))


def limpiar_anillo(r, eps=0.02):
    """Saca vértices repetidos y colineales."""
    out = []
    for p in r:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) <= eps and abs(out[0][1] - out[-1][1]) <= eps:
        out.pop()
    res, n = [], len(out)
    for i in range(n):
        a, b, c = out[(i - 1) % n], out[i], out[(i + 1) % n]
        cruz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        if abs(cruz) > 1e-3:
            res.append(b)
    return res if len(res) >= 3 else out


def _mediana(xs):
    s = sorted(xs)
    n = len(s)
    if not n:
        return 0.0
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _capas(ruta_pdf):
    col, nombres = extract(ruta_pdf)
    por_capa = defaultdict(list)
    for xref, segs in col.segments.items():
        por_capa[nombres.get(xref) or '(sin capa)'].extend(segs)
    return por_capa


def deducir_escala(areas_pt2):
    """Escala más probable, por el tamaño que darían los lotes.

    Se elige la escala con la que la mediana de las áreas cae más cerca del
    centro del rango de un lote urbano. Es una propuesta, no una certeza: la
    UI la muestra para que se confirme o se corrija.
    """
    if not areas_pt2:
        return None, None
    med_pt2 = _mediana(areas_pt2)
    objetivo = 300.0  # m², el lote típico de un loteamiento boliviano
    mejor, mejor_err = None, None
    for esc in ESCALAS:
        m2 = med_pt2 / (pt_por_metro(esc) ** 2)
        if not (LOTE_MIN_M2 <= m2 <= LOTE_MAX_M2):
            continue
        err = abs(math.log(m2 / objetivo))
        if mejor_err is None or err < mejor_err:
            mejor, mejor_err = esc, err
    if mejor is None:
        return None, None
    return mejor, med_pt2 / (pt_por_metro(mejor) ** 2)


def analizar(ruta_pdf):
    """Qué trae este plano: capas, cuántas líneas, qué polígonos y de qué tamaño."""
    por_capa = _capas(ruta_pdf)
    capas = []
    todas_areas = []

    for nombre, segs in sorted(por_capa.items(), key=lambda kv: -len(kv[1])):
        # Las capas con muy pocas líneas son marcos, membretes o el norte: no
        # vale la pena reconstruirles las caras.
        if len(segs) < 8:
            capas.append({'nombre': nombre, 'segmentos': len(segs),
                          'poligonos': 0, 'areas_pt2': []})
            continue
        anillos = _anillos(segs)
        areas = [abs(G.area(r)) for r in anillos if len(r) >= 3]
        areas = [a for a in areas if a > 0]
        todas_areas.extend(areas)
        capas.append({
            'nombre': nombre,
            'segmentos': len(segs),
            'poligonos': len(areas),
            'area_mediana_pt2': _mediana(areas),
            'areas_pt2': areas[:400],
        })

    # La capa de lotes es la que más polígonos cerrados y parecidos entre sí
    # tiene: un loteamiento son cientos de rectángulos casi iguales.
    candidata = None
    mejor = -1.0
    for c in capas:
        if c.get('poligonos', 0) < 20:
            continue
        areas = c.get('areas_pt2') or []
        if not areas:
            continue
        med = _mediana(areas)
        if med <= 0:
            continue
        parecidos = sum(1 for a in areas if 0.5 * med <= a <= 2.0 * med) / len(areas)
        puntaje = parecidos * math.log(c['poligonos'])
        if puntaje > mejor:
            mejor, candidata = puntaje, c['nombre']

    areas_cand = next((c.get('areas_pt2') or [] for c in capas if c['nombre'] == candidata), [])
    escala, lote_mediano = deducir_escala(areas_cand)

    return {
        'capas': [{k: v for k, v in c.items() if k != 'areas_pt2'} for c in capas],
        'capa_lotes_sugerida': candidata,
        'escala_sugerida': escala,
        'lote_mediano_m2': round(lote_mediano, 2) if lote_mediano else None,
    }


def extraer(ruta_pdf, capa_lotes, escala, capas_area=None,
            lote_min_m2=LOTE_MIN_M2, lote_max_m2=LOTE_MAX_M2):
    """Polígonos en METROS de las capas elegidas.

    Devuelve coordenadas en metros con Y hacia arriba (el PDF la lleva hacia
    abajo), que es como las espera el editor de mapa.
    """
    por_capa = _capas(ruta_pdf)
    ppm = pt_por_metro(escala)

    def a_metros(anillo):
        return [[round(x / ppm, 3), round(-y / ppm, 3)] for x, y in anillo]

    lotes = []
    for r in _anillos(por_capa.get(capa_lotes, [])):
        a_pt2 = abs(G.area(r))
        m2 = a_pt2 / (ppm ** 2)
        if not (lote_min_m2 <= m2 <= lote_max_m2):
            continue
        anillo = limpiar_anillo(r)
        if len(anillo) < 3:
            continue
        lotes.append({'anillo': a_metros(anillo), 'area_m2': round(m2, 2)})

    areas = []
    for clase, nombre_capa in (capas_area or {}).items():
        for r in _anillos(por_capa.get(nombre_capa, [])):
            m2 = abs(G.area(r)) / (ppm ** 2)
            if m2 < lote_min_m2:
                continue
            anillo = limpiar_anillo(r)
            if len(anillo) >= 3:
                areas.append({'clase': clase, 'anillo': a_metros(anillo),
                              'area_m2': round(m2, 2)})

    return {
        'escala': escala,
        'lotes': lotes,
        'areas': areas,
        'resumen': {
            'lotes': len(lotes),
            'areas': len(areas),
            'area_total_m2': round(sum(l['area_m2'] for l in lotes), 2),
            'lote_mediano_m2': round(_mediana([l['area_m2'] for l in lotes]), 2),
        },
    }
