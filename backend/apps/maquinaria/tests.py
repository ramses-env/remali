from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from maquinaria.models import Categoria, Equipo, PerfilUsuario
from maquinaria.otp import MAX_INTENTOS, VIGENCIA, emitir, generar_codigo
from maquinaria.views import EquipoRelacionados
from inventario.models import Inventario


class EquipoPrecioTest(TestCase):
    def setUp(self):
        self.equipo = Equipo.objects.create(
            modelo='CMP-50',
            precio_dia=Decimal('100'),
            precio_semana=Decimal('600'),
            precio_mes=Decimal('2000'),
        )

    def test_get_precio_por_unidad(self):
        self.assertEqual(self.equipo.get_precio_por_unidad('dia'), Decimal('100'))
        self.assertEqual(self.equipo.get_precio_por_unidad('semana'), Decimal('600'))
        self.assertEqual(self.equipo.get_precio_por_unidad('mes'), Decimal('2000'))
        self.assertIsNone(self.equipo.get_precio_por_unidad('inexistente'))

    def test_estado_resumen_sin_unidades(self):
        self.assertEqual(self.equipo.estado_resumen, 'Sin stock')


class EquipoCatalogoInventarioTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.mixto = Equipo.objects.create(
            modelo='APS-200',
            precio_venta=Decimal('24500'),
            precio_dia=Decimal('850'),
        )
        Inventario.objects.create(equipo=self.mixto, condicion='nueva', estado='disponible')
        Inventario.objects.create(equipo=self.mixto, condicion='seminueva', estado='disponible')

        self.solo_renta = Equipo.objects.create(
            modelo='ROD-90',
            precio_dia=Decimal('650'),
        )
        Inventario.objects.create(equipo=self.solo_renta, condicion='seminueva', estado='disponible')

    def test_helpers_de_catalogo_salen_del_inventario(self):
        self.assertEqual(self.mixto.condiciones_catalogo, ['nueva', 'seminueva'])
        self.assertEqual(self.mixto.modos_catalogo, ['venta', 'renta'])
        self.assertTrue(self.mixto.ofrece_venta_catalogo)
        self.assertTrue(self.mixto.ofrece_renta_catalogo)
        self.assertTrue(self.mixto.venta_disponible_catalogo)
        self.assertTrue(self.mixto.renta_disponible_catalogo)

    def test_filtro_publico_venta_sale_por_precio_de_venta(self):
        resp = self.client.get('/api/equipos/?uso=venta')
        self.assertEqual(resp.status_code, 200, resp.data)
        modelos = {item['modelo'] for item in resp.data}
        self.assertIn('APS-200', modelos)
        self.assertNotIn('ROD-90', modelos)

    def test_filtro_publico_renta_exige_tarifa_y_unidad_seminueva(self):
        resp = self.client.get('/api/equipos/?uso=renta')
        self.assertEqual(resp.status_code, 200, resp.data)
        modelos = {item['modelo'] for item in resp.data}
        self.assertIn('APS-200', modelos)
        self.assertIn('ROD-90', modelos)


class RespuestaComprimidaTest(TestCase):
    """La API tiene que viajar comprimida.

    Se prueba porque es invisible: el cliente de pruebas de Django NO manda
    `Accept-Encoding` por su cuenta, así que sin esto el middleware podría
    caerse de la lista en un merge y las 464 pruebas seguirían en verde
    mientras el catálogo vuelve a viajar en claro.
    """

    def setUp(self):
        self.client = APIClient()
        # Un catálogo con cuerpo: por debajo de 200 bytes Django ni lo intenta,
        # y con razón —comprimir algo diminuto lo deja más grande—.
        for i in range(40):
            Equipo.objects.create(
                modelo=f'MOD-{i:03d}',
                descripcion='Compactador de placa reversible para obra civil.',
                precio_dia=Decimal('500'),
            )

    def test_el_catalogo_viaja_comprimido(self):
        resp = self.client.get('/api/equipos/', headers={'accept-encoding': 'gzip, deflate'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers.get('Content-Encoding'), 'gzip')

    def test_sin_pedirlo_viaja_en_claro(self):
        # Un cliente que no dice que sabe descomprimir no debe recibir gzip.
        resp = self.client.get('/api/equipos/', headers={'accept-encoding': ''})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.headers.get('Content-Encoding'))
        # Y se sigue pudiendo leer, que es lo que importa.
        self.assertEqual(len(resp.json()), 40)


class EquipoRelacionadosTest(TestCase):
    """`/api/equipos/<id>/relacionados/` — la tira de "también te puede servir".

    Existe para que la ficha NO se baje el catálogo entero por cuatro tarjetas,
    así que lo que se prueba es justo eso: que recorte, que priorice la misma
    categoría y que nunca se incluya a sí mismo.
    """

    def setUp(self):
        self.client = APIClient()
        self.compactadores = Categoria.objects.create(nombre='Compactadores')
        self.martillos = Categoria.objects.create(nombre='Martillos')

        self.actual = Equipo.objects.create(
            modelo='CMP-01', categoria=self.compactadores, precio_dia=Decimal('500'))
        # Dos de la misma categoría y dos de otra: alcanza para ver el orden.
        self.hermano_a = Equipo.objects.create(
            modelo='CMP-02', categoria=self.compactadores, precio_dia=Decimal('520'))
        self.hermano_b = Equipo.objects.create(
            modelo='CMP-03', categoria=self.compactadores, precio_dia=Decimal('540'))
        self.ajeno_a = Equipo.objects.create(
            modelo='MAR-01', categoria=self.martillos, precio_dia=Decimal('300'))
        self.ajeno_b = Equipo.objects.create(
            modelo='MAR-02', categoria=self.martillos, precio_dia=Decimal('320'))

    def _modelos(self, resp):
        return [x['modelo'] for x in resp.data]

    def test_es_publico_y_no_se_incluye_a_si_mismo(self):
        # Sin sesión: es la tienda, la abre cualquiera.
        resp = self.client.get(f'/api/equipos/{self.actual.pk}/relacionados/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertNotIn('CMP-01', self._modelos(resp))

    def test_misma_categoria_primero(self):
        resp = self.client.get(f'/api/equipos/{self.actual.pk}/relacionados/?limit=4')
        modelos = self._modelos(resp)
        self.assertEqual(len(modelos), 4)
        # Los dos primeros son compactadores; los de martillos van detrás.
        self.assertEqual(set(modelos[:2]), {'CMP-02', 'CMP-03'})
        self.assertEqual(set(modelos[2:]), {'MAR-01', 'MAR-02'})

    def test_rellena_con_el_resto_cuando_la_categoria_no_alcanza(self):
        # Un martillo solo tiene UN hermano de categoría; el resto se rellena.
        resp = self.client.get(f'/api/equipos/{self.ajeno_a.pk}/relacionados/?limit=3')
        modelos = self._modelos(resp)
        self.assertEqual(modelos[0], 'MAR-02')
        self.assertEqual(len(modelos), 3)

    def test_el_limite_se_respeta_y_tiene_techo(self):
        uno = self.client.get(f'/api/equipos/{self.actual.pk}/relacionados/?limit=1')
        self.assertEqual(len(uno.data), 1)
        # Un `limit` absurdo no puede convertir esto en "bájate el catálogo".
        enorme = self.client.get(f'/api/equipos/{self.actual.pk}/relacionados/?limit=9999')
        self.assertLessEqual(len(enorme.data), EquipoRelacionados.LIMITE_MAX)
        # Y una basura tampoco lo tumba.
        basura = self.client.get(f'/api/equipos/{self.actual.pk}/relacionados/?limit=abc')
        self.assertEqual(basura.status_code, 200)
        self.assertEqual(len(basura.data), 4)

    def test_equipo_sin_categoria_no_truena(self):
        huerfano = Equipo.objects.create(modelo='SIN-CAT', precio_dia=Decimal('100'))
        resp = self.client.get(f'/api/equipos/{huerfano.pk}/relacionados/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertNotIn('SIN-CAT', self._modelos(resp))

    def test_equipo_inexistente_da_404(self):
        resp = self.client.get('/api/equipos/999999/relacionados/')
        self.assertEqual(resp.status_code, 404)

    def test_no_dispara_una_consulta_por_equipo(self):
        """La razón de ser del endpoint: un número FIJO de consultas.

        Si alguien agrega un campo al serializer que toque la base por objeto,
        esto lo caza antes de que llegue a producción como "la ficha va lenta".
        """
        with self.assertNumQueries(4):   # equipo + lista + unidades + imágenes
            self.client.get(f'/api/equipos/{self.actual.pk}/relacionados/?limit=4')


class VerificarCorreoTest(TestCase):
    """El CÓDIGO del correo confirma la cuenta Y abre sesión.

    Sustituyó a la liga: una liga la abren solos los escáneres de correo
    (SafeLinks, antivirus) y quemaban el token antes que el usuario.

    Se prueba con cuidado porque es la única puerta del sistema que no pide
    contraseña, y ahora la llave son seis dígitos —un millón de combinaciones,
    que a mano no es nada—. Lo que la sostiene son tres cosas juntas, y hay una
    prueba por cada una: ventana corta, intentos limitados, y comprobación POR
    CUENTA (con el correo), nunca buscando el código en toda la tabla.
    """

    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            username='cliente', email='cliente@ejemplo.com', password='Contra5egura!',
            first_name='Ramsés',
        )
        self.perfil, _ = PerfilUsuario.objects.get_or_create(usuario=self.user)
        self.codigo = emitir(self.perfil)
        self.perfil.save()

    def _verificar(self, codigo, correo='cliente@ejemplo.com'):
        return self.client.post('/api/auth/verificar-correo/',
                                {'correo': correo, 'codigo': codigo}, format='json')

    def test_el_codigo_correcto_verifica_y_abre_sesion(self):
        resp = self._verificar(self.codigo)
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertTrue(resp.data.get('access'))
        self.assertEqual(resp.data.get('nombre'), 'Ramsés')
        self.perfil.refresh_from_db()
        self.assertTrue(self.perfil.email_verificado)

    def test_el_codigo_es_de_un_solo_uso(self):
        self._verificar(self.codigo)
        resp = self._verificar(self.codigo)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'ya_verificado')

    def test_nunca_se_guarda_en_claro(self):
        """Un respaldo de la base o un log no puede entregar códigos vivos."""
        self.perfil.refresh_from_db()
        self.assertNotEqual(self.perfil.email_otp, self.codigo)
        self.assertNotIn(self.codigo, self.perfil.email_otp)
        self.assertTrue(self.perfil.email_otp.startswith(('pbkdf2', 'argon2', 'bcrypt')))

    def test_el_codigo_vencido_no_abre_sesion(self):
        self.perfil.email_otp_creado = timezone.now() - (VIGENCIA + timedelta(minutes=1))
        self.perfil.save(update_fields=['email_otp_creado'])
        resp = self._verificar(self.codigo)
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'vencido')
        self.perfil.refresh_from_db()
        self.assertFalse(self.perfil.email_verificado)

    def test_un_codigo_malo_cuenta_intento_y_avisa_cuantos_quedan(self):
        resp = self._verificar('000000' if self.codigo != '000000' else '111111')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'incorrecto')
        self.assertIn('intento', resp.data['detail'])
        self.perfil.refresh_from_db()
        self.assertEqual(self.perfil.email_otp_intentos, 1)

    def test_a_los_cinco_intentos_se_bloquea(self):
        """Seis dígitos sin freno se barren en minutos; el freno es lo que los sostiene."""
        malo = '000000' if self.codigo != '000000' else '111111'
        for _ in range(MAX_INTENTOS - 1):
            self._verificar(malo)
        resp = self._verificar(malo)
        self.assertEqual(resp.status_code, 429, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'bloqueado')
        # Y bloqueado ya no acepta ni el BUENO: si no, el bloqueo no bloquea.
        resp = self._verificar(self.codigo)
        self.assertEqual(resp.status_code, 429, resp.data)
        self.perfil.refresh_from_db()
        self.assertFalse(self.perfil.email_verificado)

    def test_un_dedazo_de_largo_no_gasta_intentos(self):
        """Teclear cinco dígitos es un error de dedo, no un ataque."""
        resp = self._verificar('123')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'formato')
        self.perfil.refresh_from_db()
        self.assertEqual(self.perfil.email_otp_intentos, 0)

    def test_el_codigo_de_uno_no_sirve_para_otro(self):
        User = get_user_model()
        otra = User.objects.create_user(username='otra', email='otra@ejemplo.com',
                                        password='Contra5egura!')
        perfil_otra, _ = PerfilUsuario.objects.get_or_create(usuario=otra)
        emitir(perfil_otra)
        perfil_otra.save()
        resp = self._verificar(self.codigo, correo='otra@ejemplo.com')
        self.assertEqual(resp.status_code, 400, resp.data)
        perfil_otra.refresh_from_db()
        self.assertFalse(perfil_otra.email_verificado)

    def test_un_correo_que_no_existe_responde_igual_que_uno_malo(self):
        """Distinguirlos convertiría esto en un detector de quién está registrado."""
        resp = self._verificar('123456', correo='nadie@ejemplo.com')
        self.assertEqual(resp.status_code, 400, resp.data)
        self.assertEqual(resp.data.get('codigo'), 'incorrecto')

    def test_pedir_otro_codigo_invalida_el_anterior(self):
        viejo = self.codigo
        nuevo = emitir(self.perfil)
        self.perfil.save()
        self.assertNotEqual(viejo, nuevo)
        self.assertEqual(self._verificar(viejo).status_code, 400)
        self.assertEqual(self._verificar(nuevo).status_code, 200)

    def test_pedir_otro_codigo_perdona_los_intentos(self):
        """Pedir uno nuevo es la salida de quien se equivocó, no un castigo."""
        malo = '000000' if self.codigo != '000000' else '111111'
        self._verificar(malo)
        self._verificar(malo)
        nuevo = emitir(self.perfil)
        self.perfil.save()
        self.perfil.refresh_from_db()
        self.assertEqual(self.perfil.email_otp_intentos, 0)
        self.assertEqual(self._verificar(nuevo).status_code, 200)

    def test_el_codigo_son_seis_digitos(self):
        for _ in range(50):
            c = generar_codigo()
            self.assertEqual(len(c), 6)
            self.assertTrue(c.isdigit())


class AvatarDelPerfilTest(TestCase):
    """El panel y la tienda enseñan la MISMA cara.

    `/auth/me/` (la tienda) siempre trajo el dibujo por rol; `/auth/perfil/`
    —de donde el panel saca al usuario— no, así que arriba a la derecha salía
    una inicial mientras la tienda enseñaba el avatar del puesto. La segunda
    capa viaja ahora en los dos.
    """

    def setUp(self):
        from django.contrib.auth.models import Group
        self.user = get_user_model().objects.create_user('avatar1', 'a1@x.com', 'pass12345')
        self.user.groups.add(Group.objects.get_or_create(name='Administrador')[0])
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_el_perfil_trae_el_dibujo_del_rol(self):
        r = self.api.get('/api/auth/perfil/')
        self.assertEqual(r.status_code, 200, r.data)
        # Sin foto subida `avatar_url` sigue en None a propósito: es como la
        # pantalla de perfil sabe que no hay nada que quitar.
        self.assertIsNone(r.data.get('avatar_url'))
        self.assertTrue(r.data.get('avatar_url_rol'), 'falta la segunda capa del avatar')

    def test_dice_lo_mismo_que_me(self):
        perfil = self.api.get('/api/auth/perfil/')
        yo = self.api.get('/api/auth/me/')
        self.assertEqual(perfil.data['avatar_url_rol'], yo.data['avatar_url_rol'])
