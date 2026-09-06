// @ts-check

import assert from "node:assert/strict";
import { computeBeatSaverMapHash, createAeroBeatSaverVendorService, inspectBeatSaverArchive, normalizeMap } from "../src/index.js";
import { createSyntheticBeatSaverZip, createSyntheticMapPayload } from "./fixture-helpers.js";

const unsupportedMessage = "Beat Saber metadata version declaration is unsupported or malformed";
/** @type {string[]} */
const acceptedRows = [];
/** @type {string[]} */
const rejectedRows = [];

for (const major of /** @type {const} */ ([2, 3, 4])) {
  const expectedInfoMajor = major === 4 ? 4 : 2;
  await expectAccepted(`canonical beatmap v${major}`, createSyntheticBeatSaverZip(major), expectedInfoMajor, major);
  await expectAccepted(`versionless Info with beatmap v${major}`, createSyntheticBeatSaverZip(major, { mutateInfo: (info) => { delete info.version; delete info._version; } }), expectedInfoMajor, major);
}
await expectAccepted("Info v2 supported alias", archiveWithInfoDeclarations(2, { version: "2.9.7" }), 2, 2, "2.9.7");
await expectAccepted("Info v4 supported underscore alias", archiveWithInfoDeclarations(4, { _version: "4.0.12" }), 4, 4, "4.0.12");
await expectAccepted("Info v2 same-major dual declaration", archiveWithInfoDeclarations(2, { version: "2.0.0", _version: "2.99.1" }), 2, 2, "2.0.0");
await expectAccepted("difficulty same-major dual declaration", createSyntheticBeatSaverZip(3, { mutateDifficulty: (difficulty) => { difficulty._version = "3.9.1"; } }), 2, 3, "2.1.0", "3.3.0");
await expectAccepted("versionless v3 difficulty shape inference", createSyntheticBeatSaverZip(3, { mutateDifficulty: (difficulty) => { delete difficulty.version; } }), 2, 3, "2.1.0", null);

const invalidValues = /** @type {readonly unknown[]} */ ([
  "1.0.0", "3.0.0", "5.0.0", null, true, false, 3, {}, [], "", "   ", "garbage",
  "3", "3.", "3garbage", "3.0.0junk", "03.0.0", "+4.0.0", "2e1.0.0"
]);
for (const key of /** @type {const} */ (["version", "_version"])) {
  for (const value of invalidValues) await expectRejected(`Info ${key}=${describe(value)}`, archiveWithInfoDeclarations(4, { [key]: value }));
}
for (const declarations of [
  { version: "4.0.0", _version: "2.1.0" },
  { version: "2.1.0", _version: "4.0.0" },
  { version: "4.0.0", _version: "garbage" },
  { version: "garbage", _version: "4.0.0" }
]) await expectRejected(`Info dual ${JSON.stringify(declarations)}`, archiveWithInfoDeclarations(4, declarations));

for (const value of ["1.0.0", "5.0.0", null, true, {}, [], "3.0", "3.0.0junk"]) {
  await expectRejected(`difficulty version=${describe(value)}`, createSyntheticBeatSaverZip(3, { mutateDifficulty: (difficulty) => { difficulty.version = value; } }));
}
await expectRejected("difficulty conflicting declarations", createSyntheticBeatSaverZip(3, { mutateDifficulty: (difficulty) => { difficulty._version = "4.0.0"; } }));
await expectRejected("v2 Info cannot reference v4 difficulty", createSyntheticBeatSaverZip(2, { mutateDifficulty: (difficulty) => { difficulty._version = "4.0.0"; } }));
await expectRejected("v4 Info cannot reference v3 difficulty", createSyntheticBeatSaverZip(4, { mutateDifficulty: (difficulty) => { difficulty.version = "3.3.0"; } }));

assert.equal(acceptedRows.length, 11);
assert.equal(rejectedRows.length, 53);
console.log(`Beat Saber separate Info/difficulty version policy passed ${acceptedRows.length} accepted and ${rejectedRows.length} rejected rows through inspector, acquisition, and local import.`);

/** @param {2 | 4} shapeMajor @param {Record<string, unknown>} declarations @returns {Uint8Array} */
function archiveWithInfoDeclarations(shapeMajor, declarations) {
  return createSyntheticBeatSaverZip(shapeMajor, { mutateInfo: (info) => {
    delete info.version;
    delete info._version;
    for (const [key, value] of Object.entries(declarations)) info[key] = value;
  } });
}

/**
 * @param {string} label @param {Uint8Array} archive @param {2 | 4} expectedInfoMajor @param {2 | 3 | 4} expectedBeatmapMajor
 * @param {string | null | undefined} [expectedInfoVersion] @param {string | null | undefined} [expectedBeatmapVersion]
 */
async function expectAccepted(label, archive, expectedInfoMajor, expectedBeatmapMajor, expectedInfoVersion = undefined, expectedBeatmapVersion = undefined) {
  const inspected = await inspectBeatSaverArchive(archive);
  assert.equal(inspected.manifest.infoFormatMajor, expectedInfoMajor, `${label}: Info major`);
  assert.equal(inspected.manifest.infoFormat, `v${expectedInfoMajor}`, `${label}: Info format`);
  if (expectedInfoVersion !== undefined) assert.equal(inspected.manifest.infoVersion, expectedInfoVersion, `${label}: exact Info version`);
  assert.equal(inspected.manifest.difficulties[0]?.beatMapFormatMajor, expectedBeatmapMajor, `${label}: difficulty major`);
  assert.equal(inspected.manifest.difficulties[0]?.beatMapFormat, `v${expectedBeatmapMajor}`, `${label}: difficulty format`);
  if (expectedBeatmapVersion !== undefined) assert.equal(inspected.manifest.difficulties[0]?.beatMapVersion, expectedBeatmapVersion, `${label}: exact difficulty version`);
  const hash = await computeBeatSaverMapHash(inspected);
  const map = normalizeMap(createSyntheticMapPayload(hash, "https://cdn.example.invalid/version-policy.zip", `OK${acceptedRows.length}`));
  const service = createAeroBeatSaverVendorService({ maxRetries: 0, fetch: async () => new Response(archive, { headers: { "content-type": "application/zip", "content-length": String(archive.byteLength) } }) });
  assert.equal((await service.acquireVersion(map, hash)).source.manifest.infoFormatMajor, expectedInfoMajor, `${label}: acquisition Info major`);
  assert.equal((await service.importLocalArchive(new Blob([archive]))).source.manifest.difficulties[0]?.beatMapFormatMajor, expectedBeatmapMajor, `${label}: local difficulty major`);
  acceptedRows.push(label);
}

/** @param {string} label @param {Uint8Array} archive @returns {Promise<void>} */
async function expectRejected(label, archive) {
  const map = normalizeMap(createSyntheticMapPayload("0".repeat(40), "https://cdn.example.invalid/version-policy.zip", `BAD${rejectedRows.length}`));
  const service = createAeroBeatSaverVendorService({ maxRetries: 0, fetch: async () => new Response(archive, { headers: { "content-type": "application/zip", "content-length": String(archive.byteLength) } }) });
  for (const operation of [
    () => inspectBeatSaverArchive(archive),
    () => service.acquireVersion(map, undefined),
    () => service.importLocalArchive(new Blob([archive]))
  ]) {
    await assert.rejects(operation, (error) => {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "unsupported") return false;
      assert.ok(error.message === unsupportedMessage || error.message === "Info.dat and referenced difficulty formats are incompatible", `${label}: bounded unsupported message`);
      assert.doesNotMatch(error.message, /1\.0\.0|5\.0\.0|garbage|\[object/iu, `${label}: message must not echo declaration`);
      return true;
    }, `${label}: every public path must reject before conversion`);
  }
  rejectedRows.push(label);
}

/** @param {unknown} value @returns {string} */
function describe(value) { try { return JSON.stringify(value) ?? String(value); } catch { return String(value); } }
