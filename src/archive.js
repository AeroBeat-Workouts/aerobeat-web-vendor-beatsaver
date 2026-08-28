// @ts-check

import { unzipSync } from "fflate";
import { BeatSaverVendorError } from "./errors.js";
import { finiteNumber, optionalArray, optionalRecord, optionalString, requireRecord } from "./normalize.js";

/** @typedef {Readonly<{maxArchiveBytes: number, maxEntries: number, maxEntryBytes: number, maxExpandedBytes: number, maxCompressionRatio: number, maxInfoBytes: number}>} BeatSaverArchiveLimits */
/** @typedef {Readonly<{path: string, basename: string, extension: string, directory: boolean, compressedBytes: number, expandedBytes: number, compressionMethod: number, infoDat: boolean, audioCandidate: boolean, coverCandidate: boolean, difficultyCandidate: boolean}>} BeatSaverArchiveEntry */
/** @typedef {Readonly<{characteristic: "Standard", difficulty: string, difficultyRank: number, path: string, noteJumpMovementSpeed: number, noteJumpStartBeatOffset: number}>} BeatSaverSourceDifficulty */
/** @typedef {Readonly<{schemaId: "aerobeat.beatsaver-source-manifest.v1", sourceFormatMajor: 2 | 3 | 4, infoPath: string, hashInputPaths: readonly string[], songName: string, songSubName: string, songAuthorName: string, levelAuthorName: string, audioPath: string, coverPath: string, bpm: number, previewStartSeconds: number, previewDurationSeconds: number, difficulties: readonly BeatSaverSourceDifficulty[], entries: readonly BeatSaverArchiveEntry[], archiveBytes: number, expandedBytes: number}>} BeatSaverSourceManifest */
/** @typedef {Readonly<{manifest: BeatSaverSourceManifest, listEntryPaths: () => readonly string[], readEntry: (path: string) => Uint8Array}>} BeatSaverSourceBundle */

/** @type {BeatSaverArchiveLimits} */
export const defaultBeatSaverArchiveLimits = Object.freeze({
  maxArchiveBytes: 128 * 1024 * 1024,
  maxEntries: 2048,
  maxEntryBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
  maxInfoBytes: 2 * 1024 * 1024
});

/**
 * Inspect untrusted BeatSaver ZIP bytes and expose provider-neutral source data.
 *
 * @param {Blob | ArrayBuffer | Uint8Array} input Archive input.
 * @param {{limits?: Partial<BeatSaverArchiveLimits>}} [options] Limits.
 * @returns {Promise<BeatSaverSourceBundle>} Safe source bundle.
 */
export async function inspectBeatSaverArchive(input, options = {}) {
  const limits = normalizeLimits(options.limits);
  const archiveBytes = await readInput(input);
  if (archiveBytes.byteLength > limits.maxArchiveBytes) failArchive("Archive exceeds byte limit", { size: archiveBytes.byteLength, maximum: limits.maxArchiveBytes });
  const centralEntries = parseCentralDirectory(archiveBytes, limits);
  /** @type {Record<string, Uint8Array>} */
  let inflated;
  try {
    inflated = unzipSync(archiveBytes);
  } catch (error) {
    throw new BeatSaverVendorError("archive", "ZIP decompression failed", { cause: error });
  }
  /** @type {Map<string, Uint8Array>} */
  const dataByPath = new Map();
  for (const entry of centralEntries) {
    if (entry.directory) continue;
    const bytes = inflated[entry.originalPath];
    if (!(bytes instanceof Uint8Array)) failArchive("ZIP entry was absent after decompression", { path: entry.path });
    if (bytes.byteLength !== entry.expandedBytes) failArchive("ZIP entry size differs from central directory", { path: entry.path });
    dataByPath.set(entry.path.toLowerCase(), bytes);
  }
  const infoEntries = centralEntries.filter((entry) => entry.infoDat && !entry.directory);
  if (infoEntries.length !== 1) failArchive("Archive must contain exactly one Info.dat", { candidates: infoEntries.length });
  const infoEntry = /** @type {InternalArchiveEntry} */ (infoEntries[0]);
  if (infoEntry.expandedBytes > limits.maxInfoBytes) failArchive("Info.dat exceeds byte limit", { size: infoEntry.expandedBytes });
  const infoBytes = dataByPath.get(infoEntry.path.toLowerCase());
  if (infoBytes === undefined) failArchive("Info.dat could not be read");
  const info = parseJson(infoBytes, "Info.dat");
  const manifest = buildSourceManifest(info, infoEntry.path, centralEntries, archiveBytes.byteLength);
  const availablePaths = Object.freeze(centralEntries.filter((entry) => !entry.directory).map((entry) => entry.path));
  return Object.freeze({
    manifest,
    listEntryPaths: () => availablePaths,
    readEntry: (path) => {
      const normalized = normalizeEntryPath(path).toLowerCase();
      const bytes = dataByPath.get(normalized);
      if (bytes === undefined) throw new BeatSaverVendorError("invalid_request", "Archive entry does not exist", { details: { path } });
      return bytes.slice();
    }
  });
}

/**
 * @param {Uint8Array} bytes Bytes.
 * @returns {Promise<string>} Lowercase SHA-1.
 */
export async function sha1Hex(bytes) {
  const copy = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-1", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute the BeatSaver/SongCore map hash: Info.dat bytes followed by every
 * referenced beatmap (and v4 lightshow) file in metadata order.
 *
 * @param {BeatSaverSourceBundle} source Safe source bundle.
 * @returns {Promise<string>} Lowercase provider map hash.
 */
export async function computeBeatSaverMapHash(source) {
  const paths = [source.manifest.infoPath, ...source.manifest.hashInputPaths];
  const parts = paths.map((path) => source.readEntry(path));
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { combined.set(part, offset); offset += part.byteLength; }
  return sha1Hex(combined);
}

/** @typedef {BeatSaverArchiveEntry & Readonly<{originalPath: string}>} InternalArchiveEntry */

/**
 * @param {Uint8Array} bytes ZIP bytes.
 * @param {BeatSaverArchiveLimits} limits Limits.
 * @returns {readonly InternalArchiveEntry[]} Entries.
 */
function parseCentralDirectory(bytes, limits) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) failArchive("Multi-disk ZIP archives are unsupported");
  if (entryCount === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff) failArchive("ZIP64 archives are unsupported");
  if (entryCount > limits.maxEntries) failArchive("Archive entry count exceeds limit", { count: entryCount, maximum: limits.maxEntries });
  if (centralOffset + centralSize > eocdOffset) failArchive("Central directory range is invalid");
  /** @type {InternalArchiveEntry[]} */
  const entries = [];
  const seen = new Set();
  let expandedTotal = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.byteLength || view.getUint32(cursor, true) !== 0x02014b50) failArchive("Central directory entry is malformed", { index });
    const madeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const expandedBytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.byteLength) failArchive("Central directory entry extends beyond archive", { index });
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) failArchive("Encrypted ZIP entries are unsupported", { index });
    if (method !== 0 && method !== 8) failArchive("ZIP compression method is unsupported", { index, method });
    if (compressedBytes === 0xffffffff || expandedBytes === 0xffffffff) failArchive("ZIP64 entries are unsupported", { index });
    const originalPath = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const path = normalizeEntryPath(originalPath);
    const directory = path.endsWith("/");
    const unixHost = (madeBy >>> 8) === 3;
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    if (unixHost && (unixMode & 0xf000) === 0xa000) failArchive("Symbolic links are unsupported", { path });
    if (!directory) {
      if (expandedBytes > limits.maxEntryBytes) failArchive("ZIP entry exceeds expanded byte limit", { path, size: expandedBytes });
      const ratio = compressedBytes === 0 ? (expandedBytes === 0 ? 1 : Number.POSITIVE_INFINITY) : expandedBytes / compressedBytes;
      if (ratio > limits.maxCompressionRatio) failArchive("ZIP entry exceeds compression-ratio limit", { path, ratio: Math.round(ratio) });
      expandedTotal += expandedBytes;
      if (expandedTotal > limits.maxExpandedBytes) failArchive("Archive exceeds total expanded byte limit", { size: expandedTotal });
    }
    const caseKey = path.toLowerCase();
    if (seen.has(caseKey)) failArchive("Archive contains duplicate normalized paths", { path });
    seen.add(caseKey);
    const basename = path.endsWith("/") ? "" : path.slice(path.lastIndexOf("/") + 1);
    const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1).toLowerCase() : "";
    entries.push(Object.freeze({
      originalPath,
      path,
      basename,
      extension,
      directory,
      compressedBytes,
      expandedBytes,
      compressionMethod: method,
      infoDat: basename.toLowerCase() === "info.dat",
      audioCandidate: ["egg", "ogg", "wav", "mp3"].includes(extension),
      coverCandidate: ["png", "jpg", "jpeg", "webp"].includes(extension),
      difficultyCandidate: ["dat", "json"].includes(extension) && basename.toLowerCase() !== "info.dat"
    }));
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) failArchive("Central directory size does not match entries");
  return Object.freeze(entries);
}

/**
 * @param {Record<string, unknown>} info Parsed Info.dat.
 * @param {string} infoPath Info path.
 * @param {readonly InternalArchiveEntry[]} entries Entries.
 * @param {number} archiveBytes Archive bytes.
 * @returns {BeatSaverSourceManifest} Manifest.
 */
function buildSourceManifest(info, infoPath, entries, archiveBytes) {
  const versionText = optionalString(info.version) || optionalString(info._version);
  const sourceFormatMajor = detectFormatMajor(versionText, info);
  const song = optionalRecord(info.song);
  const audio = optionalRecord(info.audio);
  const difficultyPayloads = collectDifficultyPayloads(info);
  /** @type {string[]} */
  const hashInputPaths = [];
  const seenHashPaths = new Set();
  for (const payload of difficultyPayloads) {
    const beatmapPath = optionalString(payload.beatmapDataFilename) || optionalString(payload.beatmapFilename) || optionalString(payload._beatmapFilename);
    const lightshowPath = optionalString(payload.lightshowDataFilename);
    for (const candidate of [beatmapPath, lightshowPath]) {
      if (!candidate) continue;
      const resolved = resolveArchivePath(candidate, entries, "hash input");
      const key = resolved.toLowerCase();
      if (!seenHashPaths.has(key)) { hashInputPaths.push(resolved); seenHashPaths.add(key); }
    }
  }
  /** @type {BeatSaverSourceDifficulty[]} */
  const difficulties = [];
  for (const payload of difficultyPayloads) {
    const characteristic = optionalString(payload.characteristic) || optionalString(payload.beatmapCharacteristicName) || optionalString(payload._beatmapCharacteristicName);
    if (characteristic !== "Standard") continue;
    const difficulty = optionalString(payload.difficulty) || optionalString(payload._difficulty);
    const path = optionalString(payload.beatmapDataFilename) || optionalString(payload.beatmapFilename) || optionalString(payload._beatmapFilename);
    if (!difficulty || !path) throw new BeatSaverVendorError("provider_payload", "Standard difficulty entry is missing difficulty or path");
    const resolvedPath = resolveArchivePath(path, entries, "difficulty");
    difficulties.push(Object.freeze({
      characteristic: "Standard",
      difficulty,
      difficultyRank: Math.trunc(finiteNumber(payload.difficultyRank ?? payload._difficultyRank)),
      path: resolvedPath,
      noteJumpMovementSpeed: finiteNumber(payload.noteJumpMovementSpeed ?? payload._noteJumpMovementSpeed),
      noteJumpStartBeatOffset: finiteNumber(payload.noteJumpStartBeatOffset ?? payload._noteJumpStartBeatOffset)
    }));
  }
  if (difficulties.length === 0) throw new BeatSaverVendorError("unsupported", "BeatSaver archive has no supported Standard difficulties");
  const audioName = optionalString(audio.songFilename) || optionalString(info.songFilename) || optionalString(info._songFilename);
  if (!audioName) throw new BeatSaverVendorError("provider_payload", "Info.dat does not reference song audio");
  const coverName = optionalString(info.coverImageFilename) || optionalString(info._coverImageFilename);
  const audioPath = resolveArchivePath(audioName, entries, "audio");
  const coverPath = coverName ? resolveArchivePath(coverName, entries, "cover") : "";
  const publicEntries = entries.map(({ originalPath: _originalPath, ...entry }) => entry);
  const expandedBytes = entries.reduce((sum, entry) => sum + (entry.directory ? 0 : entry.expandedBytes), 0);
  return Object.freeze({
    schemaId: "aerobeat.beatsaver-source-manifest.v1",
    sourceFormatMajor,
    infoPath,
    hashInputPaths: Object.freeze(hashInputPaths),
    songName: optionalString(song.title) || optionalString(info.songName) || optionalString(info._songName),
    songSubName: optionalString(song.subTitle) || optionalString(info.songSubName) || optionalString(info._songSubName),
    songAuthorName: optionalString(song.author) || optionalString(info.songAuthorName) || optionalString(info._songAuthorName),
    levelAuthorName: optionalString(info.levelAuthorName) || optionalString(info._levelAuthorName),
    audioPath,
    coverPath,
    bpm: finiteNumber(audio.bpm ?? info.beatsPerMinute ?? info._beatsPerMinute),
    previewStartSeconds: finiteNumber(audio.previewStartTime ?? info.previewStartTime ?? info._previewStartTime),
    previewDurationSeconds: finiteNumber(audio.previewDuration ?? info.previewDuration ?? info._previewDuration),
    difficulties: Object.freeze(difficulties),
    entries: Object.freeze(publicEntries),
    archiveBytes,
    expandedBytes
  });
}

/** @param {Record<string, unknown>} info @returns {readonly Record<string, unknown>[]} */
function collectDifficultyPayloads(info) {
  const direct = optionalArray(info.difficultyBeatmaps).map((entry) => requireRecord(entry, "difficultyBeatmaps[]"));
  if (direct.length > 0) return direct;
  const sets = optionalArray(info.difficultyBeatmapSets ?? info._difficultyBeatmapSets);
  /** @type {Record<string, unknown>[]} */
  const results = [];
  for (const setValue of sets) {
    const set = requireRecord(setValue, "difficultyBeatmapSets[]");
    const characteristic = optionalString(set.beatmapCharacteristicName) || optionalString(set._beatmapCharacteristicName);
    for (const difficultyValue of optionalArray(set.difficultyBeatmaps ?? set._difficultyBeatmaps)) {
      const difficulty = { ...requireRecord(difficultyValue, "difficultyBeatmaps[]") };
      if (difficulty.characteristic === undefined && difficulty.beatmapCharacteristicName === undefined && difficulty._beatmapCharacteristicName === undefined) difficulty.characteristic = characteristic;
      results.push(difficulty);
    }
  }
  return results;
}

/** @param {string} version @param {Record<string, unknown>} info @returns {2 | 3 | 4} */
function detectFormatMajor(version, info) {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (major === 2 || major === 3 || major === 4) return major;
  if (info._version !== undefined || info._difficultyBeatmapSets !== undefined) return 2;
  if (info.song !== undefined || info.audio !== undefined || info.difficultyBeatmaps !== undefined) return 4;
  if (info.version !== undefined || info.difficultyBeatmapSets !== undefined) return 3;
  throw new BeatSaverVendorError("unsupported", "Unsupported or missing Beat Saber metadata version", { details: { version } });
}

/** @param {string} requested @param {readonly InternalArchiveEntry[]} entries @param {string} role @returns {string} */
function resolveArchivePath(requested, entries, role) {
  const normalized = normalizeEntryPath(requested).toLowerCase();
  const match = entries.find((entry) => !entry.directory && entry.path.toLowerCase() === normalized);
  if (match === undefined) throw new BeatSaverVendorError("provider_payload", `Info.dat ${role} path is absent from archive`, { details: { path: requested } });
  return match.path;
}

/** @param {string} value @returns {string} */
export function normalizeEntryPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) failArchive("ZIP entry path is invalid");
  const path = value.replaceAll("\\", "/");
  if (path.startsWith("/") || /^[a-zA-Z]:\//u.test(path)) failArchive("Absolute ZIP entry paths are forbidden", { path });
  const directory = path.endsWith("/");
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 && !directory) failArchive("ZIP entry path is empty");
  if (parts.some((part) => part === "..")) failArchive("Parent ZIP entry paths are forbidden", { path });
  const normalized = parts.join("/") + (directory ? "/" : "");
  if (normalized.length > 1024) failArchive("ZIP entry path exceeds length limit");
  return normalized;
}

/** @param {DataView} view @returns {number} */
function findEndOfCentralDirectory(view) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  failArchive("ZIP end-of-central-directory record was not found");
}
/** @param {Uint8Array} bytes @returns {string} */
function decodeName(bytes) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch (error) { throw new BeatSaverVendorError("archive", "ZIP entry name is not valid UTF-8", { cause: error }); } }
/** @param {Uint8Array} bytes @param {string} context @returns {Record<string, unknown>} */
function parseJson(bytes, context) { try { return requireRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), context); } catch (error) { if (error instanceof BeatSaverVendorError) throw error; throw new BeatSaverVendorError("provider_payload", `${context} is not valid UTF-8 JSON`, { cause: error }); } }
/** @param {Blob | ArrayBuffer | Uint8Array} input @returns {Promise<Uint8Array>} */
async function readInput(input) { if (input instanceof Uint8Array) return input.slice(); if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0)); if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer()); throw new BeatSaverVendorError("invalid_request", "Archive input must be Blob, ArrayBuffer, or Uint8Array"); }
/** @param {Partial<BeatSaverArchiveLimits> | undefined} override @returns {BeatSaverArchiveLimits} */
function normalizeLimits(override) { const merged = { ...defaultBeatSaverArchiveLimits, ...(override ?? {}) }; for (const [key, value] of Object.entries(merged)) if (!Number.isFinite(value) || value <= 0) throw new BeatSaverVendorError("invalid_request", `Archive limit ${key} must be positive`); return Object.freeze(merged); }
/** @param {string} message @param {Record<string, string | number | boolean>} [details] @returns {never} */
function failArchive(message, details = {}) { throw new BeatSaverVendorError("archive", message, { details }); }
