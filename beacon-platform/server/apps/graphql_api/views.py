from django.conf import settings
from django.http import JsonResponse
def _patch_pydantic():
    try:
        from pydantic._internal import _typing_extra
        if not hasattr(_typing_extra, "is_new_type"):
            def is_new_type(tp):
                return False
            _typing_extra.is_new_type = is_new_type  # type: ignore[attr-defined]
    except Exception:
        pass


_patch_pydantic()

from strawberry.django.views import GraphQLView

from .schema import schema


class AuthenticatedGraphQLView(GraphQLView):
    def dispatch(self, request, *args, **kwargs):  # noqa: D401
        if not getattr(request, "user", None) or not request.user.is_authenticated:
            return JsonResponse({"detail": "Authentication credentials were not provided."}, status=401)
        return super().dispatch(request, *args, **kwargs)


def graphql_view():
    return AuthenticatedGraphQLView.as_view(schema=schema, graphiql=getattr(settings, "DEBUG", False))
