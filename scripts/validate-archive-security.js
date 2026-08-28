// @ts-check

import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { inspectBeatSaverArchive } from "../src/index.js";
import { createSyntheticBeatSaverZip } from "./fixture-helpers.js";

for (const major of /** @type {const} */ ([2, 3, 4])) {
  const source = await inspectBeatSaverArchive(createSyntheticBeatSaverZip(major));
  assert.equal(source.manifest.sourceFormatMajor, major);
  assert.equal(source.manifest.difficulties.length, 1);
  assert.equal(source.manifest.difficulties[0]?.characteristic, "Standard");
}

await expectArchiveFailure(zipSync({ "../Info.dat": strToU8("{}") }), /Parent ZIP entry paths/u);
await expectArchiveFailure(zipSync({ "/Info.dat": strToU8("{}") }), /Absolute ZIP entry paths/u);
await expectArchiveFailure(zipSync({ "Info.dat": strToU8("{}"), "info.DAT": strToU8("{}") }), /duplicate normalized paths/u);
await expectArchiveFailure(zipSync({ "Info.dat": strToU8("{}"), "huge.bin": new Uint8Array(200_000) }, { level: 9 }), /compression-ratio/u);
await expectArchiveFailure(createSyntheticBeatSaverZip(2), /entry count/u, { maxEntries: 2 });
await expectArchiveFailure(createSyntheticBeatSaverZip(2), /expanded byte limit/u, { maxEntryBytes: 8 });

const encrypted = patchFirstCentralEntry(createSyntheticBeatSaverZip(2), (view, offset) => view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true));
await expectArchiveFailure(encrypted, /Encrypted ZIP entries/u);
const symlink = patchFirstCentralEntry(createSyntheticBeatSaverZip(2), (view, offset) => {
  view.setUint16(offset + 4, (3 << 8) | 20, true);
  view.setUint32(offset + 38, 0xa000 << 16, true);
});
await expectArchiveFailure(symlink, /Symbolic links/u);

console.log("BeatSaver archive security validation passed.");

/**
 * @param {Uint8Array} bytes Archive.
 * @param {RegExp} message Expected message.
 * @param {Partial<import("../src/archive.js").BeatSaverArchiveLimits>} [limits] Limits.
 * @returns {Promise<void>}
 */
async function expectArchiveFailure(bytes, message, limits) {
  await assert.rejects(() => inspectBeatSaverArchive(bytes, { limits }), (error) => error instanceof Error && message.test(error.message));
}

/**
 * @param {Uint8Array} bytes ZIP bytes.
 * @param {(view: DataView, offset: number) => void} patch Patch.
 * @returns {Uint8Array} Patched copy.
 */
function patchFirstCentralEntry(bytes, patch) {
  const copy = Uint8Array.from(bytes);
  const view = new DataView(copy.buffer);
  for (let offset = 0; offset <= copy.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      patch(view, offset);
      return copy;
    }
  }
  throw new Error("Synthetic ZIP central directory missing");
}
