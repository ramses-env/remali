"""Deja la base lista para PRUEBAS LIMPIAS: conserva SOLO los usuarios (cuentas,
roles, perfiles) y la configuración del sitio; borra TODO lo demás (catálogo,
inventario, refacciones, el padrón de clientes y todo lo transaccional).

Uso:
    python manage.py reset_datos_prueba --confirm
    python manage.py reset_datos_prueba --confirm --conservar-clasificacion

Sin --confirm no borra nada (solo muestra el plan). Corre en una transacción:
si algo falla, no se borra nada. Haz un respaldo antes:
    python manage.py dumpdata --exclude contenttypes --exclude auth.permission \
        --exclude sessions --exclude admin.logentry --indent 2 -o backup.json
"""
from django.core.management.base import BaseCommand
from django.db import transaction


class Command(BaseCommand):
    help = "Borra todos los datos de negocio dejando SOLO usuarios y config del sitio (para pruebas)."

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true',
                            help='Requerido para borrar de verdad. Sin esto solo muestra el plan.')
        parser.add_argument(
            '--solo-superusuario',
            action='store_true',
            help='Además borra las cuentas que NO son superusuario (para arrancar de cero).',
        )
        parser.add_argument(
            '--conservar-clasificacion',
            action='store_true',
            help='Conserva categorías, marcas y tipos además de usuarios y configuración.',
        )

    def handle(self, *args, **opts):
        # Import diferido: los modelos se resuelven al ejecutar, no al cargar.
        from cotizaciones.models import Cotizacion, CotizacionItem, CotizacionFoto
        from cotizaciones.models_borrador import BorradorCliente, BorradorItem, PaqueteAutorizacion
        from ventas.models import Venta, Caja, SesionCaja, MovimientoCaja
        from renta.models import Renta, EvidenciaRenta
        from facturacion.models import SolicitudFactura
        from inventario.models import (
            Inventario, OrdenReparacion, OrdenReparacionItem, Mantenimiento, MantenimientoRefaccion,
        )
        from refacciones.models import Refaccion
        from clientes.models import Cliente, Contacto, Obra
        from maquinaria.models import (
            Equipo, Categoria, Marca, Tipo, ImagenProducto, Notificacion, ObraCliente, Cupon,
        )

        # ══════════════════════════════════════════════════════════════════
        # Orden TOPOLÓGICO de borrado seguro (evita ProtectedError):
        #   1) PRIMERO las tablas con FK PROTECT que APUNTAN a otras.
        #   2) DESPUÉS las entidades padre que eran referenciadas.
        #   Si se rompe el orden, PostgreSQL/MySQL con on_delete=PROTECT no
        #   permite borrar la fila padre mientras exista un hijo vivo.
        # ══════════════════════════════════════════════════════════════════
        plan = [
            # ── Hijos / dependencias de movimientos, partidas y evidencias ──
            ('Movimientos de caja', MovimientoCaja),
            ('Sesiones de caja', SesionCaja),
            ('Cajas', Caja),
            ('Solicitudes de factura', SolicitudFactura),
            ('Evidencias de renta', EvidenciaRenta),
            ('Notificaciones', Notificacion),
            ('Fotos de cotización', CotizacionFoto),
            # Los borradores del cliente y los paquetes que le manda a su jefe
            # van ANTES que las cuentas. Su dueño es "una cuenta O un espacio de
            # invitado, nunca los dos" y eso lo impone un CheckConstraint: si la
            # cuenta se borra primero, la fila se queda sin ninguno de los dos y
            # MySQL tumba el borrado entero con `paquete_un_solo_dueno`.
            ('Partidas de borrador', BorradorItem),
            ('Borradores del cliente', BorradorCliente),
            ('Paquetes de autorización', PaqueteAutorizacion),
            ('Partidas de cotización', CotizacionItem),
            ('Cotizaciones', Cotizacion),
            ('Rentas', Renta),
            ('Ventas', Venta),
            ('Refacciones usadas en mantenimiento', MantenimientoRefaccion),
            ('Partidas de orden de reparación', OrdenReparacionItem),
            ('Órdenes de reparación', OrdenReparacion),
            ('Mantenimientos', Mantenimiento),
            ('Obras guardadas del cliente', ObraCliente),
            ('Obras', Obra),
            ('Contactos del padrón', Contacto),
            ('Clientes (padrón)', Cliente),
            ('Unidades de inventario', Inventario),
            ('Refacciones', Refaccion),
            ('Imágenes de producto', ImagenProducto),
            # Los cupones son dato de negocio, no configuración: un código de
            # descuento vivo cambia los totales de la siguiente prueba.
            ('Cupones', Cupon),
            # ── Entidades padre / catálogos (van al final) ──
            ('Equipos (catálogo)', Equipo),
        ]
        conservados = ['usuarios', 'roles', 'perfiles', 'configuración del sitio']
        if opts['solo_superusuario']:
            from django.contrib.auth.models import User
            conservados[0] = f'SOLO superusuarios ({User.objects.filter(is_superuser=True).count()})'

        if opts['conservar_clasificacion']:
            conservados.extend(['categorías', 'marcas', 'tipos'])
        else:
            plan.extend([
                ('Categorías', Categoria),
                ('Marcas', Marca),
                ('Tipos', Tipo),
            ])

        self.stdout.write(self.style.WARNING('\nPLAN — se BORRARÁ:'))
        total = 0
        for etiqueta, modelo in plan:
            n = modelo.objects.count()
            total += n
            self.stdout.write(f'  {n:>5}  {etiqueta}')
        self.stdout.write(self.style.SUCCESS(f'\nSe CONSERVA: {", ".join(conservados)}.'))

        if not opts['confirm']:
            self.stdout.write(self.style.WARNING(
                f'\n(simulación) {total} registros se borrarían. Corre con --confirm para hacerlo.'))
            return

        with transaction.atomic():
            for etiqueta, modelo in plan:
                borrados, _ = modelo.objects.all().delete()
                self.stdout.write(f'  ✓ {etiqueta}: {borrados} eliminados')
            if opts['solo_superusuario']:
                # Al final: si se borraran antes, los documentos que apuntan a
                # esas cuentas cambiarían de estado mientras se recorre el plan.
                from django.contrib.auth.models import User
                fuera = User.objects.filter(is_superuser=False)
                n = fuera.count()
                fuera.delete()
                self.stdout.write(f'  ✓ Cuentas que no son superusuario: {n} eliminadas')

        resumen = 'solo usuarios + config'
        if opts['conservar_clasificacion']:
            resumen += ' + clasificación'
        self.stdout.write(self.style.SUCCESS(f'\n✅ Listo. Base lista para pruebas ({resumen}).'))
