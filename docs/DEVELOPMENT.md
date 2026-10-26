# 开发与构建

源码要求 Node.js 24.14+；运行 `node --test tests/*.test.mjs`。没有 FFmpeg 或本地素材时，相应集成用例会跳过；其余核心用例照常运行。

浏览器验收脚本还需安装对应的 Playwright 等依赖，通过 `ARK_TEST_MODULES` 指向开发依赖目录。`native-*` 脚本面向已有本机接入环境，不属于普通用户安装步骤。服务生成的本地地址包含认证信息，不能公开。

## Windows 完整包

使用 Windows PowerShell 5.1、.NET Framework 4.x 编译器及 Node.js x64。首次准备启动器 SDK 和字体时需要 Python 标准库与网络：

```powershell
python scripts/Fetch-Launcher-Assets.py
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Build-Release.ps1
```

构建脚本读取 `resources/release-files.json`，只复制列出的公开目录和文件。`-SourceOnly` 仅生成源码包；`-NodePath` 可指定 Node x64 程序。完整 ZIP 包含启动器、Node、WebView2 SDK 依赖、字体和许可，不含 WebView2 Runtime 安装程序、FFmpeg、模型或游戏素材。

`release-manifest.json` 记录程序文件 SHA-256，用于安装校验与卸载。发布目录同时生成下载校验文件。运行 `scripts/portable-install-check.ps1 -Archive <完整ZIP>` 可在 release 下隔离验证便携安装、保留数据的卸载与重装，不操作真实桌面快捷方式。

## 素材目录

`resources/catalog.json` 是相对路径和来源元数据，不包含资源文件。素材下载逻辑位于 `src/resource-manager.mjs`，可选处理工具位于 `tools/resource-fetcher/`；具体以当前文件为准。获取依据见仓库根目录 `背景资源获取.md`。不要提交 `.local`、缓存、模型、日志或个人素材。
