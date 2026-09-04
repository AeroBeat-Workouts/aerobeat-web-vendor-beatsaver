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
  await expectAccepted(`canonical explicit v${major}`, createSyntheticBeatSaverZip(major), major);
  await expectAccepted(`versionless v${major}`, createSyntheticBeatSaverZip(major, { mutateInfo: (info) => { delete info.version; delete info._version; } }), major);
}

await expectAccepted("v2 supported version alias", archiveWithDeclarations(2, { version: "2.9.7" }), 2);
await expectAccepted("v3 supported underscore alias", archiveWithDeclarations(3, { _version: "3.12.0" }), 3);
await expectAccepted("v4 supported underscore alias", archiveWithDeclarations(4, { _version: "4.0.12" }), 4);
await expectAccepted("v2 same-major dual declaration", archiveWithDeclarations(2, { version: "2.0.0", _version: "2.99.1" }), 2);
await expectAccepted("v3 same-major dual declaration", archiveWithDeclarations(3, { version: "3.0.0", _version: "3.7.11" }), 3);
await expectAccepted("v4 same-major dual declaration", archiveWithDeclarations(4, { version: "4.2.0", _version: "4.0.9" }), 4);
await expectAccepted("supported v2 declaration on tolerant v4-shaped metadata", archiveWithDeclarations(4, { version: "2.0.0" }), 2);
await expectAccepted("supported v3 declaration on tolerant v4-shaped metadata", archiveWithDeclarations(4, { _version: "3.0.0" }), 3);

const invalidValues = /** @type {readonly unknown[]} */ ([
  "1.0.0", "5.0.0", null, true, false, 3, {}, [], "", "   ", "garbage",
  "3", "3.", "3garbage", "3.0.0junk", "03.0.0", "+4.0.0", "2e1.0.0"
]);
for (const key of /** @type {const} */ (["version", "_version"])) {
  for (const value of invalidValues) {
    await expectRejected(`v4 shape ${key}=${describe(value)}`, archiveWithDeclarations(4, { [key]: value }));
  }
  for (const shapeMajor of /** @type {const} */ ([2, 3])) {
    for (const value of ["1.0.0", "5.0.0"]) await expectRejected(`v${shapeMajor} shape ${key}=${value}`, archiveWithDeclarations(shapeMajor, { [key]: value }));
  }
}
for (const declarations of [
  { version: "4.0.0", _version: "2.1.0" },
  { version: "2.1.0", _version: "4.0.0" },
  { version: "5.0.0", _version: "2.1.0" },
  { version: "2.1.0", _version: "5.0.0" },
  { version: "4.0.0", _version: "garbage" },
  { version: "garbage", _version: "4.0.0" }
]) await expectRejected(`dual ${JSON.stringify(declarations)}`, archiveWithDeclarations(4, declarations));

await expectAccepted("own __proto__ data remains nondeclarative", createSyntheticBeatSaverZip(4, { mutateInfo: (info) => {
  delete info.version;
  Object.defineProperty(info, "__proto__", { enumerable: true, configurable: true, writable: true, value: { version: "5.0.0" } });
} }), 4);
await expectAccepted("inherited declaration omitted at JSON boundary", createSyntheticBeatSaverZip(4, { mutateInfo: (info) => {
  delete info.version;
  Object.setPrototypeOf(info, { version: "5.0.0" });
} }), 4);
await expectRejected("serialized accessor becomes invalid own declaration", createSyntheticBeatSaverZip(4, { mutateInfo: (info) => {
  Object.defineProperty(info, "version", { enumerable: true, configurable: true, get: () => "5.0.0" });
} }));

assert.equal(acceptedRows.length, 16);
assert.equal(rejectedRows.length, 51);
console.log(`Beat Saber metadata version policy passed ${acceptedRows.length} accepted and ${rejectedRows.length} rejected rows through inspector, acquisition, and local import.`);

/**
 * @param {2 | 3 | 4} shapeMajor
 * @param {Record<string, unknown>} declarations
 * @returns {Uint8Array}
 */
function archiveWithDeclarations(shapeMajor, declarations) {
  return createSyntheticBeatSaverZip(shapeMajor, { mutateInfo: (info) => {
    delete info.version;
    delete info._version;
    for (const [key, value] of Object.entries(declarations)) info[key] = value;
  } });
}

/** @param {string} label @param {Uint8Array} archive @param {2 | 3 | 4} expectedMajor @returns {Promise<void>} */
async function expectAccepted(label, archive, expectedMajor) {
  const inspected = await inspectBeatSaverArchive(archive);
  assert.equal(inspected.manifest.sourceFormatMajor, expectedMajor, `${label}: inspector major`);
  const hash = await computeBeatSaverMapHash(inspected);
  const map = normalizeMap(createSyntheticMapPayload(hash, "https://cdn.example.invalid/version-policy.zip", `OK${acceptedRows.length}`));
  const service = createAeroBeatSaverVendorService({ maxRetries: 0, fetch: async () => new Response(archive, { headers: { "content-type": "application/zip", "content-length": String(archive.byteLength) } }) });
  assert.equal((await service.acquireVersion(map, hash)).source.manifest.sourceFormatMajor, expectedMajor, `${label}: acquisition major`);
  assert.equal((await service.importLocalArchive(new Blob([archive]))).source.manifest.sourceFormatMajor, expectedMajor, `${label}: local major`);
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
      if (!(error instanceof Error) || !("code" in error) || error.code !== "unsupported" || error.message !== unsupportedMessage) return false;
      assert.doesNotMatch(error.message, /1\.0\.0|5\.0\.0|garbage|\[object/iu, `${label}: message must not echo declaration`);
      return true;
    }, `${label}: every public path must reject before shape inference`);
  }
  rejectedRows.push(label);
}

/** @param {unknown} value @returns {string} */
function describe(value) { try { return JSON.stringify(value) ?? String(value); } catch { return String(value); } }
