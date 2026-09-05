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
from server.rastro import tragado


def _digitos(valor) -> str:
    return ''.join(c for c in (valor or '') if c.isdigit())[:10]


def cuenta_de(cliente, contacto=None):
    """La cuenta de la tienda de este cliente, si alguien de su ficha tiene una.

    Existe porque el mostrador dejaba el documento a medias: `resolver_cliente`
    devolvía la FICHA y ahí paraba, así que una renta capturada a mano para
    alguien que sí tiene cuenta quedaba en su ficha pero NO en "Tus rentas" —
    había que acordarse de vincularla después, y nadie se acuerda. El cliente
    entraba a su panel y no veía la máquina que tenía en la obra.

    Se prefiere el contacto que atendió la operación; si ese no tiene cuenta, la
    del contacto principal. Unir aquí no rompe la regla de "nunca por teléfono":
    quien atiende YA confirmó de quién se trata al elegirlo en el buscador, y
    esta cuenta cuelga de esa misma ficha.
    """
    if contacto is not None and getattr(contacto, 'usuario_id', None):
        return contacto.usuario
    if cliente is None:
        return None
    con = (cliente.contactos.filter(usuario__isnull=False)
           .order_by('-principal', 'id').select_related('usuario').first())
    return con.usuario if con else None


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
        'garantias_vigentes': garantias_vigentes(cliente),
    }


def garantias_vigentes(cliente) -> list:
    """Las garantías vivas del cliente. Es la pregunta que llega al mostrador:
    "se me descompuso, ¿todavía está en garantía?"."""
    from django.utils import timezone
    hoy = timezone.localdate()
    return [
        {'id': g.id, 'descripcion': g.descripcion, 'vence': g.vence,
         'dias_restantes': g.dias_restantes}
        for g in cliente.garantias.filter(anulada_en__isnull=True, vence__gte=hoy)
    ]


def registrar_cuenta_nueva(user):
    """Alguien se registró en la tienda: nace su ficha en el padrón, ya ligada.

    ANTES el contacto nacía SIN `Cliente`, a la espera de que alguien decidiera
    a qué ficha pertenecía. El razonamiento era que crear fichas solas ensucia
    un padrón curado a mano — y es cierto—, pero el precio resultó peor: cada
    cuenta se quedaba en un limbo que decía "sin vincular", sin historial y sin
    poder recibir una renta, hasta que alguien se acordara de resolverla. El
    padrón quedaba limpio y vacío mientras la operación pasaba por fuera.

    Quien abre una cuenta ES un cliente. Que la ficha nazca no impide curarla:
    si el teléfono ya era de otro, la ficha sale marcada `requiere_revision` y
    aparece en la bandeja para FUNDIRSE —que es la herramienta correcta para un
    duplicado y ya existe—, en vez de no existir.

    Lo que NO se hace, y sigue siendo la regla de la casa: unir por teléfono sin
    que una persona lo confirme. La coincidencia se señala, nunca se aplica.
    """
    from maquinaria.models import crear_notificacion

    perfil = getattr(user, 'perfil', None)
    telefono = _digitos(getattr(perfil, 'telefono', ''))
    nombre = (user.get_full_name() or '').strip() or user.get_username()

    pista = Cliente.buscar_por_telefono(telefono).first() if telefono else None

    cli = Cliente(tipo=Cliente.FISICA, nombre=nombre, telefono=telefono, email=(user.email or ''))
    if pista:
        cli.requiere_revision = True
        cli.revision_motivo = (f'Abrió cuenta en la tienda y su teléfono {telefono} '
                               f'ya es de "{pista.nombre}". Si es la misma persona, fusiona las fichas.')
    cli.save()

    contacto = Contacto.objects.create(
        cliente=cli, nombre=nombre, telefono=telefono, email=user.email, usuario=user, principal=True,
    )

    mensaje = f'{user.email or nombre} se registró en la tienda y ya tiene su ficha.'
    if pista:
        mensaje += f' Ojo: ese teléfono ya es de "{pista.nombre}" — si es la misma persona, funde las fichas.'

    try:
        crear_notificacion(
            'sistema', f'Cuenta nueva: {nombre}', mensaje,
            seccion='clientes', ref=f'cuenta-{user.id}',
            data={'contacto_id': contacto.id, 'usuario_id': user.id,
                  'cliente_id': cli.id,
                  'cliente_sugerido': pista.id if pista else None},
        )
    except Exception:
        # Un aviso que falla no debe impedir que alguien se registre.
        tragado()
    return contacto
