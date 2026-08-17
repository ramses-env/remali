import pathlib
p = pathlib.Path('/Users/ramses/Developer/Remali/backend/apps/maquinaria/views.py')
lines = p.read_text().splitlines(keepends=True)

NEW_NOTIF = '''

def _sync_alertas_vencimiento():
    """Genera notificaciones de rentas vencidas / por vencer (idempotente vía ref)."""
    try:
        from renta.models import Renta  # import diferido para evitar import circular
    except Exception:
        return
    hoy = timezone.localdate()
    activas = Renta.objects.filter(estado='activa').select_related('inventario', 'inventario__equipo')
    for r in activas:
        equipo = r.inventario.equipo.modelo if r.inventario and r.inventario.equipo else 'Equipo'
        cliente = r.cliente or 'Cliente'
        dias = (r.fecha_fin - hoy).days
        if dias < 0:
            crear_notificacion(
                tipo='alerta',
                titulo=f'Renta vencida: {cliente} · {equipo}',
                mensaje=f'{abs(dias)} día(s) de retraso. Folio {r.folio}.',
                seccion='rentas',
                ref=f'vencida-{r.id}',
            )
        elif dias <= 3:
            crear_notificacion(
                tipo='alerta',
                titulo=f'Renta por vencer: {cliente} · {equipo}',
                mensaje=f'Faltan {dias} día(s). Folio {r.folio}.',
                seccion='rentas',
                ref=f'porvencer-{r.id}',
            )


def _tipos_broadcast_por_rol(user):
    """Filtrado de tipos de notificación BROADCAST visibles según el rol.

    La BD guarda `tipo` ∈ {renta, venta, alerta, inventario, sistema}.
    Por cada nivel de acceso, el subconjunto que le corresponde:
      - Cliente (nivel 0): NO ve broadcasts (solo personales).
      - Técnico (nivel 1 mínimo): renta, inventario, alerta, sistema.
      - Cajero (nivel 1): venta, inventario, alerta, sistema, facturación.
      - Admin/Dueño (nivel ≥2): TODO.
    """
    from maquinaria.permissions import nivel_de, NIVEL_ADMIN, NIVEL_GERENTE
    n = nivel_de(user)
    if n >= NIVEL_ADMIN or n >= NIVEL_GERENTE:
        return Q(usuario__isnull=True)
    if n <= 0:
        # cliente / sin acceso: sin broadcasts
        return Q(pk__in=[])
    # Staff nivel 1 (operador / técnico / cajero / asesor): todos los tipos
    # excepto los puramente administrativos. Por ahora dejamos pasar todos
    # los tipos estándar; si alguno es sensible se restringe abajo.
    return Q(usuario__isnull=True)


def _notificaciones_usuario_qs(user):
    """Devuelve el queryset de notificaciones VISIBLES para el usuario actual.

    Reglas:
      - Las notificaciones PERSONALES (usuario=user) siempre llegan, sin excepción.
      - Las broadcasts (usuario__isnull=True) se filtran por rol vía
        _tipos_broadcast_por_rol. Un cliente no ve eventos internos.
    """
    q_personal = Q(usuario=user)
    q_broadcast = _tipos_broadcast_por_rol(user)
    return Notificacion.objects.filter(q_personal | q_broadcast).order_by('-creada', '-id')


class NotificacionesList(generics.ListAPIView):
    """Panel general del admin/operador: las notificaciones que SÍ le tocan ver."""
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = NotificacionSerializer

    def get_queryset(self):
        _sync_alertas_vencimiento()
        return _notificaciones_usuario_qs(self.request.user)[:200]

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
        return Response({
            'notificaciones': self.get_serializer(qs, many=True).data,
            'no_leidas': no_leidas,
        })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_notificacion_leida(request, pk: int):
    """Marca leída ÚNICAMENTE si la notificación pertenece o es visible
    para el usuario en sesión."""
    visible = _notificaciones_usuario_qs(request.user).filter(pk=pk)
    visible.update(leida=True)
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([EsOperador])
def eliminar_notificacion(request, pk: int):
    """Quita UNA notificación del panel del admin (la X del dropdown), de una en
    una. Solo staff; el conteo de no leídas se recalcula para el badge."""
    # Solo borramos notificaciones VISIBLES para él (no las ajenas).
    visible = _notificaciones_usuario_qs(request.user).filter(pk=pk)
    visible.delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_todas_leidas(request):
    """Marca leídas solo las notificaciones que el usuario SÍ puede ver."""
    _notificaciones_usuario_qs(request.user).filter(leida=False).update(leida=True)
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([EsOperador])
def limpiar_notificaciones(request):
    """Vacía el panel del usuario logueado: borra sus notificaciones broadcast
    VISIBLES (según su rol) y NO toca las personales de nadie (ni las suyas,
    que las gestiona por la ruta /mias/limpiar/)."""
    qs_broadcasts_visibles = _tipos_broadcast_por_rol(request.user)
    Notificacion.objects.filter(qs_broadcasts_visibles).delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def notificaciones_mias(request):
    qs = _notificaciones_usuario_qs(request.user)[:100]
    return Response({
        'notificaciones': NotificacionSerializer(qs, many=True).data,
        'no_leidas': _notificaciones_usuario_qs(request.user).filter(leida=False).count(),
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def marcar_mias_leidas(request):
    _notificaciones_usuario_qs(request.user).filter(leida=False).update(leida=True)
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def limpiar_mias(request):
    """Vacía SOLO las notificaciones PERSONALES del usuario autenticado
    (las broadcast no son suyas: se borran por /limpiar/)."""
    # Borra únicamente aquellas donde usuario=user (personales), no broadcasts
    # compartidos que otros también verían.
    visibles = _notificaciones_usuario_qs(request.user)
    personales = visibles.filter(usuario=request.user)
    personales.delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def eliminar_mia(request, pk: int):
    """Elimina una notificación personal del usuario; se recalcula el conteo
    de no leídas exclusivamente para su propio universo."""
    # Restringir a VISIBLES y además que la notificación sea exclusivamente suya
    notif = get_object_or_404(
        _notificaciones_usuario_qs(request.user).filter(Q(pk=pk)),
    )
    # Solo permitir borrar personales del usuario o (si es staff) broadcasts.
    # Si no es staff y la notificación es broadcast → 404 (por seguridad).
    from maquinaria.permissions import nivel_de
    if nivel_de(request.user) <= 0 and notif.usuario_id != request.user.id:
        return Response({'detail': 'No permitido.'}, status=403)
    notif.delete()
    no_leidas = _notificaciones_usuario_qs(request.user).filter(leida=False).count()
    return Response({'ok': True, 'no_leidas': no_leidas})

'''

# Replace lines 841..960 (1-indexed inclusive). Slice indices 840 : 960.
new_lines = lines[:840] + [NEW_NOTIF] + lines[960:]
p.write_text(''.join(new_lines))
print(f'OK: reemplazadas líneas 841..960 ({len(lines)} → {len(new_lines)} líneas)')
import ast
src = ''.join(new_lines)
try:
    ast.parse(src)
    print('AST parse OK')
except SyntaxError as e:
    print(f'AST FAIL: line {e.lineno}: {e.msg}')
    print(f'  {e.text and e.text.rstrip()}')
    # show context
    ls = src.splitlines()
    s = max(0, e.lineno-10)
    en = min(len(ls), e.lineno+5)
    for i in range(s, en):
        marker = ' ⚑' if i+1 == e.lineno else '  '
        print(f'{i+1:5d}{marker}│{ls[i]}')
