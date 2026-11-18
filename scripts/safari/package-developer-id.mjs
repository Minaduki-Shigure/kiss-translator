#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { validateNotaryLog } from "./notary-evidence.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const [team, certificateArgument, profile, stage, ...extra] =
  process.argv.slice(2);
const certificate = certificateArgument?.toUpperCase();
assert.ok(
  /^[A-Z0-9]{10}$/.test(team || "") &&
    /^[A-F0-9]{40}$/.test(certificate || "") &&
    profile &&
    !profile.startsWith("-"),
  "Usage: package-developer-id.sh TEAM CERT_SHA1 KEYCHAIN_PROFILE prepare|submit-app|finish-app|submit-dmg|finish|status"
);
assert.ok(
  [
    "prepare",
    "submit-app",
    "finish-app",
    "submit-dmg",
    "finish",
    "status",
  ].includes(stage) && !extra.length,
  "Unknown stage"
);
const config = JSON.parse(
  await fs.readFile(path.join(root, "safari.config.json"), "utf8")
);
assert.match(config.releaseVersion, /^[A-Za-z0-9.-]+$/);
assert.equal(config.appName, "Kiss Translator");
const run = path.join(root, "build/safari-developer-id", config.releaseVersion);
const stateFile = path.join(run, "state.json");
const products = path.join(run, "DerivedData/Build/Products/Release");
const payload = path.join(run, "payload");
const app = path.join(payload, `${config.appName}.app`);
const extensionName = `${config.appName} Extension.appex`;
const appZip = path.join(run, "app-submission.zip");
const dmgInput = path.join(run, "dmg-submission.dmg");
const dmgFinal = path.join(run, "delivery.dmg");
const source = path.join(root, "build/safari");
const savedResources = path.join(run, "source-resources");
const mount = path.join(run, "mount");
const releaseName = `Kiss-Translator-${config.releaseVersion}-macOS-universal-DeveloperID.dmg`;
const output = path.join(root, "dist", releaseName);
const cleanupLog = path.join(run, "cleanup.log");
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
let state;
let interrupted;
const stop = (signal) => {
  interrupted = signal;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const checkInterruption = () => {
  if (interrupted)
    throw new Error(
      `${interrupted}: state and submitted artifacts preserved for recovery`
    );
};

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashFile = async (file) => sha(await fs.readFile(file));
async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (e) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
}
async function atomicJSON(file, value) {
  const temporary = `${file}.new`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temporary, file);
}
const save = () => atomicJSON(stateFile, state);
async function tree(directory, prefix = "") {
  const result = {};
  for (const entry of (
    await fs.readdir(directory, { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      Object.assign(
        result,
        await tree(path.join(directory, entry.name), relative)
      );
    else {
      assert.ok(
        entry.isFile(),
        `Unexpected symbolic link or special resource: ${relative}`
      );
      result[relative] = await hashFile(path.join(directory, entry.name));
    }
  }
  return result;
}
async function call(command, args, log, cleanup = false) {
  if (!cleanup) checkInterruption();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (log)
    await fs.writeFile(
      path.join(run, log),
      (result.stdout || "") + (result.stderr || "")
    );
  if (!cleanup) checkInterruption();
  assert.equal(
    result.status,
    0,
    `${command} failed (${result.status}): ${result.error?.message || result.stderr?.slice(-2500) || "see stage log"}`
  );
  return result.stdout;
}
async function verifyApp(
  target,
  notarized = false,
  label = "app-verification"
) {
  const output = await call(
    process.execPath,
    [
      path.join(root, "scripts/safari/verify-package.mjs"),
      target,
      "--development-team",
      team,
      "--signing-certificate",
      certificate,
      "--signing-type",
      "developer-id",
      "--notarization",
      notarized ? "stapled" : "none",
      "--resources",
      savedResources,
    ],
    `${label}.log`
  );
  const report = JSON.parse(output);
  await atomicJSON(path.join(run, `${label}.json`), report);
  return report;
}
const appCodeHashes = (report) =>
  report.signatures.map(({ bundleId, architecture, cdhash }) => ({
    bundleId,
    architecture,
    cdhash,
  }));
async function verifyBoundApp(
  target,
  notarized = false,
  label = "bound-app-verification"
) {
  const report = await verifyApp(target, notarized, label);
  assert.deepEqual(
    appCodeHashes(report),
    state.appCodeHashes,
    "App or extension changed since the submission ZIP was prepared"
  );
  return report;
}
async function verifyImage(target) {
  await call("/usr/bin/codesign", ["--verify", "--strict", target]);
  const display = spawnSync(
    "/usr/bin/codesign",
    ["--display", "--verbose=4", target],
    { encoding: "utf8" }
  );
  assert.equal(display.status, 0, display.stderr);
  assert.match(
    display.stderr,
    /^Timestamp=(?!none$).+$/m,
    "DMG must have a secure timestamp"
  );
  assert.ok(
    display.stderr.split("\n").includes(`TeamIdentifier=${team}`),
    "DMG signing team mismatch"
  );
  const cdhash = display.stderr.match(/^CDHash=([a-f0-9]+)$/m)?.[1];
  assert.ok(cdhash, "Missing disk image code directory hash");
  const certificateDir = await fs.mkdtemp(
    path.join(run, "public-certificate-")
  );
  try {
    const prefix = path.join(certificateDir, "cert-");
    await call("/usr/bin/codesign", [
      "--display",
      `--extract-certificates=${prefix}`,
      target,
    ]);
    const leaf = new X509Certificate(await fs.readFile(`${prefix}0`));
    assert.match(leaf.subject, /^CN=Developer ID Application:/m);
    assert.equal(leaf.fingerprint.replaceAll(":", ""), certificate);
    assert.ok(
      Date.parse(leaf.validFrom) <= Date.now() &&
        Date.parse(leaf.validTo) > Date.now()
    );
  } finally {
    await fs.rm(certificateDir, { recursive: true });
  }
  return cdhash;
}
async function insideRun(target) {
  const relative = path.relative(
    await fs.realpath(run),
    await fs.realpath(target)
  );
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    "Refusing to operate outside this release directory"
  );
}
async function unregister(kind, target) {
  if (!(await exists(target))) return;
  await insideRun(target);
  const result = spawnSync(
    kind === "plugin" ? "/usr/bin/pluginkit" : lsregister,
    [kind === "plugin" ? "-r" : "-u", target],
    { encoding: "utf8" }
  );
  const message = `${result.stdout || ""}${result.stderr || ""}`.trim();
  await fs.appendFile(
    cleanupLog,
    `${kind} ${target}: ${message || result.status}\n`
  );
  assert.ok(
    result.status === 0 ||
      (kind === "plugin" && message === `remove: no plugin at ${target}`) ||
      (kind === "app" &&
        [
          `failed to scan ${target}: -10814`,
          `failed to scan ${target}: -10814\n from spotlight`,
        ].includes(message)),
    `Could not unregister exact path ${target}: ${message}`
  );
}
async function attemptAll(actions) {
  const errors = [];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      errors.map((error) => error.message).join("; ")
    );
}
async function unregisterApp(target) {
  await attemptAll([
    () =>
      unregister(
        "plugin",
        path.join(target, "Contents/PlugIns", extensionName)
      ),
    () => unregister("app", target),
  ]);
}
async function cleanRegistrations() {
  await attemptAll([
    () => unregisterApp(app),
    () => unregisterApp(path.join(products, `${config.appName}.app`)),
    () => unregister("plugin", path.join(products, extensionName)),
  ]);
}
async function currentInputs() {
  return {
    config,
    team,
    certificate,
    profile,
    resources: await tree(source),
    installation: await hashFile(
      path.join(root, "scripts/safari/INSTALL-developer-id.zh-CN.md")
    ),
    license: await hashFile(path.join(root, "LICENSE")),
    nativeProject: Object.fromEntries(
      Object.entries(
        await tree(path.join(root, "build", config.appName))
      ).filter(
        ([name]) =>
          !name.split(path.sep).includes("xcuserdata") &&
          !name.endsWith(".DS_Store") &&
          !name.endsWith("IDEWorkspaceChecks.plist")
      )
    ),
    hostEntitlements: await hashFile(
      path.join(root, "scripts/safari/host.entitlements")
    ),
    extensionEntitlements: await hashFile(
      path.join(root, "scripts/safari/extension.entitlements")
    ),
  };
}
async function submit(kind, artifact) {
  const hash = await hashFile(artifact);
  if (state[kind]?.id) {
    assert.equal(state[kind].sha256, hash);
    console.log(
      `Existing ${kind} submission ${state[kind].id}; use the finish stage to query it.`
    );
    return;
  }
  assert.ok(
    !state[kind]?.attempted,
    `Previous ${kind} submission has an uncertain outcome. Inspect ${kind}-submit.json / notarytool history, recover its UUID into state.json, and do not resubmit blindly.`
  );
  state[kind] = {
    attempted: true,
    sha256: hash,
    archiveFilename: path.basename(artifact),
    startedAt: new Date().toISOString(),
  };
  await save(); // Must be durable before Apple can receive the submission.
  const result = spawnSync(
    "/usr/bin/xcrun",
    [
      "notarytool",
      "submit",
      artifact,
      "--keychain-profile",
      profile,
      "--output-format",
      "json",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  );
  await fs.writeFile(
    path.join(run, `${kind}-submit.json`),
    result.stdout || ""
  );
  await fs.writeFile(
    path.join(run, `${kind}-submit.stderr`),
    result.stderr || ""
  );
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    /* Preserve uncertain state for manual recovery. */
  }
  if (response?.id && /^[0-9a-f-]{36}$/i.test(response.id)) {
    state[kind].id = response.id;
    await save();
  }
  checkInterruption();
  assert.equal(
    result.status,
    0,
    `Notary submit failed; state and output preserved. Inspect ${kind}-submit.stderr before retrying.`
  );
  assert.ok(
    state[kind].id,
    "Submission UUID missing; recover it from Apple before continuing."
  );
  console.log(
    `Submitted ${kind}: ${state[kind].id}. No polling or duplicate submission was started.`
  );
}
async function accepted(kind, artifact) {
  const submission = state[kind];
  assert.ok(submission?.id, `No recorded ${kind} submission`);
  assert.equal(
    await hashFile(artifact),
    submission.sha256,
    "Submitted archive changed"
  );
  const info = JSON.parse(
    await call(
      "/usr/bin/xcrun",
      [
        "notarytool",
        "info",
        submission.id,
        "--keychain-profile",
        profile,
        "--output-format",
        "json",
      ],
      `${kind}-info.log`
    )
  );
  await atomicJSON(path.join(run, `${kind}-info.json`), info);
  assert.equal(info.id, submission.id);
  if (info.status !== "Accepted") {
    if (info.status === "In Progress") {
      console.log(
        `${kind} ${submission.id}: In Progress; preserved for a later finish invocation.`
      );
      process.exitCode = 75;
      return false;
    }
    await call(
      "/usr/bin/xcrun",
      ["notarytool", "log", submission.id, "--keychain-profile", profile],
      `${kind}-rejected-log.json`
    );
    assert.fail(
      `${kind} notarization is ${info.status}; preserved archive and Apple's log for review.`
    );
  }
  const raw = await call(
    "/usr/bin/xcrun",
    ["notarytool", "log", submission.id, "--keychain-profile", profile],
    `${kind}-notary-log.json`
  );
  validateNotaryLog(
    JSON.parse(raw),
    submission,
    kind === "app" ? state.appCodeHashes : [{ cdhash: state.dmgCodeHash }]
  );
  state[kind].accepted = true;
  state[kind].notaryLogSHA256 = sha(raw);
  await save();
  return true;
}
async function publishFile(file, destination) {
  if (await exists(destination)) {
    assert.ok(
      (await fs.lstat(destination)).isFile() &&
        !(await fs.lstat(destination)).isSymbolicLink()
    );
    assert.equal(
      await hashFile(file),
      await hashFile(destination),
      `Refusing to overwrite ${destination}`
    );
  } else await fs.copyFile(file, destination, 1 /* COPYFILE_EXCL */);
  assert.equal(await hashFile(file), await hashFile(destination));
}
async function finishImage() {
  if (!(await accepted("dmg", dmgInput))) return;
  if (!(await exists(dmgFinal))) await fs.copyFile(dmgInput, dmgFinal, 1);
  assert.equal(
    await verifyImage(dmgFinal),
    state.dmgCodeHash,
    "Delivery image must derive from the submitted signed image"
  );
  await call(
    "/usr/bin/xcrun",
    ["stapler", "staple", dmgFinal],
    "dmg-staple.log"
  );
  await call(
    "/usr/bin/xcrun",
    ["stapler", "validate", dmgFinal],
    "dmg-staple-validate.log"
  );
  assert.equal(
    await verifyImage(dmgFinal),
    state.dmgCodeHash,
    "Stapling must preserve the submitted image code directory"
  );
  await call(
    "/usr/sbin/spctl",
    [
      "--assess",
      "--type",
      "open",
      "--context",
      "context:primary-signature",
      "--verbose=2",
      dmgFinal,
    ],
    "dmg-gatekeeper.log"
  );
  assert.match(
    await fs.readFile(path.join(run, "dmg-gatekeeper.log"), "utf8"),
    /^source=Notarized Developer ID$/m
  );
  await call("/usr/bin/hdiutil", ["verify", dmgFinal], "dmg-verify.log");
  await fs.mkdir(mount, { recursive: true });
  // A stale mount must never be reused or recursively removed.
  assert.equal(
    (await fs.readdir(mount)).length,
    0,
    "Mount directory is not empty; inspect and detach the old image first"
  );
  let attached = false;
  try {
    await call(
      "/usr/bin/hdiutil",
      [
        "attach",
        dmgFinal,
        "-readonly",
        "-nobrowse",
        "-noautoopen",
        "-mountpoint",
        mount,
        "-plist",
      ],
      "mount.plist"
    );
    attached = true;
    const mountedApp = path.join(mount, `${config.appName}.app`);
    await verifyBoundApp(mountedApp, true, "final-image-verification");
    assert.equal(
      await fs.readlink(path.join(mount, "Applications")),
      "/Applications"
    );
    assert.equal(
      await hashFile(path.join(mount, "安装说明.md")),
      state.inputs.installation
    );
    assert.equal(
      await hashFile(path.join(mount, "LICENSE.txt")),
      state.inputs.license
    );
    const actual = path.join(
      mountedApp,
      "Contents/PlugIns",
      extensionName,
      "Contents/Resources"
    );
    const retained = path.join(
      root,
      "build/safari-release-resources",
      config.releaseVersion,
      "extension"
    );
    if (await exists(retained))
      assert.deepEqual(await tree(retained), await tree(actual));
    else {
      await fs.mkdir(path.dirname(retained), { recursive: true });
      await call("/usr/bin/ditto", [actual, retained]);
      assert.deepEqual(await tree(retained), await tree(actual));
    }
  } finally {
    if (attached || (await fs.stat(mount)).dev !== (await fs.stat(run)).dev) {
      let cleanupError;
      try {
        await unregisterApp(path.join(mount, `${config.appName}.app`));
      } catch (error) {
        cleanupError = error;
      }
      await call("/usr/bin/hdiutil", ["detach", mount], "detach.log", true);
      await fs.rmdir(mount);
      if (cleanupError) throw cleanupError;
    }
  }
  const checksum = `${await hashFile(dmgFinal)}  ${releaseName}\n`;
  await fs.writeFile(path.join(run, "delivery.sha256"), checksum);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await publishFile(dmgFinal, output);
  await publishFile(path.join(run, "delivery.sha256"), `${output}.sha256`);
  state.finalSHA256 = await hashFile(output);
  state.complete = true;
  await save();
  await cleanRegistrations();
  // Submission ZIP and signed, unstapled DMG remain available as exact hash evidence.
  for (const target of [
    app,
    path.join(products, `${config.appName}.app`),
    path.join(products, extensionName),
  ]) {
    if (await exists(target)) {
      await insideRun(target);
      await fs.rm(target, { recursive: true });
    }
  }
  state.cleanupComplete = true;
  await save();
  console.log(`Created ${output}\nSHA256 ${state.finalSHA256}`);
}

await fs.mkdir(run, { recursive: true });
assert.equal(
  await fs.realpath(run),
  run,
  "Release directory must not be a symbolic link"
);
if (stage === "status") {
  console.log(await fs.readFile(stateFile, "utf8"));
} else {
  const lock = path.join(run, "stage.lock");
  await fs.mkdir(lock).catch((error) => {
    throw new Error(
      `Another stage is running, or a previous process was interrupted. Inspect ${lock} before continuing.`,
      { cause: error }
    );
  });
  await fs.writeFile(
    path.join(lock, "owner.json"),
    JSON.stringify({
      pid: process.pid,
      stage,
      startedAt: new Date().toISOString(),
    })
  );
  try {
    if (await exists(stateFile))
      state = JSON.parse(await fs.readFile(stateFile, "utf8"));
    else {
      assert.equal(stage, "prepare", "Begin with prepare");
      state = { schemaVersion: 1, inputs: await currentInputs() };
      await save();
    }
    assert.deepEqual(
      state.inputs,
      await currentInputs(),
      "Release inputs changed; preserve the pending release and prepare a new revision"
    );
    if (state.prepared)
      assert.deepEqual(
        await tree(savedResources),
        state.inputs.resources,
        "Retained source resources changed"
      );
    checkInterruption();
    if (state.complete && state.cleanupComplete) {
      assert.equal(await hashFile(output), state.finalSHA256);
      console.log(`Already complete: ${output}`);
    } else if (stage === "prepare") {
      if (state.prepared) {
        assert.equal(await hashFile(appZip), state.appZipSHA256);
        await verifyBoundApp(app);
        console.log(`Prepared archive already exists: ${appZip}`);
      } else {
        assert.ok(
          !state.prepareStarted,
          "Previous preparation was interrupted. Inspect the preserved directory before recovery; no implicit rebuild is performed."
        );
        state.prepareStarted = true;
        await save();
        await call("/usr/bin/ditto", [source, savedResources]);
        await call(
          "/usr/bin/xcodebuild",
          [
            "-project",
            path.join(
              root,
              `build/${config.appName}/${config.appName}.xcodeproj`
            ),
            "-scheme",
            config.appName,
            "-configuration",
            "Release",
            "-destination",
            "generic/platform=macOS",
            "-derivedDataPath",
            path.join(run, "DerivedData"),
            `DEVELOPMENT_TEAM=${team}`,
            "CODE_SIGN_STYLE=Manual",
            `CODE_SIGN_IDENTITY=${certificate}`,
            "CODE_SIGNING_ALLOWED=YES",
            "CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO",
            "OTHER_CODE_SIGN_FLAGS=--timestamp",
            "ENABLE_HARDENED_RUNTIME=YES",
            `MACOSX_DEPLOYMENT_TARGET=${config.minimumMacOSVersion}`,
            "ARCHS=arm64 x86_64",
            "ONLY_ACTIVE_ARCH=NO",
            "-quiet",
            "build",
          ],
          "xcodebuild.log"
        );
        await fs.mkdir(payload);
        await call("/usr/bin/ditto", [
          path.join(products, `${config.appName}.app`),
          app,
        ]);
        await fs.symlink("/Applications", path.join(payload, "Applications"));
        await fs.copyFile(
          path.join(root, "scripts/safari/INSTALL-developer-id.zh-CN.md"),
          path.join(payload, "安装说明.md")
        );
        await fs.copyFile(
          path.join(root, "LICENSE"),
          path.join(payload, "LICENSE.txt")
        );
        state.appCodeHashes = appCodeHashes(await verifyApp(app));
        await call("/usr/bin/ditto", ["-c", "-k", "--keepParent", app, appZip]);
        state.appZipSHA256 = await hashFile(appZip);
        state.prepared = true;
        await save();
        console.log(`Prepared ${appZip}; next: submit-app`);
      }
    } else if (stage === "submit-app") {
      assert.ok(state.prepared);
      assert.equal(await hashFile(appZip), state.appZipSHA256);
      await submit("app", appZip);
    } else if (stage === "finish-app") {
      if (await accepted("app", appZip)) {
        await verifyBoundApp(app);
        await call(
          "/usr/bin/xcrun",
          ["stapler", "staple", app],
          "app-staple.log"
        );
        await verifyBoundApp(app, true, "stapled-app-verification");
        if (!state.dmgPrepared) {
          assert.ok(
            !(await exists(dmgInput)),
            "Interrupted DMG creation; preserve and inspect before continuing"
          );
          await call(
            "/usr/bin/hdiutil",
            [
              "create",
              "-srcfolder",
              payload,
              "-volname",
              `Kiss Translator ${config.version}`,
              "-fs",
              "HFS+",
              "-format",
              "UDZO",
              dmgInput,
            ],
            "dmg-create.log"
          );
          await call(
            "/usr/bin/codesign",
            ["--sign", certificate, "--timestamp", dmgInput],
            "dmg-sign.log"
          );
          state.dmgCodeHash = await verifyImage(dmgInput);
          state.dmgPrepared = true;
          state.dmgInputSHA256 = await hashFile(dmgInput);
          await save();
        } else {
          assert.equal(await hashFile(dmgInput), state.dmgInputSHA256);
          assert.equal(await verifyImage(dmgInput), state.dmgCodeHash);
        }
        console.log(`Prepared signed DMG ${dmgInput}; next: submit-dmg`);
      }
    } else if (stage === "submit-dmg") {
      assert.ok(state.dmgPrepared);
      assert.equal(await hashFile(dmgInput), state.dmgInputSHA256);
      await submit("dmg", dmgInput);
    } else if (stage === "finish") {
      assert.ok(state.dmgPrepared);
      await finishImage();
    }
  } finally {
    try {
      await cleanRegistrations();
    } finally {
      await fs.rm(lock, { recursive: true });
    }
  }
}
