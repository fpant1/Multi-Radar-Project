"""OpenSky REST API client with OAuth2 client-credentials support."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .geo import BoundingBox
from .models import Aircraft, format_unix_timestamp_utc


STATES_URL = "https://opensky-network.org/api/states/all"
TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token"
REQUEST_TIMEOUT_SECONDS = 20
TOKEN_REFRESH_MARGIN_SECONDS = 30


class OpenSkyError(Exception):
    """Base exception for expected OpenSky feed failures."""


class OpenSkyAuthError(OpenSkyError):
    """Raised when OpenSky rejects credentials or authentication."""


class OpenSkyAPIError(OpenSkyError):
    """Raised for network, API, or response-shape failures."""


class OpenSkyRateLimitError(OpenSkyError):
    """Raised when OpenSky returns HTTP 429."""

    def __init__(self, message: str, retry_after_seconds: str | None = None) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


@dataclass(frozen=True)
class FeedSnapshot:
    aircraft: list[Aircraft]
    skipped_records: int
    source_time_utc: str
    fetched_at_utc: str
    rate_limit_remaining: str | None


class TokenManager:
    def __init__(self, client_id: str, client_secret: str, session: requests.Session) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._session = session
        self._token: str | None = None
        self._expires_at: datetime | None = None

    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.get_token()}"}

    def get_token(self) -> str:
        now = datetime.now(timezone.utc)
        if self._token and self._expires_at and now < self._expires_at:
            return self._token
        return self._refresh()

    def clear(self) -> None:
        self._token = None
        self._expires_at = None

    def _refresh(self) -> str:
        try:
            response = self._session.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                },
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.exceptions.Timeout as exc:
            raise OpenSkyAPIError("Timed out while contacting the OpenSky authentication service.") from exc
        except requests.exceptions.ConnectionError as exc:
            raise OpenSkyAPIError("Could not reach OpenSky authentication. Check your internet connection.") from exc
        except requests.exceptions.RequestException as exc:
            raise OpenSkyAPIError(f"OpenSky authentication request failed: {exc}") from exc

        if response.status_code in {400, 401, 403}:
            raise OpenSkyAuthError("OpenSky rejected OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET.")
        if response.status_code >= 400:
            raise OpenSkyAPIError(f"OpenSky authentication failed with HTTP {response.status_code}: {_response_excerpt(response)}")

        try:
            payload = response.json()
        except ValueError as exc:
            raise OpenSkyAPIError("OpenSky authentication returned malformed JSON.") from exc

        token = payload.get("access_token")
        if not token:
            raise OpenSkyAPIError("OpenSky authentication response did not include an access token.")

        expires_in = int(payload.get("expires_in", 1800))
        refresh_in = max(0, expires_in - TOKEN_REFRESH_MARGIN_SECONDS)
        self._token = str(token)
        self._expires_at = datetime.now(timezone.utc) + timedelta(seconds=refresh_in)
        return self._token


class OpenSkyClient:
    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        session: requests.Session | None = None,
    ) -> None:
        self._session = session or requests.Session()
        self._token_manager = TokenManager(client_id, client_secret, self._session) if client_id and client_secret else None

    def fetch_aircraft(self, bbox: BoundingBox, center_lat: float, center_lon: float) -> FeedSnapshot:
        response = self._request_states(bbox)
        payload = _json_payload(response)

        states = payload.get("states") or []
        if not isinstance(states, list):
            raise OpenSkyAPIError("OpenSky response field `states` was not a list.")

        aircraft: list[Aircraft] = []
        skipped_records = 0
        for state in states:
            try:
                aircraft.append(Aircraft.from_opensky_state(state, center_lat, center_lon))
            except (TypeError, ValueError):
                skipped_records += 1

        aircraft.sort(key=lambda item: item.distance_km)
        return FeedSnapshot(
            aircraft=aircraft,
            skipped_records=skipped_records,
            source_time_utc=format_unix_timestamp_utc(payload.get("time")),
            fetched_at_utc=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
            rate_limit_remaining=response.headers.get("X-Rate-Limit-Remaining"),
        )

    def _request_states(self, bbox: BoundingBox) -> requests.Response:
        headers = self._auth_headers()
        response = self._get_states(bbox, headers)

        if response.status_code == 401 and self._token_manager:
            self._token_manager.clear()
            response = self._get_states(bbox, self._auth_headers())

        _raise_for_status(response)
        return response

    def _auth_headers(self) -> dict[str, str]:
        return self._token_manager.headers() if self._token_manager else {}

    def _get_states(self, bbox: BoundingBox, headers: dict[str, str]) -> requests.Response:
        try:
            return self._session.get(
                STATES_URL,
                params=bbox.as_params(),
                headers=headers,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.exceptions.Timeout as exc:
            raise OpenSkyAPIError("Timed out while contacting OpenSky.") from exc
        except requests.exceptions.ConnectionError as exc:
            raise OpenSkyAPIError("Could not reach OpenSky. Check your internet connection.") from exc
        except requests.exceptions.RequestException as exc:
            raise OpenSkyAPIError(f"OpenSky request failed: {exc}") from exc


def _json_payload(response: requests.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise OpenSkyAPIError("OpenSky returned malformed JSON.") from exc

    if not isinstance(payload, dict):
        raise OpenSkyAPIError("OpenSky returned an unexpected JSON shape.")
    return payload


def _raise_for_status(response: requests.Response) -> None:
    if response.status_code < 400:
        return

    if response.status_code == 429:
        retry_after = response.headers.get("X-Rate-Limit-Retry-After-Seconds") or response.headers.get("Retry-After")
        suffix = f" Retry after {retry_after} seconds." if retry_after else ""
        raise OpenSkyRateLimitError(f"OpenSky rate limit reached.{suffix}", retry_after_seconds=retry_after)

    if response.status_code in {401, 403}:
        raise OpenSkyAuthError(f"OpenSky authentication failed with HTTP {response.status_code}. Check your credentials.")

    raise OpenSkyAPIError(f"OpenSky API returned HTTP {response.status_code}: {_response_excerpt(response)}")


def _response_excerpt(response: requests.Response) -> str:
    text = response.text.strip().replace("\n", " ")
    return text[:240] if text else "no response body"
