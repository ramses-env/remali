"""Resumen de datos del negocio para el asistente.

Solo LECTURA y acotado: no se genera SQL ni se da acceso libre a la base. Se
arma un texto compacto que se le pasa al modelo como contexto. Respeta el rol:
un técnico NO ve montos, ventas ni cotizaciones (mismas reglas que el panel).

Cada bloque va envuelto en try/except: si un modelo cambia, el asistente sigue
respondiendo con lo demás en vez de reventar.
"""
from datetime import timedelta

from django.db.models import Count, Sum
from django.utils import timezone


def _es_admin(user):
    return bool(
        user.is_superuser
        or user.is_staff
        or user.groups.filter(name__iexact='Administrador').exists()
    )


def _es_tecnico(user):
    return user.groups.filter(name__iexact='Técnico').exists()


def rol_de(user):
    if _es_admin(user):
        return 'administrador'
    if _es_tecnico(user):
        return 'tecnico'
    return 'otro'


def _equipos():
    from maquinaria.models import Equipo
    total = Equipo.objects.count()
    lineas = [f'Modelos de equipo en catálogo: {total}']
    nombres = [n for n in Equipo.objects.values_list('modelo', flat=True)[:25] if n]
    if nombres:
        lineas.append('Equipos: ' + ', '.join(nombres))
    return lineas


def _inventario():
    from inventario.models import Inventario
    lineas = [f'Unidades físicas en inventario: {Inventario.objects.count()}']
    por_estado = Inventario.objects.values('estado').annotate(n=Count('id')).order_by('-n')
    if por_estado:
        lineas.append('Por estado: ' + ', '.join(f'{r["estado"] or "—"} ({r["n"]})' for r in por_estado))
    por_cond = Inventario.objects.values('condicion').annotate(n=Count('id')).order_by('-n')
    if por_cond:
        lineas.append('Por condición: ' + ', '.join(f'{r["condicion"] or "—"} ({r["n"]})' for r in por_cond))
    return lineas


def _rentas(incluir_montos):
    from renta.models import Renta
    hoy = timezone.localdate()
    activas = Renta.objects.filter(estado='activa')
    lineas = [f'Rentas activas: {activas.count()}']

    por_vencer = activas.filter(fecha_fin__gte=hoy, fecha_fin__lte=hoy + timedelta(days=7)).order_by('fecha_fin')
    lineas.append(f'Rentas por vencer (próximos 7 días): {por_vencer.count()}')
    for r in por_vencer[:10]:
        lineas.append(f'  - {r.cliente or "cliente s/n"}: vence {r.fecha_fin.strftime("%d/%m/%Y")}')

    vencidas = activas.filter(fecha_fin__lt=hoy)
    if vencidas.exists():
        lineas.append(f'Rentas VENCIDAS sin devolver: {vencidas.count()}')

    if incluir_montos:
        inicio_mes = hoy.replace(day=1)
        mes = Renta.objects.filter(creado_en__date__gte=inicio_mes)
        monto = mes.aggregate(s=Sum('total'))['s'] or 0
        lineas.append(f'Rentas creadas este mes: {mes.count()} por ${monto:,.2f}')
    return lineas


def _reparaciones():
    from inventario.models import OrdenReparacion
    por_estado = OrdenReparacion.objects.values('estado').annotate(n=Count('id')).order_by('-n')
    if not por_estado:
        return []
    return ['Órdenes de reparación: ' + ', '.join(f'{r["estado"]} ({r["n"]})' for r in por_estado)]


def _refacciones():
    from refacciones.models import Refaccion
    return [f'Refacciones registradas: {Refaccion.objects.count()}']


def _ventas():
    from ventas.models import Venta
    hoy = timezone.localdate()
    inicio_mes = hoy.replace(day=1)
    mes = Venta.objects.filter(fecha__date__gte=inicio_mes)
    monto = mes.aggregate(s=Sum('total'))['s'] or 0
    return [f'Ventas este mes: {mes.count()} por ${monto:,.2f}']


def _cotizaciones():
    from cotizaciones.models import Cotizacion
    por_estado = Cotizacion.objects.values('estado').annotate(n=Count('id')).order_by('-n')
    detalle = ', '.join(f'{r["estado"]} ({r["n"]})' for r in por_estado) or '—'
    return [f'Cotizaciones por estado: {detalle}']


def construir_contexto(user):
    """Texto compacto con los datos que el rol del usuario puede ver."""
    rol = rol_de(user)
    admin = rol == 'administrador'
    bloques = []

    def add(titulo, generador):
        try:
            lineas = generador()
        except Exception:
            return
        if lineas:
            bloques.append(f'[{titulo}]\n' + '\n'.join(lineas))

    add('EQUIPOS', _equipos)
    add('INVENTARIO', _inventario)
    add('RENTAS', lambda: _rentas(incluir_montos=admin))
    add('REPARACIONES', _reparaciones)
    add('REFACCIONES', _refacciones)
    if admin:
        add('VENTAS', _ventas)
        add('COTIZACIONES', _cotizaciones)

    fecha = timezone.localdate().strftime('%d/%m/%Y')
    encabezado = (
        f'Datos de REMALI al {fecha}. Rol de quien pregunta: {rol}. '
        'Si el rol es técnico, no hay datos de dinero/ventas a propósito.'
    )
    return encabezado + '\n\n' + '\n\n'.join(bloques)
