$ErrorActionPreference='Stop'
$themeRoot=Split-Path -Parent $PSScriptRoot
$probe=& (Join-Path $PSScriptRoot 'Probe-Host.ps1') | ConvertFrom-Json
if($probe.running){throw '请先保存工作并完整退出 Codex，再运行此冷启动验证。测试不会强制关闭客户端。'}
$started=Get-Date
$launcher=Start-Process -FilePath (Join-Path $themeRoot 'dist\ArkBoot.exe') -ArgumentList '--auto' -PassThru
if(-not $launcher.WaitForExit(60000)){throw '启动器未在限定时间退出；保留进程以便排查'}
$result=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $themeRoot '.local\launcher-last-run.json') -Raw | ConvertFrom-Json
if((Get-Item -LiteralPath (Join-Path $themeRoot '.local\launcher-last-run.json')).LastWriteTime -lt $started){throw '未获得本次启动结果'}
$layer=& (Join-Path $PSScriptRoot 'Repair-Window-Layer.ps1') | ConvertFrom-Json
$passed=$result.completed -and $result.themeReady -and $result.webViewDisposed -and -not $layer.afterTopmost
$report=@{at=(Get-Date -Format o);passed=[bool]$passed;launcher=$result;mainWindowTopmost=$layer.afterTopmost;manualChecks=@('点击输入框＋选择文件','打开其他应用并切回','打开第二个 Codex 窗口后选择接入目标')}
$report|ConvertTo-Json -Depth 8|Set-Content -LiteralPath (Join-Path $themeRoot '.local\cold-start-verification.json') -Encoding UTF8
if(-not $passed){throw '冷启动未通过，详情见 .local/cold-start-verification.json'}
Write-Output '冷启动通过：壁纸首帧、启动器退出、WebView 释放、主窗口未置顶。请再人工核对附件弹窗与多窗口。'
