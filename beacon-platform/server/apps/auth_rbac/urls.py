"""
Beacon Auth URLs — /api/v1/auth/
"""
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView
from .views import (
    BeaconLoginView,
    BeaconLogoutView,
    WhoAmIView,
    PasswordChangeView,
    PasswordRecoveryView,
    GenerateRecoveryKeyView,
)

urlpatterns = [
    path("login/",        BeaconLoginView.as_view(),         name="auth-login"),
    path("logout/",       BeaconLogoutView.as_view(),        name="auth-logout"),
    path("refresh/",      TokenRefreshView.as_view(),        name="auth-refresh"),
    path("whoami/",       WhoAmIView.as_view(),              name="auth-whoami"),
    path("password/change/",   PasswordChangeView.as_view(),    name="auth-password-change"),
    path("password/recover/",  PasswordRecoveryView.as_view(),  name="auth-password-recover"),
    path("recovery-key/generate/", GenerateRecoveryKeyView.as_view(), name="auth-recovery-key"),
]
