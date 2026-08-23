# Permisos configurables por rol

**Fecha:** 2026-08-22
**Estado:** diseño aprobado

## Por qué

`permissions.py` ya trae el catálogo de las 23 capacidades con su etiqueta y su
explicación, y `AJUSTES_POR_PUESTO` lleva meses con un comentario que promete
algo que no existe:

> Son VALORES POR DEFECTO, no la ley del sistema: cuando exista la pantalla de
> permisos configurables, leerá lo que el admin haya guardado y caerá aquí solo
> si no hay nada configurado.

Hoy no hay dónde guardar nada, así que el "default" es la ley. Cada vez que el
negocio necesita que alguien haga una cosa que su puesto no contempla —el de
mostrador que también cotiza, el técnico que además recibe en taller— la única
salida es subirle el rol entero, que le da todo lo demás. Repartir de más es
exactamente lo que el diseño del Gestor existe para evitar
(`2026-08-19-rol-gestor-design.md`).

Esto construye esa pantalla y el lugar donde se guarda lo que decida el dueño.

## Dos cosas que se encontraron al diseñar

**1. El backend impone por nivel más que por capacidad.** Hay 58 puntos
gateados por capacidad (`ExigeCapacidad`, `PuedeCotizar`, `PuedeUsarCaja`,
`puede_de(...)`) y **102 gateados por nivel** (`IsAdminGroupOrStaff`,
`EsOperador`, `EsDueno`), repartidos sobre todo en `renta` (24), `maquinaria`
(26), `ventas` (14) e `inventario` (13). Una matriz que encienda `cotizar` para
el Cajero mientras el endpoint de cotizaciones exige nivel administración es un
interruptor decorativo: la pantalla promete algo que la API no cumple. El
trabajo de convertir esos gates es parte de esta entrega, no un pendiente.

**2. `tener_codigo_propio` no es una capacidad más.** Quien tiene NIP autoriza
sus propias excepciones —ajustar el precio al vender, entre otras—, que es
justo la vía discreta de sacar dinero que ya se documentó en
`CambioPrecioLista`. Poder regalar esa capacidad desde una pantalla vacía el
mecanismo entero. Va al núcleo intocable.

## Decisiones tomadas

1. **Los permisos se guardan por ROL, no por persona.** Enciendes algo para
   "Cajero" y aplica a todos los cajeros. Coincide con `AJUSTES_POR_PUESTO` y
   deja una regla que se explica sola: cambiar el puesto cambia lo que puede.
   Las excepciones por persona quedan fuera (ver *Lo que no entra*).
2. **Se puede encender y apagar, salvo un núcleo intocable.** Un rol puede
   recibir capacidades de nivel superior (el Cajero cotiza) y perder las suyas.
   El núcleo no se reparte desde ninguna pantalla.
3. **Guardar exige el código de 6 dígitos y deja bitácora.** El mismo NIP que ya
   autoriza ajustar precios. Cubre el caso de la sesión abierta sin el dueño
   enfrente, que es donde alguien se autoconcede algo.
4. **El cambio surte efecto al momento, por el latido.** Sin cerrarle la sesión
   a nadie ni perderle lo que estaba capturando.
5. **Los overrides viven en su propia tabla**, con una bitácora append-only
   gemela de `CambioPrecioLista`.
6. **La pantalla es una matriz**: las 24 capacidades —las 23 de hoy más
   `configurar_permisos`— por los 4 roles editables, todo a la vista. De ellas,
   19 son configurables y 5 salen con candado.

## Cómo se resuelve un permiso

Tres capas, en orden, y la última manda:

```
nivel (jerarquía)  →  ajuste por puesto (fábrica)  →  override guardado (el dueño)
```

- **El nivel no se va.** Sigue decidiendo quién entra al panel y sigue siendo el
  punto de partida de `puede_de()`. `AJUSTES_POR_PUESTO` pasa a ser lo que su
  comentario ya decía: valores de fábrica.
- **Solo se guarda lo que difiere de fábrica.** Si el dueño enciende algo y
  luego lo regresa a su valor original, la fila se borra. Así "¿qué toqué yo?"
  es una consulta y no un diff, y el punto dorado de la pantalla es literalmente
  *¿existe la fila?*.
- **Fail-closed.** Si la tabla de overrides falla o todavía no está migrada,
  `puede_de()` cae a fábrica y sigue trabajando. Nunca al revés: un error no
  reparte permisos.
- **El Dueño no aparece en la pantalla.** Lo puede todo, siempre; una casilla
  suya solo sería una forma de encerrarse fuera de su propio sistema.

### El núcleo intocable

Cinco capacidades que la pantalla muestra **con candado**, nunca editables:

| Capacidad | Por qué no se reparte |
|---|---|
| `gestionar_usuarios` | Dar de alta gente y cambiar roles es la llave maestra. |
| `editar_datos_bancarios` | Cambiarlos desvía a otra cuenta los pagos de los clientes. |
| `borrar_catalogo` | Borrar es como se encubre una máquina que falta. |
| `tener_codigo_propio` | Quien tiene NIP se autoriza a sí mismo (ver arriba). |
| `configurar_permisos` | **Nueva.** Sin ella, quien abra la pantalla se concede el resto. Solo el Dueño. |

**Intocable no es apagado.** `tener_codigo_propio` está encendido para
Administrador y apagado para Gestor; con candado, se queda tal cual. El candado
dice "esto no se reparte desde aquí", no "esto no lo tiene nadie". La celda
bloqueada muestra su estado real, encendido o apagado, más el candado.

## Los datos

```python
class PermisoRol(models.Model):
    """Un renglón por capacidad que el dueño movió respecto de fábrica."""
    rol = models.CharField(max_length=30)        # Gestor | Administrador | Cajero | Técnico
    capacidad = models.CharField(max_length=40)  # nombre del CATALOGO
    permitido = models.BooleanField()
    actualizado_por = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('rol', 'capacidad')


class CambioPermisoRol(models.Model):
    """Quién cambió qué permiso, cuándo y de qué a qué. Append-only."""
    rol = models.CharField(max_length=30)
    capacidad = models.CharField(max_length=40)
    anterior = models.BooleanField(null=True)    # null = venía de fábrica
    nuevo = models.BooleanField(null=True)       # null = se restableció a fábrica
    usuario = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    rol_usuario = models.CharField(max_length=30, blank=True, default='')
    creado_en = models.DateTimeField(auto_now_add=True)
```

`rol` y `capacidad` van como **texto, no como llave foránea**: el catálogo vive
en el código, que es donde están la etiqueta y la explicación, y una capacidad
retirada debe dejar su rastro histórico legible en vez de romper la bitácora. La
validación contra `CATALOGO` y contra la lista de roles se hace al guardar.

## Dónde se impone de verdad

La regla que decide si la pantalla dice la verdad:

> Si la matriz deja encender la capacidad X para un rol, **todos** los endpoints
> que ejecutan X tienen que pedir X. Si alguno sigue pidiendo nivel, la pantalla
> miente.

El trabajo, ordenado por capacidad y no archivo por archivo:

1. **Inventario `capacidad → vistas que la imponen`**, recorriendo los 102
   puntos gateados por nivel. Es la primera tarea de la implementación; sin esa
   tabla lo demás se hace a ciegas.
2. **Convertir a `ExigeCapacidad`** los gates cuya acción corresponde a una
   capacidad configurable.
3. **Dejar el nivel donde sigue siendo legítimo**: entrar a una sección, "esto
   es de administración para arriba" sin una capacidad concreta detrás.
4. **Prueba que cierra el hueco a futuro**: recorre el `CATALOGO` y falla si una
   capacidad configurable no tiene ni un gate real detrás. Un interruptor sin
   nada que lo obedezca es peor que no tenerlo.

## La API

**`GET /api/permisos/`** — todo lo que la matriz necesita para pintarse sola:
catálogo con etiquetas y descripciones, roles editables, valores de fábrica,
overrides guardados, efectivo por rol y la lista del núcleo. La tabla no se
arma a mano en el frontend.

**`POST /api/permisos/`** — recibe **el lote**, no un interruptor a la vez:

```json
{ "cambios": [{"rol": "Cajero", "capacidad": "cotizar", "permitido": true}],
  "codigo": "123456" }
```

Se aplica en una transacción o no se aplica ninguno —la barra prometió "3
cambios"—. Valida el código; rechaza con 400 cualquier intento sobre el núcleo o
sobre un rol o capacidad que no existan (el candado del frontend es comodidad,
no defensa); escribe una fila de bitácora por cambio; toca el sello del latido.
Sin `configurar_permisos`, 403.

**`GET /api/permisos/bitacora/`** — el rastro, paginado.

## La pantalla

Sección nueva en el Dashboard, gateada por `configurar_permisos`, con los cinco
puntos de integración de siempre para que no se quede a medias.

Matriz: capacidades en filas, los 4 roles en columnas. Lo que la hace usable:

- **Cruz de lectura.** Al pasar o enfocar, se tiñen fila y columna al 5% del
  dorado. En una rejilla de 96 celdas el error no es escoger mal: es encender el de la
  columna de junto.
- **Contador vivo por rol** en la cabecera (`Cajero 10/24`), que se mueve
  mientras se toca. Responde de un vistazo "¿al final qué le dejé?".
- **Punto dorado** en lo que difiere de fábrica, más el filtro *Solo lo que
  cambié*. Distingue las decisiones del dueño de lo que vino puesto.
- **Bloques por área del negocio** —Dinero y cuentas · Mostrador · Campo y
  taller · Llaves del negocio— y no por nivel técnico. Descanso para el ojo sin
  sacar nada de la pantalla.
- **La descripción aparece en la fila activa**, no en las 24 a la vez: se
  conserva la densidad y la explicación llega cuando hace falta.
- **Nada se guarda solo.** La barra aparece cuando hay cambios, los nombra en
  palabras ("Cajero: cotizar y ver la operación") y el botón dice lo que viene:
  *Guardar con mi código*.
- **El núcleo se ve con candado**, no escondido: verlo bloqueado enseña la
  regla; esconderlo la vuelve un misterio.
- **En celular** la tabla scrollea de lado con la columna de capacidades
  congelada. No se diseña una segunda pantalla.

Accesibilidad y estados, que no son opcionales: cada interruptor es un
`<button role="switch" aria-checked>` con nombre accesible completo ("Cotizar —
Cajero"), área de toque de 44 px aunque el dibujo mida 30×17, y anillo de foco
dorado. Estados de la pantalla: cargando (esqueleto de filas), sin cambios
(barra oculta), guardando (botón ocupado), error (mensaje junto a la barra, los
cambios no se pierden).

Los tokens y el movimiento salen de `.interface-design/system.md`; no se
inventan valores nuevos.

## Latido y caché

Al guardar se toca `SelloTema(tema='permisos')`. El panel ya late contra eso: ve
el sello movido, re-pide `/auth/me/` y `ProveedorPermisos` re-pinta. Uno o dos
segundos, sin cerrar sesión.

**Sin caché en esta versión.** `puede_de()` sumaría una consulta por request a
una tabla de máximo 76 filas (19 capacidades configurables × 4 roles) con índice
único. Cachear en memoria de proceso es
justo lo que se rompe en silencio con dos workers —un empleado sigue operando
con permisos viejos y nadie se entera—. Si el costo aparece medido, se cachea
contra el sello, que ya existe.

## Pruebas

La primera va antes que todo lo demás:

1. **Congelar el comportamiento de hoy.** Sin overrides, `puede_de()` devuelve
   exactamente lo mismo que ahora para los cinco roles. Es el seguro de que esta
   obra no le quita nada a nadie en silencio.
2. Un override enciende una capacidad de nivel superior y apaga una propia.
3. Borrar el override devuelve el valor de fábrica.
4. Cualquier cambio sobre el núcleo se rechaza con 400 y no se guarda nada.
5. Un Gestor recibe 403 al intentar entrar a la pantalla y al llamar el POST.
6. Código inválido: 400, y ni un cambio aplicado (la transacción entera).
7. La bitácora escribe una fila por cambio, con `anterior` y `nuevo`.
8. El sello `permisos` se mueve al guardar.
9. **La que prueba que la pantalla no miente:** un usuario con rol Cajero y
   `cotizar` encendido crea una cotización por la API de verdad; sin el
   override, la misma llamada responde 403.

## Lo que no entra

- **Excepciones por persona.** El rol es la unidad; una excepción individual se
  olvida puesta y obliga a mirar dos capas para saber qué puede alguien.
- **Cola de aprobaciones o flujo de solicitud.** El dueño teclea su código; ya
  se decidió en el diseño del Gestor que no se le pide entrar a un sistema de
  aprobaciones.
- **Roles nuevos o renombrar roles.** Los cuatro existentes se configuran; crear
  puestos es otro proyecto.
- **Botón de revertir desde la bitácora.** El rastro se lee; deshacer es volver
  a mover el interruptor.
- **Permisos por sucursal.** No hay sucursales.
