# El Gestor: administración delegada con autorización del dueño

**Fecha:** 2026-08-19
**Estado:** diseño aprobado

## Por qué

El dueño de REMALI le sabe poco a la tecnología y quiere contratar a alguien que
opere el sistema por él: atender cotizaciones, dar de alta productos e
inventario, mantener los datos del negocio. Pero es alguien contratado, y el
requisito que manda sobre todos los demás es el que dijo el dueño con sus
palabras:

> "lo importante aquí es que no pueda hacer él sus trampas para robar dinero"

Así que esto no es una lista de casillas: es un diseño **antifraude**. Cada
decisión de abajo se justifica por la vía de robo que cierra.

## Dos huecos que se encontraron al diseñar

**1. "Configurar el negocio" contiene un robo limpio.** El endpoint `/config/`
expone `datos_bancarios` —titular, banco, cuenta y CLABE— y ese texto se imprime
en cada cotización y en el PDF que recibe el cliente. Quien lo edite desvía los
pagos a su cuenta, y no se nota hasta que un cliente diga "ya te pagué".

**2. El PIN de hoy no autoriza, confirma.** `verificar_codigo` valida el PIN
*del usuario que ejecuta*. Para un operador funciona (no tiene PIN, no puede),
pero para alguien de nivel administración significa que **se autoriza a sí
mismo**. El comentario del propio código dice que el punto es "que un superior
apruebe la excepción, no quien la ejecuta", y eso hoy no se cumple en el nivel
administración. Un Gestor con PIN propio dejaría el mecanismo vacío.

## Decisiones tomadas

1. **Nombre: `Gestor`.**
2. **No es un nivel nuevo.** Va como nivel administración con ajustes por
   puesto, igual que Cajero y Técnico comparten el nivel 1 y hacen trabajos
   distintos.
3. **El código de 6 dígitos ES la autorización.** El dueño, si está de acuerdo,
   lo teclea él mismo. No se construye cola de aprobaciones ni notificaciones:
   sería pedirle a un dueño poco técnico que entre al sistema.
4. **Solo el Gestor pide el código del dueño.** El Administrador sigue
   autorizándose con su propio PIN, como hoy. Se documenta el hueco; cerrarlo
   para el Administrador queda como decisión futura.
5. **Los precios de lista se permiten, con rastro.** No se bloquean; se registra
   quién los cambió, cuándo y de cuánto a cuánto.

### Por qué nivel administración con ajustes, y no un escalón nuevo

`nivel_de` es la jerarquía que leen TODAS las clases de permiso del sistema.
Meter un escalón entre administración y dueño obliga a revisar cada una y a
reinterpretar cada `>=`. Además el Gestor no cabe en un escalón: puede **más**
que el Administrador en unas cosas (configurar el negocio) y **menos** en otras
(no ve el dinero agregado). No está arriba ni abajo — es de otra forma, y para
eso ya existe `AJUSTES_POR_PUESTO`.

Consecuencia a implementar: hoy los ajustes por puesto solo se aplican en el
nivel 1. Hay que extender `puede_de` para aplicarlos también en el nivel de
administración.

## Partir "ver el dinero"

El dueño pidió que el Gestor no tenga "información de dinero mensual o anual".
Eso choca con que sí pueda cancelar una venta: para cancelarla tiene que verla.

Hoy `ver_dinero` significa dos cosas revueltas. Se separan:

| Capacidad | Qué cubre | ¿Gestor? |
|---|---|---|
| `ver_dinero` (existente) | El Resumen, ingresos del día/mes/año, gráficas, reportes exportables | **No** |
| `ver_operacion` (nueva, nivel admin) | La lista de ventas, rentas, adeudos y pedidos, cada una con su monto | **Sí** |

Puede operar el negocio sin saber cuánto ganó el negocio.

## Capacidades nuevas

| Nombre | Nivel | Para qué |
|---|---|---|
| `ver_operacion` | administración | Ver ventas, rentas, adeudos y pedidos individuales. Sin esto no puede operar lo que le toca. |
| `borrar_catalogo` | dueño | Borrar productos, unidades y refacciones. Agregar sí, quitar no: borrar es cómo se encubre una máquina que falta. |
| `editar_datos_bancarios` | dueño | El bloque de titular/banco/cuenta/CLABE de la configuración. |

## La matriz del Gestor

**Puede:** cotizar · editar el catálogo (agregar y editar) · dar de alta
unidades · mover unidades · configurar el negocio (sin datos bancarios) ·
ver la operación (ventas, rentas, adeudos, pedidos) · facturar · usar la caja y
hacer corte · reparar y llevar el taller · ver y editar clientes · ver montos de
lo que opera · mirar la jornada del técnico.

**No puede, ni con código:** ver el Resumen ni las métricas mensuales y anuales ·
dar de alta gente o cambiar roles · borrar del catálogo · editar los datos
bancarios · definirse un PIN propio.

**Con el código de 6 dígitos del DUEÑO:** cancelar una venta · cancelar una
renta · ajustar el precio al vender · resolver el depósito en garantía ·
aceptar un anticipo menor al mínimo · registrar una devolución en caja.

## El cambio antifraude

`verificar_codigo(user, codigo)` gana una regla: **si quien ejecuta es un
Gestor, el código se valida contra el PIN de un superusuario activo, no contra
el suyo.** Al acertar, el rastro que ya se guarda ("autorizó X") registra que
autorizó el dueño, además de quién ejecutó.

Reglas de borde, todas fail-closed:

- **El Gestor no puede definir su propio PIN.** `definir_codigo_seguridad` lo
  rechaza. Si pudiera, se autoautorizaría todo y el diseño se cae.
- **Si ningún superusuario tiene PIN configurado, el Gestor no puede autorizar
  nada.** El mensaje debe decirlo con claridad: "El dueño todavía no configura
  su código de autorización", no un 403 mudo.
- **El bloqueo por intentos fallidos aplica sobre el PIN del dueño.** Un Gestor
  que adivine a lo bruto bloquea la autorización, que es el comportamiento
  correcto: es una alarma, no un estorbo.

**Nota de operación:** hoy la cuenta `admin` (el dueño) **no tiene PIN
configurado**, porque hasta ahora no había dónde ponérselo (ver "La pantalla del
NIP"). Una vez que exista esa pantalla, el dueño debe fijar el suyo **antes** de
dar de alta al primer Gestor, o no podrá autorizarle ninguna de las seis
acciones.

## La pantalla del NIP (falta por completo)

Al diseñar esto se encontró que **el panel nunca ha tenido dónde fijar el NIP**.
El endpoint existe y está bien hecho (`auth/codigo-seguridad/`: pide la
contraseña de la cuenta, valida 6 dígitos, guarda hasheado y resetea el bloqueo),
pero **el frontend no lo llama desde ningún lado**. Configuración → Seguridad
solo tiene "Cambiar contraseña". El único lugar donde hoy se puede escribir un
NIP es el formulario de alta de usuarios, es decir, poniéndoselo a otra persona.

Por eso la cuenta del dueño no tiene NIP: no es un descuido, es una pantalla que
falta. Y sin ella, todo el mecanismo de autorización de este diseño no arranca.

### El NIP es individual

Uno por persona, no uno compartido. Si hay tres administradores son tres NIPs
distintos, y el del dueño es otro más. Ya es así en el modelo
(`PerfilUsuario.codigo_seguridad`, hasheado por usuario); lo que falta es la
interfaz.

### Qué se agrega

Un bloque **"Código de autorización"** en Configuración → Seguridad, junto a
"Cambiar contraseña":

- Fija o cambia **el propio**, nunca el de alguien más.
- Pide la **contraseña de la cuenta** para confirmar identidad. El endpoint ya lo
  exige; la pantalla solo tiene que pedirla.
- Dice si ya hay uno configurado, leyendo `tiene_codigo_seguridad` de
  `/auth/me/` —que el panel ya recibe y hoy ignora—. Nunca muestra el NIP
  guardado: está hasheado y no se puede leer, solo reemplazar.
- Explica para qué sirve, porque un NIP sin explicación se configura mal o no se
  configura: es lo que autoriza cancelar una venta, ajustar un precio y resolver
  un depósito.

### Quién lo ve

Solo quien puede tener NIP: **Dueño y Administrador**.

- **El Gestor no lo ve.** No lo ocuparía: para él la autorización es el NIP del
  dueño, no el suyo. Dárselo sería darle la llave que este diseño le quita.
- Cajero y Técnico tampoco: su nivel no autoriza nada.

Cambio en el backend: `definir_codigo_seguridad` usa `IsAdminGroupOrStaff`, así
que un Gestor —que es nivel administración— pasaría. Debe rechazarlo
explícitamente, con el mismo criterio que el resto del diseño: se valida en el
servidor, no solo escondiendo el bloque.

## Dónde se cuelgan los candados

**Borrado de catálogo.** `ProtectedDestroyMixin` (`maquinaria/views.py:51`) ya
envuelve el `destroy` de las vistas de catálogo. Ahí se agrega la comprobación de
`borrar_catalogo`, en un solo lugar, en vez de regarla por cada vista. Las vistas
que no lo usan (`UnidadDetail`, `RefaccionDetail`, `EquipoRetrieveUpdateDestroy`)
se hacen pasar por el mismo mixin.

**Datos bancarios.** `ConfiguracionSitioSerializer` valida el campo: si quien
edita no tiene `editar_datos_bancarios` y el valor cambia, rechaza. En el panel,
el campo no se pinta. Se valida en el servidor, no solo escondiendo el campo.

**Secciones del panel.** En el mapa `REQUIERE`: `ventas`, `rentas`, `adeudos` y
`pedidos` pasan de `ver_dinero` a `ver_operacion`. `resumen` se queda en
`ver_dinero`.

**Consecuencia declarada del corte de caja.** `corte_caja` usa `ver_dinero` para
decidir si se ve la caja de todos o solo la propia. Como el Gestor no lo tiene,
al hacer un corte verá únicamente su turno, no el de los demás cajeros. Es el
comportamiento deseado —el corte de todos es información agregada del negocio—
pero conviene tenerlo escrito para que nadie lo lea después como un bug.

## Rastro de precios de lista

Al cambiar `precio_dia`, `precio_semana`, `precio_mes` o `precio_venta` de un
producto, se guarda una entrada con quién, cuándo y los valores anterior y
nuevo. Es lo que hace visible el movimiento que el bloqueo no está impidiendo:
bajar el precio de lista y vender "a precio normal" no deja rastro de descuento,
a diferencia de ajustar el precio en una venta puntual.

## Pruebas

- La fila completa del Gestor: lo que puede y lo que no.
- Que no pueda borrar catálogo ni tocar la CLABE **llamando al endpoint
  directo**, no solo que la interfaz lo esconda.
- Que su propio PIN **no** autorice y el del dueño **sí**.
- Que no pueda definirse un PIN.
- Que sin PIN del dueño configurado, la acción se rechace con mensaje claro.
- Que el Administrador siga autorizándose con el suyo (no hay regresión).
- Que el Gestor vea la lista de ventas pero no el Resumen.
- Simulación del menú por rol, para dejar grabado qué ve cada quien.
- Que `definir_codigo_seguridad` rechace al Gestor **llamando al endpoint
  directo**, y lo acepte para Administrador y Dueño.
- Que fijar el NIP sin la contraseña correcta de la cuenta falle.

## Fuera de alcance

- Cola de aprobaciones o notificaciones al dueño.
- Apretar al Administrador para que también pida el código del dueño.
- Renombrar el rol "Administrador", aunque su nombre compite con "Dueño" y se
  presta a confusión.
- Permisos configurables desde el panel (el catálogo ya está listo para eso; la
  pantalla no existe todavía).
