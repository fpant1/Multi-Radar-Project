"""Data models for parsed OpenSky aircraft rows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .geo import bearing_degrees, haversine_distance_km, meters_per_second_to_kilometers_per_second


@dataclass(frozen=True)
class Aircraft:
    callsign: str
    icao24: str
    origin_country: str
    latitude: float
    longitude: float
    distance_km: float
    bearing: float
    altitude_m: float | None
    speed_km_s: float | None
    heading: float | None
    on_ground: bool
    last_contact_utc: str
    last_contact_timestamp: int | None
    last_contact_iso_utc: str

    @property
    def speed_kmh(self) -> float | None:
        return self.speed_km_s * 3600.0 if self.speed_km_s is not None else None

    @classmethod
    def from_opensky_state(cls, state: Any, center_lat: float, center_lon: float) -> "Aircraft":
        if not isinstance(state, (list, tuple)) or len(state) < 11:
            raise ValueError("OpenSky state row is missing required fields.")

        longitude = _float_or_none(state[5])
        latitude = _float_or_none(state[6])
        if latitude is None or longitude is None:
            raise ValueError("OpenSky state row has no usable position.")

        altitude_m = _float_or_none(state[7])
        velocity_mps = _float_or_none(state[9])
        heading = _float_or_none(state[10])

        return cls(
            callsign=_clean_text(state[1]),
            icao24=_clean_text(state[0]),
            origin_country=_clean_text(state[2]),
            latitude=latitude,
            longitude=longitude,
            distance_km=haversine_distance_km(center_lat, center_lon, latitude, longitude),
            bearing=bearing_degrees(center_lat, center_lon, latitude, longitude),
            altitude_m=altitude_m,
            speed_km_s=meters_per_second_to_kilometers_per_second(velocity_mps) if velocity_mps is not None else None,
            heading=heading,
            on_ground=bool(state[8]),
            last_contact_utc=format_unix_timestamp_utc(state[4]),
            last_contact_timestamp=_int_or_none(state[4]),
            last_contact_iso_utc=format_unix_timestamp_iso_utc(state[4]),
        )


def _clean_text(value: Any) -> str:
    if value is None:
        return "-"
    text = str(value).strip()
    return text or "-"


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _int_or_none(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def format_unix_timestamp_utc(value: Any) -> str:
    if value is None or value == "":
        return "-"
    timestamp = int(value)
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def format_unix_timestamp_iso_utc(value: Any) -> str:
    if value is None or value == "":
        return "-"
    timestamp = int(value)
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
