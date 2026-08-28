// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const demo = readFileSync(new URL("../.testbed/demo/main.js", import.meta.url), "utf8");
assert.doesNotMatch(demo, /customElements\.define/u, "vendor testbed must not own product components");
assert.doesNotMatch(demo, /navigator\.mediaDevices/u, "vendor smoke must not request camera/media permission");
assert.doesNotMatch(demo, /fetch\s*\(/u, "foundation smoke must not contact BeatSaver or another network provider");
console.log("Vendor/component boundary validation passed.");
