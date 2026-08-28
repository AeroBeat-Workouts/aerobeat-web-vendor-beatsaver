// @ts-check

import { beatSaverVendorServiceMarker } from "../../src/index.js";

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) {
  throw new Error("BeatSaver vendor smoke root is missing");
}

app.textContent = `BeatSaver vendor foundation ready · ${beatSaverVendorServiceMarker.providerId} · acquisition not implemented`;
app.dataset.ready = "true";
