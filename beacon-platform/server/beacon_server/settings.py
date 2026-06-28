"""
Beacon Server - Django Settings
"""
import os
from pathlib import Path
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

def require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        raise RuntimeError(f"{name} must be set in the environment")
    return val


SECRET_KEY = require_env("SECRET_KEY")

DEBUG = os.environ.get("DEBUG", "False").lower() == "true"

def _parse_list(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item and item.strip()]


_base_allowed_hosts = _parse_list(require_env("ALLOWED_HOSTS"))
_default_allowed_hosts = ["atlas-beacon.vercel.app", "57.158.25.89"]
for _host in _default_allowed_hosts:
    if _host not in _base_allowed_hosts:
        _base_allowed_hosts.append(_host)

ALLOWED_HOSTS = _base_allowed_hosts

# ─── Applications ────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "channels",
    "django_filters",
    # Beacon apps
    "apps.auth_rbac",
    "apps.agents",
    "apps.metrics",
    "apps.logs",
    "apps.audit",
    "apps.config",
    "apps.health",
    "apps.atlas_ai",
    "apps.transport",
    "apps.websocket",
    "apps.operations",
    "apps.tools",
    "apps.ai_agents",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.audit.middleware.AuditMiddleware",
]

ROOT_URLCONF = "beacon_server.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "beacon_server.wsgi.application"
ASGI_APPLICATION = "beacon_server.asgi.application"

# ─── Database ─────────────────────────────────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "beacon"),
        "USER": os.environ.get("DB_USER", "beacon"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "beacon"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": os.environ.get("DB_PORT", "5432"),
        "OPTIONS": {
            "connect_timeout": 10,
        },
    }
}

# ─── Cache / Channel Layer ─────────────────────────────────────────────────────
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [REDIS_URL],
            "capacity": 1500,
            "expiry": 10,
        },
    }
}

# ─── Auth ─────────────────────────────────────────────────────────────────────
AUTH_USER_MODEL = "auth_rbac.BeaconUser"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

PASSWORD_HASHERS = [
    "apps.auth_rbac.hashers.Argon2idHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
]

# ─── JWT ──────────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "JTI_CLAIM": "jti",
    "TOKEN_TYPE_CLAIM": "token_type",
}

# ─── DRF ──────────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.CursorPagination",
    "PAGE_SIZE": 100,
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/minute",
        "user": "1000/minute",
        "login": "5/minute",
    },
}

# ─── CORS ─────────────────────────────────────────────────────────────────────

_cors_origins_raw = os.environ.get(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000,http://localhost:8000,https://atlas-beacon.vercel.app,http://57.158.25.89,https://57.158.25.89",
)

def _parse_cors_origins(raw: str) -> tuple[bool, list[str]]:
    if raw is None:
        return False, []
    trimmed = raw.strip()
    if not trimmed:
        return False, []
    candidates = [origin.strip() for origin in trimmed.split(",") if origin.strip()]
    if any(origin.strip().strip('"').strip("'") == "*" for origin in candidates):
        return True, []
    return False, candidates

CORS_ALLOW_ALL_ORIGINS, CORS_ALLOWED_ORIGINS = _parse_cors_origins(_cors_origins_raw)
CORS_ALLOWED_ORIGIN_REGEXES = _parse_list(
    os.environ.get(
        "CORS_ALLOWED_ORIGIN_REGEXES",
        r"^https://([a-z0-9-]+\.)?atlas-beacon\.vercel\.app$",
    )
)
CORS_ALLOW_ALL_HEADERS = CORS_ALLOW_ALL_ORIGINS
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = _parse_list(
    os.environ.get(
        "CSRF_TRUSTED_ORIGINS",
        "https://atlas-beacon.vercel.app,https://*.atlas-beacon.vercel.app,http://57.158.25.89,https://57.158.25.89",
    )
)

secure_redirect = os.environ.get("SECURE_SSL_REDIRECT", "false").lower() == "true"
SECURE_SSL_REDIRECT = secure_redirect

SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", str(secure_redirect)).lower() == "true"
CSRF_COOKIE_SECURE = os.environ.get("CSRF_COOKIE_SECURE", str(secure_redirect)).lower() == "true"

USE_X_FORWARDED_HOST = os.environ.get("USE_X_FORWARDED_HOST", "false").lower() == "true"

if os.environ.get("SECURE_PROXY_SSL_HEADER", ""):
    header, sep, value = os.environ["SECURE_PROXY_SSL_HEADER"].partition(":")
    if header and value:
        SECURE_PROXY_SSL_HEADER = (header.strip(), value.strip())

# ─── Encryption ───────────────────────────────────────────────────────────────
BEACON_AGENT_SECRET = require_env("BEACON_AGENT_SECRET")
BEACON_ENCRYPTION_KEY = os.environ.get("BEACON_ENCRYPTION_KEY", "")  # 32-byte AES-256 key (base64)
BEACON_TLS_CERT = os.environ.get("BEACON_TLS_CERT", "certs/server.crt")
BEACON_TLS_KEY = os.environ.get("BEACON_TLS_KEY", "certs/server.key")

# ─── Beacon Platform ──────────────────────────────────────────────────────────
BEACON_AGENT_HEARTBEAT_TIMEOUT = int(os.environ.get("BEACON_AGENT_HEARTBEAT_TIMEOUT", "60"))  # seconds
BEACON_MAX_AGENTS = int(os.environ.get("BEACON_MAX_AGENTS", "1000"))
BEACON_WEBSOCKET_BUFFER_SIZE = int(os.environ.get("BEACON_WEBSOCKET_BUFFER_SIZE", "1000"))

# ─── NATS Transport ───────────────────────────────────────────────────────────
BEACON_ENABLE_NATS_WORKER = os.environ.get("BEACON_ENABLE_NATS_WORKER", "1") != "0"
BEACON_NATS_URL = os.environ.get("BEACON_NATS_URL", "nats://localhost:4222")
BEACON_NATS_SUBJECT_PREFIX = os.environ.get("BEACON_NATS_SUBJECT_PREFIX", "agent")
BEACON_NATS_COMMAND_PREFIX = os.environ.get("BEACON_NATS_COMMAND_PREFIX", "agent_cmd")
BEACON_NATS_STREAM_INGEST = os.environ.get("BEACON_NATS_STREAM_INGEST", "agent_ingest")
BEACON_NATS_STREAM_CONTROL = os.environ.get("BEACON_NATS_STREAM_CONTROL", "agent_control")
BEACON_NATS_INGEST_CONSUMER = os.environ.get("BEACON_NATS_INGEST_CONSUMER", "beacon-server")
BEACON_RATE_LIMIT_PER_AGENT = int(os.environ.get("BEACON_RATE_LIMIT_PER_AGENT", "100"))  # msgs/sec

# ─── Sandbox Execution Defaults ───────────────────────────────────────────────
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "sandbox-python:1.0")
SANDBOX_TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT", "15"))
SANDBOX_MEM_LIMIT = os.environ.get("SANDBOX_MEM_LIMIT", "256m")
SANDBOX_CPU_QUOTA = int(os.environ.get("SANDBOX_CPU_QUOTA", "50000"))

# ─── Static / Media ───────────────────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ─── Logging ─────────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "{levelname} {asctime} {module} {process:d} {thread:d} {message}",
            "style": "{",
        },
        "simple": {"format": "{levelname} {message}", "style": "{"},
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
        "file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": BASE_DIR / "logs" / "beacon.log",
            "maxBytes": 1024 * 1024 * 10,  # 10 MB
            "backupCount": 5,
            "formatter": "verbose",
        },
        "ai_file": {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": BASE_DIR / "logs" / "ai.log",
            "maxBytes": 1024 * 1024 * 10,  # 10 MB
            "backupCount": 5,
            "formatter": "verbose",
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "beacon": {"handlers": ["console", "file"], "level": "DEBUG", "propagate": False},
        "django": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "ai": {"handlers": ["console", "ai_file"], "level": "INFO", "propagate": False},
    },
}

os.makedirs(BASE_DIR / "logs", exist_ok=True)
