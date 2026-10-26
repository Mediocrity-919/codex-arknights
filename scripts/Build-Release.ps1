param([switch]$SourceOnly,[string]$NodePath)
$ErrorActionPreference='Stop'
$themeRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
. (Join-Path $PSScriptRoot 'Runtime.ps1')
$version=Get-ThemeVersion
$output=Join-Path $themeRoot 'release'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$staging=Join-Path $output "staging-$stamp"
New-Item -ItemType Directory -Path $staging | Out-Null
$export=Get-Content -LiteralPath (Join-Path $themeRoot 'resources/release-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$artifactName=$export.artifactName
if($artifactName -notmatch '^[a-z0-9-]+$'){throw 'Invalid artifact name'}
$directories=@($export.directories)
$files=@($export.files)
foreach($relative in @($directories)+@($files)){
    $resolved=[IO.Path]::GetFullPath((Join-Path $themeRoot $relative))
    if(-not $resolved.StartsWith($themeRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolved)){throw "Invalid export path: $relative"}
}
foreach($directory in $directories){$source=Join-Path $themeRoot $directory;if(Test-Path -LiteralPath $source){foreach($file in Get-ChildItem -LiteralPath $source -File -Recurse -Force){if($file.FullName -match '[\\/](__pycache__|node_modules|\.local)[\\/]' -or $file.Extension -eq '.pyc'){continue};$destination=Join-Path $staging $file.FullName.Substring($themeRoot.Length+1);New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null;Copy-Item -LiteralPath $file.FullName -Destination $destination}}}
foreach($file in $files){$source=Join-Path $themeRoot $file;if(Test-Path -LiteralPath $source){$destination=Join-Path $staging $file;New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null;Copy-Item -LiteralPath $source -Destination $destination}}
# Cache/model/media binaries must never slip into the source archive.
$unexpected=Get-ChildItem -LiteralPath $staging -File -Recurse | Where-Object {$_.Extension -in @('.mp4','.bin','.pth','.exe','.dll','.lnk','.pyc') -or $_.FullName -match '[\\/](\.local|__pycache__)[\\/]'}
if($unexpected){throw '源码清单含运行数据或媒体，已停止打包'}
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $staging -Force).FullName -DestinationPath (Join-Path $output "$artifactName-$version-source.zip") -Force
if($SourceOnly){Write-Output (Join-Path $output "$artifactName-$version-source.zip");return}
if(-not $NodePath){$NodePath=Get-ThemeNode}
$node=(Resolve-Path -LiteralPath $NodePath).Path
$nodeVersion=(& $node -p 'process.versions.node').Trim()
if([version]$nodeVersion -lt [version]'24.14.0'){throw 'Node runtime is too old'}
if((& $node -p 'process.arch').Trim() -ne 'x64'){throw 'This package targets Windows x64; select an x64 Node runtime'}
$nodeDirectory=Join-Path $staging 'runtime\node';New-Item -ItemType Directory -Path $nodeDirectory -Force | Out-Null
Copy-Item -LiteralPath $node -Destination (Join-Path $nodeDirectory 'node.exe')
$licenseFile=Join-Path $output "node-$nodeVersion-LICENSE.txt"
if(-not(Test-Path -LiteralPath $licenseFile)){Invoke-WebRequest -Uri "https://raw.githubusercontent.com/nodejs/node/v$nodeVersion/LICENSE" -OutFile $licenseFile -UseBasicParsing}
Copy-Item -LiteralPath $licenseFile -Destination (Join-Path $nodeDirectory 'LICENSE.txt')
$dist=Join-Path $staging 'dist';New-Item -ItemType Directory -Path $dist | Out-Null
foreach($file in @('Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.Wpf.dll','WebView2Loader.dll','WebView2-LICENSE.txt')){Copy-Item -LiteralPath (Join-Path $themeRoot "dist\$file") -Destination $dist}
& (Join-Path $PSScriptRoot 'Create-Project-Icon.ps1') -Path (Join-Path $dist 'ChatGPT-Launcher.ico')
& (Join-Path $PSScriptRoot 'Build-Launcher.ps1') -OutputDirectory $dist -IconPath (Join-Path $dist 'ChatGPT-Launcher.ico') | Out-Null
$manifestFiles=@(Get-ChildItem -LiteralPath $staging -File -Recurse | ForEach-Object {@{path=$_.FullName.Substring($staging.Length+1).Replace('\','/');sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash;bytes=$_.Length}})
$manifest=@{schemaVersion=1;version=$version;platform='windows-x64';files=$manifestFiles}
[IO.File]::WriteAllText((Join-Path $staging 'release-manifest.json'),($manifest|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding $false))
Compress-Archive -LiteralPath (Get-ChildItem -LiteralPath $staging -Force).FullName -DestinationPath (Join-Path $output "$artifactName-$version-windows-x64.zip") -Force
Get-ChildItem -LiteralPath $output -Filter "$artifactName-$version-*.zip" | ForEach-Object { [pscustomobject]@{file=$_.Name;bytes=$_.Length;sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash} } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $output "checksums-$version.json") -Encoding UTF8
Write-Output (Join-Path $output "$artifactName-$version-windows-x64.zip")
