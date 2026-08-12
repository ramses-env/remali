"""Repara rentas afectadas por el bug histórico de re-guardado.

Antes, `Renta.save()` re-validaba la disponibilidad de la unidad en CADA guardado;
como una renta activa ya ocupa su propia unidad, cualquier segundo guardado fallaba
"no disponible" y se perdía en silencio. Eso dejó, en rentas creadas ANTES del
arreglo de raíz:

  • el enlace a su cotización sin escribir (y, con él, el cupón sin consumir), y
  • los `pagos` vacíos (saldo/pagado quedaban mal).

El código nuevo ya no produce esto. Este comando limpia lo que quedó atrás.

    python manage.py reparar_rentas                     # DRY-RUN: solo reporta
    python manage.py reparar_rentas --apply             # re-enlaza cotizaciones (seguro)
    python manage.py reparar_rentas --apply --backfill-pagos   # además rellena pagos vacíos

El re-enlace es seguro y recuperable (deduce la cotización por coincidencia única).
El backfill de pagos es OPT-IN porque el monto original se perdió: asume pago
COMPLETO de contado (el fallback histórico de crear_renta). Úsalo solo si sabes que
esas rentas se pagaron completas; si hubo abonos parciales, reconcílialas a mano.
"""
from django.core.management.base import BaseCommand
from django.db import transaction
from django.db.models import Q

from renta.models import Renta
from cotizaciones.models import Cotizacion


class Command(BaseCommand):
    help = 'Repara rentas con enlace de cotización perdido y/o pagos vacíos (bug histórico). Dry-run por defecto.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Aplica los cambios. Sin esta bandera solo reporta (dry-run).')
        parser.add_argument('--backfill-pagos', action='store_true',
                            help='Además rellena pagos vacíos con [efectivo, total] (asume pago completo). Opt-in.')

    def _relinkeables(self):
        """(renta, cotización) donde el enlace se puede recuperar sin ambigüedad."""
        pares = []
        sin_link = Renta.objects.filter(cotizacion__isnull=True, usuario__isnull=False).iterator()
        for r in sin_link:
            cands = list(Cotizacion.objects.filter(
                usuario_id=r.usuario_id, tipo__in=('renta', 'mixta'), estado='aceptada',
                rentas_convertidas__isnull=True,
            )[:2])
            if len(cands) == 1:
                pares.append((r, cands[0]))
        return pares

    def _sin_pagos(self):
        """Rentas con pagos vacíos y total > 0 (una renta bien guardada nunca queda así)."""
        return list(Renta.objects.filter(Q(pagos=[]) | Q(pagos__isnull=True), total__gt=0))

    def handle(self, *args, **opts):
        aplicar = opts['apply']
        backfill = opts['backfill_pagos']

        relink = self._relinkeables()
        sin_pagos = self._sin_pagos()

        self.stdout.write(f'Enlaces de cotización recuperables : {len(relink)}')
        self.stdout.write(f'Rentas con pagos vacíos (total > 0): {len(sin_pagos)}')

        if not (relink or sin_pagos):
            self.stdout.write(self.style.SUCCESS('Nada que reparar. ✓'))
            return

        if not aplicar:
            for r, cot in relink[:20]:
                self.stdout.write(f'  [link]  renta #{r.id} -> cotización {cot.folio}'
                                  + (f' (cupón {cot.cupon.codigo})' if cot.cupon_id else ''))
            for r in sin_pagos[:20]:
                self.stdout.write(f'  [pagos] renta #{r.id} total {r.total} (vacío)')
            self.stdout.write(self.style.WARNING(
                'DRY-RUN: no se cambió nada. Corre con --apply'
                + (' --backfill-pagos' if sin_pagos else '') + ' para aplicar.'))
            return

        relink_n, cupon_n, pagos_n = 0, 0, 0
        with transaction.atomic():
            for r, cot in relink:
                r.cotizacion = cot
                r.save(update_fields=['cotizacion'])  # ya funciona (fix de raíz)
                relink_n += 1
                if cot.cupon_id and not cot.cupon.usado:
                    cot.cupon.marcar_usado()
                    cupon_n += 1
                self.stdout.write(f'  ✓ enlazada renta #{r.id} -> {cot.folio}')

            if backfill:
                for r in sin_pagos:
                    r.pagos = [{'metodo': 'efectivo', 'monto': str(r.total)}]
                    r.save(update_fields=['pagos'])
                    pagos_n += 1
                    self.stdout.write(f'  ✓ pagos renta #{r.id}: {r.total} efectivo')
            elif sin_pagos:
                self.stdout.write(self.style.WARNING(
                    f'{len(sin_pagos)} renta(s) con pagos vacíos NO tocadas '
                    '(agrega --backfill-pagos si se pagaron completas).'))

        self.stdout.write(self.style.SUCCESS(
            f'Listo. Enlaces: {relink_n} · cupones consumidos: {cupon_n} · pagos rellenados: {pagos_n}.'))
