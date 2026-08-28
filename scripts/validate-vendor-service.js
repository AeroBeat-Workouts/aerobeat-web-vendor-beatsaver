// @ts-check

import assert from "node:assert/strict";
import {
  BeatSaverTransport,
  computeBeatSaverMapHash,
  createAeroBeatSaverVendorService,
  inspectBeatSaverArchive,
  normalizeMap,
  sha1Hex
} from "../src/index.js";
import { createSyntheticBeatSaverZip, createSyntheticMapPayload } from "./fixture-helpers.js";

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
console.log("BeatSaver vendor service validation passed.");
