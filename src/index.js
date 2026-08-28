// @ts-check

export { BeatSaverVendorError, toBeatSaverVendorError } from "./errors.js";
export {
  buildLatestParameters,
  buildSearchParameters,
  normalizeMap,
  normalizeMapCollection,
  selectVersion
} from "./normalize.js";
export { BeatSaverTransport } from "./transport.js";
export {
  computeBeatSaverMapHash,
  defaultBeatSaverArchiveLimits,
  inspectBeatSaverArchive,
  normalizeEntryPath,
  sha1Hex
} from "./archive.js";
export { AeroBeatSaverVendorService, beatSaverVendorCapabilities } from "./service.js";

import { AeroBeatSaverVendorService, beatSaverVendorCapabilities } from "./service.js";

/** Stable BeatSaver provider identifier. @type {"beatsaver"} */
export const beatSaverVendorProviderId = "beatsaver";
/** Stable browser vendor-service identifier. @type {"aero.vendor.beatsaver"} */
export const beatSaverVendorServiceId = "aero.vendor.beatsaver";
/** Implemented contract marker. @type {"aero.web-vendor-beatsaver.v1"} */
export const beatSaverVendorContractId = "aero.web-vendor-beatsaver.v1";

/**
 * Plain discovery marker; service state lives in created instances.
 *
 * @type {Readonly<{
 *   serviceId: typeof beatSaverVendorServiceId,
 *   providerId: typeof beatSaverVendorProviderId,
 *   contractId: typeof beatSaverVendorContractId,
 *   implementationStatus: "implemented",
 *   capabilities: typeof beatSaverVendorCapabilities
 * }>}
 */
export const beatSaverVendorServiceMarker = Object.freeze({
  serviceId: beatSaverVendorServiceId,
  providerId: beatSaverVendorProviderId,
  contractId: beatSaverVendorContractId,
  implementationStatus: "implemented",
  capabilities: beatSaverVendorCapabilities
});

/**
 * Create one vendor service for an `aero-game` instance.
 *
 * @param {ConstructorParameters<typeof AeroBeatSaverVendorService>[0]} [options] Service options.
 * @returns {AeroBeatSaverVendorService} Service.
 */
export function createAeroBeatSaverVendorService(options) {
  return new AeroBeatSaverVendorService(options);
}
