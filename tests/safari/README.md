# Isolated Safari/WebKit integration test

Run from the repository after building `build/safari`:

```sh
scripts/test-safari-native.sh
# Or verify resources extracted from a particular application bundle:
scripts/test-safari-native.sh /absolute/path/to/extension/resources
```

Requires macOS 15.4 or later, Xcode with the public `WKWebExtensionController` API, and Node.js. Set `NODE_BINARY` when Node is not on PATH. The script compiles a small Swift host and starts three loopback-only servers (fixture page, mock translation API, and a deny-by-default HTTP CONNECT proxy). No npm package installation or production rebuild is performed.

The host uses a nonpersistent extension controller and a separate nonpersistent website data store. It copies the supplied resources to a unique temporary directory, adding only `probe.html` and the allowlist-test `unlisted-injector.js`. The shipped manifest and JavaScript are unmodified. Its network proxy is confined to that data store and rejects non-loopback destinations. No real provider keys or paid services are used. Test settings disable subscriptions and update checks; initialization requests made before those settings are written are denied by the proxy and recorded.

The test does not launch or change Safari, register an app extension, alter Safari settings, read Safari profiles, or show a browser window. Temporary binaries, copied resources, `results.jsonl`, and stderr remain in the directory printed by the script for inspection. The local servers are stopped when the script exits. The Swift host has a 55-second watchdog.

## Assertions

- Load the actual MV3 extension and its background worker in the public WebKit extension runtime.
- Write/read `storage.local`, including Unicode, and read the same value from an actual isolated content-script execution context.
- Call the production `kiss_fetch` background handler from that context against a different local origin. The server deliberately sends no CORS allow header.
- Open the production `kiss_stream_fetch` runtime port, receive two separate SSE data events, and observe completion.
- Start the actual shipped `content.js`, select a local Custom API, trigger page translation through the production tab message handler, and check the two expected bilingual DOM translations.
- Execute in MAIN world through the actual scripting API.
- Render the production options page and real `WKWebExtension.Action.popupWebView`; require the popup to show the fixture page's selected service.
- Verify that a strict `script-src 'none'` response rejects ordinary inline script insertion, while the production packaged-injector message installs both MAIN-world hooks.
- Re-inject both packaged scripts and verify hook function identities are unchanged. Request a real, bundled test script outside the allowlist and verify its marker never executes.

`results.jsonl` records the operating system, loaded WebKit framework version, SHA-256 values for core shipped resources, per-check results, DOM evidence, actual mock-server requests, and denied external requests.

## Compatibility observations

DNR probes are recorded separately from core pass/fail. They verify effects rather than interpreting successful `updateDynamicRules()` calls as proof that headers changed:

1. A `modifyHeaders` rule with `excludedInitiatorDomains` attempts to change the Origin header on the real background fetch; the server reports the received header.
2. A response-header rule attempts to remove CSP from the local main document. The host waits and navigates again, then checks whether ordinary inline insertion is permitted.

On 2026-09-29, macOS 15.7.9 (24G830), WebKit framework `20621.3.11.11.3`, the core suite passed. Both DNR rules were accepted, but the background Origin remained `webkit-extension://…` and CSP still blocked inline script insertion after navigation. Therefore the test does **not** establish that Origin rewriting or CSP removal works in Safari. Packaged MAIN-world injection worked despite that restriction.

The initial passing run's evidence is in the machine-local temporary directory `kiss-safari-native.Ea3Y62/results.jsonl`; newer runs print their own evidence paths and supersede this snapshot. The background error for a rejected injector uses webextension-polyfill's serialized rejection envelope when received through native `browser.runtime.sendMessage` in the probe; the marker assertion tests non-execution independently of that transport representation.

## What this does not verify

This is a **WKWebExtensionController integration host, not Safari UI end-to-end testing**. It does not verify installation/signing/notarization, Safari's per-site permission prompts, toolbar interaction, restart persistence, iOS, the real translation providers, video-site behavior, audio playback, or long-running streams surviving background suspension. Storage is deliberately nonpersistent in this harness, so a successful roundtrip is not evidence of persistence across browser restarts.

The SSE probe validates the production background transport with a native content-context caller. Application request cancellation is additionally covered by the JavaScript request-stream unit tests; this test does not replace those lifecycle tests. The settings and popup assertions establish resource rendering, not a complete visual/accessibility review.
