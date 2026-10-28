// @ts-check

// 0.0.149 (Derrick): a song imported from a local ZIP must be re-importable without the
// archive and without storing it twice. Import already caches Info.dat, every Standard
// difficulty and the audio, so the source interface is rebuilt from those bytes and must
// reproduce the identical provider version hash, Info/difficulty paths and note palettes —
// otherwise Reimport would replace a song with a source it never came from.
import assert from "node:assert/strict";
import { computeBeatSaverMapHash, inspectBeatSaverArchive, rebuildSourceFromEntries } from "../src/index.js";
import { createSyntheticBeatSaverZip } from "./fixture-helpers.js";

for (const major of /** @type {const} */ ([2, 3, 4])) {
  const archive = await inspectBeatSaverArchive(createSyntheticBeatSaverZip(major));
  // Exactly what an import caches: Info.dat, every Standard difficulty, any other source-hash
  // input that fits the cache entry bound, and the audio kept as a shared asset.
  const difficultyPaths = archive.manifest.difficulties.map((entry) => entry.path);
  const cachedPaths = [...new Set([
    archive.manifest.infoPath,
    ...difficultyPaths,
    ...archive.manifest.hashInputPaths.filter((path) => !difficultyPaths.includes(path) && archive.readEntry(path).byteLength <= 2 * 1024 * 1024),
    archive.manifest.audioPath
  ])];
  const cached = cachedPaths.map((path) => ({ path, bytes: archive.readEntry(path) }));
  const rebuilt = await rebuildSourceFromEntries(cached);
  assert.equal(await computeBeatSaverMapHash(rebuilt), await computeBeatSaverMapHash(archive), `v${major}: rebuilt source must keep the identical provider version hash`);
  for (const field of ["infoFormatMajor", "infoFormat", "infoVersion", "infoPath", "audioPath", "songName", "songAuthorName", "levelAuthorName", "bpm", "hashInputPaths"]) {
    assert.deepEqual(rebuilt.manifest[field], archive.manifest[field], `v${major}: rebuilt manifest ${field} must match the archive`);
  }
  assert.deepEqual(
    rebuilt.manifest.difficulties.map((entry) => [entry.difficulty, entry.path, entry.beatMapFormat, entry.beatMapFormatMajor, entry.beatMapVersion, entry.noteJumpMovementSpeed, entry.noteJumpStartBeatOffset]),
    archive.manifest.difficulties.map((entry) => [entry.difficulty, entry.path, entry.beatMapFormat, entry.beatMapFormatMajor, entry.beatMapVersion, entry.noteJumpMovementSpeed, entry.noteJumpStartBeatOffset]),
    `v${major}: rebuilt difficulties must keep identity, paths, formats and spawn timing`
  );
  assert.deepEqual(rebuilt.manifest.difficulties.map((entry) => entry.notePalette), archive.manifest.difficulties.map((entry) => entry.notePalette), `v${major}: rebuilt note palettes must match`);
  // The cover image is not a conversion input and is never cached, so it resolves to empty
  // instead of failing the rebuild.
  assert.equal(rebuilt.manifest.coverPath, "", `v${major}: a cached source has no cover`);
  assert.equal(rebuilt.manifest.entries.length, cached.length, `v${major}: every cached entry must be advertised`);
  for (const entry of cached) assert.deepEqual(rebuilt.readEntry(entry.path), entry.bytes, `v${major}: rebuilt ${entry.path} must return the cached bytes`);
}

// The rebuilt interface must refuse ambiguous or unusable cached sources rather than guess.
const empty = /** @type {readonly Readonly<{path: string, bytes: Uint8Array}>[]} */ ([]);
await assert.rejects(() => rebuildSourceFromEntries(empty), (error) => error?.code === "invalid_request");
const vendor = await inspectBeatSaverArchive(createSyntheticBeatSaverZip(2));
const infoPath = vendor.manifest.infoPath;
const difficultyPath = vendor.manifest.difficulties[0].path;
const audioPath = vendor.manifest.audioPath;
const bytesOf = (path) => vendor.readEntry(path);
await assert.rejects(() => rebuildSourceFromEntries([{ path: difficultyPath, bytes: bytesOf(difficultyPath) }, { path: audioPath, bytes: bytesOf(audioPath) }]), (error) => error?.code === "unsupported", "a cached source without Info.dat must fail");
await assert.rejects(() => rebuildSourceFromEntries([{ path: infoPath, bytes: bytesOf(infoPath) }, { path: "other/Info.dat", bytes: bytesOf(infoPath) }]), (error) => error?.code === "unsupported", "two Info.dat entries must fail");
await assert.rejects(() => rebuildSourceFromEntries([{ path: infoPath, bytes: bytesOf(infoPath) }, { path: infoPath.toUpperCase(), bytes: bytesOf(infoPath) }]), (error) => error?.code === "invalid_request", "case-colliding cached paths must fail");
await assert.rejects(() => rebuildSourceFromEntries([{ path: "../Info.dat", bytes: bytesOf(infoPath) }]), (error) => /parent|forbidden/iu.test(String(error?.message ?? "")), "parent paths must fail");
await assert.rejects(() => rebuildSourceFromEntries([{ path: infoPath, bytes: bytesOf(infoPath) }, { path: difficultyPath, bytes: new Uint8Array() }, { path: audioPath, bytes: bytesOf(audioPath) }]), (error) => error?.code === "invalid_request", "an empty cached entry must fail");
const missingAudio = await rebuildSourceFromEntries([{ path: infoPath, bytes: bytesOf(infoPath) }, { path: difficultyPath, bytes: bytesOf(difficultyPath) }]).catch((error) => error);
assert.ok(missingAudio instanceof Error, "a cached source without audio cannot rebuild");
console.log("Cached-source rebuild keeps the exact provider identity for Beat Saber v2/v3/v4 Info families.");