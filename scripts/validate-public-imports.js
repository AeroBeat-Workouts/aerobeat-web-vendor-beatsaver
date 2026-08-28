// @ts-check

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const files = ["src/index.js"];
for (const file of files) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/gu)].map((match) => match[1]);
  assert.equal(specifiers.every((specifier) => specifier.startsWith("./")), true, `${file} imports must stay package-local during scaffold`);
  assert.doesNotMatch(source, /@aerobeat\//u, `${file} must not reach into sibling packages during scaffold`);
  assert.doesNotMatch(source, /\.testbed|fixtures|scripts\//u, `${file} must not import private support files`);
}
console.log("Public import-boundary validation passed.");
