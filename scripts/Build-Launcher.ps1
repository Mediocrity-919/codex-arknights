param([string]$OutputDirectory,[string]$IconPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$dist = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$references = @('System.dll','System.Core.dll','System.Xaml.dll','System.Web.Extensions.dll','System.Drawing.dll','System.Windows.Forms.dll','WPF\WindowsBase.dll','WPF\PresentationCore.dll','WPF\PresentationFramework.dll')
$buildDist=if($OutputDirectory){[IO.Path]::GetFullPath($OutputDirectory)}else{$dist}
New-Item -ItemType Directory -Path $buildDist -Force | Out-Null
$arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+',('/out:' + (Join-Path $buildDist 'ArkBoot.exe')),('/win32manifest:' + (Join-Path $projectRoot 'launcher\app.manifest')))
if(-not $IconPath){$iconPath = Join-Path $dist 'ChatGPT-Launcher.ico'}
if(-not (Test-Path -LiteralPath $iconPath)) { $null = & (Join-Path $PSScriptRoot 'Update-Launcher-Icon.ps1') }
$arguments += '/win32icon:' + $iconPath
foreach($reference in $references) { $arguments += '/reference:' + (Join-Path $framework $reference) }
foreach($reference in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.Wpf.dll')) {
    $path = Join-Path $dist $reference
    if(-not (Test-Path -LiteralPath $path)) { throw 'Run scripts/Fetch-Launcher-Assets.py before building.' }
    $arguments += '/reference:' + $path
}
$arguments += Join-Path $projectRoot 'launcher\BootHost.cs'
& $compiler $arguments
if($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
Write-Output (Join-Path $buildDist 'ArkBoot.exe')

