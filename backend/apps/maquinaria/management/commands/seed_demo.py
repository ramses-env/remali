from django.core.management.base import BaseCommand
from decimal import Decimal
from maquinaria.models import Categoria, Equipo

class Command(BaseCommand):
    help = "Seed demo categories and products for filters"

    def handle(self, *args, **options):
        cats = ['Calzado', 'Ropa', 'Maquillaje']
        cat_map = {}
        for name in cats:
            c, _ = Categoria.objects.get_or_create(nombre=name)
            cat_map[name] = c
        items = [
            ('Zapatilla Nike Air', Decimal('89.90'), 'Calzado'),
            ('Tenis Adidas Run', Decimal('79.50'), 'Calzado'),
            ('Botas Gucci Premium', Decimal('399.00'), 'Calzado'),
            ('Camisa Zara Slim', Decimal('49.99'), 'Ropa'),
            ('Pantalón Tommy Classic', Decimal('69.99'), 'Ropa'),
            ('Vestido Gucci Silk', Decimal('599.00'), 'Ropa'),
            ('Labial MAC Rouge', Decimal('24.90'), 'Maquillaje'),
            ('Base Sephora Pro', Decimal('34.00'), 'Maquillaje'),
            ('Delineador Maybelline', Decimal('12.50'), 'Maquillaje'),
        ]
        created = 0
        for modelo, price, cat_name in items:
            if not Equipo.objects.filter(modelo=modelo).exists():
                Equipo.objects.create(
                    modelo=modelo,
                    descripcion=f"{modelo}",
                    precio_dia=price,
                    condicion='seminuevo',
                    disponible_venta=True,
                    disponible_renta=True,
                    imagen='/vite.svg',
                    categoria=cat_map[cat_name],
                )
                created += 1
        self.stdout.write(self.style.SUCCESS(f"Seed completed. Categorias: {len(cat_map)}, Equipos created: {created}"))
