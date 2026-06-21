"""
Beacon User Management URLs — /api/v1/users/
"""
from django.urls import path
from .views import (
    UserListCreateView,
    UserDetailView,
    UserRoleAssignView,
    UserEnableDisableView,
    RegistrationListView,
    RegistrationDecisionView,
    OrganizationListCreateView,
    OrganizationDetailView,
)

urlpatterns = [
    path("",                          UserListCreateView.as_view(),  name="user-list-create"),
    path("<int:pk>/",                 UserDetailView.as_view(),      name="user-detail"),
    path("<int:pk>/role/",            UserRoleAssignView.as_view(),  name="user-role-assign"),
    path("<int:pk>/<str:action>/",    UserEnableDisableView.as_view(), name="user-enable-disable"),

    # Registrations
    path("registrations/",            RegistrationListView.as_view(), name="registration-list"),
    path("registrations/<int:pk>/decision/", RegistrationDecisionView.as_view(), name="registration-decision"),

    # Organizations
    path("organizations/",            OrganizationListCreateView.as_view(), name="organization-list-create"),
    path("organizations/<int:org_id>/", OrganizationDetailView.as_view(), name="organization-detail"),
]
