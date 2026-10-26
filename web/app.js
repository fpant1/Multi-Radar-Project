import { drawRadar } from "./radar.js?v=20260624-weather-smooth";
import { applyTheme, nextThemeName, themes } from "./themes.js?v=20260624-weather-smooth";
import {
  WEATHER_FETCH_INTERVAL_MS,
  fetchWeatherLatest,
  invalidateWeatherMap,
  updateWeatherMap,
  weatherFrameTime,
  weatherStatusLabel,
  weatherUpdatedTime,
} from "./weather.js?v=20260624-weather-smooth";

const FETCH_INTERVAL_MS = 5000;
const TRACKED_CONTACT_COUNT = 5;
const TRACK_CYCLE_MS = 12000;
const MODE_AIR = "AIR";
const MODE_WEATHER = "WEATHER";

const elements = {
  screenTitle: document.querySelector("#screenTitle"),
  canvas: document.querySelector("#radarCanvas"),
  airRadarStage: document.querySelector("#airRadarStage"),
  airSidePanel: document.querySelector("#airSidePanel"),
  weatherStage: document.querySelector("#weatherStage"),
  weatherMap: document.querySelector("#weatherMap"),
  weatherMessage: document.querySelector("#weatherMessage"),
  rangeLabel: document.querySelector("#rangeLabel"),
  providerStatus: document.querySelector("#providerStatus"),
  themeToggle: document.querySelector("#themeToggle"),
  themeLabel: document.querySelector("#themeLabel"),
  filterLabel: document.querySelector("#filterLabel"),
  updateLabel: document.querySelector("#updateLabel"),
  errorLabel: document.querySelector("#errorLabel"),
  contactCount: document.querySelector("#contactCount"),
  activeContact: document.querySelector("#activeContact"),
};

const state = {
  mode: localStorage.getItem("localRadarMode") || MODE_AIR,
  data: null,
  weatherData: null,
  themeName: localStorage.getItem("localRadarTheme") || "crt",
  showLabels: localStorage.getItem("localRadarLabels") !== "off",
  lastFetchError: null,
  weatherFetchError: null,
  weatherMapError: null,
  weatherFetchInFlight: false,
  lastWeatherFetchMs: 0,
  selectedContactId: null,
  width: 1,
  height: 1,
};

const ctx = elements.canvas.getContext("2d");

function init() {
  applyThemeState();
  setupCanvasSizing();
  setupControls();
  applyModeState();
  fetchLatest();
  window.setInterval(fetchLatest, FETCH_INTERVAL_MS);
  window.setInterval(() => {
    if (state.mode === MODE_WEATHER) {
      fetchWeather(false);
    }
  }, WEATHER_FETCH_INTERVAL_MS);
  window.requestAnimationFrame(animationFrame);
}

function setupCanvasSizing() {
  const resize = () => {
    const rect = elements.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    state.width = Math.max(1, rect.width);
    state.height = Math.max(1, rect.height);
    elements.canvas.width = Math.floor(state.width * dpr);
    elements.canvas.height = Math.floor(state.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  new ResizeObserver(resize).observe(elements.canvas);
  resize();
}

function setupControls() {
  elements.themeToggle.addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "t") {
      toggleTheme();
    } else if (key === "l") {
      toggleLabels();
    } else if (key === "r") {
      resetView();
    } else if (key === "m") {
      toggleMode();
    }
  });
}

async function fetchLatest() {
  try {
    const response = await fetch("/api/aircraft/latest", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }

    state.data = await response.json();
    state.lastFetchError = null;
    renderData(state.data);
    updateActiveTracking(performance.now(), true);
  } catch (error) {
    state.lastFetchError = error instanceof Error ? error.message : String(error);
    renderStatus();
  }
}

function renderData(data) {
  if (state.mode !== MODE_AIR) {
    return;
  }

  elements.screenTitle.textContent = "AIR RADAR";
  const range = Number(data.range_km || 0);
  elements.rangeLabel.textContent = `RANGE ${formatNumber(range, 0)} KM`;
  elements.filterLabel.textContent = `FILTER: ${(data.filter?.strategy || "nearest").toUpperCase()}`;
  elements.updateLabel.textContent = `UPDATE ${formatTime(data.updated_at)}`;
  elements.errorLabel.textContent = data.error || "";

  const counts = data.counts || {};
  elements.contactCount.textContent = `0 / ${counts.raw || 0}`;
  renderStatus();
}

function renderStatus() {
  if (state.mode === MODE_WEATHER) {
    renderWeatherMode();
    return;
  }

  const status = statusLabel(state.data, state.lastFetchError);
  elements.providerStatus.textContent = status.text;
  elements.providerStatus.className = `status-pill ${status.className}`;

  if (state.lastFetchError) {
    elements.errorLabel.textContent = state.lastFetchError;
  }
}

function renderActiveContact(contact, index, total) {
  elements.activeContact.replaceChildren();

  if (!contact) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "WAITING FOR TRACK";
    elements.activeContact.append(empty);
    return;
  }

  const kicker = document.createElement("div");
  kicker.className = "active-kicker";
  kicker.append(textSpan("TRACKING ONE"), textSpan(`${index + 1} / ${total}`));

  const name = document.createElement("div");
  name.className = "active-name";
  name.textContent = contact.callsign || contact.id || "UNKNOWN";

  const subtitle = document.createElement("div");
  subtitle.className = "active-subtitle";
  subtitle.textContent = `${contact.country || "Unknown country"}  ${contact.on_ground ? "GROUND" : "AIRBORNE"}`;

  const stats = document.createElement("div");
  stats.className = "active-grid";
  stats.append(
    activeStat("Distance", `${formatNumber(contact.distance_km, 1)} km`),
    activeStat("Bearing", `${formatNullable(contact.bearing_deg, 0, "deg")}`),
    activeStat("Altitude", formatNullable(contact.altitude_m, 0, "m")),
    activeStat("Speed", formatNullable(contact.speed_kmh, 0, "km/h")),
    activeStat("Heading", formatNullable(contact.heading_deg, 0, "deg")),
    activeStat("ICAO24", contact.id || "-")
  );

  elements.activeContact.append(kicker, name, subtitle, stats);
}

function animationFrame(now) {
  if (state.mode !== MODE_AIR) {
    window.requestAnimationFrame(animationFrame);
    return;
  }

  updateActiveTracking(now);
  drawRadar(
    ctx,
    state.width,
    state.height,
    state.data,
    themes[state.themeName],
    state.showLabels,
    now,
    state.selectedContactId,
    getTrackedContacts(state.data)
  );
  window.requestAnimationFrame(animationFrame);
}

function updateActiveTracking(now, force = false) {
  const trackedContacts = getTrackedContacts(state.data);
  if (trackedContacts.length === 0) {
    if (state.selectedContactId || force) {
      state.selectedContactId = null;
      renderActiveContact(null, 0, 0);
      updateShownCount(0);
    }
    return;
  }

  const selectedIndex = Math.floor(now / TRACK_CYCLE_MS) % trackedContacts.length;
  const selectedContact = trackedContacts[selectedIndex];
  if (!force && state.selectedContactId === selectedContact.id) {
    return;
  }

  state.selectedContactId = selectedContact.id;
  renderActiveContact(selectedContact, selectedIndex, trackedContacts.length);
  updateShownCount(1);
}

function toggleTheme() {
  state.themeName = nextThemeName(state.themeName);
  localStorage.setItem("localRadarTheme", state.themeName);
  applyThemeState();
}

function toggleLabels() {
  if (state.mode !== MODE_AIR) {
    return;
  }
  state.showLabels = !state.showLabels;
  localStorage.setItem("localRadarLabels", state.showLabels ? "on" : "off");
}

function toggleMode() {
  state.mode = state.mode === MODE_AIR ? MODE_WEATHER : MODE_AIR;
  localStorage.setItem("localRadarMode", state.mode);
  applyModeState();
}

function resetView() {
  state.mode = MODE_AIR;
  state.themeName = "crt";
  state.showLabels = true;
  state.selectedContactId = null;
  localStorage.setItem("localRadarMode", state.mode);
  localStorage.setItem("localRadarTheme", state.themeName);
  localStorage.setItem("localRadarLabels", "on");
  applyThemeState();
  applyModeState();
  updateActiveTracking(performance.now(), true);
}

function applyThemeState() {
  applyTheme(state.themeName);
  const theme = themes[state.themeName];
  elements.themeToggle.textContent = theme.button;
  elements.themeLabel.textContent = theme.name;
}

function applyModeState() {
  const isWeather = state.mode === MODE_WEATHER;
  document.body.classList.toggle("mode-weather", isWeather);
  document.body.classList.toggle("mode-air", !isWeather);
  elements.airRadarStage.hidden = isWeather;
  elements.airSidePanel.hidden = isWeather;
  elements.weatherStage.hidden = !isWeather;

  if (isWeather) {
    renderWeatherMode();
    invalidateWeatherMap();
    fetchWeather(true);
  } else if (state.data) {
    renderData(state.data);
    updateActiveTracking(performance.now(), true);
  } else {
    elements.screenTitle.textContent = "AIR RADAR";
    elements.rangeLabel.textContent = "RANGE -- KM";
    renderStatus();
  }
}

async function fetchWeather(force) {
  const now = Date.now();
  if (state.weatherFetchInFlight) {
    return;
  }
  if (!force && now - state.lastWeatherFetchMs < WEATHER_FETCH_INTERVAL_MS) {
    return;
  }

  state.weatherFetchInFlight = true;
  try {
    const weatherData = await fetchWeatherLatest();
    state.weatherData = weatherData;
    state.weatherFetchError = null;
    state.lastWeatherFetchMs = now;
  } catch (error) {
    state.weatherFetchError = error instanceof Error ? error.message : String(error);
    state.lastWeatherFetchMs = now;
  } finally {
    state.weatherFetchInFlight = false;
    if (state.mode === MODE_WEATHER) {
      renderWeatherMode();
    }
  }
}

function renderWeatherMode() {
  const data = state.weatherData;

  if (data?.tile?.url_template_xyz) {
    try {
      updateWeatherMap(elements.weatherMap, data);
      state.weatherMapError = null;
    } catch (error) {
      state.weatherMapError = error instanceof Error ? error.message : String(error);
    }
  }

  const status = weatherStatusLabel(data, state.weatherFetchError, state.weatherMapError);

  elements.screenTitle.textContent = "WEATHER RADAR";
  elements.rangeLabel.textContent = `RANGE ${formatNumber(data?.range_km || state.data?.range_km || 50, 0)} KM`;
  elements.providerStatus.textContent = "RAINVIEWER";
  elements.providerStatus.className = `status-pill ${status.className}`;
  elements.filterLabel.textContent = `FRAME ${weatherFrameTime(data)}`;
  elements.updateLabel.textContent = `UPDATED ${weatherUpdatedTime(data)}`;
  elements.errorLabel.textContent = state.weatherFetchError || state.weatherMapError || data?.error || `STATUS ${status.text.replace("WEATHER ", "")}`;

  const message = state.weatherFetchError || state.weatherMapError || data?.error || status.text;
  elements.weatherMessage.textContent = message;
  elements.weatherMessage.hidden = status.className === "online" && !state.weatherMapError;
}

function statusLabel(data, fetchError) {
  if (fetchError) {
    return { text: "ERROR", className: "error" };
  }
  if (!data || data.status === "starting") {
    return { text: "STARTING", className: "stale" };
  }
  if (data.status === "stale") {
    return { text: "STALE DATA", className: "stale" };
  }
  if (data.status === "error") {
    return { text: "ERROR", className: "error" };
  }
  if ((data.counts?.displayed || 0) === 0) {
    return { text: "NO CONTACTS", className: "empty" };
  }
  return { text: "ONLINE", className: "online" };
}

function formatNumber(value, decimals) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(decimals) : "-";
}

function formatNullable(value, decimals, suffix) {
  if (value === null || value === undefined) {
    return `- ${suffix}`;
  }
  return `${formatNumber(value, decimals)} ${suffix}`;
}

function getDisplayContacts(data) {
  const rangeKm = Number(data?.range_km || 50);
  const maxDisplay = Number(data?.filter?.max_display_contacts || 30);
  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  return contacts.filter((contact) => Number(contact.distance_km) <= rangeKm).slice(0, maxDisplay);
}

function getTrackedContacts(data) {
  return getDisplayContacts(data).slice(0, TRACKED_CONTACT_COUNT);
}

function updateShownCount(displayedCount) {
  const rawCount = state.data?.counts?.raw || 0;
  const trackedCount = getTrackedContacts(state.data).length;
  elements.contactCount.textContent = `${trackedCount} / ${rawCount}`;
}

function activeStat(label, value) {
  const wrapper = document.createElement("div");
  wrapper.className = "active-stat";

  const labelElement = document.createElement("span");
  labelElement.className = "active-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("span");
  valueElement.className = "active-value";
  valueElement.textContent = value;

  wrapper.append(labelElement, valueElement);
  return wrapper;
}

function textSpan(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function formatTime(value) {
  if (!value || value === "-") {
    return "--:--:--";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }
  return date.toISOString().slice(11, 19);
}

init();
