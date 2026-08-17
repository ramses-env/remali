"""Cómo un documento consigue su cliente. UN solo lugar.

Venta de maquinaria, renta, cotización y caja hacen lo mismo —averiguar a quién
le están vendiendo— y sin esto serían cuatro implementaciones que se van
separando con el tiempo. Aquí vive la regla, y las cuatro la llaman.

LA REGLA (§5.1 del diseño): el backend **nunca une por teléfono sin
confirmación**. Recibe `cliente_id` y lo usa, o crea uno nuevo. Unir es siempre
decisión de una persona —el vendedor confirmando en el buscador, o REMALI
vinculando una cuenta a mano—.

Si al crear resulta que el teléfono ya existía, no se funde: se marca
`requiere_revision` con el motivo, para que el duplicado se vea en la bandeja en
vez de esconderse.
"""
from .models import Cliente, Contacto


def _digitos(valor) -> str:
    return ''.join(c for c in (valor or '') if c.isdigit())[:10]


def resolver_cliente(*, cliente_id=None, contacto_id=None, nombre='', telefono='', tipo=None):
    """Devuelve (cliente, contacto). Cualquiera de los dos puede ser None.

    - Con `cliente_id`: se usa ese y ya. Es el camino normal desde el panel,
      donde el vendedor ya confirmó de quién se trata.
    - Sin él, pero con nombre o teléfono: se CREA uno nuevo.
    - Sin nada: (None, None). La caja vende sin cliente y está bien.
    """
    if cliente_id:
        cli = Cliente.objects.filter(pk=cliente_id).first()
        if cli is None:
            return None, None
        contacto = None
        if contacto_id:
            contacto = cli.contactos.filter(pk=contacto_id).first()
        return cli, (contacto or cli.contacto_principal)

    nombre = (nombre or '').strip()
    telefono = _digitos(telefono)
    if not nombre and not telefono:
        return None, None

    cli = Cliente(
        tipo=tipo or Cliente.FISICA,
        nombre=nombre or 'Cliente de mostrador',
        telefono=telefono,
    )
    if telefono:
        ya = Cliente.buscar_por_telefono(telefono).first()
        if ya:
            cli.requiere_revision = True
            cli.revision_motivo = f'El teléfono {telefono} ya es de "{ya.nombre}".'
    elif not nombre:
        cli.requiere_revision = True
        cli.revision_motivo = 'Se creó sin nombre ni teléfono.'
    cli.save()

    contacto = Contacto.objects.create(
        cliente=cli, nombre=cli.nombre, telefono=telefono, principal=True,
    )
    return cli, contacto


def resumen_de(cliente) -> dict:
    """Lo que el mostrador necesita ver ANTES de vender.

    El dinero sale del MISMO cálculo que la ficha (`cuenta.estado_de_cuenta`),
    no de una versión aparte: la cifra que el cliente ve en el mostrador es la
    que alguien va a discutir, y no puede diferir de la del panel.
    """
    from .cuenta import estado_de_cuenta
    cuenta = estado_de_cuenta(cliente)
    return {
        'compras': cliente.ventas.exclude(estado='cancelada').count(),
        'rentas_activas': cliente.rentas.filter(estado__in=['activa', 'reservada']).count(),
        'rentas': cliente.rentas.exclude(estado='cancelada').count(),
        'cotizaciones': cliente.cotizaciones.count(),
        'reparaciones': cliente.reparaciones.count(),
        'saldo': cuenta['saldo'],
        'credito_a_favor': cuenta['credito_a_favor'],
        'tiene_adeudo': cuenta['tiene_adeudo'],
        'tiene_credito': cuenta['tiene_credito'],
    }
