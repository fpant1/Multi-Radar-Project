"""Cached RainViewer weather radar service."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .config import (
    RAINVIEWER_COLOR_SCHEME,
    RAINVIEWER_REFRESH_SECONDS,
    RAINVIEWER_SMOOTH,
    RAINVIEWER_SNOW,
    RAINVIEWER_TILE_SIZE,
    RAINVIEWER_ZOOM,
)
from .rainviewer_client import RainViewerClient, RainViewerError


@dataclass(frozen=True)
class WeatherServiceConfig:
    home_lat: float
    home_lon: float
    range_km: float


class WeatherService:
    def __init__(self, config: WeatherServiceConfig, client: RainViewerClient | None = None) -> None:
        self.config = config
        self.client = client or RainViewerClient()
        self._lock = threading.RLock()
        self._last_refresh_monotonic = 0.0
        self._latest_success: dict[str, Any] | None = None
        self._latest_response: dict[str, Any] = self._empty_response(
            status="starting",
            error="Waiting for first RainViewer metadata fetch.",
        )

    def latest(self) -> dict[str, Any]:
        with self._lock:
            should_refresh = time.monotonic() - self._last_refresh_monotonic >= RAINVIEWER_REFRESH_SECONDS
            if not should_refresh and self._latest_success:
                return dict(self._latest_response)

        if should_refresh or not self._latest_success:
            return self.refresh()

        with self._lock:
            return dict(self._latest_response)

    def refresh(self) -> dict[str, Any]:
        try:
            metadata = self.client.fetch_metadata()
            response = self._response_from_metadata(metadata, status="ok", error=None)
            with self._lock:
                self._last_refresh_monotonic = time.monotonic()
                self._latest_success = response
                self._latest_response = response
            return response
        except RainViewerError as exc:
            response = self._response_from_error(str(exc))
            with self._lock:
                self._last_refresh_monotonic = time.monotonic()
                self._latest_response = response
            return response

    def health_status(self) -> dict[str, str | None]:
        with self._lock:
            return {
                "provider": "rainviewer",
                "status": str(self._latest_response.get("status", "starting")),
                "error": self._latest_response.get("error"),
            }

    def _response_from_metadata(self, metadata: dict[str, Any], status: str, error: str | None) -> dict[str, Any]:
        host = _required_text(metadata.get("host"), "RainViewer metadata missing `host`.")
        generated = _required_int(metadata.get("generated"), "RainViewer metadata missing `generated`.")
        frame = _latest_radar_frame(metadata)
        path = _required_text(frame.get("path"), "RainViewer latest frame missing `path`.")
        frame_time = _required_int(frame.get("time"), "RainViewer latest frame missing `time`.")
        options = f"{RAINVIEWER_SMOOTH}_{RAINVIEWER_SNOW}"

        return {
            "provider": "rainviewer",
            "status": status,
            "generated_at": _iso_from_timestamp(generated),
            "updated_at": _utc_now_iso(),
            "latest_frame": {
                "time": frame_time,
                "time_utc": _iso_from_timestamp(frame_time),
                "path": path,
            },
            "host": host,
            "home": {"lat": self.config.home_lat, "lon": self.config.home_lon},
            "range_km": self.config.range_km,
            "tile": {
                "size": RAINVIEWER_TILE_SIZE,
                "zoom": RAINVIEWER_ZOOM,
                "color": RAINVIEWER_COLOR_SCHEME,
                "smooth": RAINVIEWER_SMOOTH,
                "snow": RAINVIEWER_SNOW,
                "options": options,
                "url_template_xyz": (
                    f"{host}{path}/{RAINVIEWER_TILE_SIZE}/{{z}}/{{x}}/{{y}}/"
                    f"{RAINVIEWER_COLOR_SCHEME}/{options}.png"
                ),
                "url_centered": (
                    f"{host}{path}/{RAINVIEWER_TILE_SIZE}/{RAINVIEWER_ZOOM}/"
                    f"{self.config.home_lat:.6f}/{self.config.home_lon:.6f}/"
                    f"{RAINVIEWER_COLOR_SCHEME}/{options}.png"
                ),
            },
            "error": error,
        }

    def _response_from_error(self, error: str) -> dict[str, Any]:
        if self._latest_success:
            response = dict(self._latest_success)
            response["status"] = "stale"
            response["updated_at"] = _utc_now_iso()
            response["error"] = f"RainViewer metadata refresh failed, using cached frame: {error}"
            return response

        return self._empty_response(status="error", error=error)

    def _empty_response(self, status: str, error: str | None) -> dict[str, Any]:
        return {
            "provider": "rainviewer",
            "status": status,
            "generated_at": None,
            "updated_at": _utc_now_iso(),
            "latest_frame": None,
            "host": None,
            "home": {"lat": self.config.home_lat, "lon": self.config.home_lon},
            "range_km": self.config.range_km,
            "tile": None,
            "error": error,
        }


def _latest_radar_frame(metadata: dict[str, Any]) -> dict[str, Any]:
    radar = metadata.get("radar")
    if not isinstance(radar, dict):
        raise RainViewerError("RainViewer metadata missing `radar`.")

    past = radar.get("past")
    if not isinstance(past, list) or not past:
        raise RainViewerError("RainViewer metadata has no past radar frames.")

    frames = [frame for frame in past if isinstance(frame, dict)]
    if not frames:
        raise RainViewerError("RainViewer metadata has no usable radar frames.")
    return max(frames, key=lambda frame: int(frame.get("time", 0)))


def _required_text(value: Any, message: str) -> str:
    if not isinstance(value, str) or not value:
        raise RainViewerError(message)
    return value


def _required_int(value: Any, message: str) -> int:
    if value is None or value == "":
        raise RainViewerError(message)
    return int(value)


def _iso_from_timestamp(value: int) -> str:
    return datetime.fromtimestamp(value, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
