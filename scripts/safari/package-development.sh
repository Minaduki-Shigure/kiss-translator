#!/bin/bash
# Use an existing Apple Development identity; never create/export credentials.
set -euo pipefail
task_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$task_root"
team="${1:-}"
identity="${2:-}"
build_mode="${3:-}"
if [[ ! "$team" =~ ^[A-Z0-9]{10}$ || ! "$identity" =~ ^[A-Fa-f0-9]{40}$ || ( -n "$build_mode" && "$build_mode" != --skip-build ) || "$#" -gt 3 ]]; then
  echo 'Usage: bash scripts/safari/package-development.sh TEAM_ID CERTIFICATE_SHA1 [--skip-build]' >&2
  exit 2
fi

mkdir -p build dist
version="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
release_version="$(node -p 'JSON.parse(require("fs").readFileSync("safari.config.json", "utf8")).releaseVersion')"
minimum_macos="$(node -p 'JSON.parse(require("fs").readFileSync("safari.config.json", "utf8")).minimumMacOSVersion')"
[[ "$release_version" =~ ^[A-Za-z0-9.-]+$ && "$minimum_macos" =~ ^[0-9]+\.[0-9]+$ ]]
image_name="Kiss-Translator-$release_version-macOS-universal-development-signed.dmg"
image_path="$task_root/dist/$image_name"
checksum_path="$image_path.sha256"
resource_dir="$task_root/build/safari-release-resources/$release_version/extension"
if [[ -e "$image_path" || -L "$image_path" || -e "$checksum_path" || -L "$checksum_path" ]]; then
  echo "Release already exists; refusing to overwrite dist/$image_name or its checksum." >&2
  exit 1
fi

run_dir="$(mktemp -d "$task_root/build/safari-package.XXXXXX")"
products="$run_dir/DerivedData/Build/Products/Release"
lsregister='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
stage=''
payload=''
mount_dir=''
build_started=0
image_published=0
checksum_published=0
release_ready=0
cleanup_log="$run_dir/cleanup.log"
: > "$cleanup_log"

assert_run_path() {
  python3 - "$run_dir" "$1" <<'PY'
from pathlib import Path
import sys
base, target = map(Path, sys.argv[1:])
if base.resolve() != base or target.resolve() == base or not target.resolve().is_relative_to(base):
    raise SystemExit('Refusing cleanup outside this package run: ' + str(target))
PY
}

is_mounted() {
  python3 - "$mount_dir" <<'PY'
import os, sys
raise SystemExit(0 if os.path.ismount(sys.argv[1]) else 1)
PY
}

remove_registration() {
  local kind="$1" target="$2" output task_exit=0
  if [[ "$kind" == plugin ]]; then
    output="$(/usr/bin/pluginkit -r "$target" 2>&1)" || task_exit=$?
  else
    output="$("$lsregister" -u "$target" 2>&1)" || task_exit=$?
  fi
  [[ -z "$output" ]] || printf '%s\n' "$output" >> "$cleanup_log"
  [[ "$task_exit" != 0 ]] || return 0
  if [[ "$kind" == plugin && "$output" == "remove: no plugin at $target" ]]; then return 0; fi
  if [[ "$kind" == app && ( "$output" == "failed to scan $target: -10814" || "$output" == "failed to scan $target: -10814"$'\n from spotlight' ) ]]; then return 0; fi
  return "$task_exit"
}

unregister_bundle() {
  local bundle="$1" failed=0
  assert_run_path "$bundle" || return 1
  [[ -d "$bundle" ]] || return 0
  # Only this run's exact paths are touched; installed copies stay registered.
  if [[ "$bundle" == *.appex ]]; then
    remove_registration plugin "$bundle"
  else
    if [[ -d "$bundle/Contents/PlugIns/Kiss Translator Extension.appex" ]]; then
      remove_registration plugin "$bundle/Contents/PlugIns/Kiss Translator Extension.appex" || failed=1
    fi
    remove_registration app "$bundle" || failed=1
    return "$failed"
  fi
}

cleanup() {
  local task_exit=$? failed=0 mount_remaining=0
  trap - EXIT
  trap '' INT TERM
  set +e
  if [[ -n "$mount_dir" ]] && is_mounted; then
    unregister_bundle "$mount_dir/Kiss Translator.app" || failed=1
    /usr/bin/hdiutil detach "$mount_dir" >> "$cleanup_log" 2>&1 || /usr/bin/hdiutil detach -force "$mount_dir" >> "$cleanup_log" 2>&1
    if is_mounted; then
      echo "Could not detach this run's image at $mount_dir; see $cleanup_log" >&2
      failed=1
      mount_remaining=1
    fi
  fi
  if [[ -n "$mount_dir" ]] && ! is_mounted; then rmdir "$mount_dir" || failed=1; fi
  if [[ -n "$stage" ]]; then
    unregister_bundle "$payload/Kiss Translator.app" || failed=1
    if [[ "$mount_remaining" == 0 ]]; then
      if assert_run_path "$stage"; then rm -rf -- "$stage" || failed=1; else failed=1; fi
    else
      echo "Preserving $stage for mounted-image recovery." >&2
    fi
  fi
  if [[ "$build_started" == 1 ]]; then
    for product in "$products/Kiss Translator.app" "$products/Kiss Translator Extension.appex"; do
      if assert_run_path "$product"; then
        unregister_bundle "$product" || failed=1
        rm -rf -- "$product" || failed=1
      else failed=1; fi
    done
  fi
  if [[ "$release_ready" != 1 ]]; then
    [[ "$image_published" != 1 ]] || rm -f -- "$image_path" || failed=1
    [[ "$checksum_published" != 1 ]] || rm -f -- "$checksum_path" || failed=1
  fi
  if [[ "$failed" != 0 ]]; then
    echo "Temporary bundle cleanup failed; see $cleanup_log" >&2
    [[ "$task_exit" != 0 ]] || task_exit=1
  fi
  if [[ "$task_exit" == 0 && "$release_ready" == 1 ]]; then
    echo "Created dist/$image_name and dist/$image_name.sha256"
    echo 'Apple Development signed for personal use; this is not a notarized Developer ID release.'
    echo "Verified final-image resources: $resource_dir"
    echo "Verification and build logs: $run_dir"
    echo 'Temporary app copies and their exact-path registrations were removed.'
  fi
  exit "$task_exit"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$build_mode" != --skip-build ]]; then pnpm build:safari; fi
[[ -f 'build/Kiss Translator/Kiss Translator.xcodeproj/project.pbxproj' ]]
[[ -f build/safari/manifest.json ]]
build_started=1
xcodebuild -project 'build/Kiss Translator/Kiss Translator.xcodeproj' -scheme 'Kiss Translator' \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "$run_dir/DerivedData" \
  DEVELOPMENT_TEAM="$team" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$identity" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  ENABLE_HARDENED_RUNTIME=YES MACOSX_DEPLOYMENT_TARGET="$minimum_macos" \
  ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO \
  -quiet build > "$run_dir/xcodebuild.log" 2>&1 || {
    tail -n 70 "$run_dir/xcodebuild.log"
    exit 1
  }

stage="$(mktemp -d "$run_dir/stage.XXXXXX")"
payload="$stage/payload"
mkdir "$payload"
ditto "$products/Kiss Translator.app" "$payload/Kiss Translator.app"
ln -s /Applications "$payload/Applications"
cp scripts/safari/INSTALL.zh-CN.md "$payload/安装说明.md"
cp LICENSE "$payload/LICENSE.txt"
node scripts/safari/verify-package.mjs "$payload/Kiss Translator.app" \
  --development-team "$team" --signing-certificate "$identity" > "$run_dir/staged-verification.json"

/usr/bin/hdiutil create -srcfolder "$payload" -volname "Kiss Translator $version" \
  -fs HFS+ -format UDZO "$stage/$image_name"
/usr/bin/hdiutil verify "$stage/$image_name"
mount_dir="$(mktemp -d "$run_dir/mount.XXXXXX")"
/usr/bin/hdiutil attach "$stage/$image_name" -readonly -nobrowse -noautoopen \
  -mountpoint "$mount_dir" -plist > "$run_dir/mount.plist"
[[ -L "$mount_dir/Applications" && "$(readlink "$mount_dir/Applications")" == /Applications ]]
cmp scripts/safari/INSTALL.zh-CN.md "$mount_dir/安装说明.md"
cmp LICENSE "$mount_dir/LICENSE.txt"
node scripts/safari/verify-package.mjs "$mount_dir/Kiss Translator.app" \
  --development-team "$team" --signing-certificate "$identity" > "$run_dir/final-image-verification.json"

# Retain the actual final DMG web resources for regression tests without an App.
mounted_resources="$mount_dir/Kiss Translator.app/Contents/PlugIns/Kiss Translator Extension.appex/Contents/Resources"
if [[ -e "$resource_dir" || -L "$resource_dir" ]]; then
  diff -qr "$mounted_resources" "$resource_dir"
else
  mkdir -p "$(dirname "$resource_dir")"
  ditto "$mounted_resources" "$stage/extension-resources"
  mv -n "$stage/extension-resources" "$resource_dir"
  diff -qr "$mounted_resources" "$resource_dir"
fi
unregister_bundle "$mount_dir/Kiss Translator.app"
/usr/bin/hdiutil detach "$mount_dir"
rmdir "$mount_dir"
mount_dir=''

(cd "$stage" && shasum -a 256 "$image_name" > "$image_name.sha256")
mv -n "$stage/$image_name" "$image_path"
[[ ! -e "$stage/$image_name" ]] || { echo "Refusing to overwrite $image_path" >&2; exit 1; }
image_published=1
mv -n "$stage/$image_name.sha256" "$checksum_path"
[[ ! -e "$stage/$image_name.sha256" ]] || { echo "Refusing to overwrite $checksum_path" >&2; exit 1; }
checksum_published=1
(cd dist && shasum -a 256 -c "$image_name.sha256")
release_ready=1
