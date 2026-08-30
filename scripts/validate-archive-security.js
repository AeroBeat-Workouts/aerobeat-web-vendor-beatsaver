// @ts-check

import assert from "node:assert/strict";
import { Zip, ZipDeflate, strToU8, zipSync } from "fflate";
import { inspectBeatSaverArchive } from "../src/index.js";
import { createMixedCharacteristicBeatSaverZip, createSyntheticBeatSaverZip } from "./fixture-helpers.js";

/** @type {string[]} */
const archiveFailureCodes = [];

for (const major of /** @type {const} */ ([2, 3, 4])) {
  const source = await inspectBeatSaverArchive(createSyntheticBeatSaverZip(major));
  assert.equal(source.manifest.sourceFormatMajor, major);
  assert.equal(source.manifest.difficulties.length, 1);
  assert.equal(source.manifest.difficulties[0]?.characteristic, "Standard");
}

for (const major of /** @type {const} */ ([3, 4])) {
  await assert.rejects(() => inspectBeatSaverArchive(createMixedCharacteristicBeatSaverZip(major, { duplicateDifficulty: true })), (error) => error instanceof Error && "code" in error && error.code === "provider_payload" && /Standard difficulty ExpertPlus is duplicated/u.test(error.message), `v${major} duplicate normalized Standard identity must fail deterministically`);
  await assert.rejects(() => inspectBeatSaverArchive(createMixedCharacteristicBeatSaverZip(major, { unsupportedDifficulty: true })), (error) => error instanceof Error && "code" in error && error.code === "unsupported" && error.message === "Standard difficulty label is unsupported" && !error.message.includes("Master"), `v${major} unsupported Standard difficulty must fail without echoing provider payload`);
  const exactCharacteristic = await inspectBeatSaverArchive(createMixedCharacteristicBeatSaverZip(major, { misCasedStandard: true }));
  assert.deepEqual(exactCharacteristic.manifest.difficulties.map((entry) => entry.difficulty), ["Hard", "ExpertPlus"], `v${major} lowercase standard characteristic must remain nonplayable`);
  assert.ok(exactCharacteristic.manifest.hashInputPaths.includes("Maps/Easy.dat"), `v${major} ignored lowercase characteristic must remain in provider hash inputs`);
}

const descriptorZip = await createDescriptorZip();
assert.equal((await inspectBeatSaverArchive(descriptorZip)).manifest.songName, "Descriptor Fixture");

await expectArchiveFailure(zipSync({ "../Info.dat": strToU8("{}") }), /Parent ZIP entry paths/u);
await expectArchiveFailure(zipSync({ "/Info.dat": strToU8("{}") }), /Absolute ZIP entry paths/u);
await expectArchiveFailure(zipSync({ "Info.dat": strToU8("{}"), "info.DAT": strToU8("{}") }), /duplicate normalized paths/u);
await expectArchiveFailure(validFixture({ "Maps\\Expert.dat": strToU8("{}") }), /duplicate normalized paths/u);
await expectArchiveFailure(validFixture({ "é.dat": strToU8("a"), "e\u0301.dat": strToU8("b") }), /duplicate normalized paths/u);
await expectArchiveFailure(validFixture({ "control\u0001.dat": strToU8("x") }), /control characters/u);
await expectArchiveFailure(zipSync({ "Info.dat": strToU8("{}"), "huge.bin": new Uint8Array(200_000) }, { level: 9 }), /compression-ratio/u);
await expectArchiveFailure(createSyntheticBeatSaverZip(2), /entry count/u, { maxEntries: 2 });
await expectArchiveFailure(createSyntheticBeatSaverZip(2), /expanded byte limit/u, { maxEntryBytes: 8 });
await expectArchiveFailure(createSyntheticBeatSaverZip(2), /Archive exceeds byte limit/u, { maxArchiveBytes: 8 });
await expectArchiveFailure(createSyntheticBeatSaverZip(2), /total expanded byte limit/u, { maxExpandedBytes: 16 });

const encrypted = patchFirstCentralEntry(createSyntheticBeatSaverZip(2), (view, offset) => view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true));
await expectArchiveFailure(encrypted, /Encrypted ZIP entries/u);
const symlink = patchFirstCentralEntry(createSyntheticBeatSaverZip(2), (view, offset) => {
  view.setUint16(offset + 4, (3 << 8) | 20, true);
  view.setUint32(offset + 38, 0xa000 << 16, true);
});
await expectArchiveFailure(symlink, /Symbolic links/u);
const specialFile = patchFirstCentralEntry(createSyntheticBeatSaverZip(2), (view, offset) => {
  view.setUint16(offset + 4, (3 << 8) | 20, true);
  view.setUint32(offset + 38, 0x2000 << 16, true);
});
await expectArchiveFailure(specialFile, /Special ZIP filesystem entries/u);

const localMethodMismatch = patchEntry(createSyntheticBeatSaverZip(2), "Info.dat", ({ view, localOffset }) => {
  view.setUint16(localOffset + 8, 0, true);
});
await expectArchiveFailure(localMethodMismatch, /compression methods disagree/u);
const localFlagsMismatch = patchEntry(createSyntheticBeatSaverZip(2), "Info.dat", ({ view, localOffset }) => {
  view.setUint16(localOffset + 6, view.getUint16(localOffset + 6, true) ^ 0x0800, true);
});
await expectArchiveFailure(localFlagsMismatch, /flags disagree/u);
const localNameMismatch = patchEntry(createSyntheticBeatSaverZip(2), "Info.dat", ({ bytes, localOffset }) => {
  bytes[localOffset + 30] = "X".charCodeAt(0);
});
await expectArchiveFailure(localNameMismatch, /filenames disagree/u);
const localSizeMismatch = patchEntry(createSyntheticBeatSaverZip(2), "Info.dat", ({ view, localOffset }) => {
  view.setUint32(localOffset + 22, view.getUint32(localOffset + 22, true) + 1, true);
});
await expectArchiveFailure(localSizeMismatch, /sizes or CRC disagree/u);

const corruptDescriptor = patchEntry(descriptorZip, "Info.dat", ({ bytes, view, centralOffset, localOffset }) => {
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const compressedBytes = view.getUint32(centralOffset + 20, true);
  const descriptorOffset = localOffset + 30 + nameLength + extraLength + compressedBytes;
  const crcOffset = view.getUint32(descriptorOffset, true) === 0x08074b50 ? descriptorOffset + 4 : descriptorOffset;
  bytes[crcOffset] = (bytes[crcOffset] ?? 0) ^ 0xff;
});
await expectArchiveFailure(corruptDescriptor, /data descriptor disagrees/u);

const forgedExpandedSize = patchEntry(createSyntheticBeatSaverZip(2), "Info.dat", ({ view, centralOffset, localOffset }) => {
  const forged = view.getUint32(centralOffset + 24, true) - 1;
  view.setUint32(centralOffset + 24, forged, true);
  view.setUint32(localOffset + 22, forged, true);
});
await expectArchiveFailure(forgedExpandedSize, /DEFLATE output exceeds declared/u);

const overlappingEntries = patchEntry(validFixture(), "Info.dat", ({ view, centralOffset, localOffset }) => {
  const expanded = view.getUint32(centralOffset + 24, true) + 1;
  const compressed = view.getUint32(centralOffset + 20, true) + 1;
  view.setUint32(centralOffset + 20, compressed, true);
  view.setUint32(centralOffset + 24, expanded, true);
  view.setUint32(localOffset + 18, compressed, true);
  view.setUint32(localOffset + 22, expanded, true);
});
await expectArchiveFailure(overlappingEntries, /local entry ranges overlap/u);

const corruptCrc = patchEntry(validFixture(), "song.egg", ({ bytes, view, localOffset }) => {
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  bytes[localOffset + 30 + nameLength + extraLength] = (bytes[localOffset + 30 + nameLength + extraLength] ?? 0) ^ 0xff;
});
await expectArchiveFailure(corruptCrc, /CRC-32/u);

const zip64Entry = patchFirstCentralEntry(createSyntheticBeatSaverZip(2), (view, offset) => view.setUint32(offset + 24, 0xffffffff, true));
await expectArchiveFailure(zip64Entry, /ZIP64/u);
const multiDisk = patchEocd(createSyntheticBeatSaverZip(2), (view, offset) => view.setUint16(offset + 4, 1, true));
await expectArchiveFailure(multiDisk, /Multi-disk/u);

const defensive = await inspectBeatSaverArchive(createSyntheticBeatSaverZip(2));
const firstRead = defensive.readEntry("maps/expert.DAT");
firstRead[0] = (firstRead[0] ?? 0) ^ 0xff;
assert.notDeepEqual(firstRead, defensive.readEntry("Maps/Expert.dat"));
assert.equal(Object.hasOwn(defensive.manifest.entries[0] ?? {}, "crc32"), false);
assert.equal(Object.hasOwn(defensive.manifest.entries[0] ?? {}, "localHeaderOffset"), false);
assert.equal(archiveFailureCodes.length, 24, "every malicious archive table case must use the public inspector");
assert.deepEqual([...new Set(archiveFailureCodes)], ["archive"], "malicious archive cases must retain one stable public error code");

console.log(`BeatSaver archive security validation passed (${archiveFailureCodes.length} public-inspector cases).`);

/** @returns {Record<string, Uint8Array>} */
function baseFixtureEntries() {
  return {
    "Info.dat": strToU8(JSON.stringify({
      _version: "2.1.0",
      _songName: "Security Fixture",
      _songAuthorName: "AeroBeat",
      _levelAuthorName: "Fixture",
      _songFilename: "song.egg",
      _beatsPerMinute: 120,
      _difficultyBeatmapSets: [{ _beatmapCharacteristicName: "Standard", _difficultyBeatmaps: [{ _difficulty: "Expert", _difficultyRank: 7, _beatmapFilename: "Maps/Expert.dat" }] }]
    })),
    "song.egg": Uint8Array.of(1, 2, 3, 4),
    "Maps/Expert.dat": strToU8("{}")
  };
}

/** @param {Record<string, Uint8Array>} [extra] @returns {Uint8Array} */
function validFixture(extra = {}) { return zipSync({ ...baseFixtureEntries(), ...extra }, { level: 0 }); }

/** @returns {Promise<Uint8Array>} */
function createDescriptorZip() {
  const entries = baseFixtureEntries();
  entries["Info.dat"] = strToU8(JSON.stringify({
    _version: "2.1.0",
    _songName: "Descriptor Fixture",
    _songFilename: "song.egg",
    _beatsPerMinute: 120,
    _difficultyBeatmapSets: [{ _beatmapCharacteristicName: "Standard", _difficultyBeatmaps: [{ _difficulty: "Expert", _difficultyRank: 7, _beatmapFilename: "Maps/Expert.dat" }] }]
  }));
  return new Promise((resolve, reject) => {
    /** @type {Uint8Array[]} */
    const chunks = [];
    const zip = new Zip((error, chunk, final) => {
      if (error) { reject(error); return; }
      chunks.push(Uint8Array.from(chunk));
      if (final) resolve(concatenate(chunks));
    });
    for (const [name, bytes] of Object.entries(entries)) {
      const file = new ZipDeflate(name, { level: 6 });
      zip.add(file);
      file.push(bytes, true);
    }
    zip.end();
  });
}

/** @param {readonly Uint8Array[]} chunks @returns {Uint8Array} */
function concatenate(chunks) { const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0); const output = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }

/**
 * @param {Uint8Array} bytes Archive.
 * @param {RegExp} message Expected message.
 * @param {Partial<import("../src/archive.js").BeatSaverArchiveLimits>} [limits] Limits.
 * @returns {Promise<void>}
 */
async function expectArchiveFailure(bytes, message, limits) {
  await assert.rejects(() => inspectBeatSaverArchive(bytes, { limits }), (error) => {
    if (!(error instanceof Error) || !message.test(error.message) || !("code" in error) || error.code !== "archive") return false;
    archiveFailureCodes.push(error.code);
    return true;
  });
}

/**
 * @param {Uint8Array} bytes ZIP bytes.
 * @param {(view: DataView, offset: number) => void} patch Patch.
 * @returns {Uint8Array} Patched copy.
 */
function patchFirstCentralEntry(bytes, patch) {
  const copy = Uint8Array.from(bytes);
  const view = new DataView(copy.buffer);
  const offset = findSignature(view, 0x02014b50);
  patch(view, offset);
  return copy;
}

/**
 * @param {Uint8Array} input Archive.
 * @param {string} wantedName Entry name.
 * @param {(context: Readonly<{bytes: Uint8Array, view: DataView, centralOffset: number, localOffset: number}>) => void} patch Patch.
 * @returns {Uint8Array} Patched archive.
 */
function patchEntry(input, wantedName, patch) {
  const bytes = Uint8Array.from(input);
  const view = new DataView(bytes.buffer);
  let cursor = 0;
  while (cursor <= bytes.byteLength - 46) {
    if (view.getUint32(cursor, true) !== 0x02014b50) { cursor += 1; continue; }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name === wantedName) {
      patch(Object.freeze({ bytes, view, centralOffset: cursor, localOffset: view.getUint32(cursor + 42, true) }));
      return bytes;
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${wantedName}`);
}

/** @param {Uint8Array} input Archive. @param {(view: DataView, offset: number) => void} patch Patch. @returns {Uint8Array} */
function patchEocd(input, patch) { const bytes = Uint8Array.from(input); const view = new DataView(bytes.buffer); patch(view, findSignature(view, 0x06054b50)); return bytes; }
/** @param {DataView} view View. @param {number} signature Signature. @returns {number} Offset. */
function findSignature(view, signature) { for (let offset = 0; offset <= view.byteLength - 4; offset += 1) if (view.getUint32(offset, true) === signature) return offset; throw new Error("ZIP signature missing"); }
