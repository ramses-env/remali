# El taller privado del cliente: borradores y autorización interna

**Fecha:** 2026-08-18
**Estado:** diseño propuesto — pendiente de aprobación

## Problema

El cliente arma su cotización en la tienda, y muchas veces necesita el visto
bueno de su jefe antes de mandarla. Eso ya existe a medias: `Cotizacion` tiene
el estado `por_autorizar` y `token_autorizacion` para que el jefe apruebe sin
cuenta. Pero la etapa privada del cliente vive dentro del libro de cotizaciones
de REMALI, y eso rompe tres cosas:

1. **Se queman folios.** `_construir_cotizacion` crea la fila con estado
   `por_autorizar`; como no es `borrador`, `Cotizacion.save()`
   (`models.py:159`) le asigna un `COT-AAAA-NNNN` del consecutivo oficial. Si
   el jefe rechaza seis versiones, el ejercicio fiscal de REMALI queda con seis
   folios muertos.
2. **El panel ve lo que no le toca.** `CotizacionListCreate.get_queryset()`
   (`views.py:889`) devuelve todo, incluidas las `por_autorizar` que nunca
   llegaron a REMALI.
3. **Los KPIs mienten.** `cotizacion_stats` cuenta como `rechazada` tanto
   "REMALI dijo que no" como "el jefe del cliente dijo que no". Son dos hechos
   distintos en el mismo número.

Además, los borradores del cliente hoy viven en `localStorage`
(`remali_borradores`, tope de 8, `Cotizacion.tsx:261`): se pierden al cambiar de
dispositivo y no se pueden compartir. Y hay ~80 líneas de cálculo de precios
duplicadas entre `crear_cotizacion_publica` y `_construir_cotizacion`.

## Decisiones tomadas

1. **El borrador del cliente es otro objeto, no otro estado.** Nace
   `BorradorCliente`; `Cotizacion` solo existe cuando la cotización llegó a
   REMALI. La privacidad queda garantizada por el esquema, no por acordarse de
   filtrar.
2. **REMALI no ve nada de la etapa privada.** Ni el panel, ni los KPIs, ni el
   admin de Django, ni un reporte anónimo. Mientras el cliente no la mande, no
   existe.
3. **El invitado también tiene borradores**, en el servidor, con un token de
   espacio. No se le exige cuenta para guardar su trabajo.
4. **El borrador no trae precio firme.** Mientras se arma, el precio se resuelve
   contra el catálogo de hoy. Se congela en el momento en que se manda a
   autorizar, con vigencia de 15 días: el jefe autoriza un número real y REMALI
   respeta ese número.
5. **Uno y varios son el mismo camino.** Mandar a autorizar siempre crea un
   `PaqueteAutorizacion`, aunque lleve un solo borrador.
6. **El cliente decide qué puede hacer el jefe:** `opciones` (aprueba una sola)
   o `lista` (aprueba las que quiera).
7. **La liga del jefe se sigue compartiendo a mano**, por WhatsApp o correo,
   como hoy. No se construye libreta de autorizadores ni envío automático.

### Por qué tabla aparte y no una bandera de visibilidad

Una bandera `visible_remali` en `Cotizacion` es mucho menos código y la
"conversión" sería voltear un bit. Se descartó porque la privacidad quedaría
como disciplina permanente: cada queryset futuro del panel —un reporte, un
export, un buscador nuevo— tendría que acordarse de filtrar, y Django
desaconseja resolverlo filtrando el manager por defecto. El borrador además
tiene otro dueño, otro ciclo de vida y otros campos que la cotización: no es la
misma cosa en otro estado.

El costo es que las partidas se guardan en dos lugares. Se paga metiendo el
cálculo de precios en `cotizaciones/precios.py`, usado por los dos caminos —
lo que de paso mata la duplicación que ya existe hoy.

### Por qué el borrador no trae precio firme

Un borrador puede quedarse semanas esperando al jefe. Congelar el precio desde
que se guarda amarraría a REMALI a precios que ni sabía que existían. Recalcular
siempre, incluso al llegar, haría que el jefe autorice un monto que después
sube. Congelar al mandarlo parte la diferencia en el único punto donde alguien
está tomando una decisión de dinero.

## Lo que ya existe y no hay que construir

- **La liga del jefe sin cuenta** ya funciona (`autorizacion_cotizacion`,
  `AutorizarCotizacion.tsx`), incluida la variante en lote.
- **El rechazo interno ya no avisa a REMALI** (`views.py:478`): esa regla es
  correcta y se conserva tal cual.
- **La notificación personal al cliente** cuando su cotización se resuelve ya
  existe y se reusa.
- **La vinculación por token de un solo uso** (`vincular_cuenta_cotizacion`) es
  el mismo mecanismo que usará el invitado al reclamar su espacio.
- **`_resolver_partida`** ya resuelve etiqueta, precio y modalidad desde el
  `Equipo`: es el corazón de `precios.py`.

## Alcance

### Modelo de datos

**`BorradorCliente`** (app `cotizaciones`, tabla `cotizacion_borradores`)

Dueño — exactamente uno de los dos:
- `usuario` (FK a `AUTH_USER_MODEL`, nullable) para el cliente con cuenta.
- `espacio_token` (char 32, indexado, nullable) para el invitado. El espacio de
  trabajo no es una tabla: es el conjunto de borradores que comparten el token.

Contenido: `nombre` (etiqueta del cliente), `datos_contacto` y `obra` en JSON
con la misma forma que `Cotizacion.datos_solicitud`, `requiere_factura`,
`cupon` (FK, no se gasta aquí).

Estados:
- `armando` — editable, sin precio firme.
- `esperando` — congelado dentro de un paquete.
- `rechazado` — el jefe dijo que no, con motivo. No se edita: se duplica.
- `entregado` — terminal; FK `cotizacion` a la que nació de él.

Paquete y decisión: `paquete` (FK nullable), `decision` (`autorizado` /
`rechazado` / vacío), `rechazo_motivo`.

**`BorradorItem`**: `borrador`, `equipo` (FK, `SET_NULL`), `cantidad`,
`duracion`, `modalidad`, más `descripcion`, `precio_unitario` y `precio_lista`
que solo se escriben al congelar. Si el equipo se borró, la partida se muestra
como "ya no disponible" y sale del total en vez de mentir con un precio muerto.

**`PaqueteAutorizacion`** (tabla `cotizacion_paquetes`): `token` (único, la
liga), dueño (`usuario` o `espacio_token`), `modo` (`opciones` / `lista`),
`mensaje` (recado para el jefe), `congelado_en`, `vence_el`, `estado`
(`pendiente` / `resuelto` / `retirado`), `autorizada_por`, `resuelto_en`.

**Cambios a `Cotizacion`**: se va el estado `por_autorizar` y se van
`token_autorizacion`, `token_lote` y `autorizacion_rechazo` — esa historia
ahora vive en el borrador. Se quedan `autorizada_por` y `autorizada_en`: a
REMALI sí le sirve saber que llegó firmada.

**Límites**: 20 borradores por espacio o cuenta; 20 borradores por paquete.
Comando `purgar_borradores` que borra espacios de invitado sin actividad en 90
días.

### API

Del cliente sobre sus borradores:

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/borradores/` | Sus borradores y paquetes |
| `POST` | `/api/borradores/` | Crea uno (201) |
| `GET·PATCH·DELETE` | `/api/borradores/<id>/` | Lee, edita, borra |
| `POST` | `/api/borradores/<id>/duplicar/` | Nueva versión desde una rechazada |
| `POST` | `/api/borradores/<id>/enviar/` | Directo a REMALI, sin jefe |
| `POST` | `/api/autorizaciones/` | `{borradores, modo, mensaje}` → congela y devuelve la liga |
| `DELETE` | `/api/autorizaciones/<id>/` | Retira el paquete; los borradores vuelven a `armando` |
| `POST` | `/api/espacio/reclamar/` | Adopta a su cuenta los borradores del invitado |

Del jefe, público y sin cuenta:

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/autorizacion/<token>/` | Ve el paquete completo |
| `POST` | `/api/autorizacion/<token>/` | `{nombre, decisiones:[{borrador, accion, motivo}]}` |

Se retiran `tienda/cotizacion/lote/` y `autorizacion-lote/<token>/`: el paquete
de uno deja de ser un caso especial. `tienda/cotizacion/` se queda para el envío
directo, sin el parámetro `por_autorizar`.

**Identidad del invitado.** El token del espacio viaja en el encabezado
`X-Espacio`, nunca en la URL de la API. La liga `/mis-borradores/<token>` existe
solo como recuperación: al abrirla se guarda el token, se limpia la URL y se
sirve con `Referrer-Policy: no-referrer`. Un secreto en la barra de direcciones
se filtra por historial, logs y `Referer`.

**Errores.** Se unifica en `{'detalle': ..., 'codigo': ...}`; hoy `destroy`
(`views.py:997`) responde `detail` y rompe el patrón. Códigos que la interfaz
necesita distinguir: `paquete_vencido`, `borrador_congelado`,
`limite_borradores`, `equipo_no_disponible`, `ya_resuelto`.

**El doble clic del jefe.** Volver a entrar a una liga ya resuelta responde 200
con `ya_resuelto` y el desenlace, no un error: la pantalla le dice qué pasó y
cuándo. El jefe no es programador.

**Concurrencia.** El congelado toma `select_for_update` sobre los borradores del
paquete, para que una pestaña abierta editando no se cuele entre el congelado y
la generación de la liga.

**Precios en un solo lugar.** Nace `cotizaciones/precios.py` con
`resolver_partida()` y `congelar_paquete()`, usados por los borradores, por
`crear_cotizacion_publica` y por la conversión.

### Qué ve REMALI

No hay filtros que aplicar: como el borrador es otra tabla, el panel, los KPIs,
el buscador global y cualquier consulta futura ven solo lo que llegó.

- Una notificación **por paquete**, no por cotización: "Fulano autorizó 2
  cotizaciones de X · COT-2026-0041, COT-2026-0042 · $84,300". Igual el correo
  a los `CorreoAviso` verificados.
- `Cotizacion.ESTADOS` pierde `por_autorizar`; `rechazada` recupera su único
  significado.
- El folio se asigna cuando la cotización nace, o sea cuando llega.
- **`BorradorCliente` no se registra en el admin de Django ni tiene sección en
  el Dashboard.** Esto se aparta a propósito de la regla de la casa ("lo del
  admin también va al panel"), cuya razón es que el equipo no dependa del
  desarrollador. Aquí no hay función que llevar al panel: hay información del
  cliente que REMALI decidió no tener. **No es un olvido.**
- Si el invitado pierde su liga, el botón "reenviarme mi liga" se la manda a su
  propio correo. Lo dispara él; nadie de REMALI necesita ver borradores para
  resolverlo.

### Frontend

- `/cotizacion`: "Guardar como borrador" pega al servidor en vez de a
  `localStorage`.
- `/mis-cotizaciones` se parte en dos pestañas: **Mis borradores** (privado) y
  **Con REMALI** (lo entregado). No se agrega una ruta más al menú.
- En Mis borradores: duplicar, comparar totales, palomear varios y mandarlos en
  una sola liga con modo y recado.
- `/mis-borradores/:token`: recuperación del invitado.
- `/autorizar/:token`: una sola pantalla; `AutorizarLote.tsx` desaparece. Radios
  si el modo es `opciones`, casillas si es `lista`.
- **Rescate:** al primer arranque, si el navegador trae `remali_borradores`, se
  suben al servidor y se borra la llave.
- `Dashboard.tsx` no se toca.

## Pruebas

Backend (`tests_borradores.py`, patrón de `tests_caja_maquinaria.py`):
- Un borrador no aparece en `CotizacionListCreate` ni en `cotizacion_stats`.
- Crear y rechazar borradores **no consume folios**: el siguiente
  `COT-AAAA-NNNN` es consecutivo.
- El rechazo del jefe no genera notificación ni correo a REMALI.
- Autorizar crea la `Cotizacion` con folio, `origen='cliente'`, estado
  `aceptada` y `autorizada_por` sellado.
- Modo `opciones`: aprobar dos devuelve 400 y no crea nada.
- Un paquete vencido no se puede autorizar (`paquete_vencido`).
- El borrador de otro usuario/espacio da 404, nunca 403 (no se confirma que
  exista).
- El congelado escribe precios y el catálogo puede cambiar después sin moverlos.

Frontend: `npm run build` (usa `tsc -b`; el modo dev se traga errores).
Django: `manage.py check` y `makemigrations --check --dry-run`.

A mano: armar tres borradores sin cuenta, cerrar el navegador, recuperarlos con
la liga; registrarse y ver que se reclaman; mandar los tres en una liga;
rechazar uno y autorizar dos; confirmar que el panel recibe **dos** folios
consecutivos y ni rastro del tercero.

## Fuera de alcance

- Libreta de autorizadores y envío automático de la liga por correo.
- Reportes o métricas de lo no enviado, aun anónimas.
- Bloqueo optimista por versión al editar un borrador desde dos pestañas.
- Autorización por monto (umbrales, varios firmantes).
- Que REMALI pueda intervenir un borrador a petición del cliente.
