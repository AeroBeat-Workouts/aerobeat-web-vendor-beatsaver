// @ts-check

import { strToU8, zipSync } from "fflate";

/**
 * @param {2 | 3 | 4} major Beat Saber metadata major.
 * @returns {Uint8Array} Synthetic ZIP.
 */
export function createSyntheticBeatSaverZip(major = 2) {
  const info = major === 4 ? {
    version: "4.0.0",
    song: { title: "Synthetic Four", subTitle: "", author: "AeroBeat" },
    audio: { songFilename: "Audio/Song.egg", bpm: 128, previewStartTime: 2, previewDuration: 10 },
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
  return zipSync({
    "Info.dat": strToU8(JSON.stringify(info)),
    "Audio/Song.egg": Uint8Array.of(79, 103, 103, 83),
    "Cover.PNG": Uint8Array.of(137, 80, 78, 71),
    "Maps/Expert.dat": strToU8(JSON.stringify({ version: "3.3.0", colorNotes: [] }))
  }, { level: 6 });
}

/**
 * @param {string} hash Provider hash.
 * @param {string} downloadUrl Download URL.
 * @returns {Record<string, unknown>} Synthetic provider detail.
 */
export function createSyntheticMapPayload(hash, downloadUrl = "https://cdn.example.invalid/synthetic.zip") {
  return {
    id: "A1B2C",
    name: "Synthetic Map",
    description: "Metadata-only deterministic fixture",
    tags: ["balanced"],
    metadata: { songName: "Synthetic", songSubName: "", songAuthorName: "AeroBeat", levelAuthorName: "Fixture", bpm: 128, duration: 60 },
    uploader: { id: 1, name: "Fixture", avatar: "https://cdn.example.invalid/avatar.png" },
    stats: { downloads: 10, plays: 5, upvotes: 4, downvotes: 1, score: 0.8 },
    versions: [{ hash, key: "A1B2C", state: "Published", createdAt: "2026-01-01T00:00:00Z", downloadURL: downloadUrl, coverURL: "https://cdn.example.invalid/cover.png", previewURL: "https://cdn.example.invalid/preview.ogg", diffs: [{ characteristic: "Standard", difficulty: "Expert", notes: 20, bombs: 1, obstacles: 2, njs: 14, nps: 2, seconds: 60 }] }],
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
