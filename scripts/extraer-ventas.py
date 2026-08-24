"""Saca las ventas del HTML del sistema anterior a un JSON.

Solo lo que la fuente afirma directamente. El cronograma de cuotas NO se
reconstruye: sus totales no cierran (34 % cumple contrato = abonado + deuda),
así que armar vencimientos sería inventarlos.
"""
import io
import json
import sys


def fichas(html):
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


def t(o, k):
    return str(o.get(k) or '').strip()


def num(o, k):
    try:
        return round(float(o.get(k) or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def main():
    ruta, slug = sys.argv[1], sys.argv[2]
    html = io.open(ruta, encoding='utf8', errors='replace').read()

    ventas = []
    for o in fichas(html):
        if not t(o, 'IDVENTA'):
            continue
        tel = t(o, 'CELULAR') or t(o, 'TELEFONO')
        if tel in ('0', ''):
            tel = None
        fecha = t(o, 'FECHAVENTA')[:10] or None
        ventas.append({
            'idproducto': t(o, 'IDPRODUCTO'),
            'idventa': t(o, 'IDVENTA'),
            'idcliente': t(o, 'IDCLIENTE'),
            'nombre': ' '.join(t(o, 'NOMBRE').split()),
            'telefono': tel,
            'fecha_venta': fecha,
            'estado': t(o, 'estado') or 'vendido',
            'precio': num(o, 'PRECIOVENTA') or num(o, 'PRECIOUNIT'),
            'cuota_inicial': num(o, 'CUOTAINICIAL'),
            'abonado': num(o, 'MONTOABONADO'),
            'deuda': num(o, 'TOTALDEUDA'),
            'contrato': num(o, 'VALOR_CONTRATO'),
            'plazo': int(num(o, 'PLAZO')),
            'cuotas_faltantes': int(num(o, 'CUOTASFALTANTES')) or None,
            'manzana': t(o, 'NROMANZANO'),
            'lote': t(o, 'NROLOTE').lstrip('0') or '0',
        })

    salida = f'{slug}-ventas.json'
    io.open(salida, 'w', encoding='utf8').write(
        json.dumps({'slug': slug, 'ventas': ventas}, ensure_ascii=False))
    conDeuda = sum(1 for v in ventas if v['deuda'] > 0)
    print(f'{slug}: {len(ventas)} ventas, {conDeuda} con saldo -> {salida}')


if __name__ == '__main__':
    main()
