// @ts-check
import assert from "node:assert/strict";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { createAeroBeatSaverVendorService, inspectBeatSaverArchive, computeBeatSaverMapHash, normalizeMap } from "../src/index.js";
import { createSyntheticBeatSaverZip, createSyntheticMapPayload } from "./fixture-helpers.js";

let rows = 0;
for (const major of [2, 3, 4]) {
  for (const [difficulty, expected] of [["Easy", 10], ["Normal", 10], ["Hard", 10], ["Expert", 12], ["ExpertPlus", 16]]) {
    for (const mode of ["absent", "zero", "explicit"]) {
      const archive = fixture(major, difficulty, (entry, key) => {
        delete entry.noteJumpMovementSpeed;
        delete entry._noteJumpMovementSpeed;
        if (mode !== "absent") entry[key] = mode === "zero" ? 0 : 17.25;
      });
      const inspected = await inspectBeatSaverArchive(archive);
      const hash = await computeBeatSaverMapHash(inspected);
      const map = normalizeMap(createSyntheticMapPayload(hash));
      const service = createAeroBeatSaverVendorService({ fetch: async () => new Response(archive), maxRetries: 0 });
      for (const source of [inspected, (await service.acquireVersion(map, hash)).source, (await service.importLocalArchive(new Blob([archive]))).source]) {
        assert.equal(source.manifest.difficulties[0].noteJumpMovementSpeed, mode === "explicit" ? 17.25 : expected, `v${major} ${difficulty} ${mode}`);
      }
      rows++;
    }
  }
  for (const invalid of [-1, null, "0", "12", false, {}, []]) {
    const archive = fixture(major, "Easy", (entry, key) => { entry[key] = invalid; });
    await assert.rejects(() => inspectBeatSaverArchive(archive), { code: "provider_payload" });
  }
  // JSON exponent overflow reaches the finite-value check (JSON.stringify(Infinity) would only test null).
  for (const exponent of ["1e999", "-1e999"]) {
    const entries = unzipSync(fixture(major, "Easy", (entry, key) => { entry[key] = 123456789; }));
    entries["Info.dat"] = strToU8(strFromU8(entries["Info.dat"]).replace("123456789", exponent));
    await assert.rejects(() => inspectBeatSaverArchive(zipSync(entries)), { code: "provider_payload" });
  }
  // Preserve independent valid underscore fallback, modern priority, and negative rejection.
  for (const [modern, legacy, expected] of [["bad", 19, 19], [0, 19, 10], [15, 19, 15], [-1, 19, null]]) {
    const archive = fixture(major, "Easy", (entry) => { entry.noteJumpMovementSpeed = modern; entry._noteJumpMovementSpeed = legacy; });
    if (expected === null) await assert.rejects(() => inspectBeatSaverArchive(archive), { code: "provider_payload" });
    else assert.equal((await inspectBeatSaverArchive(archive)).manifest.difficulties[0].noteJumpMovementSpeed, expected);
  }
}
console.log(`Note jump speed defaults passed ${rows} version/difficulty/value cases through inspection, acquisition and local import; malformed/negative/alias cases retained.`);

function fixture(major, difficulty, mutate) {
  return createSyntheticBeatSaverZip(major, { mutateInfo(info) {
    if (major === 2) info._version = "2.0.0";
    const entry = major === 4 ? info.difficultyBeatmaps[0] : info._difficultyBeatmapSets[0]._difficultyBeatmaps[0];
    entry[major === 4 ? "difficulty" : "_difficulty"] = difficulty;
    mutate(entry, major === 4 ? "noteJumpMovementSpeed" : "_noteJumpMovementSpeed");
  } });
}
