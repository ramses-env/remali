# Permisos configurables por rol — plan de implementación

> **Para el agente que lo ejecute:** subskill obligatoria — usa
> `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> casillas (`- [ ]`) para llevar el avance.

**Objetivo:** que el dueño encienda y apague capacidades por rol desde el panel,
que el backend las obedezca de verdad, y que quede rastro de quién cambió qué.

**Arquitectura:** `puede_de()` resuelve en tres capas —nivel → fábrica
(`AJUSTES_POR_PUESTO`) → override guardado— leyendo una tabla `PermisoRol` que
solo contiene lo que difiere de fábrica. Guardar exige el código de 6 dígitos,
escribe `CambioPermisoRol` (append-only) y toca el sello `permisos` del latido,
que hace que los paneles abiertos re-pidan su perfil en un par de segundos.

**Stack:** Django + DRF + SQLite/PostgreSQL · React + TypeScript + Tailwind ·
pruebas con `manage.py test` (el frontend no tiene runner: se verifica con
`npm run build` y `npm run lint`).

**Diseño:** `docs/superpowers/specs/2026-08-22-permisos-configurables-design.md`
**Maqueta de la pantalla:** `.superpowers/brainstorm/98327-1787444272/content/matriz-a2.html`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/apps/maquinaria/permissions.py` (modificar) | Catálogo con área, `NUCLEO`, `ROLES_EDITABLES`, `capacidades_fabrica()`, `puede_de()` con overrides |
| `backend/apps/maquinaria/models.py` (modificar) | `PermisoRol` y `CambioPermisoRol` |
| `backend/apps/maquinaria/latido.py` (modificar) | Sello `permisos` |
| `backend/apps/maquinaria/views_permisos.py` (crear) | Los tres endpoints |
| `backend/apps/maquinaria/urls.py` (modificar) | Rutas |
| `backend/apps/maquinaria/tests_permisos_configurables.py` (crear) | Resolución, núcleo, bitácora, código |
| `backend/apps/maquinaria/tests_permisos_imponen.py` (crear) | Que la pantalla no mienta |
| `frontend/src/routes/dashboard/permisos.tsx` (crear) | La matriz completa |
| `frontend/src/lib/realtime.ts` (modificar) | Tema `permisos` |
| `frontend/src/lib/acceso.ts` (modificar) | Tipo `Capacidades` + `configurar_permisos` |
| `frontend/src/routes/dashboard/comun.tsx` (modificar) | `Section` y `SECTION_META` |
| `frontend/src/routes/Dashboard.tsx` (modificar) | Los cinco puntos de integración |

La pantalla va en su propio archivo, no dentro de `Dashboard.tsx` (4 000+
líneas) ni de `configuracion.tsx` (1 227): es el patrón que ya siguen
`usuarios.tsx` y `reparaciones.tsx`.

---

# FASE 1 · Resolución en el backend

### Tarea 1: Congelar el comportamiento de hoy

Esto va **antes que todo**. Es el seguro de que la obra no le quita nada a nadie
en silencio.

**Archivos:**
- Crear: `backend/apps/maquinaria/tests_permisos_configurables.py`

- [ ] **Paso 1: escribir la prueba de no-regresión**

```python
"""Los permisos configurables no le quitan nada a nadie en silencio.

La primera prueba de este archivo congela lo que `puede_de()` responde HOY para
cada rol. Si una entrega futura la rompe, no es que la prueba esté vieja: es que
alguien le movió los permisos al equipo sin querer.
"""
from django.contrib.auth.models import Group, User
from django.test import TestCase

from maquinaria.permissions import puede_de


def _usuario(nombre, grupo=None, staff=False, superusuario=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345',
                                 is_staff=staff, is_superuser=superusuario)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class FabricaCongeladaTest(TestCase):
    """Lo que cada rol puede cuando NADIE ha configurado nada."""

    def test_dueno_lo_puede_todo(self):
        caps = puede_de(_usuario('duena', superusuario=True))
        self.assertEqual(caps['nivel'], 3)
        self.assertTrue(caps['gestionar_usuarios'])
        self.assertTrue(caps['editar_datos_bancarios'])
        self.assertTrue(caps['ver_dinero'])

    def test_administrador(self):
        caps = puede_de(_usuario('admin', 'Administrador'))
        self.assertEqual(caps['nivel'], 2)
        self.assertTrue(caps['ver_dinero'])
        self.assertTrue(caps['cotizar'])
        self.assertTrue(caps['tener_codigo_propio'])
        self.assertFalse(caps['gestionar_usuarios'])
        self.assertFalse(caps['editar_datos_bancarios'])

    def test_gestor_opera_sin_ver_las_cuentas(self):
        caps = puede_de(_usuario('gestor', 'Gestor'))
        self.assertEqual(caps['nivel'], 2)
        self.assertFalse(caps['ver_dinero'])          # el punto entero del rol
        self.assertTrue(caps['ver_operacion'])
        self.assertTrue(caps['configurar_negocio'])
        self.assertFalse(caps['tener_codigo_propio'])
        self.assertFalse(caps['editar_datos_bancarios'])

    def test_cajero_es_mostrador_no_campo(self):
        caps = puede_de(_usuario('cajero', 'Cajero'))
        self.assertEqual(caps['nivel'], 1)
        self.assertTrue(caps['usar_caja'])
        self.assertTrue(caps['corte_caja'])
        self.assertTrue(caps['vender'])
        self.assertFalse(caps['rentar'])
        self.assertFalse(caps['reparar'])
        self.assertFalse(caps['cotizar'])
        self.assertFalse(caps['ver_dinero'])

    def test_tecnico_es_campo_no_mostrador(self):
        caps = puede_de(_usuario('tecnico', 'Técnico'))
        self.assertEqual(caps['nivel'], 1)
        self.assertTrue(caps['jornada_campo'])
        self.assertTrue(caps['reparar'])
        self.assertTrue(caps['operar_inventario'])
        self.assertFalse(caps['vender'])
        self.assertFalse(caps['rentar'])
        self.assertFalse(caps['usar_caja'])

    def test_sin_rol_no_entra(self):
        caps = puede_de(_usuario('cliente'))
        self.assertEqual(caps['nivel'], 0)
        self.assertFalse(caps['ver_operacion'])
```

- [ ] **Paso 2: correrla y ver que pasa TODA**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables -v 2`
Esperado: PASS (6 pruebas). Si alguna falla aquí, el diseño partió de una
suposición equivocada — **detente y avisa**, no la ajustes para que pase.

- [ ] **Paso 3: commit**

```bash
git add backend/apps/maquinaria/tests_permisos_configurables.py
git commit -m "Prueba: congelar qué puede hoy cada rol, antes de tocar nada"
```

---

### Tarea 2: Área en el catálogo, la capacidad nueva y el núcleo

**Archivos:**
- Modificar: `backend/apps/maquinaria/permissions.py:145-250`
- Prueba: `backend/apps/maquinaria/tests_permisos_configurables.py`

- [ ] **Paso 1: prueba que falla**

Agregar al archivo de pruebas:

```python
from maquinaria.permissions import (
    CATALOGO, NUCLEO, ROLES_EDITABLES, capacidades_fabrica, catalogo_capacidades,
)


class CatalogoTest(TestCase):

    def test_toda_capacidad_tiene_area(self):
        for cap in CATALOGO:
            self.assertTrue(cap.area, f'{cap.nombre} sin área')

    def test_existe_configurar_permisos_y_es_del_nucleo(self):
        nombres = {c.nombre for c in CATALOGO}
        self.assertIn('configurar_permisos', nombres)
        self.assertIn('configurar_permisos', NUCLEO)

    def test_el_nucleo_son_cinco(self):
        self.assertEqual(NUCLEO, frozenset({
            'gestionar_usuarios', 'editar_datos_bancarios', 'borrar_catalogo',
            'tener_codigo_propio', 'configurar_permisos',
        }))

    def test_roles_editables_no_incluyen_al_dueno(self):
        self.assertEqual(ROLES_EDITABLES,
                         ('Gestor', 'Administrador', 'Cajero', 'Técnico'))

    def test_fabrica_por_rol_coincide_con_puede_de(self):
        """`capacidades_fabrica('Cajero')` dice lo mismo que un cajero real."""
        caps_usuario = puede_de(_usuario('cajero2', 'Cajero'))
        caps_rol = capacidades_fabrica('Cajero')
        for cap in CATALOGO:
            self.assertEqual(caps_rol[cap.nombre], caps_usuario[cap.nombre], cap.nombre)

    def test_el_catalogo_serializado_lleva_area_y_nucleo(self):
        fila = next(c for c in catalogo_capacidades() if c['nombre'] == 'cotizar')
        self.assertEqual(fila['area'], 'Mostrador')
        self.assertFalse(fila['nucleo'])
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables.CatalogoTest -v 2`
Esperado: FAIL con `ImportError: cannot import name 'NUCLEO'`.

- [ ] **Paso 3: implementar**

En `permissions.py`, cambiar la tupla `Capacidad` y agregar el área a las 23
entradas existentes (el área es temática; el candado lo decide `NUCLEO`, no el
área):

```python
class Capacidad(NamedTuple):
    nombre: str
    etiqueta: str
    descripcion: str
    nivel_minimo: Optional[int]
    area: str
```

Áreas por capacidad — se agregan como quinto argumento posicional:

| Área | Capacidades |
|---|---|
| `'Dinero y cuentas'` | `ver_dinero`, `ver_operacion`, `ver_montos_operacion` |
| `'Mostrador'` | `usar_caja`, `corte_caja`, `vender`, `cotizar`, `facturar` |
| `'Campo y taller'` | `rentar`, `reparar`, `gestionar_reparaciones`, `operar_inventario`, `jornada_campo`, `ver_jornada` |
| `'Catálogo e inventario'` | `editar_catalogo`, `alta_inventario`, `borrar_catalogo` |
| `'Clientes'` | `ver_clientes`, `editar_clientes` |
| `'Llaves del negocio'` | `gestionar_usuarios`, `configurar_negocio`, `editar_datos_bancarios`, `tener_codigo_propio`, `configurar_permisos` |

La capacidad nueva, al final del `CATALOGO`:

```python
    Capacidad('configurar_permisos', 'Configurar los permisos',
              'Encender y apagar capacidades por rol. Solo el Dueño: quien tenga '
              'esta pantalla se puede conceder todo lo demás.', NIVEL_DUENO,
              'Llaves del negocio'),
```

Y después del `CATALOGO`:

```python
#: Capacidades que NINGUNA pantalla reparte. Que estén aquí no significa que
#: nadie las tenga: significa que su valor es el de fábrica y ahí se queda.
#: `tener_codigo_propio` entra porque quien tiene NIP se autoriza a sí mismo las
#: excepciones —ajustar el precio al vender, entre otras—, que es la vía discreta
#: de sacar dinero que documenta `CambioPrecioLista`.
NUCLEO = frozenset({
    'gestionar_usuarios', 'editar_datos_bancarios', 'borrar_catalogo',
    'tener_codigo_propio', 'configurar_permisos',
})

#: Los roles que la pantalla configura. El Dueño no está: lo puede todo, siempre,
#: y una casilla suya solo sería una forma de encerrarse fuera de su sistema.
ROLES_EDITABLES = (ROL_GESTOR, ROL_ADMIN, ROL_CAJERO, ROL_TECNICO)

#: Nivel de partida de cada rol editable.
NIVEL_POR_ROL = {
    ROL_GESTOR: NIVEL_ADMIN, ROL_ADMIN: NIVEL_ADMIN,
    ROL_CAJERO: NIVEL_TECNICO, ROL_TECNICO: NIVEL_TECNICO,
}


def capacidades_fabrica(rol: str) -> dict:
    """Lo que un rol puede ANTES de que el dueño configure nada.

    Es la misma cuenta que hacía `puede_de` —nivel, más el ajuste del puesto—,
    pero indexada por ROL en vez de por usuario: la pantalla necesita saber qué
    trae de fábrica un puesto sin tener a nadie de ese puesto enfrente.
    """
    nivel = NIVEL_POR_ROL.get(rol, SIN_ACCESO)
    caps = {c.nombre: (c.nivel_minimo is not None and nivel >= c.nivel_minimo)
            for c in CATALOGO}
    if rol == ROL_GESTOR:
        caps.update(AJUSTES_POR_PUESTO[ROL_GESTOR])
    elif rol == ROL_CAJERO:
        caps.update(AJUSTES_POR_PUESTO[ROL_CAJERO])
    elif rol == ROL_TECNICO:
        caps.update(AJUSTES_POR_PUESTO[None])
    return caps
```

Y `catalogo_capacidades()` pasa a marcar el candado:

```python
def catalogo_capacidades() -> list:
    """El catálogo como datos serializables, para que el panel pinte la matriz
    sola: etiqueta, explicación, área y si lleva candado."""
    return [{**c._asdict(), 'nucleo': c.nombre in NUCLEO} for c in CATALOGO]
```

- [ ] **Paso 4: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables -v 2`
Esperado: PASS, incluidas las seis de la Tarea 1 (la refactorización no cambió
lo que puede nadie).

- [ ] **Paso 5: commit**

```bash
git add backend/apps/maquinaria/permissions.py backend/apps/maquinaria/tests_permisos_configurables.py
git commit -m "Catálogo de capacidades con área, núcleo intocable y fábrica por rol"
```

---

### Tarea 3: Las dos tablas

**Archivos:**
- Modificar: `backend/apps/maquinaria/models.py` (después de `CambioPrecioLista`, ~línea 871)
- Crear: migración

- [ ] **Paso 1: prueba que falla**

```python
from maquinaria.models import CambioPermisoRol, PermisoRol


class TablasTest(TestCase):

    def test_un_rol_no_repite_capacidad(self):
        from django.db import IntegrityError
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        with self.assertRaises(IntegrityError):
            PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=False)

    def test_la_bitacora_guarda_de_que_a_que(self):
        fila = CambioPermisoRol.objects.create(
            rol='Cajero', capacidad='cotizar', anterior=False, nuevo=True)
        self.assertEqual(str(fila), 'Cajero · cotizar: False → True')
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables.TablasTest -v 2`
Esperado: FAIL, `ImportError: cannot import name 'PermisoRol'`.

- [ ] **Paso 3: implementar los modelos**

```python
class PermisoRol(models.Model):
    """Una capacidad que el dueño movió respecto de fábrica, para un rol.

    Solo se guarda lo que DIFIERE: si vuelve a su valor original, la fila se
    borra. Así "¿qué toqué yo?" es una consulta y no un diff, y el punto dorado
    de la pantalla es literalmente "¿existe la fila?".

    `rol` y `capacidad` van como texto y no como llave foránea porque el catálogo
    vive en el código, que es donde están la etiqueta y la explicación. Se validan
    contra `permissions.CATALOGO` al guardar desde la API.
    """
    rol = models.CharField(max_length=30)
    capacidad = models.CharField(max_length=40)
    permitido = models.BooleanField()
    actualizado_por = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name='permisos_rol')
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'permiso_rol'
        unique_together = ('rol', 'capacidad')
        ordering = ['rol', 'capacidad']
        verbose_name = 'Permiso por rol'
        verbose_name_plural = 'Permisos por rol'

    def __str__(self):
        return f'{self.rol} · {self.capacidad} = {self.permitido}'


class CambioPermisoRol(models.Model):
    """Quién cambió qué permiso, cuándo y de qué a qué. Append-only.

    Gemela de `CambioPrecioLista`, y por la misma razón: repartir permisos es
    trabajo legítimo del dueño, no se bloquea; se hace VISIBLE.
    """
    rol = models.CharField(max_length=30)
    capacidad = models.CharField(max_length=40)
    anterior = models.BooleanField(null=True, blank=True)   # null = venía de fábrica
    nuevo = models.BooleanField(null=True, blank=True)      # null = se restableció
    usuario = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
                                null=True, blank=True, related_name='cambios_permiso')
    rol_usuario = models.CharField(max_length=30, blank=True, default='')
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'cambio_permiso_rol'
        ordering = ['-creado_en']
        verbose_name = 'Cambio de permiso'
        verbose_name_plural = 'Cambios de permisos'

    def __str__(self):
        return f'{self.rol} · {self.capacidad}: {self.anterior} → {self.nuevo}'
```

- [ ] **Paso 4: generar y aplicar la migración**

```bash
cd backend && python manage.py makemigrations maquinaria && python manage.py migrate
```
Esperado: crea `permiso_rol` y `cambio_permiso_rol`.

- [ ] **Paso 5: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables -v 2`
Esperado: PASS.

- [ ] **Paso 6: commit**

```bash
git add backend/apps/maquinaria/models.py backend/apps/maquinaria/migrations/ backend/apps/maquinaria/tests_permisos_configurables.py
git commit -m "Tablas: overrides de permisos y su bitácora append-only"
```

---

### Tarea 4: `puede_de()` obedece los overrides

**Archivos:**
- Modificar: `backend/apps/maquinaria/permissions.py:255-280`

- [ ] **Paso 1: pruebas que fallan**

```python
class OverridesTest(TestCase):

    def test_enciende_una_capacidad_de_nivel_superior(self):
        cajero = _usuario('cajero3', 'Cajero')
        self.assertFalse(puede_de(cajero)['cotizar'])
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertTrue(puede_de(cajero)['cotizar'])

    def test_apaga_una_capacidad_propia(self):
        cajero = _usuario('cajero4', 'Cajero')
        PermisoRol.objects.create(rol='Cajero', capacidad='usar_caja', permitido=False)
        self.assertFalse(puede_de(cajero)['usar_caja'])

    def test_borrar_el_override_devuelve_la_fabrica(self):
        cajero = _usuario('cajero5', 'Cajero')
        fila = PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        fila.delete()
        self.assertFalse(puede_de(cajero)['cotizar'])

    def test_el_nucleo_se_ignora_aunque_alguien_meta_la_fila_a_mano(self):
        """Defensa en profundidad: la API lo rechaza, y aun así no surte efecto."""
        cajero = _usuario('cajero6', 'Cajero')
        PermisoRol.objects.create(rol='Cajero', capacidad='gestionar_usuarios', permitido=True)
        self.assertFalse(puede_de(cajero)['gestionar_usuarios'])

    def test_el_dueno_no_recibe_overrides(self):
        duena = _usuario('duena2', superusuario=True)
        PermisoRol.objects.create(rol='Administrador', capacidad='ver_dinero', permitido=False)
        self.assertTrue(puede_de(duena)['ver_dinero'])

    def test_un_error_de_base_cae_a_fabrica_y_no_reparte(self):
        from unittest.mock import patch
        cajero = _usuario('cajero7', 'Cajero')
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        with patch('maquinaria.permissions.PermisoRol.objects.filter',
                   side_effect=Exception('base caída')):
            caps = puede_de(cajero)
        self.assertFalse(caps['cotizar'])     # fail-closed: no se reparte de más
        self.assertTrue(caps['usar_caja'])    # y lo de fábrica sigue trabajando
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables.OverridesTest -v 2`
Esperado: FAIL — el primero, en `assertTrue(puede_de(cajero)['cotizar'])`.

- [ ] **Paso 3: implementar**

En `permissions.py`, agregar el lector y cambiar `puede_de`:

```python
def overrides_de_rol(rol: str) -> dict:
    """Lo que el dueño configuró para ese rol. El núcleo se filtra aquí también:
    la API lo rechaza al guardar, y esto lo vuelve a rechazar al leer, por si
    una fila llegó por otra vía (un respaldo viejo, el /admin/ de Django).

    Fail-closed: si la consulta truena —base a medio migrar, por ejemplo—,
    devuelve vacío y manda la fábrica. Un error no reparte permisos.
    """
    if rol not in ROLES_EDITABLES:
        return {}
    try:
        from .models import PermisoRol
        filas = PermisoRol.objects.filter(rol=rol).values_list('capacidad', 'permitido')
        return {cap: bool(val) for cap, val in filas if cap not in NUCLEO}
    except Exception:
        return {}


def puede_de(user) -> dict:
    """Capacidades del usuario, para que el panel oculte lo que no aplica.

    Tres capas, y la última manda:
        nivel (jerarquía) → ajuste por puesto (fábrica) → override del dueño.

    Es un espejo de lo que ya imponen las clases de permiso: informativo para la
    interfaz, nunca la única defensa.
    """
    n = nivel_de(user)
    rol = rol_de(user)
    if n == SIN_ACCESO:
        caps = {c.nombre: False for c in CATALOGO}
    else:
        caps = capacidades_fabrica(rol) if rol in ROLES_EDITABLES else {
            c.nombre: (c.nivel_minimo is not None and n >= c.nivel_minimo) for c in CATALOGO
        }
        caps.update(overrides_de_rol(rol))
    caps['nivel'] = n
    caps['rol'] = rol
    return caps
```

Nota para quien implemente: el bloque `if n == NIVEL_TECNICO: ... elif n == NIVEL_ADMIN and es_gestor(user)` que existía se va — esa cuenta ahora la hace `capacidades_fabrica(rol)`, y `rol_de()` ya distingue Cajero de Técnico y Gestor de Administrador por su grupo.

- [ ] **Paso 4: correr TODAS las pruebas del archivo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables -v 2`
Esperado: PASS, con las seis de la Tarea 1 intactas.

- [ ] **Paso 5: correr la suite completa del backend**

Correr: `cd backend && python manage.py test 2>&1 | tail -5`
Esperado: OK. Aquí es donde se vería si alguna prueba vieja dependía de la forma
anterior de `puede_de`.

- [ ] **Paso 6: commit**

```bash
git add backend/apps/maquinaria/permissions.py backend/apps/maquinaria/tests_permisos_configurables.py
git commit -m "puede_de resuelve en tres capas: nivel, fábrica y lo que configuró el dueño"
```

---

### Tarea 5: El sello del latido

**Archivos:**
- Modificar: `backend/apps/maquinaria/latido.py:12-36`

- [ ] **Paso 1: prueba que falla**

```python
class SelloTest(TestCase):

    def _marca(self):
        from maquinaria.models import SelloTema
        fila = SelloTema.objects.filter(tema='permisos').first()
        return fila.marca if fila else None

    def test_guardar_un_override_mueve_el_sello(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertIsNotNone(self._marca())

    def test_borrarlo_tambien(self):
        fila = PermisoRol.objects.create(rol='Cajero', capacidad='vender', permitido=False)
        antes = self._marca()
        fila.delete()
        self.assertGreater(self._marca(), antes)
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables.SelloTest -v 2`
Esperado: FAIL, `AssertionError: unexpectedly None`.

- [ ] **Paso 3: implementar**

En `latido.py`, agregar al diccionario `REGISTRO`:

```python
    'maquinaria.PermisoRol': ('permisos',),
```

- [ ] **Paso 4: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_configurables.SelloTest -v 2`
Esperado: PASS.

- [ ] **Paso 5: commit**

```bash
git add backend/apps/maquinaria/latido.py backend/apps/maquinaria/tests_permisos_configurables.py
git commit -m "El latido avisa cuando los permisos cambian"
```

---

# FASE 2 · La API

### Tarea 6: `GET /api/permisos/`

**Archivos:**
- Crear: `backend/apps/maquinaria/views_permisos.py`
- Modificar: `backend/apps/maquinaria/urls.py:77` (junto a `latido/`)
- Modificar: `backend/apps/maquinaria/permissions.py` (agregar `PuedeConfigurarPermisos`)
- Crear: `backend/apps/maquinaria/tests_permisos_api.py`

- [ ] **Paso 1: prueba que falla**

```python
"""La API de permisos: quién la abre, qué devuelve y qué rechaza."""
from django.contrib.auth.models import Group, User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import CambioPermisoRol, PermisoRol
from maquinaria.seguridad import definir_codigo


def _usuario(nombre, grupo=None, sup=False):
    u = User.objects.create_user(nombre, f'{nombre}@x.com', 'pass12345', is_superuser=sup)
    if grupo:
        u.groups.add(Group.objects.get_or_create(name=grupo)[0])
    return u


class LeerPermisosTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def test_devuelve_todo_lo_que_la_matriz_necesita(self):
        r = self.api.get('/api/permisos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual([x['nombre'] for x in r.data['roles']],
                         ['Gestor', 'Administrador', 'Cajero', 'Técnico'])
        cotizar = next(c for c in r.data['catalogo'] if c['nombre'] == 'cotizar')
        self.assertEqual(cotizar['etiqueta'], 'Cotizar')
        self.assertEqual(cotizar['area'], 'Mostrador')
        self.assertFalse(cotizar['nucleo'])
        self.assertFalse(r.data['fabrica']['Cajero']['cotizar'])
        self.assertFalse(r.data['efectivo']['Cajero']['cotizar'])
        self.assertEqual(r.data['overrides'], [])

    def test_el_efectivo_refleja_lo_configurado_y_la_fabrica_no(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        r = self.api.get('/api/permisos/')
        self.assertTrue(r.data['efectivo']['Cajero']['cotizar'])
        self.assertFalse(r.data['fabrica']['Cajero']['cotizar'])
        self.assertEqual(len(r.data['overrides']), 1)

    def test_un_gestor_no_la_abre(self):
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        self.assertEqual(api.get('/api/permisos/').status_code, 403)

    def test_un_administrador_tampoco(self):
        api = APIClient()
        api.force_authenticate(_usuario('admin', 'Administrador'))
        self.assertEqual(api.get('/api/permisos/').status_code, 403)
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_api.LeerPermisosTest -v 2`
Esperado: FAIL con 404 — la ruta no existe.

- [ ] **Paso 3: implementar**

En `permissions.py`, junto a las otras clases de capacidad:

```python
class PuedeConfigurarPermisos(ExigeCapacidad):
    """La pantalla de permisos. Solo el Dueño: `configurar_permisos` es del
    núcleo y su nivel mínimo es NIVEL_DUENO, así que ningún override la abre."""
    capacidad = 'configurar_permisos'
    message = 'Solo el dueño configura los permisos.'
```

Crear `views_permisos.py`:

```python
"""Permisos configurables por rol: leer la matriz y guardarla.

La autorización de ESTA pantalla es doble a propósito: `configurar_permisos`
para abrirla (y es del núcleo, así que no se puede regalar) y el código de 6
dígitos para guardar. Ver
docs/superpowers/specs/2026-08-22-permisos-configurables-design.md
"""
from django.db import transaction
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import CambioPermisoRol, PermisoRol
from .permissions import (
    CATALOGO, NIVEL_POR_ROL, NUCLEO, ROLES_EDITABLES, PuedeConfigurarPermisos,
    capacidades_fabrica, catalogo_capacidades, rol_de,
)

CAPACIDADES = {c.nombre for c in CATALOGO}


def _efectivo(rol: str, overrides: dict) -> dict:
    """Lo que ese rol puede HOY: fábrica con lo configurado encima."""
    caps = capacidades_fabrica(rol)
    caps.update(overrides.get(rol, {}))
    return caps


def _foto():
    """La matriz completa, tal como la pinta la pantalla."""
    guardados = {}
    lista = []
    for fila in PermisoRol.objects.select_related('actualizado_por'):
        if fila.capacidad in NUCLEO or fila.rol not in ROLES_EDITABLES:
            continue        # basura de un respaldo viejo: ni se aplica ni se enseña
        guardados.setdefault(fila.rol, {})[fila.capacidad] = fila.permitido
        lista.append({
            'rol': fila.rol, 'capacidad': fila.capacidad, 'permitido': fila.permitido,
            'por': fila.actualizado_por.get_full_name() or fila.actualizado_por.username
                   if fila.actualizado_por else '',
            'cuando': fila.actualizado_en,
        })
    return {
        'roles': [{'nombre': r, 'nivel': NIVEL_POR_ROL[r]} for r in ROLES_EDITABLES],
        'catalogo': catalogo_capacidades(),
        'fabrica': {r: capacidades_fabrica(r) for r in ROLES_EDITABLES},
        'efectivo': {r: _efectivo(r, guardados) for r in ROLES_EDITABLES},
        'overrides': lista,
    }


@api_view(['GET'])
@permission_classes([PuedeConfigurarPermisos])
def permisos(request):
    return Response(_foto())
```

En `urls.py`, después de `path('latido/', views.latido_panel),`:

```python
    path('permisos/', views_permisos.permisos),
```

y arriba, `from . import views, views_permisos, views_usuarios`.

- [ ] **Paso 4: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_api -v 2`
Esperado: PASS (4).

- [ ] **Paso 5: commit**

```bash
git add backend/apps/maquinaria/views_permisos.py backend/apps/maquinaria/urls.py backend/apps/maquinaria/permissions.py backend/apps/maquinaria/tests_permisos_api.py
git commit -m "GET /api/permisos/: la matriz completa en una llamada"
```

---

### Tarea 7: `POST /api/permisos/` — guardar el lote

**Archivos:**
- Modificar: `backend/apps/maquinaria/views_permisos.py`
- Modificar: `backend/apps/maquinaria/tests_permisos_api.py`

- [ ] **Paso 1: pruebas que fallan**

```python
class GuardarPermisosTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        definir_codigo(self.duena, '135790')
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def _post(self, cambios, codigo='135790'):
        return self.api.post('/api/permisos/',
                             {'cambios': cambios, 'codigo': codigo}, format='json')

    def test_guarda_el_lote_completo(self):
        r = self._post([
            {'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': True},
            {'rol': 'Técnico', 'capacidad': 'vender', 'permitido': True},
        ])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PermisoRol.objects.count(), 2)
        self.assertTrue(r.data['efectivo']['Cajero']['cotizar'])

    def test_volver_al_valor_de_fabrica_borra_la_fila(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        r = self._post([{'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': False}])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(PermisoRol.objects.count(), 0)     # fábrica del Cajero: False

    def test_escribe_la_bitacora_con_anterior_y_nuevo(self):
        self._post([{'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': True}])
        fila = CambioPermisoRol.objects.get()
        self.assertEqual((fila.rol, fila.capacidad), ('Cajero', 'cotizar'))
        self.assertFalse(fila.anterior)
        self.assertTrue(fila.nuevo)
        self.assertEqual(fila.usuario, self.duena)
        self.assertEqual(fila.rol_usuario, 'Dueño')

    def test_el_nucleo_se_rechaza_y_no_guarda_nada_del_lote(self):
        r = self._post([
            {'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': True},
            {'rol': 'Cajero', 'capacidad': 'gestionar_usuarios', 'permitido': True},
        ])
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.data['codigo_error'], 'nucleo_bloqueado')
        self.assertEqual(PermisoRol.objects.count(), 0)     # ni el primero

    def test_capacidad_o_rol_inventados(self):
        self.assertEqual(self._post([{'rol': 'Cajero', 'capacidad': 'volar', 'permitido': True}]).status_code, 400)
        self.assertEqual(self._post([{'rol': 'Pirata', 'capacidad': 'cotizar', 'permitido': True}]).status_code, 400)
        self.assertEqual(PermisoRol.objects.count(), 0)

    def test_codigo_invalido_no_cambia_nada(self):
        r = self._post([{'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': True}], codigo='000000')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(PermisoRol.objects.count(), 0)
        self.assertEqual(CambioPermisoRol.objects.count(), 0)

    def test_sin_cambios_no_escribe_bitacora(self):
        r = self._post([])
        self.assertEqual(r.status_code, 200)
        self.assertEqual(CambioPermisoRol.objects.count(), 0)

    def test_un_gestor_no_guarda_aunque_sepa_un_codigo_bueno(self):
        """El candado es la capacidad, no el código: sin `configurar_permisos`
        no entra ni con el NIP del dueño en la mano."""
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        r = api.post('/api/permisos/', {'codigo': '135790', 'cambios': [
            {'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': True}]}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(PermisoRol.objects.count(), 0)
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_api.GuardarPermisosTest -v 2`
Esperado: FAIL con 405 (la vista solo acepta GET).

- [ ] **Paso 3: implementar**

En `views_permisos.py`, cambiar el decorador a `@api_view(['GET', 'POST'])` y
agregar el guardado:

```python
@api_view(['GET', 'POST'])
@permission_classes([PuedeConfigurarPermisos])
def permisos(request):
    if request.method == 'GET':
        return Response(_foto())

    cambios = request.data.get('cambios') or []
    if not isinstance(cambios, list):
        return Response({'detalle': 'Formato inválido.', 'codigo_error': 'formato'}, status=400)

    # Se valida TODO el lote antes de tocar la base: la barra prometió "3
    # cambios", así que o entran los tres o no entra ninguno.
    for c in cambios:
        rol, cap = c.get('rol'), c.get('capacidad')
        if rol not in ROLES_EDITABLES:
            return Response({'detalle': f'El rol «{rol}» no se configura aquí.',
                             'codigo_error': 'rol_invalido'}, status=400)
        if cap not in CAPACIDADES:
            return Response({'detalle': f'La capacidad «{cap}» no existe.',
                             'codigo_error': 'capacidad_invalida'}, status=400)
        if cap in NUCLEO:
            return Response({'detalle': 'Esa capacidad no se reparte desde esta pantalla.',
                             'codigo_error': 'nucleo_bloqueado'}, status=400)
        if not isinstance(c.get('permitido'), bool):
            return Response({'detalle': 'Cada cambio necesita permitido: true o false.',
                             'codigo_error': 'formato'}, status=400)

    from .seguridad import verificar_codigo
    ok, detalle, status, codigo_error = verificar_codigo(request.user, request.data.get('codigo') or '')
    if not ok:
        return Response({'detalle': detalle, 'codigo_error': codigo_error}, status=status)

    quien = rol_de(request.user)
    with transaction.atomic():
        for c in cambios:
            rol, cap, permitido = c['rol'], c['capacidad'], c['permitido']
            fabrica = capacidades_fabrica(rol)[cap]
            fila = PermisoRol.objects.filter(rol=rol, capacidad=cap).first()
            anterior = fila.permitido if fila else fabrica
            if anterior == permitido:
                continue                     # no cambió nada: ni bitácora ni sello
            if permitido == fabrica:
                # Volvió a su valor original: el override deja de existir. Así la
                # tabla solo guarda decisiones vivas y el punto dorado de la
                # pantalla es "¿existe la fila?".
                if fila:
                    fila.delete()
            else:
                PermisoRol.objects.update_or_create(
                    rol=rol, capacidad=cap,
                    defaults={'permitido': permitido, 'actualizado_por': request.user})
            CambioPermisoRol.objects.create(
                rol=rol, capacidad=cap, anterior=anterior, nuevo=permitido,
                usuario=request.user, rol_usuario=quien)
    return Response(_foto())
```

El sello del latido no se toca a mano: las señales de la Tarea 5 lo mueven con
cada `create`/`delete` de `PermisoRol`.

- [ ] **Paso 4: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_api -v 2`
Esperado: PASS (12).

- [ ] **Paso 5: commit**

```bash
git add backend/apps/maquinaria/views_permisos.py backend/apps/maquinaria/tests_permisos_api.py
git commit -m "POST /api/permisos/: el lote entero, firmado con el código"
```

---

### Tarea 8: `GET /api/permisos/bitacora/`

**Archivos:**
- Modificar: `backend/apps/maquinaria/views_permisos.py`, `urls.py`, `tests_permisos_api.py`

- [ ] **Paso 1: prueba que falla**

```python
class BitacoraTest(TestCase):

    def setUp(self):
        self.duena = _usuario('duena', sup=True)
        definir_codigo(self.duena, '135790')
        self.api = APIClient()
        self.api.force_authenticate(self.duena)

    def test_lista_los_cambios_del_mas_nuevo_al_mas_viejo(self):
        self.api.post('/api/permisos/', {'codigo': '135790', 'cambios': [
            {'rol': 'Cajero', 'capacidad': 'cotizar', 'permitido': True}]}, format='json')
        self.api.post('/api/permisos/', {'codigo': '135790', 'cambios': [
            {'rol': 'Técnico', 'capacidad': 'vender', 'permitido': True}]}, format='json')

        r = self.api.get('/api/permisos/bitacora/')

        self.assertEqual(r.status_code, 200)
        self.assertEqual([f['capacidad'] for f in r.data['cambios']], ['vender', 'cotizar'])
        self.assertEqual(r.data['cambios'][0]['quien'], 'duena')
        self.assertEqual(r.data['cambios'][0]['etiqueta'], 'Vender')

    def test_un_gestor_no_la_lee(self):
        api = APIClient()
        api.force_authenticate(_usuario('gestor', 'Gestor'))
        self.assertEqual(api.get('/api/permisos/bitacora/').status_code, 403)
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_api.BitacoraTest -v 2`
Esperado: FAIL con 404.

- [ ] **Paso 3: implementar**

En `views_permisos.py`:

```python
ETIQUETAS = {c.nombre: c.etiqueta for c in CATALOGO}


@api_view(['GET'])
@permission_classes([PuedeConfigurarPermisos])
def bitacora(request):
    """El rastro. Se lee; no se deshace desde aquí —deshacer es volver a mover
    el interruptor, que a su vez deja su propio renglón."""
    try:
        limite = min(int(request.query_params.get('limite', 50)), 200)
    except (TypeError, ValueError):
        limite = 50
    filas = CambioPermisoRol.objects.select_related('usuario')[:limite]
    return Response({'cambios': [{
        'rol': f.rol,
        'capacidad': f.capacidad,
        'etiqueta': ETIQUETAS.get(f.capacidad, f.capacidad),
        'anterior': f.anterior,
        'nuevo': f.nuevo,
        'quien': f.usuario.username if f.usuario else '',
        'rol_quien': f.rol_usuario,
        'cuando': f.creado_en,
    } for f in filas]})
```

En `urls.py`, después de `path('permisos/', views_permisos.permisos),`:

```python
    path('permisos/bitacora/', views_permisos.bitacora),
```

- [ ] **Paso 4: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_api -v 2`
Esperado: PASS (14).

- [ ] **Paso 5: commit**

```bash
git add backend/apps/maquinaria/views_permisos.py backend/apps/maquinaria/urls.py backend/apps/maquinaria/tests_permisos_api.py
git commit -m "Bitácora de permisos: quién movió qué y cuándo"
```

---

# FASE 3 · Que la pantalla no mienta

Una capacidad que se enciende y ningún endpoint obedece es un interruptor
decorativo. Esta fase es la que convierte la matriz en algo real.

### Tarea 9: Inventario de imposición y la prueba que cierra el hueco

**Archivos:**
- Crear: `docs/superpowers/notas/2026-08-22-inventario-permisos.md`
- Crear: `backend/apps/maquinaria/tests_permisos_imponen.py`
- Modificar: `backend/apps/maquinaria/permissions.py` (constante `SOLO_PANTALLA`)

- [ ] **Paso 1: sacar el inventario real**

Correr exactamente esto y guardar la salida:

```bash
cd backend && python manage.py shell -c "
from django.urls import get_resolver
from maquinaria.permissions import ExigeCapacidad, _NivelMinimo
por_capacidad, por_nivel = {}, []
for p in get_resolver().url_patterns:
    for r in getattr(p, 'url_patterns', [p]):
        vista = getattr(r, 'callback', None)
        cls = getattr(vista, 'cls', None) or getattr(vista, 'view_class', None)
        if not cls: continue
        for perm in getattr(cls, 'permission_classes', []):
            if isinstance(perm, type) and issubclass(perm, ExigeCapacidad) and perm.capacidad:
                por_capacidad.setdefault(perm.capacidad, []).append(str(r.pattern))
            elif isinstance(perm, type) and issubclass(perm, _NivelMinimo):
                por_nivel.append((str(r.pattern), perm.__name__))
print('=== POR CAPACIDAD ===')
for cap, rutas in sorted(por_capacidad.items()): print(cap, '→', len(rutas), 'rutas')
print()
print('=== POR NIVEL (candidatas a convertir) ===')
for ruta, clase in sorted(por_nivel): print(f'{ruta:55} {clase}')
" | tee /tmp/inventario-permisos.txt
```

- [ ] **Paso 2: escribir la nota con el inventario**

Crear `docs/superpowers/notas/2026-08-22-inventario-permisos.md` con la salida
anterior y, para **cada ruta gateada por nivel**, una de estas tres marcas:

- `→ cotizar` (o la capacidad que corresponda): se convierte en la Tarea 10/11.
- `nivel legítimo`: protege el acceso a una sección completa sin una capacidad
  concreta detrás. Se queda como está, con una línea de por qué.
- `solo pantalla`: la capacidad no gatea endpoints, solo decide qué se ve en el
  panel (es el caso de `jornada_campo` y `ver_jornada`, que son escritorios).

- [ ] **Paso 3: escribir la prueba que cierra el hueco a futuro**

```python
"""Toda capacidad que la pantalla enciende tiene que mandar en algún endpoint.

Sin esto, agregar una capacidad al catálogo y olvidarse de imponerla produce lo
peor: un interruptor que el dueño mueve creyendo que hizo algo.
"""
from django.test import TestCase
from django.urls import get_resolver

from maquinaria.permissions import (
    CATALOGO, NUCLEO, SOLO_PANTALLA, ExigeCapacidad,
)


def _capacidades_impuestas() -> set:
    """Las capacidades que alguna ruta exige de verdad."""
    vistas = set()
    for padre in get_resolver().url_patterns:
        for ruta in getattr(padre, 'url_patterns', [padre]):
            vista = getattr(ruta, 'callback', None)
            cls = getattr(vista, 'cls', None) or getattr(vista, 'view_class', None)
            for perm in getattr(cls, 'permission_classes', []) if cls else []:
                if isinstance(perm, type) and issubclass(perm, ExigeCapacidad) and perm.capacidad:
                    vistas.add(perm.capacidad)
    return vistas


class TodaCapacidadSeImponeTest(TestCase):

    def test_ninguna_capacidad_configurable_es_decorativa(self):
        configurables = {c.nombre for c in CATALOGO} - NUCLEO - SOLO_PANTALLA
        huerfanas = sorted(configurables - _capacidades_impuestas())
        self.assertEqual(huerfanas, [], (
            'Estas capacidades se pueden encender en la pantalla y ningún endpoint '
            'las exige: o se gatean, o se declaran en SOLO_PANTALLA con su razón.'))

    def test_solo_pantalla_esta_justificada(self):
        """Que nadie use SOLO_PANTALLA como basurero: solo capacidades que
        existen para decidir qué se VE, no qué se puede hacer."""
        self.assertEqual(SOLO_PANTALLA, frozenset({'jornada_campo', 'ver_jornada'}))
```

- [ ] **Paso 4: declarar `SOLO_PANTALLA` en `permissions.py`**

```python
#: Capacidades que NO gatean endpoints porque no describen una acción, sino un
#: escritorio: qué pantalla ve alguien al entrar. Lo que se hace DESDE esos
#: escritorios (entregar, recoger, subir fotos) sí se impone por su capacidad.
#: Cualquier agregado aquí necesita su renglón de por qué; ver
#: docs/superpowers/notas/2026-08-22-inventario-permisos.md
SOLO_PANTALLA = frozenset({'jornada_campo', 'ver_jornada'})
```

- [ ] **Paso 5: correr la prueba y anotar el resultado**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_imponen -v 2`
Esperado: **FALLA**, y la lista de huérfanas que imprime es el trabajo exacto de
las Tareas 10 y 11. Cópiala a la nota del inventario. No la hagas pasar
metiendo capacidades en `SOLO_PANTALLA`.

- [ ] **Paso 6: commit**

```bash
git add docs/superpowers/notas/2026-08-22-inventario-permisos.md backend/apps/maquinaria/tests_permisos_imponen.py backend/apps/maquinaria/permissions.py
git commit -m "Inventario de imposición y la prueba que delata interruptores decorativos"
```

---

### Tarea 10: Convertir el primer gate de punta a punta (`cotizar`)

Se hace una capacidad COMPLETA primero para fijar el patrón, con su prueba de
que la pantalla dice la verdad.

**Archivos:**
- Modificar: `backend/apps/cotizaciones/views.py` (las 7 rutas por nivel del inventario)
- Modificar: `backend/apps/maquinaria/tests_permisos_imponen.py`

- [ ] **Paso 1: prueba que falla**

```python
from django.contrib.auth.models import Group, User
from rest_framework.test import APIClient

from maquinaria.models import PermisoRol


class LaPantallaNoMienteTest(TestCase):
    """Encender `cotizar` para el Cajero tiene que dejarlo cotizar DE VERDAD."""

    def setUp(self):
        self.cajero = User.objects.create_user('cajero', 'c@x.com', 'pass12345')
        self.cajero.groups.add(Group.objects.get_or_create(name='Cajero')[0])
        self.api = APIClient()
        self.api.force_authenticate(self.cajero)

    def _crear(self):
        return self.api.post('/api/cotizaciones/', {
            'tipo': 'venta', 'cliente_nombre': 'Karla Santana',
            'cliente_telefono': '7441772370',
        }, format='json')

    def test_sin_el_override_no_puede(self):
        self.assertEqual(self._crear().status_code, 403)

    def test_con_el_override_cotiza(self):
        PermisoRol.objects.create(rol='Cajero', capacidad='cotizar', permitido=True)
        self.assertEqual(self._crear().status_code, 201)

    def test_y_apagarselo_al_administrador_lo_detiene(self):
        admin = User.objects.create_user('admin', 'a@x.com', 'pass12345')
        admin.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        PermisoRol.objects.create(rol='Administrador', capacidad='cotizar', permitido=False)
        api = APIClient(); api.force_authenticate(admin)
        r = api.post('/api/cotizaciones/', {
            'tipo': 'venta', 'cliente_nombre': 'X', 'cliente_telefono': '7441772370',
        }, format='json')
        self.assertEqual(r.status_code, 403)
```

- [ ] **Paso 2: correr y ver el fallo**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_imponen.LaPantallaNoMienteTest -v 2`
Esperado: FAIL en `test_con_el_override_cotiza` — responde 403 aunque el
override esté encendido, porque la vista exige nivel. **Ese fallo es el bug
completo que esta fase existe para arreglar.**

- [ ] **Paso 3: convertir los gates de cotizaciones**

En `backend/apps/cotizaciones/views.py`, cambiar `IsAdminGroupOrStaff` por
`PuedeCotizar` en las rutas que el inventario marcó `→ cotizar`:

```python
from maquinaria.permissions import PuedeCotizar     # ya existe, exige 'cotizar'

@api_view(['POST'])
@permission_classes([PuedeCotizar])
def crear_cotizacion(request):
    ...
```

Regla al convertir, para no abrir un hueco por descuido: si la vista **lee**
información de dinero del negocio además de cotizar (por ejemplo un listado con
totales agregados), conserva también la exigencia de `ver_dinero` con
`permission_classes([PuedeCotizar, PuedeVerDinero])` — DRF exige TODAS las
clases de la lista.

- [ ] **Paso 4: correr las pruebas**

Correr: `cd backend && python manage.py test maquinaria.tests_permisos_imponen cotizaciones -v 2`
Esperado: PASS, incluidas las 47 pruebas de cotizaciones que ya existían.

- [ ] **Paso 5: commit**

```bash
git add backend/apps/cotizaciones/views.py backend/apps/maquinaria/tests_permisos_imponen.py
git commit -m "Cotizar se exige por capacidad: si la pantalla lo enciende, la API obedece"
```

---

### Tarea 11: Convertir el resto de los gates, capacidad por capacidad

Se repite el ciclo de la Tarea 10 por cada capacidad de la lista de huérfanas
que imprimió la Tarea 9. **Una capacidad = un commit**, para que un problema se
revierta sin arrastrar a las demás.

Orden sugerido, de menos a más superficie tocada:

- [ ] `usar_caja` y `corte_caja` → `backend/apps/refacciones/views.py`, `ventas/views.py`
- [ ] `ver_clientes` y `editar_clientes` → `backend/apps/clientes/views.py`
- [ ] `facturar` → `backend/apps/facturacion/views.py`
- [ ] `reparar` y `gestionar_reparaciones` → `backend/apps/inventario/views.py`
- [ ] `alta_inventario`, `operar_inventario`, `editar_catalogo` → `backend/apps/inventario/views.py`, `maquinaria/views.py`
- [ ] `vender` → `backend/apps/ventas/views.py`
- [ ] `rentar` → `backend/apps/renta/views.py`

Para **cada** capacidad de la lista, en su propio ciclo:

- [ ] **Paso 1:** agregar a `tests_permisos_imponen.py` una prueba con la misma
  forma que `LaPantallaNoMienteTest`, cambiando el endpoint y la capacidad. Por
  ejemplo, para `usar_caja`:

```python
class CajaSeImponeTest(TestCase):

    def setUp(self):
        self.tecnico = User.objects.create_user('tec', 't@x.com', 'pass12345')
        self.tecnico.groups.add(Group.objects.get_or_create(name='Técnico')[0])
        self.api = APIClient()
        self.api.force_authenticate(self.tecnico)

    def test_sin_el_override_no_cobra_en_mostrador(self):
        r = self.api.post('/api/ventas/mostrador/', {'items': []}, format='json')
        self.assertEqual(r.status_code, 403)

    def test_con_el_override_si(self):
        PermisoRol.objects.create(rol='Técnico', capacidad='usar_caja', permitido=True)
        r = self.api.post('/api/ventas/mostrador/', {'items': []}, format='json')
        self.assertNotEqual(r.status_code, 403)   # 400 por carrito vacío está bien
```

- [ ] **Paso 2:** correrla y verla fallar con 403 pese al override.
- [ ] **Paso 3:** cambiar la clase de permiso de esas rutas por la de capacidad
  (crear la subclase de `ExigeCapacidad` en `permissions.py` si esa capacidad
  todavía no tiene una, siguiendo el modelo de `PuedeCotizar`).
- [ ] **Paso 4:** correr `python manage.py test` COMPLETO, no solo la app tocada.
  Convertir un gate puede romper pruebas viejas que asumían el nivel.
- [ ] **Paso 5:** commit con el nombre de la capacidad.

- [ ] **Cierre de la fase:** `cd backend && python manage.py test maquinaria.tests_permisos_imponen -v 2`
  Esperado: PASS, incluida `test_ninguna_capacidad_configurable_es_decorativa`.

---

# FASE 4 · La pantalla

La referencia visual es `.superpowers/brainstorm/98327-1787444272/content/matriz-a2.html`
y las reglas de estilo son las de `.interface-design/system.md`. No se inventan
tokens: `bg-surface`, `border-edge`, `text-ink`, `text-mute`, `text-gold`.

### Tarea 12: Tipos, tema del latido y la sección enchufada al panel

Entrega verificable: la sección aparece en el menú solo para el dueño, abre
vacía y ya trae los datos de la API en la consola.

**Archivos:**
- Modificar: `frontend/src/lib/acceso.ts:15-52`, `frontend/src/lib/realtime.ts:22-25`
- Modificar: `frontend/src/routes/dashboard/comun.tsx:208-230`
- Modificar: `frontend/src/routes/Dashboard.tsx` (5 puntos)
- Crear: `frontend/src/routes/dashboard/permisos.tsx`

- [ ] **Paso 1: tipo de la capacidad nueva**

En `acceso.ts`, dentro de `type Capacidades`:

```ts
  /** La pantalla de permisos. Del núcleo: solo el dueño, y no se puede regalar. */
  configurar_permisos: boolean
```

- [ ] **Paso 2: tema del latido**

En `realtime.ts:22-25`, agregar `'permisos'` a la unión `Tema`:

```ts
export type Tema =
  | 'equipos' | 'unidades' | 'catalogos' | 'cupones' | 'rentas' | 'ventas'
  | 'cotizaciones' | 'refacciones' | 'reparaciones' | 'facturacion'
  | 'empresas' | 'clientes' | 'notificaciones' | 'metricas' | 'config' | 'usuarios'
  | 'permisos'
```

- [ ] **Paso 3: la sección en el catálogo de secciones**

En `comun.tsx:208`, agregar `| 'permisos'` al tipo `Section`, y en
`SECTION_META`:

```ts
  permisos: { title: 'Permisos', subtitle: 'Qué puede hacer cada puesto. Lo que cambies aquí aplica a todos los de ese rol.' },
```

- [ ] **Paso 4: los cinco puntos de `Dashboard.tsx`**

1. Import perezoso, junto a los otros (~línea 51):
```ts
const PermisosAdmin = lazy(() => import('./dashboard/permisos'))
```
2. Temas que dejan vieja la sección (~línea 195, en el mapa de recursos):
```ts
  permisos: ['permisos'],
```
3. Capacidad que la abre (~línea 560, en `REQUIERE`):
```ts
    permisos: 'configurar_permisos',
```
4. Renglón del menú, en el grupo `navgroup.cuenta` junto a Usuarios (~línea 632):
```tsx
        { key: 'permisos', label: 'Permisos', icon: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></> },
```
5. Render de la sección (~línea 1109, junto al de `usuarios`):
```tsx
          {section === 'permisos' && <PermisosAdmin notify={notify} />}
```

- [ ] **Paso 5: el perfil se recarga cuando los permisos cambian**

En `Dashboard.tsx:432-437`, sacar la carga del perfil a un callback y
suscribirla al tema. Es lo que hace que un cambio se sienta al momento:

```tsx
  const cargarPerfil = useCallback(() => {
    api.get('/auth/perfil/').then(r => {
      setMe(r.data)
      recordarAcceso(r.data)   // acento y sección para la próxima carga
    }).catch(() => {})
  }, [])

  useEffect(() => { cargarPerfil() }, [cargarPerfil])
  // Si el dueño mueve permisos desde otra computadora, este panel se entera por
  // el latido y vuelve a preguntar qué puede: menús y botones se ajustan solos.
  useRecurso(['permisos'], cargarPerfil, true)
```

- [ ] **Paso 6: el archivo de la pantalla, con los datos ya cargados**

```tsx
/**
 * Permisos por rol: la matriz de capacidades × puestos.
 *
 * Lo que se enciende aquí lo obedece el backend (`ExigeCapacidad`); esta
 * pantalla no es la defensa, es la que decide. Ver
 * docs/superpowers/specs/2026-08-22-permisos-configurables-design.md
 */
import { useCallback, useEffect, useState } from 'react'
import api from '../../lib/api'
import { type Notify } from '../../store/toast'
import { errorMsg } from './comun'
import { pedir } from '../../components/Dialogo'

export type Capacidad = {
  nombre: string; etiqueta: string; descripcion: string
  area: string; nucleo: boolean; nivel_minimo: number | null
}
export type Foto = {
  roles: { nombre: string; nivel: number }[]
  catalogo: Capacidad[]
  fabrica: Record<string, Record<string, boolean>>
  efectivo: Record<string, Record<string, boolean>>
  overrides: { rol: string; capacidad: string; permitido: boolean; por: string; cuando: string }[]
}

export default function PermisosAdmin({ notify }: { notify: Notify }) {
  const [foto, setFoto] = useState<Foto | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    api.get<Foto>('/permisos/')
      .then(r => { setFoto(r.data); setError('') })
      .catch(e => setError(errorMsg(e)))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  if (error) return <p className="text-sm text-mute">{error}</p>
  if (!foto) return <div className="h-64 rounded-xl bg-surface-2 animate-pulse" />
  return <pre className="text-[11px] text-mute">{JSON.stringify(foto.roles, null, 2)}</pre>
}
```

- [ ] **Paso 7: verificar**

```bash
cd frontend && npm run build && npm run lint
```
Esperado: build sin errores de tipos, lint limpio. En el navegador, entrando
como dueño, aparece "Permisos" en el menú y la sección lista los cuatro roles.
Entrando como administrador, la sección **no** aparece.

- [ ] **Paso 8: commit**

```bash
git add frontend/src/lib/acceso.ts frontend/src/lib/realtime.ts frontend/src/routes/dashboard/comun.tsx frontend/src/routes/Dashboard.tsx frontend/src/routes/dashboard/permisos.tsx
git commit -m "La sección Permisos entra al panel, y el perfil se recarga con el latido"
```

---

### Tarea 13: La matriz

**Archivos:**
- Modificar: `frontend/src/routes/dashboard/permisos.tsx`

- [ ] **Paso 1: el estado de los cambios pendientes**

Reemplazar el cuerpo del componente por esto, que es el corazón de la pantalla:

```tsx
/** Clave de una celda: rol + capacidad. */
const clave = (rol: string, cap: string) => `${rol}·${cap}`

export default function PermisosAdmin({ notify }: { notify: Notify }) {
  const [foto, setFoto] = useState<Foto | null>(null)
  const [error, setError] = useState('')
  /** Lo que el dueño movió y todavía no guarda. Valor = destino del interruptor. */
  const [pendientes, setPendientes] = useState<Record<string, boolean>>({})
  const [filtro, setFiltro] = useState<'todas' | 'cambiadas' | 'encendidas'>('todas')
  /** Fila y columna bajo el cursor: la cruz de lectura. */
  const [cruz, setCruz] = useState<{ cap: string; rol: string } | null>(null)

  // `cargar()`, `error` y el esqueleto de carga se quedan como estaban.

  /** Estado que se ve en pantalla: lo guardado, con lo pendiente encima. */
  const valor = (rol: string, cap: string) => {
    const p = pendientes[clave(rol, cap)]
    return p !== undefined ? p : Boolean(foto?.efectivo[rol]?.[cap])
  }
  /** ¿Difiere de fábrica? Es el punto dorado, y también lo que el filtro busca. */
  const movida = (rol: string, cap: string) =>
    valor(rol, cap) !== Boolean(foto?.fabrica[rol]?.[cap])

  const alternar = (rol: string, cap: string) => {
    const destino = !valor(rol, cap)
    setPendientes(prev => {
      const sig = { ...prev }
      // Si vuelve a lo guardado, deja de ser un cambio pendiente.
      if (destino === Boolean(foto?.efectivo[rol]?.[cap])) delete sig[clave(rol, cap)]
      else sig[clave(rol, cap)] = destino
      return sig
    })
  }
}
```

- [ ] **Paso 2: la celda**

```tsx
function Celda({ encendido, movida, bloqueada, etiqueta, resaltada, onToggle }: {
  encendido: boolean; movida: boolean; bloqueada: boolean
  etiqueta: string; resaltada: boolean; onToggle: () => void
}) {
  if (bloqueada) return (
    <span className="grid place-items-center h-11" title="Esta capacidad no se reparte desde aquí">
      <span className="w-[30px] h-[17px] rounded-full border border-dashed border-edge grid place-items-center">
        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-mute" fill="none" stroke="currentColor" strokeWidth="2.5">
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      </span>
    </span>
  )
  return (
    <button
      type="button" role="switch" aria-checked={encendido} aria-label={etiqueta}
      onClick={onToggle}
      className={`relative grid place-items-center h-11 w-full transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 rounded-lg
        ${resaltada ? 'bg-gold/5' : ''}`}
    >
      <span className={`w-[30px] h-[17px] rounded-full relative transition-colors
        ${encendido ? 'bg-gold' : 'bg-white/[.13]'}`}>
        <span className={`absolute top-[2.5px] w-3 h-3 rounded-full transition-all
          ${encendido ? 'right-[2.5px] bg-gold-on' : 'left-[2.5px] bg-mute'}`} />
      </span>
      {movida && <span className="absolute top-2 right-3 w-[5px] h-[5px] rounded-full bg-gold" title="Lo cambiaste tú" />}
    </button>
  )
}
```

El `<button role="switch">` no es capricho: un `<div onClick>` pierde foco,
teclado y semántica, y son 84 controles (21 capacidades configurables × 4
roles). El alto de 44 px da el área de toque
aunque el dibujo mida 30×17.

- [ ] **Paso 3: la tabla, agrupada por área**

```tsx
  const areas = [...new Set(foto.catalogo.map(c => c.area))]
  const visibles = (caps: Capacidad[]) => caps.filter(c =>
    filtro === 'todas' ? true
    : filtro === 'cambiadas' ? foto.roles.some(r => movida(r.nombre, c.nombre))
    : foto.roles.some(r => valor(r.nombre, c.nombre)))
```

Estructura, con el ancho de la columna de capacidades fijo y las de rol de 64 px
(la tabla scrollea de lado en celular con `overflow-x-auto` en el contenedor y
`sticky left-0` en la primera columna):

```tsx
  <div className="rounded-xl border border-edge bg-surface overflow-x-auto">
    <div className="min-w-[560px]">
      {/* cabecera con el contador por rol */}
      <div className="grid grid-cols-[1fr_repeat(4,64px)] bg-surface-2 border-b border-edge sticky top-0">
        <div className="px-3.5 py-2.5 text-[10px] font-semibold tracking-wider text-mute">CAPACIDAD</div>
        {foto.roles.map(r => (
          <div key={r.nombre} className="py-2 text-center">
            <div className="text-[11px] font-semibold text-ink">{r.nombre}</div>
            <div className="text-[10px] text-mute tabular-nums">
              {foto.catalogo.filter(c => valor(r.nombre, c.nombre)).length}/{foto.catalogo.length}
            </div>
          </div>
        ))}
      </div>
      {areas.map(area => {
        const caps = visibles(foto.catalogo.filter(c => c.area === area))
        if (!caps.length) return null
        return (
          <div key={area}>
            <div className="flex items-center gap-2.5 px-3.5 pt-3 pb-1.5 border-t border-edge">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-mute">{area}</span>
              <i className="flex-1 h-px bg-edge" />
            </div>
            {caps.map(c => (
              <div key={c.nombre}
                onMouseEnter={() => setCruz({ cap: c.nombre, rol: '' })}
                onMouseLeave={() => setCruz(null)}
                className={`grid grid-cols-[1fr_repeat(4,64px)] items-center border-t border-edge
                  ${cruz?.cap === c.nombre ? 'bg-gold/5' : ''}`}>
                <div className="px-3.5 py-2 sticky left-0 bg-surface">
                  <span className="block text-[11.5px] font-medium text-ink">{c.etiqueta}</span>
                  {cruz?.cap === c.nombre && (
                    <span className="block text-[10px] text-mute mt-0.5 leading-snug">{c.descripcion}</span>
                  )}
                </div>
                {foto.roles.map(r => (
                  <div key={r.nombre} onMouseEnter={() => setCruz({ cap: c.nombre, rol: r.nombre })}>
                    <Celda
                      encendido={valor(r.nombre, c.nombre)}
                      movida={movida(r.nombre, c.nombre)}
                      bloqueada={c.nucleo}
                      etiqueta={`${c.etiqueta} — ${r.nombre}`}
                      resaltada={cruz?.rol === r.nombre}
                      onToggle={() => alternar(r.nombre, c.nombre)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  </div>
```

La descripción solo se pinta en la fila activa: 26 filas de dos renglones
matarían la densidad, que es lo que hace útil a esta pantalla.

Cada fila lleva `onMouseEnter={() => setCruz({ cap: c.nombre, rol: '' })}` y cada
celda `onMouseEnter={() => setCruz({ cap: c.nombre, rol: r.nombre })}`; la fila
se tiñe con `bg-gold/5` cuando `cruz?.cap === c.nombre`, y la celda cuando
además `cruz?.rol === r.nombre`. La descripción (`c.descripcion`) se muestra bajo
la etiqueta **solo** en la fila activa.

- [ ] **Paso 4: verificar**

```bash
cd frontend && npm run build && npm run lint
```
Y en el navegador, como dueño: los interruptores responden, el contador de la
columna se mueve al tocar, el punto dorado aparece al diferir de fábrica, el
filtro "Solo lo que cambié" deja únicamente esas filas, y con Tab se recorre la
matriz con el anillo dorado visible.

- [ ] **Paso 5: commit**

```bash
git add frontend/src/routes/dashboard/permisos.tsx
git commit -m "La matriz de permisos: cruz de lectura, contadores y el punto de lo cambiado"
```

---

### Tarea 14: Guardar — barra, código y estados

**Archivos:**
- Modificar: `frontend/src/routes/dashboard/permisos.tsx`

- [ ] **Paso 1: la barra y el guardado**

```tsx
  const [guardando, setGuardando] = useState(false)
  const cambios = Object.entries(pendientes).map(([k, permitido]) => {
    const [rol, capacidad] = k.split('·')
    return { rol, capacidad, permitido }
  })

  /** Los cambios en palabras: "Cajero: cotizar y ver la operación". */
  const resumen = foto.roles.map(r => {
    const suyos = cambios.filter(c => c.rol === r.nombre)
      .map(c => foto.catalogo.find(x => x.nombre === c.capacidad)?.etiqueta.toLowerCase())
    return suyos.length ? `${r.nombre}: ${suyos.join(' y ')}` : ''
  }).filter(Boolean).join(' · ')

  const guardar = async () => {
    // `pedir` es el diálogo de la casa (components/Dialogo). Devuelve null si
    // el dueño se arrepiente: entonces no se toca nada.
    // Mismo diálogo y misma forma que las otras autorizaciones del panel
    // (cancelar una venta, quitar una máquina): `pedir` no tiene modo
    // contraseña, y el placeholder de bolitas es lo que usa la casa.
    const codigo = await pedir({
      titulo: 'Código de autorización',
      mensaje: `${cambios.length} ${cambios.length === 1 ? 'cambio' : 'cambios'} de permisos. Teclea tus 6 dígitos para confirmarlo.`,
      placeholder: '••••••', inputMode: 'decimal',
    })
    if (codigo === null) return          // se arrepintió: no se toca nada
    setGuardando(true)
    try {
      const r = await api.post<Foto>('/permisos/', { cambios, codigo })
      setFoto(r.data)
      setPendientes({})
      notify('Permisos actualizados', 'ok')
    } catch (e) {
      notify(errorMsg(e), 'err')      // el tipo SIEMPRE se declara: el default sale verde
    } finally {
      setGuardando(false)
    }
  }
```

Los cambios pendientes **no se pierden** si el guardado falla: `setPendientes({})`
solo corre en el camino bueno.

- [ ] **Paso 2: la barra en pantalla**

```tsx
  {cambios.length > 0 && (
    <div className="sticky bottom-4 mt-3 flex items-center justify-between gap-3 rounded-xl
                    border border-gold/30 bg-surface px-3 py-2.5 shadow-[0_1px_3px_rgba(33,29,22,0.04)]">
      <p className="text-[12px] text-ink font-medium">
        <span className="text-gold tabular-nums">{cambios.length}</span>{' '}
        {cambios.length === 1 ? 'cambio sin guardar' : 'cambios sin guardar'}
        <span className="block text-[10px] text-mute font-normal mt-0.5">{resumen}</span>
      </p>
      <div className="flex items-center gap-2">
        <button onClick={() => setPendientes({})} disabled={guardando}
          className="text-[11px] font-semibold text-mute border border-edge rounded-lg px-3.5 py-2">
          Descartar
        </button>
        <button onClick={guardar} disabled={guardando}
          className="text-[11px] font-semibold bg-gold text-gold-on rounded-lg px-3.5 py-2 disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar con mi código'}
        </button>
      </div>
    </div>
  )}
```

- [ ] **Paso 3: verificar a mano los cinco caminos**

Como dueño, en el navegador:
1. Mover un interruptor → aparece la barra con el resumen en palabras.
2. Guardar con el código bueno → alerta verde, el punto dorado queda, la barra
   se va.
3. Guardar con un código malo → alerta roja y **los cambios siguen ahí**.
4. Cancelar el diálogo del código → no pasa nada.
5. Con el panel abierto en dos navegadores (dueño en uno, cajero en otro):
   apagarle `usar_caja` al Cajero y ver que en el otro desaparece la sección
   Caja en un par de segundos, sin recargar.

```bash
cd frontend && npm run build && npm run lint
```

- [ ] **Paso 4: commit**

```bash
git add frontend/src/routes/dashboard/permisos.tsx
git commit -m "Guardar permisos: el lote firmado con el código, y nada se pierde si falla"
```

---

## Cierre

- [ ] `cd backend && python manage.py test` → OK completo
- [ ] `cd frontend && npm run build && npm run lint` → limpio
- [ ] Borrar de `MEMORY.md` la nota de pendiente
  `remali-permisos-configurables.md`, o reescribirla con lo que quedó
- [ ] Actualizar `docs/01-DOCUMENTACION.md` con la sección Permisos
