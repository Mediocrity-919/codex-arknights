# 第三方组件与资源

本仓库 MIT 许可覆盖本项目代码与原创界面资产，不授予第三方游戏图片、视频、商标、字体、模型权重或上游程序的新许可。

- Node.js：Windows 包携带实际构建版本的 `node.exe`，相应完整许可随包放在 `runtime/node/LICENSE.txt`。来源：https://nodejs.org/ 、https://github.com/nodejs/node 。
- Microsoft WebView2：用于独立启动动画；Windows 包附带 SDK 库与 `dist/WebView2-LICENSE.txt`。系统需要已安装 Evergreen WebView2 Runtime，缺失时启动器有原生文字回退。来源：https://developer.microsoft.com/microsoft-edge/webview2/ 。
- 启动动画字体：Oxanium 与 Share Tech Mono，依据 SIL Open Font License 使用；字体与对应 OFL 文本位于 `launcher/ui/fonts/`。来源：https://github.com/google/fonts 。
- 明日方舟素材：来源目录见 `resources/catalog.json` 和 `背景资源获取.md`。安装包与源码包不包含游戏视频、立绘、背景或模型权重。官方视频来源：https://ak.hypergryph.com/archive/dynamicCompile ；社区图源：https://prts.wiki/ 、https://wiki.biligame.com/arknights/ 。使用与后续分发需遵守各来源条件。
- 可选 FFmpeg：由用户独立配置，普通包不携带其二进制。其许可随具体构建选项而变化；不要把本机含额外编解码器的版本直接加入公开包。
- 可选 Real-ESRGAN 模型：用户提供 `realesr-animevideov3-x2` 权重；不包含在仓库或普通包内。上游：https://github.com/xinntao/Real-ESRGAN 。
- 启动器的客户端品牌图标来自本机已安装客户端，仅用于本机快捷方式。公开构建应采用项目原创图标，不将客户端品牌资产作为独立资源再分发。

本项目是社区独立项目，与 OpenAI、鹰角网络及资料站没有隶属关系。4K 版本是可选的本机 AI 派生处理，不代表官方原生 4K。
