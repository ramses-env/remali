from django.urls import path
from . import views
from . import caja_views

urlpatterns = [
    path('ventas/lista/', views.listar_ventas, name='ventas-lista'),
    path('ventas/stats/', views.ventas_stats),
    path('ventas/export/', views.exportar_ventas_csv, name='ventas-export'),
    path('ventas/mias/', views.ventas_mias, name='ventas-mias'),
    # Pedidos y apartados (ventas con anticipo)
    path('ventas/pedidos/', views.pedidos_adeudos, name='ventas-pedidos'),
    path('ventas/pedidos/crear/', views.crear_pedido, name='ventas-pedido-crear'),
    path('ventas/mostrador/', views.venta_mostrador, name='ventas-mostrador'),
    path('ventas/corte/', views.corte_caja, name='ventas-corte'),
    # Caja: sesiones (turnos) y movimientos. La caja es aparte del rol/permiso.
    path('caja/sesion-actual/', caja_views.sesion_actual, name='caja-sesion-actual'),
    path('caja/sesiones/', caja_views.sesiones_lista, name='caja-sesiones'),
    path('caja/sesiones/abrir/', caja_views.abrir_sesion, name='caja-abrir'),
    path('caja/sesiones/<int:pk>/', caja_views.sesion_detalle, name='caja-sesion-detalle'),
    path('caja/sesiones/<int:pk>/cerrar/', caja_views.cerrar_sesion, name='caja-cerrar'),
    path('caja/sesiones/<int:pk>/movimiento/', caja_views.movimiento_caja, name='caja-movimiento'),
    path('caja/ventas-recientes/', caja_views.ventas_recientes, name='caja-ventas-recientes'),
    path('caja/devolucion/', caja_views.devolucion_caja, name='caja-devolucion'),
    path('ventas/<int:pk>/abono/', views.registrar_abono_venta, name='ventas-abono'),
    path('ventas/<int:pk>/entregar/', views.entregar_venta, name='ventas-entregar'),
    # Sacar UNA máquina de una venta de varias (acción sensible: pide código).
    path('ventas/<int:pk>/maquinas/<int:linea_id>/quitar/', views.quitar_maquina_venta, name='ventas-quitar-maquina'),
    path('ventas/<int:pk>/pedido-fase/', views.actualizar_pedido_fase, name='ventas-pedido-fase'),
    path('ventas/<int:pk>/cancelar/', views.cancelar_venta, name='ventas-cancelar'),
    path('ventas/<int:pk>/comprobante/', views.comprobante_venta, name='ventas-comprobante'),
    path('ventas/<int:pk>/ticket/', views.ticket_venta, name='ventas-ticket'),
    path('ventas/<int:pk>/por-facturar/', views.mandar_por_facturar_venta, name='ventas-por-facturar'),
    path('ventas/<int:pk>/vinculo/', views.generar_vinculo_venta, name='ventas-vinculo'),
    path('vinculo/venta/<str:token>/', views.vinculo_venta, name='ventas-vinculo-reclamar'),
]
