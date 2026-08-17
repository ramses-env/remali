"""La app `empresas` ya no tiene modelos.

`Empresa` se volvió `clientes.Cliente(tipo='moral')` y `Obra` se mudó a
`clientes.Obra`, colgada del cliente. Eran la misma idea escrita dos veces: una
constructora es un cliente, y tanto una persona como una constructora pueden
tener varias obras.

El paquete se conserva solo para que sus migraciones históricas sigan
resolviendo. No agregues modelos aquí.
"""
