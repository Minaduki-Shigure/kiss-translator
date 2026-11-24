import Cocoa
import SafariServices

// Substituted from safari.config.json by the project generator.
private let extensionBundleIdentifier = "__SAFARI_EXTENSION_BUNDLE_IDENTIFIER__"

final class ViewController: NSViewController {
    private let statusLabel = NSTextField(wrappingLabelWithString: "正在读取扩展状态…")
    private var activationObserver: NSObjectProtocol?

    override func viewDidLoad() {
        super.viewDidLoad()
        // Native AppKit avoids the converter's WKWebView startup/sandbox failure.
        let icon = NSImageView(image: NSApp.applicationIconImage)
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 72),
            icon.heightAnchor.constraint(equalToConstant: 72),
        ])

        let title = NSTextField(labelWithString: "Kiss Translator")
        title.font = .systemFont(ofSize: 26, weight: .semibold)
        let description = makeLabel("在 Safari 中阅读双语网页、翻译选中文字与输入内容。")
        let instructions = makeLabel("在 Safari 扩展设置中启用 Kiss Translator，并允许访问需要翻译的网站。翻译服务、密钥和规则请在扩展的设置页面中配置。")
        statusLabel.alignment = .center
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 13)

        let preferences = NSButton(title: "打开 Safari 扩展设置", target: self, action: #selector(openPreferences))
        preferences.bezelStyle = .rounded
        preferences.controlSize = .large
        preferences.keyEquivalent = "\r"
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        let footer = makeLabel("版本 \(version) · 构建 \(build)\n启用后可关闭此窗口，扩展将继续在 Safari 中运行。")
        footer.font = .systemFont(ofSize: 11)
        footer.textColor = .secondaryLabelColor

        let stack = NSStackView(views: [icon, title, description, instructions, statusLabel, preferences, footer])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 38),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -38),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            instructions.widthAnchor.constraint(equalTo: stack.widthAnchor),
            description.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            footer.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        activationObserver = NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshState()
        }
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        refreshState()
    }

    deinit {
        if let observer = activationObserver { NotificationCenter.default.removeObserver(observer) }
    }

    private func makeLabel(_ text: String) -> NSTextField {
        let label = NSTextField(wrappingLabelWithString: text)
        label.alignment = .center
        label.font = .systemFont(ofSize: 13)
        return label
    }

    private func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let state, error == nil {
                    self.statusLabel.stringValue = state.isEnabled ? "扩展已启用。请在网页中使用 Safari 工具栏按钮。" : "扩展尚未启用。请打开 Safari 扩展设置。"
                } else {
                    self.statusLabel.stringValue = "暂时无法读取状态，请在 Safari 设置 > 扩展中查看。"
                }
            }
        }
    }

    @objc private func openPreferences() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { [weak self] error in
            DispatchQueue.main.async {
                if error != nil {
                    self?.statusLabel.stringValue = "无法自动打开设置。请打开 Safari > 设置 > 扩展，并启用 Kiss Translator。"
                }
            }
        }
    }
}
