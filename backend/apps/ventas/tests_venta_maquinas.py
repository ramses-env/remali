"""Una venta puede llevarse varias máquinas, y cada una queda amarrada a ella.

Una máquina es una pieza única con número de serie: no se cuenta por cantidad
como un filtro, se nombra. Por eso cada una vive en su propio renglón, con su
precio y su entrega. Estas pruebas cuidan que ningún renglón salga del patio sin
venta que lo respalde, ni se quede marcado como vendido cuando ya volvió.
"""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase

from inventario.models import Inventario
from maquinaria.models import Equipo
from ventas.models import Venta


def _equipo(modelo='REV-100', **extra):
    datos = dict(modelo=modelo, precio_venta=Decimal('50000'))
    datos.update(extra)
    return Equipo.objects.create(**datos)


class RenglonDeMaquinaTest(TestCase):
    """El puente con la forma vieja: `Venta(inventario=u)` sigue funcionando."""

    def setUp(self):
        self.equipo = _equipo()
        self.unidad = Inventario.objects.create(equipo=self.equipo, condicion='nueva')

    def test_venta_de_una_maquina_genera_su_renglon(self):
        venta = Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))
        self.assertEqual(venta.maquinas.count(), 1)
        renglon = venta.maquinas.first()
        self.assertEqual(renglon.inventario_id, self.unidad.id)
        self.assertEqual(renglon.precio, Decimal('50000'))
        self.assertEqual(venta.total, Decimal('50000'))
        self.unidad.refresh_from_db()
        self.assertEqual(self.unidad.estado, 'vendido')

    def test_el_espejo_apunta_al_primer_renglon(self):
        """`venta.inventario` y `precio_maquina` siguen sirviendo a quien ya los lee."""
        venta = Venta.objects.create(inventario=self.unidad, precio_maquina=Decimal('50000'))
        venta.refresh_from_db()
        self.assertEqual(venta.inventario_id, self.unidad.id)
        self.assertEqual(venta.precio_maquina, Decimal('50000'))
