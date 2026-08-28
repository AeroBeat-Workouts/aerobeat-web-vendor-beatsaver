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

Successful acquisition returns immutable normalized map/version records, the verified BeatSaver/SongCore source hash, an informational raw-archive SHA-1, and a source bundle. The provider hash is computed over the exact Info.dat bytes followed by every referenced beatmap (and v4 lightshow) file in metadata order; it is intentionally not the raw ZIP hash. The bundle exposes:

- a normalized `aerobeat.beatsaver-source-manifest.v1` manifest;
- `listEntryPaths()`;
- `readEntry(path)`, resolving names case-insensitively and returning a defensive byte copy.

The manifest includes source format major, Info.dat path, song/audio/cover metadata, supported `Standard` difficulty references, sanitized archive entries, and bounded byte counts. It contains no provider-native DTO, `Response`, archive-library object, or unrestricted raw archive handle.

## Transport

The default path uses browser `fetch` against HTTPS BeatSaver API/CDN URLs with credentials omitted. A caller may inject a fetch-compatible transport or `proxyUrl(URL)` resolver. Operations accept `AbortSignal`; downloads report bounded byte progress. Timeouts, transient network failures, and HTTP 429/502/503/504 use bounded retry; 429 honors `Retry-After` up to 60 seconds.

## Archive Security Limits

Defaults are exported as `defaultBeatSaverArchiveLimits`:

- archive/download: 128 MiB;
- entry count: 2,048;
- one expanded entry: 64 MiB;
- total expanded bytes: 512 MiB;
- compression ratio: 200:1;
- Info.dat: 2 MiB.

Inspection rejects absolute paths, parent traversal, duplicate case-insensitive normalized paths, invalid UTF-8 names, symlinks, encryption, multi-disk/ZIP64 input, unsupported compression, malformed central directories, entry/total/ratio excess, missing or multiple Info.dat files, missing referenced files, unsupported metadata versions, and maps without a supported `Standard` difficulty.

`fflate` 0.8.2 performs decompression only after the package-owned central-directory policy validates metadata and limits.

## Validation

```bash
npm install
npm run check
npm test
npm run test:browser
npm pack --dry-run
```

Tests generate metadata-only ZIPs in memory for v2/v3/v4 and malicious cases. Browser smoke performs no external request and commits no map/audio data.

## Content And Legal Boundary

Do not commit downloaded BeatSaver archives, audio, cover art, or community map payloads by default. Downloaded bytes are caller-local/transient unless a downstream approved persistence service stores them. Synthetic fixtures carry no third-party media.
