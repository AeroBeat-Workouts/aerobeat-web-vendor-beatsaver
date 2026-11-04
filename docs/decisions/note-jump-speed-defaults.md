# Resolve automatic note jump speed before conversion

BeatSaver map `2fa8c`, provider hash `fb09ccd3edeb747ee3735a01824234d5c31fb9a1`, is the reported Sonic Heroes import failure. Its Info 2.0.0 explicitly declares Easy `_noteJumpMovementSpeed: 0`; it does not omit the field. Previously the archive inspector rejected the whole map as nonpositive.

An absent speed or numeric zero selects automatic note jump speed: Easy, Normal and Hard use 10; Expert uses 12; ExpertPlus uses 16. Explicit positive values remain exact. Both supported Info families use this same table, including Info v2 referencing v3 beatmaps. This is not inferred from the API's browse NJS or from example map values.

## Source verification

The maintained ChroMapper implementation at revision `0d67a67d9b6ee750c412660a43ce34aa889378ae` gives a version-bound source cross-check:

- [InfoDifficulty.cs lines 35–52](https://github.com/Caeden117/ChroMapper/blob/0d67a67d9b6ee750c412660a43ce34aa889378ae/Assets/__Scripts/Beatmap/Info/Base/InfoDifficulty.cs#L35-L52) explicitly resolves numeric zero using difficulty rank: 9 → 16, 7 → 12, otherwise 10.
- [V2Info.cs](https://github.com/Caeden117/ChroMapper/blob/0d67a67d9b6ee750c412660a43ce34aa889378ae/Assets/__Scripts/Beatmap/Info/V2/V2Info.cs#L77-L83) reads the legacy field into that shared resolver.
- [V4Info.cs](https://github.com/Caeden117/ChroMapper/blob/0d67a67d9b6ee750c412660a43ce34aa889378ae/Assets/__Scripts/Beatmap/Info/V4/V4Info.cs#L79-L84) reads the modern field into the same resolver. Both readers use `AsFloat`, so absent fields resolve to zero.

The parent accepts the version-pinned [bsmap 2.3.5 implementation and documentation, revision `3879da9498a1d52e0932adec20b7fc0c17cc3413`, lines 28–44](https://github.com/KivalEvan/BeatSaber-JSMap/blob/3879da9498a1d52e0932adec20b7fc0c17cc3413/src/beatmap/helpers/njs.ts#L28-L44) as the bounded compatibility contract. The release revision was verified with `npm view bsmap@2.3.5 gitHead`; those lines explicitly document and implement the identical null/zero fallback table. The [published 2.3.5 type documentation](https://app.unpkg.com/bsmap@2.3.5/files/types/beatmap/helpers/njs.d.ts) agrees. [SongCore's game-method patch](https://github.com/Kylemc1413/SongCore/blob/master/source/SongCore/Patches/AllowNegativeNoteJumpSpeedPatch.cs) targets `BeatmapDifficultyMethods.NoteJumpMovementSpeed` and confirms the game resets negative speeds to defaults unless patched; this adapter deliberately keeps its existing negative rejection. The [BSMG Info reference](https://bsmg.wiki/mapping/map-format/info.html) documents supported fields, but its sample positive values are not fallback authority.

These are maintained mapping-tool/runtime-mod source references, not execution of a proprietary Beat Saber binary. Native-game-version numeric parity is not independently established. No game-binary default experiment was performed; the parent explicitly accepted the pinned compatibility evidence rather than requiring that unavailable experiment.

## Scope and tests

Only absence of both recognized aliases and numeric zero gain default behavior. Malformed, null, string, boolean, nonfinite and negative values do not gain defaults. Existing independent valid underscore fallback for malformed camel fields is unchanged. Offset validation is unchanged. Defaults use the canonical difficulty label, not untrusted rank metadata.

`npm test` runs the focused synthetic matrix across Info 2.0.0/v2 beatmaps, Info 2.1.0/v3 beatmaps and Info 4.0.0/v4 beatmaps, all five difficulties, absent/zero/explicit speeds, malformed values and alias precedence. It exercises inspection, online service acquisition with injected transport, and local import. `npm run test:live-sonic-heroes` additionally fetches the real provider map and pinned archive, verifies its provider hash and raw Easy zero, then asserts normalized Easy 10 and unchanged Expert 16/ExpertPlus 18. The network check is optional, not part of the network-independent normal gate. No community payload bytes are committed.
