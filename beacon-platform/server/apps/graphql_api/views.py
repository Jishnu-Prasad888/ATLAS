from django.conf import settings
from django.http import JsonResponse
from strawberry.django.views import GraphQLView

from .schema import schema


class AuthenticatedGraphQLView(GraphQLView):
    def dispatch(self, request, *args, **kwargs):  # noqa: D401
        if not getattr(request, "user", None) or not request.user.is_authenticated:
            return JsonResponse({"detail": "Authentication credentials were not provided."}, status=401)
        return super().dispatch(request, *args, **kwargs)


def graphql_view():
    return AuthenticatedGraphQLView.as_view(schema=schema, graphiql=getattr(settings, "DEBUG", False))
