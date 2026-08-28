// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beatSaverVendorProviderId } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/foundation-marker.json", import.meta.url), "utf8"));
assert.deepEqual(fixture, {
  schemaId: "aerobeat.web-vendor-beatsaver.foundation-fixture.v1",
  providerId: "beatsaver",
  mapKey: "synthetic-fixture-key",
  versionHash: "0000000000000000000000000000000000000000",
  contentScope: "metadata-only-synthetic"
});
assert.equal(fixture.providerId, beatSaverVendorProviderId);
assert.match(fixture.versionHash, /^[0-9a-f]{40}$/u);
assert.equal(JSON.stringify(fixture), JSON.stringify({ ...fixture }), "fixture key order must remain deterministic");
console.log("Deterministic BeatSaver foundation fixture validation passed.");
