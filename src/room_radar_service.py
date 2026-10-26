"""Serial-backed room radar service for Arduino/RD-03D target data."""

from __future__ import annotations

import json
import math
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


DEFAULT_ROOM_BAUD = 115200
DEFAULT_ROOM_RANGE_MM = 8000.0
ROOM_TARGET_STALE_SECONDS = 3.0
ROOM_RECONNECT_SECONDS = 2.0


@dataclass(frozen=True)
class RoomRadarServiceConfig:
    port: str | None = None
    baud: int = DEFAULT_ROOM_BAUD
    range_mm: float = DEFAULT_ROOM_RANGE_MM


class RoomRadarService:
    def __init__(self, config: RoomRadarServiceConfig) -> None:
        self.config = config
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._pending_labelled_frame: dict[str, float] = {}
        self._latest_response: dict[str, Any] = self._empty_response()

    def start(self) -> None:
        if not self.config.port:
            return
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._serial_loop, name="room-radar-serial", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def latest(self) -> dict[str, Any]:
        with self._lock:
            response = dict(self._latest_response)
            target = response.get("target")

        if isinstance(target, dict) and target.get("updated_at_monotonic") is not None:
            age = max(0.0, time.monotonic() - float(target["updated_at_monotonic"]))
            target = dict(target)
            target.pop("updated_at_monotonic", None)
            target["age_s"] = round(age, 2)
            response["target"] = target
            if response.get("status") == "ok" and age > ROOM_TARGET_STALE_SECONDS:
                response["status"] = "stale"
                response["error"] = "Room radar target is stale."

        return response

    def health_status(self) -> dict[str, str | None]:
        latest = self.latest()
        return {
            "provider": "room-radar",
            "status": str(latest.get("status", "disabled")),
            "port": self.config.port,
            "error": latest.get("error"),
        }

    def _serial_loop(self) -> None:
        try:
            import serial
        except ImportError:
            self._set_error("pyserial is not installed. Run `pip install -r requirements.txt`.")
            return

        while not self._stop_event.is_set():
            try:
                with serial.Serial(self.config.port, self.config.baud, timeout=1) as serial_port:
                    self._set_status("starting", f"Listening for room radar data on {self.config.port}.")
                    while not self._stop_event.is_set():
                        raw = serial_port.readline()
                        if not raw:
                            continue
                        line = raw.decode("utf-8", errors="replace").strip()
                        self._handle_line(line)
            except Exception as exc:  # noqa: BLE001 - serial drivers raise many platform-specific exceptions.
                self._set_error(f"Room radar serial error on {self.config.port}: {exc}")
                self._stop_event.wait(ROOM_RECONNECT_SECONDS)

    def _handle_line(self, line: str) -> None:
        if not line:
            return

        target = _parse_json_line(line) or _parse_csv_line(line)
        if target:
            self._set_target(target, line)
            return

        labelled_target = self._parse_labelled_line(line)
        if labelled_target:
            self._set_target(labelled_target, line)

    def _parse_labelled_line(self, line: str) -> dict[str, float | bool | None] | None:
        if set(line) <= {"-"}:
            target = _target_from_fields(self._pending_labelled_frame)
            self._pending_labelled_frame = {}
            return target

        match = re.match(r"^\s*([A-Za-z ]+)(?:\([^)]+\))?\s*:\s*(-?\d+(?:\.\d+)?)\s*$", line)
        if not match:
            return None

        label = match.group(1).strip().lower()
        value = float(match.group(2))
        if label == "x":
            self._pending_labelled_frame["x_mm"] = value
        elif label == "y":
            self._pending_labelled_frame["y_mm"] = value
        elif label == "distance":
            self._pending_labelled_frame["distance_mm"] = value
        elif label == "angle":
            self._pending_labelled_frame["angle_deg"] = value
        elif label == "speed":
            self._pending_labelled_frame["speed_cm_s"] = value

        return None

    def _set_target(self, target: dict[str, Any], raw_line: str) -> None:
        target["updated_at_monotonic"] = time.monotonic()
        response = {
            "provider": "room-radar",
            "updated_at": _utc_now_iso(),
            "status": "ok",
            "port": self.config.port,
            "baud": self.config.baud,
            "range_mm": self.config.range_mm,
            "range_m": round(self.config.range_mm / 1000.0, 2),
            "target": target,
            "raw_line": raw_line,
            "error": None,
        }
        with self._lock:
            self._latest_response = response

    def _set_status(self, status: str, message: str | None) -> None:
        with self._lock:
            self._latest_response = {
                **self._empty_response(),
                "updated_at": _utc_now_iso(),
                "status": status,
                "error": message,
            }

    def _set_error(self, error: str) -> None:
        self._set_status("error", error)

    def _empty_response(self) -> dict[str, Any]:
        return {
            "provider": "room-radar",
            "updated_at": _utc_now_iso(),
            "status": "disabled" if not self.config.port else "starting",
            "port": self.config.port,
            "baud": self.config.baud,
            "range_mm": self.config.range_mm,
            "range_m": round(self.config.range_mm / 1000.0, 2),
            "target": None,
            "raw_line": None,
            "error": None if not self.config.port else "Waiting for room radar serial data.",
        }


def validate_room_baud(baud: int) -> None:
    if baud <= 0:
        raise ValueError("--room-baud must be greater than 0.")


def validate_room_range_mm(range_mm: float) -> None:
    if range_mm <= 0:
        raise ValueError("--room-range-mm must be greater than 0.")


def _parse_json_line(line: str) -> dict[str, float | bool | None] | None:
    if not line.startswith("{"):
        return None
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    fields = {
        "angle_deg": _optional_float(payload.get("angle_deg", payload.get("angle"))),
        "distance_mm": _optional_float(payload.get("distance_mm", payload.get("distance"))),
        "speed_cm_s": _optional_float(payload.get("speed_cm_s", payload.get("speed"))),
        "x_mm": _optional_float(payload.get("x_mm", payload.get("x"))),
        "y_mm": _optional_float(payload.get("y_mm", payload.get("y"))),
    }
    return _target_from_fields(fields)


def _parse_csv_line(line: str) -> dict[str, float | bool | None] | None:
    if ":" in line:
        return None
    parts = [part.strip() for part in line.split(",")]
    if len(parts) not in {3, 5}:
        return None
    try:
        values = [float(part) for part in parts]
    except ValueError:
        return None

    fields = {
        "angle_deg": values[0],
        "distance_mm": values[1],
        "speed_cm_s": values[2],
        "x_mm": values[3] if len(values) == 5 else None,
        "y_mm": values[4] if len(values) == 5 else None,
    }
    return _target_from_fields(fields)


def _target_from_fields(fields: dict[str, float | None]) -> dict[str, float | bool | None] | None:
    angle_deg = _optional_float(fields.get("angle_deg"))
    distance_mm = _optional_float(fields.get("distance_mm"))
    speed_cm_s = _optional_float(fields.get("speed_cm_s"))
    x_mm = _optional_float(fields.get("x_mm"))
    y_mm = _optional_float(fields.get("y_mm"))

    if distance_mm is None and x_mm is not None and y_mm is not None:
        distance_mm = math.hypot(x_mm, y_mm)
    if angle_deg is None and x_mm is not None and y_mm is not None:
        angle_deg = -((math.atan2(y_mm, x_mm) - (math.pi / 2.0)) * (180.0 / math.pi))

    if angle_deg is None or distance_mm is None:
        return None

    if speed_cm_s is None:
        speed_cm_s = 0.0

    detected = not (
        abs(distance_mm) < 0.001
        and abs(speed_cm_s) < 0.001
        and (x_mm is None or abs(x_mm) < 0.001)
        and (y_mm is None or abs(y_mm) < 0.001)
    )

    return {
        "detected": detected,
        "angle_deg": round(angle_deg, 2),
        "distance_mm": round(distance_mm, 1),
        "distance_m": round(distance_mm / 1000.0, 3),
        "speed_cm_s": round(speed_cm_s, 2),
        "speed_m_s": round(speed_cm_s / 100.0, 3),
        "x_mm": round(x_mm, 1) if x_mm is not None else None,
        "y_mm": round(y_mm, 1) if y_mm is not None else None,
        "age_s": 0.0,
    }


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    return float(value)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
