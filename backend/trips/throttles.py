from rest_framework.throttling import SimpleRateThrottle


class IpRateThrottle(SimpleRateThrottle):
    """Rate limit per client IP. Each subclass names its rate in settings."""

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class PlacesThrottle(IpRateThrottle):
    scope = "places"


class TripCreateThrottle(IpRateThrottle):
    scope = "trips"


class LogEditThrottle(IpRateThrottle):
    scope = "log_edits"


class LogPreviewThrottle(IpRateThrottle):
    scope = "log_previews"
