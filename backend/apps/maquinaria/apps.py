from django.apps import AppConfig
from server.rastro import tragado


class MaquinariaConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'maquinaria'

    def ready(self):
        from . import latido
        latido.conectar()
        # Correos en minúsculas y teléfonos de 10 dígitos, en TODO el proyecto.
        from . import normalizacion
        normalizacion.conectar()
        # El 5% por completar el perfil. En señal para que dé igual desde dónde
        # se haya guardado (formulario, alta con Google, un comando).
        from . import cupon_bienvenida
        cupon_bienvenida.conectar()
        # El saludo al cliente nuevo. También en señal: darse de alta ocurre por
        # tres caminos (registro, Google, confirmar el código) y el correo no
        # puede depender de cuál usó.
        from . import correo_bienvenida
        correo_bienvenida.conectar()
        # HEIC/HEIF (fotos de iPhone): registrar el lector de Pillow para que el
        # ImageField de productos acepte también esos formatos. Si el paquete no
        # está instalado en algún entorno, se ignora sin romper el arranque.
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception:
            tragado()
