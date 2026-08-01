"""Endpoints del asistente de IA (panel, requieren login)."""
import logging

import requests
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from . import ai_client
from .datos import construir_contexto, rol_de

logger = logging.getLogger(__name__)

_SYSTEM = (
    'Eres el asistente interno de REMALI, negocio de renta y venta de maquinaria '
    'ligera. Respondes preguntas del personal SOLO con base en los DATOS que '
    'aparecen abajo. Si algo no está en los datos, dilo claramente en vez de '
    'inventarlo. Sé breve, concreto y responde en español; usa cifras y listas '
    'cuando ayuden.'
)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def preguntar(request):
    pregunta = str((request.data or {}).get('pregunta') or '').strip()
    if not pregunta:
        return Response({'detalle': 'Escribe una pregunta.'}, status=400)
    if len(pregunta) > 1000:
        return Response({'detalle': 'La pregunta es demasiado larga (máx. 1000 caracteres).'}, status=400)

    contexto = construir_contexto(request.user)
    system = f'{_SYSTEM}\n\n===== DATOS =====\n{contexto}'

    try:
        respuesta = ai_client.preguntar_ia(system, pregunta)
    except requests.exceptions.ConnectionError:
        return Response(
            {'detalle': 'No pude conectar con el servicio de IA. En local: revisa que '
                        'Ollama esté corriendo y el modelo descargado. En producción: '
                        'revisa AI_BASE_URL y AI_API_KEY.'},
            status=503,
        )
    except requests.exceptions.Timeout:
        return Response({'detalle': 'La IA tardó demasiado en responder. Intenta de nuevo.'}, status=504)
    except requests.exceptions.HTTPError as e:
        logger.warning('El proveedor de IA respondió error: %s', e)
        return Response({'detalle': 'El proveedor de IA rechazó la solicitud '
                                    '(¿modelo o clave mal configurados?).'}, status=502)
    except Exception:
        logger.exception('Fallo inesperado consultando la IA')
        return Response({'detalle': 'Error inesperado consultando la IA.'}, status=502)

    return Response({'respuesta': respuesta, 'rol': rol_de(request.user)})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def estado(request):
    """Diagnóstico rápido para el frontend (sin exponer la clave)."""
    return Response(ai_client.estado_config())
