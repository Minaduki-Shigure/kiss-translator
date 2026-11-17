# Kiss Translator Safari 自用签名版

本包包含 macOS Safari Web Extension 容器 App，支持 Apple Silicon 与 Intel Mac，最低 macOS 13。网页翻译仍由 Safari 扩展运行。

1. 打开 DMG，将 **Kiss Translator.app** 拖入 **Applications（应用程序）**。
2. 推出 DMG，再从“应用程序”打开 **Kiss Translator**。不要从映像内运行，避免 Safari 同时发现多个副本。
3. 在容器 App 中打开 Safari 扩展设置，勾选 Kiss Translator。
4. 按需允许扩展访问要翻译的网站，在扩展设置中配置翻译服务。服务密钥由你自行填写；此包不包含任何 API 密钥。
5. 刷新待翻译网页，用工具栏、右键菜单或设置中的快捷键开始翻译。

此版本使用现有 **Apple Development** 证书签名，供个人开发与自用；它不是 Developer ID 签名且经 Apple 公证的公开发行版。macOS 可能在首次启动时提示开发者未验证，此时请在系统设置“隐私与安全性”中确认来源后允许打开。不要关闭整个系统的 Gatekeeper。

从 2.1.x 升级到 2.2.x 前，请先在扩展设置中导出配置备份。退出容器 App，用新版替换“应用程序”中的同名 App，推出映像，再打开容器并刷新网页。每个版本保持相同 Bundle ID；升级后请核对翻译服务、站点规则和网站授权。

构建流程验证了签名、通用架构、版本及 DMG 内扩展资源。网页授权、翻译源网络可用性、付费额度及实际 Safari 交互仍取决于本机设置与第三方服务。此 Safari 版本不提供 Chrome BuiltinAI、LocalAI 本地推理或外部服务插件的运行环境。以前保存的这些服务配置会保留；需要继续翻译时，请自行选择可用服务，扩展不会将明确选用本地服务的文本自动改发给云端。

## 来源与源码

Kiss Translator 的上游作者是 Gabe / fishjar 及项目贡献者；本 Safari 移植由 Minaduki-Shigure 的 fork 维护。上游 GPLv3 许可全文随包提供为 `LICENSE.txt`。对含有 Terser 可识别许可注释的 JavaScript 分包，扩展资源内保留对应的 `*.js.LICENSE.txt`，文件名亦见分包首行；这些文件不是所有依赖的完整许可证清单。

- 上游源码：[fishjar/kiss-translator](https://github.com/fishjar/kiss-translator)
- Safari 移植源码及构建脚本：[Minaduki-Shigure/kiss-translator，safari/macos-port 分支](https://github.com/Minaduki-Shigure/kiss-translator/tree/safari/macos-port)
- 复现入口：仓库中的 `safari.config.json`、`native/safari/`、`src/scripts/build-safari.mjs` 与 `scripts/safari/`。签名私钥保留在本机钥匙串，不包含在源码或安装包中；签名中的公开证书用于验证发布者。
