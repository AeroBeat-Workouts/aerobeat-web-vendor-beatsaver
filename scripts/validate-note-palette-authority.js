// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { defaultNotePalette, isSourceNotePalette } from "@aerobeat/web-contracts/note-palette-contracts";
import {
  defaultBeatSaverNotePalette,
  inspectBeatSaverArchive,
  normalizeMap,
  sanitizeObjectColorPair,
  sanitizeV4HexColorPair
} from "../src/index.js";
import { createMixedCharacteristicBeatSaverZip, createSyntheticBeatSaverZip, createSyntheticMapPayload } from "./fixture-helpers.js";

const customLeft = Object.freeze({ r: 1, g: 0.5, b: 0 });
const customRight = Object.freeze({ r: 0, g: 0.25, b: 1, a: 1 });
const expectedCustom = Object.freeze({ left: "#FF8000", right: "#0040FF" });
const schemeLeft = Object.freeze({ r: 1, g: 0, b: 0, a: 1 });
const schemeRight = Object.freeze({ r: 0, g: 1, b: 0, a: 1 });
const expectedScheme = Object.freeze({ left: "#FF0000", right: "#00FF00" });

await expectPalette("Info 2.0 custom-only", legacyArchive("2.0.0", (difficulty) => setLegacyCustom(difficulty)), expectedCustom, "v2_custom", 2, "2.6.0");
await expectPalette("Info 2.1 active official precedence", legacyArchive("2.1.0", (difficulty, info) => {
  setLegacyCustom(difficulty);
  difficulty._beatmapColorSchemeIdx = 0;
  info._colorSchemes = [{ useOverride: true, colorScheme: { saberAColor: schemeLeft, saberBColor: schemeRight } }];
}), expectedScheme, "v2_scheme", 2, "2.6.0");
await expectNull("Info 2.1 active invalid official suppresses valid custom", legacyArchive("2.1.0", (difficulty, info) => {
  setLegacyCustom(difficulty);
  difficulty._beatmapColorSchemeIdx = 0;
  info._colorSchemes = [{ useOverride: true, colorScheme: { saberAColor: schemeLeft, saberBColor: { r: 2, g: 0, b: 0, a: 1 } } }];
}));

for (const [label, configure] of [
  ["useOverride false", (/** @type {Record<string, unknown>} */ difficulty, /** @type {Record<string, unknown>} */ info) => { difficulty._beatmapColorSchemeIdx = 0; info._colorSchemes = [{ useOverride: false, colorScheme: { saberAColor: schemeLeft, saberBColor: schemeRight } }]; }],
  ["sentinel -1", (/** @type {Record<string, unknown>} */ difficulty, /** @type {Record<string, unknown>} */ info) => { difficulty._beatmapColorSchemeIdx = -1; info._colorSchemes = [{ useOverride: true, colorScheme: { saberAColor: schemeLeft, saberBColor: schemeRight } }]; }],
  ["absent index", () => {}],
  ["empty schemes", (/** @type {Record<string, unknown>} */ difficulty, /** @type {Record<string, unknown>} */ info) => { difficulty._beatmapColorSchemeIdx = 0; info._colorSchemes = []; }],
  ["dangling index", (/** @type {Record<string, unknown>} */ difficulty, /** @type {Record<string, unknown>} */ info) => { difficulty._beatmapColorSchemeIdx = 5; info._colorSchemes = []; }],
  ["non-integer index", (/** @type {Record<string, unknown>} */ difficulty, /** @type {Record<string, unknown>} */ info) => { difficulty._beatmapColorSchemeIdx = 0.5; info._colorSchemes = [{ useOverride: true, colorScheme: { saberAColor: schemeLeft, saberBColor: schemeRight } }]; }],
  ["negative non-sentinel", (/** @type {Record<string, unknown>} */ difficulty, /** @type {Record<string, unknown>} */ info) => { difficulty._beatmapColorSchemeIdx = -2; info._colorSchemes = [{ useOverride: true, colorScheme: { saberAColor: schemeLeft, saberBColor: schemeRight } }]; }]
]) {
  await expectPalette(`Info 2.1 inactive/invalid selection ${label}`, legacyArchive("2.1.0", (difficulty, info) => { setLegacyCustom(difficulty); configure(difficulty, info); }), expectedCustom, "v2_custom", 2, "2.6.0");
}

await expectPalette("Info 2.1 with v3 difficulty", createSyntheticBeatSaverZip(3, { mutateInfo: (info) => setLegacyCustom(firstLegacyDifficulty(info)) }), expectedCustom, "v2_custom", 3, "3.3.0");
await expectPalette("Info 4.0.0 implicit official", v4Archive("4.0.0", (difficulty, info) => {
  setV4Custom(difficulty);
  difficulty.beatmapColorSchemeIdx = 0;
  info.colorSchemes = [{ saberAColor: "FF0000FF", saberBColor: "00FF00FF", overrideNotes: false }];
}), expectedScheme, "v4_scheme", 4, "4.0.0");
await expectPalette("Info 4.0.1 overrideNotes exact true", v4Archive("4.0.1", (difficulty, info) => {
  setV4Custom(difficulty);
  difficulty.beatmapColorSchemeIdx = 0;
  info.colorSchemes = [{ saberAColor: "FF0000FF", saberBColor: "00FF00FF", overrideNotes: true, overrideLights: false }];
}), expectedScheme, "v4_scheme", 4, "4.0.0");
await expectPalette("Info 4.0.1 overrideNotes false custom", v4Archive("4.0.1", (difficulty, info) => {
  setV4Custom(difficulty);
  difficulty.beatmapColorSchemeIdx = 0;
  info.colorSchemes = [{ saberAColor: "FF0000FF", saberBColor: "00FF00FF", overrideNotes: false, overrideLights: true }];
}), expectedCustom, "v4_custom", 4, "4.0.0");
await expectNull("Info 4.0.1 active invalid official suppresses custom", v4Archive("4.0.1", (difficulty, info) => {
  setV4Custom(difficulty);
  difficulty.beatmapColorSchemeIdx = 0;
  info.colorSchemes = [{ saberAColor: "FF000080", saberBColor: "00FF00FF", overrideNotes: true }];
}));

const distinct = await inspectBeatSaverArchive(createMixedCharacteristicBeatSaverZip(3, { mutateInfo: (info) => {
  const sets = /** @type {Record<string, unknown>[]} */ (info._difficultyBeatmapSets);
  for (const set of sets) for (const difficulty of /** @type {Record<string, unknown>[]} */ (set._difficultyBeatmaps)) {
    if (set._beatmapCharacteristicName !== "Standard") continue;
    const token = String(difficulty._difficulty);
    difficulty._customData = token === "Easy" ? { _colorLeft: { r: 1, g: 0, b: 0 }, _colorRight: { r: 0, g: 1, b: 0 } } : token === "Hard" ? { _colorLeft: { r: 0, g: 0, b: 1 }, _colorRight: { r: 1, g: 1, b: 0 } } : { _colorLeft: { r: 1, g: 0, b: 1 }, _colorRight: { r: 0, g: 1, b: 1 } };
  }
} }));
assert.deepEqual(distinct.manifest.difficulties.map((difficulty) => [difficulty.difficulty, difficulty.notePalette?.left, difficulty.notePalette?.right]), [
  ["Easy", "#FF0000", "#00FF00"], ["Hard", "#0000FF", "#FFFF00"], ["ExpertPlus", "#FF00FF", "#00FFFF"]
], "palette authority must remain scoped to each exact Standard difficulty");

assert.deepEqual(defaultBeatSaverNotePalette, defaultNotePalette, "vendor fallback constant must be the shared contract constant");
assert.deepEqual(sanitizeObjectColorPair({ r: -0, g: 0.5, b: 1 }, { r: 1, g: 1, b: 1 }), { left: "#0080FF", right: "#FFFFFF" });
assert.deepEqual(sanitizeV4HexColorPair("ff0000FF", "808080ff"), { left: "#FF0000", right: "#808080" });

const invalidObjects = [
  undefined, null, [], new (class Color { constructor() { this.r = 0; this.g = 0; this.b = 0; } })(),
  Object.assign(Object.create({ r: 0 }), { g: 0, b: 0 }),
  { r: 0, g: 0 }, { r: 0, g: 0, b: 0, extra: 0 }, { r: "0", g: 0, b: 0 },
  { r: true, g: 0, b: 0 }, { r: Number.NaN, g: 0, b: 0 }, { r: Number.POSITIVE_INFINITY, g: 0, b: 0 },
  { r: Number.NEGATIVE_INFINITY, g: 0, b: 0 }, { r: -0.01, g: 0, b: 0 }, { r: 1.01, g: 0, b: 0 }, { r: 0, g: 0, b: 0, a: 0.99 }
];
for (const invalid of invalidObjects) assert.equal(sanitizeObjectColorPair(invalid, { r: 0, g: 0, b: 0 }), null);
let accessorReads = 0;
const accessorColor = { g: 0, b: 0 };
Object.defineProperty(accessorColor, "r", { enumerable: true, get: () => { accessorReads += 1; return 0; } });
assert.equal(sanitizeObjectColorPair(accessorColor, { r: 0, g: 0, b: 0 }), null);
assert.equal(accessorReads, 0, "strict sanitizer must reject accessors without invoking them");
const hidden = { r: 0, g: 0, b: 0 };
Object.defineProperty(hidden, "a", { value: 1, enumerable: false });
assert.equal(sanitizeObjectColorPair(hidden, { r: 0, g: 0, b: 0 }), null);
for (const invalid of ["FF0000", "#FF0000FF", "0xFF0000FF", " FF0000FF", "FF0000FF ", "ＧＦ0000FF", "GG0000FF", "FF000080", 0]) {
  assert.equal(sanitizeV4HexColorPair(invalid, "00FF00FF"), null);
}

const payload = createSyntheticMapPayload("0".repeat(40));
payload.notePalette = { left: "#123456", right: "#654321" };
const providerVersion = /** @type {Record<string, unknown>} */ (/** @type {unknown[]} */ (payload.versions)[0]);
providerVersion.colorSchemes = [{ saberAColor: "123456FF", saberBColor: "654321FF" }];
const providerDifficulty = /** @type {Record<string, unknown>} */ (/** @type {unknown[]} */ (providerVersion.diffs)[0]);
providerDifficulty.colorLeft = { r: 1, g: 0, b: 0 };
providerDifficulty.notePalette = { left: "#123456", right: "#654321" };
const normalized = normalizeMap(payload);
assert.equal(JSON.stringify(normalized).includes("123456"), false, "BeatSaver API metadata extras must never become palette authority");
assert.equal(Object.hasOwn(normalized, "notePalette"), false);
assert.equal(Object.hasOwn(normalized.versions[0] ?? {}, "colorSchemes"), false);
assert.equal(Object.hasOwn(normalized.versions[0]?.difficulties[0] ?? {}, "colorLeft"), false);

console.log("BeatSaver note-palette authority, strict sanitizer, provenance, and API non-authority matrix passed.");

/** @param {string} version @param {(difficulty: Record<string, unknown>, info: Record<string, unknown>) => void} configure @returns {Uint8Array} */
function legacyArchive(version, configure) {
  return createSyntheticBeatSaverZip(2, { mutateInfo: (info) => { info._version = version; configure(firstLegacyDifficulty(info), info); } });
}

/** @param {string} version @param {(difficulty: Record<string, unknown>, info: Record<string, unknown>) => void} configure @returns {Uint8Array} */
function v4Archive(version, configure) {
  return createSyntheticBeatSaverZip(4, { mutateInfo: (info) => { info.version = version; const difficulty = /** @type {Record<string, unknown>} */ (/** @type {unknown[]} */ (info.difficultyBeatmaps)[0]); configure(difficulty, info); } });
}

/** @param {Record<string, unknown>} info @returns {Record<string, unknown>} */
function firstLegacyDifficulty(info) {
  const set = /** @type {Record<string, unknown>} */ (/** @type {unknown[]} */ (info._difficultyBeatmapSets)[0]);
  return /** @type {Record<string, unknown>} */ (/** @type {unknown[]} */ (set._difficultyBeatmaps)[0]);
}

/** @param {Record<string, unknown>} difficulty */
function setLegacyCustom(difficulty) { difficulty._customData = { _colorLeft: customLeft, _colorRight: customRight }; }
/** @param {Record<string, unknown>} difficulty */
function setV4Custom(difficulty) { difficulty.customData = { colorLeft: customLeft, colorRight: customRight }; }

/**
 * @param {string} label @param {Uint8Array} archive @param {Readonly<{left: string, right: string}>} expected
 * @param {"v2_scheme" | "v2_custom" | "v4_scheme" | "v4_custom"} fieldSet
 * @param {2 | 3 | 4} beatmapMajor @param {string} beatMapVersion
 */
async function expectPalette(label, archive, expected, fieldSet, beatmapMajor, beatMapVersion) {
  const source = await inspectBeatSaverArchive(archive);
  const difficulty = source.manifest.difficulties[0];
  assert.ok(difficulty, `${label}: difficulty`);
  assert.equal(difficulty.beatMapFormatMajor, beatmapMajor, `${label}: beatmap major`);
  assert.equal(difficulty.beatMapFormat, `v${beatmapMajor}`, `${label}: beatmap format`);
  assert.equal(difficulty.beatMapVersion, beatMapVersion, `${label}: beatmap version`);
  assert.ok(isSourceNotePalette(difficulty.notePalette), `${label}: shared contract validation`);
  assert.deepEqual({ left: difficulty.notePalette.left, right: difficulty.notePalette.right }, expected, `${label}: exact pair`);
  assert.equal(difficulty.notePalette.provenance.fieldSet, fieldSet, `${label}: field set`);
  assert.deepEqual(Reflect.ownKeys(difficulty.notePalette.provenance).sort(), ["difficultyHash", "fieldSet", "infoFormat", "infoHash", "kind", "schemeIndex"].sort(), `${label}: bounded provenance keys`);
  assert.equal(difficulty.notePalette.provenance.infoHash, sha256Token(source.readEntry(source.manifest.infoPath)), `${label}: exact Info SHA-256`);
  assert.equal(difficulty.notePalette.provenance.difficultyHash, sha256Token(source.readEntry(difficulty.path)), `${label}: exact difficulty SHA-256`);
}

/** @param {string} label @param {Uint8Array} archive */
async function expectNull(label, archive) {
  const source = await inspectBeatSaverArchive(archive);
  assert.equal(source.manifest.difficulties[0]?.notePalette, null, `${label}: manifest palette`);
  assert.deepEqual(defaultBeatSaverNotePalette, { left: "#2693FF", right: "#39C96B", colorSpace: "srgb", alpha: 1 }, `${label}: exact pair-atomic fallback`);
}

/** @param {Uint8Array} bytes @returns {string} */
function sha256Token(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
