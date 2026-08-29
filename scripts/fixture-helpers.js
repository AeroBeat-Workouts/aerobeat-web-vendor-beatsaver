// @ts-check

import { strToU8, zipSync } from "fflate";

/**
 * @param {2 | 3 | 4} major Beat Saber metadata major.
 * @returns {Uint8Array} Synthetic ZIP.
 */
export function createSyntheticBeatSaverZip(major = 2) {
  const difficulty = createSyntheticDifficulty(major);
  const info = major === 4 ? {
    version: "4.0.0",
    song: { title: "Synthetic Four", subTitle: "", author: "AeroBeat" },
    audio: { songFilename: "Audio/Song.egg", audioDataFilename: "Audio/AudioData.dat", bpm: 128, previewStartTime: 2, previewDuration: 10 },
    coverImageFilename: "Cover.PNG",
    difficultyBeatmaps: [{ characteristic: "Standard", difficulty: "Expert", beatmapDataFilename: "Maps/Expert.dat", noteJumpMovementSpeed: 14, noteJumpStartBeatOffset: 0 }]
  } : major === 3 ? {
    version: "3.0.0",
    songName: "Synthetic Three",
    songAuthorName: "AeroBeat",
    levelAuthorName: "Fixture",
    songFilename: "Audio/Song.egg",
    coverImageFilename: "Cover.PNG",
    beatsPerMinute: 128,
    difficultyBeatmapSets: [{ beatmapCharacteristicName: "Standard", difficultyBeatmaps: [{ difficulty: "Expert", difficultyRank: 7, beatmapFilename: "Maps/Expert.dat", noteJumpMovementSpeed: 14, noteJumpStartBeatOffset: 0 }] }]
  } : {
    _version: "2.1.0",
    _songName: "Synthetic Two",
    _songAuthorName: "AeroBeat",
    _levelAuthorName: "Fixture",
    _songFilename: "Audio/Song.egg",
    _coverImageFilename: "Cover.PNG",
    _beatsPerMinute: 128,
    _difficultyBeatmapSets: [{ _beatmapCharacteristicName: "Standard", _difficultyBeatmaps: [{ _difficulty: "Expert", _difficultyRank: 7, _beatmapFilename: "Maps/Expert.dat", _noteJumpMovementSpeed: 14, _noteJumpStartBeatOffset: 0 }] }]
  };
  /** @type {Record<string, [Uint8Array, import("fflate").ZipOptions]>} */
  const entries = {
    "Info.dat": syntheticZipEntry(strToU8(JSON.stringify(info))),
    "Audio/Song.egg": syntheticZipEntry(Uint8Array.of(79, 103, 103, 83)),
    "Cover.PNG": syntheticZipEntry(Uint8Array.of(137, 80, 78, 71)),
    "Maps/Expert.dat": syntheticZipEntry(strToU8(JSON.stringify(difficulty)))
  };
  if (major === 4) entries["Audio/AudioData.dat"] = syntheticZipEntry(strToU8('{"version":"4.0.0","songChecksum":"fixture"}'));
  return zipSync(entries, { level: 6, mtime: fixedSyntheticZipMtime(), os: 0, attrs: 0x20 });
}

/** @param {Uint8Array} bytes @returns {[Uint8Array, import("fflate").ZipOptions]} */
function syntheticZipEntry(bytes) {
  return [bytes, { level: 6, mtime: fixedSyntheticZipMtime(), os: 0, attrs: 0x20 }];
}

/** @returns {Date} Legal DOS-compatible local date with timezone-stable fields. */
function fixedSyntheticZipMtime() { return new Date(2000, 0, 1, 0, 0, 0, 0); }

/** @param {2 | 3 | 4} major @returns {string} Stable synthetic fixture ID. */
export function syntheticBeatSaverFixtureId(major) { return `aerobeat-vendor-source-v${major}-standard-expert-v1`; }

/** @param {2 | 3 | 4} major @returns {Record<string, unknown>} Matching synthetic difficulty document. */
export function createSyntheticDifficulty(major) {
  if (major === 2) return {
    _version: "2.6.0",
    _notes: [
      { _time: 1, _lineIndex: 0, _lineLayer: 1, _type: 0, _cutDirection: 1 },
      { _time: 2, _lineIndex: 3, _lineLayer: 1, _type: 1, _cutDirection: 0 }
    ],
    _obstacles: [{ _time: 3, _duration: 1, _lineIndex: 1, _type: 0, _width: 2 }]
  };
  if (major === 3) return {
    version: "3.3.0",
    colorNotes: [
      { b: 1, x: 0, y: 1, c: 0, d: 1 },
      { b: 2, x: 3, y: 1, c: 1, d: 0 }
    ],
    obstacles: [{ b: 3, d: 1, x: 1, y: 0, w: 2, h: 3 }]
  };
  return {
    version: "4.0.0",
    colorNotesData: [
      { x: 0, y: 1, c: 0, d: 1 },
      { x: 3, y: 1, c: 1, d: 0 }
    ],
    colorNotes: [{ b: 1, i: 0 }, { b: 2, i: 1 }],
    obstaclesData: [{ d: 1, x: 1, y: 0, w: 2, h: 3 }],
    obstacles: [{ b: 3, i: 0 }]
  };
}

/** Independent v4 provider golden expected SHA-1; never derived by archive.js. */
export const v4ProviderHashGoldenExpected = "96e68173fffd6454bfb38740acaf58653da11320";

/** Exact raw Info.dat bytes used by the independent v4 provider golden. */
export const v4ProviderHashGoldenInfo = '{"version":"4.0.0","song":{"title":"Provider Hash Golden","subTitle":"","author":"AeroBeat"},"audio":{"songFilename":"Song.egg","audioDataFilename":"AudioData.dat","bpm":120,"previewStartTime":0,"previewDuration":10},"coverImageFilename":"Cover.png","difficultyBeatmaps":[{"characteristic":"Lightshow","difficulty":"Easy","difficultyRank":1,"beatmapDataFilename":"EasyLightshow.dat","lightshowDataFilename":"SharedLightshow.dat","noteJumpMovementSpeed":10,"noteJumpStartBeatOffset":0},{"characteristic":"Standard","difficulty":"ExpertPlus","difficultyRank":9,"beatmapDataFilename":"ExpertPlusStandard.dat","lightshowDataFilename":"SharedLightshow.dat","noteJumpMovementSpeed":18,"noteJumpStartBeatOffset":0}]}';

/**
 * Build an independent v4 provider-hash golden with AudioData and a repeated
 * shared lightshow reference. Its expected digest is hard-coded above.
 *
 * @param {{tamperAudioData?: boolean}} [options] Fixture mutation.
 * @returns {Uint8Array} Deterministic ZIP.
 */
export function createV4ProviderHashGoldenZip(options = {}) {
  const audioData = options.tamperAudioData
    ? strToU8('{"version":"4.0.0","songChecksum":"tampered"}')
    : strToU8('{"version":"4.0.0","songChecksum":"golden"}');
  return zipSync({
    "Info.dat": syntheticZipEntry(strToU8(v4ProviderHashGoldenInfo)),
    "Song.egg": syntheticZipEntry(Uint8Array.of(71, 79, 76, 68, 69, 78)),
    "AudioData.dat": syntheticZipEntry(audioData),
    "Cover.png": syntheticZipEntry(Uint8Array.of(137, 80, 78, 71)),
    "EasyLightshow.dat": syntheticZipEntry(strToU8('{"version":"4.0.0","basicBeatmapEvents":[]}')),
    "SharedLightshow.dat": syntheticZipEntry(strToU8('{"version":"4.0.0","lightColorEventBoxGroups":[{"b":1}]}')),
    "ExpertPlusStandard.dat": syntheticZipEntry(strToU8('{"version":"4.0.0","colorNotesData":[{"x":1,"y":1,"c":0,"d":1}],"colorNotes":[{"b":1,"i":0}]}'))
  }, { level: 6, mtime: fixedSyntheticZipMtime(), os: 0, attrs: 0x20 });
}

/**
 * @param {string} hash Provider hash.
 * @param {string} downloadUrl Download URL.
 * @param {string} [mapId] Arbitrary provider map ID.
 * @returns {Record<string, unknown>} Synthetic provider detail.
 */
export function createSyntheticMapPayload(hash, downloadUrl = "https://cdn.example.invalid/synthetic.zip", mapId = "A1B2C") {
  return {
    id: mapId,
    name: "Synthetic Map",
    description: "Metadata-only deterministic fixture",
    tags: ["balanced"],
    metadata: { songName: "Synthetic", songSubName: "", songAuthorName: "AeroBeat", levelAuthorName: "Fixture", bpm: 128, duration: 60 },
    uploader: { id: 1, name: "Fixture", avatar: "https://cdn.example.invalid/avatar.png" },
    stats: { downloads: 10, plays: 5, upvotes: 4, downvotes: 1, score: 0.8 },
    versions: [{ hash, key: mapId, state: "Published", createdAt: "2026-01-01T00:00:00Z", downloadURL: downloadUrl, coverURL: "https://cdn.example.invalid/cover.png", previewURL: "https://cdn.example.invalid/preview.ogg", diffs: [{ characteristic: "Standard", difficulty: "Expert", notes: 20, bombs: 1, obstacles: 2, njs: 14, nps: 2, seconds: 60 }] }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    uploaded: "2026-01-01T00:00:00Z",
    lastPublishedAt: "2026-01-01T00:00:00Z",
    ranked: false,
    qualified: false,
    automapper: false,
    declaredAi: false
  };
}

/** @param {Uint8Array} bytes @returns {Uint8Array} Copy. */
export function cloneBytes(bytes) { return Uint8Array.from(bytes); }
