// @ts-check

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  BeatSaverTransport,
  computeBeatSaverMapHash,
  createAeroBeatSaverVendorService,
  inspectBeatSaverArchive,
  normalizeMap,
  sha1Hex
} from "../src/index.js";
import { createSyntheticBeatSaverZip, createSyntheticMapPayload, syntheticBeatSaverFixtureId } from "./fixture-helpers.js";

const convergenceEvidence = await validateSourceConvergence();
const archive = createSyntheticBeatSaverZip(2);
const archiveSha1 = await sha1Hex(archive);
const hash = await computeBeatSaverMapHash(await inspectBeatSaverArchive(archive));
const mapPayload = createSyntheticMapPayload(hash);
let retryCalls = 0;
/** @type {import("../src/transport.js").BeatSaverFetch} */
const fakeFetch = async (input, init) => {
  const url = new URL(input.toString());
  init?.signal?.throwIfAborted();
  if (url.hostname === "retry.example.invalid") {
    retryCalls += 1;
    return retryCalls === 1
      ? new Response("busy", { status: 429, headers: { "retry-after": "0" } })
      : Response.json(mapPayload);
  }
  if (url.hostname === "cdn.example.invalid") {
    return new Response(archive, { status: 200, headers: { "content-length": String(archive.byteLength), "content-type": "application/zip" } });
  }
  if (url.pathname.startsWith("/search/text/")) return Response.json({ docs: [mapPayload], info: { page: 0, pages: 1, total: 1 } });
  if (url.pathname === "/maps/latest") return Response.json({ docs: [mapPayload] });
  if (url.pathname.startsWith("/maps/id/") || url.pathname.startsWith("/maps/hash/")) return Response.json(mapPayload);
  return new Response("not found", { status: 404 });
};

const service = createAeroBeatSaverVendorService({ fetch: fakeFetch, retryBaseMs: 1 });
const search = await service.searchMaps({ text: "Synthetic", difficulty: "Expert", pageSize: 10 });
assert.equal(search.maps.length, 1);
assert.equal(search.maps[0]?.mapId, "A1B2C");
assert.equal(search.maps[0]?.versions[0]?.difficulties[0]?.difficulty, "Expert");
assert.equal((await service.listLatestMaps()).maps.length, 1);
const detail = await service.getMapById("a1b2c");
assert.equal(detail.mapKey, "A1B2C");
assert.equal((await service.getMapByHash(hash)).versions[0]?.hash, hash);

/** @type {number[]} */
const progress = [];
const acquired = await service.acquireVersion(detail, hash, { onProgress: (event) => progress.push(event.loadedBytes) });
assert.equal(acquired.sourceHash, hash);
assert.equal(acquired.archiveSha1, archiveSha1);
assert.equal(acquired.source.manifest.sourceFormatMajor, 2);
assert.equal(acquired.source.manifest.audioPath, "Audio/Song.egg");
assert.equal(acquired.source.manifest.difficulties[0]?.path, "Maps/Expert.dat");
assert.deepEqual([...acquired.source.readEntry("audio/song.EGG")], [79, 103, 103, 83]);
assert.ok(progress.at(-1) === archive.byteLength);
const mismatchedMap = normalizeMap(createSyntheticMapPayload("0000000000000000000000000000000000000000"));
await assert.rejects(() => service.acquireVersion(mismatchedMap, undefined), (error) => error instanceof Error && "code" in error && error.code === "integrity");

const local = await service.importLocalArchive(new Blob([archive]));
assert.equal(local.sourceHash, hash);
assert.equal(local.archiveSha1, archiveSha1);
assert.equal(local.source.manifest.songName, "Synthetic Two");

const retryTransport = new BeatSaverTransport({ fetch: fakeFetch, maxRetries: 1, retryBaseMs: 1 });
const retryPayload = await retryTransport.getJson(new URL("https://retry.example.invalid/map"));
assert.equal(typeof retryPayload, "object");
assert.equal(retryCalls, 2);
assert.equal(retryTransport.snapshotTelemetry().retries, 1);

const aborted = new AbortController();
aborted.abort();
await assert.rejects(() => service.getMapById("a1b2c", { signal: aborted.signal }), (error) => error instanceof Error && "code" in error && error.code === "aborted");
assert.equal(service.snapshot().phase, "idle");
assert.equal(service.snapshot().capabilities.archiveInspection, true);

for (const operation of [
  () => service.getMapById(/** @type {never} */ (3)),
  () => service.searchMaps(/** @type {never} */ ({ page: Number.NaN })),
  () => service.searchMaps(/** @type {never} */ ({ text: 3 })),
  () => service.searchMaps(/** @type {never} */ ({ tags: [3] })),
  () => service.searchMaps(/** @type {never} */ ({ difficulty: 3 })),
  () => service.listLatestMaps(/** @type {never} */ ({ before: 3 }))
]) {
  await assert.rejects(operation, hasCode("invalid_request"));
}
assert.throws(() => normalizeMap(new (class ProviderClass {})()), hasCode("provider_payload"));
assert.throws(() => createAeroBeatSaverVendorService({ apiBaseUrl: "not a URL" }), hasCode("invalid_request"));
assert.throws(() => createAeroBeatSaverVendorService({ apiBaseUrl: "https://user:secret@api.example.invalid/" }), hasCode("invalid_request"));
const normalizedWithExtra = normalizeMap({ ...mapPayload, rawProviderSecret: "do-not-leak" });
assert.equal(Object.hasOwn(normalizedWithExtra, "rawProviderSecret"), false);
assert.equal(normalizedWithExtra.versions[0]?.key, "A1B2C");
assert.equal((await service.acquireVersion(detail, "a1b2c")).version.hash, hash);

assert.equal((await service.importLocalArchive(archive)).sourceHash, hash);
assert.equal((await service.importLocalArchive(archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength))).sourceHash, hash);
await assert.rejects(() => service.importLocalArchive(/** @type {never} */ ("not bytes")), hasCode("invalid_request"));

const ignoringFetch = new BeatSaverTransport({
  timeoutMs: 100,
  maxRetries: 0,
  fetch: async () => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return Response.json(mapPayload);
  }
});
const timeoutStartedAt = Date.now();
await assert.rejects(() => ignoringFetch.getJson(new URL("https://timeout.example.invalid/map")), hasCode("timeout"));
assert.ok(Date.now() - timeoutStartedAt < 140, "timeout must not trust an injected fetch that ignores AbortSignal");

const insecureRedirect = new BeatSaverTransport({ maxRetries: 0, fetch: async () => {
  const response = Response.json(mapPayload);
  Object.defineProperty(response, "url", { value: "http://redirect.example.invalid/map" });
  return response;
} });
await assert.rejects(() => insecureRedirect.getJson(new URL("https://api.example.invalid/map")), hasCode("transport"));
await assert.rejects(() => new BeatSaverTransport({ proxyUrl: () => "http://proxy.example.invalid/fetch" }).getJson(new URL("https://api.example.invalid/map")), hasCode("invalid_request"));
await assert.rejects(() => new BeatSaverTransport({ proxyUrl: () => "not a URL" }).getJson(new URL("https://api.example.invalid/map")), hasCode("invalid_request"));

/** @type {{phase: "download", loadedBytes: number, totalBytes: number | undefined} | undefined} */
let malformedLengthProgress;
const malformedLengthTransport = new BeatSaverTransport({ fetch: async () => new Response(Uint8Array.of(1, 2, 3), { headers: { "content-length": "-7" } }) });
await malformedLengthTransport.getBytes(new URL("https://cdn.example.invalid/map.zip"), { onProgress: (event) => { malformedLengthProgress = event; } });
assert.equal(malformedLengthProgress?.totalBytes, undefined);
const oversizedLengthTransport = new BeatSaverTransport({ fetch: async () => new Response(Uint8Array.of(1), { headers: { "content-length": "999" } }) });
await assert.rejects(() => oversizedLengthTransport.getBytes(new URL("https://cdn.example.invalid/map.zip"), { maxBytes: 10 }), hasCode("archive"));

const retryAbort = new AbortController();
const cappedRetryTransport = new BeatSaverTransport({ maxRetries: 1, fetch: async () => new Response("busy", { status: 429, headers: { "retry-after": "999999" } }) });
setTimeout(() => retryAbort.abort(), 10);
await assert.rejects(() => cappedRetryTransport.getJson(new URL("https://api.example.invalid/map"), { signal: retryAbort.signal }), hasCode("aborted"));
assert.equal(cappedRetryTransport.snapshotTelemetry().retries, 1);

console.log(`BeatSaver vendor service validation passed. Convergence: ${convergenceEvidence.join(", ")}`);

/** @returns {Promise<readonly string[]>} */
async function validateSourceConvergence() {
  /** @type {string[]} */
  const evidence = [];
  for (const major of /** @type {const} */ ([2, 3, 4])) {
    const fixtureId = syntheticBeatSaverFixtureId(major);
    const fixtureArchive = createSyntheticBeatSaverZip(major);
    const inspected = await inspectBeatSaverArchive(fixtureArchive);
    const sourceHash = await computeBeatSaverMapHash(inspected);
    const archiveHash = await sha1Hex(fixtureArchive);
    const mapId = `F${major}A9C`;
    const downloadUrl = `https://cdn.example.invalid/${fixtureId}.zip`;
    const providerPayload = { ...createSyntheticMapPayload(sourceHash, downloadUrl, mapId), rawProviderSecret: `forbidden-${major}` };
    /** @type {import("../src/transport.js").BeatSaverFetch} */
    const fetchFixture = async (input, init) => {
      init?.signal?.throwIfAborted();
      const url = new URL(input.toString());
      if (url.href === downloadUrl) return new Response(fixtureArchive, { headers: { "content-length": String(fixtureArchive.byteLength), "content-type": "application/zip" } });
      if (url.pathname === `/maps/id/${mapId}`) return Response.json(providerPayload);
      return new Response("not found", { status: 404 });
    };
    const fixtureService = createAeroBeatSaverVendorService({ fetch: fetchFixture, retryBaseMs: 1 });
    const providerMap = await fixtureService.getMapById(mapId);
    assert.equal(Object.hasOwn(providerMap, "rawProviderSecret"), false, `${fixtureId} must not expose provider DTO fields`);
    const online = await fixtureService.acquireVersion(providerMap, sourceHash);
    const localFixture = await fixtureService.importLocalArchive(fixtureArchive);
    assert.equal(online.version.hash, sourceHash);
    assert.equal(online.sourceHash, sourceHash);
    assert.equal(localFixture.sourceHash, sourceHash);
    assert.equal(online.archiveSha1, archiveHash);
    assert.equal(localFixture.archiveSha1, archiveHash);
    assert.deepEqual(online.source.manifest, localFixture.source.manifest);
    const onlinePaths = online.source.listEntryPaths();
    const localPaths = localFixture.source.listEntryPaths();
    assert.deepEqual(onlinePaths, localPaths);
    assert.deepEqual(onlinePaths, ["Info.dat", "Audio/Song.egg", "Cover.PNG", "Maps/Expert.dat"], `${fixtureId} paths must be deterministic`);
    for (const path of onlinePaths) {
      const onlineBytes = online.source.readEntry(path);
      const localBytes = localFixture.source.readEntry(path);
      assert.deepEqual(onlineBytes, localBytes, `${fixtureId} ${path} bytes must converge`);
      assert.equal(sha256Hex(onlineBytes), sha256Hex(localBytes));
      const entry = online.source.manifest.entries.find((candidate) => candidate.path === path);
      assert.equal(entry?.expandedBytes, onlineBytes.byteLength, `${fixtureId} ${path} length must match manifest`);
    }
    const difficulty = JSON.parse(new TextDecoder().decode(online.source.readEntry("Maps/Expert.dat")));
    assertMatchingDifficulty(major, difficulty);
    evidence.push(`${fixtureId}=source:${sourceHash}/archive:${archiveHash}`);
  }
  return Object.freeze(evidence);
}

/** @param {2 | 3 | 4} major @param {unknown} value */
function assertMatchingDifficulty(major, value) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const record = /** @type {Record<string, unknown>} */ (value);
  if (major === 2) { assert.equal(record._version, "2.6.0"); assert.ok(Array.isArray(record._notes)); return; }
  assert.equal(record.version, major === 3 ? "3.3.0" : "4.0.0");
  assert.ok(Array.isArray(record.colorNotes));
  assert.equal(Object.hasOwn(record, "colorNotesData"), major === 4);
}

/** @param {Uint8Array} bytes @returns {string} */
function sha256Hex(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
/** @param {string} code Error code. @returns {(error: unknown) => boolean} Predicate. */
function hasCode(code) { return (error) => error instanceof Error && "code" in error && error.code === code; }
