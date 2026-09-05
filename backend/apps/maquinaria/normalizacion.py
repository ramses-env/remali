"""Normaliza correos y teléfonos ANTES de guardar, en TODO el proyecto.

Regla de negocio (dueño, ago-2026):
  • Correo: SIEMPRE en minúsculas y sin espacios — nunca se guarda en MAYÚSCULAS.
  • Teléfono de cliente/contacto: SOLO dígitos y máximo 10 (los de México son de 10).
    Se excluye `negocio_telefono` (dato de la empresa que se muestra con formato).

Es una señal `pre_save` global (sin sender): corre en cada guardado, pero solo
toca los campos cuyo NOMBRE está en las listas de abajo, así que da igual desde
qué vista/serializer/flujo venga el dato — queda normalizado igual. El login usa
`email__iexact`, por eso pasar los correos a minúsculas no rompe el acceso.
"""
import re
from django.db.models.signals import pre_save

# Nombres de campo que son CORREO (se pasan a minúsculas).
CAMPOS_EMAIL = {'email', 'fiscal_email', 'cliente_email', 'negocio_email'}

# Nombres de campo que son TELÉFONO de cliente/contacto (solo dígitos, máx 10).
# OJO: `negocio_telefono` NO está aquí a propósito (es el tel. de la empresa,
# que el panel muestra con formato "744 373 7201").
CAMPOS_TELEFONO = {'telefono', 'telefono_cliente', 'cliente_telefono'}


def _normalizar(sender, instance, **kwargs):
    # `raw=True` es loaddata: un respaldo se restaura TAL CUAL. Reescribir
    # correos y teléfonos al vuelo haría que la base restaurada no sea idéntica
    # a la respaldada, que es justo lo único que se le pide a una restauración.
    if kwargs.get('raw'):
        return
    meta = getattr(instance, '_meta', None)
    if meta is None:
        return
    for f in meta.concrete_fields:
        nombre = f.attname
        if nombre not in CAMPOS_EMAIL and nombre not in CAMPOS_TELEFONO:
            continue
        valor = getattr(instance, nombre, None)
        if not isinstance(valor, str) or not valor:
            continue
        if nombre in CAMPOS_EMAIL:
            nuevo = re.sub(r'\s+', '', valor).lower()
        else:
            nuevo = re.sub(r'\D', '', valor)[:10]
        if nuevo != valor:
            setattr(instance, nombre, nuevo)


def conectar():
    pre_save.connect(_normalizar, dispatch_uid='remali_normalizar_contacto', weak=False)
