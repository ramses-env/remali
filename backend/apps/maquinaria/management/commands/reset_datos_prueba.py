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
            '--conservar',
            metavar='QUIEN',
            help=('Deja UNA sola cuenta y borra todas las demás. Acepta usuario, '
                  'correo o nombre completo. Si no encuentra exactamente una, no borra nada: '
                  'quedarse sin la cuenta del dueño no se deshace.'),
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
        unico = None
        if opts['conservar']:
            unico = self._resolver_cuenta(opts['conservar'])
            conservados[0] = (f'SOLO la cuenta {unico.username!r} '
                              f'({(unico.first_name + " " + unico.last_name).strip() or "sin nombre"})')
        elif opts['solo_superusuario']:
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
            # Al final: si las cuentas se borraran antes, los documentos que
            # apuntan a ellas cambiarían de estado mientras se recorre el plan.
            from django.contrib.auth.models import User
            if unico is not None:
                fuera = User.objects.exclude(pk=unico.pk)
                n = fuera.count()
                fuera.delete()
                self.stdout.write(f'  ✓ Todas las cuentas menos {unico.username!r}: {n} eliminadas')
            elif opts['solo_superusuario']:
                fuera = User.objects.filter(is_superuser=False)
                n = fuera.count()
                fuera.delete()
                self.stdout.write(f'  ✓ Cuentas que no son superusuario: {n} eliminadas')

        resumen = 'solo usuarios + config'
        if opts['conservar_clasificacion']:
            resumen += ' + clasificación'
        self.stdout.write(self.style.SUCCESS(f'\n✅ Listo. Base lista para pruebas ({resumen}).'))

    def _resolver_cuenta(self, texto):
        """La cuenta que sobrevive. Exige UNA coincidencia exacta en su universo.

        Se busca por usuario, correo y nombre completo porque quien corre esto
        escribe el nombre que ve en el panel, no el `username`. Y si hay cero o
        varias coincidencias se aborta: borrar todas las cuentas menos la
        equivocada deja al dueño fuera de su propio sistema, y eso no se
        deshace.
        """
        from django.contrib.auth.models import User
        from django.db.models import Q, Value
        from django.db.models.functions import Concat, Lower
        from django.core.management.base import CommandError

        q = (texto or '').strip().lower()
        if not q:
            raise CommandError('--conservar necesita un usuario, correo o nombre.')

        encontrados = (
            User.objects
            .annotate(completo=Lower(Concat('first_name', Value(' '), 'last_name')))
            .filter(Q(username__iexact=q) | Q(email__iexact=q) | Q(completo=q))
        )
        if not encontrados.exists():
            # Segunda pasada, más laxa: "merced" debe encontrar a "Merced Mendoza".
            encontrados = (
                User.objects
                .annotate(completo=Lower(Concat('first_name', Value(' '), 'last_name')))
                .filter(Q(username__icontains=q) | Q(email__icontains=q) | Q(completo__contains=q))
            )

        n = encontrados.count()
        if n == 0:
            raise CommandError(f'No hay ninguna cuenta que corresponda a {texto!r}. No se borró nada.')
        if n > 1:
            listado = ', '.join(f'{u.username} <{u.email}>' for u in encontrados[:8])
            raise CommandError(
                f'{texto!r} corresponde a {n} cuentas ({listado}). '
                f'Concreta con el usuario o el correo exacto. No se borró nada.')
        return encontrados.first()
