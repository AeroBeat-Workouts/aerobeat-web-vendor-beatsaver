// @ts-check

import assert from "node:assert/strict";
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { computeBeatSaverMapHash, inspectBeatSaverArchive } from "../src/index.js";
import { createSyntheticBeatSaverZip, createSyntheticMapPayload } from "./fixture-helpers.js";

const root = resolve(".");
const archive = createSyntheticBeatSaverZip(2);
const versionlessArchive = createSyntheticBeatSaverZip(4, { mutateInfo: (info) => { delete info.version; delete info._version; } });
const versionlessHash = await computeBeatSaverMapHash(await inspectBeatSaverArchive(versionlessArchive));
const invalidVersionArchive = createSyntheticBeatSaverZip(4, { mutateInfo: (info) => { info.version = "5.0.0"; } });
const expectedSourceHash = "f8ed950c666baf9148a18e5f3b9731b3f2f23cb0";
const expectedArchiveSha1 = "c3f76b20a55d917595c4b741519fb8e274001f83";
const downloadUrl = "https://cdn.example.invalid/browser-fixture.zip";
const versionlessDownloadUrl = "https://cdn.example.invalid/browser-versionless.zip";
const invalidVersionDownloadUrl = "https://cdn.example.invalid/browser-invalid-version.zip";
const mapPayload = createSyntheticMapPayload(expectedSourceHash, downloadUrl, "BROWSER1");
const versionlessMapPayload = createSyntheticMapPayload(versionlessHash, versionlessDownloadUrl, "BROWSER2");
const invalidVersionMapPayload = createSyntheticMapPayload("0".repeat(40), invalidVersionDownloadUrl, "BROWSER3");
const server = createServer((request, response) => {
  const requestPath = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const fixture = requestPath === "/fixture.zip" ? archive : requestPath === "/versionless.zip" ? versionlessArchive : requestPath === "/invalid-version.zip" ? invalidVersionArchive : null;
  if (fixture) {
    response.writeHead(200, { "content-type": "application/zip", "content-length": String(fixture.byteLength), "cache-control": "no-store" });
    response.end(fixture);
    return;
  }
  const relativePath = requestPath === "/" ? ".testbed/demo/index.html" : requestPath.slice(1);
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (!statSync(filePath).isFile()) throw new Error("Not a file");
    response.setHeader("content-type", contentType(filePath));
    response.setHeader("cache-control", "no-store");
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise((resolvePromise, rejectPromise) => { server.once("error", rejectPromise); server.listen(0, "0.0.0.0", resolvePromise); });
const address = server.address();
assert.ok(address && typeof address === "object");
const addresses = Object.values(networkInterfaces()).flat().filter(Boolean)
  .filter((entry) => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("127."));
const preferred = addresses.find((entry) => entry.address.startsWith("100.")) ?? addresses[0];
assert.ok(preferred, "a genuine non-loopback IPv4 interface is required");
/** @type {string[]} */
const consoleProblems = [];
/** @type {string[]} */
const externalRequests = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (message) => { if (message.type() === "warning" || message.type() === "error") consoleProblems.push(`${message.type()}: ${message.text()}`); });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  page.on("request", (request) => {
    const requestUrl = new URL(request.url());
    if (requestUrl.hostname !== "localhost" && requestUrl.hostname !== preferred.address) externalRequests.push(request.url());
  });

  const run = async (url, expectedSecure) => {
    const response = await page.goto(url, { waitUntil: "networkidle" });
    assert.equal(response?.ok(), true);
    await page.waitForSelector("#app[data-ready='true']");
    return page.evaluate(async ({ secure, providerPayload, versionlessProviderPayload, invalidProviderPayload, expectedProviderHash, expectedRawHash, providerDownloadUrl, versionlessProviderDownloadUrl, invalidProviderDownloadUrl }) => {
      if (isSecureContext !== secure) throw new Error("Window secure-context precondition failed");
      const subtleType = typeof globalThis.crypto?.subtle;
      if ((secure && subtleType !== "object") || (!secure && subtleType !== "undefined")) throw new Error("Window WebCrypto precondition failed before vendor hashing");
      const vendor = await import("/src/index.js");
      const hashes = await import("@aerobeat/web-hash");
      const fixtureResponse = await fetch("/fixture.zip", { cache: "no-store" });
      const fixtureBytes = new Uint8Array(await fixtureResponse.arrayBuffer());
      const map = vendor.normalizeMap(providerPayload);
      const versionlessMap = vendor.normalizeMap(versionlessProviderPayload);
      const invalidMap = vendor.normalizeMap(invalidProviderPayload);
      const routeByUrl = new Map([[providerDownloadUrl, "/fixture.zip"], [versionlessProviderDownloadUrl, "/versionless.zip"], [invalidProviderDownloadUrl, "/invalid-version.zip"]]);
      const service = vendor.createAeroBeatSaverVendorService({
        maxRetries: 0,
        fetch: async (input) => {
          const requestedUrl = input.toString();
          const route = routeByUrl.get(requestedUrl);
          if (!route) return new Response("not found", { status: 404 });
          const downloaded = await fetch(route, { cache: "no-store" });
          const bytes = await downloaded.arrayBuffer();
          const wrapped = new Response(bytes, { status: 200, headers: { "content-type": "application/zip", "content-length": String(bytes.byteLength) } });
          Object.defineProperty(wrapped, "url", { value: requestedUrl });
          return wrapped;
        }
      });
      const online = await service.acquireVersion(map, expectedProviderHash);
      const local = await service.importLocalArchive(new Blob([fixtureBytes], { type: "application/zip" }));
      const versionlessBytes = new Uint8Array(await (await fetch("/versionless.zip", { cache: "no-store" })).arrayBuffer());
      const versionlessInspect = await vendor.inspectBeatSaverArchive(versionlessBytes);
      const versionlessOnline = await service.acquireVersion(versionlessMap, undefined);
      const versionlessLocal = await service.importLocalArchive(new Blob([versionlessBytes]));
      const invalidBytes = new Uint8Array(await (await fetch("/invalid-version.zip", { cache: "no-store" })).arrayBuffer());
      const invalidCodes = [];
      for (const operation of [() => vendor.inspectBeatSaverArchive(invalidBytes), () => service.acquireVersion(invalidMap, undefined), () => service.importLocalArchive(new Blob([invalidBytes]))]) {
        try { await operation(); invalidCodes.push("accepted"); }
        catch (error) { invalidCodes.push(error && typeof error === "object" && "code" in error ? error.code : "unknown"); }
      }
      let native = null;
      let nativeError = "";
      try { native = await hashes.sha1Hex(fixtureBytes, { backend: "native" }); } catch (error) { nativeError = error instanceof Error ? error.message : String(error); }
      const fallback = await hashes.sha1Hex(fixtureBytes, { backend: "fallback" });
      return {
        isSecureContext,
        subtleType,
        onlineSourceHash: online.sourceHash,
        localSourceHash: local.sourceHash,
        onlineArchiveSha1: online.archiveSha1,
        localArchiveSha1: local.archiveSha1,
        sourceFormatMajor: online.source.manifest.sourceFormatMajor,
        byteLength: fixtureBytes.byteLength,
        auto: await vendor.sha1Hex(fixtureBytes),
        native,
        nativeError,
        fallback,
        expectedRawHash,
        versionlessMajors: [versionlessInspect.manifest.sourceFormatMajor, versionlessOnline.source.manifest.sourceFormatMajor, versionlessLocal.source.manifest.sourceFormatMajor],
        invalidCodes
      };
    }, { secure: expectedSecure, providerPayload: mapPayload, versionlessProviderPayload: versionlessMapPayload, invalidProviderPayload: invalidVersionMapPayload, expectedProviderHash: expectedSourceHash, expectedRawHash: expectedArchiveSha1, providerDownloadUrl: downloadUrl, versionlessProviderDownloadUrl: versionlessDownloadUrl, invalidProviderDownloadUrl: invalidVersionDownloadUrl });
  };

  const secure = await run(`http://localhost:${address.port}/.testbed/demo/index.html`, true);
  const insecure = await run(`http://${preferred.address}:${address.port}/.testbed/demo/index.html`, false);
  for (const result of [secure, insecure]) {
    assert.equal(result.onlineSourceHash, expectedSourceHash);
    assert.equal(result.localSourceHash, expectedSourceHash);
    assert.equal(result.onlineArchiveSha1, expectedArchiveSha1);
    assert.equal(result.localArchiveSha1, expectedArchiveSha1);
    assert.equal(result.auto, expectedArchiveSha1);
    assert.equal(result.fallback, expectedArchiveSha1);
    assert.equal(result.sourceFormatMajor, 2);
    assert.equal(result.byteLength, archive.byteLength);
    assert.deepEqual(result.versionlessMajors, [4, 4, 4]);
    assert.deepEqual(result.invalidCodes, ["unsupported", "unsupported", "unsupported"]);
  }
  assert.equal(secure.isSecureContext, true);
  assert.equal(secure.subtleType, "object");
  assert.equal(secure.native, expectedArchiveSha1);
  assert.equal(insecure.isSecureContext, false);
  assert.equal(insecure.subtleType, "undefined");
  assert.equal(insecure.native, null);
  assert.match(insecure.nativeError, /unavailable/u);
  assert.deepEqual(consoleProblems, []);
  assert.deepEqual(externalRequests, []);
  console.log(JSON.stringify({ secureOrigin: `http://localhost:${address.port}`, insecureOrigin: `http://${preferred.address}:${address.port}`, vendorDownload: "PASS", localZip: "PASS", explicitV5Reject: "PASS", versionlessV4: "PASS", sourceHash: expectedSourceHash, archiveSha1: expectedArchiveSha1 }));
} finally {
  await browser?.close();
  await new Promise((resolvePromise, rejectPromise) => server.close((error) => error ? rejectPromise(error) : resolvePromise(undefined)));
}

/** @param {string} filePath @returns {string} */
function contentType(filePath) {
  switch (extname(filePath)) {
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    default: return "application/octet-stream";
  }
}
