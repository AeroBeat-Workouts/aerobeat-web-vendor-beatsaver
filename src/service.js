// @ts-check

import { computeBeatSaverMapHash, inspectBeatSaverArchive, sha1ArchiveHex } from "./archive.js";
import { BeatSaverVendorError, toBeatSaverVendorError } from "./errors.js";
import { buildLatestParameters, buildSearchParameters, normalizeMap, normalizeMapCollection, selectVersion } from "./normalize.js";
import { BeatSaverTransport } from "./transport.js";

/** @typedef {import("./normalize.js").BeatSaverMap} BeatSaverMap */
/** @typedef {import("./normalize.js").BeatSaverVersion} BeatSaverVersion */
/** @typedef {import("./archive.js").BeatSaverSourceBundle} BeatSaverSourceBundle */
/** @typedef {Readonly<{serviceId: "aero.vendor.beatsaver", providerId: "beatsaver", phase: string, operation: string, lastErrorCode: string, lastMapId: string, capabilities: typeof beatSaverVendorCapabilities, transport: import("./transport.js").BeatSaverTransportTelemetry}>} BeatSaverVendorSnapshot */

/**
 * Browser BeatSaver vendor facade.
 */
export class AeroBeatSaverVendorService {
  /**
   * @param {{apiBaseUrl?: string, transport?: BeatSaverTransport, fetch?: import("./transport.js").BeatSaverFetch, proxyUrl?: (url: URL) => string | URL, timeoutMs?: number, maxRetries?: number, retryBaseMs?: number, maxDownloadBytes?: number, archiveLimits?: Partial<import("./archive.js").BeatSaverArchiveLimits>}} [options] Options.
   */
  constructor(options = {}) {
    let apiBaseUrl;
    try { apiBaseUrl = new URL(options.apiBaseUrl ?? "https://api.beatsaver.com/"); }
    catch (error) { throw new BeatSaverVendorError("invalid_request", "BeatSaver API base URL must be a valid URL", { cause: error }); }
    if (apiBaseUrl.protocol !== "https:" || apiBaseUrl.username !== "" || apiBaseUrl.password !== "") throw new BeatSaverVendorError("invalid_request", "BeatSaver API base URL must use credential-free HTTPS");
    this.apiBaseUrl = apiBaseUrl;
    this.transport = options.transport ?? new BeatSaverTransport({ fetch: options.fetch, proxyUrl: options.proxyUrl, timeoutMs: options.timeoutMs, maxRetries: options.maxRetries, retryBaseMs: options.retryBaseMs });
    this.maxDownloadBytes = Number.isFinite(options.maxDownloadBytes) ? Math.max(1, Math.trunc(options.maxDownloadBytes ?? 0)) : 128 * 1024 * 1024;
    this.archiveLimits = options.archiveLimits;
    /** @type {Map<string, number>} */
    this.activeOperations = new Map();
    this.state = { lastErrorCode: "", lastMapId: "" };
  }

  /**
   * @param {{text?: string, page?: number, pageSize?: number, order?: string, automapper?: boolean, tags?: readonly string[], difficulty?: string}} [query] Search query.
   * @param {{signal?: AbortSignal}} [options] Operation options.
   * @returns {Promise<import("./normalize.js").BeatSaverMapCollection>} Result.
   */
  async searchMaps(query = {}, options = {}) {
    return this.run("search", async () => {
      const page = normalizePage(query.page);
      const wanted = normalizeDifficultyName(query.difficulty);
      const url = new URL(`search/text/${page}`, this.apiBaseUrl);
      url.search = buildSearchParameters(query).toString();
      const result = normalizeMapCollection(await this.transport.getJson(url, { signal: options.signal }), "search");
      return wanted === "" ? result : Object.freeze({ ...result, maps: Object.freeze(result.maps.filter((map) => map.versions.some((version) => version.difficulties.some((difficulty) => difficulty.characteristic === "Standard" && difficulty.difficulty === wanted)))) });
    });
  }

  /**
   * @param {{pageSize?: number, before?: string, after?: string, sort?: string, automapper?: boolean}} [latest] Latest options.
   * @param {{signal?: AbortSignal}} [options] Operation options.
   * @returns {Promise<import("./normalize.js").BeatSaverMapCollection>} Result.
   */
  async listLatestMaps(latest = {}, options = {}) {
    return this.run("latest", async () => {
      const url = new URL("maps/latest", this.apiBaseUrl);
      url.search = buildLatestParameters(latest).toString();
      return normalizeMapCollection(await this.transport.getJson(url, { signal: options.signal }), "latest");
    });
  }

  /**
   * @param {string} mapId Map ID.
   * @param {{signal?: AbortSignal}} [options] Options.
   * @returns {Promise<BeatSaverMap>} Map.
   */
  async getMapById(mapId, options = {}) {
    const safeId = requireIdentifier(mapId, "map ID", /^[0-9a-zA-Z]+$/u);
    return this.run("detail-id", async () => normalizeMap(await this.transport.getJson(new URL(`maps/id/${encodeURIComponent(safeId)}`, this.apiBaseUrl), { signal: options.signal })));
  }

  /**
   * @param {string} hash Version hash.
   * @param {{signal?: AbortSignal}} [options] Options.
   * @returns {Promise<BeatSaverMap>} Map.
   */
  async getMapByHash(hash, options = {}) {
    const safeHash = requireIdentifier(hash, "version hash", /^[0-9a-fA-F]{40}$/u).toLowerCase();
    return this.run("detail-hash", async () => normalizeMap(await this.transport.getJson(new URL(`maps/hash/${safeHash}`, this.apiBaseUrl), { signal: options.signal })));
  }

  /**
   * Download, verify and inspect a selected provider version.
   *
   * @param {BeatSaverMap} map Normalized map.
   * @param {string | undefined} versionIdentifier Version hash/key; latest by default.
   * @param {{signal?: AbortSignal, onProgress?: import("./transport.js").BeatSaverProgressCallback}} [options] Options.
   * @returns {Promise<Readonly<{providerId: "beatsaver", map: BeatSaverMap, version: BeatSaverVersion, sourceHash: string, archiveSha1: string, source: BeatSaverSourceBundle}>>} Acquired source.
   */
  async acquireVersion(map, versionIdentifier, options = {}) {
    const version = selectVersion(map, versionIdentifier);
    return this.run("acquire", async () => {
      this.state.lastMapId = map.mapId;
      const bytes = await this.transport.getBytes(new URL(version.downloadUrl), { signal: options.signal, onProgress: options.onProgress, maxBytes: this.maxDownloadBytes });
      options.signal?.throwIfAborted();
      const archiveSha1 = sha1ArchiveHex(bytes);
      const source = await inspectBeatSaverArchive(bytes, { limits: this.archiveLimits });
      const sourceHash = await computeBeatSaverMapHash(source);
      if (sourceHash !== version.hash) {
        throw new BeatSaverVendorError("integrity", "BeatSaver map-content hash does not match selected provider version", {
          details: { expectedHash: version.hash, actualHash: sourceHash, archiveSha1, mapId: map.mapId }
        });
      }
      return Object.freeze({ providerId: "beatsaver", map, version, sourceHash, archiveSha1, source });
    });
  }

  /**
   * Inspect a local ZIP/File without provider metadata.
   *
   * @param {Blob | ArrayBuffer | Uint8Array} input Local archive.
   * @param {{signal?: AbortSignal}} [options] Options.
   * @returns {Promise<Readonly<{providerId: "beatsaver", sourceHash: string, archiveSha1: string, source: BeatSaverSourceBundle}>>} Local source.
   */
  async importLocalArchive(input, options = {}) {
    return this.run("local-import", async () => {
      options.signal?.throwIfAborted();
      const bytes = await inputBytes(input);
      if (bytes.byteLength > this.maxDownloadBytes) throw new BeatSaverVendorError("archive", "Local BeatSaver archive exceeds byte limit", { details: { size: bytes.byteLength, maximum: this.maxDownloadBytes } });
      const archiveSha1 = sha1ArchiveHex(bytes);
      options.signal?.throwIfAborted();
      const source = await inspectBeatSaverArchive(bytes, { limits: this.archiveLimits });
      const sourceHash = await computeBeatSaverMapHash(source);
      return Object.freeze({ providerId: "beatsaver", sourceHash, archiveSha1, source });
    });
  }

  /** @returns {BeatSaverVendorSnapshot} Snapshot. */
  snapshot() {
    const operations = [...this.activeOperations.keys()].sort();
    return Object.freeze({
      serviceId: "aero.vendor.beatsaver",
      providerId: "beatsaver",
      phase: operations.length === 0 ? "idle" : "busy",
      operation: operations.join(","),
      ...this.state,
      capabilities: beatSaverVendorCapabilities,
      transport: this.transport.snapshotTelemetry()
    });
  }

  /** @template T @param {string} operation @param {() => Promise<T>} action @returns {Promise<T>} */
  async run(operation, action) {
    this.activeOperations.set(operation, (this.activeOperations.get(operation) ?? 0) + 1);
    this.state.lastErrorCode = "";
    try {
      return await action();
    } catch (error) {
      const stable = toBeatSaverVendorError(error);
      this.state.lastErrorCode = stable.code;
      throw stable;
    } finally {
      const remaining = (this.activeOperations.get(operation) ?? 1) - 1;
      if (remaining === 0) this.activeOperations.delete(operation);
      else this.activeOperations.set(operation, remaining);
    }
  }
}

/** Complete implemented capability truth. */
export const beatSaverVendorCapabilities = Object.freeze({
  transport: true,
  dtoNormalization: true,
  search: true,
  latest: true,
  detailById: true,
  detailByHash: true,
  directCorsAcquisition: true,
  proxyTransport: true,
  localArchiveImport: true,
  integrityVerification: true,
  archiveInspection: true,
  sourceManifest: true,
  cancellation: true,
  progress: true
});

/** @param {unknown} value @param {string} label @param {RegExp} pattern @returns {string} */
function requireIdentifier(value, label, pattern) { if (typeof value !== "string") throw new BeatSaverVendorError("invalid_request", `Invalid BeatSaver ${label}`); const normalized = value.trim(); if (!pattern.test(normalized)) throw new BeatSaverVendorError("invalid_request", `Invalid BeatSaver ${label}`); return normalized; }
/** @param {unknown} value @returns {string} */
function normalizeDifficultyName(value) { if (value === undefined) return ""; if (typeof value !== "string") throw new BeatSaverVendorError("invalid_request", "BeatSaver difficulty filter must be a string"); if (value.trim() === "") return ""; const compact = value.toLowerCase().replaceAll(/[^a-z]/gu, ""); const names = /** @type {Readonly<Record<string, string>>} */ ({ easy: "Easy", normal: "Normal", hard: "Hard", expert: "Expert", expertplus: "ExpertPlus" }); const normalized = names[compact]; if (normalized === undefined) throw new BeatSaverVendorError("invalid_request", "Unsupported BeatSaver difficulty filter"); return normalized; }
/** @param {unknown} value @returns {number} */
function normalizePage(value) { if (value === undefined) return 0; if (typeof value !== "number" || !Number.isFinite(value)) throw new BeatSaverVendorError("invalid_request", "BeatSaver search page must be finite"); return Math.min(100_000, Math.max(0, Math.trunc(value))); }
/** @param {Blob | ArrayBuffer | Uint8Array} input @returns {Promise<Uint8Array>} */
async function inputBytes(input) { if (input instanceof Uint8Array) return input.slice(); if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0)); if (input instanceof Blob) return new Uint8Array(await input.arrayBuffer()); throw new BeatSaverVendorError("invalid_request", "Local archive must be Blob, ArrayBuffer, or Uint8Array"); }
