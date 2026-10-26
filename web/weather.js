export const WEATHER_FETCH_INTERVAL_MS = 60000;

const BASE_TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const BASE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const RAINVIEWER_ATTRIBUTION = '&copy; <a href="https://www.rainviewer.com/">RainViewer</a>';
const DEFAULT_ZOOM = 8;
const MAX_RADAR_ZOOM = 10;

let mapState = null;

export async function fetchWeatherLatest() {
  const response = await fetch("/api/weather/rainviewer/latest", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Weather backend returned HTTP ${response.status}`);
  }
  return response.json();
}

export function weatherStatusLabel(data, fetchError, mapError) {
  if (fetchError || mapError) {
    return { text: "WEATHER ERROR", className: "error" };
  }
  if (!data || data.status === "starting") {
    return { text: "WEATHER STARTING", className: "stale" };
  }
  if (data.status === "stale") {
    return { text: "WEATHER STALE", className: "stale" };
  }
  if (data.status === "error") {
    return { text: "WEATHER ERROR", className: "error" };
  }
  if (!data.latest_frame || !data.tile?.url_template_xyz) {
    return { text: "NO RADAR FRAME", className: "empty" };
  }
  return { text: "WEATHER ONLINE", className: "online" };
}

export function updateWeatherMap(container, data) {
  if (!data?.tile?.url_template_xyz) {
    return;
  }
  if (!container) {
    throw new Error("Weather map container is missing.");
  }
  if (!window.L) {
    throw new Error("Leaflet map library failed to load.");
  }

  const L = window.L;
  const home = [Number(data.home?.lat), Number(data.home?.lon)];
  if (!Number.isFinite(home[0]) || !Number.isFinite(home[1])) {
    throw new Error("Weather map home location is invalid.");
  }

  if (!mapState) {
    mapState = createWeatherMap(L, container, home, Number(data.range_km || 50));
  }

  const targetZoom = zoomForRange(Number(data.range_km || 50));
  mapState.map.setView(home, targetZoom, { animate: false });
  updateRangeCircle(home, Number(data.range_km || 50));
  updateRadarLayer(data);
  window.requestAnimationFrame(() => mapState?.map.invalidateSize(false));
}

export function invalidateWeatherMap() {
  window.requestAnimationFrame(() => mapState?.map.invalidateSize(false));
}

export function weatherFrameTime(data) {
  return formatTime(data?.latest_frame?.time_utc);
}

export function weatherUpdatedTime(data) {
  return formatTime(data?.updated_at);
}

function createWeatherMap(L, container, home, rangeKm) {
  const map = L.map(container, {
    attributionControl: true,
    boxZoom: false,
    doubleClickZoom: false,
    dragging: false,
    keyboard: false,
    scrollWheelZoom: false,
    tap: false,
    touchZoom: false,
    zoomControl: false,
  });

  map.createPane("weatherBasePane");
  map.createPane("weatherRadarPane");
  map.getPane("weatherBasePane").classList.add("weather-base-pane");
  map.getPane("weatherRadarPane").classList.add("weather-radar-pane");

  const baseLayer = L.tileLayer(BASE_TILE_URL, {
    attribution: BASE_ATTRIBUTION,
    detectRetina: true,
    maxZoom: 19,
    pane: "weatherBasePane",
    subdomains: "abcd",
  }).addTo(map);

  const rangeCircle = L.circle(home, {
    color: cssVar("--text-strong", "#e9fff0"),
    fill: false,
    interactive: false,
    opacity: 0.82,
    radius: Math.max(1, rangeKm) * 1000,
    weight: 1,
  }).addTo(map);

  const homeMarker = L.marker(home, {
    icon: L.divIcon({
      className: "weather-home-marker",
      iconAnchor: [9, 9],
      iconSize: [18, 18],
    }),
    interactive: false,
  }).addTo(map);

  map.setView(home, zoomForRange(rangeKm), { animate: false });

  return {
    baseLayer,
    homeMarker,
    map,
    radarLayer: null,
    rangeCircle,
    radarUrl: null,
  };
}

function updateRadarLayer(data) {
  const url = radarTemplate(data);
  if (mapState.radarUrl === url) {
    return;
  }

  if (mapState.radarLayer) {
    mapState.map.removeLayer(mapState.radarLayer);
  }

  mapState.radarLayer = window.L.tileLayer(url, {
    attribution: RAINVIEWER_ATTRIBUTION,
    maxNativeZoom: Number(data.tile.zoom || 7),
    maxZoom: MAX_RADAR_ZOOM,
    opacity: 0.76,
    pane: "weatherRadarPane",
    tileSize: 256,
  }).addTo(mapState.map);
  mapState.radarUrl = url;
}

function radarTemplate(data) {
  if (!data?.host || !data?.latest_frame?.path) {
    return data?.tile?.url_template_xyz || "";
  }

  const size = Number(data.tile?.size || 512);
  const color = Number(data.tile?.color || 2);
  const snow = Number(data.tile?.snow ?? 1);
  return `${data.host}${data.latest_frame.path}/${size}/{z}/{x}/{y}/${color}/1_${snow}.png`;
}

function updateRangeCircle(home, rangeKm) {
  const radius = Math.max(1, rangeKm) * 1000;
  mapState.rangeCircle.setLatLng(home);
  mapState.rangeCircle.setRadius(radius);
  mapState.rangeCircle.setStyle({
    color: cssVar("--text-strong", "#e9fff0"),
  });
  mapState.homeMarker.setLatLng(home);
}

function zoomForRange(rangeKm) {
  if (rangeKm <= 35) {
    return 9;
  }
  if (rangeKm <= 80) {
    return DEFAULT_ZOOM;
  }
  if (rangeKm <= 160) {
    return 7;
  }
  return 6;
}

function cssVar(name, fallback) {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function formatTime(value) {
  if (!value || value === "-") {
    return "--:--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return `${date.toISOString().slice(11, 19)} UTC`;
}
