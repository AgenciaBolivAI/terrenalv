# Terrenalv — Estrellas del Sur

Plataforma de reserva de lotes para Terrenalv S.R.L. (Santa Cruz, Bolivia).
Reemplaza el plano impreso con alfileres por un mapa interactivo: el comprador
elige su lote, reserva sin crear cuenta y sube su comprobante QR; el equipo
verifica desde el panel.

Next.js 15 · Supabase (PostGIS, RLS, Realtime, pg_cron) · Vercel · es-BO

---

## Accesos

| Qué | Dónde |
|---|---|
| Mapa público | `/estrellas-del-sur/mapa` |
| Consultar una reserva | `/reserva` (o `/reserva/<código>`) |
| **Panel del equipo** | **`/admin`** — también enlazado como *"Acceso equipo"* en el pie del inicio |
| Editor de mapa (solo admin) | `/admin/mapa` |

El panel es **solo por invitación**: no existe registro público.

**Cuenta de administrador:** `celiel13@gmail.com` — creada directamente en la
base de datos para romper el círculo (invitar requiere el panel, y el panel
requería un usuario). Para cambiar la contraseña: Supabase → Authentication →
Users. **A partir de aquí, los demás se invitan desde `/admin/equipo`** — no
vuelvas a crear usuarios a mano.

### Precios (esto es lo que habilita las reservas)

Un lote sin precio se ve en el mapa pero **no se puede reservar**
(`LOT_NOT_PRICED`). El precio es `precio_manual ?? precio/m² de su categoría ×
superficie`, así que hay dos pasos:

1. **`/admin/lotes` → "Categorías y precios"** — fija el precio/m² de cada
   categoría A–E. Con las categorías en 0 nada es reservable.
2. **Asignar la categoría a los lotes** — por manzana con "Actualización masiva
   de precios", o lote por lote en la tabla. También existe el precio manual
   por lote, que tiene prioridad sobre la categoría.

> Los precios cargados hoy son **provisionales** ($us 30/m² → 250 m² = $us
> 7.500) para poder probar el flujo completo. Reemplázalos por los comerciales.

### Plan de pago (cuota inicial y cuota mensual)

**`/admin/configuracion` → "Plan de pago"**. Sobre el precio de cada lote se
calcula la **cuota inicial** (porcentaje o monto fijo) y la **cuota mensual**
(plazo en meses, con o sin interés). Se muestran en el mapa y en la página de
reserva; la vista previa del panel deja comprobar los números con el precio de
un lote real antes de guardar.

Es **informativo**: no genera cuotas, vencimientos ni estados de cuenta. El
seguimiento de cuotas sigue siendo v2 (`payments.purpose = 'cuota'` ya existe en
el esquema). La casilla *"Mostrar el plan de pago al comprador"* lo oculta sin
borrar los términos.

> Los términos cargados hoy también son **provisionales**: 30 % de cuota
> inicial, 36 meses, sin interés. Cámbialos antes de publicitar el proyecto.

---

## Variables de entorno

Sin estas variables el mapa muestra *"Mapa en preparación"* y las reservas
responden 503. Se configuran en **Vercel → Project → Settings → Environment
Variables** (y en `.env.local` para desarrollo — ver `.env.example`).

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Sí** | Mapa, lotes, precios |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Sí** | Idem (lectura pública, sin PII) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Sí** para reservar | Crear reservas, subir comprobantes, invitar equipo. **Nunca con prefijo `NEXT_PUBLIC_`** |
| `IP_HASH_SALT` | Recomendada | Límite de intentos por IP (se guarda el hash, nunca la IP) |
| `RESEND_API_KEY`, `RESEND_FROM` | Opcional | Correos al equipo y al comprador; sin esto quedan en cola |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Opcional | CAPTCHA (desactivado por defecto en `settings.captcha_enabled`) |

> Las *preview deployments* de Vercel **no deben apuntar a la base de
> producción**: usa un proyecto o branch de Supabase aparte.

Diagnóstico: si el mapa aparece vacío, los logs del servidor dicen exactamente
por qué — `sin_configuracion`, `sin_conexion`, `proyecto_no_encontrado`,
`sin_publicar` o `sin_geometria`.

---

## Estado de los datos

La geometría está sembrada desde las fotos del plano y la maqueta: **96
manzanas, 2.958 lotes**, cada manzana marcada `needs_review` y **todos los lotes
sin precio**. Un lote sin precio se ve en el mapa pero **no se puede reservar**
(`LOT_NOT_PRICED`) — poner precios es lo que habilita la venta, manzana por
manzana, desde `/admin/lotes`.

Para corregir la geometría contra el plano real: `/admin/mapa` (dibujo,
subdivisión automática, importación CSV, publicar).

---

## Desarrollo

```bash
npm install
cp .env.example .env.local     # completar las claves
npm run dev

npx vitest run                 # motor de subdivisión (25 pruebas)
npx tsc --noEmit && npm run build
```

La geometría semilla se regenera con `npx tsx seed/generate.ts`
(escribe `seed/generated-geometry.json` y `seed/preview.svg`).

---

Hecho por [BolivAI](https://bolivai.com) para Terrenalv S.R.L.
