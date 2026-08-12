from django.apps import AppConfig


class MaquinariaConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'maquinaria'

    def ready(self):
        from . import latido
        latido.conectar()
        # Correos en minúsculas y teléfonos de 10 dígitos, en TODO el proyecto.
        from . import normalizacion
        normalizacion.conectar()
        # HEIC/HEIF (fotos de iPhone): registrar el lector de Pillow para que el
        # ImageField de productos acepte también esos formatos. Si el paquete no
        # está instalado en algún entorno, se ignora sin romper el arranque.
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception:
            pass
