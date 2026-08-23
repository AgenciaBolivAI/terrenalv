"""Trabajo en segundo plano: leer un plano CAD y devolver su geometría.

Vive fuera de Next.js porque el intérprete del stream de contenido del PDF —el
que conserva a qué capa CAD pertenece cada línea— ya estaba escrito y probado
en Python contra el plano real de Prados del Sur.

Es un trabajo y no una respuesta directa porque tarda ~130 s: colgado de una
petición del navegador, cerrar la pestaña perdería el trabajo sin dejar rastro.
Acá cada etapa se escribe en `plano_jobs`, así que el progreso sobrevive a la
pestaña y un fallo deja escrito el motivo.

POST /api/plano   { "job_id": "..." }
"""

import json
import os
import tempfile
import time
import urllib.request
from http.server import BaseHTTPRequestHandler

from _plano.extractor import analizar, extraer


SUPABASE_URL = os.environ.get('NEXT_PUBLIC_SUPABASE_URL', '').rstrip('/')
SERVICE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
BUCKET = 'planos'


def _rest(metodo, camino, cuerpo=None, cabeceras=None):
    req = urllib.request.Request(
        f'{SUPABASE_URL}{camino}',
        method=metodo,
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
    )
    req.add_header('apikey', SERVICE_KEY)
    req.add_header('Authorization', f'Bearer {SERVICE_KEY}')
    req.add_header('Content-Type', 'application/json')
    for k, v in (cabeceras or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=60) as r:
        crudo = r.read()
        return json.loads(crudo) if crudo else None


def _job(job_id):
    filas = _rest('GET', f'/rest/v1/plano_jobs?id=eq.{job_id}&select=*')
    return filas[0] if filas else None


def _marcar(job_id, **campos):
    _rest('PATCH', f'/rest/v1/plano_jobs?id=eq.{job_id}', campos,
          {'Prefer': 'return=minimal'})


def _descargar(storage_path):
    """Baja el PDF del bucket privado a un archivo temporal."""
    url = f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path.lstrip("/")}'
    req = urllib.request.Request(url)
    req.add_header('apikey', SERVICE_KEY)
    req.add_header('Authorization', f'Bearer {SERVICE_KEY}')
    with urllib.request.urlopen(req, timeout=120) as r:
        datos = r.read()
    fd, ruta = tempfile.mkstemp(suffix='.pdf')
    with os.fdopen(fd, 'wb') as f:
        f.write(datos)
    return ruta


def procesar(job_id):
    job = _job(job_id)
    if not job:
        return {'ok': False, 'error': 'JOB_NO_EXISTE'}
    if job['status'] not in ('pendiente', 'procesando'):
        # Ya se procesó: no rehacer 130 s de trabajo porque alguien recargó.
        return {'ok': True, 'ya_estaba': True, 'status': job['status']}

    t0 = time.time()
    ruta = None
    try:
        _marcar(job_id, status='procesando', etapa='descargando el plano')
        ruta = _descargar(job['storage_path'])

        _marcar(job_id, etapa='leyendo capas CAD y reconstruyendo polígonos')
        info = analizar(ruta)

        # Si el análisis propone capa y escala, se extrae de una: la persona
        # revisa el resultado en vez de tener que elegir a ciegas primero.
        resultado = None
        capa = job.get('capa_lotes') or info.get('capa_lotes_sugerida')
        escala = job.get('escala') or info.get('escala_sugerida')
        if capa and escala:
            _marcar(job_id, etapa=f'extrayendo lotes de «{capa}» a 1:{escala}')
            resultado = extraer(ruta, capa, escala)

        _marcar(
            job_id,
            status='listo',
            etapa=None,
            analisis=info,
            resultado=resultado,
            capa_lotes=capa,
            escala=escala,
            duracion_s=round(time.time() - t0, 2),
        )
        return {'ok': True, 'job_id': job_id,
                'lotes': (resultado or {}).get('resumen', {}).get('lotes', 0),
                'segundos': round(time.time() - t0, 2)}

    except Exception as e:  # noqa: BLE001 — el motivo tiene que quedar escrito
        _marcar(job_id, status='error', etapa=None,
                error=f'{type(e).__name__}: {e}'[:900],
                duracion_s=round(time.time() - t0, 2))
        return {'ok': False, 'error': str(e)}
    finally:
        if ruta and os.path.exists(ruta):
            os.unlink(ruta)


class handler(BaseHTTPRequestHandler):
    def _responder(self, codigo, cuerpo):
        datos = json.dumps(cuerpo).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(datos)))
        self.end_headers()
        self.wfile.write(datos)

    def do_POST(self):
        if not SUPABASE_URL or not SERVICE_KEY:
            return self._responder(500, {'ok': False, 'error': 'FALTA_CONFIG_SUPABASE'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
            cuerpo = json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return self._responder(400, {'ok': False, 'error': 'JSON_INVALIDO'})

        # Secreto compartido: este endpoint mueve datos del proyecto y no puede
        # quedar abierto a cualquiera que adivine un job_id.
        esperado = os.environ.get('PLANO_WORKER_SECRET', '')
        if esperado and self.headers.get('X-Worker-Secret') != esperado:
            return self._responder(401, {'ok': False, 'error': 'NO_AUTORIZADO'})

        job_id = (cuerpo or {}).get('job_id')
        if not job_id:
            return self._responder(400, {'ok': False, 'error': 'FALTA_JOB_ID'})

        r = procesar(job_id)
        self._responder(200 if r.get('ok') else 500, r)
