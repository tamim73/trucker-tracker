from datetime import datetime

from rest_framework import serializers

from .services.geo import in_us


class PlaceSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=200, trim_whitespace=True)
    lat = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    lon = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)

    def validate(self, attrs):
        lat, lon = attrs.get("lat"), attrs.get("lon")
        if (lat is None) != (lon is None):
            raise serializers.ValidationError("Send both lat and lon, or neither.")
        if lat is not None and not in_us(lat, lon):
            raise serializers.ValidationError("Pick a location in the United States.")
        return attrs


class PlaceSearchSerializer(serializers.Serializer):
    q = serializers.CharField(max_length=200, trim_whitespace=True, allow_blank=True)


class CoordinateSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class DriverSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    co_driver = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    carrier = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    main_office = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    home_terminal = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    vehicle_numbers = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    shipping_document = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    commodity = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")


class TripRequestSerializer(serializers.Serializer):
    current = PlaceSerializer()
    pickup = PlaceSerializer()
    dropoff = PlaceSerializer()
    cycle_used_hours = serializers.FloatField(min_value=0, max_value=70)
    # Local wall-clock time at the home terminal, e.g. "2026-10-02T06:30".
    departure = serializers.CharField(max_length=19)
    driver = DriverSerializer(required=False)

    def validate_departure(self, value):
        for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
        raise serializers.ValidationError("Use the format YYYY-MM-DDTHH:MM.")


class LogEntrySerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["off_duty", "sleeper_berth", "driving", "on_duty"])
    kind = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    start = serializers.IntegerField(min_value=0, max_value=1440)
    end = serializers.IntegerField(min_value=0, max_value=1440)
    location = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    note = serializers.CharField(max_length=160, required=False, allow_blank=True, default="")
    miles = serializers.FloatField(min_value=0, max_value=1500, required=False, default=0)


class LogPreviewSerializer(serializers.Serializer):
    entries = LogEntrySerializer(many=True, min_length=1, max_length=96)
    miles = serializers.FloatField(min_value=0, max_value=1500)
    total_mileage = serializers.FloatField(min_value=0, max_value=1500, required=False, allow_null=True)
    from_place = serializers.CharField(max_length=120, required=False, allow_blank=True)
    to_place = serializers.CharField(max_length=120, required=False, allow_blank=True)
    driver = DriverSerializer(required=False)


class LogEditSerializer(LogPreviewSerializer):
    reason = serializers.CharField(min_length=3, max_length=200, trim_whitespace=True)
