$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Runtime.ps1')
try {
    $saved = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot '.local\session.json') -Raw | ConvertFrom-Json
    $uri = [uri]$saved.url
    if($uri.Host -eq '127.0.0.1' -and $uri.Scheme -eq 'http') {
        $state = Invoke-RestMethod -Uri ($uri.GetLeftPart([System.UriPartial]::Authority) + '/api/state') -Headers @{ 'X-Lab-Token' = $uri.Fragment.TrimStart('#') } -TimeoutSec 2
        if($state.serviceVersion -eq (Get-ThemeVersion)) { Start-Process -FilePath $saved.url; exit 0 }
    }
} catch { }
$runtime = Get-ThemeNode
if (-not $runtime) {
    Write-Host '当前为开发雏形，需要 Node.js 22 或更新版本。正式安装包将包含运行环境。' -ForegroundColor Yellow
    Read-Host '按回车退出'
    exit 1
}
Push-Location -LiteralPath $projectRoot
try { & $runtime 'src/server.mjs' '--open' } finally { Pop-Location }
