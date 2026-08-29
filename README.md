# aerobeat-web-vendor-beatsaver

Browser BeatSaver acquisition and source-inspection adapter for AeroBeat Web.

## Responsibility

This repository owns only BeatSaver-specific browser concerns:

- request building and injected fetch/proxy transport;
- search, latest, detail-by-ID, and detail-by-hash operations;
- strict narrowing of provider DTOs into immutable camelCase records;
- explicit version/difficulty discovery and selected-version acquisition;
- provider BeatSaver/SongCore map-content SHA-1 verification and local ZIP/File intake;
- untrusted ZIP inspection and normalized Beat Saber v2/v3/v4 source manifests;
- provider status, capabilities, bounded telemetry, fixtures, and provenance.

It does **not** own product UI, AeroBeat content schemas, Boxing/Flow conversion, gameplay, scoring, audio playback, IndexedDB/library policy, assembly wiring, or redistribution of community content. `aerobeat-web-content-authoring` consumes the provider-neutral source bundle.

The corresponding Godot provider owner is `aerobeat-vendor-beatsaver`. This package preserves that ownership seam without exposing Godot types, provider DTOs, raw responses, or ZIP-library objects.

## Public API

`@aerobeat/web-vendor-beatsaver` exports:

- `createAeroBeatSaverVendorService()` / `AeroBeatSaverVendorService`;
- `BeatSaverTransport` for direct CORS, injected fetch, or configured proxy URL resolution;
- `normalizeMap()`, `normalizeMapCollection()`, and `selectVersion()`;
- `inspectBeatSaverArchive()` and `sha1Hex()`;
- stable IDs, capability truth, service marker, limits, and typed errors.

The service exposes `searchMaps`, `listLatestMaps`, `getMapById`, `getMapByHash`, `acquireVersion`, `importLocalArchive`, and `snapshot`. One instance belongs to each connected `aero-game` service graph.

## Provider-Neutral Source Bundle

Successful acquisition returns immutable normalized map/version records, the verified BeatSaver/SongCore source hash, an informational raw-archive SHA-1, and a source bundle. The provider hash is intentionally not the raw ZIP hash. Its stream begins with the exact raw downloaded `Info.dat` bytes. For v4, those bytes are followed by `audio.audioDataFilename`, then each difficulty's `beatmapDataFilename` and `lightshowDataFilename` bytes in metadata order; repeated shared references are hashed repeatedly and must not be deduplicated. v2/v3 retain their legacy metadata-ordered beatmap sequence. The manifest's `hashInputPaths` is therefore an ordered, duplicate-preserving provider-hash sequence rather than a set. The bundle exposes:

- a normalized `aerobeat.beatsaver-source-manifest.v1` manifest;
- `listEntryPaths()`;
- `readEntry(path)`, resolving names case-insensitively and returning a defensive byte copy.

The manifest includes source format major, Info.dat path, song/audio/cover metadata, supported `Standard` difficulty references, sanitized archive entries, and bounded byte counts. It contains no provider-native DTO, `Response`, archive-library object, or unrestricted raw archive handle.

## Transport

The default path uses browser `fetch` against credential-free HTTPS BeatSaver API/CDN URLs with credentials omitted. A caller may inject a fetch-compatible transport or `proxyUrl(URL)` resolver; production and final redirected URLs remain HTTPS, while HTTP is accepted only for explicit localhost proxy development. Operations accept `AbortSignal`; a package-owned race enforces deadlines even when an injected fetch ignores its signal. Downloads validate content length when present and report bounded byte progress. Timeouts, transient network failures, and HTTP 429/502/503/504 use bounded retry; 429 honors `Retry-After` up to 60 seconds.

## Archive Security Limits

Defaults are exported as `defaultBeatSaverArchiveLimits`:

- archive/download: 128 MiB;
- entry count: 2,048;
- one expanded entry: 64 MiB;
- total expanded bytes: 512 MiB;
- compression ratio: 200:1;
- Info.dat: 2 MiB.

Inspection rejects absolute paths, parent traversal, control/format characters, duplicate case-insensitive Unicode-normalized paths, invalid UTF-8 names, symlinks/special files, encryption, multi-disk/ZIP64 input, unsupported compression, malformed central/local headers, filename/method/flag/size mismatches, overlapping local ranges, malformed data descriptors, CRC corruption, entry/total/ratio excess, missing or multiple Info.dat files, missing referenced files, unsupported metadata versions, and maps without a supported `Standard` difficulty.

`fflate` 0.8.2 performs bounded per-entry streaming DEFLATE only after package-owned central-directory and local-header policy validates metadata, ranges, descriptors, and declared limits. Actual output length and CRC-32 are verified before an entry becomes readable; the implementation does not call whole-archive `unzipSync`.

## Validation

```bash
npm install
npm run check
npm test
npm run test:browser
npm pack --dry-run
```

Tests generate deterministic synthetic ZIPs in memory with matching v2/v3/v4 Info and difficulty documents. Mocked online API/CDN acquisition and local archive import must converge on the same provider-neutral manifest, source/version hash, canonical path list, entry lengths and entry byte hashes for every major. An independently hard-coded v4 golden locks raw Info, AudioData, metadata ordering, repeated shared-lightshow hashing, strict tamper rejection, and unchanged v2/v3 provider hashes. The malicious archive table exercises only the public inspector and locks its stable error code. Browser smoke performs no external request, and no third-party map/audio bytes are committed.

The normal gates are network-independent. When network access is intentionally available, `npm run test:live-v4-hash` fetches BeatSaver map `53F26` and proves its exact provider hash `addd9d6f8e7340ad6f5633947136d8475a7a99b5`; this optional live proof is not invoked by `npm test`.

## Content And Legal Boundary

Do not commit downloaded BeatSaver archives, audio, cover art, or community map payloads by default. Downloaded bytes are caller-local/transient unless a downstream approved persistence service stores them. Synthetic fixtures carry no third-party media.
