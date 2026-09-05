"""El respaldo que el PROVEEDOR le da a REMALI en un sobre pedido.

No confundir con la garantía que REMALI le da al CLIENTE (`clientes.Garantia`),
que nace sola al vender. Ésta es la otra punta: si la máquina que nos surtieron
llega defectuosa, ¿a quién se le reclama y hasta cuándo? Los campos existían
desde hacía tiempo y nadie los llenaba, así que ese dato se perdía.
"""
from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from maquinaria.models import Equipo
from ventas.models import Venta


class GarantiaDelProveedorEnUnPedido(TestCase):
    def setUp(self):
        self.eq = Equipo.objects.create(modelo='RETRO-SP', precio_venta=180000,
                                        permite_sobre_pedido=True)
        admin = User.objects.create_user('op', password='x', is_staff=True, is_superuser=True)
        self.api = APIClient(); self.api.force_authenticate(admin)

    def _pedir(self, **extra):
        cuerpo = {'equipo_id': self.eq.id, 'precio': 180000, 'anticipo': 120000,
                  'nombre_cliente': 'Josue', 'telefono_cliente': '7441772370',
                  'metodo_pago': 'transferencia'}
        cuerpo.update(extra)
        return self.api.post('/api/ventas/pedidos/crear/', cuerpo, format='json')

    def test_se_guarda_lo_que_capturo_el_admin(self):
        r = self._pedir(garantia_proveedor_meses=12,
                        garantia_proveedor_nota='Factura A-4471, Maq. del Sur')
        self.assertIn(r.status_code, (200, 201), r.data)
        v = Venta.objects.latest('id')
        self.assertEqual(v.garantia_proveedor_meses, 12)
        self.assertIn('A-4471', v.garantia_proveedor_nota)

    def test_es_opcional(self):
        """El pedido no se frena por un dato que a veces no se tiene a la mano."""
        self.assertIn(self._pedir().status_code, (200, 201))
        self.assertEqual(Venta.objects.latest('id').garantia_proveedor_meses, 0)

    def test_un_dedazo_no_inventa_diez_anos_de_respaldo(self):
        """120 en vez de 12: se topa, no se guarda tal cual."""
        self._pedir(garantia_proveedor_meses=999)
        self.assertEqual(Venta.objects.latest('id').garantia_proveedor_meses, 120)

    def test_texto_basura_en_los_meses_no_tumba_el_pedido(self):
        r = self._pedir(garantia_proveedor_meses='doce')
        self.assertIn(r.status_code, (200, 201), r.data)
        self.assertEqual(Venta.objects.latest('id').garantia_proveedor_meses, 0)

    def test_sale_en_la_respuesta_para_poder_consultarlo(self):
        """Era el problema de fondo: se guardaba y no salía por ningún lado."""
        from ventas.views import _serialize_pedido
        self._pedir(garantia_proveedor_meses=6, garantia_proveedor_nota='Maq. del Sur')
        datos = _serialize_pedido(Venta.objects.latest('id'))
        self.assertEqual(datos['garantia_proveedor']['meses'], 6)
        self.assertEqual(datos['garantia_proveedor']['nota'], 'Maq. del Sur')

    def test_sin_garantia_no_se_enseña_un_cero(self):
        from ventas.views import _serialize_pedido
        self._pedir()
        self.assertIsNone(_serialize_pedido(Venta.objects.latest('id'))['garantia_proveedor'])

    def test_no_se_confunde_con_la_garantia_DEL_CLIENTE(self):
        """Son dos relaciones distintas con dos plazos distintos."""
        self._pedir(garantia_proveedor_meses=12)
        v = Venta.objects.latest('id')
        # La del cliente la emite REMALI sola; la del proveedor se capturó.
        self.assertEqual(v.garantia_proveedor_meses, 12)
        for g in v.garantias.all():
            self.assertNotEqual(g.meses, 12, 'la del cliente sale del catálogo, no del proveedor')
