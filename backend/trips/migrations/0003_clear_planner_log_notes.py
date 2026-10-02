from django.db import migrations

# Log entries used to copy the planner's internal notes ("Driving toward ...",
# "10-hour break in sleeper berth (...)"). Notes are now the driver's own
# remark text and print on the sheet, so planner notes are cleared. Notes on
# entries the driver created by hand (generic kinds) are kept.
DRIVER_KINDS = {"off_duty", "sleeper", "on_duty"}
PLANNER_OFF_DUTY_NOTES = {"Off duty before departure", "Off duty, trip complete"}


def clear_notes(apps, schema_editor):
    Trip = apps.get_model("trips", "Trip")
    for trip in Trip.objects.all():
        changed = False
        for key in ("logs", "planned_logs"):
            for log in trip.result.get(key) or []:
                for entry in log.get("entries", []):
                    note = entry.get("note") or ""
                    if note and (entry.get("kind") not in DRIVER_KINDS or note in PLANNER_OFF_DUTY_NOTES):
                        entry["note"] = ""
                        changed = True
                for remark in log.get("remarks", []):
                    note = remark.get("note") or ""
                    if note and (remark.get("kind") not in DRIVER_KINDS or note in PLANNER_OFF_DUTY_NOTES):
                        remark["note"] = ""
                        changed = True
        if changed:
            trip.save(update_fields=["result"])


class Migration(migrations.Migration):
    dependencies = [
        ("trips", "0002_trip_edit_token"),
    ]

    operations = [migrations.RunPython(clear_notes, migrations.RunPython.noop)]
