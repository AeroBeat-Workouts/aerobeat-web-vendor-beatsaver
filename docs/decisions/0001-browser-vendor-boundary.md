# Decision 0001: Browser BeatSaver Vendor Boundary

**Status:** Accepted and implemented

## Decision

`aerobeat-web-vendor-beatsaver` is the replaceable browser-specific BeatSaver provider seam. It owns provider transport, strict response DTO narrowing, selected-version acquisition, BeatSaver/SongCore map-content SHA-1 verification, local ZIP intake, archive inspection, and provider-neutral source-material bundles.

It does not own product UI, canonical AeroBeat content contracts, Boxing/Flow conversion, gameplay, library persistence policy, assembly wiring, or community-content redistribution policy.

Direct credential-free CORS is the default transport. Fetch and proxy-URL resolution remain injected seams because third-party CORS and availability can change. A local archive path provides product recovery without weakening the same verification/inspection boundary.

## Archive decision

`fflate` 0.8.2 is the only runtime dependency. Package-owned code validates ZIP central records, matching local headers, non-overlapping compressed ranges, optional data descriptors, Unicode-normalized paths, declared limits, actual expanded lengths, and CRC-32 before exposing entries. DEFLATE runs one entry at a time through bounded streaming input rather than whole-archive allocation. Acquisition enforces credential-free HTTPS (with an explicit loopback-only proxy development seam), including the final redirected URL.

The downstream contract is a closure-backed source bundle with immutable metadata and defensive per-entry reads. It does not expose the original archive, `Response`, provider DTO, or `fflate` object.

## Consequences

- No provider-native DTO or archive-library object crosses the public boundary.
- No downloaded map/audio archive is committed by default.
- Browser acquisition remains distinct from the Godot implementation while sharing golden fixtures and ownership semantics.
- `aerobeat-web-content-authoring` consumes normalized source manifests and selected entry bytes.
- Changing ZIP libraries cannot change the public source-bundle contract.
