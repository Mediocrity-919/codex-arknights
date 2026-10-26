param([string]$NativeExecutable)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if(-not $NativeExecutable) {
    $package = Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -First 1
    if(-not $package) { throw 'Installed desktop package not found.' }
    $NativeExecutable = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
}
# Copy the complete official white icon. ExtractAssociatedIcon only retained
# one 32 px frame, which became visibly pixelated on high-DPI desktops.
$source = Join-Path (Split-Path -Parent $NativeExecutable) 'resources\chatgpt-app-dark.ico'
if(-not (Test-Path -LiteralPath $source)) { throw 'Official ChatGPT multi-resolution icon not found.' }
$destination = Join-Path $projectRoot 'dist\ChatGPT-Launcher.ico'
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Force
Write-Output $destination
