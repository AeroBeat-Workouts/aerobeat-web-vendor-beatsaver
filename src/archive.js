// @ts-check

import { Inflate } from "fflate";
import { BeatSaverVendorError } from "./errors.js";
import { finiteNumber, optionalArray, optionalRecord, optionalString, requireRecord } from "./normalize.js";

/** @typedef {Readonly<{maxArchiveBytes: number, maxEntries: number, maxEntryBytes: number, maxExpandedBytes: number, maxCompressionRatio: number, maxInfoBytes: number}>} BeatSaverArchiveLimits */
/** @typedef {Readonly<{path: string, basename: string, extension: string, directory: boolean, compressedBytes: number, expandedBytes: number, compressionMethod: number, infoDat: boolean, audioCandidate: boolean, coverCandidate: boolean, difficultyCandidate: boolean}>} BeatSaverArchiveEntry */
/** @typedef {Readonly<{characteristic: "Standard", difficulty: string, difficultyRank: number, path: string, noteJumpMovementSpeed: number, noteJumpStartBeatOffset: number}>} BeatSaverSourceDifficulty */
/** @typedef {Readonly<{schemaId: "aerobeat.beatsaver-source-manifest.v1", sourceFormatMajor: 2 | 3 | 4, infoPath: string, hashInputPaths: readonly string[], songName: string, songSubName: string, songAuthorName: string, levelAuthorName: string, audioPath: string, coverPath: string, bpm: number, previewStartSeconds: number, previewDurationSeconds: number, difficulties: readonly BeatSaverSourceDifficulty[], entries: readonly BeatSaverArchiveEntry[], archiveBytes: number, expandedBytes: number}>} BeatSaverSourceManifest */
// `hashInputPaths` is an ordered provider-hash sequence, not a set. Duplicate
// entries are significant for v4 maps that share one lightshow across difficulties.
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

/** Canonical playable order for exact Standard characteristic entries. */
const standardDifficultyOrder = Object.freeze(["Easy", "Normal", "Hard", "Expert", "ExpertPlus"]);
const standardDifficultyByToken = Object.freeze({ easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert", expertplus: "ExpertPlus" });

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
  /** @type {Map<string, Uint8Array>} */
  const dataByPath = new Map();
  let actualExpandedTotal = 0;
  for (const entry of centralEntries) {
    if (entry.directory) continue;
    const bytes = inflateArchiveEntry(archiveBytes, entry, limits);
    actualExpandedTotal += bytes.byteLength;
    if (actualExpandedTotal > limits.maxExpandedBytes) failArchive("Archive exceeds actual expanded byte limit", { size: actualExpandedTotal });
    if (crc32(bytes) !== entry.crc32) failArchive("ZIP entry CRC-32 does not match central directory", { path: entry.path });
    dataByPath.set(pathKey(entry.path), bytes);
  }
  const infoEntries = centralEntries.filter((entry) => entry.infoDat && !entry.directory);
  if (infoEntries.length !== 1) failArchive("Archive must contain exactly one Info.dat", { candidates: infoEntries.length });
  const infoEntry = /** @type {InternalArchiveEntry} */ (infoEntries[0]);
  if (infoEntry.expandedBytes > limits.maxInfoBytes) failArchive("Info.dat exceeds byte limit", { size: infoEntry.expandedBytes });
  const infoBytes = dataByPath.get(pathKey(infoEntry.path));
  if (infoBytes === undefined) failArchive("Info.dat could not be read");
  const info = parseJson(infoBytes, "Info.dat");
  const manifest = buildSourceManifest(info, infoEntry.path, centralEntries, archiveBytes.byteLength);
  const availablePaths = Object.freeze(centralEntries.filter((entry) => !entry.directory).map((entry) => entry.path));
  return Object.freeze({
    manifest,
    listEntryPaths: () => availablePaths,
    readEntry: (path) => {
      const normalized = pathKey(normalizeEntryPath(path));
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
 * Compute the BeatSaver/SongCore map hash. The stream starts with the raw
 * downloaded Info.dat bytes. For v4 it then contains audioDataFilename bytes,
 * followed by each difficulty's beatmap and lightshow bytes in metadata order,
 * including repeated shared references. Legacy v2/v3 sequencing is unchanged.
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

/** @typedef {BeatSaverArchiveEntry & Readonly<{originalPath: string, flags: number, crc32: number, localHeaderOffset: number, dataOffset: number, dataEnd: number, recordEnd: number}>} InternalArchiveEntry */

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
    const crc = view.getUint32(cursor + 16, true);
    const compressedBytes = view.getUint32(cursor + 20, true);
    const expandedBytes = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.byteLength) failArchive("Central directory entry extends beyond archive", { index });
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) failArchive("Encrypted ZIP entries are unsupported", { index });
    if (method !== 0 && method !== 8) failArchive("ZIP compression method is unsupported", { index, method });
    if (diskStart !== 0) failArchive("Multi-disk ZIP entries are unsupported", { index });
    if (compressedBytes === 0xffffffff || expandedBytes === 0xffffffff || localHeaderOffset === 0xffffffff) failArchive("ZIP64 entries are unsupported", { index });
    validateExtraFields(bytes.subarray(cursor + 46 + nameLength, cursor + 46 + nameLength + extraLength), index);
    const originalPath = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const path = normalizeEntryPath(originalPath);
    const directory = path.endsWith("/");
    const unixHost = (madeBy >>> 8) === 3;
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    const unixType = unixMode & 0xf000;
    if (unixHost && unixType === 0xa000) failArchive("Symbolic links are unsupported", { path });
    if (unixHost && unixType !== 0 && unixType !== 0x4000 && unixType !== 0x8000) failArchive("Special ZIP filesystem entries are unsupported", { path });
    if (unixHost && ((directory && unixType === 0x8000) || (!directory && unixType === 0x4000))) failArchive("ZIP directory mode disagrees with its path", { path });
    if (!directory && (externalAttributes & 0x10) !== 0) failArchive("ZIP directory attributes disagree with its path", { path });
    if (!directory) {
      if (expandedBytes > limits.maxEntryBytes) failArchive("ZIP entry exceeds expanded byte limit", { path, size: expandedBytes });
      const ratio = compressedBytes === 0 ? (expandedBytes === 0 ? 1 : Number.POSITIVE_INFINITY) : expandedBytes / compressedBytes;
      if (ratio > limits.maxCompressionRatio) failArchive("ZIP entry exceeds compression-ratio limit", { path, ratio: Math.round(ratio) });
      expandedTotal += expandedBytes;
      if (expandedTotal > limits.maxExpandedBytes) failArchive("Archive exceeds total expanded byte limit", { size: expandedTotal });
    }
    const caseKey = pathKey(path);
    if (seen.has(caseKey)) failArchive("Archive contains duplicate normalized paths", { path });
    seen.add(caseKey);
    const basename = path.endsWith("/") ? "" : path.slice(path.lastIndexOf("/") + 1);
    const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1).toLowerCase() : "";
    const local = validateLocalEntry(bytes, centralOffset, index, {
      originalPath,
      flags,
      method,
      crc,
      compressedBytes,
      expandedBytes,
      localHeaderOffset
    });
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
      difficultyCandidate: ["dat", "json"].includes(extension) && basename.toLowerCase() !== "info.dat",
      flags,
      crc32: crc,
      localHeaderOffset,
      dataOffset: local.dataOffset,
      dataEnd: local.dataEnd,
      recordEnd: local.recordEnd
    }));
    cursor = end;
  }
  if (cursor !== centralOffset + centralSize) failArchive("Central directory size does not match entries");
  const ranges = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  for (let index = 1; index < ranges.length; index += 1) {
    if ((ranges[index - 1]?.recordEnd ?? 0) > (ranges[index]?.localHeaderOffset ?? 0)) failArchive("ZIP local entry ranges overlap");
  }
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
  if (sourceFormatMajor === 4) {
    const audioDataPath = optionalString(audio.audioDataFilename);
    if (!audioDataPath) throw new BeatSaverVendorError("provider_payload", "v4 Info.dat does not reference audio data");
    hashInputPaths.push(resolveArchivePath(audioDataPath, entries, "audio data hash input"));
    for (const payload of difficultyPayloads) {
      const beatmapPath = optionalString(payload.beatmapDataFilename);
      const lightshowPath = optionalString(payload.lightshowDataFilename);
      for (const candidate of [beatmapPath, lightshowPath]) {
        if (candidate) hashInputPaths.push(resolveArchivePath(candidate, entries, "hash input"));
      }
    }
  } else {
    const seenHashPaths = new Set();
    for (const payload of difficultyPayloads) {
      const beatmapPath = optionalString(payload.beatmapDataFilename) || optionalString(payload.beatmapFilename) || optionalString(payload._beatmapFilename);
      const lightshowPath = optionalString(payload.lightshowDataFilename);
      for (const candidate of [beatmapPath, lightshowPath]) {
        if (!candidate) continue;
        const resolved = resolveArchivePath(candidate, entries, "hash input");
        const key = pathKey(resolved);
        if (!seenHashPaths.has(key)) { hashInputPaths.push(resolved); seenHashPaths.add(key); }
      }
    }
  }
  /** @type {BeatSaverSourceDifficulty[]} */
  const difficulties = [];
  const seenStandardDifficulties = new Set();
  for (const payload of difficultyPayloads) {
    const characteristic = optionalString(payload.characteristic) || optionalString(payload.beatmapCharacteristicName) || optionalString(payload._beatmapCharacteristicName);
    if (characteristic !== "Standard") continue;
    const difficultyValue = optionalString(payload.difficulty) || optionalString(payload._difficulty);
    const path = optionalString(payload.beatmapDataFilename) || optionalString(payload.beatmapFilename) || optionalString(payload._beatmapFilename);
    if (!difficultyValue || !path) throw new BeatSaverVendorError("provider_payload", "Standard difficulty entry is missing difficulty or path");
    const difficulty = canonicalStandardDifficulty(difficultyValue);
    if (seenStandardDifficulties.has(difficulty)) throw new BeatSaverVendorError("provider_payload", `Standard difficulty ${difficulty} is duplicated`);
    seenStandardDifficulties.add(difficulty);
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
  difficulties.sort((left, right) => standardDifficultyOrder.indexOf(left.difficulty) - standardDifficultyOrder.indexOf(right.difficulty));
  const audioName = optionalString(audio.songFilename) || optionalString(info.songFilename) || optionalString(info._songFilename);
  if (!audioName) throw new BeatSaverVendorError("provider_payload", "Info.dat does not reference song audio");
  const coverName = optionalString(info.coverImageFilename) || optionalString(info._coverImageFilename);
  const audioPath = resolveArchivePath(audioName, entries, "audio");
  const coverPath = coverName ? resolveArchivePath(coverName, entries, "cover") : "";
  const publicEntries = entries.map(({ originalPath: _originalPath, flags: _flags, crc32: _crc32, localHeaderOffset: _localHeaderOffset, dataOffset: _dataOffset, dataEnd: _dataEnd, recordEnd: _recordEnd, ...entry }) => Object.freeze(entry));
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

/**
 * Normalize only the five supported Beat Saber Standard difficulty identities.
 * Separators and a literal plus sign are accepted solely to reject aliases as
 * duplicate canonical identities instead of making archive order meaningful.
 *
 * @param {string} value Raw Standard difficulty label.
 * @returns {string} Canonical difficulty.
 */
function canonicalStandardDifficulty(value) {
  const token = value.toLowerCase().replace(/\+/gu, "plus").replace(/[^a-z]/gu, "");
  const difficulty = standardDifficultyByToken[/** @type {keyof typeof standardDifficultyByToken} */ (token)];
  if (!difficulty) throw new BeatSaverVendorError("unsupported", `Standard difficulty ${value} is unsupported`);
  return difficulty;
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
  const normalized = pathKey(normalizeEntryPath(requested));
  const match = entries.find((entry) => !entry.directory && pathKey(entry.path) === normalized);
  if (match === undefined) throw new BeatSaverVendorError("provider_payload", `Info.dat ${role} path is absent from archive`, { details: { path: requested } });
  return match.path;
}

/** @param {string} value @returns {string} */
export function normalizeEntryPath(value) {
  if (typeof value !== "string" || value.length === 0 || /[\p{Cc}\p{Cf}]/u.test(value)) failArchive("ZIP entry path contains forbidden control characters");
  const path = value.replaceAll("\\", "/").normalize("NFC");
  if (path.startsWith("/") || /^[a-zA-Z]:\//u.test(path)) failArchive("Absolute ZIP entry paths are forbidden", { path });
  const directory = path.endsWith("/");
  const parts = path.split("/").filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 && !directory) failArchive("ZIP entry path is empty");
  if (parts.some((part) => part === "..")) failArchive("Parent ZIP entry paths are forbidden", { path });
  const normalized = parts.join("/") + (directory ? "/" : "");
  if (normalized.length > 1024) failArchive("ZIP entry path exceeds length limit");
  return normalized;
}

/** @param {string} path @returns {string} */
function pathKey(path) { return path.normalize("NFC").toLowerCase(); }

/**
 * @param {Uint8Array} bytes Archive bytes.
 * @param {number} centralOffset Central directory offset.
 * @param {number} index Entry index.
 * @param {Readonly<{originalPath: string, flags: number, method: number, crc: number, compressedBytes: number, expandedBytes: number, localHeaderOffset: number}>} entry Central metadata.
 * @returns {Readonly<{dataOffset: number, dataEnd: number, recordEnd: number}>} Validated local range.
 */
function validateLocalEntry(bytes, centralOffset, index, entry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = entry.localHeaderOffset;
  if (offset + 30 > centralOffset || view.getUint32(offset, true) !== 0x04034b50) failArchive("ZIP local header is malformed", { index });
  const flags = view.getUint16(offset + 6, true);
  const method = view.getUint16(offset + 8, true);
  const localCrc = view.getUint32(offset + 14, true);
  const localCompressed = view.getUint32(offset + 18, true);
  const localExpanded = view.getUint32(offset + 22, true);
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const dataEnd = dataOffset + entry.compressedBytes;
  if (dataOffset > centralOffset || dataEnd > centralOffset) failArchive("ZIP local entry extends into the central directory", { index });
  if (flags !== entry.flags) failArchive("ZIP local and central flags disagree", { index });
  if (method !== entry.method) failArchive("ZIP local and central compression methods disagree", { index });
  const localName = decodeName(bytes.subarray(offset + 30, offset + 30 + nameLength));
  if (localName !== entry.originalPath) failArchive("ZIP local and central filenames disagree", { index });
  validateExtraFields(bytes.subarray(offset + 30 + nameLength, dataOffset), index);
  const descriptor = (flags & 0x0008) !== 0;
  if (!descriptor) {
    if (localCrc !== entry.crc || localCompressed !== entry.compressedBytes || localExpanded !== entry.expandedBytes) failArchive("ZIP local and central sizes or CRC disagree", { index });
    return Object.freeze({ dataOffset, dataEnd, recordEnd: dataEnd });
  }
  if ((localCrc !== 0 && localCrc !== entry.crc) || (localCompressed !== 0 && localCompressed !== entry.compressedBytes) || (localExpanded !== 0 && localExpanded !== entry.expandedBytes)) failArchive("ZIP descriptor entry has conflicting local metadata", { index });
  const recordEnd = validateDataDescriptor(view, dataEnd, centralOffset, entry, index);
  return Object.freeze({ dataOffset, dataEnd, recordEnd });
}

/**
 * @param {DataView} view Archive view.
 * @param {number} offset Descriptor offset.
 * @param {number} centralOffset Central directory offset.
 * @param {Readonly<{crc: number, compressedBytes: number, expandedBytes: number}>} entry Entry metadata.
 * @param {number} index Entry index.
 * @returns {number} Descriptor end.
 */
function validateDataDescriptor(view, offset, centralOffset, entry, index) {
  if (offset + 12 <= centralOffset && view.getUint32(offset, true) === entry.crc && view.getUint32(offset + 4, true) === entry.compressedBytes && view.getUint32(offset + 8, true) === entry.expandedBytes) return offset + 12;
  if (offset + 16 <= centralOffset && view.getUint32(offset, true) === 0x08074b50 && view.getUint32(offset + 4, true) === entry.crc && view.getUint32(offset + 8, true) === entry.compressedBytes && view.getUint32(offset + 12, true) === entry.expandedBytes) return offset + 16;
  failArchive("ZIP data descriptor disagrees with central directory", { index });
}

/** @param {Uint8Array} extra Extra field bytes. @param {number} index Entry index. @returns {void} */
function validateExtraFields(extra, index) {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let cursor = 0;
  while (cursor < extra.byteLength) {
    if (cursor + 4 > extra.byteLength) failArchive("ZIP extra field is malformed", { index });
    const id = view.getUint16(cursor, true);
    const length = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (cursor + length > extra.byteLength) failArchive("ZIP extra field extends beyond its record", { index });
    if (id === 0x0001) failArchive("ZIP64 entries are unsupported", { index });
    cursor += length;
  }
}

/** @param {Uint8Array} archive Archive bytes. @param {InternalArchiveEntry} entry Entry. @param {BeatSaverArchiveLimits} limits Limits. @returns {Uint8Array} Expanded bytes. */
function inflateArchiveEntry(archive, entry, limits) {
  const compressed = archive.subarray(entry.dataOffset, entry.dataEnd);
  if (entry.compressionMethod === 0) {
    if (compressed.byteLength !== entry.expandedBytes) failArchive("Stored ZIP entry size differs from central directory", { path: entry.path });
    return Uint8Array.from(compressed);
  }
  /** @type {Uint8Array[]} */
  const chunks = [];
  let actualBytes = 0;
  const inflater = new Inflate((chunk) => {
    actualBytes += chunk.byteLength;
    if (actualBytes > entry.expandedBytes || actualBytes > limits.maxEntryBytes) failArchive("DEFLATE output exceeds declared or configured size", { path: entry.path, size: actualBytes });
    chunks.push(Uint8Array.from(chunk));
  });
  try {
    const chunkSize = 16 * 1024;
    if (compressed.byteLength === 0) inflater.push(compressed, true);
    for (let offset = 0; offset < compressed.byteLength; offset += chunkSize) inflater.push(compressed.subarray(offset, Math.min(compressed.byteLength, offset + chunkSize)), offset + chunkSize >= compressed.byteLength);
  } catch (error) {
    if (error instanceof BeatSaverVendorError) throw error;
    throw new BeatSaverVendorError("archive", "ZIP DEFLATE decompression failed", { cause: error, details: { path: entry.path } });
  }
  if (actualBytes !== entry.expandedBytes) failArchive("DEFLATE output size differs from central directory", { path: entry.path, size: actualBytes });
  return concatenateBytes(chunks, actualBytes);
}

/** @param {readonly Uint8Array[]} chunks Chunks. @param {number} length Length. @returns {Uint8Array} Bytes. */
function concatenateBytes(chunks, length) { const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes; }

const CRC32_TABLE = (() => { const table = new Uint32Array(256); for (let index = 0; index < 256; index += 1) { let value = index; for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1; table[index] = value >>> 0; } return table; })();
/** @param {Uint8Array} bytes Bytes. @returns {number} Unsigned CRC-32. */
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }

/** @param {DataView} view @returns {number} */
function findEndOfCentralDirectory(view) {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === view.byteLength) {
      if (offset >= 20 && view.getUint32(offset - 20, true) === 0x07064b50) failArchive("ZIP64 archives are unsupported");
      return offset;
    }
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
