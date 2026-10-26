"""Geographic calculations used by the OpenSky feed."""

from __future__ import annotations

import math
from dataclasses import dataclass


EARTH_RADIUS_KM = 6371.0088
NAUTICAL_MILE_TO_KM = 1.852


@dataclass(frozen=True)
class BoundingBox:
    lamin: float
    lomin: float
    lamax: float
    lomax: float

    def as_params(self) -> dict[str, str]:
        return {
            "lamin": f"{self.lamin:.6f}",
            "lomin": f"{self.lomin:.6f}",
            "lamax": f"{self.lamax:.6f}",
            "lomax": f"{self.lomax:.6f}",
        }


def validate_latitude(latitude: float) -> None:
    if not -90.0 <= latitude <= 90.0:
        raise ValueError("--lat must be between -90 and 90.")


def validate_longitude(longitude: float) -> None:
    if not -180.0 <= longitude <= 180.0:
        raise ValueError("--lon must be between -180 and 180.")


def validate_radius_km(radius_km: float) -> None:
    if radius_km <= 0:
        raise ValueError("--radius-km must be greater than 0.")


def nautical_miles_to_kilometers(value_nm: float) -> float:
    return value_nm * NAUTICAL_MILE_TO_KM


def bounding_box_from_radius_km(latitude: float, longitude: float, radius_km: float) -> BoundingBox:
    """Return an OpenSky-compatible WGS84 bounding box for a center and radius."""

    validate_latitude(latitude)
    validate_longitude(longitude)
    validate_radius_km(radius_km)

    angular_radius = radius_km / EARTH_RADIUS_KM
    latitude_delta = math.degrees(angular_radius)

    lamin = max(-90.0, latitude - latitude_delta)
    lamax = min(90.0, latitude + latitude_delta)

    latitude_radians = math.radians(latitude)
    cos_latitude = abs(math.cos(latitude_radians))
    if cos_latitude < 1e-12:
        longitude_delta = 180.0
    else:
        ratio = min(1.0, math.sin(angular_radius) / cos_latitude)
        longitude_delta = math.degrees(math.asin(ratio))

    lomin_raw = longitude - longitude_delta
    lomax_raw = longitude + longitude_delta

    if lomin_raw < -180.0 or lomax_raw > 180.0:
        lomin = -180.0
        lomax = 180.0
    else:
        lomin = lomin_raw
        lomax = lomax_raw

    return BoundingBox(lamin=lamin, lomin=lomin, lamax=lamax, lomax=lomax)


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_lat / 2.0) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c


def bearing_degrees(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lon = math.radians(lon2 - lon1)

    y = math.sin(delta_lon) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(delta_lon)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def meters_per_second_to_kilometers_per_second(value_mps: float) -> float:
    return value_mps / 1000.0


def meters_per_second_to_kilometers_per_hour(value_mps: float) -> float:
    return value_mps * 3.6
