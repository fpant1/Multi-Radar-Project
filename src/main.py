"""Command-line entry point for the OpenSky aircraft feed prototype."""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Sequence

from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from .config import DEFAULT_POLL_INTERVAL_SECONDS, DEFAULT_RADIUS_KM, MIN_POLL_INTERVAL_SECONDS, load_settings
from .geo import (
    BoundingBox,
    bounding_box_from_radius_km,
    nautical_miles_to_kilometers,
    validate_latitude,
    validate_longitude,
    validate_radius_km,
)
from .models import Aircraft
from .opensky_client import FeedSnapshot, OpenSkyAPIError, OpenSkyAuthError, OpenSkyClient, OpenSkyRateLimitError


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch and display nearby live aircraft from OpenSky.")
    parser.add_argument("--lat", type=float, required=True, help="Center latitude in decimal degrees.")
    parser.add_argument("--lon", type=float, required=True, help="Center longitude in decimal degrees.")
    parser.add_argument(
        "--radius-km",
        type=float,
        default=None,
        help=f"Search radius in kilometers. Default: {DEFAULT_RADIUS_KM:g}.",
    )
    parser.add_argument(
        "--radius-nm",
        type=float,
        default=None,
        help="Compatibility alias for the old nautical-mile radius input.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        help=f"Polling interval in seconds. Default: {DEFAULT_POLL_INTERVAL_SECONDS}; minimum: {MIN_POLL_INTERVAL_SECONDS}.",
    )
    parser.add_argument("--once", action="store_true", help="Fetch one snapshot and exit. Useful for smoke tests.")

    args = parser.parse_args(argv)
    try:
        validate_latitude(args.lat)
        validate_longitude(args.lon)
        args.radius_km = _resolve_radius_km(args, parser)
        validate_radius_km(args.radius_km)
        if args.interval < MIN_POLL_INTERVAL_SECONDS:
            raise ValueError(f"--interval must be at least {MIN_POLL_INTERVAL_SECONDS} seconds.")
    except ValueError as exc:
        parser.error(str(exc))

    return args


def main(argv: Sequence[str] | None = None) -> int:
    console = Console()
    args = parse_args(argv)

    try:
        return run_feed(args, console)
    except KeyboardInterrupt:
        console.print("\n[bold yellow]Stopped by user.[/bold yellow]")
        return 0


def run_feed(args: argparse.Namespace, console: Console) -> int:
    settings = load_settings()
    bbox = bounding_box_from_radius_km(args.lat, args.lon, args.radius_km)

    if settings.has_partial_credentials:
        console.print(
            "[bold yellow]Warning:[/bold yellow] only one OpenSky credential env var is set. "
            "Using anonymous mode with lower rate limits."
        )
    elif not settings.has_credentials:
        console.print(
            "[bold yellow]Warning:[/bold yellow] OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are missing. "
            "Using anonymous mode with lower rate limits."
        )

    client = OpenSkyClient(
        client_id=settings.opensky_client_id if settings.has_credentials else None,
        client_secret=settings.opensky_client_secret if settings.has_credentials else None,
    )

    with Live(console=console, auto_refresh=False, screen=False) as live:
        while True:
            try:
                snapshot = client.fetch_aircraft(bbox, args.lat, args.lon)
                live.update(render_snapshot(snapshot, bbox, args), refresh=True)
            except OpenSkyAuthError as exc:
                live.update(render_error(str(exc), fatal=True), refresh=True)
                return 1
            except OpenSkyRateLimitError as exc:
                live.update(render_error(str(exc), fatal=False), refresh=True)
                if args.once:
                    return 1
            except OpenSkyAPIError as exc:
                live.update(render_error(str(exc), fatal=False), refresh=True)
                if args.once:
                    return 1

            if args.once:
                return 0
            time.sleep(args.interval)


def render_snapshot(snapshot: FeedSnapshot, bbox: BoundingBox, args: argparse.Namespace) -> Group:
    status = Text()
    status.append("Local Radar OpenSky Feed", style="bold cyan")
    status.append(
        f" | center=({args.lat:.4f}, {args.lon:.4f}) radius={args.radius_km:g}km interval={args.interval}s"
    )
    status.append(
        f"\nsource={snapshot.source_time_utc} fetched={snapshot.fetched_at_utc} "
        f"bbox=({bbox.lamin:.3f}, {bbox.lomin:.3f}) to ({bbox.lamax:.3f}, {bbox.lomax:.3f})"
    )
    if snapshot.rate_limit_remaining:
        status.append(f" credits_remaining={snapshot.rate_limit_remaining}")
    if snapshot.skipped_records:
        status.append(f" skipped_bad_rows={snapshot.skipped_records}", style="yellow")

    table = build_aircraft_table(snapshot.aircraft)
    if not snapshot.aircraft:
        empty = Panel("No aircraft with usable position data found in this area yet.", title="OpenSky")
        return Group(status, empty, table)

    return Group(status, table)


def build_aircraft_table(aircraft: list[Aircraft]) -> Table:
    table = Table(expand=True)
    for column in [
        "CALLSIGN",
        "ICAO24",
        "COUNTRY",
        "LAT",
        "LON",
        "DIST_KM",
        "BEARING",
        "ALT_M",
        "SPEED_KM_S",
        "HEADING",
        "ON_GROUND",
        "LAST_CONTACT_UTC",
    ]:
        table.add_column(column, no_wrap=True)

    for item in aircraft:
        table.add_row(
            item.callsign,
            item.icao24,
            item.origin_country,
            f"{item.latitude:.4f}",
            f"{item.longitude:.4f}",
            f"{item.distance_km:.1f}",
            f"{item.bearing:.0f}",
            _format_optional_number(item.altitude_m, decimals=0),
            _format_optional_number(item.speed_km_s, decimals=3),
            _format_optional_number(item.heading, decimals=0),
            "true" if item.on_ground else "false",
            item.last_contact_utc,
        )

    return table


def render_error(message: str, fatal: bool) -> Panel:
    title = "OpenSky feed stopped" if fatal else "OpenSky feed error"
    detail = message if fatal else f"{message}\nWill retry after the configured interval."
    return Panel(detail, title=title, border_style="red")


def _format_optional_number(value: float | None, decimals: int) -> str:
    return "-" if value is None else f"{value:.{decimals}f}"


def _resolve_radius_km(args: argparse.Namespace, parser: argparse.ArgumentParser) -> float:
    if args.radius_km is not None and args.radius_nm is not None:
        parser.error("Use either --radius-km or --radius-nm, not both.")

    if args.radius_km is not None:
        return args.radius_km
    if args.radius_nm is not None:
        return nautical_miles_to_kilometers(args.radius_nm)
    return DEFAULT_RADIUS_KM


if __name__ == "__main__":
    sys.exit(main())
