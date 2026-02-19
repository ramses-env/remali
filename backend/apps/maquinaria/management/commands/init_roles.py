from django.core.management.base import BaseCommand
from django.contrib.auth.models import Group, Permission
from django.contrib.contenttypes.models import ContentType
from maquinaria.models import Categoria, Cupon, Orden, ItemOrden, Marca, Equipo, ImagenProducto

class Command(BaseCommand):
    help = 'Inicializa roles y permisos: Administrador, Cliente, Almacén'

    def handle(self, *args, **options):
        # Crear grupos
        admin_group, _ = Group.objects.get_or_create(name='Administrador')
        client_group, _ = Group.objects.get_or_create(name='Cliente')
        warehouse_group, _ = Group.objects.get_or_create(name='Almacén')

        # Recolectar permisos del app maquinaria
        maquinaria_models = [Categoria, Cupon, Orden, ItemOrden, Marca, Equipo, ImagenProducto]
        perms = Permission.objects.filter(content_type__in=[ContentType.objects.get_for_model(m) for m in maquinaria_models])

        # Administrador: todos los permisos del app maquinaria
        admin_group.permissions.set(perms)

        # Cliente: puede crear órdenes y ver productos/categorías/cupones
        client_perms = []
        def add_perm(codename, model):
            ct = ContentType.objects.get_for_model(model)
            p = Permission.objects.get(content_type=ct, codename=codename)
            client_perms.append(p)
        add_perm('add_orden', Orden)
        add_perm('add_itemorden', ItemOrden)
        add_perm('view_equipo', Equipo)
        add_perm('view_categoria', Categoria)
        add_perm('view_cupon', Cupon)
        client_group.permissions.set(client_perms)

        # Almacén: ajustar inventario y ver productos/categorías
        warehouse_perms = []
        def maybe_perm(codename, model):
            ct = ContentType.objects.get_for_model(model)
            try:
                p = Permission.objects.get(content_type=ct, codename=codename)
                warehouse_perms.append(p)
            except Permission.DoesNotExist:
                pass
        # maybe_perm('adjust_inventory', Equipo) # Custom perm not defined yet
        maybe_perm('view_equipo', Equipo)
        maybe_perm('view_categoria', Categoria)
        Group.objects.filter(name='Almacén').update()
        warehouse_group.permissions.set(warehouse_perms)

        self.stdout.write(self.style.SUCCESS('Roles y permisos inicializados'))
