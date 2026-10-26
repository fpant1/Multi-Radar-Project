import { drawRadar } from "./radar.js?v=20260811-combined";
import { themes } from "./themes.js?v=20260811-combined";

const AIR_FETCH_INTERVAL_MS = 5000;
const WEATHER_FETCH_INTERVAL_MS = 60000;
const ROOM_FETCH_INTERVAL_MS = 200;
const AIR_TRACK_LIMIT = 5;

const elements = {
  roomCanvas: document.querySelector("#roomRadarCanvas"),
  airCanvas: document.querySelector("#airRadarCanvas"),
  weatherMap: document.querySelector("#combinedWeatherMap"),
  roomStatus: document.querySelector("#roomStatus"),
  airStatus: document.querySelector("#airStatus"),
  weatherStatus: document.querySelector("#weatherStatus"),
  roomRangeLabel: document.querySelector("#roomRangeLabel"),
  airCountLabel: document.querySelector("#airCountLabel"),
  weatherFrameLabel: document.querySelector("#weatherFrameLabel"),
  weatherMessage: document.querySelector("#weatherMessage"),
  roomReadout: document.querySelector("#roomReadout"),
  updateLabel: document.querySelector("#updateLabel"),
  errorLabel: document.querySelector("#errorLabel"),
};

const state = {
  airData: null,
  roomData: null,
  weatherData: null,
  airError: null,
  roomError: null,
  weatherError: null,
  roomSize: { width: 1, height: 1 },
  airSize: { width: 1, height: 1 },
  weatherMapState: null,
};

const roomCtx = elements.roomCanvas.getContext("2d");
const airCtx = elements.airCanvas.getContext("2d");

init();

function init() {
  setupCanvas(elements.roomCanvas, state.roomSize, roomCtx);
  setupCanvas(elements.airCanvas, state.airSize, airCtx);
  renderRoomReadout(null);
  fetchAir();
  fetchWeather();
  fetchRoom();
  window.setInterval(fetchAir, AIR_FETCH_INTERVAL_MS);
  window.setInterval(fetchWeather, WEATHER_FETCH_INTERVAL_MS);
  window.setInterval(fetchRoom, ROOM_FETCH_INTERVAL_MS);
  window.requestAnimationFrame(drawFrame);
}

function setupCanvas(canvas, size, ctx) {
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    size.width = Math.max(1, rect.width);
    size.height = Math.max(1, rect.height);
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  new ResizeObserver(resize).observe(canvas);
  resize();
}

async function fetchAir() {
  try {
    state.airData = await fetchJson("/api/aircraft/latest");
    state.airError = null;
    renderAirStatus();
  } catch (error) {
    state.airError = messageFromError(error);
    renderAirStatus();
  }
}

async function fetchWeather() {
  try {
    state.weatherData = await fetchJson("/api/weather/rainviewer/latest");
    state.weatherError = null;
    renderWeather();
  } catch (error) {
    state.weatherError = messageFromError(error);
    renderWeather();
  }
}

async function fetchRoom() {
  try {
    state.roomData = await fetchJson("/api/room-radar/latest");
    state.roomError = null;
    renderRoomStatus();
    renderRoomReadout(state.roomData?.target || null);
  } catch (error) {
    state.roomError = messageFromError(error);
    renderRoomStatus();
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function drawFrame(now) {
  drawRoomRadar(roomCtx, state.roomSize.width, state.roomSize.height, state.roomData, now);
  drawRadar(
    airCtx,
    state.airSize.width,
    state.airSize.height,
    state.airData,
    themes.crt,
    false,
    now,
    trackedAirContacts()[0]?.id || null,
    trackedAirContacts()
  );
  elements.updateLabel.textContent = `UPDATE ${new Date().toISOString().slice(11, 19)} UTC`;
  renderErrors();
  window.requestAnimationFrame(drawFrame);
}

function renderAirStatus() {
  const status = statusClass(state.airData, state.airError);
  elements.airStatus.textContent = `AIR ${status.label}`;
  elements.airStatus.className = `status-pill ${status.className}`;
  const counts = state.airData?.counts || {};
  elements.airCountLabel.textContent = `${Math.min(AIR_TRACK_LIMIT, counts.displayed || 0)} / ${counts.raw || 0}`;
}

function renderRoomStatus() {
  const status = statusClass(state.roomData, state.roomError);
  elements.roomStatus.textContent = `ROOM ${status.label}`;
  elements.roomStatus.className = `status-pill ${status.className}`;
  elements.roomRangeLabel.textContent = `RANGE ${formatNumber(state.roomData?.range_m || 8, 1)} M`;
}

function renderWeather() {
  const status = statusClass(state.weatherData, state.weatherError);
  elements.weatherStatus.textContent = `WX ${status.label}`;
  elements.weatherStatus.className = `status-pill ${status.className}`;
  elements.weatherFrameLabel.textContent = `FRAME ${formatTime(state.weatherData?.latest_frame?.time_utc)}`;

  const message = state.weatherError || state.weatherData?.error || status.label;
  elements.weatherMessage.textContent = message;
  elements.weatherMessage.hidden = status.className === "ok" && !state.weatherError;

  if (state.weatherData?.tile?.url_template_xyz) {
    try {
      updateWeatherMap(state.weatherData);
    } catch (error) {
      state.weatherError = messageFromError(error);
      elements.weatherMessage.textContent = state.weatherError;
      elements.weatherMessage.hidden = false;
    }
  }
}

function updateWeatherMap(data) {
  if (!window.L) {
    throw new Error("Leaflet failed to load.");
  }

  const L = window.L;
  const home = [Number(data.home?.lat), Number(data.home?.lon)];
  if (!Number.isFinite(home[0]) || !Number.isFinite(home[1])) {
    throw new Error("Weather home location is invalid.");
  }

  if (!state.weatherMapState) {
    const map = L.map(elements.weatherMap, {
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

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      detectRetina: true,
      maxZoom: 19,
      pane: "weatherBasePane",
      subdomains: "abcd",
    }).addTo(map);

    const rangeCircle = L.circle(home, {
      color: "#e9fff0",
      fill: false,
      interactive: false,
      opacity: 0.8,
      radius: Math.max(1, Number(data.range_km || 50)) * 1000,
      weight: 1,
    }).addTo(map);

    const homeMarker = L.marker(home, {
      icon: L.divIcon({
        className: "weather-home-marker",
        iconAnchor: [7, 7],
        iconSize: [14, 14],
      }),
      interactive: false,
    }).addTo(map);

    state.weatherMapState = {
      map,
      homeMarker,
      rangeCircle,
      radarLayer: null,
      radarUrl: null,
    };
  }

  const mapState = state.weatherMapState;
  mapState.map.setView(home, weatherZoomForRange(Number(data.range_km || 50)), { animate: false });
  mapState.rangeCircle.setLatLng(home);
  mapState.rangeCircle.setRadius(Math.max(1, Number(data.range_km || 50)) * 1000);
  mapState.homeMarker.setLatLng(home);

  const radarUrl = radarTemplate(data);
  if (radarUrl && radarUrl !== mapState.radarUrl) {
    if (mapState.radarLayer) {
      mapState.map.removeLayer(mapState.radarLayer);
    }
    mapState.radarLayer = L.tileLayer(radarUrl, {
      attribution: '&copy; <a href="https://www.rainviewer.com/">RainViewer</a>',
      maxNativeZoom: Number(data.tile?.zoom || 7),
      maxZoom: 10,
      opacity: 0.74,
      pane: "weatherRadarPane",
      tileSize: 256,
    }).addTo(mapState.map);
    mapState.radarUrl = radarUrl;
  }

  window.requestAnimationFrame(() => mapState.map.invalidateSize(false));
}

function drawRoomRadar(ctx, width, height, data, now) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#010402";
  ctx.fillRect(0, 0, width, height);

  const originX = width * 0.5;
  const originY = height - 24;
  const radius = Math.max(40, Math.min(width * 0.46, height - 56));
  const rangeMm = Number(data?.range_mm || 8000);
  const target = data?.target;

  drawRoomGrid(ctx, originX, originY, radius, rangeMm);
  drawRoomSweep(ctx, originX, originY, radius, now);

  if (!data || data.status === "disabled") {
    drawRoomMessage(ctx, originX, originY - radius * 0.48, "ROOM SERIAL DISABLED");
  } else if (data.status === "starting") {
    drawRoomMessage(ctx, originX, originY - radius * 0.48, "WAITING FOR ARDUINO");
  } else if (data.status === "error") {
    drawRoomMessage(ctx, originX, originY - radius * 0.48, "SERIAL ERROR");
  }

  if (target?.detected) {
    drawRoomTarget(ctx, originX, originY, radius, rangeMm, target, now);
  }
}

function drawRoomGrid(ctx, originX, originY, radius, rangeMm) {
  ctx.save();
  ctx.strokeStyle = "rgba(77, 255, 139, 0.42)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#9dffba";
  ctx.font = "700 11px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let ring = 1; ring <= 4; ring += 1) {
    ctx.beginPath();
    ctx.arc(originX, originY, (radius * ring) / 4, radians(-150), radians(-30));
    ctx.stroke();
  }

  [-60, -45, -30, -15, 0, 15, 30, 45, 60].forEach((angle) => {
    const point = roomPoint(originX, originY, radius, angle);
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();

    const labelPoint = roomPoint(originX, originY, radius + 18, angle);
    ctx.fillText(`${angle}`, labelPoint.x, labelPoint.y);
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(157, 255, 186, 0.82)";
  ctx.fillText(`${formatNumber(rangeMm / 2000, 1)} m`, originX + 8, originY - radius / 2);
  ctx.fillText(`${formatNumber(rangeMm / 1000, 1)} m`, originX + 8, originY - radius + 10);
  ctx.restore();
}

function drawRoomSweep(ctx, originX, originY, radius, now) {
  const cycleMs = 2600;
  const phase = (now % cycleMs) / cycleMs;
  const sweepAngle = -60 + phase * 120;
  const point = roomPoint(originX, originY, radius, sweepAngle);

  ctx.save();
  ctx.fillStyle = "rgba(77, 255, 139, 0.08)";
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.arc(originX, originY, radius, radians(sweepAngle - 90 - 14), radians(sweepAngle - 90));
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "#4dff8b";
  ctx.shadowColor = "#4dff8b";
  ctx.shadowBlur = 12;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(originX, originY);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
  ctx.restore();
}

function drawRoomTarget(ctx, originX, originY, radius, rangeMm, target, now) {
  const distanceRatio = Math.min(1, Math.max(0, Number(target.distance_mm || 0) / rangeMm));
  const point = roomPoint(originX, originY, radius * distanceRatio, Number(target.angle_deg || 0));
  const pulse = 0.5 + Math.sin(now / 130) * 0.5;

  ctx.save();
  ctx.shadowColor = "#ff4d4d";
  ctx.shadowBlur = 14;
  ctx.fillStyle = "#ff4d4d";
  ctx.beginPath();
  ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.4 + pulse * 0.24;
  ctx.strokeStyle = "#ff4d4d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 11 + pulse * 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRoomMessage(ctx, x, y, message) {
  ctx.save();
  ctx.fillStyle = "#ffd65a";
  ctx.font = "900 14px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(message, x, y);
  ctx.restore();
}

function roomPoint(originX, originY, distancePx, angleDeg) {
  const angle = radians(angleDeg - 90);
  return {
    x: originX + Math.cos(angle) * distancePx,
    y: originY + Math.sin(angle) * distancePx,
  };
}

function renderRoomReadout(target) {
  const cells = [
    ["Angle", target ? `${formatNumber(target.angle_deg, 1)} deg` : "-- deg"],
    ["Distance", target ? `${formatNumber(target.distance_m, 2)} m` : "-- m"],
    ["Speed", target ? `${formatNumber(target.speed_cm_s, 1)} cm/s` : "-- cm/s"],
    ["Age", target ? `${formatNumber(target.age_s, 1)} s` : "-- s"],
  ];

  elements.roomReadout.replaceChildren(
    ...cells.map(([label, value]) => {
      const cell = document.createElement("div");
      cell.className = "readout-cell";

      const labelElement = document.createElement("span");
      labelElement.className = "readout-label";
      labelElement.textContent = label;

      const valueElement = document.createElement("span");
      valueElement.className = "readout-value";
      valueElement.textContent = value;

      cell.append(labelElement, valueElement);
      return cell;
    })
  );
}

function trackedAirContacts() {
  const rangeKm = Number(state.airData?.range_km || 50);
  const contacts = Array.isArray(state.airData?.contacts) ? state.airData.contacts : [];
  return contacts.filter((contact) => Number(contact.distance_km) <= rangeKm).slice(0, AIR_TRACK_LIMIT);
}

function statusClass(data, error) {
  if (error) {
    return { label: "ERROR", className: "error" };
  }
  if (!data) {
    return { label: "--", className: "starting" };
  }
  if (data.status === "ok") {
    return { label: "OK", className: "ok" };
  }
  return { label: String(data.status || "WAIT").toUpperCase(), className: String(data.status || "starting") };
}

function renderErrors() {
  const errors = [state.roomError, state.airError, state.weatherError, state.roomData?.error, state.airData?.error, state.weatherData?.error]
    .filter(Boolean)
    .slice(0, 2);
  elements.errorLabel.textContent = errors.join(" | ");
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

function weatherZoomForRange(rangeKm) {
  if (rangeKm <= 35) {
    return 9;
  }
  if (rangeKm <= 80) {
    return 8;
  }
  if (rangeKm <= 160) {
    return 7;
  }
  return 6;
}

function formatTime(value) {
  if (!value || value === "-") {
    return "--:--";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--:--" : `${date.toISOString().slice(11, 16)} UTC`;
}

function formatNumber(value, decimals) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "-";
}

function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}

function radians(value) {
  return (value * Math.PI) / 180;
}
