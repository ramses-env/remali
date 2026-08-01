import logging

from decimal import Decimal

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import generics, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from maquinaria.models import Equipo
from maquinaria.permissions import IsAdminGroupOrStaff, EsOperador
from .models import Inventario, OrdenReparacion, OrdenReparacionItem
from .serializers import InventarioSerializer, OrdenReparacionSerializer

logger = logging.getLogger(__name__)



class UnidadesPorEquipo(generics.ListCreateAPIView):
    """Lista y crea unidades de inventario de un equipo.

    - Sin `cantidad`: alta individual (permite `numero_serie`), respuesta = la unidad.
    - Con `cantidad`: alta en lote **atómica** (todo-o-nada), respuesta = {creadas, cantidad}.
      Reemplaza el patrón de N POSTs en bucle del cliente, que dejaba stock parcial
      y reportaba éxito aunque fallaran unidades.
    """
    serializer_class = InventarioSerializer

    def get_permissions(self):
        # Dar de alta equipo aumenta el patrimonio: administración.
        # Consultarlo lo necesita el técnico todos los días.
        return [IsAdminGroupOrStaff()] if self.request.method == 'POST' else [EsOperador()]

    def get_queryset(self):
        return Inventario.objects.filter(
            equipo_id=self.kwargs['equipo_id']
        ).select_related('equipo').prefetch_related('rentas').order_by('codigo')

    def perform_create(self, serializer):
        equipo = get_object_or_404(Equipo, pk=self.kwargs['equipo_id'])
        serializer.save(equipo=equipo)

    def create(self, request, *args, **kwargs):
        raw = (request.data or {}).get('cantidad', None)
        if raw in (None, ''):
            return super().create(request, *args, **kwargs)  # alta individual de siempre

        try:
            cantidad = int(raw)
        except (TypeError, ValueError):
            return Response({'detail': 'cantidad debe ser un número entero.'}, status=400)
        if cantidad < 1:
            return Response({'detail': 'cantidad debe ser al menos 1.'}, status=400)
        cantidad = min(cantidad, 100)  # tope de seguridad por request

        condicion = (request.data.get('condicion') or 'seminueva').strip().lower()
        validas = {c[0] for c in Inventario.CONDICIONES}
        if condicion not in validas:
            return Response({'detail': f'Condición inválida: "{condicion}".'}, status=400)

        equipo = get_object_or_404(Equipo, pk=self.kwargs['equipo_id'])
        with transaction.atomic():
            creadas = [Inventario.objects.create(equipo=equipo, condicion=condicion)
                       for _ in range(cantidad)]
        data = self.get_serializer(creadas, many=True).data
        return Response({'creadas': data, 'cantidad': len(creadas)}, status=201)


class UnidadesGlobal(generics.ListAPIView):
    """Todas las unidades del inventario con filtros (vista global del admin)."""
    serializer_class = InventarioSerializer
    permission_classes = [EsOperador]

    def get_queryset(self):
        qs = Inventario.objects.all().select_related('equipo').prefetch_related('rentas')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado in ('disponible', 'rentado', 'mantenimiento', 'vendido'):
            qs = qs.filter(estado=estado)
        condicion = (p.get('condicion') or '').strip().lower()
        if condicion in ('nueva', 'seminueva'):
            qs = qs.filter(condicion=condicion)
        equipo = p.get('equipo')
        if equipo and str(equipo).isdigit():
            qs = qs.filter(equipo_id=int(equipo))
        search = (p.get('search') or '').strip()
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(codigo__icontains=search) |
                Q(numero_serie__icontains=search) |
                Q(equipo__modelo__icontains=search)
            )
        return qs.order_by('estado', 'codigo')


class UnidadDetail(generics.RetrieveUpdateDestroyAPIView):
    queryset = Inventario.objects.all().select_related('equipo').prefetch_related('rentas')
    serializer_class = InventarioSerializer

    def get_permissions(self):
        # El técnico consulta y actualiza el estado de una unidad (mandarla a
        # taller, marcarla disponible). Darla de baja del inventario, no.
        return [IsAdminGroupOrStaff()] if self.request.method == 'DELETE' else [EsOperador()]

    def perform_destroy(self, instance):
        from django.db.models import ProtectedError
        if instance.estado == 'rentado':
            raise ValidationError('No puedes eliminar una unidad que está rentada.')
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError('Esta unidad tiene historial (rentas/ventas) y no puede eliminarse.')


@api_view(['GET'])
@permission_classes([EsOperador])
def resumen_inventario(request, equipo_id: int):
    """Conteo por estado de un equipo."""
    qs = Inventario.objects.filter(equipo_id=equipo_id)
    return Response({
        'total': qs.count(),
        'disponible': qs.filter(estado='disponible').count(),
        'rentado': qs.filter(estado='rentado').count(),
        'mantenimiento': qs.filter(estado='mantenimiento').count(),
        'vendido': qs.filter(estado='vendido').count(),
        'nueva': qs.filter(condicion='nueva').count(),
        'seminueva': qs.filter(condicion='seminueva').count(),
    })


@api_view(['POST'])
@permission_classes([EsOperador])
def mantenimiento_unidad(request, pk: int):
    """Envía una unidad a mantenimiento o la libera de vuelta a disponible.

    body: { accion: 'entrar' | 'salir', nota?: str }
    Si la unidad está rentada, al entrar a mantenimiento se finaliza la renta activa.
    """
    datos = request.data or {}
    accion = (datos.get('accion') or 'entrar').lower()
    nota = (datos.get('nota') or '').strip()

    with transaction.atomic():
        try:
            unidad = Inventario.objects.select_for_update().select_related('equipo').get(pk=pk)
        except Inventario.DoesNotExist:
            return Response({'detalle': 'Unidad no encontrada'}, status=404)

        if unidad.estado == 'vendido':
            return Response({'detalle': 'Una unidad vendida no puede entrar a mantenimiento'}, status=400)

        equipo_nombre = unidad.equipo.modelo if unidad.equipo else 'Equipo'

        if accion == 'salir':
            if unidad.estado != 'mantenimiento':
                return Response({'detalle': 'La unidad no está en mantenimiento'}, status=400)
            unidad.salir_mantenimiento()
            from .models import Mantenimiento
            from django.utils import timezone
            Mantenimiento.objects.filter(unidad=unidad, estado='abierto').update(estado='cerrado', fecha_salida=timezone.now())
            _notif('inventario', f'Mantenimiento finalizado · {equipo_nombre}',
                   f'{unidad.codigo} volvió a estar disponible.', 'inventario', data={'inventario_id': unidad.id, 'equipo_id': unidad.equipo_id, 'codigo': unidad.codigo})
        else:
            from decimal import Decimal
            from refacciones.models import Refaccion
            from .models import Mantenimiento, MantenimientoRefaccion

            # 1) Validar refacciones ANTES de tocar el estado (para no dejar cambios a medias)
            parts = []
            for it in (datos.get('refacciones') or []):
                rid = it.get('refaccion_id') or it.get('id')
                try:
                    cant = int(it.get('cantidad') or 1)
                except (ValueError, TypeError):
                    cant = 1
                if not rid or cant <= 0:
                    continue
                try:
                    ref = Refaccion.objects.select_for_update().get(pk=rid)
                except Refaccion.DoesNotExist:
                    return Response({'detalle': 'Refacción no encontrada'}, status=400)
                if ref.stock < cant:
                    return Response({'detalle': f'Stock insuficiente de "{ref.nombre}" (disponible: {ref.stock})'}, status=400)
                parts.append((ref, cant))

            # 2) Renta activa: no se corta en silencio
            if unidad.estado == 'rentado':
                if not datos.get('forzar'):
                    return Response({
                        'detalle': 'La unidad está rentada. Devuélvela primero, o envía '
                                   '"forzar": true para finalizar la renta activa y mandarla a mantenimiento.',
                        'requiere_confirmacion': True,
                    }, status=409)
                from renta.models import Renta
                r = Renta.objects.filter(inventario=unidad, estado='activa').first()
                if r:
                    r.finalizar(commit=True)

            # 3) Cambiar estado + registrar mantenimiento + descontar stock de refacciones
            unidad.enviar_mantenimiento()
            try:
                costo_mo = Decimal(str(datos.get('costo_mano_obra') or 0))
            except Exception:
                costo_mo = Decimal('0')
            mant = Mantenimiento.objects.create(unidad=unidad, descripcion=nota, costo_mano_obra=costo_mo, estado='abierto')
            usadas = []
            for ref, cant in parts:
                ref.stock -= cant
                ref.save(update_fields=['stock'])
                MantenimientoRefaccion.objects.create(mantenimiento=mant, refaccion=ref, cantidad=cant, costo_unitario=ref.precio_venta)
                usadas.append(f'{ref.nombre} x{cant}')

            detalle = f'{unidad.codigo} entró a mantenimiento.'
            if nota:
                detalle += f' Nota: {nota}'
            if usadas:
                detalle += ' · Refacciones: ' + ', '.join(usadas)
            _notif('inventario', f'Equipo en mantenimiento · {equipo_nombre}', detalle, 'inventario', data={'inventario_id': unidad.id, 'equipo_id': unidad.equipo_id, 'codigo': unidad.codigo})

    unidad.refresh_from_db()
    return Response({'detalle': 'Estado actualizado', 'unidad': InventarioSerializer(unidad).data})


def _notif(tipo, titulo, mensaje, seccion, data=None):
    try:
        from maquinaria.models import crear_notificacion
        crear_notificacion(tipo, titulo, mensaje, seccion=seccion, data=(data or {}))
    except Exception:
        pass


@api_view(['POST'])
@permission_classes([EsOperador])   # el técnico también vende en campo
def vender_unidad(request, pk: int):
    """Registra la venta de una unidad de maquinaria."""
    from ventas.models import Venta
    datos = request.data or {}
    with transaction.atomic():
        try:
            unidad = Inventario.objects.select_for_update().select_related('equipo').get(pk=pk)
        except Inventario.DoesNotExist:
            return Response({'detalle': 'Unidad no encontrada'}, status=404)

        if not unidad.puede_venderse():
            return Response({'detalle': 'La unidad no está disponible para venta'}, status=400)

        # No se puede vender una unidad con renta activa o reservada
        from renta.models import Renta
        if Renta.objects.filter(inventario=unidad, estado__in=['activa', 'reservada']).exists():
            return Response(
                {'detalle': 'La unidad tiene una renta activa o reservada; cancélala antes de vender.'},
                status=400,
            )

        try:
            precio = Decimal(str(datos.get('total') or datos.get('precio') or unidad.equipo.precio_venta or 0))
        except Exception:
            precio = Decimal('0')
        if precio <= 0:
            return Response(
                {'detalle': 'El precio de venta debe ser mayor a 0. Captura un total o define el precio de venta del equipo.'},
                status=400,
            )

        venta = Venta(
            usuario=request.user if request.user.is_authenticated else None,
            nombre_cliente=(datos.get('nombre_cliente') or '').strip(),
            telefono_cliente=(datos.get('telefono_cliente') or '').strip(),
            metodo_pago=(datos.get('metodo_pago') or 'efectivo'),
            empresa_id=(datos.get('empresa_id') or None),
            inventario=unidad,
            precio_maquina=precio,
            # IVA siempre (lo fuerza el modelo Venta). requiere_factura solo decide
            # si se registra la solicitud en la bandeja "Por facturar" (abajo).
        )
        try:
            venta.save()  # valida, calcula IVA y marca la unidad como vendida
        except ValueError as e:
            return Response({'detalle': str(e)}, status=400)
        try:
            from maquinaria.models import crear_notificacion
            equipo_nombre = unidad.equipo.modelo if unidad.equipo else 'Equipo'
            crear_notificacion(
                'venta',
                f'Venta registrada · {equipo_nombre}',
                f'{venta.nombre_cliente or "Cliente"} compró {unidad.codigo} por ${venta.total} ({venta.metodo_pago}).',
                seccion='ventas',
                data={'venta_id': venta.id, 'inventario_id': unidad.id, 'equipo_id': unidad.equipo_id, 'codigo': unidad.codigo},
            )
        except Exception:
            pass

        # Solicitud de factura (si el cliente la pedirá) → bandeja "por facturar".
        if datos.get('requiere_factura'):
            try:
                from facturacion.models import SolicitudFactura
                equipo_nombre = unidad.equipo.modelo if unidad.equipo else 'Equipo'
                SolicitudFactura.registrar(
                    venta=venta,
                    empresa=venta.empresa if venta.empresa_id else None,
                    receptor=datos.get('factura') or {},
                    forma_pago=venta.metodo_pago,
                    concepto=f'Venta de {equipo_nombre} ({unidad.codigo})',
                )
            except Exception:
                # La venta/renta ya quedó registrada; que no truene por facturación.
                logger.exception('No se pudo registrar la solicitud de factura de la venta de equipo')

    unidad.refresh_from_db()
    return Response({
        'detalle': 'Venta registrada',
        'venta': {
            'id': venta.id,
            'nombre_cliente': venta.nombre_cliente,
            'subtotal': str(venta.subtotal),
            'iva': str(venta.iva),
            'total': str(venta.total),
            'metodo_pago': venta.metodo_pago,
            'fecha': venta.fecha,
        },
        'ticket_url': f'/api/ventas/{venta.id}/ticket/',
        'unidad': InventarioSerializer(unidad).data,
    }, status=201)


# ─────────────────────────────────────────────
#  ÓRDENES DE REPARACIÓN
# ─────────────────────────────────────────────
def _sincronizar_estado_unidad(orden):
    """Para órdenes internas (máquina propia), la orden manda el estado de la unidad:
    abierta -> la unidad va a 'mantenimiento'; terminada/entregada -> vuelve a 'disponible'.
    Nunca toca unidades rentadas o vendidas (sólo transiciona desde 'disponible'/'mantenimiento')."""
    u = orden.unidad
    if orden.tipo != 'interna' or not u:
        return
    if orden.estado in ('terminada', 'entregada'):
        if u.estado == 'mantenimiento':
            u.salir_mantenimiento()
    elif orden.estado in ('recibida', 'proceso'):
        if u.estado == 'disponible':
            u.enviar_mantenimiento()


class OrdenReparacionListCreate(generics.ListCreateAPIView):
    serializer_class = OrdenReparacionSerializer
    permission_classes = [EsOperador]

    def get_queryset(self):
        from django.db.models import Q
        qs = OrdenReparacion.objects.all().select_related('empresa', 'unidad', 'unidad__equipo').prefetch_related('items', 'items__refaccion')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado in ('recibida', 'proceso', 'terminada', 'entregada'):
            qs = qs.filter(estado=estado)
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(folio__icontains=q) | Q(cliente_nombre__icontains=q) | Q(equipo_descripcion__icontains=q) | Q(empresa__nombre__icontains=q))
        return qs

    def perform_create(self, serializer):
        orden = serializer.save()
        # Al abrir una orden interna, la unidad propia entra a mantenimiento.
        _sincronizar_estado_unidad(orden)


class OrdenReparacionDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = OrdenReparacionSerializer
    permission_classes = [EsOperador]
    queryset = OrdenReparacion.objects.all().select_related('empresa', 'unidad', 'unidad__equipo').prefetch_related('items', 'items__refaccion')

    def perform_update(self, serializer):
        from django.utils import timezone
        orden = serializer.save()
        # Al marcar entregada, fija la fecha de entrega si no la tiene
        if orden.estado == 'entregada' and not orden.fecha_entrega:
            orden.fecha_entrega = timezone.now()
            orden.save(update_fields=['fecha_entrega'])
        # La orden interna manda el estado de la unidad propia.
        _sincronizar_estado_unidad(orden)

    def perform_destroy(self, instance):
        from refacciones.models import Refaccion
        unidad = instance.unidad
        tipo = instance.tipo
        with transaction.atomic():
            # Reintegra el stock de las refacciones consumidas: el CASCADE borraría
            # los items sin devolverlas, perdiendo inventario silenciosamente.
            for item in instance.items.all():
                if item.origen == 'stock' and item.refaccion_id:
                    ref = Refaccion.objects.select_for_update().get(pk=item.refaccion_id)
                    ref.stock = (ref.stock or 0) + item.cantidad
                    ref.save(update_fields=['stock'])
            instance.delete()
            # Si se elimina una orden interna con la máquina aún en taller, se libera.
            if tipo == 'interna' and unidad and unidad.estado == 'mantenimiento':
                unidad.salir_mantenimiento()


@api_view(['POST'])
@permission_classes([EsOperador])
def orden_agregar_item(request, pk: int):
    """Agrega una refacción a la orden. origen='stock' descuenta inventario; 'externa' se compra aparte."""
    from refacciones.models import Refaccion
    try:
        orden = OrdenReparacion.objects.get(pk=pk)
    except OrdenReparacion.DoesNotExist:
        return Response({'detalle': 'Orden no encontrada'}, status=404)

    d = request.data or {}
    origen = (d.get('origen') or 'stock').lower()
    try:
        cant = max(1, int(d.get('cantidad') or 1))
    except (ValueError, TypeError):
        cant = 1

    with transaction.atomic():
        if origen == 'stock':
            rid = d.get('refaccion_id') or d.get('refaccion')
            try:
                ref = Refaccion.objects.select_for_update().get(pk=rid)
            except Refaccion.DoesNotExist:
                return Response({'detalle': 'Refacción no encontrada'}, status=400)
            if ref.stock < cant:
                return Response({'detalle': f'Stock insuficiente de "{ref.nombre}" (disponible: {ref.stock})'}, status=400)
            ref.stock -= cant
            ref.save(update_fields=['stock'])
            OrdenReparacionItem.objects.create(
                orden=orden, origen='stock', refaccion=ref, nombre=ref.nombre,
                cantidad=cant, costo_unitario=ref.precio_venta,
            )
        else:
            nombre = (d.get('nombre') or '').strip()
            if not nombre:
                return Response({'detalle': 'El nombre de la pieza es requerido'}, status=400)
            try:
                costo = Decimal(str(d.get('costo_unitario') or 0))
            except Exception:
                costo = Decimal('0')
            OrdenReparacionItem.objects.create(
                orden=orden, origen='externa', nombre=nombre, cantidad=cant, costo_unitario=costo,
            )

    orden.refresh_from_db()
    return Response(OrdenReparacionSerializer(orden).data, status=201)


@api_view(['DELETE'])
@permission_classes([EsOperador])
def orden_eliminar_item(request, pk: int, item_id: int):
    """Quita una pieza de la orden. Si era de stock, la reintegra al inventario."""
    try:
        item = OrdenReparacionItem.objects.select_related('refaccion').get(pk=item_id, orden_id=pk)
    except OrdenReparacionItem.DoesNotExist:
        return Response({'detalle': 'Item no encontrado'}, status=404)
    with transaction.atomic():
        if item.origen == 'stock' and item.refaccion:
            item.refaccion.stock = (item.refaccion.stock or 0) + item.cantidad
            item.refaccion.save(update_fields=['stock'])
        item.delete()
    orden = OrdenReparacion.objects.get(pk=pk)
    return Response(OrdenReparacionSerializer(orden).data)


@api_view(['GET'])
@permission_classes([AllowAny])
def unidad_qr(request, codigo):
    """La página detrás del QR pegado en la máquina.

    Anónimo (cliente, alguien que la encuentra): tarjeta pública — de quién es
    la máquina, qué modelo es y cómo contactar a REMALI. Operador con sesión:
    ficha de campo — estado, renta activa (con quién, dónde, fechas, adeudo) y
    lo necesario para actuar desde el teléfono."""
    from decimal import Decimal as _D
    from maquinaria.permissions import nivel_de
    inv = Inventario.objects.select_related('equipo').filter(codigo__iexact=codigo).first()
    if not inv:
        return Response({'detalle': 'Unidad no encontrada'}, status=404)

    base = {
        'codigo': inv.codigo,
        'equipo': inv.equipo.modelo if inv.equipo else 'Equipo',
        'equipo_id': inv.equipo_id,
    }
    if not (request.user.is_authenticated and nivel_de(request.user) >= 1):
        return Response({'publico': True, **base})

    datos = {
        'publico': False, **base,
        'estado': inv.estado,
        'numero_serie': inv.numero_serie,
        'condicion': inv.condicion,
        'renta': None,
    }
    from renta.models import Renta
    r = (Renta.objects.filter(inventario=inv, estado__in=['activa', 'reservada'])
         .select_related('obra').order_by('-creado_en').first())
    if r:
        pagado = sum((_D(str(p.get('monto', 0))) for p in (r.pagos or [])), _D('0'))
        saldo = max((r.total or _D('0')) + (r.recargo or _D('0')) - pagado, _D('0'))
        datos['renta'] = {
            'id': r.id,
            'estado': r.estado,
            'cliente': r.cliente or '',
            'lugar': (r.obra.ubicacion if r.obra_id and r.obra.ubicacion else r.direccion) or '',
            'fecha_inicio': r.fecha_inicio,
            'fecha_fin': r.fecha_fin,
            'entregada': bool(r.entregada_en),
            'adeudo': str(saldo) if saldo > 0 else None,
        }
    return Response(datos)
