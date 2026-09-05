# Borradores del cliente y autorización interna — plan de implementación

> **Para agentes de IA:** implementar tarea por tarea. Los pasos usan casillas
> (`- [ ]`) para seguir el avance. No saltar el paso de "correr la prueba y
> verla fallar": es lo que prueba que la prueba sirve.

**Objetivo:** que el cliente arme borradores privados, los mande a autorizar a
su jefe (uno o varios en una liga) y solo lo autorizado llegue a REMALI.

**Arquitectura:** el borrador sale de `Cotizacion` a su propia tabla
(`BorradorCliente` + `BorradorItem` + `PaqueteAutorizacion`). `Cotizacion` nace
únicamente cuando la cotización llega a REMALI, y ahí es donde se asigna el
folio. El cálculo de precios se centraliza en `cotizaciones/precios.py`.

**Stack:** Django 5.2 + DRF + MySQL · React 19 + Vite + TS + Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-08-18-borradores-cliente-autorizacion-design.md`

**Cómo se corren las cosas** (de `CONTINUAR.md`, el venv está en `Remali/env`,
hermano de `backend/`):

```bash
cd backend && ../env/bin/python manage.py test cotizaciones -v 2   # pruebas
cd backend && ../env/bin/python manage.py check
cd backend && ../env/bin/python manage.py makemigrations --check --dry-run
cd frontend && npm run build       # usa tsc -b; el modo dev se traga errores
```

---

## Estructura de archivos

**Se crean**
| Archivo | Responsabilidad |
|---|---|
| `backend/apps/cotizaciones/precios.py` | Única fuente del precio: resolución por equipo, promo, desglose de IVA |
| `backend/apps/cotizaciones/models_borrador.py` | `BorradorCliente`, `BorradorItem`, `PaqueteAutorizacion` |
| `backend/apps/cotizaciones/serializers_borrador.py` | Serialización de los tres modelos |
| `backend/apps/cotizaciones/views_borrador.py` | Endpoints del cliente y la liga pública del jefe |
| `backend/apps/cotizaciones/conversion.py` | El único puente: borrador → `Cotizacion` |
| `backend/apps/cotizaciones/tests_borradores.py` | Pruebas de todo lo anterior |
| `backend/apps/cotizaciones/management/commands/purgar_borradores.py` | Limpieza de espacios de invitado |
| `frontend/src/lib/espacio.ts` | Token del invitado: guardar, leer, limpiar la URL |
| `frontend/src/routes/MisBorradores.tsx` | Pestaña de borradores (se monta dentro de `MisCotizaciones`) |

**Se modifican**
| Archivo | Cambio |
|---|---|
| `backend/apps/cotizaciones/models.py` | Importa los modelos nuevos; `base`/`iva` usan `precios.desglose`; se va `por_autorizar` y sus tres campos |
| `backend/apps/cotizaciones/views.py` | Se van `autorizacion_cotizacion`, `autorizacion_lote`, `crear_lote_autorizacion`, `mandar_a_autorizar`, `_construir_cotizacion`; `crear_cotizacion_publica` usa `precios.py` |
| `backend/apps/cotizaciones/urls.py` | Rutas nuevas; se retiran las de lote |
| `backend/apps/cotizaciones/serializers.py` | Quita los campos que se fueron |
| `frontend/src/lib/api.ts` | Manda el encabezado `X-Espacio` |
| `frontend/src/routes/Cotizacion.tsx` | Borradores al servidor; rescate de `localStorage` |
| `frontend/src/routes/MisCotizaciones.tsx` | Dos pestañas |
| `frontend/src/routes/AutorizarCotizacion.tsx` | Una sola pantalla para 1 y para N |
| `frontend/src/App.tsx` | Ruta `/mis-borradores/:token`; se va `/autorizar-lote/:token` |

**Se borra:** `frontend/src/routes/AutorizarLote.tsx`

---

## Tarea 1: El precio en un solo lugar ✅ HECHA

**Archivos:** crear `backend/apps/cotizaciones/precios.py`

Ya está escrita y verificada a mano: `desglose(11600, 0, False)` → base 10000,
IVA 1600 (venta con IVA incluido); `desglose(0, 1000, True)` → 1000 + 160;
`desglose(0, 1000, False)` → 1000 + 0. Falta amarrarla con pruebas (tarea 3).

---

## Tarea 2: Modelos del borrador

**Archivos:**
- Crear: `backend/apps/cotizaciones/models_borrador.py`
- Modificar: `backend/apps/cotizaciones/models.py` (al final, importar los nuevos)

- [ ] **Paso 1: escribir la prueba que falla**

En `backend/apps/cotizaciones/tests_borradores.py`:

```python
from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from cotizaciones.models_borrador import BorradorCliente, BorradorItem
from maquinaria.models import Equipo


class BorradorPrecioTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.eq = Equipo.objects.create(modelo='Revolvedora 1S', precio_venta=Decimal('11600'))

    def test_borrador_sin_congelar_sigue_al_catalogo(self):
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        self.assertEqual(b.total, Decimal('11600.00'))

        self.eq.precio_venta = Decimal('12000')
        self.eq.save(update_fields=['precio_venta'])
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).total, Decimal('12000.00'))

    def test_congelar_deja_el_precio_en_piedra(self):
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        b.congelar()
        b.estado = 'esperando'
        b.save(update_fields=['estado'])

        self.eq.precio_venta = Decimal('99000')
        self.eq.save(update_fields=['precio_venta'])
        self.assertEqual(BorradorCliente.objects.get(pk=b.pk).total, Decimal('11600.00'))

    def test_equipo_borrado_sale_del_total_y_se_avisa(self):
        b = BorradorCliente.objects.create(usuario=self.user)
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        self.eq.delete()
        b = BorradorCliente.objects.get(pk=b.pk)
        self.assertEqual(b.total, Decimal('0.00'))
        self.assertFalse(b.lineas()[0]['disponible'])
```

- [ ] **Paso 2: correrla y verla fallar**

`cd backend && ../env/bin/python manage.py test cotizaciones.tests_borradores -v 2`
Esperado: `ModuleNotFoundError: No module named 'cotizaciones.models_borrador'`

- [ ] **Paso 3: escribir el modelo**

`models_borrador.py` con `PaqueteAutorizacion`, `BorradorCliente`,
`BorradorItem` y el `DuenoMixin` (`usuario` XOR `espacio_token`, con
`CheckConstraint`). Los puntos que las pruebas amarran:
- `BorradorCliente.congelado` → `estado != 'armando'`
- `BorradorItem.resuelto(congelado)` → dict con `descripcion`, `precio_unitario`,
  `precio_lista`, `modalidad`, `subtotal`, `disponible`
- `BorradorCliente.congelar()` escribe los tres campos de precio
- `total` sale de `precios.desglose(subtotal_venta, subtotal_renta, requiere_factura)`

**No registrar nada en `admin.py`.** El spec lo pide explícito: no es un
olvido, es que REMALI decidió no tener esta información. Dejar el comentario en
el archivo para que dentro de seis meses nadie lo "arregle".

Al final de `models.py`:

```python
# Los borradores del cliente viven en su propio módulo (son otro mundo: otro
# dueño, otro ciclo, y REMALI no los ve). Se importan aquí para que Django los
# registre en la app.
from .models_borrador import (  # noqa: E402,F401
    BorradorCliente, BorradorItem, PaqueteAutorizacion,
)
```

- [ ] **Paso 4: migrar y correr**

```bash
cd backend && ../env/bin/python manage.py makemigrations cotizaciones
cd backend && ../env/bin/python manage.py test cotizaciones.tests_borradores -v 2
```
Esperado: 3 pruebas PASS.

- [ ] **Paso 5: commit**

```bash
git add backend/apps/cotizaciones/models_borrador.py backend/apps/cotizaciones/models.py \
        backend/apps/cotizaciones/migrations/ backend/apps/cotizaciones/tests_borradores.py \
        backend/apps/cotizaciones/precios.py
git commit -m "Borradores del cliente: modelos y precio en un solo lugar"
```

---

## Tarea 3: `Cotizacion` deja de cargar la etapa privada

**Archivos:** modificar `backend/apps/cotizaciones/models.py`,
`serializers.py`, `views.py`, `urls.py`

- [ ] **Paso 1: prueba que falla**

```python
class CotizacionLimpiaTests(TestCase):
    def test_ya_no_existe_el_estado_por_autorizar(self):
        from cotizaciones.models import Cotizacion
        self.assertNotIn('por_autorizar', dict(Cotizacion.ESTADOS))

    def test_el_desglose_del_modelo_usa_precios(self):
        from cotizaciones.models import Cotizacion
        from cotizaciones import precios
        cot = Cotizacion.objects.create(estado='enviada', aplica_iva=False)
        CotizacionItem.objects.create(cotizacion=cot, descripcion='x', cantidad=1,
                                      precio_unitario=Decimal('11600'), modalidad='venta')
        base, iva = precios.desglose(Decimal('11600'), Decimal('0'), False)
        self.assertEqual(cot.base, base)
        self.assertEqual(cot.iva, iva)
```

- [ ] **Paso 2: correr y ver fallar** — `por_autorizar` sigue en `ESTADOS`.

- [ ] **Paso 3: quitar**

En `models.py`: borrar la tupla `('por_autorizar', ...)` de `ESTADOS` y los
campos `token_autorizacion`, `token_lote`, `autorizacion_rechazo`. Dejar
`autorizada_por` y `autorizada_en`. Reescribir `base` e `iva`:

```python
    @property
    def base(self):
        return precios.desglose(self.subtotal_venta, self.subtotal_renta, self.aplica_iva)[0]

    @property
    def iva(self):
        return precios.desglose(self.subtotal_venta, self.subtotal_renta, self.aplica_iva)[1]
```

En `views.py`: borrar `autorizacion_cotizacion`, `autorizacion_lote`,
`crear_lote_autorizacion`, `mandar_a_autorizar`, `_construir_cotizacion` y
`_resolver_partida` (esta última se reemplaza por `precios.resolver_partida`).
En `crear_cotizacion_publica`: quitar la rama `por_autorizar` y usar
`precios.partida_de_equipo`. En `serializers.py`: quitar `autorizacion_rechazo`
de `fields`. En `urls.py`: quitar las rutas de esas vistas. En `views.py:997`, cambiar la
llave `detail` por `detalle`: es la única respuesta del módulo que rompe el
patrón, y la interfaz no la puede leer junto con las demás.

- [ ] **Paso 4: correr todo el módulo** — `manage.py test cotizaciones -v 2` y
`manage.py check`. Esperado: verde, sin referencias colgantes.

- [ ] **Paso 5: commit** — `git commit -m "La cotización deja de cargar la etapa privada del cliente"`

---

## Tarea 4: Los endpoints del cliente sobre sus borradores

**Archivos:** crear `serializers_borrador.py` y `views_borrador.py`; modificar `urls.py`

- [ ] **Paso 1: pruebas que fallan**

```python
from rest_framework.test import APIClient

class BorradoresAPITests(TestCase):
    def setUp(self):
        self.eq = Equipo.objects.create(modelo='Rotomartillo', precio_venta=Decimal('5800'))
        self.user = get_user_model().objects.create_user('cliente', password='x')
        self.c = APIClient()

    def test_invitado_recibe_su_espacio_al_crear_el_primero(self):
        r = self.c.post('/api/borradores/', {'nombre': 'Opción A',
                                             'items': [{'id': self.eq.id, 'cantidad': 1}]}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data['espacio_token'])

    def test_el_espacio_ajeno_da_404_no_403(self):
        r = self.c.post('/api/borradores/', {'items': [{'id': self.eq.id}]}, format='json')
        bid = r.data['borrador']['id']
        otro = APIClient()
        otro.credentials(HTTP_X_ESPACIO='0' * 32)
        self.assertEqual(otro.get(f'/api/borradores/{bid}/').status_code, 404)

    def test_tope_de_borradores(self):
        self.c.force_authenticate(self.user)
        for _ in range(20):
            BorradorCliente.objects.create(usuario=self.user)
        r = self.c.post('/api/borradores/', {'items': [{'id': self.eq.id}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo'], 'limite_borradores')
```

- [ ] **Paso 2: correr y ver fallar** — 404 en todas las rutas.

- [ ] **Paso 3: implementar**

`views_borrador.py` con el resolvedor de dueño:

```python
def _dueno(request, *, crear=False):
    """(usuario, espacio_token) — exactamente uno no nulo, o (None, None).

    El token del invitado viaja en el encabezado X-Espacio, nunca en la URL:
    un secreto en la barra de direcciones se filtra por historial, logs y Referer.
    """
    if request.user.is_authenticated:
        return request.user, None
    token = (request.META.get('HTTP_X_ESPACIO') or '').strip()
    if len(token) == 32 and token.isalnum():
        return None, token
    return (None, nuevo_token()) if crear else (None, None)


def _mis_borradores(request):
    usuario, espacio = _dueno(request)
    if usuario:
        return BorradorCliente.objects.filter(usuario=usuario)
    if espacio:
        return BorradorCliente.objects.filter(espacio_token=espacio)
    return BorradorCliente.objects.none()
```

Endpoints: `GET/POST /borradores/`, `GET/PATCH/DELETE /borradores/<id>/`,
`POST /borradores/<id>/duplicar/`. El que no es tuyo da **404**, no 403: un 403
confirma que existe.

- [ ] **Paso 4: correr** — 3 PASS.
- [ ] **Paso 5: commit** — `git commit -m "Borradores: los endpoints del cliente"`

---

## Tarea 5: El paquete y la liga del jefe

**Archivos:** `views_borrador.py`, `conversion.py`, `urls.py`

- [ ] **Paso 1: pruebas que fallan** — las tres que de verdad importan:

```python
class AutorizacionTests(TestCase):
    def _borrador(self):
        b = BorradorCliente.objects.create(usuario=self.user, datos_contacto={'nombre': 'Ana'})
        BorradorItem.objects.create(borrador=b, equipo=self.eq, cantidad=1, modalidad='venta')
        return b

    def test_rechazar_no_deja_rastro_en_remali(self):
        b = self._borrador()
        self.c.force_authenticate(self.user)
        r = self.c.post('/api/autorizaciones/', {'borradores': [b.id], 'modo': 'lista'}, format='json')
        token = r.data['token']
        antes = Cotizacion.objects.count()
        pub = APIClient()
        pub.post(f'/api/autorizacion/{token}/', {'nombre': 'Ing. Pérez', 'decisiones': [
            {'borrador': b.id, 'accion': 'rechazar', 'motivo': 'caro'}]}, format='json')
        self.assertEqual(Cotizacion.objects.count(), antes)          # no nació nada
        self.assertEqual(BorradorCliente.objects.get(pk=b.id).estado, 'rechazado')

    def test_no_se_queman_folios(self):
        """Tres versiones rechazadas y luego una autorizada: el folio es el 0001."""
        for _ in range(3):
            b = self._borrador()
            self.c.force_authenticate(self.user)
            t = self.c.post('/api/autorizaciones/', {'borradores': [b.id]}, format='json').data['token']
            APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
                {'borrador': b.id, 'accion': 'rechazar'}]}, format='json')
        b = self._borrador()
        t = self.c.post('/api/autorizaciones/', {'borradores': [b.id]}, format='json').data['token']
        APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
            {'borrador': b.id, 'accion': 'autorizar'}]}, format='json')
        cot = Cotizacion.objects.get()
        self.assertTrue(cot.folio.endswith('-0001'))
        self.assertEqual(cot.estado, 'aceptada')
        self.assertEqual(cot.autorizada_por, 'P')

    def test_modo_opciones_solo_deja_autorizar_una(self):
        a, b = self._borrador(), self._borrador()
        self.c.force_authenticate(self.user)
        t = self.c.post('/api/autorizaciones/',
                        {'borradores': [a.id, b.id], 'modo': 'opciones'}, format='json').data['token']
        r = APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
            {'borrador': a.id, 'accion': 'autorizar'},
            {'borrador': b.id, 'accion': 'autorizar'}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(Cotizacion.objects.count(), 0)

    def test_opciones_rechaza_sola_la_no_elegida(self):
        a, b = self._borrador(), self._borrador()
        self.c.force_authenticate(self.user)
        t = self.c.post('/api/autorizaciones/',
                        {'borradores': [a.id, b.id], 'modo': 'opciones'}, format='json').data['token']
        APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
            {'borrador': a.id, 'accion': 'autorizar'}]}, format='json')
        self.assertEqual(BorradorCliente.objects.get(pk=b.id).estado, 'rechazado')
        self.assertEqual(BorradorCliente.objects.get(pk=b.id).rechazo_motivo, 'No seleccionada')

    def test_paquete_vencido_no_se_autoriza(self):
        b = self._borrador()
        self.c.force_authenticate(self.user)
        t = self.c.post('/api/autorizaciones/', {'borradores': [b.id]}, format='json').data['token']
        p = PaqueteAutorizacion.objects.get(token=t)
        p.vence_el = timezone.now().date() - timedelta(days=1)
        p.save(update_fields=['vence_el'])
        r = APIClient().post(f'/api/autorizacion/{t}/', {'nombre': 'P', 'decisiones': [
            {'borrador': b.id, 'accion': 'autorizar'}]}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo'], 'paquete_vencido')

    def test_segunda_visita_no_es_error(self):
        b = self._borrador()
        self.c.force_authenticate(self.user)
        t = self.c.post('/api/autorizaciones/', {'borradores': [b.id]}, format='json').data['token']
        pub = APIClient()
        payload = {'nombre': 'P', 'decisiones': [{'borrador': b.id, 'accion': 'autorizar'}]}
        pub.post(f'/api/autorizacion/{t}/', payload, format='json')
        r = pub.post(f'/api/autorizacion/{t}/', payload, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['ya_resuelto'])
        self.assertEqual(Cotizacion.objects.count(), 1)      # no se duplicó
```

- [ ] **Paso 2: correr y ver fallar.**

- [ ] **Paso 3: implementar**

`conversion.py` — el único puente entre los dos mundos:

```python
def cotizacion_desde_borrador(borrador, *, autorizada_por=''):
    """Crea la Cotizacion de REMALI a partir de un borrador ya congelado.

    Aquí y solo aquí cruza la frontera. El folio nace en este momento: es el
    instante en que la cotización empieza a existir para el negocio.
    """
```

Copia partidas (ya con precio congelado), `origen='cliente'`, `estado='aceptada'`
si vino autorizada, sella `autorizada_por`/`autorizada_en`, ata el cupón, y deja
`borrador.cotizacion` y `borrador.estado='entregado'`.

Los dos endpoints públicos del jefe y el alta de borradores de invitado llevan
`@throttle_classes([SolicitudPublicaThrottle])`, el mismo techo que ya protege
`crear_cotizacion_publica`: sin él, una liga filtrada es un grifo de correos.

`POST /api/autorizaciones/` congela con `select_for_update` sobre los borradores.
`POST /api/autorizacion/<token>/` valida el modo, aplica decisiones, y manda **una
sola** notificación por paquete con todos los folios.

- [ ] **Paso 4: correr** — 6 PASS.
- [ ] **Paso 5: commit** — `git commit -m "El paquete de autorización y la liga del jefe"`

---

## Tarea 6: Reclamar el espacio y reenviar la liga

**Archivos:** `views_borrador.py`, `urls.py`

- [ ] **Paso 1: prueba**

```python
def test_al_registrarse_los_borradores_se_reclaman(self):
    r = APIClient().post('/api/borradores/', {'items': [{'id': self.eq.id}]}, format='json')
    token = r.data['espacio_token']
    self.c.force_authenticate(self.user)
    self.c.credentials(HTTP_X_ESPACIO=token)
    r = self.c.post('/api/espacio/reclamar/', {}, format='json')
    self.assertEqual(r.data['reclamados'], 1)
    b = BorradorCliente.objects.get()
    self.assertEqual(b.usuario_id, self.user.id)
    self.assertIsNone(b.espacio_token)      # el CheckConstraint lo exige
```

- [ ] **Paso 2: correr y ver fallar.**
- [ ] **Paso 3: implementar** `reclamar_espacio` (transacción, mueve dueño de
      borradores y paquetes) y `reenviar_liga` (manda al correo del cliente, lo
      dispara él).
- [ ] **Paso 4: correr** — PASS.
- [ ] **Paso 5: commit** — `git commit -m "Reclamar el espacio del invitado al iniciar sesión"`

---

## Tarea 7: Limpieza de espacios abandonados

**Archivos:** crear `management/commands/purgar_borradores.py`

- [ ] **Paso 1: prueba**

```python
def test_purga_espacios_de_invitado_viejos(self):
    from django.core.management import call_command
    b = BorradorCliente.objects.create(espacio_token='a' * 32)
    BorradorCliente.objects.filter(pk=b.pk).update(
        actualizado=timezone.now() - timedelta(days=91))
    mio = BorradorCliente.objects.create(usuario=self.user)
    BorradorCliente.objects.filter(pk=mio.pk).update(
        actualizado=timezone.now() - timedelta(days=400))
    call_command('purgar_borradores')
    self.assertFalse(BorradorCliente.objects.filter(pk=b.pk).exists())
    self.assertTrue(BorradorCliente.objects.filter(pk=mio.pk).exists())   # el de cuenta no se toca
```

- [ ] **Paso 2: correr y ver fallar.**
- [ ] **Paso 3: implementar** — borra solo `espacio_token__isnull=False` sin
      actividad en 90 días. El de cuenta nunca se purga: el cliente tiene dónde
      volver por él.
- [ ] **Paso 4: correr** — PASS.
- [ ] **Paso 5: commit** — `git commit -m "Purga de espacios de invitado abandonados"`

---

## Tarea 8: El token del invitado en el frontend

**Archivos:** crear `frontend/src/lib/espacio.ts`; modificar `frontend/src/lib/api.ts`, `App.tsx`

- [ ] **Paso 1: implementar `espacio.ts`**

```ts
const LLAVE = 'remali_espacio'

export const leerEspacio = () => localStorage.getItem(LLAVE) || ''
export const guardarEspacio = (t: string) => { if (t) localStorage.setItem(LLAVE, t) }

/** La liga /mis-borradores/<token> es de RECUPERACIÓN: guarda el token y se va.
 *  El secreto no se queda en la barra de direcciones, donde se filtra por
 *  historial, logs del servidor y el Referer de cualquier imagen externa. */
export function rescatarDeLaUrl(token: string) {
  guardarEspacio(token)
  window.history.replaceState({}, '', '/mis-cotizaciones?tab=borradores')
}
```

- [ ] **Paso 2:** en `frontend/index.html`, dentro del `<head>`:
      `<meta name="referrer" content="strict-origin-when-cross-origin">`, y en la
      vista de rescate un `<meta name="referrer" content="no-referrer">` mientras
      el token está en la URL. Sin esto, el token se va en el `Referer` de
      cualquier recurso externo que cargue la página.
- [ ] **Paso 3:** en `api.ts`, agregar el encabezado en el interceptor de request:
      `if (!hayToken) config.headers['X-Espacio'] = leerEspacio()`.
- [ ] **Paso 4:** ruta `/mis-borradores/:token` en `App.tsx` que llama a
      `rescatarDeLaUrl`. Quitar `/autorizar-lote/:token`.
- [ ] **Paso 5:** `cd frontend && npm run build` — sin errores de TS.
- [ ] **Paso 6: commit** — `git commit -m "Frontend: el espacio del invitado"`

---

## Tarea 9: Armar y guardar borradores contra el servidor

**Archivos:** modificar `frontend/src/routes/Cotizacion.tsx`

- [ ] **Paso 1:** cambiar `persistir()` por llamadas a `POST /borradores/`;
      `borrarBorrador` por `DELETE`. El estado local pasa a venir de
      `GET /borradores/`.
- [ ] **Paso 2: rescate de lo viejo** — al montar, si existe la llave
      `remali_borradores`, subir cada uno con `POST /borradores/` y borrar la
      llave. Nadie pierde lo que ya tenía guardado.
- [ ] **Paso 3:** `npm run build`.
- [ ] **Paso 4:** a mano: guardar dos borradores, recargar la página, verlos.
- [ ] **Paso 5: commit** — `git commit -m "Los borradores del cliente viven en el servidor"`

---

## Tarea 10: Las dos pestañas y el envío en una liga

**Archivos:** crear `MisBorradores.tsx`; modificar `MisCotizaciones.tsx`

- [ ] **Paso 1:** `MisCotizaciones.tsx` gana dos pestañas: **Mis borradores** y
      **Con REMALI**. La segunda es lo que ya hace hoy, sin tocar.
- [ ] **Paso 2:** `MisBorradores.tsx`: lista con total por borrador, duplicar,
      borrar, y selección múltiple → *"Mandar a autorizar"* con el modo
      (opciones / lista), el recado, y la liga lista para copiar.
- [ ] **Paso 3:** `npm run build`.
- [ ] **Paso 4:** a mano: tres borradores, palomear dos, generar la liga.
- [ ] **Paso 5: commit** — `git commit -m "Mis borradores: comparar, duplicar y mandar en una liga"`

---

## Tarea 11: Una sola pantalla para el jefe

**Archivos:** modificar `AutorizarCotizacion.tsx`; borrar `AutorizarLote.tsx`

- [ ] **Paso 1:** la pantalla lee el paquete y pinta sus borradores. Radios si
      `modo === 'opciones'`, casillas si `modo === 'lista'`. Total combinado
      arriba. El recado del cliente, visible.
- [ ] **Paso 2:** `ya_resuelto` pinta el desenlace ("lo autorizaste el 12/ago"),
      nunca un error rojo.
- [ ] **Paso 3:** `git rm frontend/src/routes/AutorizarLote.tsx`.
- [ ] **Paso 4:** `npm run build` + prueba a mano en incógnito.
- [ ] **Paso 5: commit** — `git commit -m "Una sola pantalla de autorización para uno y para varios"`

---

## Tarea 12: Cierre

- [ ] `cd backend && ../env/bin/python manage.py test cotizaciones -v 2` — todo verde
- [ ] `manage.py check` y `makemigrations --check --dry-run` — limpio
- [ ] `cd frontend && npm run build` — limpio
- [ ] Recorrido completo a mano: tres borradores sin cuenta → recuperar con la
      liga → registrarse y verlos reclamados → mandar los tres en una liga →
      rechazar uno, autorizar dos → el panel recibe **dos folios consecutivos**
      y ni rastro del tercero.
- [ ] Actualizar `CONTINUAR.md` con la sección nueva.
- [ ] `git commit -m "Entrega F: el taller privado del cliente"`
