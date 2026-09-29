# Safari 维护与安装

此 fork 的 `safari/macos-port` 分支维护 macOS Safari Web Extension。翻译核心继续跟随 [fishjar/kiss-translator](https://github.com/fishjar/kiss-translator)，保留原有 GPL v3 许可证。首个 Safari 构建基于上游提交 `8bbe4e5d44143fc85111c0a25909031769b20d89`。

## 安装

使用 `dist/Kiss-Translator-<releaseVersion>-macOS-universal-development-signed.dmg`，将 App 拖入应用程序后推出映像，再打开 App 并进入 Safari 扩展设置。详细步骤见 [安装说明](../scripts/safari/INSTALL.zh-CN.md)。

当前包使用 **Apple Development** 证书为容器和扩展签名，支持 Apple Silicon 与 Intel。它不是 Developer ID 签名且经 Apple 公证的公开分发包。证书、网站访问授权和翻译接口配置均以自己的账户与设备为准；源码及安装包不含翻译 API 密钥。

建议使用 Safari 18.4 或更新版本；本次维护在 Safari 26.6.1 / macOS 15.7.9 上进行。原生容器部署目标为 macOS 13，尚未对所有旧系统组合做实机测试。iOS 尚不在本次签名包的交付范围。

## 平台适配

| 功能 | Safari 处理 |
|---|---|
| 网页双语、划词、输入框翻译、悬浮按钮、规则与生词 | 保留现有实现；Safari 使用真正的扩展存储与后台请求 |
| 远程 AI、普通翻译 API、批量与 SSE 流式请求 | 保留浏览器后台 fetch / Port 链路；连接提前关闭时明确报错，避免一直等待；可用性依赖所选接口与网站授权 |
| YouTube 字幕、动态 Shadow DOM | 使用包内脚本的 MAIN world 注入，限定请求者的标签页和 frame，避免网页 CSP 拦截 script 标签 |
| Chrome BuiltinAI | Safari 禁用该接口，保留导入配置；显式选择本地模型时提示不可用，不自动切换远程服务 |
| 本地语言判断 | i18n.detectLanguage 缺失时使用已有保守字符/词频快判；无法确定时交给翻译服务自动识别，也可选择远程检测 |
| 朗读 | 保留 Web Speech fallback，不申请 Safari 不支持的 tts 权限 |
| 设置与同步 | storage.local + unlimitedStorage；WebDAV、KISS-Worker、Gist 保留原协议，不依赖 Safari storage.sync |
| 快捷键 | 保留 manifest commands；设置按钮提供 Safari 操作提示 |
| 剪贴板 | 保留用户操作触发的复制/粘贴；不启用 Chrome/Firefox 专有的自动剪贴板监听 |
| CSP / Origin 改写与有道词典 | 保留 DNR；扩展自身请求的头修改存在 WebKit 平台差异，须结合测试记录判断，不承诺所有接口均一致 |

Safari 的网站授权独立于 manifest。首次启用后应授予需要翻译的网站权限；如接口域名未获授权，后台请求也可能失败。扩展不会替用户修改 Safari 权限或禁用系统安全设置。

## 构建与签名

需要 Node.js（上游 CI 使用 24）、pnpm 9.14.4、macOS 与完整 Xcode。先安装依赖：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build:safari
```

`build:safari-output` 仅生成 `build/safari`；`build:safari` 还会生成 `build/Kiss Translator/Kiss Translator.xcodeproj`。构建调用不会自动打开 Xcode 或启用扩展。Apple converter 的部分警告落后于 Safari 实际支持，例如 `type: module` 和 `match_about_blank`，不得仅为消除警告而删除已支持的功能。

发布元数据集中在 `safari.config.json`：`version` 与 package.json / manifest 一致，`buildNumber` 每次发布递增，`releaseVersion` 区分本 fork 的 Safari 修订。不要修改已交付版本的同名 DMG。

从 `security find-identity -v -p codesigning` 选择自己的 Apple Development 证书，将团队 ID 与证书 SHA-1 指纹作为参数传入：

```sh
bash scripts/safari/package-development.sh "$TEAM_ID" "$CERT_SHA1" --skip-build
```

省略 `--skip-build` 会先重新生成 Safari 工程。私钥保留在系统钥匙串，不复制进仓库或 CI；deploy key 只用于 Git，不能替代 Apple 签名凭据。

打包脚本构建 universal Release，校验 App/appex 的真实证书、团队、有效期、entitlements、hardened runtime、版本及每个扩展资源；创建 DMG 后只读挂载并再次核验，保存 SHA-256。最终镜像中的 Web 资源单独留在 `build/safari-release-resources/<releaseVersion>/extension` 供回归测试。临时 App/appex 与精确路径注册在本次打包结束时移除，避免 Safari 出现重复扩展。

## 验证

首版安装包与已验证范围见 [2.1.0-safari.1 验证记录](SAFARI-2.1.0-safari.1.md)。

```sh
CI=true pnpm test --watchAll=false --maxWorkers=2
pnpm test:safari:native
```

原生集成测试使用隔离的 `WKWebExtensionController` 与本地 fixture/mock API，避免调用真实翻译账号。它能验证系统 WebKit 扩展 API 和真实打包代码，但不替代 Safari 工具栏、网站授权、签名安装及第三方服务端到端验收。每次发布记录应明确是哪一级证据，不将普通浏览器单测视为 Safari 实测。

该测试宿主需要 macOS 15.4 或更新版本；这不是容器 App 的最低部署版本。测试方法和边界见 [原生测试说明](../tests/safari/README.md)。当前已在隔离宿主验证真实内容脚本的整页双语翻译、跨上下文存储、后台跨域请求、SSE、设置页和工具栏弹窗资源，以及严格 CSP 下的 MAIN world 注入与重复注入保护。

同一宿主中，DNR 规则虽被接受，但扩展请求的 Origin 改写和网页 CSP 响应头删除未生效。依赖这些能力的服务（例如部分有道词典请求）仍需在实际 Safari 中核实；普通翻译不依赖网页 CSP 删除，新版打包注入已绕开这项依赖。视频站字幕、第三方付费服务、同步和朗读仍保留原实现，尚未完成真实服务逐项验收。

## 更新上游

保持 `origin` 指向本 fork、`upstream` 指向 fishjar/kiss-translator。合并上游前建立分支或 bundle 备份，保留 Safari 专用构建、原生模板和回归测试。更新依赖时使用固定 pnpm 版本并审查锁文件变化；不要将 build、dist、私钥、证书或本地账户配置提交到 Git。

当前维护分支：https://github.com/Minaduki-Shigure/kiss-translator/tree/safari/macos-port

官方平台参考：[Apple 打包](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)、[运行与临时加载](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension)、[分发签名](https://developer.apple.com/documentation/safariservices/distributing-your-safari-web-extension)、[WebKit 自身请求头改写问题](https://bugs.webkit.org/show_bug.cgi?id=253696)。
