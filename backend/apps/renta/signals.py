"""
Señales de la app `renta`.

⚠️ INTENCIONALMENTE VACÍO.

La sincronización del estado de la unidad de inventario (rentado ↔ disponible)
se maneja ahora como FUENTE ÚNICA DE VERDAD en los modelos:

    - Renta.save()      -> Inventario.ocupar_por_renta()   (al crear una renta activa)
    - Renta.activar()   -> Inventario.ocupar_por_renta()   (reserva -> activa)
    - Renta.finalizar() -> Inventario.liberar()            (devolución)
    - Renta.cancelar()  -> Inventario.liberar()            (cancelación)

Antes esta lógica estaba duplicada aquí (pre_save/post_save), en Renta.save() y en
la vista crear_renta, lo que provocaba escrituras redundantes y riesgo de divergencia.
Se dejó este módulo (importado por RentaConfig.ready) por compatibilidad; si en el
futuro se necesita un side-effect real (p. ej. emails), agregar aquí los receivers.
"""
