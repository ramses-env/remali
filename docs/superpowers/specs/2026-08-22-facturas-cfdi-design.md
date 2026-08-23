# La factura llega al cliente por el sistema

**Fecha:** 2026-08-22
**Estado:** diseño aprobado, sin implementar

## Problema

El cliente pide factura, captura sus datos fiscales en REMALI y ahí se acaba el
camino. `apps/facturacion` guarda la solicitud con el snapshot del receptor
(RFC, razón social, CP, régimen, uso del CFDI) y los importes, la muestra en la
bandeja "Por facturar", y espera a que alguien la marque como facturada
escribiendo el UUID a mano.

El CFDI se timbra en una app externa. Lo que sale de ahí (el XML y el PDF) vive
en la computadora de quien lo timbró y se le manda al cliente por fuera, por
correo personal o por WhatsApp. El sistema no se entera. Consecuencias:

1. **No hay entrega.** El cliente no tiene dónde volver a bajar su factura. Cada
   reenvío es una petición por teléfono y un archivo que alguien tiene que
   buscar.
2. **No hay resguardo.** Un CFDI se conserva cinco años. Hoy el único respaldo es
   la carpeta de descargas de una laptop.
3. **`SolicitudFactura.uuid` se captura a mano**, tecleando 36 caracteres. Nada
   verifica que ese folio corresponda a esa venta, ni que exista.
4. **La representación impresa es la del PAC**, sin identidad de REMALI y sin la
   información que el cliente necesita para amarrar la factura con lo que
   recibió: qué máquina, con qué número de serie, de qué folio VEN o REN.

## Lo que se construye

REMALI recibe el XML timbrado, lo valida contra la solicitud, lo guarda, arma su
propia representación impresa y se la entrega al cliente. El sistema no timbra
nada ni genera datos fiscales: los datos que captura el cliente existen para que
administración los tenga juntos al capturar la factura en la app externa, y el
CFDI sigue naciendo allá.

## Decisiones tomadas

1. **El XML entra a mano, una solicitud a la vez.** Se descartó jalarlo por API
   del PAC (ata el diseño a un proveedor y a credenciales que hoy no existen),
   por correo reenviado (frágil, necesita buzón dedicado) y por lote mensual
   (casar por RFC y total adivina, y adivinar con documentos fiscales no).
   Subirlo a mano funciona con cualquier app externa y con cualquier PAC.

2. **El XML se guarda como texto en la base, no como archivo.** Tres razones y
   las tres pesan. El `STORAGES['default']` del proyecto es Cloudinary cuando hay
   credenciales, y los assets de Cloudinary se sirven por URL pública: los datos
   fiscales de un cliente no pueden estar detrás de una liga adivinable, por el
   mismo criterio que sacó los respaldos de ahí. `respaldar_bd` usa `dumpdata`,
   así que respalda la base pero no los archivos: un XML en disco quedaría fuera
   de todos los respaldos, y hay que conservarlo cinco años. Y un CFDI pesa entre
   4 y 15 KB, así que diez mil facturas son unos 100 MB, nada para MySQL.

3. **El PDF se genera, no se guarda.** Se arma cuando alguien lo pide, a partir
   del XML y de la venta o renta. Cambiar el logo o el formato reescribe todas
   las facturas viejas sin migrar nada, y no hay un segundo archivo que pueda
   desincronizarse del XML.

4. **Lo fiscal se transcribe, nunca se recalcula.** El subtotal, el IVA, el total
   y los conceptos se copian literalmente del XML. Ni una división entre 1.16 en
   el generador. REMALI tiene su propia lógica de IVA para ventas (precio con IVA
   incluido, se desglosa) y para rentas (se suma si hay factura), y esa lógica no
   toca este documento. Si el PDF y el XML dijeran cifras distintas, el
   equivocado sería el PDF, y sería un PDF que el negocio le mandó al cliente con
   su logo encima.

5. **`Factura` es un modelo aparte, no cuatro campos encima de la solicitud.**
   Una solicitud es "el cliente quiere factura"; un CFDI es un documento fiscal
   con su propio ciclo de vida. Cuando el SAT cancela una factura y se
   refactura, una solicitud termina con dos CFDI y los dos deben conservarse. Con
   los datos escritos encima de la solicitud, el cancelado se pierde.

6. **Un descuadre bloquea la subida y explica qué no cuadra.** RFC receptor
   distinto, o total distinto, o UUID repetido: no entra. Mandarle a un cliente
   la factura de otro es problema fiscal y de privacidad al mismo tiempo, y
   subir dos veces el mismo archivo no se ve raro hasta que alguien reclama.

7. **El XML se entrega siempre, junto al PDF.** El PDF con marca es un envoltorio;
   el documento fiscal es el XML y es lo que necesita el contador del cliente.

8. **El XML nunca se edita.** REMALI lo lee y lo reenvía tal como llegó.
   Cualquier modificación invalida el sello.

## El modelo

`apps/facturacion/models.py`, junto a `SolicitudFactura`:

```
SolicitudFactura  1 ──< N  Factura
   (la petición)            (el CFDI)
```

Campos de `Factura`:

- **Vínculo y rastro:** `solicitud` (FK, `related_name='facturas'`),
  `subida_por` (FK a User), `subida_en`.
- **El documento:** `xml` (TextField, el CFDI íntegro y sin tocar).
- **Identidad fiscal:** `uuid` (unique), `serie`, `folio`.
- **Emisor:** `rfc_emisor`, `nombre_emisor`, `regimen_emisor`.
- **Receptor:** `rfc_receptor`, `nombre_receptor`, `cp_receptor`,
  `regimen_receptor`, `uso_cfdi`.
- **Importes:** `subtotal`, `descuento`, `iva`, `total`, `moneda`.
- **Clasificación:** `tipo_comprobante`, `forma_pago`, `metodo_pago`,
  `lugar_expedicion`.
- **Fechas:** `fecha_emision`, `fecha_certificacion`.
- **Validación:** `sello_cfd`, `sello_sat`, `no_certificado_emisor`,
  `no_certificado_sat`, `rfc_prov_certif`, `cadena_original` (TextField).
- **Estado:** `estado` (`vigente` / `cancelada`), `cancelada_en`,
  `cancelada_motivo`, `sustituye_a` (FK a sí misma, nullable).
- **Envío:** `envio_estado` (`pendiente` / `enviada` / `fallo`), `enviada_en`,
  `envio_error`.

Guardar el XML y además las columnas extraídas parece redundante y no lo es. El
XML es la verdad; las columnas existen para que listar doscientas facturas no
signifique parsear doscientos documentos, y para que las validaciones y los
reportes corran en SQL. La regla, escrita en el modelo: si alguna vez discrepan,
gana el XML y las columnas se regeneran a partir de él. Nunca al revés.

### Ciclo de vida

```
solicitud pendiente
      │  se sube el XML
      ▼
  Factura vigente ──── el SAT la cancela ────▶ Factura cancelada
      │                                              │
      │                                              │ se refactura
      │                                              ▼
      │                                      Factura vigente
      │                                      (sustituye_a la anterior)
```

Dos comportamientos que se derivan de esto:

- **Cancelar la única factura vigente regresa la solicitud a `pendiente`**, y
  vuelve a aparecer en Por facturar. Si no, una cancelación se convierte en una
  factura que nadie volvió a emitir porque ya nadie la veía.
- **`SolicitudFactura.uuid` y `fecha_timbrado` se siguen escribiendo** como
  espejo de la factura vigente, y se limpian si esa factura se cancela y no hay
  otra. El código nuevo no los necesita, pero el panel ya los muestra y así nada
  de lo que hoy funciona se rompe.

## La subida y sus candados

`POST /api/facturacion/solicitudes/<pk>/factura/`, multipart con el XML. Permiso
`IsAdminGroupOrStaff`, igual que el resto del módulo. Queda registrado quién
subió y cuándo.

El parseo usa **`defusedxml`** (dependencia nueva, pura Python). Parsear con el
`ElementTree` de la librería estándar un archivo que sube un humano es un vector
conocido de expansión de entidades, y aquí el archivo viene de fuera.

Validaciones, en este orden, cada una con su mensaje:

1. **¿Es un CFDI timbrado?** Existe el nodo `cfdi:Comprobante` y dentro del
   complemento el `tfd:TimbreFiscalDigital`. Si no: *"Esto no es un CFDI
   timbrado. ¿Subiste el acuse o el PDF por error?"*
2. **¿Lo emitió el negocio?** `Emisor@Rfc` contra `ConfiguracionSitio.negocio_rfc`,
   que ya existe. Atrapa el caso de subir la factura de un proveedor. Si ese
   campo está vacío el candado se omite y la respuesta lo dice, para que nadie
   crea que se verificó algo que no se verificó.
3. **¿Es de este cliente?** `Receptor@Rfc` contra `solicitud.rfc`. Bloqueo
   absoluto, sin excepción posible.
4. **¿Es de esta venta?** `Comprobante@Total` contra `solicitud.total`, con
   tolerancia de $0.01 por redondeo, el mismo criterio que ya usa la validación
   de pagos combinados en la conversión de cotizaciones.
5. **¿Ya estaba en otro lado?** El UUID no puede existir ya en el sistema. Si
   existe, el mensaje dice dónde: *"Ese folio fiscal ya está en la venta
   VEN-2026-0042."*

Todo en una transacción: o queda la factura completa con su solicitud marcada, o
no queda nada.

### Nodos que se leen

Espacios de nombres `cfdi = http://www.sat.gob.mx/cfd/4` y
`tfd = http://www.sat.gob.mx/TimbreFiscalDigital`.

- `cfdi:Comprobante`: `Version`, `Serie`, `Folio`, `Fecha`, `Sello`,
  `NoCertificado`, `SubTotal`, `Descuento`, `Moneda`, `Total`,
  `TipoDeComprobante`, `MetodoPago`, `FormaPago`, `LugarExpedicion`.
- `cfdi:Emisor`: `Rfc`, `Nombre`, `RegimenFiscal`.
- `cfdi:Receptor`: `Rfc`, `Nombre`, `DomicilioFiscalReceptor`,
  `RegimenFiscalReceptor`, `UsoCFDI`.
- `cfdi:Conceptos/cfdi:Concepto`: `Cantidad`, `ClaveUnidad`, `Descripcion`,
  `ValorUnitario`, `Importe`, `Descuento`.
- `cfdi:Impuestos`: `TotalImpuestosTrasladados`.
- `tfd:TimbreFiscalDigital`: `UUID`, `FechaTimbrado`, `RfcProvCertif`,
  `SelloCFD`, `NoCertificadoSAT`, `SelloSAT`.

La cadena original del complemento de certificación se compone a partir del
timbre con el formato `||version|UUID|FechaTimbrado|RfcProvCertif|SelloCFD|NoCertificadoSAT||`,
así que no hace falta procesar el XSLT del SAT.

### Limitación conocida: facturación parcial

Con el candado del punto 4, un CFDI que cubra solo parte de la venta (un
anticipo, o una venta partida en dos facturas) no va a pasar, porque el total
nunca va a cuadrar. Es una decisión consciente: se prefiere bloquear de más a
dejar pasar una factura que no corresponde. Si en la operación resulta frecuente,
la salida es una excepción con motivo registrado, al estilo del código de 6
dígitos que ya autoriza los ajustes de precio, no relajar la validación.

## El PDF

Se arma con `reportlab`, siguiendo la mano de `apps/cotizaciones/pdf.py` para que
salga con el mismo aire que las órdenes en carta. `reportlab` y `qrcode` ya están
en `requirements.txt`.

El encabezado usa los datos que ya hay en `ConfiguracionSitio`
(`negocio_nombre`, `negocio_direccion`, `negocio_telefono`, `negocio_rfc`), no
constantes nuevas.

Contenido fiscal, transcrito del XML: emisor con RFC, régimen y lugar de
expedición; receptor con RFC, CP, régimen y uso del CFDI; serie y folio; fecha de
emisión; los conceptos tal como vienen; subtotal, descuento, IVA y total; moneda;
forma y método de pago.

Contenido de REMALI, alrededor y visualmente separado para que nadie lo confunda
con contenido fiscal: el folio VEN o REN que le dio origen, el código de la
unidad y su número de serie debajo del concepto que le corresponda, y el periodo
si fue renta. Cuando un concepto del XML no se pueda casar con una unidad de
REMALI, no lleva nada debajo. No se fuerza la correspondencia.

Bloque de validación al pie: UUID, fecha de certificación, sello del CFDI, sello
del SAT, número de certificado del emisor y del SAT, cadena original, la leyenda
"Este documento es una representación impresa de un CFDI", y el código QR con la
liga de verificación del SAT, compuesta con el UUID, los dos RFC, el total y los
últimos ocho caracteres del sello del CFDI.

## La entrega

**Correo automático.** Al validarse la subida sale el correo con los dos archivos
adjuntos, por `enviar_async` de `apps/maquinaria/correo.py`, que ya adjunta y ya
tiene respaldo por SMTP si Brevo falla. Va al correo fiscal de la solicitud.

Si la solicitud no trae correo fiscal, no se inventa un destinatario: la
factura queda con `envio_estado = 'pendiente'` y la bandeja la muestra como "sin
correo", para que alguien lo capture y reenvíe.

Ese helper manda en un hilo y solo escribe en el log cuando falla, así que un
correo que no salió sería invisible. Por eso la factura guarda `envio_estado`, y
un fallo deja **notificación en el panel**, igual que se resolvió el respaldo que
fallaba en silencio. En la bandeja se lee "enviada el 22 ago" o "no se pudo
enviar", con botón de reenviar.

**Portal del cliente.** Sección nueva "Mis facturas", junto a Mis compras y Mis
rentas: folio fiscal, fecha, importe, estado, y los dos botones de descarga.

**Panel.** En Por facturar: subir el XML, bajar el XML y el PDF, reenviar el
correo, y marcar cancelada.

### Endpoints

| Método | Ruta | Quién |
|--------|------|-------|
| POST | `/api/facturacion/solicitudes/<pk>/factura/` | administración |
| POST | `/api/facturacion/facturas/<pk>/cancelar/` | administración |
| POST | `/api/facturacion/facturas/<pk>/reenviar/` | administración |
| GET | `/api/facturacion/facturas/<pk>/xml/` | dueño o administración |
| GET | `/api/facturacion/facturas/<pk>/pdf/` | dueño o administración |
| GET | `/api/facturacion/mias/` | cliente autenticado |

## Autorización y privacidad

Las descargas verifican que quien pide sea el dueño de la venta o renta de
origen, o alguien de administración. Nunca una URL pública, ni para el XML ni
para el PDF, ni con token. Un XML trae el RFC, la razón social y el domicilio
fiscal del cliente.

Se descartó la liga pública sin cuenta que sí usan las cotizaciones y el
seguimiento de reparaciones: ahí lo que se expone es un presupuesto o el avance
de un arreglo; aquí son los datos fiscales de una empresa.

El cliente sin cuenta recibe su factura por correo. Si después vincula su cuenta,
la ve en Mis facturas como cualquier otra.

## Qué no hace

- No timbra, no sella y no se conecta con ningún PAC.
- No genera ni corrige datos fiscales. Solo lee lo que ya viene timbrado.
- No cancela ante el SAT. Cancelar en REMALI solo registra que allá se canceló.
- No factura parcialmente (ver la limitación de arriba).
- No sustituye al XML: el PDF acompaña, no reemplaza.

## Cómo se puede partir

El plan de implementación puede entregarlo en dos incrementos que sirven por
separado, y conviene que así sea:

1. **Recibir y resguardar.** Modelo, parseo, candados, subida desde el panel y
   descarga del XML. Con esto ya no se pierde ninguna factura y el resguardo
   entra a los respaldos, aunque el cliente siga recibiéndola por fuera.
2. **Generar y entregar.** El PDF, el correo automático y Mis facturas.

El orden importa: el paso 2 depende de tener el XML dentro, y el paso 1 tiene
valor aunque el 2 se retrase.

## Pruebas

Las que protegen algo real:

- Un XML de otro RFC receptor se rechaza y la solicitud no se marca.
- El mismo UUID no entra dos veces, y el mensaje dice dónde estaba.
- Un archivo que no es CFDI (el PDF, el acuse) se rechaza sin reventar.
- El PDF transcribe los importes del XML aunque no coincidan con el cálculo
  interno de IVA de REMALI.
- Un cliente no puede descargar la factura de otro.
- Cancelar la única factura regresa la solicitud a `pendiente`.
- Refacturar deja las dos facturas, una cancelada y una vigente ligada a ella.
- El XML que se descarga es byte por byte el que se subió.

## Por verificar antes de producción

Puntos donde conviene no fiarse de la memoria del desarrollador:

1. **La composición de la liga del QR** del SAT, contra un PDF real del PAC.
2. **La lista de datos obligatorios de la representación impresa** con el
   contador. La lista de este documento es la estable; la numeración de la regla
   de la RMF cambia entre ediciones anuales.
3. **Que `ConfiguracionSitio.negocio_rfc` esté capturado.** El campo ya existe;
   sin él, el candado 2 no puede correr.

## Puntos a tocar

Backend:
- `apps/facturacion/models.py`: modelo `Factura`, migración.
- `apps/facturacion/cfdi.py` (nuevo): parseo y validación del XML.
- `apps/facturacion/pdf.py` (nuevo): la representación impresa.
- `apps/facturacion/views.py` y `urls.py`: los seis endpoints.
- `requirements.txt`: `defusedxml`.

Frontend, los cinco puntos de `Dashboard.tsx` para la sección del panel más la
sección nueva del portal:
- El union `type Section`, el mapa de capacidad, la navegación, el render y el
  componente, para la bandeja Por facturar ampliada.
- `routes/MisFacturas.tsx` (nuevo) y su ruta en `App.tsx`.
