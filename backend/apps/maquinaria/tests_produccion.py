"""Lo que sostiene el despliegue: caché por petición, CSP y revisión de despegue.

Son piezas de infraestructura: cuando fallan no se rompe una pantalla, se rompe
todo a la vez y de formas difíciles de leer (permisos rancios, página en blanco
por CSP). Por eso llevan prueba propia.
"""
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings

from server.porpeticion import olvidar, por_peticion


class CachePorPeticionTest(TestCase):
    """La caché tiene que durar exactamente una petición: ni menos, ni más."""

    def test_fuera_de_una_peticion_no_cachea(self):
        """En un comando o en el shell se calcula siempre: son procesos largos."""
        llamadas = []
        for _ in range(3):
            por_peticion('x', lambda: llamadas.append(1))
        self.assertEqual(len(llamadas), 3)

    def test_dentro_de_una_peticion_calcula_una_sola_vez(self):
        llamadas = []

        def contar():
            llamadas.append(1)
            return 'valor'

        from server.porpeticion import CachePorPeticion

        def vista(_req):
            for _ in range(5):
                self.assertEqual(por_peticion('k', contar), 'valor')
            return 'respuesta'

        medio = CachePorPeticion(vista)
        self.assertEqual(medio(None), 'respuesta')
        self.assertEqual(len(llamadas), 1)

    def test_la_siguiente_peticion_empieza_limpia(self):
        """Lo contrario sería el bug que se quiso evitar: un valor rancio
        sobreviviendo entre peticiones y repartiendo permisos viejos."""
        from server.porpeticion import CachePorPeticion
        llamadas = []

        def vista(_req):
            por_peticion('k', lambda: llamadas.append(1))
            return 'ok'

        medio = CachePorPeticion(vista)
        medio(None)
        medio(None)
        self.assertEqual(len(llamadas), 2)

    def test_olvidar_tira_la_entrada_de_la_peticion_en_curso(self):
        from server.porpeticion import CachePorPeticion
        vistos = []

        def vista(_req):
            por_peticion('k', lambda: 'primero')
            olvidar('k')
            vistos.append(por_peticion('k', lambda: 'segundo'))
            return 'ok'

        CachePorPeticion(vista)(None)
        self.assertEqual(vistos, ['segundo'])

    def test_los_roles_se_consultan_una_vez_por_peticion(self):
        """La razón de existir de todo esto: /usuarios/ hacía 22 consultas a
        `rol`, una por cuenta de la lista."""
        U = get_user_model()
        duena = U.objects.create_superuser('duena_prod', 'd@x.com', 'pass12345')
        for i in range(6):
            U.objects.create_user(f'empleado{i}', f'e{i}@x.com', 'pass12345')
        # El proyecto es JWT, no sesión: force_login no autenticaría la vista DRF.
        from rest_framework.test import APIClient
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        c = APIClient()
        c.force_authenticate(duena)
        with CaptureQueriesContext(connection) as consultas:
            r = c.get('/api/usuarios/')
        self.assertEqual(r.status_code, 200, r.content[:200])
        de_rol = [q for q in consultas.captured_queries if '`rol`' in q['sql'] or ' rol ' in q['sql']]
        self.assertLessEqual(len(de_rol), 1, f'la tabla rol se consultó {len(de_rol)} veces')


class ContentSecurityPolicyTest(TestCase):

    def test_por_defecto_solo_reporta(self):
        """Estrenar un CSP bloqueando deja la página en blanco: primero se mira."""
        r = Client().get('/api/config/publica/')
        self.assertIn('Content-Security-Policy-Report-Only', r)
        self.assertNotIn('Content-Security-Policy', r)

    def test_la_politica_prohibe_lo_esencial(self):
        r = Client().get('/api/config/publica/')
        politica = r['Content-Security-Policy-Report-Only']
        self.assertIn("object-src 'none'", politica)
        self.assertIn("frame-ancestors 'none'", politica)
        self.assertIn("base-uri 'self'", politica)

    def test_el_admin_queda_fuera(self):
        """Trae scripts en línea propios; imponerle la política solo lo rompe.

        Se prueba el middleware directo y no con una petición real a /admin/:
        renderizar el admin en pruebas depende del manifiesto de estáticos, que
        aquí no está construido, y eso haría fallar la prueba por algo ajeno."""
        from django.http import HttpResponse
        from server.csp import ContentSecurityPolicyMiddleware

        medio = ContentSecurityPolicyMiddleware(lambda _req: HttpResponse('x'))

        class Peticion:
            path = '/admin/login/'

        self.assertNotIn('Content-Security-Policy-Report-Only', medio(Peticion()))

        class Publica:
            path = '/api/config/publica/'

        self.assertIn('Content-Security-Policy-Report-Only', medio(Publica()))

    def test_en_produccion_el_script_del_tema_va_por_hash(self):
        """Sin esto haría falta 'unsafe-inline', que es media razón de ser del CSP."""
        from django.test import override_settings as _os
        with _os(DEBUG=False):
            from server import csp
            politica = csp._armar_politica()
        self.assertIn("script-src", politica)
        self.assertNotIn("script-src 'self' https://accounts.google.com 'unsafe-inline'", politica)
        self.assertIn('upgrade-insecure-requests', politica)


class RevisarProduccionTest(TestCase):

    def _correr(self, **entorno):
        from io import StringIO
        from django.core.management import call_command
        salida = StringIO()
        try:
            call_command('revisar_produccion', stdout=salida)
            codigo = 0
        except SystemExit as e:
            codigo = e.code
        return codigo, salida.getvalue()

    def test_avisa_de_las_cuentas_de_prueba(self):
        U = get_user_model()
        U.objects.create_user('admin_prueba', 'a@x.com', 'remali-admin-2026')
        _, texto = self._correr()
        self.assertIn('admin_prueba', texto)
        self.assertIn('BLOQUEA', texto)

    def test_no_imprime_el_valor_de_ningun_secreto(self):
        """Está pensado para pegarse en un chat sin filtrar nada."""
        from django.conf import settings
        _, texto = self._correr()
        self.assertNotIn(settings.SECRET_KEY, texto)
        self.assertNotIn(settings.DATABASES['default'].get('PASSWORD') or '\x00', texto)

    @override_settings(DEBUG=True)
    def test_debug_encendido_bloquea(self):
        codigo, texto = self._correr()
        self.assertEqual(codigo, 1)
        self.assertIn('DEBUG', texto)
