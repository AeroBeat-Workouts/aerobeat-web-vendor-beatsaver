// @ts-check

import { beatSaverVendorServiceMarker, createAeroBeatSaverVendorService } from "../../src/index.js";

const app = document.querySelector("#app");
if (!(app instanceof HTMLElement)) throw new Error("BeatSaver vendor smoke root is missing");
const service = createAeroBeatSaverVendorService({ fetch: async () => new Response("offline smoke", { status: 503 }), maxRetries: 0 });
const snapshot = service.snapshot();
app.textContent = `BeatSaver vendor implemented · ${beatSaverVendorServiceMarker.providerId} · ${Object.values(snapshot.capabilities).filter(Boolean).length} capabilities · ${snapshot.phase}`;
app.dataset.ready = "true";
