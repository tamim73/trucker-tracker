import secrets

from django.db import migrations, models

import trips.models


def give_each_trip_its_own_token(apps, schema_editor):
    # AddField evaluates the default once; existing rows must not share a token.
    Trip = apps.get_model("trips", "Trip")
    for trip in Trip.objects.all().only("id"):
        Trip.objects.filter(pk=trip.pk).update(edit_token=secrets.token_urlsafe(24))


class Migration(migrations.Migration):
    dependencies = [
        ("trips", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="trip",
            name="edit_token",
            field=models.CharField(default=trips.models.edit_token, editable=False, max_length=64),
        ),
        migrations.RunPython(give_each_trip_its_own_token, migrations.RunPython.noop),
    ]
