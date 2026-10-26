$ErrorActionPreference='Stop'
function Get-ThemeNode {
    $runtimeRoot=Split-Path -Parent $PSScriptRoot
    $bundled=Join-Path $runtimeRoot 'runtime\node\node.exe'
    $candidate=if(Test-Path -LiteralPath $bundled){$bundled}else{(Get-Command node.exe -ErrorAction Stop).Source}
    $nodeVersion=& $candidate -p 'process.versions.node'
    if($LASTEXITCODE -ne 0 -or [version]$nodeVersion -lt [version]'24.14.0'){throw '需要 Node.js 24.14 或更新版本；请使用含运行环境的 Windows 包。'}
    return $candidate
}
function Get-ThemeVersion {
    return (Get-Content -Encoding UTF8 -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') -Raw | ConvertFrom-Json).version
}
