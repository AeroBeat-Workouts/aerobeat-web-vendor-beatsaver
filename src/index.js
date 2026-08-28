// @ts-check

/**
 * Stable BeatSaver provider identifier.
 *
 * @type {"beatsaver"}
 */
export const beatSaverVendorProviderId = "beatsaver";

/**
 * Stable browser vendor-service identifier.
 *
 * @type {"aero.vendor.beatsaver"}
 */
export const beatSaverVendorServiceId = "aero.vendor.beatsaver";

/**
 * Package foundation marker. This is not an implementation-version claim.
 *
 * @type {"aero.web-vendor-beatsaver.foundation.v1"}
 */
export const beatSaverVendorFoundationId = "aero.web-vendor-beatsaver.foundation.v1";

/**
 * Truthful scaffold capabilities. A later implementation changes these only
 * alongside executable provider behavior and contract coverage.
 *
 * @type {Readonly<{
 *   transport: false,
 *   dtoNormalization: false,
 *   acquisition: false,
 *   archiveInspection: false
 * }>}
 */
export const beatSaverVendorCapabilities = Object.freeze({
  transport: false,
  dtoNormalization: false,
  acquisition: false,
  archiveInspection: false
});

/**
 * Plain public service marker for assembly/package discovery.
 *
 * @typedef {Object} BeatSaverVendorServiceMarker
 * @property {typeof beatSaverVendorServiceId} serviceId Stable service ID.
 * @property {typeof beatSaverVendorProviderId} providerId Stable provider ID.
 * @property {typeof beatSaverVendorFoundationId} foundationId Package marker.
 * @property {"scaffold"} implementationStatus Truthful implementation status.
 * @property {typeof beatSaverVendorCapabilities} capabilities Current capabilities.
 */

/** @type {Readonly<BeatSaverVendorServiceMarker>} */
export const beatSaverVendorServiceMarker = Object.freeze({
  serviceId: beatSaverVendorServiceId,
  providerId: beatSaverVendorProviderId,
  foundationId: beatSaverVendorFoundationId,
  implementationStatus: "scaffold",
  capabilities: beatSaverVendorCapabilities
});
