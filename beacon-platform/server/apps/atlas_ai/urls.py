from django.urls import path

from .views import AtlasAiThreadDetailView, AtlasAiThreadListCreateView, AtlasAiThreadMessagesView


urlpatterns = [
    path("threads/", AtlasAiThreadListCreateView.as_view(), name="atlas-ai-thread-list"),
    path("threads/<uuid:thread_id>/", AtlasAiThreadDetailView.as_view(), name="atlas-ai-thread-detail"),
    path("threads/<uuid:thread_id>/messages/", AtlasAiThreadMessagesView.as_view(), name="atlas-ai-thread-messages"),
]
