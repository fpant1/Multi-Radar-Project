"""RainViewer Weather Maps API client."""

from __future__ import annotations

from typing import Any

import requests


RAINVIEWER_METADATA_URL = "https://api.rainviewer.com/public/weather-maps.json"
REQUEST_TIMEOUT_SECONDS = 20


class RainViewerError(Exception):
    """Raised for expected RainViewer metadata failures."""


class RainViewerClient:
    def __init__(self, session: requests.Session | None = None) -> None:
        self._session = session or requests.Session()

    def fetch_metadata(self) -> dict[str, Any]:
        try:
            response = self._session.get(RAINVIEWER_METADATA_URL, timeout=REQUEST_TIMEOUT_SECONDS)
        except requests.exceptions.Timeout as exc:
            raise RainViewerError("Timed out while contacting RainViewer.") from exc
        except requests.exceptions.ConnectionError as exc:
            raise RainViewerError("Could not reach RainViewer. Check your internet connection.") from exc
        except requests.exceptions.RequestException as exc:
            raise RainViewerError(f"RainViewer request failed: {exc}") from exc

        if response.status_code >= 400:
            raise RainViewerError(f"RainViewer returned HTTP {response.status_code}: {_response_excerpt(response)}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise RainViewerError("RainViewer returned malformed JSON.") from exc

        if not isinstance(payload, dict):
            raise RainViewerError("RainViewer returned an unexpected JSON shape.")
        return payload


def _response_excerpt(response: requests.Response) -> str:
    text = response.text.strip().replace("\n", " ")
    return text[:240] if text else "no response body"
