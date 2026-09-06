// @ts-check

import { defaultNotePalette, isSourceNotePalette } from "@aerobeat/web-contracts/note-palette-contracts";

/** Shared pair-atomic fallback; source manifests retain `null` instead of claiming defaults are archive-authored. */
export const defaultBeatSaverNotePalette = defaultNotePalette;

/** @typedef {import("@aerobeat/web-contracts/note-palette-contracts").AeroSourceNotePalette} AeroSourceNotePalette */
/** @typedef {Readonly<{infoFormat: "v2" | "v4", infoVersion: string | null, infoHash: string, difficultyHash: string}>} PaletteContext */

/**
 * Resolve the exact selected Info.dat difficulty payload. Active official
 * schemes suppress lower-priority custom data even when their pair is invalid.
 *
 * @param {Readonly<Record<string, unknown>>} info Parsed Info.dat.
 * @param {Readonly<Record<string, unknown>>} difficulty Exact selected difficulty payload from Info.dat.
 * @param {PaletteContext} context Bounded immutable provenance inputs.
 * @returns {AeroSourceNotePalette | null} Sanitized song palette or null.
 */
export function resolveDifficultyNotePalette(info, difficulty, context) {
  const legacy = context.infoFormat === "v2";
  const schemeIndexValue = ownDataValue(difficulty, legacy ? "_beatmapColorSchemeIdx" : "beatmapColorSchemeIdx");
  const schemeIndex = selectedSchemeIndex(schemeIndexValue);
  const schemesValue = ownDataValue(info, legacy ? "_colorSchemes" : "colorSchemes");
  const schemes = Array.isArray(schemesValue) ? schemesValue : [];
  const selectedScheme = schemeIndex !== null && schemeIndex < schemes.length ? strictDataRecord(schemes[schemeIndex]) : null;
  const officialActive = selectedScheme !== null && isOfficialSchemeActive(selectedScheme, context.infoFormat, context.infoVersion);

  if (officialActive && schemeIndex !== null) {
    const scheme = legacy ? strictDataRecord(ownDataValue(selectedScheme, "colorScheme")) : selectedScheme;
    const pair = scheme === null ? null : legacy
      ? sanitizeObjectColorPair(ownDataValue(scheme, "saberAColor"), ownDataValue(scheme, "saberBColor"), true)
      : sanitizeV4HexColorPair(ownDataValue(scheme, "saberAColor"), ownDataValue(scheme, "saberBColor"));
    return pair === null ? null : createSourcePalette(pair, context, "info_color_scheme", legacy ? "v2_scheme" : "v4_scheme", schemeIndex);
  }

  const custom = strictDataRecord(ownDataValue(difficulty, legacy ? "_customData" : "customData"));
  if (custom === null) return null;
  const pair = sanitizeObjectColorPair(
    ownDataValue(custom, legacy ? "_colorLeft" : "colorLeft"),
    ownDataValue(custom, legacy ? "_colorRight" : "colorRight"),
    false
  );
  return pair === null ? null : createSourcePalette(pair, context, "difficulty_custom_data", legacy ? "v2_custom" : "v4_custom", null);
}

/**
 * Strictly sanitize an atomic normalized-sRGB object pair.
 *
 * @param {unknown} left Left value.
 * @param {unknown} right Right value.
 * @param {boolean} [requireAlpha] Require exact RGBA objects (official Info 2.1 schemes).
 * @returns {Readonly<{left: string, right: string}> | null} Canonical pair.
 */
export function sanitizeObjectColorPair(left, right, requireAlpha = false) {
  const leftColor = sanitizeObjectColor(left, requireAlpha);
  const rightColor = sanitizeObjectColor(right, requireAlpha);
  return leftColor === null || rightColor === null ? null : Object.freeze({ left: leftColor, right: rightColor });
}

/**
 * Strictly sanitize an atomic v4 official `RRGGBBAA` pair.
 *
 * @param {unknown} left Left value.
 * @param {unknown} right Right value.
 * @returns {Readonly<{left: string, right: string}> | null} Canonical pair.
 */
export function sanitizeV4HexColorPair(left, right) {
  const leftColor = sanitizeV4HexColor(left);
  const rightColor = sanitizeV4HexColor(right);
  return leftColor === null || rightColor === null ? null : Object.freeze({ left: leftColor, right: rightColor });
}

/** @param {unknown} value @param {boolean} requireAlpha @returns {string | null} */
function sanitizeObjectColor(value, requireAlpha) {
  const record = strictDataRecord(value);
  if (record === null) return null;
  const keys = Reflect.ownKeys(record);
  const expected = requireAlpha ? ["r", "g", "b", "a"] : keys.length === 3 ? ["r", "g", "b"] : ["r", "g", "b", "a"];
  if (keys.length !== expected.length || keys.some((key) => typeof key !== "string" || !expected.includes(key))) return null;
  /** @type {number[]} */
  const channels = [];
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return null;
    const channel = descriptor.value;
    if (typeof channel !== "number" || !Number.isFinite(channel) || channel < 0 || channel > 1) return null;
    channels.push(Object.is(channel, -0) ? 0 : channel);
  }
  if (channels.length === 4 && channels[3] !== 1) return null;
  return `#${channels.slice(0, 3).map((channel) => Math.round(channel * 255).toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

/** @param {unknown} value @returns {string | null} */
function sanitizeV4HexColor(value) {
  if (typeof value !== "string" || !/^[0-9A-Fa-f]{8}$/u.test(value) || value.slice(6).toUpperCase() !== "FF") return null;
  return `#${value.slice(0, 6).toUpperCase()}`;
}

/** @param {unknown} value @returns {number | null} */
function selectedSchemeIndex(value) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

/** @param {Readonly<Record<string, unknown>>} scheme @param {"v2" | "v4"} infoFormat @param {string | null} infoVersion @returns {boolean} */
function isOfficialSchemeActive(scheme, infoFormat, infoVersion) {
  if (infoFormat === "v2") return infoVersion !== null && compareVersion(infoVersion, "2.1.0") >= 0 && ownDataValue(scheme, "useOverride") === true;
  if (infoVersion === "4.0.0") return true;
  return infoVersion !== null && compareVersion(infoVersion, "4.0.1") >= 0 && ownDataValue(scheme, "overrideNotes") === true;
}

/** @param {string} left @param {string} right @returns {number} */
function compareVersion(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * @param {Readonly<{left: string, right: string}>} pair
 * @param {PaletteContext} context
 * @param {"info_color_scheme" | "difficulty_custom_data"} kind
 * @param {"v2_scheme" | "v2_custom" | "v4_scheme" | "v4_custom"} fieldSet
 * @param {number | null} schemeIndex
 * @returns {AeroSourceNotePalette}
 */
function createSourcePalette(pair, context, kind, fieldSet, schemeIndex) {
  const provenance = Object.freeze({
    kind,
    infoFormat: context.infoFormat,
    infoHash: context.infoHash,
    difficultyHash: context.difficultyHash,
    fieldSet,
    schemeIndex
  });
  const palette = Object.freeze({
    schema: /** @type {const} */ ("aerobeat/source_note_palette"),
    version: /** @type {const} */ (1),
    left: pair.left,
    right: pair.right,
    colorSpace: /** @type {const} */ ("srgb"),
    alpha: /** @type {const} */ (1),
    provenance
  });
  if (!isSourceNotePalette(palette)) throw new TypeError("Resolved BeatSaver note palette violates the shared source palette contract");
  return palette;
}

/**
 * Accept only an ordinary Object-prototype record whose own properties are all
 * enumerable data properties. Descriptors are inspected before values are read.
 *
 * @param {unknown} value
 * @returns {Readonly<Record<string, unknown>> | null}
 */
function strictDataRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return null;
  }
  return /** @type {Readonly<Record<string, unknown>>} */ (value);
}

/** @param {Readonly<Record<string, unknown>>} record @param {string} key @returns {unknown} */
function ownDataValue(record, key) {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}
