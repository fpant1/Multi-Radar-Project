export const themes = {
  crt: {
    name: "CRT GREEN",
    button: "CRT",
    background: "#020603",
    grid: "rgba(63, 255, 127, 0.34)",
    gridDim: "rgba(63, 255, 127, 0.16)",
    sweep: "rgba(79, 255, 139, 0.78)",
    sweepFade: "rgba(79, 255, 139, 0.13)",
    blip: "#eaffef",
    blipGlow: "rgba(79, 255, 139, 0.65)",
    tracked: "#ffd65a",
    trackedGlow: "rgba(255, 214, 90, 0.85)",
    ground: "#78a786",
    labelColor: "#caffd8",
    text: "#9dffba",
    warning: "#ffd65a",
  },
  modern: {
    name: "MODERN COLOUR",
    button: "MODERN",
    background: "#071018",
    grid: "rgba(100, 180, 236, 0.36)",
    gridDim: "rgba(100, 180, 236, 0.18)",
    sweep: "rgba(66, 217, 255, 0.75)",
    sweepFade: "rgba(66, 217, 255, 0.12)",
    blip: "#ffd65a",
    blipGlow: "rgba(255, 214, 90, 0.5)",
    tracked: "#ff5f7a",
    trackedGlow: "rgba(255, 95, 122, 0.85)",
    ground: "#8796a4",
    labelColor: "#ffffff",
    text: "#d9ecff",
    warning: "#ffd65a",
  },
};

export function applyTheme(themeName) {
  document.body.classList.toggle("theme-modern", themeName === "modern");
  document.body.classList.toggle("theme-crt", themeName !== "modern");
}

export function nextThemeName(themeName) {
  return themeName === "modern" ? "crt" : "modern";
}
