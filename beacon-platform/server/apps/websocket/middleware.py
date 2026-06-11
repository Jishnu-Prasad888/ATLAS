"""
Beacon JWT Auth Middleware for WebSocket connections.
Validates Bearer token from query string or header.
"""
from channels.middleware import BaseMiddleware
from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser
from urllib.parse import parse_qs


@database_sync_to_async
def get_user_from_token(token_str):
    try:
        from rest_framework_simplejwt.tokens import AccessToken
        from apps.auth_rbac.models import BeaconUser
        token = AccessToken(token_str)
        user  = BeaconUser.objects.get(id=token["user_id"])
        return user
    except Exception:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        # Try token from query string: ?token=<jwt>
        qs     = parse_qs(scope.get("query_string", b"").decode())
        tokens = qs.get("token", [])
        if tokens:
            scope["user"] = await get_user_from_token(tokens[0])
        else:
            # Try Authorization header
            headers = dict(scope.get("headers", []))
            auth    = headers.get(b"authorization", b"").decode()
            if auth.startswith("Bearer "):
                scope["user"] = await get_user_from_token(auth[7:])
            else:
                scope["user"] = AnonymousUser()

        return await super().__call__(scope, receive, send)


def JWTAuthMiddlewareStack(inner):
    return JWTAuthMiddleware(inner)
