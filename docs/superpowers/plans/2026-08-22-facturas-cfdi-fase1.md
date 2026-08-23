# Recibir y resguardar el CFDI — plan de implementación (fase 1)

> **Para quien ejecute esto:** cada tarea termina en algo probado y commiteado.
> Las casillas (`- [ ]`) marcan el avance. Prueba antes que código, siempre.
> Subtécnica requerida: `superpowers:subagent-driven-development` (recomendada)
> o `superpowers:executing-plans`.

**Objetivo:** que el XML timbrado en la app externa entre a REMALI validado
contra su solicitud, quede resguardado dentro de los respaldos y se pueda volver
a descargar tal como llegó.

**Arquitectura:** un modelo `Factura` colgado de la `SolicitudFactura` que ya
existe. El XML se guarda como TEXTO en la base, no como archivo, y las columnas
extraídas viven al lado para poder listar y validar en SQL. El XML es la verdad;
las columnas se regeneran a partir de él, nunca al revés.

**Stack:** Django 5.2 + DRF, MySQL, `defusedxml` (nuevo), React 19 + TypeScript.

**Diseño:** `docs/superpowers/specs/2026-08-22-facturas-cfdi-design.md`

**Fuera de alcance en esta fase:** el PDF con marca, el correo automático y la
sección "Mis facturas". Van en el plan de la fase 2. Al terminar esta fase, la
factura ya no se pierde, aunque el cliente la siga recibiendo por fuera.

---

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `backend/requirements.txt` | `defusedxml` |
| `backend/apps/facturacion/models.py` | Modelo `Factura` y su ciclo de vida |
| `backend/apps/facturacion/migrations/0003_factura.py` | Tabla nueva |
| `backend/apps/facturacion/cfdi.py` | Leer un CFDI: XML de texto a diccionario de campos |
| `backend/apps/facturacion/validacion.py` | Los cinco candados contra la solicitud |
| `backend/apps/facturacion/serializers.py` | `FacturaSerializer` + facturas dentro de la solicitud |
| `backend/apps/facturacion/views.py` | Subir, descargar XML, cancelar |
| `backend/apps/facturacion/urls.py` | Las tres rutas nuevas |
| `backend/apps/facturacion/tests_cfdi.py` | El lector, con un constructor de XML de prueba |
| `backend/apps/facturacion/tests_subida.py` | Los candados y la transacción |
| `backend/apps/facturacion/tests_ciclo.py` | Cancelar, refacturar y descargar |
| `frontend/src/routes/dashboard/facturacion.tsx` | Subir, descargar y cancelar en Por facturar |

**Por qué `cfdi.py` y `validacion.py` separados:** leer un XML y decidir si ese
XML corresponde a esta venta son dos trabajos distintos. El lector no sabe que
existen las solicitudes, así que se prueba con puros strings; el validador no
parsea nada, así que se prueba con diccionarios. Juntos serían un archivo que
solo se puede probar levantando la base.

---

### Tarea 1 · El lector de CFDI

**Archivos:** crea `apps/facturacion/cfdi.py` y `apps/facturacion/tests_cfdi.py`;
modifica `requirements.txt`.

- [ ] **Paso 1 — Instalar la dependencia.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/pip install defusedxml==0.7.1 && echo "defusedxml==0.7.1" >> requirements.txt && sort -o requirements.txt requirements.txt
```

- [ ] **Paso 2 — Prueba que falla.** Crea `apps/facturacion/tests_cfdi.py` con un
  constructor de XML parametrizable. Todas las pruebas de esta fase salen de
  aquí, así que vale la pena que se lea bien:

```python
"""El lector de CFDI: de un XML timbrado a los campos que REMALI necesita.

Se prueba con un constructor y no con archivos sueltos: cada prueba dice en su
primera línea qué tiene de distinto ese CFDI (otro RFC, otro total, sin timbre),
y no hay que abrir un .xml para entender qué se está probando.
"""
from decimal import Decimal

from django.test import SimpleTestCase

from facturacion.cfdi import CFDIInvalido, leer_cfdi

TIMBRE = (
    '<tfd:TimbreFiscalDigital Version="1.1" '
    'UUID="A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D" '
    'FechaTimbrado="2026-08-22T10:15:30" RfcProvCertif="SAT970701NN3" '
    'SelloCFD="c2VsbG9DRkQ=" NoCertificadoSAT="30001000000400002495" '
    'SelloSAT="c2VsbG9TQVQ=" />'
)


def cfdi_xml(*, rfc_emisor='REM010101AAA', rfc_receptor='MEJJ800101ABC',
             total='2000.00', subtotal='1724.14', iva='275.86',
             serie='A', folio='123', timbre=TIMBRE):
    """Un CFDI 4.0 mínimo pero completo. Lo que cambia se pasa por parámetro."""
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4"
  xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"
  Version="4.0" Serie="{serie}" Folio="{folio}" Fecha="2026-08-22T10:15:00"
  Sello="c2VsbG9EZWxFbWlzb3I=" NoCertificado="30001000000500003416"
  SubTotal="{subtotal}" Moneda="MXN" Total="{total}"
  TipoDeComprobante="I" Exportacion="01" MetodoPago="PUE" FormaPago="03"
  LugarExpedicion="39300">
  <cfdi:Emisor Rfc="{rfc_emisor}" Nombre="REMALI SA DE CV" RegimenFiscal="601" />
  <cfdi:Receptor Rfc="{rfc_receptor}" Nombre="JAZMIN MENDOZA"
    DomicilioFiscalReceptor="39300" RegimenFiscalReceptor="612" UsoCFDI="G03" />
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="22101502" Cantidad="1" ClaveUnidad="H87"
      Descripcion="Revolvedora de concreto 1 saco" ValorUnitario="{subtotal}"
      Importe="{subtotal}" ObjetoImp="02" />
  </cfdi:Conceptos>
  <cfdi:Impuestos TotalImpuestosTrasladados="{iva}" />
  <cfdi:Complemento>{timbre}</cfdi:Complemento>
</cfdi:Comprobante>'''


class LeerCFDITest(SimpleTestCase):

    def test_saca_la_identidad_fiscal(self):
        d = leer_cfdi(cfdi_xml())
        self.assertEqual(d['uuid'], 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')
        self.assertEqual(d['serie'], 'A')
        self.assertEqual(d['folio'], '123')
        self.assertEqual(d['rfc_emisor'], 'REM010101AAA')
        self.assertEqual(d['rfc_receptor'], 'MEJJ800101ABC')
        self.assertEqual(d['uso_cfdi'], 'G03')

    def test_los_importes_llegan_como_decimal(self):
        """Como Decimal y no como float: es dinero, y se compara al centavo."""
        d = leer_cfdi(cfdi_xml())
        self.assertEqual(d['total'], Decimal('2000.00'))
        self.assertEqual(d['subtotal'], Decimal('1724.14'))
        self.assertEqual(d['iva'], Decimal('275.86'))

    def test_arma_la_cadena_original_del_timbre(self):
        d = leer_cfdi(cfdi_xml())
        self.assertEqual(
            d['cadena_original'],
            '||1.1|A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D|2026-08-22T10:15:30|'
            'SAT970701NN3|c2VsbG9DRkQ=|30001000000400002495||',
        )

    def test_sin_timbre_no_es_un_cfdi_valido(self):
        """El caso real: subir el XML previo al timbrado, o el acuse."""
        with self.assertRaises(CFDIInvalido) as caso:
            leer_cfdi(cfdi_xml(timbre=''))
        self.assertIn('timbrado', str(caso.exception).lower())

    def test_un_archivo_que_no_es_xml_no_revienta(self):
        with self.assertRaises(CFDIInvalido):
            leer_cfdi('%PDF-1.4 esto es un pdf')

    def test_un_xml_que_no_es_cfdi_no_revienta(self):
        with self.assertRaises(CFDIInvalido):
            leer_cfdi('<?xml version="1.0"?><lista><cosa/></lista>')
```

- [ ] **Paso 3 — Correr y ver el fallo.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py test facturacion.tests_cfdi -v 2
```

Se espera: `ModuleNotFoundError: No module named 'facturacion.cfdi'`.

- [ ] **Paso 4 — Escribir el lector.** Crea `apps/facturacion/cfdi.py`:

```python
"""Leer un CFDI 4.0 timbrado.

Este módulo NO sabe que existen las solicitudes ni las ventas: recibe el texto
de un XML y devuelve sus campos. Todo lo que decide si ese CFDI corresponde a
una venta vive en `validacion.py`.

Se parsea con defusedxml y no con el ElementTree de la librería estándar: el
archivo lo sube un humano desde fuera, y la expansión de entidades es un ataque
conocido contra los parsers de XML.
"""
from decimal import Decimal, InvalidOperation

from defusedxml.ElementTree import fromstring, ParseError

CFDI = 'http://www.sat.gob.mx/cfd/4'
TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital'


class CFDIInvalido(Exception):
    """El archivo no es un CFDI timbrado que se pueda leer."""


def _dec(valor, default='0'):
    try:
        return Decimal(str(valor if valor not in (None, '') else default))
    except InvalidOperation:
        return Decimal(default)


def leer_cfdi(texto):
    """Devuelve un dict con los campos del CFDI. Lanza CFDIInvalido si no lo es."""
    if isinstance(texto, bytes):
        texto = texto.decode('utf-8', errors='replace')
    try:
        raiz = fromstring(texto.encode('utf-8'))
    except (ParseError, ValueError) as e:
        raise CFDIInvalido('El archivo no es un XML que se pueda leer.') from e

    if not raiz.tag.endswith('}Comprobante'):
        raise CFDIInvalido('El XML no es un CFDI: falta el nodo Comprobante.')

    emisor = raiz.find(f'{{{CFDI}}}Emisor')
    receptor = raiz.find(f'{{{CFDI}}}Receptor')
    impuestos = raiz.find(f'{{{CFDI}}}Impuestos')
    timbre = raiz.find(f'.//{{{TFD}}}TimbreFiscalDigital')
    if timbre is None:
        raise CFDIInvalido(
            'Esto no es un CFDI timbrado: no trae Timbre Fiscal Digital. '
            '¿Subiste el acuse o el PDF por error?'
        )
    if emisor is None or receptor is None:
        raise CFDIInvalido('El CFDI no trae emisor o receptor.')

    g = raiz.get
    t = timbre.get
    conceptos = [
        {
            'descripcion': c.get('Descripcion', ''),
            'cantidad': _dec(c.get('Cantidad'), '1'),
            'clave_unidad': c.get('ClaveUnidad', ''),
            'valor_unitario': _dec(c.get('ValorUnitario')),
            'importe': _dec(c.get('Importe')),
            'descuento': _dec(c.get('Descuento')),
        }
        for c in raiz.findall(f'{{{CFDI}}}Conceptos/{{{CFDI}}}Concepto')
    ]
    return {
        'version': g('Version', ''),
        'serie': g('Serie', ''),
        'folio': g('Folio', ''),
        'fecha_emision': g('Fecha', ''),
        'sello_cfd': g('Sello', ''),
        'no_certificado_emisor': g('NoCertificado', ''),
        'subtotal': _dec(g('SubTotal')),
        'descuento': _dec(g('Descuento')),
        'total': _dec(g('Total')),
        'moneda': g('Moneda', 'MXN'),
        'tipo_comprobante': g('TipoDeComprobante', ''),
        'metodo_pago': g('MetodoPago', ''),
        'forma_pago': g('FormaPago', ''),
        'lugar_expedicion': g('LugarExpedicion', ''),
        'rfc_emisor': (emisor.get('Rfc') or '').upper(),
        'nombre_emisor': emisor.get('Nombre', ''),
        'regimen_emisor': emisor.get('RegimenFiscal', ''),
        'rfc_receptor': (receptor.get('Rfc') or '').upper(),
        'nombre_receptor': receptor.get('Nombre', ''),
        'cp_receptor': receptor.get('DomicilioFiscalReceptor', ''),
        'regimen_receptor': receptor.get('RegimenFiscalReceptor', ''),
        'uso_cfdi': receptor.get('UsoCFDI', ''),
        'iva': _dec(impuestos.get('TotalImpuestosTrasladados') if impuestos is not None else 0),
        'uuid': (t('UUID') or '').upper(),
        'fecha_certificacion': t('FechaTimbrado', ''),
        'rfc_prov_certif': t('RfcProvCertif', ''),
        'sello_sat': t('SelloSAT', ''),
        'no_certificado_sat': t('NoCertificadoSAT', ''),
        'cadena_original': (
            f"||{t('Version', '1.1')}|{t('UUID', '')}|{t('FechaTimbrado', '')}|"
            f"{t('RfcProvCertif', '')}|{t('SelloCFD', '')}|{t('NoCertificadoSAT', '')}||"
        ),
        'conceptos': conceptos,
    }
```

- [ ] **Paso 5 — Correr y ver pasar.** Mismo comando del paso 3. Se esperan 6 en verde.

- [ ] **Paso 6 — Commit.**

```bash
git add backend/requirements.txt backend/apps/facturacion/cfdi.py backend/apps/facturacion/tests_cfdi.py && git commit -m "Facturas: leer un CFDI timbrado sin confiar en el archivo"
```

---

### Tarea 2 · El modelo `Factura`

**Archivos:** modifica `apps/facturacion/models.py`; crea la migración.

- [ ] **Paso 1 — Prueba que falla.** Crea `apps/facturacion/tests_ciclo.py`:

```python
"""El ciclo de vida de la factura: nace vigente, se cancela, se refactura."""
from decimal import Decimal

from django.test import TestCase

from facturacion.models import Factura, SolicitudFactura


def solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        email='jazmin@correo.mx',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


class CicloDeLaFacturaTest(TestCase):

    def test_nace_vigente(self):
        f = Factura.objects.create(
            solicitud=solicitud(), xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
            total=Decimal('2000.00'),
        )
        self.assertEqual(f.estado, 'vigente')

    def test_el_uuid_no_se_repite(self):
        """El mismo XML subido dos veces es el error silencioso más probable."""
        uuid = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D'
        Factura.objects.create(solicitud=solicitud(), xml='<x/>', uuid=uuid)
        with self.assertRaises(Exception):
            Factura.objects.create(solicitud=solicitud(), xml='<x/>', uuid=uuid)
```

- [ ] **Paso 2 — Correr y ver el fallo.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py test facturacion.tests_ciclo -v 2
```

Se espera: `ImportError: cannot import name 'Factura'`.

- [ ] **Paso 3 — Escribir el modelo.** Al final de `apps/facturacion/models.py`:

```python
class Factura(models.Model):
    """Un CFDI timbrado que ya entró al sistema.

    Vive aparte de la solicitud a propósito: una solicitud es "el cliente quiere
    factura" y un CFDI es un documento fiscal con su propio ciclo. Cuando el SAT
    cancela una factura y se refactura, la solicitud termina con DOS CFDI y los
    dos se conservan; con los datos escritos encima de la solicitud, el cancelado
    se perdería.

    El XML se guarda como TEXTO y no como archivo por tres razones: el storage
    por defecto del proyecto es Cloudinary, que sirve por URL pública, y aquí van
    los datos fiscales del cliente; `respaldar_bd` usa dumpdata, así que un
    archivo quedaría fuera de todos los respaldos y un CFDI se conserva cinco
    años; y un CFDI pesa entre 4 y 15 KB.

    El XML es la verdad. Las columnas de abajo se extrajeron de él para poder
    listar y validar sin parsear, y si alguna vez discrepan, se regeneran desde
    el XML. Nunca al revés, y el XML no se edita jamás: cambiarlo invalida el
    sello.
    """
    ESTADOS = [('vigente', 'Vigente'), ('cancelada', 'Cancelada ante el SAT')]
    ENVIO = [('pendiente', 'Sin enviar'), ('enviada', 'Enviada'), ('fallo', 'Falló el envío')]

    solicitud = models.ForeignKey(SolicitudFactura, on_delete=models.CASCADE, related_name='facturas')
    xml = models.TextField(help_text='El CFDI íntegro, tal como llegó. No se edita.')

    uuid = models.CharField(max_length=40, unique=True, help_text='Folio fiscal')
    serie = models.CharField(max_length=25, blank=True, default='')
    folio = models.CharField(max_length=40, blank=True, default='')

    rfc_emisor = models.CharField(max_length=20, blank=True, default='')
    nombre_emisor = models.CharField(max_length=200, blank=True, default='')
    regimen_emisor = models.CharField(max_length=10, blank=True, default='')

    rfc_receptor = models.CharField(max_length=20, blank=True, default='')
    nombre_receptor = models.CharField(max_length=200, blank=True, default='')
    cp_receptor = models.CharField(max_length=10, blank=True, default='')
    regimen_receptor = models.CharField(max_length=10, blank=True, default='')
    uso_cfdi = models.CharField(max_length=10, blank=True, default='')

    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    descuento = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    iva = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    moneda = models.CharField(max_length=5, blank=True, default='MXN')

    tipo_comprobante = models.CharField(max_length=5, blank=True, default='')
    forma_pago = models.CharField(max_length=5, blank=True, default='')
    metodo_pago = models.CharField(max_length=5, blank=True, default='')
    lugar_expedicion = models.CharField(max_length=10, blank=True, default='')

    fecha_emision = models.CharField(max_length=30, blank=True, default='')
    fecha_certificacion = models.CharField(max_length=30, blank=True, default='')

    sello_cfd = models.TextField(blank=True, default='')
    sello_sat = models.TextField(blank=True, default='')
    no_certificado_emisor = models.CharField(max_length=30, blank=True, default='')
    no_certificado_sat = models.CharField(max_length=30, blank=True, default='')
    rfc_prov_certif = models.CharField(max_length=20, blank=True, default='')
    cadena_original = models.TextField(blank=True, default='')

    estado = models.CharField(max_length=10, choices=ESTADOS, default='vigente')
    cancelada_en = models.DateTimeField(null=True, blank=True)
    cancelada_motivo = models.CharField(max_length=255, blank=True, default='')
    sustituye_a = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='sustituida_por')

    envio_estado = models.CharField(max_length=10, choices=ENVIO, default='pendiente')
    enviada_en = models.DateTimeField(null=True, blank=True)
    envio_error = models.CharField(max_length=255, blank=True, default='')

    subida_por = models.ForeignKey('auth.User', null=True, blank=True, on_delete=models.SET_NULL, related_name='facturas_subidas')
    subida_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'facturas_cfdi'
        verbose_name = 'Factura (CFDI)'
        verbose_name_plural = 'Facturas (CFDI)'
        ordering = ['-subida_en']

    def __str__(self):
        return f'{self.serie}{self.folio} · {self.uuid[:8]} · {self.estado}'
```

Las fechas del CFDI se guardan como texto a propósito: vienen del XML en el
formato del SAT y se imprimen tal cual. Convertirlas a `DateTimeField` obligaría
a decidir una zona horaria que el XML no dice, y a devolverlas convertidas ya no
serían las del documento.

- [ ] **Paso 4 — Migración.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py makemigrations facturacion && ../env/bin/python manage.py migrate
```

- [ ] **Paso 5 — Correr y ver pasar.** Mismo comando del paso 2. Dos en verde.

- [ ] **Paso 6 — Commit.**

```bash
git add backend/apps/facturacion/models.py backend/apps/facturacion/migrations/ backend/apps/facturacion/tests_ciclo.py && git commit -m "Facturas: el CFDI es un modelo aparte, con el XML dentro de la base"
```

---

### Tarea 3 · Los cinco candados

**Archivos:** crea `apps/facturacion/validacion.py` y `apps/facturacion/tests_subida.py`.

- [ ] **Paso 1 — Prueba que falla.** Crea `apps/facturacion/tests_subida.py`:

```python
"""Los candados: qué XML puede entrar a qué solicitud.

Cada prueba deja claro qué pasa si el candado no estuviera. El del RFC es el que
evita mandarle a un cliente la factura de otro; el del UUID es el que atrapa
subir dos veces el mismo archivo, que no se ve raro hasta que alguien reclama.
"""
from decimal import Decimal

from django.test import TestCase

from facturacion.cfdi import leer_cfdi
from facturacion.models import Factura, SolicitudFactura
from facturacion.tests_cfdi import cfdi_xml
from facturacion.validacion import DescuadreCFDI, revisar_cfdi

RFC_NEGOCIO = 'REM010101AAA'


def solicitud(**extra):
    datos = dict(
        tipo='venta', rfc='MEJJ800101ABC', razon_social='Jazmín Mendoza',
        codigo_postal='39300', regimen_fiscal='612', uso_cfdi='G03',
        subtotal=Decimal('1724.14'), iva=Decimal('275.86'), total=Decimal('2000.00'),
    )
    datos.update(extra)
    return SolicitudFactura.objects.create(**datos)


class CandadosTest(TestCase):

    def test_un_cfdi_que_cuadra_pasa(self):
        revisar_cfdi(leer_cfdi(cfdi_xml()), solicitud(), rfc_negocio=RFC_NEGOCIO)

    def test_rechaza_la_factura_de_otro_cliente(self):
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml(rfc_receptor='XAXX010101000')),
                         solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('XAXX010101000', str(caso.exception))
        self.assertIn('MEJJ800101ABC', str(caso.exception))

    def test_rechaza_la_factura_de_un_proveedor(self):
        """Emitida por otro RFC: no la emitimos nosotros."""
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml(rfc_emisor='AAA010101AAA')),
                         solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('emitió', str(caso.exception))

    def test_rechaza_otro_total(self):
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml(total='3500.00')),
                         solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('3500', str(caso.exception))

    def test_un_centavo_de_diferencia_sí_pasa(self):
        """Redondeo, no error: el mismo criterio que los pagos combinados."""
        revisar_cfdi(leer_cfdi(cfdi_xml(total='2000.01')),
                     solicitud(), rfc_negocio=RFC_NEGOCIO)

    def test_rechaza_un_uuid_que_ya_existe(self):
        s = solicitud()
        Factura.objects.create(
            solicitud=s, xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', total=Decimal('2000.00'),
        )
        with self.assertRaises(DescuadreCFDI) as caso:
            revisar_cfdi(leer_cfdi(cfdi_xml()), solicitud(), rfc_negocio=RFC_NEGOCIO)
        self.assertIn('ya está', str(caso.exception))

    def test_sin_rfc_del_negocio_no_verifica_al_emisor_pero_lo_dice(self):
        avisos = revisar_cfdi(leer_cfdi(cfdi_xml(rfc_emisor='AAA010101AAA')),
                              solicitud(), rfc_negocio='')
        self.assertTrue(any('negocio' in a for a in avisos))
```

- [ ] **Paso 2 — Correr y ver el fallo.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py test facturacion.tests_subida -v 2
```

Se espera: `ModuleNotFoundError: No module named 'facturacion.validacion'`.

- [ ] **Paso 3 — Escribir los candados.** Crea `apps/facturacion/validacion.py`:

```python
"""Decidir si un CFDI ya leído corresponde a una solicitud.

Separado del lector a propósito: aquí no se parsea nada, se comparan
diccionarios contra filas. Cada rechazo dice QUÉ no cuadró y con qué, porque el
mensaje es lo único que tiene enfrente quien acaba de subir el archivo
equivocado.
"""
from decimal import Decimal

TOLERANCIA = Decimal('0.01')


class DescuadreCFDI(Exception):
    """El CFDI no corresponde a esta solicitud."""


def revisar_cfdi(datos, solicitud, *, rfc_negocio):
    """Lanza DescuadreCFDI si algo no cuadra. Devuelve la lista de avisos.

    Un aviso no impide subir: dice que algo no se pudo verificar, para que nadie
    crea que se revisó lo que no se revisó.
    """
    from .models import Factura

    avisos = []

    # 1. ¿La emitimos nosotros?
    if rfc_negocio:
        if datos['rfc_emisor'] != rfc_negocio.strip().upper():
            raise DescuadreCFDI(
                f"Este CFDI lo emitió {datos['rfc_emisor']}, no {rfc_negocio.upper()}. "
                '¿Es la factura de un proveedor?'
            )
    else:
        avisos.append(
            'No se verificó quién emitió el CFDI: falta el RFC del negocio en '
            'Configuración.'
        )

    # 2. ¿Es de este cliente? Sin excepción posible: mandarle a alguien la
    #    factura de otro es problema fiscal y de privacidad al mismo tiempo.
    esperado = (solicitud.rfc or '').strip().upper()
    if esperado and datos['rfc_receptor'] != esperado:
        raise DescuadreCFDI(
            f"El CFDI está a nombre de {datos['rfc_receptor']} y esta solicitud "
            f'es de {esperado}. No es la factura de este cliente.'
        )

    # 3. ¿Es de esta venta?
    if abs(datos['total'] - Decimal(solicitud.total)) > TOLERANCIA:
        raise DescuadreCFDI(
            f"El CFDI es por ${datos['total']} y la solicitud es por "
            f'${solicitud.total}. Si es una factura parcial, hoy no se puede '
            'registrar así.'
        )

    # 4. ¿Ya estaba en otro lado?
    repetida = Factura.objects.filter(uuid=datos['uuid']).select_related('solicitud').first()
    if repetida:
        raise DescuadreCFDI(
            f'Ese folio fiscal ya está en {repetida.solicitud.folio_origen}. '
            'Es el mismo XML, subido dos veces.'
        )

    return avisos
```

- [ ] **Paso 4 — Correr y ver pasar.** Mismo comando del paso 2. Siete en verde.

- [ ] **Paso 5 — Commit.**

```bash
git add backend/apps/facturacion/validacion.py backend/apps/facturacion/tests_subida.py && git commit -m "Facturas: cinco candados antes de que un XML entre a una solicitud"
```

---

### Tarea 4 · Subir el XML

**Archivos:** modifica `apps/facturacion/views.py`, `urls.py`, `serializers.py`;
agrega pruebas a `tests_subida.py`.

- [ ] **Paso 1 — Prueba que falla.** Agrega al final de `tests_subida.py`:

```python
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from maquinaria.models import ConfiguracionSitio


class SubirFacturaTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        cfg = ConfiguracionSitio.objects.first() or ConfiguracionSitio.objects.create()
        cfg.negocio_rfc = RFC_NEGOCIO
        cfg.save()
        self.sol = solicitud()

    def _subir(self, xml=None):
        archivo = SimpleUploadedFile('factura.xml', (xml or cfdi_xml()).encode(), 'text/xml')
        return self.client.post(
            f'/api/facturacion/solicitudes/{self.sol.id}/factura/',
            {'xml': archivo}, format='multipart',
        )

    def test_entra_y_marca_la_solicitud(self):
        r = self._subir()
        self.assertEqual(r.status_code, 201, r.data)
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.estado, 'facturada')
        self.assertEqual(self.sol.uuid, 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')
        self.assertIsNotNone(self.sol.fecha_timbrado)

    def test_guarda_el_xml_intacto(self):
        """Byte por byte: el que se descargue tiene que ser el que se subió."""
        original = cfdi_xml()
        self._subir(original)
        self.assertEqual(Factura.objects.get().xml, original)

    def test_deja_rastro_de_quien_lo_subio(self):
        self._subir()
        self.assertEqual(Factura.objects.get().subida_por_id, self.admin.id)

    def test_un_descuadre_no_deja_nada_a_medias(self):
        r = self._subir(cfdi_xml(rfc_receptor='XAXX010101000'))
        self.assertEqual(r.status_code, 400)
        self.assertFalse(Factura.objects.exists())
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.estado, 'pendiente')

    def test_un_archivo_que_no_es_cfdi_da_400_y_no_500(self):
        r = self._subir('%PDF-1.4 esto es el pdf del PAC')
        self.assertEqual(r.status_code, 400)
        self.assertIn('CFDI', r.data['detalle'])

    def test_el_cliente_no_puede_subir_facturas(self):
        cliente = get_user_model().objects.create_user('juan', 'j@x.com', 'pass12345')
        self.client.force_authenticate(cliente)
        self.assertIn(self._subir().status_code, (401, 403))
```

- [ ] **Paso 2 — Correr y ver el fallo.** Mismo comando de la tarea 3. Se espera
  404 en la ruta, porque todavía no existe.

- [ ] **Paso 3 — Serializer.** Agrega a `apps/facturacion/serializers.py`:

```python
from .models import Factura, SolicitudFactura


class FacturaSerializer(serializers.ModelSerializer):
    """Sin el XML: pesa y no se usa para pintar. Se baja por su propia ruta."""
    subida_por_nombre = serializers.SerializerMethodField()

    class Meta:
        model = Factura
        fields = [
            'id', 'uuid', 'serie', 'folio', 'estado',
            'rfc_receptor', 'nombre_receptor',
            'subtotal', 'iva', 'total', 'moneda',
            'fecha_emision', 'fecha_certificacion',
            'envio_estado', 'enviada_en', 'envio_error',
            'cancelada_en', 'cancelada_motivo', 'sustituye_a',
            'subida_en', 'subida_por_nombre',
        ]

    def get_subida_por_nombre(self, obj):
        u = obj.subida_por
        return (u.get_full_name() or u.username) if u else ''
```

Y en `SolicitudFacturaSerializer`, agrega el campo y súmalo a `fields`:

```python
    facturas = FacturaSerializer(many=True, read_only=True)
```

- [ ] **Paso 4 — La vista.** Agrega a `apps/facturacion/views.py`:

```python
@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def subir_factura(request, pk: int):
    """Recibe el XML timbrado en la app externa y lo liga a su solicitud.

    Todo o nada: o queda la factura completa con la solicitud marcada, o no
    queda nada. Una solicitud a medio marcar sería peor que no haber subido.
    """
    from django.db import transaction
    from maquinaria.models import ConfiguracionSitio
    from .cfdi import CFDIInvalido, leer_cfdi
    from .models import Factura
    from .serializers import FacturaSerializer
    from .validacion import DescuadreCFDI, revisar_cfdi

    try:
        sol = SolicitudFactura.objects.get(pk=pk)
    except SolicitudFactura.DoesNotExist:
        return Response({'detalle': 'Solicitud no encontrada'}, status=404)

    archivo = request.FILES.get('xml')
    if not archivo:
        return Response({'detalle': 'Adjunta el archivo XML del CFDI.'}, status=400)
    if archivo.size > 2 * 1024 * 1024:
        return Response({'detalle': 'Ese archivo es demasiado grande para ser un CFDI.'}, status=400)

    texto = archivo.read().decode('utf-8', errors='replace')
    try:
        datos = leer_cfdi(texto)
    except CFDIInvalido as e:
        return Response({'detalle': str(e)}, status=400)

    cfg = ConfiguracionSitio.objects.first()
    try:
        avisos = revisar_cfdi(datos, sol, rfc_negocio=(cfg.negocio_rfc if cfg else ''))
    except DescuadreCFDI as e:
        return Response({'detalle': str(e)}, status=400)

    campos = {k: v for k, v in datos.items() if k not in ('conceptos', 'version')}
    with transaction.atomic():
        factura = Factura.objects.create(
            solicitud=sol, xml=texto, subida_por=request.user, **campos
        )
        sol.estado = 'facturada'
        sol.uuid = factura.uuid
        sol.fecha_timbrado = timezone.now()
        sol.save(update_fields=['estado', 'uuid', 'fecha_timbrado', 'actualizada'])

    return Response(
        {'detalle': 'Factura registrada', 'avisos': avisos,
         'factura': FacturaSerializer(factura).data},
        status=201,
    )
```

- [ ] **Paso 5 — La ruta.** En `apps/facturacion/urls.py`, antes del cierre:

```python
    path('facturacion/solicitudes/<int:pk>/factura/', views.subir_factura),
```

- [ ] **Paso 6 — Correr y ver pasar.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py test facturacion -v 2
```

Se esperan las 15 de las tareas 1 a 4 en verde.

- [ ] **Paso 7 — Commit.**

```bash
git add backend/apps/facturacion/ && git commit -m "Facturas: subir el XML timbrado y ligarlo a su solicitud"
```

---

### Tarea 5 · Descargar el XML, y solo quien puede

**Archivos:** modifica `apps/facturacion/views.py` y `urls.py`; agrega pruebas a
`tests_ciclo.py`.

- [ ] **Paso 1 — Prueba que falla.** Agrega a `tests_ciclo.py`:

```python
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from facturacion.tests_cfdi import cfdi_xml
from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


class DescargarXMLTest(TestCase):

    def setUp(self):
        U = get_user_model()
        self.admin = U.objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.comprador = U.objects.create_user('jazmin', 'j@x.com', 'pass12345')
        self.ajeno = U.objects.create_user('otro', 'o@x.com', 'pass12345')
        equipo = Equipo.objects.create(modelo='REV-1', precio_venta=Decimal('2000'))
        unidad = Inventario.objects.create(equipo=equipo, condicion='nueva')
        venta = Venta.objects.create(
            nombre_cliente='Jazmín', inventario=unidad,
            precio_maquina=Decimal('2000'), cliente_usuario=self.comprador,
        )
        self.xml = cfdi_xml()
        self.factura = Factura.objects.create(
            solicitud=solicitud(venta=venta), xml=self.xml,
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', total=Decimal('2000.00'),
        )
        self.client = APIClient()

    def _bajar(self, quien):
        self.client.force_authenticate(quien)
        return self.client.get(f'/api/facturacion/facturas/{self.factura.id}/xml/')

    def test_el_comprador_baja_su_xml_intacto(self):
        r = self._bajar(self.comprador)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.content.decode(), self.xml)

    def test_administracion_tambien(self):
        self.assertEqual(self._bajar(self.admin).status_code, 200)

    def test_otro_cliente_no_puede(self):
        """La prueba más importante: son los datos fiscales de una empresa."""
        self.assertEqual(self._bajar(self.ajeno).status_code, 404)

    def test_sin_sesion_tampoco(self):
        r = self.client.get(f'/api/facturacion/facturas/{self.factura.id}/xml/')
        self.assertIn(r.status_code, (401, 403))
```

- [ ] **Paso 2 — Correr y ver el fallo.** Ruta inexistente, 404 en las cuatro.

- [ ] **Paso 3 — La vista.** Agrega a `views.py`:

```python
def _factura_visible(user, pk):
    """La factura si este usuario puede verla; None si no.

    Se devuelve 404 y no 403 cuando no le toca: un 403 confirmaría que esa
    factura existe, y el id es un número consecutivo que cualquiera puede probar.
    """
    from maquinaria.permissions import nivel_de, NIVEL_ADMIN
    from .models import Factura

    f = (Factura.objects
         .select_related('solicitud__venta', 'solicitud__renta')
         .filter(pk=pk)
         .first())
    if f is None:
        return None
    if nivel_de(user) >= NIVEL_ADMIN:
        return f
    venta = f.solicitud.venta
    renta = f.solicitud.renta
    dueno = (venta.cliente_usuario_id if venta else None) or (renta.usuario_id if renta else None)
    return f if (dueno and dueno == user.id) else None


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def descargar_xml(request, pk: int):
    from django.http import HttpResponse

    f = _factura_visible(request.user, pk)
    if f is None:
        return Response({'detalle': 'Factura no encontrada'}, status=404)
    nombre = f'{f.serie}{f.folio}-{f.uuid[:8]}.xml' if (f.serie or f.folio) else f'{f.uuid}.xml'
    resp = HttpResponse(f.xml, content_type='application/xml; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="{nombre}"'
    return resp
```

Agrega arriba del archivo, si no está: `from rest_framework import permissions`.

- [ ] **Paso 4 — La ruta.**

```python
    path('facturacion/facturas/<int:pk>/xml/', views.descargar_xml),
```

- [ ] **Paso 5 — Correr y ver pasar.** Cuatro en verde.

- [ ] **Paso 6 — Commit.**

```bash
git add backend/apps/facturacion/ && git commit -m "Facturas: bajar el XML, y solo su dueño o administración"
```

---

### Tarea 6 · Cancelar y refacturar

**Archivos:** modifica `views.py` y `urls.py`; agrega pruebas a `tests_ciclo.py`.

- [ ] **Paso 1 — Prueba que falla.** Agrega a `tests_ciclo.py`:

```python
class CancelarYRefacturarTest(TestCase):

    def setUp(self):
        self.admin = get_user_model().objects.create_superuser('duena', 'd@x.com', 'pass12345')
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.sol = solicitud(estado='facturada', uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')
        self.factura = Factura.objects.create(
            solicitud=self.sol, xml='<x/>',
            uuid='A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', total=Decimal('2000.00'),
        )

    def _cancelar(self, motivo='Datos fiscales equivocados'):
        return self.client.post(
            f'/api/facturacion/facturas/{self.factura.id}/cancelar/',
            {'motivo': motivo}, format='json',
        )

    def test_cancelar_regresa_la_solicitud_a_pendiente(self):
        """Si no, la cancelación se vuelve una factura que nadie reemitió."""
        self.assertEqual(self._cancelar().status_code, 200)
        self.factura.refresh_from_db()
        self.sol.refresh_from_db()
        self.assertEqual(self.factura.estado, 'cancelada')
        self.assertEqual(self.sol.estado, 'pendiente')
        self.assertEqual(self.sol.uuid, '')

    def test_la_cancelada_se_conserva(self):
        self._cancelar()
        self.assertEqual(Factura.objects.count(), 1)
        self.assertEqual(self.factura.solicitud.facturas.count(), 1)

    def test_exige_motivo(self):
        self.assertEqual(self._cancelar(motivo='').status_code, 400)

    def test_no_se_cancela_dos_veces(self):
        self._cancelar()
        self.assertEqual(self._cancelar().status_code, 409)
```

- [ ] **Paso 2 — Correr y ver el fallo.** Ruta inexistente.

- [ ] **Paso 3 — La vista.**

```python
@api_view(['POST'])
@permission_classes([IsAdminGroupOrStaff])
def cancelar_factura(request, pk: int):
    """Registra que el CFDI se canceló ANTE EL SAT. REMALI no cancela nada allá.

    La solicitud regresa a pendiente y reaparece en Por facturar: una factura
    cancelada que deja la solicitud en "facturada" es dinero facturado que nadie
    volvió a emitir, y nadie se entera porque ya no se ve en ningún lado.
    """
    from django.db import transaction
    from .models import Factura
    from .serializers import FacturaSerializer

    f = Factura.objects.select_related('solicitud').filter(pk=pk).first()
    if f is None:
        return Response({'detalle': 'Factura no encontrada'}, status=404)
    if f.estado == 'cancelada':
        return Response({'detalle': 'Esta factura ya está cancelada.'}, status=409)
    motivo = (request.data.get('motivo') or '').strip()
    if not motivo:
        return Response(
            {'detalle': 'Escribe por qué se canceló: queda en el rastro de la factura.'},
            status=400,
        )

    with transaction.atomic():
        f.estado = 'cancelada'
        f.cancelada_en = timezone.now()
        f.cancelada_motivo = motivo[:255]
        f.save(update_fields=['estado', 'cancelada_en', 'cancelada_motivo'])

        sol = f.solicitud
        vigente = sol.facturas.filter(estado='vigente').first()
        sol.uuid = vigente.uuid if vigente else ''
        sol.fecha_timbrado = vigente.subida_en if vigente else None
        sol.estado = 'facturada' if vigente else 'pendiente'
        sol.save(update_fields=['uuid', 'fecha_timbrado', 'estado', 'actualizada'])

    return Response({'detalle': 'Factura marcada como cancelada',
                     'factura': FacturaSerializer(f).data})
```

- [ ] **Paso 4 — La ruta.**

```python
    path('facturacion/facturas/<int:pk>/cancelar/', views.cancelar_factura),
```

- [ ] **Paso 5 — Prueba de la refacturación.** Agrega a la misma clase:

```python
    def test_refacturar_deja_las_dos_ligadas(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from facturacion.tests_cfdi import cfdi_xml
        from maquinaria.models import ConfiguracionSitio

        cfg = ConfiguracionSitio.objects.first() or ConfiguracionSitio.objects.create()
        cfg.negocio_rfc = 'REM010101AAA'
        cfg.save()
        self._cancelar()

        nuevo = cfdi_xml(folio='124').replace(
            'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
            'F9E8D7C6-B5A4-4321-9876-543210FEDCBA',
        )
        r = self.client.post(
            f'/api/facturacion/solicitudes/{self.sol.id}/factura/',
            {'xml': SimpleUploadedFile('n.xml', nuevo.encode(), 'text/xml')},
            format='multipart',
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.sol.refresh_from_db()
        self.assertEqual(self.sol.facturas.count(), 2)
        self.assertEqual(self.sol.facturas.filter(estado='vigente').count(), 1)
        self.assertEqual(self.sol.estado, 'facturada')
```

`sustituye_a` se llena en la fase 2, cuando la interfaz pueda elegir a cuál
sustituye. Por ahora las dos quedan ligadas a la misma solicitud, que es lo que
la ley pide conservar.

- [ ] **Paso 6 — Correr toda la app.**

```bash
cd /Users/ramses/Developer/Remali/backend && ../env/bin/python manage.py test facturacion -v 2
```

- [ ] **Paso 7 — Commit.**

```bash
git add backend/apps/facturacion/ && git commit -m "Facturas: cancelar regresa la solicitud a la bandeja"
```

---

### Tarea 7 · El panel

**Archivos:** modifica la sección Por facturar del panel.

- [ ] **Paso 1 — Localizar la sección.**

```bash
cd /Users/ramses/Developer/Remali/frontend/src && grep -rn "facturacion/solicitudes\|Por facturar" routes/ | head
```

- [ ] **Paso 2 — Tipo.** Donde viva el tipo `SolicitudFactura` del front, agrega:

```ts
export type FacturaCFDI = {
  id: number; uuid: string; serie: string; folio: string
  estado: 'vigente' | 'cancelada'
  total: string; moneda: string
  fecha_emision: string; fecha_certificacion: string
  envio_estado: 'pendiente' | 'enviada' | 'fallo'
  enviada_en: string | null; envio_error: string
  cancelada_en: string | null; cancelada_motivo: string
  subida_en: string; subida_por_nombre: string
}
```

Y en el tipo de la solicitud: `facturas?: FacturaCFDI[]`.

- [ ] **Paso 3 — Subir.** En cada renglón pendiente, un input de archivo:

```tsx
async function subirXML(solicitudId: number, archivo: File) {
  const fd = new FormData()
  fd.append('xml', archivo)
  try {
    const r = await api.post(`/facturacion/solicitudes/${solicitudId}/factura/`, fd,
      { headers: { 'Content-Type': 'multipart/form-data' } })
    notify(r.data?.detalle || 'Factura registrada', 'ok')
    // Un aviso no impidió subir, pero hay que decirlo: si no, el usuario cree
    // que se verificó algo que no se verificó.
    for (const a of (r.data?.avisos || [])) notify(a, 'warning')
    recargar()
  } catch (err: any) {
    // El backend explica QUÉ no cuadró; ese mensaje es lo único útil aquí.
    notify(err?.response?.data?.detalle || 'No se pudo registrar la factura', 'err')
  }
}
```

- [ ] **Paso 4 — Bajar.** Reutiliza `descargarBlob` de `lib/descargar`:

```tsx
async function bajarXML(f: FacturaCFDI) {
  try {
    const r = await api.get(`/facturacion/facturas/${f.id}/xml/`, { responseType: 'blob' })
    descargarBlob(r.data as Blob, `${f.serie}${f.folio || f.uuid.slice(0, 8)}.xml`)
  } catch { notify('No se pudo descargar el XML', 'err') }
}
```

- [ ] **Paso 5 — Cancelar.** Pide el motivo con `pedir` de `components/Dialogo`
  y manda `POST /facturacion/facturas/<id>/cancelar/` con `{ motivo }`. Sin
  motivo, no se manda.

- [ ] **Paso 6 — Compilar.**

```bash
cd /Users/ramses/Developer/Remali/frontend && npm run build
```

- [ ] **Paso 7 — Probarlo con la app corriendo.** Sube un XML de verdad de tu
  PAC contra una solicitud real. Revisa la consola del navegador y el log de
  Django: cero tracebacks. Baja el XML y ábrelo: tiene que ser idéntico al que
  subiste.

- [ ] **Paso 8 — Commit.**

```bash
git add frontend/src && git commit -m "Panel: subir, bajar y cancelar la factura desde Por facturar"
```

---

## Cierre de la fase

- [ ] `../env/bin/python manage.py test` completo en verde.
- [ ] `npm run build` sin errores.
- [ ] `manage.py makemigrations --check --dry-run` sin migraciones pendientes.
- [ ] Marcar el spec como implementado en su encabezado.

Al terminar, el XML ya está dentro del sistema y dentro de los respaldos. La
fase 2 (PDF con marca, correo automático y Mis facturas) tiene su propio plan y
se apoya en el lector y el modelo que quedaron aquí.
