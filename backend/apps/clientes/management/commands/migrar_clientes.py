"""Migra el histórico al padrón único de clientes.

Antes de esta app, a un mismo cliente se le nombraba de cuatro formas: `empresa`
FK, texto libre, cuenta ligada, o nada. Este comando lee todo eso y construye el
padrón, de lo más confiable a lo más dudoso:

  Empresa                     → Cliente moral            (1:1, sin ambigüedad)
  Cuenta con rol Cliente      → Cliente físico + Contacto (1:1)
  Documento con empresa FK    → apunta a ese cliente      (sin ambigüedad)
  Documento con cuenta ligada → apunta a ese cliente      (sin ambigüedad)
  Documento de puro texto     → se agrupa POR TELÉFONO
  Documento sin teléfono      → se queda huérfano, a propósito

Esa última línea es la decisión de diseño que más cambia el resultado: preferimos
dejar ventas sin dueño que inventar clientes falsos que después alguien tiene que
limpiar a mano. Quedan con su texto intacto y se pueden asignar cuando importe.

Lo que el comando NO adivina lo marca: `Cliente.requiere_revision`, con el motivo.

Uso:
    python manage.py migrar_clientes              # informe, NO escribe nada
    python manage.py migrar_clientes --aplicar    # escribe
    python manage.py migrar_clientes --revertir   # deshace (fase 1 es reversible)

El informe y la aplicación corren EXACTAMENTE el mismo código: el informe hace
todo el trabajo dentro de una transacción y la revierte al final. Lo que ves es
lo que va a pasar, no una estimación aparte que puede mentir.
"""
import unicodedata
from collections import defaultdict

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand
from django.db import transaction

from clientes.models import Cliente, Contacto
from cotizaciones.models import Cotizacion
from empresas.models import Empresa, Obra
from maquinaria.models import ObraCliente
from renta.models import Renta
from ventas.models import Venta

# Campos del DomicilioMixin que se copian tal cual de Empresa a Cliente.
CAMPOS_DOMICILIO = (
    'calle', 'numero_exterior', 'numero_interior', 'colonia', 'municipio',
    'ciudad', 'entidad', 'codigo_postal', 'pais', 'referencias', 'latitud', 'longitud',
)


class _Ensayo(Exception):
    """Corta la transacción del informe. No es un error: es el rollback."""


def _digitos(valor) -> str:
    return ''.join(c for c in (valor or '') if c.isdigit())[:10]


def _plano(texto: str) -> str:
    """Minúsculas, sin acentos y sin espacios de más, para comparar nombres.
    'Naomí  Pérez' y 'naomi perez' son la misma persona."""
    limpio = unicodedata.normalize('NFKD', (texto or '').strip().lower())
    limpio = ''.join(c for c in limpio if not unicodedata.combining(c))
    return ' '.join(limpio.split())


def _nombres_compatibles(a: str, b: str) -> bool:
    """¿Pueden ser la misma persona escrita distinto?

    Deliberadamente permisivo: 'Juan' vs 'Juan Pérez López' pasa (mostrador
    captura incompleto todo el tiempo), 'Juan Pérez' vs 'Ferretería el Roble'
    no. Los que no pasan no se separan: se unen igual y se marcan para que una
    persona decida — un teléfono recapturado es más probable que dos clientes
    con el mismo número, pero no es seguro.
    """
    pa, pb = _plano(a), _plano(b)
    if not pa or not pb:
        return True
    if pa == pb or pa.startswith(pb) or pb.startswith(pa):
        return True
    return pa.split()[0] == pb.split()[0]


def _es_cuenta_de_cliente(u: User) -> bool:
    """Misma regla que el panel (`views_usuarios._es_cliente`): sin rol de
    personal. El equipo interno NO entra al padrón de clientes."""
    if u.is_staff or u.is_superuser:
        return False
    grupos = [g.name for g in u.groups.all()]
    return not grupos or grupos == ['Cliente']


class Command(BaseCommand):
    help = 'Construye el padrón de clientes a partir del histórico (informe por defecto).'

    def add_arguments(self, parser):
        parser.add_argument('--aplicar', action='store_true',
                            help='Escribe los cambios. Sin esto solo informa.')
        parser.add_argument('--revertir', action='store_true',
                            help='Deshace la migración: vacía el padrón y suelta los FK.')

    # ─────────────────────────────────────────────
    def handle(self, *args, **opciones):
        if opciones['revertir']:
            return self._revertir(aplicar=opciones['aplicar'])

        aplicar = opciones['aplicar']
        self.notas = []          # casos marcados para revisión
        self.cuenta = defaultdict(int)

        try:
            with transaction.atomic():
                self._migrar()
                if not aplicar:
                    raise _Ensayo()
        except _Ensayo:
            pass

        self._imprimir(aplicar)

    # ─────────────────────────────────────────────
    #  MIGRACIÓN
    # ─────────────────────────────────────────────
    def _migrar(self):
        mapa_empresa = self._migrar_empresas()          # empresa_id → Cliente
        mapa_usuario = self._migrar_cuentas(mapa_empresa)  # user_id → Contacto
        self._migrar_obras(mapa_empresa, mapa_usuario)
        self._migrar_documentos(mapa_empresa, mapa_usuario)

    def _migrar_empresas(self):
        mapa = {}
        for e in Empresa.objects.all():
            datos = {c: getattr(e, c) for c in CAMPOS_DOMICILIO}
            cli = Cliente(
                tipo=Cliente.MORAL,
                nombre=e.nombre,
                razon_social=e.nombre,
                rfc=e.rfc,
                regimen_fiscal=e.regimen_fiscal,
                uso_cfdi=e.uso_cfdi,
                cp_fiscal=e.codigo_postal,
                email_fiscal=e.email,
                telefono=e.telefono,
                email=e.email,
                direccion=e.direccion,
                notas=e.notas,
                activo=e.activa,
                **datos,
            )
            cli.save()
            mapa[e.id] = cli
            self.cuenta['clientes_morales'] += 1
            # La "persona de contacto" de la empresa se vuelve su contacto
            # principal. Sin cuenta: es un nombre en un campo, no un login.
            if (e.contacto or '').strip():
                Contacto.objects.create(
                    cliente=cli, nombre=e.contacto, telefono=e.telefono,
                    email=e.email, principal=True,
                )
                self.cuenta['contactos_sin_cuenta'] += 1
        return mapa

    def _migrar_cuentas(self, mapa_empresa):
        """Cada cuenta de cliente se vuelve un Contacto. A quién pertenece ese
        contacto depende de si su `PerfilUsuario.empresa` (texto libre) casa con
        una Empresa real: si casa, es gente de esa constructora; si no, es un
        cliente físico por derecho propio."""
        por_nombre = {_plano(e_nombre): cli
                      for e_id, cli in mapa_empresa.items()
                      for e_nombre in [cli.nombre]}
        mapa = {}
        usuarios = User.objects.prefetch_related('groups').select_related('perfil')
        for u in usuarios:
            if not _es_cuenta_de_cliente(u):
                continue
            perfil = getattr(u, 'perfil', None)
            nombre = (u.get_full_name() or '').strip() or u.get_username()
            telefono = _digitos(getattr(perfil, 'telefono', ''))
            empresa_txt = (getattr(perfil, 'empresa', '') or '').strip()

            duena = por_nombre.get(_plano(empresa_txt)) if empresa_txt else None
            if duena is None:
                duena = Cliente(
                    tipo=Cliente.FISICA,
                    nombre=nombre,
                    telefono=telefono,
                    email=u.email,
                    razon_social=getattr(perfil, 'fiscal_razon_social', '') or '',
                    rfc=getattr(perfil, 'fiscal_rfc', '') or '',
                    regimen_fiscal=getattr(perfil, 'fiscal_regimen', '') or '',
                    uso_cfdi=getattr(perfil, 'fiscal_uso_cfdi', '') or '',
                    cp_fiscal=getattr(perfil, 'fiscal_cp', '') or '',
                    email_fiscal=getattr(perfil, 'fiscal_email', '') or '',
                    direccion=getattr(perfil, 'obra_direccion', '') or '',
                )
                if empresa_txt:
                    # Escribió una empresa que no existe en el catálogo. No la
                    # inventamos como cliente moral —sería crear constructoras
                    # a partir de un campo de texto sin validar—; se guarda el
                    # dato y que una persona decida.
                    duena.notas = f'Empresa capturada por el cliente: {empresa_txt}'
                    duena.requiere_revision = True
                    duena.revision_motivo = f'Su perfil dice empresa "{empresa_txt}", que no está en el catálogo.'
                    self.notas.append(f'{nombre}: empresa "{empresa_txt}" sin coincidencia en el catálogo')
                duena.save()
                self.cuenta['clientes_fisicos_de_cuenta'] += 1
            else:
                self.cuenta['cuentas_absorbidas_por_empresa'] += 1

            contacto = Contacto.objects.create(
                cliente=duena,
                nombre=nombre,
                telefono=telefono,
                email=u.email,
                puesto=getattr(perfil, 'puesto', '') or '',
                usuario=u,
                principal=(duena.tipo == Cliente.FISICA),
            )
            mapa[u.id] = contacto
            self.cuenta['contactos_con_cuenta'] += 1
        return mapa

    def _migrar_obras(self, mapa_empresa, mapa_usuario):
        # Las obras formales solo cambian de dueño.
        reasignadas = []
        for o in Obra.objects.filter(empresa__isnull=False).select_related('empresa'):
            cli = mapa_empresa.get(o.empresa_id)
            if cli:
                o.cliente = cli
                reasignadas.append(o)
        if reasignadas:
            Obra.objects.bulk_update(reasignadas, ['cliente'])
            self.cuenta['obras_reasignadas'] = len(reasignadas)

        # Las obras "light" que el cliente capturó en su panel se vuelven obras
        # de verdad. Aquí muere la duplicación ObraCliente vs Obra.
        for oc in ObraCliente.objects.select_related('usuario'):
            contacto = mapa_usuario.get(oc.usuario_id)
            if contacto is None:
                continue
            Obra.objects.create(
                cliente=contacto.cliente,
                empresa=None,
                nombre=oc.nombre,
                responsable=oc.responsable,
                telefono=_digitos(oc.telefono),
                ubicacion=oc.direccion,
                estado='activa',
                notas=f'Obra capturada por el cliente en su panel.{" " + oc.empresa if oc.empresa else ""}',
            )
            self.cuenta['obras_desde_panel_cliente'] += 1

    def _migrar_documentos(self, mapa_empresa, mapa_usuario):
        """Asigna cliente a ventas, rentas y cotizaciones.

        Dos pasadas: primero lo que tiene FK (certeza total), después lo que
        solo tiene texto (se agrupa por teléfono). El orden importa: la segunda
        pasada reutiliza los clientes que creó la primera.
        """
        # ── Pasada 1: por FK ──
        pendientes = []   # (fecha, nombre, telefono, documento)

        def procesar(modelo, docs, campo_cuenta, campo_nombre, campo_telefono, campo_fecha, etiqueta):
            asignados, sin_fk = [], []
            for d in docs:
                contacto = mapa_usuario.get(getattr(d, campo_cuenta + '_id'))
                if contacto is not None:
                    d.cliente = contacto.cliente
                    d.contacto = contacto
                    asignados.append(d)
                    self.cuenta[f'{etiqueta}_por_cuenta'] += 1
                    continue
                cli = mapa_empresa.get(getattr(d, 'empresa_id', None))
                if cli is not None:
                    d.cliente = cli
                    d.contacto = cli.contacto_principal
                    asignados.append(d)
                    self.cuenta[f'{etiqueta}_por_empresa'] += 1
                    continue
                sin_fk.append(d)
            if asignados:
                # bulk_update NO llama a save(): una renta histórica no debe
                # pasar por full_clean() ni recalcular montos solo porque le
                # estamos poniendo su cliente.
                modelo.objects.bulk_update(asignados, ['cliente', 'contacto'])
            for d in sin_fk:
                pendientes.append((
                    getattr(d, campo_fecha),
                    (getattr(d, campo_nombre) or '').strip(),
                    _digitos(getattr(d, campo_telefono)),
                    modelo, d, etiqueta,
                ))

        procesar(Venta, Venta.objects.all(), 'cliente_usuario',
                 'nombre_cliente', 'telefono_cliente', 'fecha', 'ventas')
        procesar(Renta, Renta.objects.all(), 'usuario',
                 'cliente_texto', 'telefono_cliente', 'creado_en', 'rentas')
        procesar(Cotizacion, Cotizacion.objects.all(), 'usuario',
                 'cliente_nombre', 'cliente_telefono', 'creada', 'cotizaciones')

        # ── Pasada 2: por teléfono ──
        # De lo más nuevo a lo más viejo: el nombre que gana es el más reciente,
        # que es el que el cliente usa hoy.
        indice = {}
        for cli in Cliente.objects.prefetch_related('contactos'):
            if cli.telefono:
                indice.setdefault(cli.telefono, cli)
            for ct in cli.contactos.all():
                if ct.telefono:
                    indice.setdefault(ct.telefono, cli)

        por_modelo = defaultdict(list)
        pendientes.sort(key=lambda t: t[0], reverse=True)
        for _fecha, nombre, telefono, modelo, doc, etiqueta in pendientes:
            if not telefono:
                self.cuenta[f'{etiqueta}_huerfanas'] += 1
                continue
            cli = indice.get(telefono)
            if cli is None:
                cli = Cliente(
                    tipo=Cliente.FISICA,
                    nombre=nombre or 'Cliente de mostrador',
                    telefono=telefono,
                )
                if not nombre:
                    cli.requiere_revision = True
                    cli.revision_motivo = 'Se creó solo con teléfono: los documentos no traían nombre.'
                cli.save()
                Contacto.objects.create(
                    cliente=cli, nombre=cli.nombre, telefono=telefono, principal=True,
                )
                indice[telefono] = cli
                self.cuenta['clientes_fisicos_de_mostrador'] += 1
            elif nombre and not _nombres_compatibles(cli.nombre, nombre):
                if not cli.requiere_revision:
                    cli.requiere_revision = True
                    cli.revision_motivo = f'El teléfono {telefono} aparece también como "{nombre}".'
                    cli.save(update_fields=['requiere_revision', 'revision_motivo'])
                    self.notas.append(f'tel {telefono}: "{cli.nombre}" vs "{nombre}"')

            doc.cliente = cli
            doc.contacto = cli.contacto_principal
            por_modelo[modelo].append(doc)
            self.cuenta[f'{etiqueta}_por_telefono'] += 1

        for modelo, docs in por_modelo.items():
            modelo.objects.bulk_update(docs, ['cliente', 'contacto'])

    # ─────────────────────────────────────────────
    #  REVERSA
    # ─────────────────────────────────────────────
    def _revertir(self, aplicar: bool):
        resumen = {}
        try:
            with transaction.atomic():
                # Las obras que nacieron aquí son las que no tienen empresa.
                creadas = Obra.objects.filter(empresa__isnull=True, cliente__isnull=False)
                resumen['obras_creadas_borradas'] = creadas.count()
                creadas.delete()

                resumen['obras_sueltas'] = Obra.objects.filter(cliente__isnull=False).update(cliente=None)
                resumen['ventas_sueltas'] = Venta.objects.filter(cliente__isnull=False).update(cliente=None, contacto=None)
                resumen['rentas_sueltas'] = Renta.objects.filter(cliente__isnull=False).update(cliente=None, contacto=None)
                resumen['cotizaciones_sueltas'] = Cotizacion.objects.filter(cliente__isnull=False).update(cliente=None, contacto=None)
                resumen['contactos_borrados'] = Contacto.objects.count()
                Contacto.objects.all().delete()
                resumen['clientes_borrados'] = Cliente.objects.count()
                Cliente.objects.all().delete()
                if not aplicar:
                    raise _Ensayo()
        except _Ensayo:
            pass

        titulo = 'REVERSA APLICADA' if aplicar else 'REVERSA — ENSAYO (no se escribió nada)'
        self.stdout.write(self.style.WARNING(f'\n{titulo}\n'))
        for k, v in resumen.items():
            self.stdout.write(f'  {k.replace("_", " "):38} {v:>6}')
        if not aplicar:
            self.stdout.write(self.style.WARNING(
                '\n  Para revertir de verdad: --revertir --aplicar\n'))

    # ─────────────────────────────────────────────
    #  INFORME
    # ─────────────────────────────────────────────
    def _imprimir(self, aplicar: bool):
        c = self.cuenta
        titulo = 'MIGRACIÓN APLICADA' if aplicar else 'INFORME — no se escribió nada'
        estilo = self.style.SUCCESS if aplicar else self.style.WARNING
        self.stdout.write(estilo(f'\n{titulo}\n'))

        bloques = [
            ('PADRÓN', [
                ('Clientes morales (desde Empresa)', 'clientes_morales'),
                ('Clientes físicos (desde cuentas)', 'clientes_fisicos_de_cuenta'),
                ('Clientes físicos (desde mostrador, por teléfono)', 'clientes_fisicos_de_mostrador'),
                ('Cuentas absorbidas por su empresa', 'cuentas_absorbidas_por_empresa'),
                ('Contactos con cuenta', 'contactos_con_cuenta'),
                ('Contactos sin cuenta', 'contactos_sin_cuenta'),
            ]),
            ('OBRAS', [
                ('Reasignadas de Empresa a Cliente', 'obras_reasignadas'),
                ('Creadas desde el panel del cliente', 'obras_desde_panel_cliente'),
            ]),
            ('DOCUMENTOS', [
                ('Ventas · por cuenta ligada', 'ventas_por_cuenta'),
                ('Ventas · por empresa', 'ventas_por_empresa'),
                ('Ventas · por teléfono', 'ventas_por_telefono'),
                ('Ventas · HUÉRFANAS (sin teléfono)', 'ventas_huerfanas'),
                ('Rentas · por cuenta ligada', 'rentas_por_cuenta'),
                ('Rentas · por empresa', 'rentas_por_empresa'),
                ('Rentas · por teléfono', 'rentas_por_telefono'),
                ('Rentas · HUÉRFANAS (sin teléfono)', 'rentas_huerfanas'),
                ('Cotizaciones · por cuenta ligada', 'cotizaciones_por_cuenta'),
                ('Cotizaciones · por empresa', 'cotizaciones_por_empresa'),
                ('Cotizaciones · por teléfono', 'cotizaciones_por_telefono'),
                ('Cotizaciones · HUÉRFANAS (sin teléfono)', 'cotizaciones_huerfanas'),
            ]),
        ]
        for encabezado, filas in bloques:
            self.stdout.write(self.style.HTTP_INFO(f'  {encabezado}'))
            for etiqueta, clave in filas:
                self.stdout.write(f'    {etiqueta:<48} {c[clave]:>6}')
            self.stdout.write('')

        if self.notas:
            self.stdout.write(self.style.WARNING(f'  MARCADOS PARA REVISIÓN ({len(self.notas)})'))
            for n in self.notas[:20]:
                self.stdout.write(f'    · {n}')
            if len(self.notas) > 20:
                self.stdout.write(f'    … y {len(self.notas) - 20} más (búscalos con requiere_revision=True)')
            self.stdout.write('')

        huerfanas = c['ventas_huerfanas'] + c['rentas_huerfanas'] + c['cotizaciones_huerfanas']
        if huerfanas:
            self.stdout.write(
                f'  {huerfanas} documentos se quedaron sin cliente porque no traen teléfono.\n'
                f'  Conservan su texto original; se asignan a mano cuando haga falta.\n')

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                '  Nada de esto se guardó. Para aplicarlo: --aplicar\n'))
