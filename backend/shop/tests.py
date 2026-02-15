from django.test import TestCase
import unittest
from django.core.exceptions import ValidationError
from .models import Equipo, Categoria, Marca, Orden
from .serializers import OrdenSerializer
from django.contrib.auth.models import User, Group
from rest_framework.test import APIRequestFactory
from .views import register

class InventoryLogicTests(TestCase):
    def setUp(self):
        self.cat = Categoria.objects.create(nombre='TestCat')
        self.brand = Marca.objects.create(nombre='Marca')
        self.e = Equipo.objects.create(
            modelo='Equipo A',
            descripcion='',
            precio_dia=8,
            categoria=self.cat,
            marca=self.brand,
            condicion='seminuevo',
            estado='disponible'
        )

    def test_order_marks_vendido(self):
        payload = {
            'coupon': None,
            'items': [
                {'equipo': self.e.id, 'precio': '10.00'}
            ]
        }
        ser = OrdenSerializer(data=payload)
        self.assertTrue(ser.is_valid(), ser.errors)
        order = ser.save()
        self.e.refresh_from_db()
        self.assertEqual(self.e.estado, 'vendido')
        self.assertEqual(Orden.objects.count(), 1)

    def test_sale_blocked_when_not_disponible(self):
        self.e.estado = 'rentado'
        self.e.save()
        payload = {
            'coupon': None,
            'items': [
                {'equipo': self.e.id, 'precio': '10.00'}
            ]
        }
        ser = OrdenSerializer(data=payload)
        self.assertTrue(ser.is_valid(), ser.errors)
        with self.assertRaises(ValidationError):
            ser.save()

@unittest.skip("Registro deshabilitado temporalmente")
class RegistrationGroupTests(TestCase):
    def test_register_assigns_cliente_group(self):
        factory = APIRequestFactory()
        req = factory.post('/api/auth/register/', {
            'email': 'c@example.com',
            'full_name': 'Cliente Uno',
            'password': 'Testpass123!'
        }, format='json')
        resp = register(req)
        self.assertEqual(resp.status_code, 200)
        u = User.objects.get(email='c@example.com')
        g = Group.objects.get(name='Cliente')
        self.assertTrue(u.groups.filter(id=g.id).exists())

# Create your tests here.
