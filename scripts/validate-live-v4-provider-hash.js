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
assert.equal(acquired.source.manifest.infoFormatMajor, 4);
assert.equal(acquired.source.manifest.infoFormat, "v4");
assert.equal(acquired.source.manifest.infoVersion, "4.0.1");
assert.deepEqual(acquired.source.manifest.hashInputPaths, expectedInputs);
const difficulty = acquired.source.manifest.difficulties[0];
assert.ok(difficulty);
assert.equal(difficulty.beatMapFormat, "v4");
assert.equal(difficulty.beatMapVersion, "4.1.0");
assert.deepEqual(difficulty.notePalette && { left: difficulty.notePalette.left, right: difficulty.notePalette.right }, { left: "#FFFFFF", right: "#494949" });
assert.equal(difficulty.notePalette?.provenance.infoHash, "sha256:26f9b85fe63b5d7e2c2878ba6f56379cf3f5e6dd30591288f925354ece569469");
assert.equal(difficulty.notePalette?.provenance.difficultyHash, "sha256:5db4e508ac9fa238e1127b0ff1f08338a037ffa7e5e9f57671878b048c2ff10f");
console.log(`Live BeatSaver ${mapId} provider hash and palette verified exactly: ${acquired.sourceHash}`);
