// @ts-check

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const files = readdirSync(new URL("../src/", import.meta.url)).filter((file) => file.endsWith(".js")).sort();
assert.ok(files.length >= 5, "implemented vendor modules must be present");
for (const file of files) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");
  assert.match(source, /^\/\/ @ts-check/mu, `${file} must enable JavaScript type checking`);
  assert.doesNotMatch(source, /@(?:type|param|returns?)\s*\{\s*any\s*\}/u, `${file} must not escape through any`);
  assert.doesNotMatch(source, /\{\s*\*\s*\}/u, `${file} must not escape through wildcard JSDoc`);
  assert.doesNotMatch(source, /eslint-disable/u, `${file} must not disable validation posture`);
}
console.log("JSDoc/no-any validation passed.");
