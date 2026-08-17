import pathlib
p = pathlib.Path('/Users/ramses/Developer/Remali/backend/apps/maquinaria/views.py')
lines = p.read_text().splitlines(keepends=True)

NEW_BLOCK = '''@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([GoogleLoginThrottle])
def google_login(request):
    """Entrar (o darse de alta) con Google.

    El front manda el `credential`: un id_token firmado por Google. Aquí se
    verifica contra NUESTRO client_id (settings.GOOGLE_CLIENT_ID) —así nadie
    cuela un token emitido para otra app— y, si es válido, se emite el mismo par
    de JWT que el login por contraseña. Un correo de Google llega ya verificado.
    """
    from django.conf import settings
    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    credential = (request.data.get('credential') or '').strip()
    if not credential:
        return Response({'detail': 'Falta el credential de Google.'}, status=400)

    try:
        info = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=10,
        )
    except ValueError:
        return Response({'detail': 'No se pudo validar tu sesión de Google. Intenta de nuevo.'}, status=401)

    email = (info.get('email') or '').strip().lower()
    if not email:
        return Response({'detail': 'Tu cuenta de Google no compartió un correo.'}, status=400)
    if info.get('email_verified') is False:
        return Response({'detail': 'Tu correo de Google no está verificado.'}, status=400)

    User = get_user_model()
    user = User.objects.filter(email__iexact=email).first()

    if user is None:
        base = (email.split('@')[0] or 'cliente').strip()
        candidato, i = base, 1
        while User.objects.filter(username__iexact=candidato).exists():
            i += 1
            candidato = f'{base}{i}'
        with transaction.atomic():
            user = User.objects.create_user(
                username=candidato,
                email=email,
                password=None,
                first_name=nombre_propio(info.get('given_name') or info.get('name') or ''),
                last_name=nombre_propio(info.get('family_name') or ''),
            )
            grupo, _ = Group.objects.get_or_create(name='Cliente')
            user.groups.add(grupo)
            perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
            perfil.email_verificado = True
            perfil.email_verificado_en = timezone.now()
            perfil.save()
    else:
        perfil, _ = PerfilUsuario.objects.get_or_create(usuario=user)
        if not perfil.email_verificado:
            perfil.email_verificado = True
            perfil.email_verificado_en = timezone.now()
            perfil.save(update_fields=['email_verificado', 'email_verificado_en'])

    if not user.is_active:
        return Response({'detail': 'Esta cuenta está desactivada.'}, status=403)

    refresh = TokenObtainPairSerializer.get_token(user)
    return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
@throttle_classes([CambioPasswordThrottle])
def cambiar_password(request):
    actual = request.data.get('password_actual') or ''
    nueva = request.data.get('password_nueva') or ''
    user = request.user
    if not user.check_password(actual):
        return Response({'detail': 'La contraseña actual no coincide.'}, status=400)
    if len(nueva) < 8:
        return Response({'detail': 'La nueva contraseña debe tener al menos 8 caracteres.'}, status=400)
    from django.contrib.auth.password_validation import validate_password as _vp
    try:
        _vp(nueva, user=user)
    except DjangoValidationError as e:
        return Response({'detail': '; '.join(e.messages) if e.messages else 'Contraseña no válida.'}, status=400)
    user.set_password(nueva)
    user.save(update_fields=['password'])
    try:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
        OutstandingToken.objects.filter(user=user).delete()
    except Exception:
        pass
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def logout(request):
    """Cierra la sesión: invalida el refresh token pasado y todos los pendientes."""
    user = request.user
    try:
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework_simplejwt.token_blacklist.models import (
            OutstandingToken, BlacklistedToken,
        )
        refresh = (request.data or {}).get('refresh') or ''
        if refresh:
            try:
                RefreshToken(refresh).blacklist()
            except Exception:
                pass
        ots = list(OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True))
        for ot in ots:
            try:
                BlacklistedToken.objects.get_or_create(token=ot)
            except Exception:
                pass
    except Exception:
        pass
    return Response({'ok': True})

'''

# Lines 1-indexed → slice [546 : 637] for lines 547..637 (inclusive)
new_lines = lines[:546] + [NEW_BLOCK] + lines[637:]
p.write_text(''.join(new_lines))
print(f'OK: reemplazadas líneas 547..637 ({len(lines)} → {len(new_lines)} líneas)')
import ast
src = ''.join(new_lines)
try:
    ast.parse(src)
    print('AST parse OK')
except SyntaxError as e:
    print(f'AST FAIL: line {e.lineno}: {e.msg}')
    print(f'  {e.text and e.text.rstrip()}')
