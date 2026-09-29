#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const config = JSON.parse(
  await fs.readFile(path.join(root, "safari.config.json"), "utf8")
);
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
);
if (
  config.version !== pkg.version ||
  !Number.isSafeInteger(config.buildNumber) ||
  config.buildNumber < 1
) {
  throw new Error(
    "Safari version must match package.json and buildNumber must be a positive integer"
  );
}
if (!/^[A-Za-z0-9.-]+$/.test(config.bundleIdentifier)) {
  throw new Error("Invalid Safari bundle identifier");
}
const projectDir = path.join(root, "build", config.appName);
const extensionName = `${config.appName} Extension`;
const extensionDir = path.join(root, "build/safari");

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${path.join(root, "node_modules/.bin")}${path.delimiter}${process.env.PATH}`,
      },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} failed (${code ?? signal})`))
    );
  });
}

if (!process.argv.includes("--skip-web-build")) {
  await run(path.join(root, "node_modules/.bin/zx"), [
    "src/scripts/build-task.mjs",
    "--target=safari",
  ]);
}
const manifest = JSON.parse(
  await fs.readFile(path.join(extensionDir, "manifest.json"), "utf8")
);
if (manifest.version !== config.version)
  throw new Error("Rebuild the Safari resources: manifest version differs");

await run("xcrun", [
  "safari-web-extension-converter",
  extensionDir,
  "--project-location",
  path.join(root, "build"),
  "--app-name",
  config.appName,
  "--bundle-identifier",
  config.bundleIdentifier,
  "--swift",
  "--macos-only",
  "--copy-resources",
  "--no-open",
  "--no-prompt",
  "--force",
]);

const projectPath = path.join(
  projectDir,
  `${config.appName}.xcodeproj/project.pbxproj`
);
let project = await fs.readFile(projectPath, "utf8");
let patchedTargets = 0;
function setting(body, key, value) {
  const expression = new RegExp(`(^[\\t ]*)${key} = [^;]*;`, "m");
  return expression.test(body)
    ? body.replace(
        expression,
        (_line, whitespace) => `${whitespace}${key} = ${value};`
      )
    : `${body}\n\t\t\t\t${key} = ${value};`;
}
project = project.replace(
  /buildSettings = \{([\s\S]*?)\n\t\t\t\};/g,
  (_block, original) => {
    let body = setting(
      original,
      "MACOSX_DEPLOYMENT_TARGET",
      config.minimumMacOSVersion
    );
    if (body.includes("PRODUCT_BUNDLE_IDENTIFIER =")) {
      patchedTargets++;
      const isExtension =
        /PRODUCT_BUNDLE_IDENTIFIER = [^;]*\.Extension"?;/.test(body);
      const values = {
        PRODUCT_BUNDLE_IDENTIFIER: JSON.stringify(
          config.bundleIdentifier + (isExtension ? ".Extension" : "")
        ),
        MARKETING_VERSION: config.version,
        CURRENT_PROJECT_VERSION: config.buildNumber,
        CODE_SIGN_ENTITLEMENTS: JSON.stringify(
          path.join(
            root,
            "scripts/safari",
            isExtension ? "extension.entitlements" : "host.entitlements"
          )
        ),
        ENABLE_HARDENED_RUNTIME: "YES",
        ENABLE_APP_SANDBOX: "YES",
        ENABLE_OUTGOING_NETWORK_CONNECTIONS: "NO",
        ENABLE_USER_SELECTED_FILES: "NO",
        REGISTER_APP_GROUPS: "NO",
        // Xcode can otherwise add get-task-allow to development identities.
        CODE_SIGN_INJECT_BASE_ENTITLEMENTS: "NO",
        INFOPLIST_KEY_LSApplicationCategoryType: JSON.stringify(
          "public.app-category.productivity"
        ),
      };
      for (const [key, value] of Object.entries(values))
        body = setting(body, key, value);
    }
    return `buildSettings = {${body}\n\t\t\t};`;
  }
);
if (patchedTargets !== 4)
  throw new Error(
    `Unexpected converter template: found ${patchedTargets} target configurations`
  );
await fs.writeFile(projectPath, project);

for (const target of [config.appName, extensionName]) {
  const plist = path.join(projectDir, target, "Info.plist");
  // These two keys are omitted by some converter versions.
  for (const [key, value] of [
    ["CFBundleVersion", "$(CURRENT_PROJECT_VERSION)"],
    ["CFBundleShortVersionString", "$(MARKETING_VERSION)"],
  ]) {
    await run("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
  }
}

// Keep the minimal container UI and native handler maintained as normal sources.
for (const [source, target] of [
  ["ViewController.swift", config.appName],
  ["SafariWebExtensionHandler.swift", extensionName],
]) {
  const template = path.join(root, "native/safari", source);
  await fs.access(template);
  const content = (await fs.readFile(template, "utf8"))
    .replaceAll(
      "__SAFARI_EXTENSION_BUNDLE_IDENTIFIER__",
      `${config.bundleIdentifier}.Extension`
    )
    .replaceAll("__SAFARI_RELEASE_VERSION__", config.releaseVersion);
  await fs.writeFile(path.join(projectDir, target, source), content);
}

await fs.copyFile(
  path.join(root, "native/safari/Main.storyboard"),
  path.join(projectDir, config.appName, "Base.lproj/Main.storyboard")
);

console.log(`Safari project ready: ${projectDir}`);
console.log(
  `Version ${config.version} (${config.buildNumber}); release ${config.releaseVersion}`
);
console.log(
  "This command generates the project. Use package:safari:development to build and sign the DMG."
);
