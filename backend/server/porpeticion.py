"""Caché que vive lo que dura UNA petición, y ni un microsegundo más.

Hay datos que se consultan muchas veces dentro de la misma petición y que no
pueden cambiar mientras esa petición corre: el mapa de puestos, la
configuración del negocio. Sin caché, la capa de permisos pegaba a `rol` cuatro
veces en cualquier endpoint y veintidós en `/usuarios/`, y el catálogo hacía un
`get_or_create` de la configuración por cada equipo sobre pedido.

La tentación es guardarlos en una variable del módulo, y está descartada a
propósito: el panel corre en varios workers, así que el que renombra un puesto
tira SU copia y los demás se quedan con el nombre viejo —gente que de pronto no
entra, dependiendo de qué proceso te tocó. Un permiso que depende del worker no
es un permiso.

Por petición no tiene ese problema: el cambio surte efecto en la siguiente
petición de cualquier worker, sin caché que invalidar y sin depender de que
Redis exista (sin REDIS_URL la caché de Django es por proceso, o sea el mismo
problema de arriba).

Fuera de una petición —comandos, shell, cron, pruebas— no se cachea nada: se
calcula y se devuelve, que es justo lo que quieres en un proceso de larga vida.
"""
from asgiref.local import Local
from asgiref.sync import iscoroutinefunction, markcoroutinefunction

_almacen = Local()


def por_peticion(clave, calcular):
    """Devuelve `calcular()`, una sola vez por petición y por clave."""
    cache = getattr(_almacen, 'cache', None)
    if cache is None:
        return calcular()
    if clave not in cache:
        cache[clave] = calcular()
    return cache[clave]


def olvidar(clave):
    """Tira una entrada de la petición en curso.

    Se usa cuando la misma petición ESCRIBE lo que ya había leído (guardar la
    configuración del negocio): seguir sirviendo el valor viejo dentro de esa
    misma petición devolvería al panel lo que acaba de reemplazar.
    """
    cache = getattr(_almacen, 'cache', None)
    if cache is not None:
        cache.pop(clave, None)


class CachePorPeticion:
    """Abre la caché al entrar la petición y la tira al salir.

    Habla sync y async porque el proyecto sirve por ASGI (uvicorn + Channels):
    sin `async_capable`, Django envolvería cada petición en un hilo extra.
    """
    sync_capable = True
    async_capable = True

    def __init__(self, get_response):
        self.get_response = get_response
        self._es_async = iscoroutinefunction(get_response)
        if self._es_async:
            markcoroutinefunction(self)

    def __call__(self, request):
        if self._es_async:
            return self.__acall__(request)
        _almacen.cache = {}
        try:
            return self.get_response(request)
        finally:
            _almacen.cache = None

    async def __acall__(self, request):
        _almacen.cache = {}
        try:
            return await self.get_response(request)
        finally:
            _almacen.cache = None
