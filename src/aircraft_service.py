"""Cached aircraft polling service for the browser radar UI."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .config import (
    MAX_DISPLAY_CONTACTS,
    MAX_HARD_CONTACT_CAP,
    MAX_LABELLED_CONTACTS,
    MAX_SIDE_PANEL_CONTACTS,
    MIN_POLL_INTERVAL_SECONDS,
    STALE_CONTACT_SECONDS,
    load_settings,
)
from .geo import BoundingBox, bounding_box_from_radius_km
from .models import Aircraft
from .opensky_client import FeedSnapshot, OpenSkyAPIError, OpenSkyAuthError, OpenSkyClient, OpenSkyRateLimitError


@dataclass(frozen=True)
class AircraftServiceConfig:
    home_lat: float
    home_lon: float
    range_km: float
    interval_seconds: int


class AircraftService:
    def __init__(self, config: AircraftServiceConfig, client: OpenSkyClient | None = None) -> None:
        self.config = config
        self.bbox = bounding_box_from_radius_km(config.home_lat, config.home_lon, config.range_km)
        self.client = client or self._build_default_client()
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._latest_success: dict[str, Any] | None = None
        self._latest_response: dict[str, Any] = self._empty_response(
            status="starting",
            error="Waiting for first OpenSky poll.",
            updated_at=_utc_now_iso(),
        )

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._poll_loop, name="opensky-poller", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def latest(self) -> dict[str, Any]:
        with self._lock:
            return dict(self._latest_response)

    def poll_once(self) -> dict[str, Any]:
        try:
            snapshot = self.client.fetch_aircraft(self.bbox, self.config.home_lat, self.config.home_lon)
            response = self._response_from_snapshot(snapshot)
            with self._lock:
                self._latest_success = response
                self._latest_response = response
            return response
        except (OpenSkyAuthError, OpenSkyRateLimitError, OpenSkyAPIError) as exc:
            response = self._response_from_error(str(exc))
            with self._lock:
                self._latest_response = response
            return response

    def _poll_loop(self) -> None:
        while not self._stop_event.is_set():
            self.poll_once()
            self._stop_event.wait(self.config.interval_seconds)

    def _response_from_snapshot(self, snapshot: FeedSnapshot) -> dict[str, Any]:
        raw_count = len(snapshot.aircraft) + snapshot.skipped_records
        valid_contacts = _remove_stale_contacts(snapshot.aircraft)
        airborne_contacts = [contact for contact in valid_contacts if not contact.on_ground]
        filtered_contacts = airborne_contacts if airborne_contacts else valid_contacts
        airborne_only = bool(airborne_contacts)

        ranked_contacts = sorted(filtered_contacts, key=_display_rank)
        returned_contacts = ranked_contacts[:MAX_HARD_CONTACT_CAP]
        label_ids = _labelled_contact_ids(returned_contacts)
        contacts = [_contact_payload(contact, contact.icao24 in label_ids) for contact in returned_contacts]

        displayed_count = min(MAX_DISPLAY_CONTACTS, len(contacts))
        labelled_count = sum(1 for contact in contacts[:MAX_DISPLAY_CONTACTS] if contact["should_label"])

        return {
            "provider": "opensky",
            "updated_at": _utc_now_iso(),
            "status": "ok",
            "home": {"lat": self.config.home_lat, "lon": self.config.home_lon},
            "range_km": self.config.range_km,
            "bbox": _bbox_payload(self.bbox),
            "filter": {
                "strategy": "nearest",
                "airborne_only": airborne_only,
                "max_display_contacts": MAX_DISPLAY_CONTACTS,
                "max_labelled_contacts": MAX_LABELLED_CONTACTS,
                "max_side_panel_contacts": MAX_SIDE_PANEL_CONTACTS,
            },
            "counts": {
                "raw": raw_count,
                "valid": len(valid_contacts),
                "returned": len(contacts),
                "displayed": displayed_count,
                "labelled": labelled_count,
            },
            "contacts": contacts,
            "error": None,
        }

    def _response_from_error(self, error: str) -> dict[str, Any]:
        if self._latest_success:
            response = dict(self._latest_success)
            response["status"] = "stale"
            response["error"] = f"OpenSky request failed, showing cached data: {error}"
            return response

        return self._empty_response(status="error", error=error, updated_at=_utc_now_iso())

    def _empty_response(self, status: str, error: str | None, updated_at: str) -> dict[str, Any]:
        return {
            "provider": "opensky",
            "updated_at": updated_at,
            "status": status,
            "home": {"lat": self.config.home_lat, "lon": self.config.home_lon},
            "range_km": self.config.range_km,
            "bbox": _bbox_payload(self.bbox),
            "filter": {
                "strategy": "nearest",
                "airborne_only": True,
                "max_display_contacts": MAX_DISPLAY_CONTACTS,
                "max_labelled_contacts": MAX_LABELLED_CONTACTS,
                "max_side_panel_contacts": MAX_SIDE_PANEL_CONTACTS,
            },
            "counts": {"raw": 0, "valid": 0, "returned": 0, "displayed": 0, "labelled": 0},
            "contacts": [],
            "error": error,
        }

    @staticmethod
    def _build_default_client() -> OpenSkyClient:
        settings = load_settings()
        return OpenSkyClient(
            client_id=settings.opensky_client_id if settings.has_credentials else None,
            client_secret=settings.opensky_client_secret if settings.has_credentials else None,
        )


def validate_interval(interval_seconds: int) -> None:
    if interval_seconds < MIN_POLL_INTERVAL_SECONDS:
        raise ValueError(f"--interval must be at least {MIN_POLL_INTERVAL_SECONDS} seconds.")


def _remove_stale_contacts(contacts: list[Aircraft]) -> list[Aircraft]:
    now = time.time()
    return [
        contact
        for contact in contacts
        if contact.last_contact_timestamp is None or now - contact.last_contact_timestamp <= STALE_CONTACT_SECONDS
    ]


def _display_rank(contact: Aircraft) -> tuple[int, float, int]:
    missing_callsign = 1 if _missing_label(contact.callsign) else 0
    on_ground = 1 if contact.on_ground else 0
    return (on_ground, contact.distance_km, missing_callsign)


def _labelled_contact_ids(contacts: list[Aircraft]) -> set[str]:
    candidates = sorted(contacts[:MAX_DISPLAY_CONTACTS], key=_label_rank)
    return {contact.icao24 for contact in candidates[:MAX_LABELLED_CONTACTS]}


def _label_rank(contact: Aircraft) -> tuple[int, int, float]:
    missing_callsign = 1 if _missing_label(contact.callsign) else 0
    on_ground = 1 if contact.on_ground else 0
    return (missing_callsign, on_ground, contact.distance_km)


def _contact_payload(contact: Aircraft, should_label: bool) -> dict[str, Any]:
    return {
        "id": contact.icao24,
        "callsign": None if _missing_label(contact.callsign) else contact.callsign,
        "country": None if _missing_label(contact.origin_country) else contact.origin_country,
        "lat": round(contact.latitude, 6),
        "lon": round(contact.longitude, 6),
        "distance_km": round(contact.distance_km, 1),
        "bearing_deg": round(contact.bearing, 1),
        "altitude_m": _round_optional(contact.altitude_m, 0),
        "speed_kmh": _round_optional(contact.speed_kmh, 0),
        "heading_deg": _round_optional(contact.heading, 0),
        "on_ground": contact.on_ground,
        "last_contact_utc": contact.last_contact_iso_utc,
        "should_label": should_label,
    }


def _bbox_payload(bbox: BoundingBox) -> dict[str, float]:
    return {
        "min_latitude": round(bbox.lamin, 6),
        "min_longitude": round(bbox.lomin, 6),
        "max_latitude": round(bbox.lamax, 6),
        "max_longitude": round(bbox.lomax, 6),
    }


def _round_optional(value: float | None, decimals: int) -> float | int | None:
    if value is None:
        return None
    rounded = round(value, decimals)
    return int(rounded) if decimals == 0 else rounded


def _missing_label(value: str | None) -> bool:
    return not value or value == "-"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
