"""FastAPI server for the Local Radar browser UI."""

from __future__ import annotations

import argparse
import sys
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .aircraft_service import AircraftService, AircraftServiceConfig, validate_interval
from .config import DEFAULT_POLL_INTERVAL_SECONDS, DEFAULT_RADIUS_KM
from .geo import validate_latitude, validate_longitude, validate_radius_km
from .room_radar_service import (
    DEFAULT_ROOM_BAUD,
    DEFAULT_ROOM_RANGE_MM,
    RoomRadarService,
    RoomRadarServiceConfig,
    validate_room_baud,
    validate_room_range_mm,
)
from .weather_service import WeatherService, WeatherServiceConfig


PROJECT_ROOT = Path(__file__).resolve().parent.parent
WEB_ROOT = PROJECT_ROOT / "web"


def create_app(
    aircraft_service: AircraftService,
    weather_service: WeatherService,
    room_radar_service: RoomRadarService,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        aircraft_service.start()
        room_radar_service.start()
        yield
        room_radar_service.stop()
        aircraft_service.stop()

    app = FastAPI(title="Local Radar", version="0.4.0", lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict:
        return {
            "status": "ok",
            "service": "local-radar",
            "modes": ["aircraft", "weather", "room-radar", "combined"],
            "weather": weather_service.health_status(),
            "room_radar": room_radar_service.health_status(),
        }

    @app.get("/api/aircraft/latest")
    def latest_aircraft() -> dict:
        return aircraft_service.latest()

    @app.get("/api/weather/rainviewer/latest")
    def latest_weather() -> dict:
        return weather_service.latest()

    @app.get("/api/room-radar/latest")
    def latest_room_radar() -> dict:
        return room_radar_service.latest()

    @app.get("/api/combined/latest")
    def latest_combined() -> dict:
        return {
            "status": "ok",
            "aircraft": aircraft_service.latest(),
            "weather": weather_service.latest(),
            "room_radar": room_radar_service.latest(),
        }

    app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="web")
    return app


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the Local Radar aircraft browser UI.")
    parser.add_argument("--lat", type=float, required=True, help="Home latitude in decimal degrees.")
    parser.add_argument("--lon", type=float, required=True, help="Home longitude in decimal degrees.")
    parser.add_argument(
        "--radius-km",
        type=float,
        default=DEFAULT_RADIUS_KM,
        help=f"Fixed radar range in kilometers. Default: {DEFAULT_RADIUS_KM:g}.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        help=f"OpenSky polling interval in seconds. Default: {DEFAULT_POLL_INTERVAL_SECONDS}.",
    )
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1.")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind. Default: 8000.")
    parser.add_argument(
        "--room-port",
        default=None,
        help="Optional Arduino room radar serial port, such as COM5 or /dev/ttyACM0.",
    )
    parser.add_argument(
        "--room-baud",
        type=int,
        default=DEFAULT_ROOM_BAUD,
        help=f"Arduino room radar serial baud rate. Default: {DEFAULT_ROOM_BAUD}.",
    )
    parser.add_argument(
        "--room-range-mm",
        type=float,
        default=DEFAULT_ROOM_RANGE_MM,
        help=f"Room radar display range in millimeters. Default: {DEFAULT_ROOM_RANGE_MM:g}.",
    )

    args = parser.parse_args(argv)
    try:
        validate_latitude(args.lat)
        validate_longitude(args.lon)
        validate_radius_km(args.radius_km)
        validate_interval(args.interval)
        validate_room_baud(args.room_baud)
        validate_room_range_mm(args.room_range_mm)
    except ValueError as exc:
        parser.error(str(exc))

    return args


def build_aircraft_service(args: argparse.Namespace) -> AircraftService:
    return AircraftService(
        AircraftServiceConfig(
            home_lat=args.lat,
            home_lon=args.lon,
            range_km=args.radius_km,
            interval_seconds=args.interval,
        )
    )


def build_weather_service(args: argparse.Namespace) -> WeatherService:
    return WeatherService(
        WeatherServiceConfig(
            home_lat=args.lat,
            home_lon=args.lon,
            range_km=args.radius_km,
        )
    )


def build_room_radar_service(args: argparse.Namespace) -> RoomRadarService:
    return RoomRadarService(
        RoomRadarServiceConfig(
            port=args.room_port,
            baud=args.room_baud,
            range_mm=args.room_range_mm,
        )
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    app = create_app(build_aircraft_service(args), build_weather_service(args), build_room_radar_service(args))
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
