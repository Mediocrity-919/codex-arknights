# Codex Arknights 0.12.0 · Windows Beta

免费、非盈利的社区桌面伴随程序，与 OpenAI、鹰角网络无官方隶属关系。这是测试版（Pre-release）。

## 下载和运行

下载 **codex-arknights-0.12.0-windows-x64.zip** 并完整解压。保存工作、正常退出客户端后，双击 `ARK启动Codex.cmd` 或 `dist/ArkBoot.exe`；需要安装时运行 `安装.cmd`。

EXE 是启动器，需要整个目录的运行环境与脚本，不能单独复制运行。Windows ZIP 自带 Node；源码包不含运行依赖。校验值见 checksums-0.12.0.json。

## 环境

Windows x64，建议 Windows 11；适配 OpenAI.Codex Windows 应用包，实测客户端版本 26.1016.8622.0。需要 PowerShell 5.1、.NET Framework 4.x；完整动画需要 WebView2 Runtime。FFmpeg 与 AI 4K 工具均为可选配置。

## 内容

- 启动动画、静态背景与干员分层构图、动态时装顺序连播。
- 壁纸中心、同步浮动调节、多播放队列、已存组合。
- 单项素材下载、进度、重试、删除、原片／可选 4K。
- 动作交接有效帧保护、预载复用；连续缓存默认磁盘预算 2 GiB，按需串行构建。
- 可移植安装、卸载和恢复原启动入口。
