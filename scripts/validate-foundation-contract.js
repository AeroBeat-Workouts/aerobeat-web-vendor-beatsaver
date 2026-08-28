// @ts-check

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  beatSaverVendorCapabilities,
  beatSaverVendorFoundationId,
  beatSaverVendorProviderId,
  beatSaverVendorServiceId,
  beatSaverVendorServiceMarker
} from "../src/index.js";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(packageJson.name, "@aerobeat/web-vendor-beatsaver");
assert.equal(packageJson.type, "module");
assert.deepEqual(packageJson.exports, { ".": "./src/index.js" });

assert.equal(beatSaverVendorProviderId, "beatsaver");
assert.equal(beatSaverVendorServiceId, "aero.vendor.beatsaver");
assert.equal(beatSaverVendorFoundationId, "aero.web-vendor-beatsaver.foundation.v1");
assert.deepEqual(beatSaverVendorCapabilities, {
  transport: false,
  dtoNormalization: false,
  acquisition: false,
  archiveInspection: false
});
assert.equal(Object.isFrozen(beatSaverVendorCapabilities), true);
assert.equal(Object.isFrozen(beatSaverVendorServiceMarker), true);
assert.equal(beatSaverVendorServiceMarker.implementationStatus, "scaffold");

for (const path of [
  "assets/.gitkeep",
  "fixtures/foundation-marker.json",
  "docs/decisions/0001-browser-vendor-boundary.md",
  ".testbed/README.md",
  ".testbed/debug-data/.gitkeep",
  ".testbed/scenes/.gitkeep",
  ".testbed/test/setup/.gitkeep",
  ".plans/.gitkeep",
  "LICENSE.md"
]) {
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `${path} must exist`);
}

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
for (const phrase of [
  "BeatSaver-specific browser concerns",
  "not implemented yet",
  "does **not** own",
  "Do not commit downloaded BeatSaver archives"
]) {
  assert.match(readme, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
}
console.log("BeatSaver vendor foundation contract validation passed.");
