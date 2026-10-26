const DEFAULT_HOME = [51.5072, -0.1276];
const DEFAULT_RANGE_KM = 50;
const RAINVIEWER_METADATA_URL = "https://api.rainviewer.com/public/weather-maps.json";
const RAINVIEWER_HOST_FALLBACK = "https://tilecache.rainviewer.com";

const BASE_LAYERS = {
  voyager: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
  },
  voyagerNoLabels: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
  },
  positron: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
  },
  darkMatter: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    subdomains: "abcd",
    maxZoom: 19,
  },
  osm: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
  },
};

const OPTIONS = [
  {
    id: "Z1",
    title: "Current Wide",
    note: "This is the current furthest-out view: best radar fidelity and the broadest incoming-weather picture.",
    tags: ["current", "furthest out", "zoom 7"],
    base: "voyager",
    baseClass: "base-balanced",
    radarClass: "radar-soft",
    radarOpacity: 0.72,
    zoom: 7,
    smooth: 1,
  },
  {
    id: "Z2",
    title: "Area View",
    note: "One step closer, with more useful town, road, park, and river context while still seeing the wider weather shape.",
    tags: ["balanced", "closer", "zoom 8"],
    base: "voyager",
    baseClass: "base-balanced",
    radarClass: "radar-soft",
    radarOpacity: 0.72,
    zoom: 8,
    smooth: 1,
  },
  {
    id: "Z3",
    title: "Local View",
    note: "A practical local scale for a desk display: neighbourhoods become recognisable, but radar is now upscaled.",
    tags: ["local", "more detail", "zoom 9"],
    base: "voyager",
    baseClass: "base-balanced",
    radarClass: "radar-soft",
    radarOpacity: 0.72,
    zoom: 9,
    smooth: 1,
  },
  {
    id: "Z4",
    title: "Close View",
    note: "The closest option: strongest map context for a small screen, but the rain layer will be visibly enlarged.",
    tags: ["closest", "small screen", "zoom 10"],
    base: "voyager",
    baseClass: "base-balanced",
    radarClass: "radar-soft",
    radarOpacity: 0.72,
    zoom: 10,
    smooth: 1,
  },
];

const elements = {
  grid: document.querySelector("#optionGrid"),
  status: document.querySelector("#loadStatus"),
};

init();

async function init() {
  renderCards();
  const data = await loadWeatherData();
  const home = homeFromData(data);
  const rangeKm = Number(data?.range_km || DEFAULT_RANGE_KM);

  OPTIONS.forEach((option) => initMap(option, data, home, rangeKm));
  updateStatus(data);
}

function renderCards() {
  const fragment = document.createDocumentFragment();

  OPTIONS.forEach((option) => {
    const card = document.createElement("article");
    card.className = "option-card";

    const head = document.createElement("div");
    head.className = "option-head";

    const letter = document.createElement("div");
    letter.className = "option-letter";
    letter.textContent = option.id;

    const copy = document.createElement("div");
    const title = document.createElement("h2");
    title.className = "option-title";
    title.textContent = `${option.id}. ${option.title}`;

    const note = document.createElement("p");
    note.className = "option-note";
    note.textContent = option.note;

    copy.append(title, note);
    head.append(letter, copy);

    const tags = document.createElement("div");
    tags.className = "option-tags";
    option.tags.forEach((tagText) => {
      const tag = document.createElement("span");
      tag.className = "option-tag";
      tag.textContent = tagText;
      tags.append(tag);
    });

    const preview = document.createElement("div");
    preview.className = "map-preview";

    const map = document.createElement("div");
    map.id = `weatherOptionMap${option.id}`;
    map.className = "map";

    const message = document.createElement("div");
    message.id = `weatherOptionMessage${option.id}`;
    message.className = "map-message";
    message.hidden = true;

    preview.append(map, message);
    card.append(head, tags, preview);
    fragment.append(card);
  });

  elements.grid.replaceChildren(fragment);
}

async function loadWeatherData() {
  const backendData = await loadBackendWeatherData();
  const directData = await loadDirectRainViewerData(backendData);
  return directData || backendData;
}

async function loadBackendWeatherData() {
  try {
    const response = await fetch("/api/weather/rainviewer/latest", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Weather backend returned HTTP ${response.status}`);
    }
    return response.json();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      home: { lat: DEFAULT_HOME[0], lon: DEFAULT_HOME[1] },
      range_km: DEFAULT_RANGE_KM,
      status: "error",
      tile: null,
    };
  }
}

async function loadDirectRainViewerData(backendData) {
  try {
    const response = await fetch(`${RAINVIEWER_METADATA_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`RainViewer metadata returned HTTP ${response.status}`);
    }

    const metadata = await response.json();
    const frame = latestFrame(metadata);
    if (!frame?.path) {
      throw new Error("RainViewer metadata did not include a usable radar frame.");
    }

    const host = metadata.host || backendData?.host || RAINVIEWER_HOST_FALLBACK;
    const frameTime = Number(frame.time || 0);
    const home = backendData?.home || { lat: DEFAULT_HOME[0], lon: DEFAULT_HOME[1] };
    const rangeKm = Number(backendData?.range_km || DEFAULT_RANGE_KM);

    return {
      provider: "rainviewer",
      status: "ok",
      generated_at: isoFromUnix(metadata.generated),
      updated_at: new Date().toISOString(),
      latest_frame: {
        time: frameTime,
        time_utc: isoFromUnix(frameTime),
        path: frame.path,
      },
      host,
      home,
      range_km: rangeKm,
      source: "direct",
      tile: {
        size: 512,
        zoom: 7,
        color: 2,
        smooth: 1,
        snow: 1,
        options: "1_1",
        url_template_xyz: `${host}${frame.path}/512/{z}/{x}/{y}/2/1_1.png`,
      },
      error: null,
    };
  } catch (error) {
    if (backendData && backendData.status !== "error") {
      backendData.source = "backend";
      return backendData;
    }
    return null;
  }
}

function initMap(option, data, home, rangeKm) {
  const container = document.querySelector(`#weatherOptionMap${option.id}`);
  const message = document.querySelector(`#weatherOptionMessage${option.id}`);
  if (!container || !window.L) {
    return;
  }

  const L = window.L;
  const map = L.map(container, {
    attributionControl: false,
    boxZoom: false,
    doubleClickZoom: false,
    dragging: false,
    keyboard: false,
    scrollWheelZoom: false,
    tap: false,
    touchZoom: false,
    zoomControl: false,
  });

  const basePane = `basePane${option.id}`;
  const radarPane = `radarPane${option.id}`;
  map.createPane(basePane);
  map.createPane(radarPane);
  map.getPane(basePane).classList.add(option.baseClass);
  map.getPane(radarPane).classList.add(option.radarClass);
  map.getPane(basePane).style.zIndex = 200;
  map.getPane(radarPane).style.zIndex = 350;

  const base = BASE_LAYERS[option.base];
  L.tileLayer(base.url, {
    detectRetina: true,
    maxZoom: base.maxZoom,
    pane: basePane,
    subdomains: base.subdomains || "",
  }).addTo(map);

  const zoom = Math.max(6, Math.min(10, Number(option.zoom || zoomForRange(rangeKm))));
  map.setView(home, zoom, { animate: false });

  L.circle(home, {
    color: "#f2fff6",
    fill: false,
    interactive: false,
    opacity: 0.78,
    radius: Math.max(1, rangeKm) * 1000,
    weight: 1,
  }).addTo(map);

  L.marker(home, {
    icon: L.divIcon({
      className: "home-marker",
      iconAnchor: [8, 8],
      iconSize: [16, 16],
    }),
    interactive: false,
  }).addTo(map);

  const radarUrl = radarTemplate(data, option);
  if (radarUrl) {
    L.tileLayer(radarUrl, {
      maxNativeZoom: Number(data.tile?.zoom || 7),
      maxZoom: 10,
      opacity: option.radarOpacity,
      pane: radarPane,
      tileSize: 256,
    }).addTo(map);
  } else {
    message.textContent = data?.error || "RainViewer frame unavailable";
    message.hidden = false;
  }

  window.requestAnimationFrame(() => map.invalidateSize(false));
}

function radarTemplate(data, option) {
  if (!data?.host || !data?.latest_frame?.path) {
    return data?.tile?.url_template_xyz || "";
  }

  const size = Number(data.tile?.size || 512);
  const color = Number(data.tile?.color || 2);
  const snow = Number(data.tile?.snow ?? 1);
  const smooth = Number(option?.smooth ?? data.tile?.smooth ?? 1);
  return `${data.host}${data.latest_frame.path}/${size}/{z}/{x}/{y}/${color}/${smooth}_${snow}.png`;
}

function homeFromData(data) {
  const lat = Number(data?.home?.lat);
  const lon = Number(data?.home?.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return [lat, lon];
  }
  return DEFAULT_HOME;
}

function zoomForRange(rangeKm) {
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

function updateStatus(data) {
  const frameTime = data?.latest_frame?.time_utc ? new Date(data.latest_frame.time_utc) : null;
  const frameLabel = frameTime && !Number.isNaN(frameTime.getTime()) ? frameTime.toISOString().slice(11, 19) : "--:--:--";

  if (data?.tile?.url_template_xyz || data?.host) {
    const source = data.source === "backend" ? "backend cached" : "direct RainViewer";
    elements.status.textContent = `Frame loaded from ${source}: ${frameLabel} UTC. Z1 is the current widest view; Z2-Z4 step closer and upscale the native zoom 7 radar.`;
    return;
  }

  elements.status.textContent = data?.error || "Basemap options loaded without a RainViewer frame.";
}

function latestFrame(metadata) {
  const frames = Array.isArray(metadata?.radar?.past) ? metadata.radar.past : [];
  return frames
    .filter((frame) => frame && typeof frame.path === "string")
    .sort((left, right) => Number(right.time || 0) - Number(left.time || 0))[0];
}

function isoFromUnix(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }
  return new Date(timestamp * 1000).toISOString();
}
