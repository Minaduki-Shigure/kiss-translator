# Kiss Translator Safari 公证版

本包包含 macOS Safari 扩展和容器 App，支持 Apple Silicon 与 Intel。App、扩展与 DMG 由 Minaduki Technologies LLC 的 Developer ID Application 证书签名。App 与 DMG 均经 Apple 公证，并已装订票据。

## 安装与升级

1. 已使用旧版的用户，请先在扩展设置导出配置并保存备份。
2. 退出 Kiss Translator 容器 App，打开 DMG，将 **Kiss Translator.app** 拖入 **Applications（应用程序）**，替换旧版。
3. 推出 DMG，然后从“应用程序”打开 Kiss Translator。
4. 打开 Safari 扩展设置并启用 Kiss Translator，核对翻译服务、站点规则及网站访问授权。需要时导入刚才保存的配置。
5. 刷新待翻译网页，通过工具栏、右键菜单或快捷键翻译。

从 `2.2.5-safari.2` 起，公证版使用 Minaduki Technologies LLC 的签名团队。仍使用更早个人开发签名版的用户，首次升级会跨团队，原配置与网站授权能否自动沿用尚未经用户资料实测，请完成导出后再替换。公证验证覆盖安装包、票据和代码签名。

站外公证的 Safari Web Extension 需要 Safari 18.4 或更新版本。最低容器部署目标为 macOS 13。当前构建已在 macOS 15.8.2 验证，所有旧系统组合尚未逐一实测。翻译服务密钥在扩展设置中由用户填写。LocalAI 本地推理、外部服务插件和 PDF/EPUB 文件桥仍待移植，依赖 Origin 改写的接口可能受 WebKit 限制。

## 来源与源码

Kiss Translator 的上游作者是 Gabe / fishjar 及项目贡献者，本 Safari 移植由 Minaduki-Shigure 的 fork 维护。GPLv3 许可全文随包提供为 `LICENSE.txt`，JavaScript 分包中提取的许可说明保留于相应 `*.js.LICENSE.txt`。

- [上游源码](https://github.com/fishjar/kiss-translator)
- [Safari 源码及构建脚本](https://github.com/Minaduki-Shigure/kiss-translator/tree/safari/macos-port)
- [发行记录及 SHA-256 校验文件](https://github.com/Minaduki-Shigure/kiss-translator/releases)
