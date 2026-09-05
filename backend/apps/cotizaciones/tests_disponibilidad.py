"""El cliente puede cotizar lo que no hay, pero se le dice — y se le avisa.

Antes nadie revalidaba nada después de armar la cotización: si había unidad
cuando el cliente la agregó y se rentó al día siguiente, la cotización viajaba
con un equipo inexistente y él se enteraba cuando le llamaban.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone

from cotizaciones.models import Cotizacion, CotizacionItem
from cotizaciones.serializers import CotizacionItemSerializer
from inventario.models import Equipo, Inventario
from maquinaria.models import Notificacion
from renta.models import Renta


class UnidadesLibresPorPartida(TestCase):
    def setUp(self):
        self.eq = Equipo.objects.create(modelo='DEMOLEDOR', precio_dia=800)
        self.u1 = Inventario.objects.create(equipo=self.eq, codigo='DEM-01', estado='disponible')
        self.cot = Cotizacion.objects.create(cliente_nombre='Josue', cliente_telefono='7441772370')
        self.item = CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Demoledor · renta por día',
            modalidad='dia', cantidad=1, duracion=1, equipo=self.eq, precio_unitario=800)

    def _libres(self):
        return CotizacionItemSerializer(self.item).data['unidades_libres']

    def test_cuenta_las_unidades_libres(self):
        self.assertEqual(self._libres(), 1)

    def test_cuando_se_rentan_todas_reporta_cero(self):
        """El caso del mostrador: 'no tengo demoledor, están en renta'."""
        self.u1.estado = 'rentado'
        self.u1.save(update_fields=['estado'])
        self.assertEqual(self._libres(), 0)

    def test_una_partida_sin_equipo_del_catalogo_no_inventa_un_cero(self):
        """Texto libre: no hay nada que contar y '0' sería mentir."""
        suelta = CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Maniobra especial', modalidad='dia', cantidad=1)
        self.assertIsNone(CotizacionItemSerializer(suelta).data['unidades_libres'])


class AvisoAlLiberarse(TestCase):
    def setUp(self):
        self.cliente = User.objects.create_user('josue', first_name='Josue')
        self.eq = Equipo.objects.create(modelo='DEMOLEDOR', precio_dia=800)
        self.unidad = Inventario.objects.create(equipo=self.eq, codigo='DEM-01', estado='disponible')
        self.cot = Cotizacion.objects.create(
            cliente_nombre='Josue', cliente_telefono='7441772370',
            usuario=self.cliente, estado='enviada', folio='COT-2026-0003')
        CotizacionItem.objects.create(
            cotizacion=self.cot, descripcion='Demoledor · renta por día',
            modalidad='dia', cantidad=1, duracion=1, equipo=self.eq, precio_unitario=800)
        # La unidad sale a renta: la cotización se queda esperando.
        self.unidad.ocupar_por_renta('Obra')

    def _avisos(self):
        return Notificacion.objects.filter(ref=f'libre-{self.cot.id}-{self.eq.id}')

    def test_mientras_esta_rentada_no_hay_aviso(self):
        self.assertEqual(self._avisos().count(), 0)

    def test_al_liberarse_le_avisa_al_cliente(self):
        self.unidad.liberar()
        self.assertEqual(self._avisos().count(), 1)
        self.assertEqual(self._avisos().first().usuario, self.cliente)

    def test_tambien_al_salir_del_taller(self):
        """Va en `_set_estado`, no en `liberar()`: los otros caminos también cuentan."""
        self.unidad.estado = 'mantenimiento'
        self.unidad.save(update_fields=['estado'])
        self.unidad._set_estado('disponible', 'Bodega')
        self.assertEqual(self._avisos().count(), 1)

    def test_no_repite_el_aviso_si_se_renta_y_se_libera_otra_vez(self):
        """El segundo aviso ya no es información, es insistencia."""
        self.unidad.liberar()
        self.unidad.ocupar_por_renta('Obra')
        self.unidad.liberar()
        self.assertEqual(self._avisos().count(), 1)

    def test_una_cotizacion_rechazada_ya_no_espera_nada(self):
        self.cot.estado = 'rechazada'
        self.cot.save(update_fields=['estado'])
        self.unidad.liberar()
        self.assertEqual(self._avisos().count(), 0)

    def test_sin_cuenta_vinculada_no_hay_a_quien_avisar(self):
        self.cot.usuario = None
        self.cot.save(update_fields=['usuario'])
        self.unidad.liberar()
        self.assertEqual(self._avisos().count(), 0)
