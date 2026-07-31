from django.db import models


def formatear_domicilio(*, calle='', numero_exterior='', numero_interior='',
                        colonia='', municipio='', entidad='', codigo_postal='') -> str:
    """Arma una dirección legible a partir de las partes estructuradas.
    Ej: 'Av Costera 120 Int. 3, Icacos, Acapulco, Guerrero, 39300'."""
    linea1 = ' '.join(p for p in [calle.strip(), numero_exterior.strip()] if p).strip()
    if numero_interior.strip():
        linea1 = f'{linea1} Int. {numero_interior.strip()}'.strip()
    partes = [linea1, colonia, municipio, entidad, codigo_postal]
    return ', '.join(p.strip() for p in partes if p and p.strip())


class DomicilioMixin(models.Model):
    """Domicilio estructurado compartido por Empresa y Obra.

    El campo formateado destino difiere por modelo (Empresa.direccion,
    Obra.ubicacion): cada subclase lo declara y lo nombra en CAMPO_DIRECCION.
    Al guardar, si hay partes estructuradas, se re-arma y se escribe ahí.
    Abstracto: no crea tabla ni cambia el esquema existente.
    """
    calle = models.CharField(max_length=180, blank=True, default='')
    numero_exterior = models.CharField(max_length=30, blank=True, default='')
    numero_interior = models.CharField(max_length=30, blank=True, default='')
    colonia = models.CharField(max_length=120, blank=True, default='')
    municipio = models.CharField(max_length=120, blank=True, default='')
    ciudad = models.CharField(max_length=120, blank=True, default='')
    entidad = models.CharField(max_length=80, blank=True, default='', help_text='Estado / entidad federativa')
    codigo_postal = models.CharField(max_length=10, blank=True, default='')
    pais = models.CharField(max_length=80, blank=True, default='México')
    referencias = models.CharField(max_length=255, blank=True, default='')
    latitud = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)
    longitud = models.DecimalField(max_digits=10, decimal_places=7, null=True, blank=True)

    CAMPO_DIRECCION = 'direccion'

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        armada = formatear_domicilio(
            calle=self.calle, numero_exterior=self.numero_exterior, numero_interior=self.numero_interior,
            colonia=self.colonia, municipio=self.municipio, entidad=self.entidad, codigo_postal=self.codigo_postal,
        )
        if armada:
            setattr(self, self.CAMPO_DIRECCION, armada)
        super().save(*args, **kwargs)


class Empresa(DomicilioMixin):
    nombre = models.CharField(max_length=180, unique=True)
    rfc = models.CharField(max_length=20, blank=True, default='')
    contacto = models.CharField(max_length=180, blank=True, default='', help_text='Persona de contacto')
    telefono = models.CharField(max_length=40, blank=True, default='')
    email = models.EmailField(blank=True, default='')

    # Domicilio fiscal: partes estructuradas en DomicilioMixin; aquí el formateado.
    direccion = models.CharField(max_length=255, blank=True, default='', help_text='Dirección formateada (se arma con las partes de abajo)')

    # ── Datos fiscales (CFDI / SAT) ──
    regimen_fiscal = models.CharField(max_length=10, blank=True, default='', help_text='Clave SAT del régimen fiscal, ej. 601')
    uso_cfdi = models.CharField(max_length=10, blank=True, default='', help_text='Clave SAT de uso del CFDI, ej. G03')

    notas = models.TextField(blank=True, default='')
    activa = models.BooleanField(default=True)
    creada = models.DateTimeField(auto_now_add=True)

    CAMPO_DIRECCION = 'direccion'

    class Meta:
        db_table = 'empresas'
        verbose_name = 'Empresa'
        verbose_name_plural = 'Empresas'
        ordering = ['nombre']

    def save(self, *args, **kwargs):
        # RFC siempre en mayúsculas (normalización fiscal); el domicilio
        # formateado lo arma DomicilioMixin.save().
        self.rfc = (self.rfc or '').strip().upper()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.nombre


class Obra(DomicilioMixin):
    ESTADOS = [
        ('activa', 'Activa'),
        ('pausada', 'Pausada'),
        ('finalizada', 'Finalizada'),
    ]

    empresa = models.ForeignKey(
        Empresa,
        on_delete=models.CASCADE,
        related_name='obras'
    )
    nombre = models.CharField(max_length=180)
    responsable = models.CharField(max_length=180, blank=True, default='')
    telefono = models.CharField(max_length=40, blank=True, default='')  # teléfono del responsable

    # Domicilio de la obra: partes estructuradas en DomicilioMixin; aquí el formateado.
    ubicacion = models.CharField(max_length=255, blank=True, default='', help_text='Dirección formateada (se arma con las partes de abajo)')

    estado = models.CharField(max_length=12, choices=ESTADOS, default='activa')
    notas = models.TextField(blank=True, default='')
    creada = models.DateTimeField(auto_now_add=True)

    CAMPO_DIRECCION = 'ubicacion'

    class Meta:
        db_table = 'obras'
        verbose_name = 'Obra'
        verbose_name_plural = 'Obras'
        ordering = ['nombre']
        unique_together = ('empresa', 'nombre')

    def __str__(self):
        return f'{self.nombre} ({self.empresa.nombre})'
