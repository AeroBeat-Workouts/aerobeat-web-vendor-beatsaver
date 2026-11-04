// @ts-check
import assert from "node:assert/strict";
import { createAeroBeatSaverVendorService } from "../src/index.js";

const mapId = "2fa8c";
const expectedHash = "fb09ccd3edeb747ee3735a01824234d5c31fb9a1";
const service = createAeroBeatSaverVendorService();
const map = await service.getMapById(mapId);
assert.match(map.mapName, /Sonic Heroes \(Opening Ver\.\)/);
const acquired = await service.acquireVersion(map, expectedHash);
assert.equal(acquired.sourceHash, expectedHash);
const manifest = acquired.source.manifest;
assert.equal(manifest.infoVersion, "2.0.0");
assert.deepEqual(manifest.difficulties.map(d => [d.difficulty, d.noteJumpMovementSpeed]), [["Easy", 10], ["Expert", 16], ["ExpertPlus", 18]]);
const rawInfo = JSON.parse(new TextDecoder().decode(await acquired.source.readEntry(manifest.infoPath)));
assert.equal(rawInfo._difficultyBeatmapSets[0]._difficultyBeatmaps[0]._noteJumpMovementSpeed, 0, "Real named archive must exercise explicit zero, not a rewritten fixture");
console.log(`Real BeatSaver Sonic Heroes ${mapId}/${acquired.sourceHash} acquired: Easy auto=10, explicit Expert=16 and ExpertPlus=18 unchanged.`);
