"""Latido del panel: sellos de "última modificación" por tema.

Cada save/delete de un modelo del negocio toca su(s) tema(s) vía señales;
GET /latido/ devuelve todos los sellos en una consulta de ~20 filas y el
panel invalida SOLO los temas que se movieron. Así dos admins en PCs
distintas se ven los cambios entre sí en un par de segundos, sin
websockets ni infra nueva.
"""
from django.apps import apps as django_apps
from django.db.models.signals import post_save, post_delete
from server.rastro import tragado

# Modelo → temas del bus del frontend (lib/realtime.ts) que invalida.
REGISTRO = {
    'maquinaria.Equipo': ('equipos',),
    'maquinaria.Categoria': ('catalogos', 'equipos'),
    'maquinaria.Tipo': ('catalogos', 'equipos'),
    'maquinaria.Marca': ('catalogos', 'equipos'),
    'maquinaria.Cupon': ('cupones',),
    'maquinaria.ConfiguracionSitio': ('config',),
    'maquinaria.PerfilUsuario': ('usuarios',),
    'maquinaria.PermisoRol': ('permisos',),
    # Crear, renombrar o borrar un puesto cambia lo que puede la gente que lo
    # tiene, y también el selector de rol de Usuarios: los dos se refrescan.
    'maquinaria.Rol': ('permisos', 'usuarios'),
    'maquinaria.Notificacion': ('notificaciones',),
    'inventario.Inventario': ('unidades', 'equipos'),
    'inventario.Mantenimiento': ('reparaciones', 'unidades'),
    'inventario.OrdenReparacion': ('reparaciones',),
    'inventario.OrdenReparacionItem': ('reparaciones',),
    'refacciones.Refaccion': ('refacciones',),
    'clientes.Cliente': ('clientes',),
    'clientes.Contacto': ('clientes',),
    'clientes.Obra': ('clientes',),
    'cotizaciones.Cotizacion': ('cotizaciones', 'metricas'),
    'cotizaciones.CotizacionItem': ('cotizaciones',),
    'cotizaciones.CotizacionFoto': ('cotizaciones',),
    'renta.Renta': ('rentas', 'metricas'),
    'ventas.Venta': ('ventas', 'metricas'),
    'facturacion.SolicitudFactura': ('facturacion',),
}


def tocar(*temas):
    """Avanza el sello de los temas dados. Ojo: los .update() de queryset no
    disparan señales; si un flujo solo hace .update(), que llame esto a mano."""
    from .models import SelloTema
    for t in temas:
        obj, creado = SelloTema.objects.get_or_create(tema=t)
        if not creado:
            obj.save(update_fields=['marca'])   # auto_now avanza la marca


def _receptor(temas):
    def fn(sender, **kwargs):
        # `raw=True` es loaddata: restaurar un respaldo no es "algo cambió en el
        # negocio". Además los sellos que se crearían aquí chocan después con los
        # del propio respaldo por el índice único de `tema`.
        if kwargs.get('raw'):
            return
        try:
            tocar(*temas)
        except Exception:
            tragado()  # el latido jamás debe tumbar un guardado del negocio
    return fn


def conectar():
    for etiqueta, temas in REGISTRO.items():
        try:
            modelo = django_apps.get_model(etiqueta)
        except LookupError:
            continue  # app opcional que no está instalada
        fn = _receptor(temas)
        post_save.connect(fn, sender=modelo, weak=False)
        post_delete.connect(fn, sender=modelo, weak=False)
    # El modelo de usuario es swappable: se registra aparte.
    from django.contrib.auth import get_user_model
    fn = _receptor(('usuarios',))
    post_save.connect(fn, sender=get_user_model(), weak=False)
