$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Theme-Connection.ps1')
$probe = & (Join-Path $PSScriptRoot 'Probe-Host.ps1') | ConvertFrom-Json
if (-not $probe.package) { throw $probe.reason }
if ($probe.running) {
    Write-Host '请先保存工作，并从托盘完全退出 Codex，再运行此脚本。脚本不会结束现有会话。' -ForegroundColor Yellow
    Read-Host '按回车退出'
    exit 1
}
$startPort = Get-AvailableThemePort
Write-Host '启动一次本机主题验证会话。调试接口仅限回环地址；退出 Codex 后失效。'
Write-Host '未修改原快捷方式、安装包、登录信息或持久配置。'
Start-Process -FilePath $probe.package.executable -ArgumentList ("--remote-debugging-port=$startPort"),'--remote-debugging-address=127.0.0.1'
& (Join-Path $PSScriptRoot 'Start-Lab.ps1')
