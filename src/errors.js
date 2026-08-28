// @ts-check

/**
 * Stable vendor error categories suitable for UI and telemetry.
 *
 * @typedef {"invalid_request" | "transport" | "timeout" | "aborted" | "http" | "provider_payload" | "integrity" | "archive" | "unsupported"} BeatSaverVendorErrorCode
 */

/**
 * Typed public error without provider DTO or archive-library leakage.
 */
export class BeatSaverVendorError extends Error {
  /**
   * @param {BeatSaverVendorErrorCode} code Stable category.
   * @param {string} message Human-readable message.
   * @param {{status?: number, retryAfterMs?: number, cause?: unknown, details?: Readonly<Record<string, string | number | boolean>>}} [options] Error context.
   */
  constructor(code, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BeatSaverVendorError";
    /** @type {BeatSaverVendorErrorCode} */
    this.code = code;
    /** @type {number | undefined} */
    this.status = options.status;
    /** @type {number | undefined} */
    this.retryAfterMs = options.retryAfterMs;
    /** @type {Readonly<Record<string, string | number | boolean>>} */
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }
}

/**
 * Convert unknown failures to the stable public error shape.
 *
 * @param {unknown} error Unknown thrown value.
 * @returns {BeatSaverVendorError} Stable error.
 */
export function toBeatSaverVendorError(error) {
  if (error instanceof BeatSaverVendorError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new BeatSaverVendorError("aborted", "BeatSaver operation was cancelled", { cause: error });
  }
  if (error instanceof Error) {
    return new BeatSaverVendorError("transport", error.message, { cause: error });
  }
  return new BeatSaverVendorError("transport", "Unknown BeatSaver operation failure");
}
