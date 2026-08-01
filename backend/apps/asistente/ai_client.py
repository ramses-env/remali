"""Cliente de IA agnóstico (formato compatible con OpenAI).

El MISMO código sirve en local y en producción; solo cambian variables de entorno:

  AI_BASE_URL   URL base del proveedor, terminada en /v1
                - Local (Ollama):   http://localhost:11434/v1   (sin clave)
                - Railway (Groq):   https://api.groq.com/openai/v1
                - Gemini (compat):  https://generativelanguage.googleapis.com/v1beta/openai
  AI_API_KEY    Clave del proveedor hospedado. Vacía para Ollama local.
                NUNCA se expone al frontend; vive solo en el servidor.
  AI_MODEL      Nombre del modelo
                - Local:   qwen2.5:3b  (o qwen2.5:7b)
                - Groq:    llama-3.3-70b-versatile
                - Gemini:  gemini-1.5-flash

Así "gratis como Ollama" en local y "funciona en Railway" con una capa gratis
hospedada conviven sin tocar el código.
"""
import os

import requests

# Valores por defecto pensados para desarrollo local con Ollama (sin clave).
_DEFAULT_BASE = 'http://localhost:11434/v1'
_DEFAULT_MODEL = 'qwen2.5:3b'


def _cfg():
    base = (os.environ.get('AI_BASE_URL') or _DEFAULT_BASE).rstrip('/')
    key = (os.environ.get('AI_API_KEY') or '').strip()
    model = (os.environ.get('AI_MODEL') or _DEFAULT_MODEL).strip()
    return base, key, model


def estado_config():
    """Estado de configuración SIN exponer la clave (para diagnósticos del frontend)."""
    base, key, model = _cfg()
    return {
        'configurado': bool(base and model),
        'base_url': base,
        'modelo': model,
        'tiene_clave': bool(key),
    }


def preguntar_ia(system, user, *, temperature=0.2, timeout=60, max_tokens=700):
    """Manda system+user al endpoint /chat/completions y devuelve el texto.

    Deja subir las excepciones de `requests` para que la vista distinga entre
    "no hay conexión", "timeout" y otros errores y responda algo útil.
    """
    base, key, model = _cfg()
    headers = {'Content-Type': 'application/json'}
    if key:
        headers['Authorization'] = f'Bearer {key}'
    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system},
            {'role': 'user', 'content': user},
        ],
        'temperature': temperature,
        'max_tokens': max_tokens,
        'stream': False,
    }
    r = requests.post(f'{base}/chat/completions', json=payload, headers=headers, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return (data['choices'][0]['message']['content'] or '').strip()
