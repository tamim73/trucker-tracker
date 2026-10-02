from django.conf import settings


class ContentSecurityPolicyMiddleware:
    """Adds the Content-Security-Policy header (Django 5.2 has no built-in one)."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        policy = getattr(settings, "CONTENT_SECURITY_POLICY", "")
        if policy and not settings.DEBUG:
            response.headers.setdefault("Content-Security-Policy", policy)
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), payment=(), geolocation=(self)")
        return response
