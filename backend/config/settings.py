"""Django settings for the HOS trip planner demo.

Production is the default: DEBUG is off unless DJANGO_DEBUG=1, and a secret
key must be provided. manage.py turns DEBUG on for local development.
"""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or ("dev-only-insecure-key" if DEBUG else "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY when DJANGO_DEBUG is off.")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "trips",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "config.middleware.ContentSecurityPolicyMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("DJANGO_DB_PATH", BASE_DIR / "db.sqlite3"),
        "OPTIONS": {
            # Writers queue instead of failing with "database is locked".
            "transaction_mode": "IMMEDIATE",
            "timeout": 20,
            "init_command": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
        },
    }
}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "TIMEOUT": 60 * 60 * 24,
        "OPTIONS": {"MAX_ENTRIES": 5000},
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# The built React app is served from the site root (assets/, favicon, ...).
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
WHITENOISE_MIMETYPES = {".mjs": "text/javascript"}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Trip requests are small JSON documents; reject anything larger early.
DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    # Per client IP. Railway's edge proxy adds one X-Forwarded-For hop.
    "NUM_PROXIES": int(os.environ.get("TRUSTED_PROXY_COUNT", "0" if DEBUG else "1")),
    "DEFAULT_THROTTLE_RATES": {
        "places": "120/min",
        "trips": "30/hour",
        "log_edits": "300/hour",
        "log_previews": "1200/hour",
    },
}

CORS_ALLOWED_ORIGINS = env_list(
    "DJANGO_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173" if DEBUG else ""
)

# HTTPS. Railway terminates TLS and forwards the original scheme.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SECURE_SSL_REDIRECT", "0" if DEBUG else "1") == "1"
SECURE_HSTS_SECONDS = 0 if DEBUG else 60 * 60 * 24 * 365
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
SECURE_REFERRER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

SILENCED_SYSTEM_CHECKS = [
    # No cookies or sessions exist. The API accepts only JSON and authorizes
    # log edits with a custom X-Edit-Token header, which another origin cannot
    # send without a CORS preflight that this API does not allow.
    "security.W003",
    # The app runs on a shared platform domain (*.up.railway.app); HSTS must
    # not claim subdomains or the preload list for a domain it does not own.
    "security.W005",
    "security.W021",
]

# Map style, tiles, fonts and sprites come from OpenFreeMap; MapLibre runs a
# module worker from a blob URL. Inline styles are needed for SVG and React.
CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://tiles.openfreemap.org",
        "font-src 'self' data:",
        "connect-src 'self' https://tiles.openfreemap.org",
        "worker-src 'self' blob:",
        "child-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

# Errors must reach stdout in production, where DEBUG is off and there is no
# admin mailbox.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": "WARNING"},
    "loggers": {
        "django.request": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "trips": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

# External, key-free geo services. Override to point at self-hosted instances.
GEO_USER_AGENT = os.environ.get("GEO_USER_AGENT", "hos-trip-planner-demo/1.0")
PHOTON_URL = os.environ.get("PHOTON_URL", "https://photon.komoot.io")
OSRM_URL = os.environ.get("OSRM_URL", "https://router.project-osrm.org")
# (connect, read) seconds per request, and a total budget for labeling stops.
GEO_TIMEOUT = (4.0, float(os.environ.get("GEO_READ_TIMEOUT_SECONDS", "10")))
GEO_LABEL_BUDGET_SECONDS = float(os.environ.get("GEO_LABEL_BUDGET_SECONDS", "15"))
