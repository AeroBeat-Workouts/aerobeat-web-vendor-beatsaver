// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AeroBeatSaverVendorService,
  BeatSaverTransport,
  BeatSaverVendorError,
  beatSaverVendorCapabilities,
  beatSaverVendorContractId,
  beatSaverVendorProviderId,
  beatSaverVendorServiceId,
  beatSaverVendorServiceMarker,
  computeBeatSaverMapHash,
  createAeroBeatSaverVendorService,
  defaultBeatSaverArchiveLimits,
  inspectBeatSaverArchive,
  normalizeMap,
  selectVersion,
  sha1Hex
} from "../src/index.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.name, "@aerobeat/web-vendor-beatsaver");
assert.equal(packageJson.dependencies.fflate, "^0.8.2");
assert.equal(beatSaverVendorProviderId, "beatsaver");
assert.equal(beatSaverVendorServiceId, "aero.vendor.beatsaver");
assert.equal(beatSaverVendorContractId, "aero.web-vendor-beatsaver.v1");
assert.equal(beatSaverVendorServiceMarker.implementationStatus, "implemented");
assert.equal(Object.values(beatSaverVendorCapabilities).every(Boolean), true);
assert.equal(Object.isFrozen(beatSaverVendorCapabilities), true);
assert.equal(Object.isFrozen(defaultBeatSaverArchiveLimits), true);
assert.equal(typeof computeBeatSaverMapHash, "function");
assert.equal(typeof createAeroBeatSaverVendorService, "function");
assert.equal(typeof AeroBeatSaverVendorService, "function");
assert.equal(typeof BeatSaverTransport, "function");
assert.equal(typeof BeatSaverVendorError, "function");
assert.equal(typeof inspectBeatSaverArchive, "function");
assert.equal(typeof normalizeMap, "function");
assert.equal(typeof selectVersion, "function");
assert.equal(typeof sha1Hex, "function");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
for (const phrase of ["BeatSaver-specific browser concerns", "Archive Security Limits", "Provider-Neutral Source Bundle", "Do not commit downloaded BeatSaver archives"]) assert.match(readme, new RegExp(phrase, "u"));
console.log("BeatSaver vendor public contract validation passed.");
