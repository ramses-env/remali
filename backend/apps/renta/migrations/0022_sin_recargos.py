"""REMALI no cobra recargos por retraso: se limpian los que se cobraron solos.

El recargo se calculaba automáticamente al devolver (`tarifa_diaria × días de
retraso`) y nadie lo había pedido. Dejaba deuda inventada: una renta de $1,200
devuelta nueve días tarde acumulaba $10,800, que inflaba Cobranza y —con la
regla que frena una renta nueva a quien debe— dejaba al cliente sin poder rentar
por algo que la empresa nunca pensó cobrarle.

Qué hace: pone el recargo en cero y recalcula subtotal/IVA/total de esas rentas.

Qué NO toca: los **abonos** (`pagos`). Si alguien de verdad pagó, ese dinero
sigue registrado; lo que desaparece es el CARGO. Si un cliente hubiera pagado un
recargo, la renta le queda con saldo a favor y eso se ve en Cobranza, que es
justo donde alguien puede revisarlo.
"""
from django.db import migrations


def limpiar_recargos(apps, schema_editor):
    # Modelo histórico: sin métodos. La cuenta se rehace aquí a mano, igual que
    # `recalcular_montos()`, porque una migración no puede depender del modelo
    # vivo (mañana cambia y esta migración tiene que seguir dando lo mismo).
    from decimal import Decimal
    Renta = apps.get_model('renta', 'Renta')
    IVA = Decimal('0.16')
    tocadas = 0
    for r in Renta.objects.exclude(recargo=Decimal('0.00')).iterator():
        r.recargo = Decimal('0.00')
        base = (r.subtotal or Decimal('0')) - (r.descuento or Decimal('0'))
        if base < 0:
            base = Decimal('0.00')
        if r.aplica_iva:
            r.iva = (base * IVA).quantize(Decimal('0.01'))
            r.total = (base + r.iva).quantize(Decimal('0.01'))
        else:
            r.iva = Decimal('0.00')
            r.total = base.quantize(Decimal('0.01'))
        r.save(update_fields=['recargo', 'iva', 'total'])
        tocadas += 1
    if tocadas:
        print(f'  · {tocadas} renta(s) sin recargo y con su total recalculado.')


def sin_vuelta(apps, schema_editor):
    """No se puede deshacer: el recargo original no se guardó en ningún lado.

    Y no hace falta inventarlo — recalcularlo con la fecha de devolución
    resucitaría deuda que la empresa ya decidió no cobrar.
    """
    pass


class Migration(migrations.Migration):

    dependencies = [('renta', '0021_renta_liquidacion_nota')]

    operations = [migrations.RunPython(limpiar_recargos, sin_vuelta)]
