# aerobeat-web-vendor-beatsaver

Browser BeatSaver acquisition and source-inspection adapter for AeroBeat Web.

## Responsibility

This repository owns only BeatSaver-specific browser concerns:

- request building and injected fetch/proxy transport;
- search, latest, detail-by-ID, and detail-by-hash operations;
- strict narrowing of provider DTOs into immutable camelCase records, including bounded finite browse/cross-check NJS and offset;
- explicit version/difficulty discovery and selected-version acquisition;
- provider BeatSaver/SongCore map-content SHA-1 verification and local ZIP/File intake through the shared `@aerobeat/web-hash` owner;
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

- a normalized `aerobeat.beatsaver-source-manifest.v2` manifest (the format/palette migration intentionally replaces v1 rather than silently changing it);
- `listEntryPaths()`;
- `readEntry(path)`, resolving names case-insensitively and returning a defensive byte copy.

The manifest records Info.dat independently as `infoFormatMajor`/`infoFormat` (`v2` or `v4`) and exact declared `infoVersion` (or `null` only for versionless shape inference). Every playable difficulty records exact finite positive `noteJumpMovementSpeed` and finite `noteJumpStartBeatOffset` from its version-bound Info.dat entry; malformed camel fields fall back only to independently valid legacy underscore fields and missing/invalid authority never becomes zero. Every playable difficulty also records its independently parsed `beatMapFormatMajor`/`beatMapFormat` (`v2`, `v3`, or `v4`) and exact declared `beatMapVersion` (or `null` for versionless inference). This captures the public legacy-Info/v3-beatmap combination without inventing an Info v3 family. If either own JSON data key `version` or `_version` is present, every declaration must be a complete supported ASCII-numeric semantic triplet; dual declarations must resolve to the same major. Malformed, wrong-type, unsupported, conflicting, or Info/difficulty-incompatible declarations fail with `unsupported` before conversion. V4.1 beatmaps carrying relative NJS events fail closed with `relative_njs_events_unsupported` in this slice.

Each exact `Standard` difficulty also carries `notePalette`, validated by `@aerobeat/web-contracts`, or `null`. Info 2.0 uses only `_customData._colorLeft/_colorRight`; Info 2.1 activates an in-range official scheme only for exact `useOverride === true`; Info 4.0.0 treats an in-range scheme as an implicit note override; Info 4.0.1+ requires exact `overrideNotes === true`. Active official authority suppresses custom data even when either official side is invalid. Otherwise only the schema-exact custom pair is eligible. Object colors must be own ordinary enumerable data objects with exactly RGB or RGBA keys (official Info 2.1 schemes require RGBA), finite normalized channels, and opaque alpha. V4 official colors must be exact eight-digit `RRGGBBAA` with `FF` alpha. There is no clamping, 0–255 inference, repair, gamma transform, environment lookup, or API-metadata authority. Valid pairs contain only canonical uppercase sRGB tokens and bounded allowlisted provenance with exact Info/difficulty SHA-256; invalid/missing pairs remain `null` so consumers atomically apply the shared `#2693FF`/`#39C96B` defaults.

Difficulty spelling/separator aliases normalize to canonical Easy, Normal, Hard, Expert, ExpertPlus identities so duplicates fail deterministically; unsupported Standard labels fail instead of disappearing. Nonstandard characteristics never become playable manifest entries, but remain in provider hash inputs where the BeatSaver format requires them. The manifest contains no provider-native DTO, `Response`, archive-library object, raw custom-data object, or unrestricted raw archive handle.

## Transport

The default path uses browser `fetch` against credential-free HTTPS BeatSaver API/CDN URLs with credentials omitted. Raw archives and ordered provider streams use the shared incremental SHA-1 implementation, avoiding an additional whole-archive hash copy; bounded public `sha1Hex()` uses the shared automatic native/fallback helper. Hash implementation failures are reported as bounded `integrity` errors rather than transport failures. A caller may inject a fetch-compatible transport or `proxyUrl(URL)` resolver; production and final redirected URLs remain HTTPS, while HTTP is accepted only for explicit localhost proxy development. Operations accept `AbortSignal`; a package-owned race enforces deadlines even when an injected fetch ignores its signal. Downloads validate content length when present and report bounded byte progress. Timeouts, transient network failures, and HTTP 429/502/503/504 use bounded retry; 429 honors `Retry-After` up to 60 seconds.

## Archive Security Limits

Defaults are exported as `defaultBeatSaverArchiveLimits`:

- archive/download: 128 MiB;
- entry count: 2,048;
- one expanded entry: 64 MiB;
- total expanded bytes: 512 MiB;
- compression ratio: 200:1;
- Info.dat: 2 MiB.

Inspection rejects absolute paths, parent traversal, control/format characters, duplicate case-insensitive Unicode-normalized paths, invalid UTF-8 names, symlinks/special files, encryption, multi-disk/ZIP64 input, unsupported compression, malformed central/local headers, filename/method/flag/size mismatches, overlapping local ranges, malformed data descriptors, CRC corruption, entry/total/ratio excess, missing or multiple Info.dat files, missing referenced files, unsupported metadata versions, duplicate normalized Standard difficulty identities, unsupported Standard difficulty labels, and maps without a supported exact-`Standard` difficulty.

`fflate` 0.8.2 performs bounded per-entry streaming DEFLATE only after package-owned central-directory and local-header policy validates metadata, ranges, descriptors, and declared limits. Actual output length and CRC-32 are verified before an entry becomes readable; the implementation does not call whole-archive `unzipSync`.

## Validation

```bash
npm install
npm run check
npm test
npm run test:browser
npm run test:cached-palette-oracle # when local cached public-map archives are available
npm pack --dry-run --json
```

Tests generate deterministic synthetic ZIPs in memory for Info v2/v4 and independently referenced v2/v3/v4 difficulty documents. Mocked online API/CDN acquisition and local archive import must converge on the same provider-neutral manifest, source/version hash, canonical path list, entry lengths and entry byte hashes for every major. Mixed v3/v4 fixtures combine canonically unordered Standard entries with Lightshow, OneSaber, NoArrows, and repeated shared-lightshow references: only Standard becomes playable while the independently enumerated whole-version provider hash stream remains exact. An independently hard-coded v4 golden locks raw Info, AudioData, metadata ordering, repeated shared-lightshow hashing, strict tamper rejection, and unchanged v2/v3 provider hashes. The malicious archive table exercises only the public inspector and locks its stable error code. Browser validation performs no external request and uses only the deterministic synthetic ZIP contract. It first asserts secure localhost WebCrypto presence and genuine non-loopback Tailscale-style HTTP WebCrypto absence, then exercises actual service download and local `Blob` ZIP hashing/inspection with identical locked provider/raw identities and native/fallback parity. No third-party map/audio bytes are committed.

The normal gates are network-independent. `npm run test:cached-palette-oracle` reads caller-local cached archives (never committed) for public maps `4858` and `3D44B`, locks their archive/Info/difficulty SHA-256 values, proves separate Info/difficulty formats, and checks strict palette outcomes. `AEROBEAT_4858_ARCHIVE` and `AEROBEAT_3D44B_ARCHIVE` override the default sibling-testbed paths. When network access is intentionally available, `npm run test:live-v4-hash` transiently fetches BeatSaver map `53F26` and proves its exact provider hash `addd9d6f8e7340ad6f5633947136d8475a7a99b5`, separate v4 Info/difficulty versions, exact SHA-256 provenance, and strict palette; this optional live proof is not invoked by `npm test`.

## Content And Legal Boundary

Do not commit downloaded BeatSaver archives, audio, cover art, or community map payloads by default. Downloaded bytes are caller-local/transient unless a downstream approved persistence service stores them. Synthetic fixtures carry no third-party media.
