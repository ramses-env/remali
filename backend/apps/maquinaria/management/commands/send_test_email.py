from django.core.management.base import BaseCommand
from django.core.mail import send_mail
from django.conf import settings

class Command(BaseCommand):
    help = "Enviar correo de prueba SMTP"

    def add_arguments(self, parser):
        parser.add_argument('to_email', type=str)

    def handle(self, *args, **options):
        to_email = options['to_email']
        subject = 'Prueba de SMTP'
        body = f"Este es un correo de prueba. BACKEND_URL: {settings.BACKEND_URL}"
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to_email], fail_silently=False)
        self.stdout.write(self.style.SUCCESS(f"Correo de prueba enviado a {to_email}"))
