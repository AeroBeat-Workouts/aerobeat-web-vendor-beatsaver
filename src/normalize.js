// @ts-check

import { BeatSaverVendorError } from "./errors.js";

/** @typedef {Readonly<{characteristic: string, difficulty: string, stars: number, notes: number, bombs: number, obstacles: number, njs: number, nps: number, durationSeconds: number, environment: string, chroma: boolean, cinema: boolean, mappingExtensions: boolean}>} BeatSaverDifficulty */
/** @typedef {Readonly<{hash: string, key: string, state: string, createdAt: string, downloadUrl: string, coverUrl: string, previewUrl: string, sageScore: number, difficulties: readonly BeatSaverDifficulty[]}>} BeatSaverVersion */
/** @typedef {Readonly<{providerId: "beatsaver", mapId: string, mapKey: string, mapName: string, description: string, tags: readonly string[], songName: string, songSubName: string, songAuthorName: string, levelAuthorName: string, bpm: number, durationSeconds: number, uploader: Readonly<{id: number, name: string, avatarUrl: string}>, stats: Readonly<{downloads: number, plays: number, upvotes: number, downvotes: number, score: number}>, versions: readonly BeatSaverVersion[], createdAt: string, updatedAt: string, uploadedAt: string, lastPublishedAt: string, ranked: boolean, qualified: boolean, automapper: boolean, declaredAi: boolean}>} BeatSaverMap */
/** @typedef {Readonly<{source: "search" | "latest", maps: readonly BeatSaverMap[], page: number, pages: number, total: number}>} BeatSaverMapCollection */

const DIFFICULTIES = new Set(["Easy", "Normal", "Hard", "Expert", "ExpertPlus"]);
const LATEST_SORTS = new Set(["FIRST_PUBLISHED", "UPDATED", "LAST_PUBLISHED", "CREATED", "CURATED"]);
const SEARCH_ORDERS = new Set(["Latest", "Relevance", "Rating", "Curated", "Random", "Duration"]);

/**
 * @param {unknown} payload Provider payload.
 * @returns {BeatSaverMap} Narrowed map.
 */
export function normalizeMap(payload) {
  const record = requireRecord(payload, "map");
  const metadata = optionalRecord(record.metadata);
  const mapId = requireNonEmptyString(record.id, "map.id").toUpperCase();
  const versionsPayload = optionalArray(record.versions);
  const versions = versionsPayload.map((entry, index) => normalizeVersion(entry, `map.versions[${index}]`));
  if (versions.length === 0) {
    throw new BeatSaverVendorError("provider_payload", "BeatSaver map has no versions", { details: { mapId } });
  }
  const uploader = optionalRecord(record.uploader);
  const stats = optionalRecord(record.stats);
  return Object.freeze({
    providerId: "beatsaver",
    mapId,
    mapKey: mapId,
    mapName: optionalString(record.name),
    description: optionalString(record.description),
    tags: Object.freeze(optionalArray(record.tags).map((value) => optionalString(value)).filter(Boolean)),
    songName: optionalString(metadata.songName),
    songSubName: optionalString(metadata.songSubName),
    songAuthorName: optionalString(metadata.songAuthorName),
    levelAuthorName: optionalString(metadata.levelAuthorName),
    bpm: finiteNumber(metadata.bpm),
    durationSeconds: nonNegativeInteger(metadata.duration),
    uploader: Object.freeze({
      id: nonNegativeInteger(uploader.id),
      name: optionalString(uploader.name),
      avatarUrl: optionalHttpsUrl(uploader.avatar, "uploader.avatar")
    }),
    stats: Object.freeze({
      downloads: nonNegativeInteger(stats.downloads),
      plays: nonNegativeInteger(stats.plays),
      upvotes: nonNegativeInteger(stats.upvotes),
      downvotes: nonNegativeInteger(stats.downvotes),
      score: finiteNumber(stats.score)
    }),
    versions: Object.freeze(versions),
    createdAt: optionalString(record.createdAt),
    updatedAt: optionalString(record.updatedAt),
    uploadedAt: optionalString(record.uploaded),
    lastPublishedAt: optionalString(record.lastPublishedAt),
    ranked: optionalBoolean(record.ranked),
    qualified: optionalBoolean(record.qualified),
    automapper: optionalBoolean(record.automapper),
    declaredAi: optionalBoolean(record.declaredAi)
  });
}

/**
 * @param {unknown} payload Provider collection payload.
 * @param {"search" | "latest"} source Collection source.
 * @returns {BeatSaverMapCollection} Narrowed collection.
 */
export function normalizeMapCollection(payload, source) {
  const record = requireRecord(payload, source);
  const docs = optionalArray(record.docs);
  const info = optionalRecord(record.info);
  const maps = docs.map((entry) => normalizeMap(entry));
  return Object.freeze({
    source,
    maps: Object.freeze(maps),
    page: nonNegativeInteger(info.page),
    pages: nonNegativeInteger(info.pages),
    total: info.total === undefined ? maps.length : nonNegativeInteger(info.total)
  });
}

/**
 * @param {BeatSaverMap} map Map record.
 * @param {string | undefined} identifier Version hash or key; defaults latest.
 * @returns {BeatSaverVersion} Selected version.
 */
export function selectVersion(map, identifier) {
  if (identifier !== undefined && typeof identifier !== "string") invalidRequest("BeatSaver version identifier must be a string");
  const normalized = (identifier ?? "").trim().toLowerCase();
  const selected = normalized.length === 0
    ? map.versions[0]
    : map.versions.find((version) => version.hash === normalized || version.key.toLowerCase() === normalized);
  if (selected === undefined) {
    throw new BeatSaverVendorError("invalid_request", "Requested BeatSaver version is unavailable", {
      details: { mapId: map.mapId, version: identifier ?? "" }
    });
  }
  return selected;
}

/**
 * @param {{text?: string, page?: number, pageSize?: number, order?: string, automapper?: boolean, tags?: readonly string[]}} query Search options.
 * @returns {URLSearchParams} Safe query.
 */
export function buildSearchParameters(query) {
  const parameters = new URLSearchParams();
  const text = optionalQueryString(query.text, "search text");
  parameters.set("q", text.slice(0, 256));
  parameters.set("pageSize", String(queryInteger(query.pageSize, 20, 1, 100, "search page size")));
  if (query.order !== undefined) {
    if (typeof query.order !== "string") invalidRequest("Search order must be a string");
    if (SEARCH_ORDERS.has(query.order)) parameters.set("order", query.order);
  }
  if (query.automapper !== undefined && typeof query.automapper !== "boolean") invalidRequest("Search automapper must be boolean");
  if (typeof query.automapper === "boolean") parameters.set("automapper", String(query.automapper));
  if (query.tags !== undefined) {
    if (!Array.isArray(query.tags) || query.tags.some((tag) => typeof tag !== "string")) invalidRequest("Search tags must be an array of strings");
    const tags = query.tags.map((tag) => tag.trim().slice(0, 64)).filter(Boolean).slice(0, 16);
    if (tags.length > 0) parameters.set("tags", tags.join(","));
  }
  return parameters;
}

/**
 * @param {{pageSize?: number, before?: string, after?: string, sort?: string, automapper?: boolean}} options Latest options.
 * @returns {URLSearchParams} Safe query.
 */
export function buildLatestParameters(options) {
  const parameters = new URLSearchParams();
  parameters.set("pageSize", String(queryInteger(options.pageSize, 20, 1, 100, "latest page size")));
  const before = optionalQueryString(options.before, "latest before");
  const after = optionalQueryString(options.after, "latest after");
  if (before) parameters.set("before", before.slice(0, 128));
  if (after) parameters.set("after", after.slice(0, 128));
  const sortValue = optionalQueryString(options.sort, "latest sort");
  const sort = sortValue === "" ? undefined : sortValue.toUpperCase();
  if (sort !== undefined && LATEST_SORTS.has(sort)) parameters.set("sort", sort);
  if (options.automapper !== undefined && typeof options.automapper !== "boolean") invalidRequest("Latest automapper must be boolean");
  if (typeof options.automapper === "boolean") parameters.set("automapper", String(options.automapper));
  return parameters;
}

/**
 * @param {unknown} payload Version payload.
 * @param {string} context Context.
 * @returns {BeatSaverVersion} Version.
 */
function normalizeVersion(payload, context) {
  const record = requireRecord(payload, context);
  const hash = requireStringPattern(record.hash, `${context}.hash`, /^[0-9a-fA-F]{40}$/u).toLowerCase();
  const downloadUrl = requireHttpsUrl(record.downloadURL, `${context}.downloadURL`);
  const difficulties = optionalArray(record.diffs).map((entry, index) => normalizeDifficulty(entry, `${context}.diffs[${index}]`));
  return Object.freeze({
    hash,
    key: optionalString(record.key).toUpperCase(),
    state: optionalString(record.state),
    createdAt: optionalString(record.createdAt),
    downloadUrl,
    coverUrl: optionalHttpsUrl(record.coverURL, `${context}.coverURL`),
    previewUrl: optionalHttpsUrl(record.previewURL, `${context}.previewURL`),
    sageScore: finiteNumber(record.sageScore),
    difficulties: Object.freeze(difficulties)
  });
}

/**
 * @param {unknown} payload Difficulty payload.
 * @param {string} context Context.
 * @returns {BeatSaverDifficulty} Difficulty.
 */
function normalizeDifficulty(payload, context) {
  const record = requireRecord(payload, context);
  const difficulty = optionalString(record.difficulty);
  if (difficulty && !DIFFICULTIES.has(difficulty)) {
    throw new BeatSaverVendorError("provider_payload", `Unsupported BeatSaver difficulty at ${context}`, { details: { difficulty } });
  }
  return Object.freeze({
    characteristic: optionalString(record.characteristic),
    difficulty,
    stars: finiteNumber(record.stars),
    notes: nonNegativeInteger(record.notes),
    bombs: nonNegativeInteger(record.bombs),
    obstacles: nonNegativeInteger(record.obstacles),
    njs: finiteNumber(record.njs),
    nps: finiteNumber(record.nps),
    durationSeconds: finiteNumber(record.seconds),
    environment: optionalString(record.environment),
    chroma: optionalBoolean(record.chroma),
    cinema: optionalBoolean(record.cinema),
    mappingExtensions: optionalBoolean(record.me)
  });
}

/** @param {unknown} value @param {string} context @returns {Record<string, unknown>} */
export function requireRecord(value, context) {
  if (!isPlainRecord(value)) {
    throw new BeatSaverVendorError("provider_payload", `Expected plain object at ${context}`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {Record<string, unknown>} */
export function optionalRecord(value) {
  return isPlainRecord(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {unknown} value @returns {readonly unknown[]} */
export function optionalArray(value) { return Array.isArray(value) ? value : []; }
/** @param {unknown} value @returns {string} */
export function optionalString(value) { return typeof value === "string" ? value : ""; }
/** @param {unknown} value @param {string} context @returns {string} */
export function requireNonEmptyString(value, context) {
  if (typeof value !== "string" || value.trim() === "") throw new BeatSaverVendorError("provider_payload", `Expected non-empty string at ${context}`);
  return value.trim();
}
/** @param {unknown} value @param {string} context @param {RegExp} pattern @returns {string} */
function requireStringPattern(value, context, pattern) {
  const text = requireNonEmptyString(value, context);
  if (!pattern.test(text)) throw new BeatSaverVendorError("provider_payload", `Invalid string at ${context}`);
  return text;
}
/** @param {unknown} value @returns {number} */
export function finiteNumber(value) { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
/** @param {unknown} value @returns {number} */
export function nonNegativeInteger(value) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0; }
/** @param {unknown} value @returns {boolean} */
export function optionalBoolean(value) { return value === true; }
/** @param {unknown} value @returns {boolean} */
function isPlainRecord(value) { if (typeof value !== "object" || value === null || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
/** @param {unknown} value @param {string} label @returns {string} */
function optionalQueryString(value, label) { if (value === undefined) return ""; if (typeof value !== "string") invalidRequest(`${label} must be a string`); return value.trim(); }
/** @param {unknown} value @param {number} fallback @param {number} minimum @param {number} maximum @param {string} label @returns {number} */
function queryInteger(value, fallback, minimum, maximum, label) { if (value === undefined) return fallback; if (typeof value !== "number" || !Number.isFinite(value)) invalidRequest(`${label} must be finite`); return Math.min(maximum, Math.max(minimum, Math.trunc(value))); }
/** @param {string} message @returns {never} */
function invalidRequest(message) { throw new BeatSaverVendorError("invalid_request", message); }
/** @param {unknown} value @param {string} context @returns {string} */
function requireHttpsUrl(value, context) {
  let url;
  try { url = new URL(requireNonEmptyString(value, context)); }
  catch (error) { if (error instanceof BeatSaverVendorError) throw error; throw new BeatSaverVendorError("provider_payload", `Expected valid URL at ${context}`, { cause: error }); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "") throw new BeatSaverVendorError("provider_payload", `Expected credential-free HTTPS URL at ${context}`);
  return url.href;
}
/** @param {unknown} value @param {string} context @returns {string} */
function optionalHttpsUrl(value, context) {
  if (typeof value !== "string" || value.trim() === "") return "";
  return requireHttpsUrl(value, context);
}
