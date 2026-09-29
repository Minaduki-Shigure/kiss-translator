#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
extension_dir="${1:-$repo_dir/build/safari}"
if [[ ! -f "$extension_dir/manifest.json" ]]; then
  echo "Build the Safari target first; missing $extension_dir/manifest.json" >&2
  exit 2
fi
probe_dir="$(mktemp -d "${TMPDIR:-/tmp}/kiss-safari-native.XXXXXX")"
node_bin="${NODE_BINARY:-$(command -v node)}"
mkdir -p "$probe_dir/extension"
cp -R "$extension_dir/." "$probe_dir/extension/"
cp "$repo_dir/tests/safari/probe.html" "$probe_dir/extension/probe.html"
cp "$repo_dir/tests/safari/unlisted-injector.js" "$probe_dir/extension/unlisted-injector.js"
"$node_bin" "$repo_dir/tests/safari/mock-server.mjs" "$probe_dir/server.json" >"$probe_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for ((i=0; i<100; i++)); do
  [[ -f "$probe_dir/server.json" ]] && break
  sleep 0.05
done
[[ -f "$probe_dir/server.json" ]] || { cat "$probe_dir/server.log" >&2; exit 2; }
xcrun swiftc -parse-as-library -swift-version 5 -target "$(uname -m)-apple-macos15.4" \
  -module-cache-path "$probe_dir/module-cache" -framework Cocoa -framework WebKit -framework Network \
  "$repo_dir/tests/safari/native-host.swift" -o "$probe_dir/native-host"
echo "Native probe artifacts: $probe_dir" >&2
"$probe_dir/native-host" "$probe_dir/extension" "$repo_dir/tests/safari" "$probe_dir/server.json" \
  2>"$probe_dir/native-stderr.log" | tee "$probe_dir/results.jsonl"
