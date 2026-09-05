"""Pedir factura sin tener datos fiscales: se avisa, no se bloquea.

Seis campos del SAT en medio de una cotización es donde la gente abandona. Así
que el cliente la envía igual y administración lo ve marcado ANTES de ponerse a
timbrar, no al final con el cliente esperando.
"""
from django.contrib.auth.models import User
from django.test import TestCase

from cotizaciones.models import Cotizacion
from cotizaciones.serializers import CotizacionSerializer
from maquinaria.models import PerfilUsuario


class FaltanDatosFiscales(TestCase):
    def setUp(self):
        self.u = User.objects.create_user('josue', email='josue@correo.com', first_name='Josue')
        self.perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.u)

    def _cot(self, **kw):
        datos = dict(cliente_nombre='Josue', cliente_telefono='7441772370',
                     usuario=self.u, aplica_iva=True)
        datos.update(kw)
        return Cotizacion.objects.create(**datos)

    def _falta(self, cot):
        # Se relee de la base: `update()` no toca el objeto en memoria y su
        # relación `perfil` se queda cacheada con los datos viejos. En un request
        # real esto no pasa —el usuario llega fresco—, pero en la prueba sí.
        fresca = Cotizacion.objects.get(pk=cot.pk)
        return CotizacionSerializer(fresca).data['faltan_datos_fiscales']

    def test_pidio_factura_y_no_tiene_datos(self):
        self.assertTrue(self._falta(self._cot()))

    def test_con_sus_datos_completos_ya_no_falta(self):
        PerfilUsuario.objects.filter(pk=self.perfil.pk).update(
            fiscal_rfc='ROVJ900101AB1', fiscal_regimen='612', fiscal_cp='39300')
        self.assertFalse(self._falta(self._cot()))

    def test_con_el_RFC_a_secas_sigue_faltando(self):
        """El SAT pide más que el RFC: sin régimen ni CP no se timbra."""
        PerfilUsuario.objects.filter(pk=self.perfil.pk).update(fiscal_rfc='ROVJ900101AB1')
        self.assertTrue(self._falta(self._cot()))

    def test_si_no_pidio_factura_no_falta_nada(self):
        self.assertFalse(self._falta(self._cot(aplica_iva=False)))

    def test_una_cotizacion_sin_cuenta_no_se_marca(self):
        """Al invitado se le piden al confirmar, junto con todo lo demás."""
        cot = Cotizacion.objects.create(cliente_nombre='De mostrador',
                                        cliente_telefono='7449998877', aplica_iva=True)
        self.assertFalse(self._falta(cot))

    def test_se_calcula_en_vivo_contra_el_perfil(self):
        """Si los llena DESPUÉS de cotizar, deja de faltar solo."""
        cot = self._cot()
        self.assertTrue(self._falta(cot))
        PerfilUsuario.objects.filter(pk=self.perfil.pk).update(
            fiscal_rfc='ROVJ900101AB1', fiscal_regimen='612', fiscal_cp='39300')
        cot.refresh_from_db()
        self.assertFalse(self._falta(cot))
