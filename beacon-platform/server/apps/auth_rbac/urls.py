"""
Beacon Auth URLs — /api/v1/auth/
"""
from django.urls import path
from .views import (
    BeaconLoginView,
    BeaconTokenRefreshView,
    BeaconLogoutView,
    WhoAmIView,
    PasswordChangeView,
    PasswordRecoveryView,
    GenerateRecoveryKeyView,
    RegistrationView,
    GoogleOAuthView,
)

urlpatterns = [
    path("login/",        BeaconLoginView.as_view(),         name="auth-login"),
    path("logout/",       BeaconLogoutView.as_view(),        name="auth-logout"),
    path("refresh/",      BeaconTokenRefreshView.as_view(),  name="auth-refresh"),
    path("whoami/",       WhoAmIView.as_view(),              name="auth-whoami"),
    path("register/",     RegistrationView.as_view(),        name="auth-register"),
    path("google/",       GoogleOAuthView.as_view(),         name="auth-google"),
    path("password/change/",   PasswordChangeView.as_view(),    name="auth-password-change"),
    path("password/recover/",  PasswordRecoveryView.as_view(),  name="auth-password-recover"),
    path("recovery-key/generate/", GenerateRecoveryKeyView.as_view(), name="auth-recovery-key"),
]
