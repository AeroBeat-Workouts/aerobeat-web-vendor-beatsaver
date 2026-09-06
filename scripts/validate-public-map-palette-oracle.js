// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectBeatSaverArchive } from "../src/index.js";

const fixtures = Object.freeze([
  Object.freeze({
    id: "4858",
    environment: "AEROBEAT_4858_ARCHIVE",
    defaultPath: "../aerobeat-vendor-beatsaver/.testbed/.artifacts/4858/431ffaa53a1e45ffab6c81a895e456f6aad1e038/4858-431ffaa53a1e.zip",
    archiveHash: "4273f0305518aa79ae4a7b58ccb07e86704ba50dbe679d0f0e29c52cb7b6beed",
    infoHash: "278548f453c0249a42a2c0bb3c3f5e1c726eedb63012aa931d9f90d22ef728a2",
    infoFormat: "v2",
    infoVersion: "2.0.0",
    difficulties: Object.freeze({
      Hard: Object.freeze({ hash: "46a2affb4b69c2bb0d0a5e146c33504bb154b88dfcf63fd56f3a3a1a8e79e5d4", format: "v2", version: "2.0.0", palette: null }),
      Expert: Object.freeze({ hash: "7a14673fcba05362c6a64f72a484d6057c8a67fe2bc1fc4b29198bd18b173c8e", format: "v2", version: "2.0.0", palette: null }),
      ExpertPlus: Object.freeze({ hash: "97335aff6d6dfe469776b6ef43b54798c29b03c133d32e147b90541d1ead6373", format: "v2", version: "2.0.0", palette: null })
    })
  }),
  Object.freeze({
    id: "3D44B",
    environment: "AEROBEAT_3D44B_ARCHIVE",
    defaultPath: "../aerobeat-vendor-beatsaver/.testbed/.artifacts/3d44b/2549825187cfdf7fb2352e33a614ff3ea6d3317d/3d44b-2549825187cf.zip",
    archiveHash: "21e9c5c3aafab87d61273010ba40eff584d54ed9d574d5a6c220ea66e0bb6c7b",
    infoHash: "23cab9f0e6c2711bc7549ea14c28d7a55d0aef50d46d3f4fa6e3deaaa597cdb0",
    infoFormat: "v2",
    infoVersion: "2.1.0",
    difficulties: Object.freeze({
      Hard: Object.freeze({ hash: "7dace72e6fc51a62016399937c5a54581d6208e7104a3cbf2fa8c7e15cd24812", format: "v3", version: "3.3.0", palette: Object.freeze({ left: "#FF7E14", right: "#0080FF" }) }),
      ExpertPlus: Object.freeze({ hash: "0ff189c84b8a2741493d08cd0b3349595daab75cff6a2a08daa73762d0743eec", format: "v3", version: "3.3.0", palette: Object.freeze({ left: "#FF7E14", right: "#0080FF" }) })
    })
  })
]);

for (const fixture of fixtures) {
  const path = resolve(process.env[fixture.environment] || fixture.defaultPath);
  const archive = new Uint8Array(await readFile(path));
  assert.equal(sha256(archive), fixture.archiveHash, `${fixture.id}: exact archive SHA-256`);
  const source = await inspectBeatSaverArchive(archive);
  assert.equal(source.manifest.infoFormat, fixture.infoFormat, `${fixture.id}: Info format`);
  assert.equal(source.manifest.infoVersion, fixture.infoVersion, `${fixture.id}: exact Info version`);
  assert.equal(sha256(source.readEntry(source.manifest.infoPath)), fixture.infoHash, `${fixture.id}: exact Info SHA-256`);
  assert.deepEqual(source.manifest.difficulties.map((difficulty) => difficulty.difficulty), Object.keys(fixture.difficulties), `${fixture.id}: exact canonical difficulty set`);
  for (const difficulty of source.manifest.difficulties) {
    const expected = fixture.difficulties[/** @type {keyof typeof fixture.difficulties} */ (difficulty.difficulty)];
    assert.ok(expected, `${fixture.id}/${difficulty.difficulty}: expected row`);
    assert.equal(sha256(source.readEntry(difficulty.path)), expected.hash, `${fixture.id}/${difficulty.difficulty}: exact difficulty SHA-256`);
    assert.equal(difficulty.beatMapFormat, expected.format, `${fixture.id}/${difficulty.difficulty}: beatmap format`);
    assert.equal(difficulty.beatMapVersion, expected.version, `${fixture.id}/${difficulty.difficulty}: beatmap version`);
    assert.deepEqual(difficulty.notePalette === null ? null : { left: difficulty.notePalette.left, right: difficulty.notePalette.right }, expected.palette, `${fixture.id}/${difficulty.difficulty}: strict palette oracle`);
    if (difficulty.notePalette !== null) {
      assert.equal(difficulty.notePalette.provenance.infoHash, `sha256:${fixture.infoHash}`);
      assert.equal(difficulty.notePalette.provenance.difficultyHash, `sha256:${expected.hash}`);
    }
  }
  console.log(`Cached public-map palette oracle passed ${fixture.id} from ${path}.`);
}

/** @param {Uint8Array} bytes @returns {string} */
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
