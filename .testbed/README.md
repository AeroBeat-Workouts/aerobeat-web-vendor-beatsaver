# BeatSaver Browser Vendor Testbed

This hidden testbed proves package loading and browser console posture without contacting BeatSaver or downloading community content.

Serve the repository root and open `.testbed/demo/index.html`, or run `npm run test:browser` from the repository root.

Future provider fixtures belong in root `fixtures/`; debug-only presentation data belongs in `.testbed/debug-data/`. The vendor testbed must not define product Web Components, request camera/media permissions, or implement product browsing/install UX.
