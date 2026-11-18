#!/usr/bin/env node
// Check the actual app in the final image, including every signed architecture.
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [appArgument, ...args] = process.argv.slice(2);
assert.ok(appArgument && !appArgument.startsWith("--"), "Usage: verify-package.mjs APP --development-team TEAM --signing-certificate SHA1 [--resources DIR] [--signing-type development|developer-id] [--notarization none|stapled]");
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  assert.ok(["--development-team", "--signing-certificate", "--resources", "--signing-type", "--notarization"].includes(key) && !options.has(key), `Unknown or duplicate option: ${key}`);
  assert.ok(value && !value.startsWith("--"), `Missing value for ${key}`);
  options.set(key, value);
}
const signingType = options.get("--signing-type") || "development";
assert.ok(["development", "developer-id"].includes(signingType), "Unknown signing type");
const notarization = options.get("--notarization") || "none";
assert.ok(["none", "stapled"].includes(notarization), "Unknown notarization requirement");
assert.ok(notarization !== "stapled" || signingType === "developer-id", "Stapled verification requires Developer ID");
const signingName = signingType === "developer-id" ? "Developer ID Application" : "Apple Development";
const team = options.get("--development-team");
const fingerprint = options.get("--signing-certificate")?.toUpperCase();
assert.match(team || "", /^[A-Z0-9]{10}$/, "Expected a 10-character development team");
assert.match(fingerprint || "", /^[A-F0-9]{40}$/, "Expected the signing certificate SHA1 fingerprint");
const app = path.resolve(appArgument);
const extension = path.join(app, "Contents/PlugIns/Kiss Translator Extension.appex");
const resources = path.join(extension, "Contents/Resources");
const source = path.resolve(options.get("--resources") || path.join(root, "build/safari"));
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const config = JSON.parse(await readFile(path.join(root, "safari.config.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(resources, "manifest.json"), "utf8"));
assert.equal(manifest.version, pkg.version, "Packaged manifest version must match package.json");
assert.equal(manifest.version, config.version, "Safari release configuration version must match manifest");
assert.equal(manifest.manifest_version, 3, "Safari build must use Manifest V3");
assert.ok(manifest.background?.scripts?.length || manifest.background?.page || manifest.background?.service_worker, "Missing Safari background entry point");
assert.ok(manifest.content_scripts?.length, "Missing webpage translation content scripts");
assert.ok(manifest.options_ui?.page || manifest.options_page, "Missing settings page");

async function* files(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory()) yield* files(path.join(directory, entry.name), name);
    else if (entry.name !== ".DS_Store") {
      assert.ok(entry.isFile(), `Refusing a symbolic link or special resource: ${name}`);
      yield name;
    }
  }
}
let resourceCount = 0;
const hashes = {};
const licenseBanners = new Set();
const licenseFiles = new Set();
for await (const file of files(source)) {
  const expected = await readFile(path.join(source, file));
  const actual = await readFile(path.join(resources, file));
  assert.ok(actual.equals(expected), `Packaged resource differs from Safari build: ${file}`);
  if (file.endsWith(".js.LICENSE.txt")) {
    assert.ok(actual.toString("utf8").trim().length > 0, `Empty license notice: ${file}`);
    licenseFiles.add(file);
  } else if (file.endsWith(".js")) {
    const banner = actual.subarray(0, 1024).toString("utf8").match(/^\/\*! For license information please see ([^\r\n*]+) \*\//);
    if (banner) {
      assert.equal(banner[1], `${path.basename(file)}.LICENSE.txt`, `Unexpected license banner for ${file}`);
      licenseBanners.add(`${file}.LICENSE.txt`);
    }
  }
  hashes[file] = createHash("sha256").update(actual).digest("hex");
  resourceCount++;
}
assert.ok(resourceCount > 0, "Safari build resources are empty");
assert.ok(licenseFiles.size > 0, "Missing extracted JavaScript license notices");
assert.deepEqual(licenseBanners, licenseFiles, "JavaScript license banners must point to the matching packaged notices");

function plistValue(bundle, key) {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(bundle, "Contents/Info.plist")], { encoding: "utf8" }).trim();
}
const buildNumber = plistValue(app, "CFBundleVersion");
assert.match(buildNumber, /^\d+(?:\.\d+){0,2}$/, "Native build number must be numeric");
assert.equal(buildNumber, String(config.buildNumber), "Native build number must match safari.config.json");
const signatures = [];
for (const [bundle, executable, bundleId] of [
  [app, config.appName, config.bundleIdentifier],
  [extension, `${config.appName} Extension`, `${config.bundleIdentifier}.Extension`],
]) {
  assert.equal(plistValue(bundle, "CFBundleIdentifier"), bundleId, "Unexpected bundle identifier");
  assert.equal(plistValue(bundle, "CFBundleShortVersionString"), manifest.version, "Bundle marketing version mismatch");
  assert.equal(plistValue(bundle, "CFBundleVersion"), buildNumber, "App and extension build numbers differ");
  const xml = execFileSync("/usr/bin/codesign", ["--display", "--entitlements", ":-", "--xml", bundle], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const entitlements = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", "-"], { input: xml, encoding: "utf8" }));
  assert.equal(entitlements["com.apple.security.app-sandbox"], true, "Native bundle must be sandboxed");
  assert.notEqual(entitlements["com.apple.security.get-task-allow"], true, "Release must not allow debugging");
  assert.equal(entitlements["com.apple.security.application-groups"], undefined, "No provisioned application groups are required");
  const architectures = execFileSync("/usr/bin/lipo", ["-archs", path.join(bundle, "Contents/MacOS", executable)], { encoding: "utf8" }).trim().split(/\s+/).sort();
  assert.deepEqual(architectures, ["arm64", "x86_64"], "Native bundles must support Apple Silicon and Intel");
  for (const architecture of architectures) {
    const result = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", "--arch", architecture, bundle], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /^Signature=adhoc$/m, "An Apple certificate signature is required");
    assert.match(result.stderr, /^CodeDirectory .*\(runtime\)/m, "Hardened runtime must be enabled");
    assert.ok(result.stderr.split("\n").includes(`TeamIdentifier=${team}`), "Signing team mismatch");
    const cdhash = result.stderr.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
    assert.ok(cdhash, "Missing code directory hash");
    const timestamp = result.stderr.match(/^Timestamp=(.+)$/m)?.[1];
    if (signingType === "developer-id") assert.ok(timestamp && timestamp !== "none", "Developer ID requires an Apple secure timestamp");
    const certificateDirectory = await mkdtemp(path.join(tmpdir(), "kiss-safari-public-certificate-"));
    try {
      const prefix = path.join(certificateDirectory, "certificate-");
      execFileSync("/usr/bin/codesign", ["--display", "--arch", architecture, `--extract-certificates=${prefix}`, bundle], { stdio: ["ignore", "ignore", "pipe"] });
      // Only the public certificate is extracted. No keychain private key is read.
      const certificate = new X509Certificate(await readFile(`${prefix}0`));
      assert.ok(certificate.subject.split("\n").some((entry) => entry.startsWith(`CN=${signingName}:`)), `Expected a ${signingName} leaf certificate`);
      assert.equal(certificate.fingerprint.replaceAll(":", ""), fingerprint, "Signing certificate mismatch");
      assert.ok(Date.parse(certificate.validFrom) <= Date.now() && Date.parse(certificate.validTo) > Date.now(), "Signing certificate is not currently valid");
      signatures.push({ bundleId, architecture, cdhash, team, certificateSHA1: fingerprint, certificateExpires: certificate.validTo, ...(timestamp ? { secureTimestamp: timestamp } : {}) });
    } finally {
      await rm(certificateDirectory, { recursive: true, force: true });
    }
  }
}
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--all-architectures", app], { stdio: "inherit" });
if (notarization === "stapled") {
  execFileSync("/usr/bin/xcrun", ["stapler", "validate", app], { stdio: ["ignore", "ignore", "pipe"] });
  const assessment = spawnSync("/usr/sbin/spctl", ["--assess", "--type", "execute", "--verbose=2", app], { encoding: "utf8" });
  assert.equal(assessment.status, 0, assessment.stderr);
  assert.match(assessment.stderr, /^source=Notarized Developer ID$/m, "Gatekeeper must recognize notarized Developer ID");
}
console.log(JSON.stringify({ version: manifest.version, buildNumber, resourceCount, licenseNotices: [...licenseFiles].sort(), signing: signingName, notarized: notarization === "stapled", signatures, resourcesSHA256: hashes }, null, 2));
