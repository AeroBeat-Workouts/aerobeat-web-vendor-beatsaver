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
import { sha1ArchiveHex } from "../src/archive.js";
import {
  createMixedCharacteristicBeatSaverZip,
  createSyntheticBeatSaverZip,
  createSyntheticMapPayload,
  createV4ProviderHashGoldenZip,
  syntheticBeatSaverFixtureId,
  v4ProviderHashGoldenExpected,
  v4ProviderHashGoldenInfo
} from "./fixture-helpers.js";

const archive = createSyntheticBeatSaverZip(2);
const archiveSha1 = await sha1Hex(archive);
const hash = await computeBeatSaverMapHash(await inspectBeatSaverArchive(archive));
const mapPayload = createSyntheticMapPayload(hash);
const rangedBacking = Uint8Array.of(9, 9, 0, 128, 255, 9);
assert.equal(await sha1Hex(rangedBacking.subarray(2, 5)), createHash("sha1").update(rangedBacking.subarray(2, 5)).digest("hex"), "shared helper must hash only the visible typed-array range");
const largeHashInput = new Uint8Array((8 * 1024 * 1024) + 13);
for (let index = 0; index < largeHashInput.byteLength; index += 1) largeHashInput[index] = index & 0xff;
assert.equal(sha1ArchiveHex(largeHashInput), createHash("sha1").update(largeHashInput).digest("hex"), "incremental archive hashing must preserve a representative large exact byte stream");
await assert.rejects(() => sha1Hex(/** @type {never} */ ({})), (error) => {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "integrity" || error.message !== "BeatSaver integrity verification failed") return false;
  assert.doesNotMatch(error.message, /crypto|digest|subtle|backend/iu);
  return true;
}, "hash implementation failures must be bounded integrity errors, never misleading transport internals");
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

const v4GoldenArchive = createV4ProviderHashGoldenZip();
const v4GoldenSource = await inspectBeatSaverArchive(v4GoldenArchive);
assert.equal(new TextDecoder().decode(v4GoldenSource.readEntry("Info.dat")), v4ProviderHashGoldenInfo, "provider hash must begin with exact raw downloaded Info.dat bytes");
assert.deepEqual(v4GoldenSource.manifest.hashInputPaths, [
  "AudioData.dat",
  "EasyLightshow.dat",
  "SharedLightshow.dat",
  "ExpertPlusStandard.dat",
  "SharedLightshow.dat"
], "v4 manifest must expose ordered duplicate-preserving provider hash inputs");
assert.equal(v4GoldenSource.manifest.hashInputPaths.filter((path) => path === "SharedLightshow.dat").length, 2);
assert.equal(await computeBeatSaverMapHash(v4GoldenSource), v4ProviderHashGoldenExpected, "v4 provider golden must match independently hard-coded SHA-1");
const v4GoldenDownloadUrl = "https://cdn.example.invalid/v4-provider-hash-golden.zip";
const v4GoldenMap = normalizeMap(createSyntheticMapPayload(v4ProviderHashGoldenExpected, v4GoldenDownloadUrl, "V4GOLD"));
const v4GoldenService = createAeroBeatSaverVendorService({ fetch: async () => new Response(v4GoldenArchive) });
assert.equal((await v4GoldenService.acquireVersion(v4GoldenMap, v4ProviderHashGoldenExpected)).sourceHash, v4ProviderHashGoldenExpected);
const tamperedV4Service = createAeroBeatSaverVendorService({ fetch: async () => new Response(createV4ProviderHashGoldenZip({ tamperAudioData: true })) });
await assert.rejects(() => tamperedV4Service.acquireVersion(v4GoldenMap, v4ProviderHashGoldenExpected), (error) => {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "integrity" || !("details" in error)) return false;
  const details = /** @type {{expectedHash?: unknown, actualHash?: unknown}} */ (error.details);
  return details.expectedHash === v4ProviderHashGoldenExpected && typeof details.actualHash === "string" && details.actualHash !== v4ProviderHashGoldenExpected;
}, "tampering any hashed v4 input must fail strict expectedHash comparison");

const mixedExpectedInputs = {
  3: ["Maps/Lightshow.dat", "Maps/SharedLightshow.dat", "Maps/OneSaber.dat", "Maps/NoArrows.dat", "Maps/ExpertPlus.dat", "Maps/Easy.dat", "Maps/Hard.dat"],
  4: ["Audio/AudioData.dat", "Maps/Lightshow.dat", "Maps/SharedLightshow.dat", "Maps/ExpertPlus.dat", "Maps/SharedLightshow.dat", "Maps/OneSaber.dat", "Maps/SharedLightshow.dat", "Maps/Easy.dat", "Maps/SharedLightshow.dat", "Maps/NoArrows.dat", "Maps/SharedLightshow.dat", "Maps/Hard.dat", "Maps/SharedLightshow.dat"]
};
for (const major of /** @type {const} */ ([3, 4])) {
  const mixedArchive = createMixedCharacteristicBeatSaverZip(major);
  const mixedSource = await inspectBeatSaverArchive(mixedArchive);
  const expectedInputs = mixedExpectedInputs[major];
  assert.deepEqual(mixedSource.manifest.difficulties.map((entry) => [entry.characteristic, entry.difficulty]), [["Standard", "Easy"], ["Standard", "Hard"], ["Standard", "ExpertPlus"]], `v${major} playable catalog must contain only canonically ordered Standard difficulties`);
  assert.deepEqual(mixedSource.manifest.hashInputPaths, expectedInputs, `v${major} provider hash inputs must retain ignored characteristics and shared lightshows`);
  const independentHash = createHash("sha1");
  independentHash.update(mixedSource.readEntry(mixedSource.manifest.infoPath));
  for (const path of expectedInputs) independentHash.update(mixedSource.readEntry(path));
  assert.equal(await computeBeatSaverMapHash(mixedSource), independentHash.digest("hex"), `v${major} provider hash must retain the independently enumerated whole-version stream`);
}

const mixedAcquireArchive = createMixedCharacteristicBeatSaverZip(4);
const mixedAcquireSource = await inspectBeatSaverArchive(mixedAcquireArchive);
const mixedAcquireHash = await computeBeatSaverMapHash(mixedAcquireSource);
let mixedAcquireFetches = 0;
const mixedAcquireService = createAeroBeatSaverVendorService({ fetch: async () => { mixedAcquireFetches += 1; return new Response(mixedAcquireArchive, { status: 200, headers: { "content-length": String(mixedAcquireArchive.byteLength), "content-type": "application/zip" } }); } });
const mixedAcquireMap = normalizeMap(createSyntheticMapPayload(mixedAcquireHash, "https://cdn.example.invalid/mixed-v4.zip", "MIXEDV4"));
const mixedAcquired = await mixedAcquireService.acquireVersion(mixedAcquireMap, mixedAcquireHash);
assert.equal(mixedAcquireFetches, 1, "whole-version acquisition must fetch the mixed archive exactly once");
assert.deepEqual(mixedAcquired.source.manifest.difficulties.map((entry) => entry.difficulty), ["Easy", "Hard", "ExpertPlus"]);
assert.equal(JSON.stringify(mixedAcquireService.snapshot()).includes("Uint8Array"), false, "vendor snapshot must not expose acquired archive bytes");

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

/** @type {Readonly<Record<2 | 3 | 4, Readonly<{sourceHash: string, archiveSha1: string, entries: Readonly<Record<string, string>>}>>>} */
const lockedFixtureHashes = Object.freeze({
  2: Object.freeze({
    sourceHash: "f8ed950c666baf9148a18e5f3b9731b3f2f23cb0",
    archiveSha1: "c3f76b20a55d917595c4b741519fb8e274001f83",
    entries: Object.freeze({
      "Info.dat": "af1c856675a67b2541d2e20315bbceb155f724e859402e1c75ec00214f1c9c64",
      "Audio/Song.egg": "68d9ed2adb24458ff173db06b41b9d1b6e228764c457030d63fad11b02bfae1e",
      "Cover.PNG": "0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543",
      "Maps/Expert.dat": "bc76dba91a1f6392db878a0e3aa9d8e51cb8e152772af7288a48603241236a42"
    })
  }),
  3: Object.freeze({
    sourceHash: "f40cee1a11222c29ccdabb3193c83b9d25a837a4",
    archiveSha1: "1b8f83e061f3c7138c25a4bc5733a845cad6884d",
    entries: Object.freeze({
      "Info.dat": "56c846c06f9989bc0a29e21173e8897334efc56a766594c0c4587a04625ae9c1",
      "Audio/Song.egg": "68d9ed2adb24458ff173db06b41b9d1b6e228764c457030d63fad11b02bfae1e",
      "Cover.PNG": "0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543",
      "Maps/Expert.dat": "fe7429c7d72f85a1c92151a845925c3dc0560ea44d5f266fedfaae8b74547758"
    })
  }),
  4: Object.freeze({
    sourceHash: "40035da7af6e521f3a02c54dcdfc8eb4366c6412",
    archiveSha1: "7c586a16f10500d3dda5c84a8dae7dbe46a95bb5",
    entries: Object.freeze({
      "Info.dat": "299ff0523f4f19d811c8138630cf2c0465df016589973989fb2341e7e2ee0af1",
      "Audio/Song.egg": "68d9ed2adb24458ff173db06b41b9d1b6e228764c457030d63fad11b02bfae1e",
      "Cover.PNG": "0f4636c78f65d3639ece5a064b5ae753e3408614a14fb18ab4d7540d2c248543",
      "Maps/Expert.dat": "6f4580181ca3942ed495cf2c96adc8fc608250b4b6626dd4b69ea2f063529609",
      "Audio/AudioData.dat": "b09decf9a4246f653478d739f6a64cbcdbbc63d5bb9460c7f5b26e28142a5199"
    })
  })
});

const convergenceEvidence = await validateSourceConvergence();
console.log(`BeatSaver vendor service validation passed. Convergence: ${convergenceEvidence.join(", ")}`);

/** @returns {Promise<readonly string[]>} */
async function validateSourceConvergence() {
  const majors = /** @type {const} */ ([2, 3, 4]);
  const firstArchives = new Map(majors.map((major) => [major, createSyntheticBeatSaverZip(major)]));
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  const delayedArchives = new Map(majors.map((major) => [major, createSyntheticBeatSaverZip(major)]));
  /** @type {string[]} */
  const evidence = [];
  for (const major of majors) {
    const fixtureId = syntheticBeatSaverFixtureId(major);
    const fixtureArchive = firstArchives.get(major);
    const delayedArchive = delayedArchives.get(major);
    assert.ok(fixtureArchive && delayedArchive);
    assert.deepEqual(fixtureArchive, delayedArchive, `${fixtureId} must be byte-identical across delayed independent generation`);
    const inspected = await inspectBeatSaverArchive(fixtureArchive);
    const sourceHash = await computeBeatSaverMapHash(inspected);
    const archiveHash = await sha1Hex(fixtureArchive);
    assert.equal(sourceHash, lockedFixtureHashes[major].sourceHash, `${fixtureId} provider source SHA-1 must remain locked`);
    assert.equal(archiveHash, lockedFixtureHashes[major].archiveSha1, `${fixtureId} archive SHA-1 must remain locked`);
    assert.equal(await sha1Hex(delayedArchive), archiveHash);
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
    const expectedPaths = major === 4
      ? ["Info.dat", "Audio/Song.egg", "Cover.PNG", "Maps/Expert.dat", "Audio/AudioData.dat"]
      : ["Info.dat", "Audio/Song.egg", "Cover.PNG", "Maps/Expert.dat"];
    assert.deepEqual(onlinePaths, expectedPaths, `${fixtureId} paths must be deterministic`);
    for (const path of onlinePaths) {
      const onlineBytes = online.source.readEntry(path);
      const localBytes = localFixture.source.readEntry(path);
      assert.deepEqual(onlineBytes, localBytes, `${fixtureId} ${path} bytes must converge`);
      const entryHash = sha256Hex(onlineBytes);
      assert.equal(entryHash, sha256Hex(localBytes));
      assert.equal(entryHash, lockedFixtureHashes[major].entries[path], `${fixtureId} ${path} SHA-256 must remain locked`);
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
