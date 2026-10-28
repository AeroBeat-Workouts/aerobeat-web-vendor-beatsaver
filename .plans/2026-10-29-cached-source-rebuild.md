# Rebuild a source interface from cached entries

Status: shipped in 0.0.149 (vendor `0273ee4`).

## Why

Reimport for a song imported from a local ZIP file has no provider to download from again. The
archive itself is not kept, so the only material that can rebuild the song is what import already
persists: `Info.dat`, every Standard difficulty, and the audio asset.

## What changed

`rebuildSourceFromEntries(entries)` turns cached bytes into the same source bundle shape
`inspectBeatSaverArchive` produces, so the rest of the pipeline (conversion, manifest validation,
provider version hash) runs unchanged. It returns the identical provider version hash, Info and
difficulty paths, beatmap formats, spawn timing and note palettes for Beat Saber v2, v3 and v4 Info
families; `scripts/validate-cached-source-rebuild.js` pins that parity and the rejection cases
(no Info.dat, two Info.dat entries, case-colliding paths, parent paths, empty entry, missing audio).

The cover image is not a conversion input and is never cached. `buildSourceManifest` therefore
accepts a missing cover for a rebuilt source and resolves `coverPath` to an empty string instead of
failing the rebuild.

The vendor service exposes both steps (`rebuildSourceFromEntries`, `computeBeatSaverMapHash`) so the
assembly never reaches into module internals.

## Deliberate limits

- A cached source reproduces the map hash only when every source-hash input is cached. Beat Saber v4
  hashes its audio data and lightshow files, so the authoring side caches those too when they fit the
  cache entry bound (2 MB). A v4 map whose audio data exceeds that bound reports an incomplete stored
  source and asks for the ZIP file again instead of reimporting something that may not match.
- `archiveBytes`/`expandedBytes` describe the cached bytes, not the original archive, because the
  original archive is not stored. Nothing downstream reads those two fields to decide behaviour.

## Verification

- `npm test` (vendor): typecheck, JSDoc, imports, components, contract, and the new rebuild parity test.
- Real maps: "On My Knees" (`/tmp/omk/map-full.zip`) and "Numb" (`/tmp/numb/numb.zip`) both rebuild to
  their exact original map hash (`992b0f3…` and `2e6f858…`) with identical difficulty identity.
