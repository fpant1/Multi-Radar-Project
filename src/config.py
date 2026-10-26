"""Configuration loading for the Local Radar prototype."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


DEFAULT_RADIUS_KM = 50.0
DEFAULT_POLL_INTERVAL_SECONDS = 30
MIN_POLL_INTERVAL_SECONDS = 10
MAX_DISPLAY_CONTACTS = 30
MAX_LABELLED_CONTACTS = 10
MAX_SIDE_PANEL_CONTACTS = 6
MAX_HARD_CONTACT_CAP = 40
STALE_CONTACT_SECONDS = 120
RAINVIEWER_REFRESH_SECONDS = 60
RAINVIEWER_TILE_SIZE = 512
RAINVIEWER_ZOOM = 7
RAINVIEWER_COLOR_SCHEME = 2
RAINVIEWER_SMOOTH = 1
RAINVIEWER_SNOW = 1


@dataclass(frozen=True)
class Settings:
    """Runtime settings loaded from environment variables."""

    opensky_client_id: str | None
    opensky_client_secret: str | None

    @property
    def has_credentials(self) -> bool:
        return bool(self.opensky_client_id and self.opensky_client_secret)

    @property
    def has_partial_credentials(self) -> bool:
        return bool(self.opensky_client_id) != bool(self.opensky_client_secret)


def _clean_env_value(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def load_settings() -> Settings:
    """Load `.env` and return OpenSky credential settings."""

    load_dotenv()
    return Settings(
        opensky_client_id=_clean_env_value("OPENSKY_CLIENT_ID"),
        opensky_client_secret=_clean_env_value("OPENSKY_CLIENT_SECRET"),
    )
