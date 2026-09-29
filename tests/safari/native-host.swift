import Cocoa
import WebKit
import Network
import CryptoKit

// This is an isolated WebKit browser host, not automation of the user's Safari.
// All public extension APIs are real. No extension API mocks are installed.
@MainActor final class ProbeTab: NSObject, WKWebExtensionTab {
    let view: WKWebView
    weak var owner: ProbeWindow?
    init(view: WKWebView) { self.view = view }
    func webView(for context: WKWebExtensionContext) -> WKWebView? { view }
    func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { owner }
    func indexInWindow(for context: WKWebExtensionContext) -> Int { 0 }
    func isSelected(for context: WKWebExtensionContext) -> Bool { true }
}

@MainActor final class ProbeWindow: NSObject, WKWebExtensionWindow {
    let tab: ProbeTab
    init(tab: ProbeTab) { self.tab = tab; super.init(); tab.owner = self }
    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] { [tab] }
    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? { tab }
    func isPrivate(for context: WKWebExtensionContext) -> Bool { false }
    func frame(for context: WKWebExtensionContext) -> CGRect { CGRect(x: 0, y: 0, width: 1000, height: 800) }
}

@MainActor final class ProbeDelegate: NSObject, WKWebExtensionControllerDelegate {
    var window: ProbeWindow?
    func webExtensionController(_ controller: WKWebExtensionController, openWindowsFor context: WKWebExtensionContext) -> [any WKWebExtensionWindow] {
        window.map { [$0] } ?? []
    }
    func webExtensionController(_ controller: WKWebExtensionController, focusedWindowFor context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { window }
}

@main @MainActor struct SafariNativeProbe {
    static func emit(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let string = String(data: data, encoding: .utf8) else { return }
        print(string); fflush(stdout)
    }

    static func pause(_ seconds: Double = 0.05) async {
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
    }

    static func load(_ view: WKWebView, _ url: URL) async throws {
        view.load(URLRequest(url: url))
        for _ in 0..<160 {
            await pause()
            if !view.isLoading, view.url == url,
               (try? await view.evaluateJavaScript("document.readyState")) as? String == "complete" { return }
        }
        throw NSError(domain: "Probe", code: 1, userInfo: [NSLocalizedDescriptionKey: "Timed out loading \(url)"])
    }

    static func execute(_ view: WKWebView, file: URL, config: [String: Any]) async throws -> [String: Any] {
        let script = try String(contentsOf: file, encoding: .utf8)
        let result = try await view.callAsyncJavaScript(script, arguments: ["config": config], in: nil, contentWorld: .page)
        return result as? [String: Any] ?? ["passed": false, "error": "Script returned no object"]
    }

    static func run() async throws -> Bool {
        guard CommandLine.arguments.count == 4 else {
            throw NSError(domain: "Probe", code: 2, userInfo: [NSLocalizedDescriptionKey: "usage: native-host EXTENSION_DIRECTORY TEST_DIRECTORY CONFIG_JSON"])
        }
        let resources = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let tests = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        let config = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3]))) as! [String: Any]
        let fixtureURL = URL(string: config["fixtureURL"] as! String)!
        let port = NWEndpoint.Port(rawValue: UInt16(config["proxyPort"] as! Int))!
        var proxy = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: "127.0.0.1", port: port))
        proxy.allowFailover = false
        proxy.excludedDomains = ["127.0.0.1", "localhost"]
        let store = WKWebsiteDataStore.nonPersistent()
        store.proxyConfigurations = [proxy]
        let webConfig = WKWebViewConfiguration()
        webConfig.websiteDataStore = store
        let hostConfig = WKWebExtensionController.Configuration.nonPersistent()
        hostConfig.defaultWebsiteDataStore = store
        hostConfig.webViewConfiguration = webConfig
        let controller = WKWebExtensionController(configuration: hostConfig)
        let delegate = ProbeDelegate()
        controller.delegate = delegate
        let ext = try await WKWebExtension(resourceBaseURL: resources)
        let context = WKWebExtensionContext(for: ext)
        context.isInspectable = true
        context.hasAccessToPrivateData = true
        for permission in ext.requestedPermissions {
            context.setPermissionStatus(.grantedExplicitly, for: permission)
        }
        for pattern in ["http://127.0.0.1/*", "http://localhost/*"] {
            context.setPermissionStatus(.grantedExplicitly, for: try WKWebExtension.MatchPattern(string: pattern))
        }
        webConfig.webExtensionController = controller
        let page = WKWebView(frame: CGRect(x: 0, y: 0, width: 1000, height: 800), configuration: webConfig)
        let tab = ProbeTab(view: page)
        let window = ProbeWindow(tab: tab)
        delegate.window = window
        try controller.load(context)
        context.didOpenWindow(window)
        context.didFocusWindow(window)
        context.didOpenTab(tab)
        try await context.loadBackgroundContent()
        emit(["event": "loaded", "engine": "public WKWebExtensionController", "system": ProcessInfo.processInfo.operatingSystemVersionString,
              "webKitVersion": Bundle(identifier: "com.apple.WebKit")?.infoDictionary?["CFBundleVersion"] ?? "unknown",
              "resourceDirectory": resources.path, "manifestVersion": ext.manifest["manifest_version"] ?? NSNull(),
              "extensionErrors": ext.errors.map(\.localizedDescription), "ephemeral": true])
        var hashes: [String: String] = [:]
        for name in ["manifest.json", "content.js", "background.js", "injector-shadowroot.js", "injector-subtitle.js"] {
            if let bytes = try? Data(contentsOf: resources.appendingPathComponent(name)) {
                hashes[name] = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
            }
        }
        emit(["event": "resource-sha256", "files": hashes])

        let extensionConfig = context.webViewConfiguration!
        let probe = WKWebView(frame: CGRect(x: 0, y: 0, width: 720, height: 720), configuration: extensionConfig)
        try await load(probe, context.baseURL.appendingPathComponent("probe.html"))
        let seed = try await execute(probe, file: tests.appendingPathComponent("seed.js"), config: config)
        emit(["event": "storage-seed", "detail": seed])
        try await load(page, fixtureURL)
        let integration = try await execute(probe, file: tests.appendingPathComponent("probe.js"), config: config)
        emit(["event": "integration", "detail": integration])

        // Load the unmodified production options and popup resources under the real extension origin.
        let options = WKWebView(frame: CGRect(x: 0, y: 0, width: 1100, height: 800), configuration: extensionConfig)
        try await load(options, context.baseURL.appendingPathComponent("options.html"))
        var optionsDOM: [String: Any] = [:]
        for _ in 0..<100 {
            optionsDOM = (try? await options.evaluateJavaScript("({ready:document.readyState,text:document.body.innerText,rootChildren:document.querySelector('#root')?.childElementCount||0})")) as? [String: Any] ?? [:]
            if (optionsDOM["rootChildren"] as? Int ?? 0) > 0, (optionsDOM["text"] as? String ?? "").count > 80 { break }
            await pause()
        }
        let optionsPass = (optionsDOM["rootChildren"] as? Int ?? 0) > 0 && (optionsDOM["text"] as? String ?? "").count > 80
        emit(["event": "options-resources", "passed": optionsPass, "detail": optionsDOM])
        let action = context.action(for: tab)
        let popup = action?.popupWebView
        var popupDOM: [String: Any] = [:]
        if let popup {
            for _ in 0..<100 {
                popupDOM = (try? await popup.evaluateJavaScript("({ready:document.readyState,text:document.body.innerText,rootChildren:document.querySelector('#root')?.childElementCount||0})")) as? [String: Any] ?? [:]
                if (popupDOM["rootChildren"] as? Int ?? 0) > 0,
                   (popupDOM["text"] as? String ?? "").contains("Translate this page"),
                   (popupDOM["text"] as? String ?? "").contains("Local fixture") { break }
                await pause()
            }
        }
        let popupPass = (popupDOM["rootChildren"] as? Int ?? 0) > 0
            && (popupDOM["text"] as? String ?? "").contains("Translate this page")
            && (popupDOM["text"] as? String ?? "").contains("Local fixture")
        emit(["event": "popup-resources", "passed": popupPass, "detail": popupDOM, "shown": false])
        let cspURL = URL(string: "/csp", relativeTo: fixtureURL)!.absoluteURL
        try await load(page, cspURL)
        var cspConfig = config
        cspConfig["stage"] = "before-removal"
        let csp = try await execute(probe, file: tests.appendingPathComponent("csp-probe.js"), config: cspConfig)
        emit(["event": "strict-csp-injection", "detail": csp])
        // Reload to observe actual response-header effects, not just accepted rules.
        await pause(0.3)
        try await load(page, URL(string: "/csp?after-dnr", relativeTo: fixtureURL)!.absoluteURL)
        cspConfig["stage"] = "after-removal"
        let cspDNR = try await execute(probe, file: tests.appendingPathComponent("csp-probe.js"), config: cspConfig)
        emit(["event": "csp-response-header", "detail": cspDNR])
        let report = try? await probe.callAsyncJavaScript("return await (await fetch(config.apiURL + '/report')).json();", arguments: ["config": config], in: nil, contentWorld: .page)
        emit(["event": "network-report", "detail": report ?? NSNull()])
        emit(["event": "context-errors", "errors": context.errors.map(\.localizedDescription)])
        action?.closePopup()
        page.stopLoading(); options.stopLoading(); probe.stopLoading()
        try controller.unload(context)
        return seed["passed"] as? Bool == true && integration["passed"] as? Bool == true && optionsPass && popupPass && csp["passed"] as? Bool == true
    }

    static func main() {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        Task { @MainActor in
            do {
                let passed = try await run()
                emit(["result": passed ? "PASS" : "FAIL", "scope": "Isolated WKWebExtension host; not Safari UI or signed-package validation"])
                exit(passed ? 0 : 1)
            } catch {
                let error = error as NSError
                emit(["result": "FAIL", "error": error.localizedDescription, "detail": String(describing: error.userInfo)])
                exit(1)
            }
        }
        Task { @MainActor in
            await pause(55)
            emit(["result": "FAIL", "error": "Native integration probe exceeded 55 seconds"])
            exit(2)
        }
        NSApp.run()
    }
}
