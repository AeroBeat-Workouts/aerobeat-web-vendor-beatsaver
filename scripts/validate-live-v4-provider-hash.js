// @ts-check

import assert from "node:assert/strict";
import { createAeroBeatSaverVendorService } from "../src/index.js";

const mapId = "53F26";
const expectedHash = "addd9d6f8e7340ad6f5633947136d8475a7a99b5";
const expectedInputs = Object.freeze([
  "AudioData.dat",
  "EasyLightshow.dat",
  "Lightshow.dat",
  "ExpertPlusStandard.dat",
  "Lightshow.dat"
]);

const service = createAeroBeatSaverVendorService();
const map = await service.getMapById(mapId);
assert.ok(map.versions.some((version) => version.hash === expectedHash), `BeatSaver map ${mapId} no longer exposes expected version ${expectedHash}`);
const acquired = await service.acquireVersion(map, expectedHash);
assert.equal(acquired.version.hash, expectedHash);
assert.equal(acquired.sourceHash, expectedHash);
assert.equal(acquired.source.manifest.sourceFormatMajor, 4);
assert.deepEqual(acquired.source.manifest.hashInputPaths, expectedInputs);
console.log(`Live BeatSaver ${mapId} provider hash verified exactly: ${acquired.sourceHash}`);
