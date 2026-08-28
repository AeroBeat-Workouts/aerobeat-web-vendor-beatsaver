// @ts-check

import { BeatSaverVendorError, toBeatSaverVendorError } from "./errors.js";

/** @typedef {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} BeatSaverFetch */
/** @typedef {(event: Readonly<{phase: "download", loadedBytes: number, totalBytes: number | undefined}>) => void} BeatSaverProgressCallback */
/** @typedef {Readonly<{requests: number, retries: number, failures: number, downloadedBytes: number, lastStatus: number | undefined}>} BeatSaverTransportTelemetry */

/**
 * Fetch transport with cancellation, deadlines and bounded retry.
 */
export class BeatSaverTransport {
  /**
   * @param {{fetch?: BeatSaverFetch, proxyUrl?: (url: URL) => string | URL, timeoutMs?: number, maxRetries?: number, retryBaseMs?: number}} [options] Transport options.
   */
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.proxyUrl = options.proxyUrl;
    this.timeoutMs = boundedInteger(options.timeoutMs, 15_000, 100, 120_000);
    this.maxRetries = boundedInteger(options.maxRetries, 2, 0, 5);
    this.retryBaseMs = boundedInteger(options.retryBaseMs, 250, 10, 10_000);
    this.metrics = { requests: 0, retries: 0, failures: 0, downloadedBytes: 0, lastStatus: undefined };
  }

  /**
   * @param {URL} directUrl Provider URL.
   * @param {{signal?: AbortSignal, accept?: string}} [options] Request options.
   * @returns {Promise<unknown>} Parsed JSON.
   */
  async getJson(directUrl, options = {}) {
    const response = await this.request(directUrl, { signal: options.signal, accept: options.accept ?? "application/json" });
    try {
      return /** @type {unknown} */ (await response.json());
    } catch (error) {
      throw new BeatSaverVendorError("provider_payload", "BeatSaver response was not valid JSON", {
        status: response.status,
        cause: error
      });
    }
  }

  /**
   * @param {URL} directUrl Download URL.
   * @param {{signal?: AbortSignal, onProgress?: BeatSaverProgressCallback, maxBytes?: number}} [options] Download options.
   * @returns {Promise<Uint8Array>} Download bytes.
   */
  async getBytes(directUrl, options = {}) {
    const maxBytes = boundedInteger(options.maxBytes, 128 * 1024 * 1024, 1, 1024 * 1024 * 1024);
    const response = await this.request(directUrl, { signal: options.signal, accept: "application/zip, application/octet-stream" });
    const totalHeader = response.headers.get("content-length");
    const totalBytes = totalHeader === null ? undefined : Number.parseInt(totalHeader, 10);
    if (totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes > maxBytes) {
      throw new BeatSaverVendorError("archive", "BeatSaver archive exceeds download limit", { details: { maxBytes, totalBytes } });
    }
    if (response.body === null) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      enforceDownloadSize(bytes.byteLength, maxBytes);
      options.onProgress?.(Object.freeze({ phase: "download", loadedBytes: bytes.byteLength, totalBytes }));
      this.metrics.downloadedBytes += bytes.byteLength;
      return bytes;
    }
    const reader = response.body.getReader();
    /** @type {Uint8Array[]} */
    const chunks = [];
    let loadedBytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (result.value !== undefined) {
          loadedBytes += result.value.byteLength;
          enforceDownloadSize(loadedBytes, maxBytes);
          chunks.push(result.value);
          options.onProgress?.(Object.freeze({ phase: "download", loadedBytes, totalBytes }));
        }
      }
    } catch (error) {
      try { await reader.cancel(error); } catch { /* The original bounded failure remains authoritative. */ }
      throw toBeatSaverVendorError(error);
    } finally {
      reader.releaseLock();
    }
    const bytes = concatenate(chunks, loadedBytes);
    this.metrics.downloadedBytes += loadedBytes;
    return bytes;
  }

  /** @returns {BeatSaverTransportTelemetry} Immutable telemetry. */
  snapshotTelemetry() { return Object.freeze({ ...this.metrics }); }

  /**
   * @param {URL} directUrl Direct provider URL.
   * @param {{signal?: AbortSignal, accept: string}} options Options.
   * @returns {Promise<Response>} Response.
   */
  async request(directUrl, options) {
    if (directUrl.protocol !== "https:") throw new BeatSaverVendorError("invalid_request", "BeatSaver transport requires HTTPS");
    const resolved = this.proxyUrl === undefined ? directUrl : new URL(this.proxyUrl(new URL(directUrl.href)).toString());
    if (resolved.protocol !== "https:" && resolved.hostname !== "127.0.0.1" && resolved.hostname !== "localhost") {
      throw new BeatSaverVendorError("invalid_request", "Configured BeatSaver transport URL must use HTTPS");
    }
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      options.signal?.throwIfAborted();
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(new BeatSaverVendorError("timeout", "BeatSaver request timed out")), this.timeoutMs);
      const signal = combineSignals(options.signal, timeoutController.signal);
      this.metrics.requests += 1;
      try {
        const response = await this.fetch(resolved, {
          method: "GET",
          headers: { Accept: options.accept },
          signal,
          credentials: "omit",
          redirect: "follow",
          referrerPolicy: "no-referrer"
        });
        this.metrics.lastStatus = response.status;
        if (response.ok) return response;
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
          this.metrics.retries += 1;
          await response.body?.cancel();
          await delay(retryAfterMs ?? this.retryBaseMs * (2 ** attempt), options.signal);
          continue;
        }
        this.metrics.failures += 1;
        throw new BeatSaverVendorError("http", `BeatSaver request failed with HTTP ${response.status}`, {
          status: response.status,
          retryAfterMs
        });
      } catch (error) {
        if (options.signal?.aborted === true) throw new BeatSaverVendorError("aborted", "BeatSaver request was cancelled", { cause: error });
        if (timeoutController.signal.aborted) throw new BeatSaverVendorError("timeout", "BeatSaver request timed out", { cause: error });
        const stable = toBeatSaverVendorError(error);
        if (attempt < this.maxRetries && stable.code === "transport") {
          this.metrics.retries += 1;
          await delay(this.retryBaseMs * (2 ** attempt), options.signal);
          continue;
        }
        this.metrics.failures += 1;
        throw stable;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new BeatSaverVendorError("transport", "BeatSaver request exhausted retry policy");
  }
}

/** @param {AbortSignal | undefined} first @param {AbortSignal} second @returns {AbortSignal} */
function combineSignals(first, second) { return first === undefined ? second : AbortSignal.any([first, second]); }
/** @param {number} status @returns {boolean} */
function isRetryableStatus(status) { return status === 429 || status === 502 || status === 503 || status === 504; }
/** @param {string | null} value @returns {number | undefined} */
function parseRetryAfter(value) {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(60_000, Math.max(0, Math.round(seconds * 1000)));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(60_000, Math.max(0, date - Date.now())) : undefined;
}
/** @param {number} milliseconds @param {AbortSignal | undefined} signal @returns {Promise<void>} */
function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) { reject(new BeatSaverVendorError("aborted", "BeatSaver request was cancelled")); return; }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new BeatSaverVendorError("aborted", "BeatSaver request was cancelled")); }, { once: true });
  });
}
/** @param {number | undefined} value @param {number} fallback @param {number} minimum @param {number} maximum @returns {number} */
function boundedInteger(value, fallback, minimum, maximum) { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.trunc(value ?? fallback) : fallback)); }
/** @param {number} size @param {number} maximum @returns {void} */
function enforceDownloadSize(size, maximum) { if (size > maximum) throw new BeatSaverVendorError("archive", "BeatSaver archive exceeds download limit", { details: { maximum, size } }); }
/** @param {readonly Uint8Array[]} chunks @param {number} length @returns {Uint8Array} */
function concatenate(chunks, length) { const output = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; } return output; }
