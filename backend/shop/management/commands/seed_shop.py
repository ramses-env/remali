from django.core.management.base import BaseCommand
from shop.models import Equipo, Cupon

class Command(BaseCommand):
    def handle(self, *args, **options):
        products = [
            { 'modelo': 'Bolso Rosa Premium', 'precio_venta': 79.90, 'imagen': '/vite.svg', 'descripcion': 'Bolso elegante con acabados premium.' },
            { 'modelo': 'Zapatillas Fashion', 'precio_venta': 59.50, 'imagen': '/vite.svg', 'descripcion': 'Comodidad y estilo para el día a día.' },
            { 'modelo': 'Blusa Floral', 'precio_venta': 39.99, 'imagen': '/vite.svg', 'descripcion': 'Blusa liviana con estampado floral.' },
            { 'modelo': 'Set de Belleza', 'precio_venta': 49.00, 'imagen': '/vite.svg', 'descripcion': 'Kit completo de cuidado personal.' },
            { 'modelo': 'Reloj Minimalista', 'precio_venta': 89.00, 'imagen': '/vite.svg', 'descripcion': 'Diseño minimalista perfecto para cualquier ocasión.' },
        ]
        for p in products:
            p.setdefault('condicion', 'seminuevo')
            p.setdefault('disponible_venta', True)
            p.setdefault('disponible_renta', True)
            Equipo.objects.get_or_create(modelo=p['modelo'], defaults=p)
        Cupon.objects.get_or_create(codigo='BIENVENIDA', defaults={ 'descuento': 0.10, 'activo': True })
        Cupon.objects.get_or_create(codigo='PREMIUM', defaults={ 'descuento': 0.20, 'activo': True })
        self.stdout.write('Seed completado')
