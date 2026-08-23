import logging

from decimal import Decimal

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import generics, permissions
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError

from maquinaria.throttling import TokenPublicoThrottle

from maquinaria.models import Equipo
from maquinaria.permissions import (
    IsAdminGroupOrStaff, EsOperador, PuedeDarAltaInventario,
    PuedeGestionarReparaciones, PuedeOperarInventario, PuedeReparar, PuedeVender,
)
from maquinaria.views import ProtectedDestroyMixin
from .models import Inventario, OrdenReparacion, OrdenReparacionItem
from .serializers import InventarioSerializer, OrdenReparacionSerializer

logger = logging.getLogger(__name__)




def _campos_cliente(datos):
    """Los campos de cliente para construir un documento, resueltos en un solo
    lugar (apps/clientes/resolucion.py). Si viene `cliente_id` se usa; si no, se
    crea uno con lo capturado. Nunca se une por teléfono sin confirmación."""
    from clientes.resolucion import resolver_cliente
    cli, contacto = resolver_cliente(
        cliente_id=datos.get('cliente_id') or None,
        contacto_id=datos.get('contacto_id') or None,
        nombre=datos.get('nombre_cliente') or '',
        telefono=datos.get('telefono_cliente') or '',
    )
    return {'cliente': cli, 'contacto': contacto}
class UnidadesPorEquipo(generics.ListCreateAPIView):
    """Lista y crea unidades de inventario de un equipo.

    - Sin `cantidad`: alta individual (permite `numero_serie`), respuesta = la unidad.
    - Con `cantidad`: alta en lote **atómica** (todo-o-nada), respuesta = {creadas, cantidad}.
      Reemplaza el patrón de N POSTs en bucle del cliente, que dejaba stock parcial
      y reportaba éxito aunque fallaran unidades.
    """
    serializer_class = InventarioSerializer
    permission_classes = [PuedeDarAltaInventario]

    def get_permissions(self):
        # Dar de alta aumenta lo que la casa dice tener. Consultarlo lo necesita
        # el técnico todos los días, y apagarle el alta no lo puede dejar ciego.
        return super().get_permissions() if self.request.method == 'POST' else [EsOperador()]

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


@api_view(['GET'])
@permission_classes([PuedeDarAltaInventario])   # es el paso previo del alta
def proximo_codigo_unidad(request, equipo_id: int):
    """Devuelve el código que se asignará a la próxima unidad de este equipo,
    para mostrarlo en la confirmación ANTES de dar de alta."""
    equipo = get_object_or_404(Equipo, pk=equipo_id)
    return Response({'codigo': Inventario.proximo_codigo(equipo)})


class UnidadesGlobal(generics.ListAPIView):
    """Todas las unidades del inventario con filtros (vista global del admin)."""
    serializer_class = InventarioSerializer
    permission_classes = [EsOperador]

    def get_queryset(self):
        qs = Inventario.objects.all().select_related('equipo').prefetch_related('rentas')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado in ('disponible', 'rentado', 'apartado', 'mantenimiento', 'vendido'):
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


class UnidadDetail(ProtectedDestroyMixin, generics.RetrieveUpdateDestroyAPIView):
    en_uso_label_plural = 'rentas o ventas'
    queryset = Inventario.objects.all().select_related('equipo').prefetch_related('rentas')
    serializer_class = InventarioSerializer
    permission_classes = [PuedeOperarInventario]

    def get_permissions(self):
        # Mover la unidad (a taller, de vuelta a disponible) es trabajo de patio.
        # Consultarla la necesita hasta quien cobra en el mostrador; darla de
        # baja del inventario no lo hace nadie de este lado.
        if self.request.method == 'DELETE':
            return [IsAdminGroupOrStaff()]
        if self.request.method in ('PUT', 'PATCH'):
            return super().get_permissions()
        return [EsOperador()]

    def perform_destroy(self, instance):
        from django.db.models import ProtectedError
        if instance.estado == 'rentado':
            raise ValidationError('No puedes eliminar una unidad que está rentada.')
        if instance.estado == 'apartado':
            raise ValidationError('No puedes eliminar una unidad apartada. Cancela el apartado primero.')
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
        'apartado': qs.filter(estado='apartado').count(),
        'mantenimiento': qs.filter(estado='mantenimiento').count(),
        'vendido': qs.filter(estado='vendido').count(),
        'nueva': qs.filter(condicion='nueva').count(),
        'seminueva': qs.filter(condicion='seminueva').count(),
    })


@api_view(['POST'])
@permission_classes([PuedeOperarInventario])
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
        if unidad.estado == 'apartado':
            return Response({'detalle': 'La unidad está apartada (venta con anticipo). Cancela el apartado antes de mandarla a mantenimiento.'}, status=400)

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
@permission_classes([PuedeVender])
def vender_unidad(request, pk: int):
    """Registra la venta de una unidad de maquinaria.

    Con `desde_caja: true` la venta además queda colgada del turno de caja del
    operador (abriéndolo si no había), para que el arqueo del mostrador la
    espere. Sin esa bandera se comporta exactamente como siempre: Inventario y
    la venta en campo no se enteran de la caja.
    """
    from ventas.models import Venta
    from cotizaciones.models import Cotizacion
    from ventas.caja_views import caja_permite, registrar_cobro_en_caja
    datos = request.data or {}
    desde_caja = bool(datos.get('desde_caja'))
    turno_abierto_ahora = False
    if desde_caja and not caja_permite('venta'):
        return Response(
            {'detalle': 'Vender maquinaria desde la caja está apagado. Enciéndelo en Ajustes → Caja.',
             'codigo': 'caja_venta_apagada'},
            status=400,
        )
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

        cotizacion = None
        cotizacion_id = datos.get('cotizacion_id')
        if cotizacion_id:
            try:
                cotizacion = Cotizacion.objects.prefetch_related('items').get(pk=int(cotizacion_id))
            except (ValueError, Cotizacion.DoesNotExist):
                return Response({'detalle': 'La cotización indicada no existe.'}, status=404)
            if cotizacion.estado != 'aceptada':
                return Response({'detalle': 'Solo se puede concretar una cotización aceptada.'}, status=400)
            if cotizacion.conversiones.exists():
                return Response({'detalle': 'Esta cotización ya se convirtió en venta.'}, status=400)
            equipos_validos = {i.equipo_id for i in cotizacion.items.all() if i.modalidad == 'venta' and i.equipo_id}
            if equipos_validos and unidad.equipo_id not in equipos_validos:
                return Response({'detalle': 'La unidad elegida no coincide con el equipo cotizado.'}, status=400)

        # Pago combinado: array [{'metodo', 'monto'}] o método único.
        metodo_principal = (datos.get('metodo_pago') or 'efectivo').lower()
        if metodo_principal not in ('efectivo', 'tarjeta', 'transferencia'):
            metodo_principal = 'efectivo'
        pagos_raw = datos.get('pagos')
        pagos_limpios = []
        if isinstance(pagos_raw, list):
            for p in pagos_raw:
                if not isinstance(p, dict):
                    continue
                m = (str(p.get('metodo') or '').lower() or metodo_principal)
                try:
                    mo = Decimal(str(p.get('monto') or 0))
                except Exception:
                    mo = Decimal('0')
                if mo > 0 and m in ('efectivo', 'tarjeta', 'transferencia'):
                    pagos_limpios.append({'metodo': m, 'monto': str(mo)})
        # Método principal = el de mayor monto (para retrocompatibilidad).
        if pagos_limpios:
            pagos_limpios.sort(key=lambda x: Decimal(str(x.get('monto', 0))), reverse=True)
            metodo_principal = pagos_limpios[0]['metodo']

        # ── Control de ajuste de precio ──────────────────────────────────
        # El precio viene bloqueado en el panel al de lista/cotización (precio_lista).
        # Si el total difiere hay dos caminos:
        #   • Descuento de CONTADO en efectivo (total == lista·(1−pct/100)): es política
        #     de la empresa → se permite SIN código, solo queda anotado.
        #   • Cualquier otro ajuste a mano → exige el código de autorización de 6 dígitos
        #     que definió el dueño (guardado hasheado). Sin código válido → 403.
        # El QUIÉN queda en venta.usuario y el CUÁNDO en venta.fecha.
        nota_ajuste = ''
        pl = None
        try:
            pl_raw = datos.get('precio_lista')
            if pl_raw not in (None, ''):
                pl = Decimal(str(pl_raw))
        except Exception:
            pl = None
        if pl is not None and pl > 0 and abs(pl - precio) >= Decimal('0.01'):
            from maquinaria.models import ConfiguracionSitio
            cfg = ConfiguracionSitio.get_solo()
            pct = Decimal(str(cfg.descuento_contado_pct or 0))
            esperado_contado = (pl * (Decimal('100') - pct) / Decimal('100')).quantize(Decimal('0.01'))
            es_desc_contado = (
                pct > 0
                and metodo_principal == 'efectivo'
                and precio < pl
                and abs(precio - esperado_contado) <= Decimal('0.5')   # tolerancia por redondeo
            )
            if es_desc_contado:
                nota_ajuste = f'Descuento de contado {int(pct)}%: de ${pl:,.2f} → ${precio:,.2f} (pago en efectivo).'
            else:
                from maquinaria.seguridad import verificar_codigo
                ok, detalle, status_cod, _c = verificar_codigo(request.user, datos.get('codigo_ajuste'))
                if not ok:
                    return Response({'detalle': detalle}, status=status_cod)
                motivo = (str(datos.get('ajuste_motivo') or '').strip())[:200]
                signo = 'descuento' if precio < pl else 'aumento'
                quien = getattr(request.user, 'username', '') or 's/d'
                nota_ajuste = f'Precio de lista ${pl:,.2f} → ${precio:,.2f} ({signo}). Motivo: {motivo or "sin especificar"}. Autorizó: {quien}.'

        # ── Apartado (venta con anticipo) ────────────────────────────────
        # modo='apartado': el cliente deja un anticipo (≥ mínimo, o menos con código)
        # y el resto queda como saldo, a cobrar contra entrega. La unidad se reserva
        # (apartado), no se marca vendida hasta entregar.
        es_apartado = str(datos.get('modo') or '').lower() == 'apartado'
        anticipo_nota = ''
        if es_apartado:
            from ventas.models import evaluar_anticipo
            anticipo = sum((Decimal(str(p.get('monto', 0))) for p in pagos_limpios), Decimal('0'))
            anticipo_nota, err = evaluar_anticipo(precio, anticipo, datos.get('codigo_ajuste'), user=request.user)
            if err:
                return Response({'detalle': err['detalle']}, status=err['status'])

        venta = Venta(
            usuario=request.user if request.user.is_authenticated else None,
            nombre_cliente=(datos.get('nombre_cliente') or '').strip(),
            telefono_cliente=(datos.get('telefono_cliente') or '').strip(),
            metodo_pago=metodo_principal,
            **_campos_cliente(datos),
            cliente_usuario=cotizacion.usuario if cotizacion and cotizacion.usuario_id else None,
            inventario=unidad,
            precio_maquina=precio,
            cotizacion=cotizacion,
            nota_ajuste=nota_ajuste,
            estado='apartada' if es_apartado else 'activa',
            anticipo_nota=anticipo_nota,
            # IVA siempre (lo fuerza el modelo Venta). requiere_factura solo decide
            # si se registra la solicitud en la bandeja "Por facturar" (abajo).
        )
        try:
            venta.save()  # valida, calcula IVA y transiciona la unidad (vendida/apartada)
            # El cliente "gasta" su cupón personal (5% de bienvenida) SOLO ahora,
            # al concretarse la venta. Idempotente y a prueba de fallos: un tropiezo
            # marcando el cupón jamás debe tumbar una venta ya guardada.
            if cotizacion is not None and getattr(cotizacion, 'cupon_id', None):
                try:
                    cotizacion.cupon.marcar_usado()
                except Exception:
                    pass
            # Guarda pagos con forma estándar {fecha, monto, metodo, por} (como renta).
            # En venta normal, si no capturaron montos, cae al total completo. En un
            # apartado NUNCA se rellena el total: se guarda solo el anticipo.
            try:
                from django.utils import timezone as _tz
                total_pagar = Decimal(str(venta.total or 0))
                suma = sum((Decimal(str(p.get('monto', 0))) for p in pagos_limpios), Decimal('0'))
                if not es_apartado and suma <= 0 and total_pagar > 0:
                    pagos_limpios = [{'metodo': metodo_principal, 'monto': str(total_pagar)}]
                sello = _tz.now().isoformat()
                por = request.user.get_username() if request.user.is_authenticated else ''
                venta.pagos = [
                    {'fecha': sello, 'monto': p['monto'], 'metodo': p['metodo'], 'por': por}
                    for p in pagos_limpios
                ]
                venta.save(update_fields=['pagos', 'metodo_pago'])
            except Exception:
                pass
            # El cobro entra al turno DENTRO de la misma transacción que la venta:
            # una venta registrada sin su movimiento dejaría el arqueo corto y
            # nadie se enteraría hasta el corte.
            if desde_caja:
                _mov, turno_abierto_ahora = registrar_cobro_en_caja(
                    request.user,
                    monto=venta.total, metodo_pago=venta.metodo_pago,
                    concepto=f'Venta {venta.folio or ("#" + str(venta.id))} · {unidad.codigo}',
                    venta=venta,
                )
        except ValueError as e:
            return Response({'detalle': str(e)}, status=400)
        try:
            from maquinaria.models import crear_notificacion
            equipo_nombre = unidad.equipo.modelo if unidad.equipo else 'Equipo'
            _saldo = venta.saldo_pendiente()
            # ── BROADCAST de operación para STAFF (3ª persona) ──────────────
            if es_apartado:
                titulo_staff = f'Apartado registrado · {equipo_nombre}'
                cuerpo_staff = (
                    f'{venta.nombre_cliente or "Cliente"} apartó {unidad.codigo}: '
                    f'anticipo ${venta.pagado():,.2f} de ${venta.total:,.2f} (saldo ${_saldo:,.2f}).'
                )
            else:
                titulo_staff = f'Venta registrada · {equipo_nombre}'
                cuerpo_staff = f'{venta.nombre_cliente or "Cliente"} compró {unidad.codigo} por ${venta.total} ({venta.metodo_pago}).'
            crear_notificacion(
                'venta',
                titulo_staff,
                cuerpo_staff,
                seccion='pedidos' if es_apartado else 'ventas',
                data={'venta_id': venta.id, 'inventario_id': unidad.id, 'equipo_id': unidad.equipo_id, 'codigo': unidad.codigo},
            )
            # ── NOTIFICACIÓN PERSONAL para el CLIENTE (2ª persona) ──────────
            if venta.cliente_usuario_id:
                _met = {'efectivo': 'efectivo', 'tarjeta': 'tarjeta', 'transferencia': 'transferencia'}.get(
                    venta.metodo_pago, venta.metodo_pago or 'pago'
                )
                try:
                    if es_apartado:
                        titulo_cli = f'Apartaste {equipo_nombre}'
                        cuerpo_cli = (
                            f'Dejaste ${venta.pagado():,.2f} de anticipo en {_met}; saldo ${venta.saldo_pendiente():,.2f}. '
                            f'REMALI te contacta para coordinar el pago y la entrega.'
                        )
                    else:
                        titulo_cli = f'Compraste {equipo_nombre}'
                        cuerpo_cli = f'Pagaste ${venta.total} en {_met}. Tu código de unidad es {unidad.codigo}; REMALI te contacta pronto para coordinar la entrega.'
                    crear_notificacion(
                        'venta',
                        titulo_cli,
                        cuerpo_cli,
                        seccion='mis-compras',
                        ref=f'compra-cliente-{venta.id}',
                        usuario=venta.cliente_usuario,
                        data={
                            'venta_id': venta.id, 'inventario_id': unidad.id,
                            'equipo_id': unidad.equipo_id, 'codigo': unidad.codigo,
                            'accion_cliente': 'apartaste' if es_apartado else 'compraste',
                        },
                    )
                except Exception:
                    pass
        except Exception:
            pass

        # Solicitud de factura (si el cliente la pedirá) → bandeja "por facturar".
        if datos.get('requiere_factura'):
            try:
                from facturacion.models import SolicitudFactura
                equipo_nombre = unidad.equipo.modelo if unidad.equipo else 'Equipo'
                SolicitudFactura.registrar(
                    venta=venta,
                    cliente=venta.cliente if venta.cliente_id else None,
                    receptor=datos.get('factura') or {},
                    forma_pago=venta.metodo_pago,
                    concepto=f'Venta de {equipo_nombre} ({unidad.codigo})',
                )
            except Exception:
                # La venta/renta ya quedó registrada; que no truene por facturación.
                logger.exception('No se pudo registrar la solicitud de factura de la venta de equipo')

    unidad.refresh_from_db()
    return Response({
        'detalle': 'Apartado registrado' if es_apartado else 'Venta registrada',
        # La caja lo usa para avisar "se abrió tu turno con fondo $0".
        'turno_abierto': bool(desde_caja and turno_abierto_ahora),
        'venta': {
            'id': venta.id,
            'nombre_cliente': venta.nombre_cliente,
            'subtotal': str(venta.subtotal),
            'iva': str(venta.iva),
            'total': str(venta.total),
            'pagado': str(venta.pagado()),
            'saldo': str(venta.saldo_pendiente()),
            'estado': venta.estado,
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
    permission_classes = [PuedeGestionarReparaciones]

    def get_permissions(self):
        # Los dos trabajos del taller entran por la misma ruta. RECIBIR una
        # máquina es hacer el trabajo (el técnico, desde Mi jornada); LISTAR el
        # historial completo es llevar el taller, y eso es la sección.
        if self.request.method == 'POST':
            return [PuedeReparar()]
        return super().get_permissions()

    def get_queryset(self):
        from django.db.models import Q
        qs = OrdenReparacion.objects.all().select_related('cliente', 'unidad', 'unidad__equipo').prefetch_related('items', 'items__refaccion')
        p = self.request.query_params
        estado = (p.get('estado') or '').strip().lower()
        if estado in ('recibida', 'proceso', 'terminada', 'entregada'):
            qs = qs.filter(estado=estado)
        q = (p.get('q') or '').strip()
        if q:
            qs = qs.filter(Q(folio__icontains=q) | Q(cliente_nombre__icontains=q) | Q(equipo_descripcion__icontains=q) | Q(cliente__nombre__icontains=q))
        return qs

    def perform_create(self, serializer):
        orden = serializer.save()
        # Al abrir una orden interna, la unidad propia entra a mantenimiento.
        _sincronizar_estado_unidad(orden)


class OrdenReparacionDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = OrdenReparacionSerializer
    permission_classes = [PuedeReparar]
    queryset = OrdenReparacion.objects.all().select_related('cliente', 'unidad', 'unidad__equipo').prefetch_related('items', 'items__refaccion')

    def get_permissions(self):
        # Abrir y avanzar la orden es reparar. BORRARLA no: reintegra el stock
        # que ya se consumió y se lleva el rastro del trabajo, así que se queda
        # con quien lleva el taller.
        if self.request.method == 'DELETE':
            return [PuedeGestionarReparaciones()]
        return super().get_permissions()

    def perform_update(self, serializer):
        from django.utils import timezone
        estado_antes = serializer.instance.estado
        orden = serializer.save()
        # Al marcar entregada, fija la fecha de entrega si no la tiene
        if orden.estado == 'entregada' and not orden.fecha_entrega:
            orden.fecha_entrega = timezone.now()
            orden.save(update_fields=['fecha_entrega'])
        # Aviso al cliente CON cuenta cada vez que su reparación avanza de etapa.
        if orden.usuario_id and orden.tipo == 'cliente' and orden.estado != estado_antes:
            _avisar_avance_reparacion(orden)
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
@permission_classes([PuedeReparar])
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
@permission_classes([PuedeReparar])
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


@api_view(['POST'])
@permission_classes([PuedeReparar])   # se entrega al recibir la máquina
def generar_vinculo_orden(request, pk: int):
    """Liga de un solo uso para que el cliente ligue esta orden a su cuenta."""
    import secrets
    from datetime import timedelta
    from django.utils import timezone
    try:
        o = OrdenReparacion.objects.get(pk=pk)
    except OrdenReparacion.DoesNotExist:
        return Response({'detalle': 'Orden no encontrada'}, status=404)
    if o.tipo != 'cliente':
        return Response({'detalle': 'Solo las órdenes de equipo de cliente se ligan a una cuenta.'}, status=400)
    o.token_vinculo = secrets.token_hex(16)
    o.token_vinculo_expira = timezone.now() + timedelta(days=30)
    o.save(update_fields=['token_vinculo', 'token_vinculo_expira'])
    # Ruta RELATIVA: el frontend le antepone su origen (dev, túnel o producción).
    return Response({'token': o.token_vinculo, 'ruta': f'/vincular/reparacion/{o.token_vinculo}', 'expira': o.token_vinculo_expira})


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def vinculo_orden(request, token: str):
    """GET previsualiza la orden de la liga; POST la liga a la cuenta (un solo uso)."""
    from django.utils import timezone
    o = OrdenReparacion.objects.select_related('unidad', 'unidad__equipo').filter(token_vinculo=token).first()
    if not o:
        return Response({'detalle': 'Enlace no válido o ya utilizado.'}, status=404)
    if o.token_vinculo_expira and o.token_vinculo_expira < timezone.now():
        return Response({'detalle': 'Este enlace ya caducó. Pide uno nuevo.'}, status=410)

    if request.method == 'GET':
        return Response({
            'tipo': 'reparacion', 'id': o.id, 'fecha': o.fecha_recibida, 'total': str(o.total),
            'cliente': o.cliente_nombre or '', 'concepto': f'{o.folio} · {o.equipo_display}',
            'ya_ligada': bool(o.usuario_id),
        })

    if o.usuario_id and o.usuario_id != request.user.id:
        return Response({'detalle': 'Esta orden ya está en otra cuenta.'}, status=400)
    o.usuario = request.user
    o.token_vinculo = None
    o.token_vinculo_expira = None
    o.save(update_fields=['usuario', 'token_vinculo', 'token_vinculo_expira'])
    return Response({'detalle': 'Listo: la orden quedó en tu cuenta.', 'id': o.id})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def reparaciones_mias(request):
    """Órdenes de reparación del cliente en sesión (ligadas por la liga)."""
    ESTADO_LABEL = {'recibida': 'Recibida', 'proceso': 'En proceso', 'terminada': 'Lista para recoger', 'entregada': 'Entregada'}
    qs = (OrdenReparacion.objects.filter(usuario=request.user)
          .select_related('unidad', 'unidad__equipo').prefetch_related('items')
          .order_by('-fecha_recibida')[:100])
    data = [{
        'id': o.id, 'folio': o.folio, 'estado': o.estado, 'estado_label': ESTADO_LABEL.get(o.estado, o.estado),
        'equipo': o.equipo_display, 'diagnostico': o.diagnostico, 'trabajo_realizado': o.trabajo_realizado,
        'total': str(o.total), 'fecha_recibida': o.fecha_recibida, 'fecha_entrega': o.fecha_entrega,
        'token_publico': o.token_publico,
        # La orden solo se puede descargar cuando administración ya puso el costo
        # de mano de obra: si no, estaría incompleta (faltaría ese cargo al total).
        'mano_obra_definida': (o.costo_mano_obra or 0) > 0,
    } for o in qs]
    return Response({'reparaciones': data})


def _avisar_avance_reparacion(orden):
    """Notifica al cliente ligado el cambio de etapa de su reparación."""
    from maquinaria.models import crear_notificacion
    MSG = {
        'proceso': ('Tu reparación va en proceso', f'Ya estamos trabajando en {orden.equipo_display} ({orden.folio}).'),
        'terminada': ('¡Tu equipo está listo!', f'{orden.equipo_display} ({orden.folio}) quedó listo para entrega.'),
        'entregada': ('Reparación entregada', f'Entregamos {orden.equipo_display} ({orden.folio}). ¡Gracias!'),
    }
    t = MSG.get(orden.estado)
    if not t:
        return
    try:
        crear_notificacion('sistema', t[0], t[1], seccion='reparaciones',
                           ref=f'rep-{orden.id}-{orden.estado}', usuario=orden.usuario,
                           data={'folio': orden.folio})
    except Exception:
        pass


# Etiquetas de cara al cliente (la liga pública y "Mis reparaciones").
ETAPA_LABEL_CLIENTE = {'recibida': 'Recibida', 'proceso': 'En proceso', 'terminada': 'Lista para entrega', 'entregada': 'Entregada'}


@api_view(['GET'])
@permission_classes([AllowAny])
@throttle_classes([TokenPublicoThrottle])
def seguimiento_orden(request, token):
    """Liga PÚBLICA de seguimiento: el cliente sin cuenta ve el avance de su
    reparación (sin costos ni datos internos)."""
    token = (token or '').strip()
    o = OrdenReparacion.objects.filter(token_publico=token).first() if token else None
    if not o:
        return Response({'detalle': 'No encontramos esa reparación.'}, status=404)
    return Response({
        'folio': o.folio, 'estado': o.estado, 'estado_label': ETAPA_LABEL_CLIENTE.get(o.estado, o.estado),
        'tipo': o.tipo, 'equipo': o.equipo_display, 'diagnostico': o.diagnostico,
        # El trabajo/diagnóstico del técnico, para que el cliente sepa qué tenía y
        # qué se le hizo lo antes posible (se va viendo en vivo con el sondeo).
        'trabajo_realizado': o.trabajo_realizado,
        'cliente': o.cliente_display,
        'fecha_recibida': o.fecha_recibida, 'fecha_entrega': o.fecha_entrega,
        # Solo se habilita la descarga de la orden cuando ya hay mano de obra.
        'mano_obra_definida': (o.costo_mano_obra or 0) > 0,
    })


def _orden_pdf_response(orden):
    """Arma la respuesta HTTP con el PDF de la orden (para descargar)."""
    from django.http import HttpResponse
    from .pdf import render_orden_reparacion_pdf
    pdf = render_orden_reparacion_pdf(orden)
    resp = HttpResponse(pdf, content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename="{orden.folio or "orden"}.pdf"'
    return resp


_ORDEN_PDF_QS = (OrdenReparacion.objects
                 .select_related('unidad', 'unidad__equipo', 'cliente')
                 .prefetch_related('items', 'items__refaccion'))

# Mensaje único cuando la orden aún no puede descargarla el cliente.
_ORDEN_INCOMPLETA_MSG = ('Tu orden todavía no está lista para descargar: falta '
                         'que administración agregue el costo de mano de obra.')


def _orden_lista_para_cliente(orden):
    """El cliente solo puede ver/descargar su orden cuando ya tiene el costo de
    mano de obra; si no, estaría incompleta (faltaría ese cargo en el total)."""
    return (orden.costo_mano_obra or 0) > 0


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def orden_reparacion_pdf_mia(request, pk):
    """Descarga del PDF de la orden para el cliente en sesión (solo la suya)."""
    orden = _ORDEN_PDF_QS.filter(pk=pk, usuario=request.user).first()
    if not orden:
        return Response({'detalle': 'No encontramos esa reparación.'}, status=404)
    if not _orden_lista_para_cliente(orden):
        return Response({'detalle': _ORDEN_INCOMPLETA_MSG}, status=409)
    return _orden_pdf_response(orden)


@api_view(['GET'])
@permission_classes([AllowAny])
@throttle_classes([TokenPublicoThrottle])
def orden_reparacion_pdf_publico(request, token):
    """Descarga del PDF por la liga PÚBLICA (el token secreto que comparte el
    admin con el cliente sin cuenta)."""
    token = (token or '').strip()
    orden = _ORDEN_PDF_QS.filter(token_publico=token).first() if token else None
    if not orden:
        return Response({'detalle': 'No encontramos esa reparación.'}, status=404)
    if not _orden_lista_para_cliente(orden):
        return Response({'detalle': _ORDEN_INCOMPLETA_MSG}, status=409)
    return _orden_pdf_response(orden)


@api_view(['GET'])
@permission_classes([AllowAny])
@throttle_classes([TokenPublicoThrottle])
def unidad_qr(request, codigo):
    """La página detrás del QR pegado en la máquina.

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
            'cliente': r.cliente_texto or '',
            'lugar': (r.obra.ubicacion if r.obra_id and r.obra.ubicacion else r.direccion) or '',
            'fecha_inicio': r.fecha_inicio,
            'fecha_fin': r.fecha_fin,
            'entregada': bool(r.entregada_en),
            'adeudo': str(saldo) if saldo > 0 else None,
        }
    return Response(datos)
