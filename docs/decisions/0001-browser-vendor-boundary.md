# Decision 0001: Browser BeatSaver Vendor Boundary

**Status:** Accepted for scaffold

## Decision

`aerobeat-web-vendor-beatsaver` is the replaceable browser-specific BeatSaver provider seam. It may own provider transport, response DTO narrowing, selected-version acquisition, archive inspection, and normalized source-material manifests.

It does not own product UI, canonical AeroBeat content contracts, Boxing/Flow conversion, gameplay, library persistence policy, assembly wiring, or community-content redistribution policy.

The initial public surface is a truthful service marker with every executable capability set to `false`. API and archive behavior must land through the linked implementation Bead with deterministic metadata-only fixtures and explicit untrusted-input controls.

## Consequences

- No provider-native DTO or archive-library object may cross the public boundary.
- No downloaded map/audio archive may be committed by default.
- Browser acquisition remains distinct from the existing Godot provider implementation while preserving the same ownership boundary.
- Product packages consume normalized plain records through public exports only.
