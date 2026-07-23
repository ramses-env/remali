from __future__ import annotations

import shutil
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from inventario.models import Inventario
from maquinaria.models import Equipo, ImagenProducto
from renta.models import Renta
from ventas.models import ItemVenta, Venta


class Command(BaseCommand):
    help = "Elimina todos los productos (equipos), sus unidades de inventario y sus imágenes (BD + media/products)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Confirma la operación destructiva sin prompt interactivo.",
        )
        parser.add_argument(
            "--delete-rentas",
            action="store_true",
            help="Si existen rentas que protegen inventario, también las elimina.",
        )
        parser.add_argument(
            "--delete-ventas",
            action="store_true",
            help="Elimina todas las ventas (POS) y sus items. Restaura stock de refacciones sumando las cantidades vendidas.",
        )

    def handle(self, *args, **options):
        yes: bool = options["yes"]
        delete_rentas: bool = options["delete_rentas"]
        delete_ventas: bool = options["delete_ventas"]

        equipos_qs = Equipo.objects.all()
        inventario_qs = Inventario.objects.filter(equipo__in=equipos_qs)
        imagenes_qs = ImagenProducto.objects.filter(equipo__in=equipos_qs)
        rentas_qs = Renta.objects.filter(inventario__in=inventario_qs)
        ventas_qs = Venta.objects.all()
        items_venta_qs = ItemVenta.objects.select_related("refaccion")

        equipos_count = equipos_qs.count()
        inventario_count = inventario_qs.count()
        imagenes_count = imagenes_qs.count()
        rentas_count = rentas_qs.count()
        ventas_count = ventas_qs.count()
        items_venta_count = items_venta_qs.count()

        self.stdout.write("Resumen de borrado (local):")
        self.stdout.write(f"- Equipos: {equipos_count}")
        self.stdout.write(f"- Unidades inventario: {inventario_count}")
        self.stdout.write(f"- Imágenes (tabla imagenes_producto): {imagenes_count}")
        self.stdout.write(f"- Rentas que bloquean inventario (PROTECT): {rentas_count}")
        self.stdout.write(f"- Ventas: {ventas_count}")
        self.stdout.write(f"- Items de venta: {items_venta_count}")

        if (
            equipos_count == 0
            and inventario_count == 0
            and imagenes_count == 0
            and (not delete_ventas or (ventas_count == 0 and items_venta_count == 0))
        ):
            self.stdout.write(self.style.SUCCESS("No hay productos que borrar."))
            return

        if rentas_count > 0 and not delete_rentas:
            raise CommandError(
                "Hay rentas activas/históricas que protegen inventario. "
                "Vuelve a ejecutar con --delete-rentas si también quieres eliminarlas."
            )

        if not yes:
            raise CommandError("Operación cancelada. Ejecuta con --yes para confirmar.")

        if delete_rentas and rentas_count > 0:
            deleted_rentas = rentas_qs.delete()[0]
            self.stdout.write(self.style.WARNING(f"Rentas eliminadas: {deleted_rentas}"))

        if delete_ventas and (ventas_count > 0 or items_venta_count > 0):
            restored = 0
            for item in items_venta_qs.iterator():
                if item.refaccion_id:
                    item.refaccion.stock = (item.refaccion.stock or 0) + int(item.cantidad or 0)
                    item.refaccion.save(update_fields=["stock"])
                    restored += 1
            Venta.objects.all().delete()
            self.stdout.write(self.style.WARNING(f"Ventas eliminadas. Items procesados para restaurar stock: {restored}"))

        for img in imagenes_qs.iterator():
            if img.imagen:
                img.imagen.delete(save=False)

        for eq in equipos_qs.iterator():
            if eq.imagen:
                eq.imagen.delete(save=False)

        ImagenProducto.objects.filter(equipo__in=equipos_qs).delete()
        Inventario.objects.filter(equipo__in=equipos_qs).delete()
        Equipo.objects.all().delete()

        products_dir = Path(settings.MEDIA_ROOT) / "products"
        if products_dir.exists() and products_dir.is_dir():
            shutil.rmtree(products_dir, ignore_errors=True)

        self.stdout.write(self.style.SUCCESS("Catálogo de productos eliminado (BD + media/products)."))
