# Sonic Heroes note jump speed import repair

Status: implemented and verified; committed for parent review, not pushed.
Owner: delegated coder. Bead: aerobeat-web-assembly-gili (claimed).
Parent: ../aerobeat-web-assembly/.plans/2026-11-04-playtest-bug-batch.md (approved immediate execution).

## Current decision and next check

Parent authorized correcting the actual zero-sentinel failure after the original absent-only diagnosis proved wrong. Parent reviews this owner commit, then owns push permission, repin, signed assembly integration and live publication. No assembly source, UI, scorer or gates changed.

## Tasks and results

1. Reproduce and verify fallback: complete. Real BeatSaver map `2fa8c`, provider hash `fb09ccd3edeb747ee3735a01824234d5c31fb9a1`, is exactly the named Sonic Heroes song. Info 2.0.0 explicitly sets Standard Easy speed to zero. Real service acquisition previously failed with `provider_payload: Standard difficulty note jump movement speed must be positive`.
2. Small correction and regression: complete. `src/archive.js` resolves absent or numeric-zero speed to Easy/Normal/Hard 10, Expert 12, ExpertPlus 16. Explicit positive speed, valid legacy alias fallback, negative/malformed/nonfinite rejection and offset validation remain unchanged. `scripts/validate-note-jump-speed-defaults.js` is wired into `npm test`: 45 family/difficulty/value rows through inspection, acquisition and local import, plus invalid and alias cases. Nonfinite exponent overflow is tested as raw JSON rather than serialized null.
3. Validation and documentation: complete. `npm test`, `npm run test:browser`, and `npm run test:live-sonic-heroes` passed. Live test downloads the real provider archive, verifies its pinned provider hash and raw Easy zero, then observes normalized Easy 10, Expert 16 and ExpertPlus 18. README and `docs/decisions/note-jump-speed-defaults.md` describe behavior, source evidence and the repeatable checks.

## Diagnosis and corrected scope

Execution path: service acquisition downloads the real archive; manifest parsing visits Standard Easy; the old positive-finite helper reads explicit zero and rejects the entire map. Transport failure, absent speed and a search mismatch were ruled out by real acquisition and raw archive inspection. No unsuccessful production fixes preceded the diagnosis. Parent explicitly authorized the corrected zero-as-default scope; the earlier requirement to reject zero was a mistaken premise, not a product safety gate.

## Verified reference sources

Pinned ChroMapper revision `0d67a67d9b6ee750c412660a43ce34aa889378ae` `InfoDifficulty.NoteJumpSpeed` defines the zero fallback by difficulty rank. Both `V2Info.cs` and `V4Info.cs` read into this same resolver, so there is no metadata-family split in that implementation. Parent explicitly accepted bsmap 2.3.5's documented implementation as the bounded compatibility contract: release gitHead `3879da9498a1d52e0932adec20b7fc0c17cc3413`, `src/beatmap/helpers/njs.ts` lines 28–44, specifies and implements the same null/zero table. Native-game-version numeric parity is not independently established and is not a blocker under this disposition. SongCore patches the game's `BeatmapDifficultyMethods.NoteJumpMovementSpeed` and documents game defaulting for nonpositive values. Full source links and limits are in the decision document. Wiki sample values were not treated as fallback evidence.

These are maintained mapping-editor/runtime-mod source checks, not execution of a proprietary Beat Saber binary. That game-binary experiment was not performed. Negative speed remains outside supported import behavior even though mods can support it.

## Validation boundary and remaining work

Real provider acquisition and the owner browser boundary passed; no signed installed assembly or live import was run here. Parent owns those checks and publication. No downloaded map/audio/art bytes were added to git. Work started on clean `main`; no unrelated dirt existed. No push occurred. Bead remains in progress for parent integration/review.
