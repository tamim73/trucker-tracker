import secrets

from django.db import models

ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"


def short_id() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(8))


def edit_token() -> str:
    return secrets.token_urlsafe(24)


class Trip(models.Model):
    """A planned trip. Inputs and the computed plan are stored as JSON so a
    plan can be shared by URL and reopened without calling the geo services.

    The id in the URL grants read access only. Editing the logs requires the
    edit token, which is returned once, to the client that created the trip."""

    id = models.CharField(primary_key=True, max_length=12, default=short_id, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    inputs = models.JSONField()
    result = models.JSONField()
    edit_token = models.CharField(max_length=64, default=edit_token, editable=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Trip {self.id}"
