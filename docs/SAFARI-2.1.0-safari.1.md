# Safari 2.1.0-safari.1 验证记录

日期：2026-09-29。首个 macOS Safari 移植版本，基于上游 `8bbe4e5d44143fc85111c0a25909031769b20d89`。应用与扩展版本为 `2.1.0`，原生构建号 `2010001`。

## 安装包

文件：`Kiss-Translator-2.1.0-safari.1-macOS-universal-development-signed.dmg`

SHA-256：

```text
2b3cebc9d9781b675a9568e2c92e1d14a13ca9617b55b1b6754c02bc3e1f4f25
```

安装方法见 [安装说明](../scripts/safari/INSTALL.zh-CN.md)。源码分支为 [safari/macos-port](https://github.com/Minaduki-Shigure/kiss-translator/tree/safari/macos-port)。DMG 与本机构建日志保存在维护工作区的 `dist/`、`build/`，不提交二进制或本机凭据到 Git。

## 已完成验证

- Node.js 26.0.0、本仓库固定 pnpm 9.14.4，锁文件未变；186 个 Jest 套件、3069 项测试通过。
- Safari 生产构建和 Xcode 26.3 universal Release 构建通过；原生容器与扩展同时包含 `arm64`、`x86_64`。Intel 架构已编译和验签，未在 Intel 实机运行。
- App 与 appex 的两种架构均使用有效的 **Apple Development** 证书签名，证书到期时间为 2027-09-07 17:22:45 UTC。检查了团队一致性、证书指纹、hardened runtime、sandbox，以及未启用 `get-task-allow`。
- `codesign --verify --deep --strict --all-architectures`、`hdiutil verify`、SHA-256 复核通过。DMG 只读挂载后复核了版本、架构、签名，以及 62 个构建资源逐文件字节一致性；许可证和安装说明亦已比对。
- 最终 DMG 中的扩展资源单独保存在 `build/safari-release-resources/2.1.0-safari.1/extension`，用于原生集成回归。
- 使用上述最终资源的隔离 WebKit 集成测试通过：存储、后台跨域 fetch、SSE、真实双语 DOM、设置/弹窗资源，以及严格 CSP 下的 MAIN 注入、幂等和白名单校验均通过，扩展上下文错误为空。测试记录的 5 个核心文件哈希与签名镜像一致，测试副本中的全部 62 个原始资源亦逐一匹配。
- 本次打包的所有临时 App/appex 与先前可行性试验的两个指定副本均已按精确路径注销并移除；没有遗留本次挂载，也没有修改已安装的二维码扩展或用户 Safari 配置。

此包未使用 Developer ID Application 证书，**未经 Apple 公证**，是供个人开发和自用的真实证书签名包。不是面向任意设备公开分发的公证发行包。

## 兼容性边界

运行环境为 macOS 15.7.9，安装的 Safari 为 26.6.1。容器部署目标是 macOS 13，建议 Safari 18.4 或更新版本；旧系统组合和 iOS 未验收。

隔离 WebKit 测试方法见 [测试说明](../tests/safari/README.md)。该宿主使用系统 `WKWebExtensionController` 和本地 mock API，不读取 Safari 配置、不调用真实翻译账号，也不代表 Safari 工具栏及权限界面已完成手动验收。

Chrome BuiltinAI 在 Safari 不可用。已禁用相关入口，保留导入配置并拒绝静默切换远程服务。Origin 请求头改写与 CSP 响应头删除在隔离宿主中未观测到生效；MAIN world 包内注入不依赖删除 CSP。真实翻译服务、视频站字幕、WebDAV/Gist 同步、朗读、剪贴板授权与浏览器重启后的持久化仍需结合实际账户和 Safari 环境验收。

## 本机证据

- 全量测试：`build/test-all-final.log`
- 最终生产构建：`build/build-safari-final.log`
- 签名打包：`build/package-safari-development-final.log`
- 最终镜像签名与逐资源哈希：`build/safari-package.VCHarN/final-image-verification.json`
- 最终镜像资源的原生集成测试：`build/native-final-2.1.0-safari.1.jsonl`
- 本次临时 App/appex 清理：`build/safari-package.VCHarN/cleanup.log`
- 先前可行性副本清理及最终注册核对：`build/safari-feasibility-cleanup.json`、`build/safari-registration-final.json`

这些路径属于本次构建的本机证据；后续复现会生成新的独立路径。维护与构建命令见 [Safari 维护说明](SAFARI.md)。
