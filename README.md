# aerobeat-web-vendor-beatsaver

Browser BeatSaver acquisition and source-inspection adapter boundary for AeroBeat Web.

## Responsibility

This repository owns only BeatSaver-specific browser concerns:

- provider request/transport adapters;
- strict narrowing of BeatSaver response DTOs into documented plain records;
- selected-version acquisition from provider URLs;
- in-memory or caller-supplied storage handoff for downloaded archives;
- ZIP/source archive inspection;
- normalized source-material manifests for downstream AeroBeat import tooling;
- provider-specific status, capabilities, telemetry, fixtures, and provenance.

It does **not** own AeroBeat product browsing/install UI, canonical AeroBeat song/chart schemas, Boxing or Flow conversion, gameplay, scoring, audio playback, persistent library policy, assembly wiring, or redistribution of community maps/audio. Those responsibilities belong to product UI/content/gameplay/assembly packages and the existing offline authoring lane.

The corresponding Godot provider owner is `aerobeat-vendor-beatsaver`. This browser package ports the provider seam; it does not duplicate Godot APIs or conversion behavior.

## Scaffold Status

This commit establishes package structure and contract posture only. BeatSaver HTTP requests, DTO parsing, downloads, ZIP processing, and manifest generation are intentionally **not implemented yet**. The public export is a truthful frozen service marker whose capabilities remain `false` until the follow-up implementation Bead lands.

## Public API

`src/index.js` exports:

- `beatSaverVendorProviderId` — stable provider identity;
- `beatSaverVendorServiceId` — stable vendor-service identity;
- `beatSaverVendorFoundationId` — package/scaffold marker;
- `beatSaverVendorCapabilities` — immutable unimplemented capability truth;
- `beatSaverVendorServiceMarker` — plain documented service marker.

Public consumers must import through `@aerobeat/web-vendor-beatsaver`. Provider-native DTOs and archive-library objects must never cross the eventual public boundary.

## Repository Shape

```text
/
  src/                    public package source
  scripts/                strict validation and deterministic checks
  fixtures/               tiny synthetic/metadata-only fixtures
  assets/                 future package-owned non-community assets
  docs/decisions/         accepted provider/runtime decisions
  .testbed/               browser-only smoke/demo state
  .plans/                 repo-local execution plans
  .beads/                 repo-local Beads/Dolt ledger
```

Generated dependencies, browser reports, downloaded ZIPs, audio, Beat Saber map payloads, and staged artifacts are local state and must not be committed.

## Validation

```bash
npm install
npm run check
npm test
npm run test:browser
```

- `check` runs JavaScript type checking, JSDoc/no-escape checks, import-boundary checks, component-boundary checks, and scaffold contract checks.
- `test` adds a deterministic metadata-only fixture/unit check.
- `test:browser` serves the local placeholder demo in Playwright, verifies the public marker, and fails on browser console warnings/errors.

The browser smoke deliberately performs no network request and downloads no BeatSaver content.

## Content And Legal Boundary

Do not commit downloaded BeatSaver archives, audio, cover art, or community map payloads by default. Deterministic tests must use tiny synthetic or metadata-only fixtures unless redistribution rights are explicitly documented. A future implementation must keep provider terms, map-level rights, CORS, integrity, size limits, cancellation, and untrusted-archive handling explicit.
