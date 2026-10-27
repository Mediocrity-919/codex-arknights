param([switch]$RemoveUserData)
$ErrorActionPreference='Stop'
$installRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)).TrimEnd('\')
$record=Join-Path $installRoot '.install-manifest.json'
if(-not(Test-Path -LiteralPath $record)){throw '未找到本安装的文件清单，未删除任何文件'}
$installed=Get-Content -Encoding UTF8 -LiteralPath $record -Raw | ConvertFrom-Json
if($installed.root -ne $installRoot){throw '安装清单与当前目录不匹配'}
& (Join-Path $PSScriptRoot 'Stop-Theme.ps1') -Quiet
if($installed.boundExisting){& (Join-Path $PSScriptRoot 'Bind-Codex-Launch.ps1') -Restore}
. (Join-Path $PSScriptRoot 'Windows-Shortcut.ps1')
foreach($linkPath in $installed.shortcuts){if(Test-Path -LiteralPath $linkPath){$link=Get-ThemeShortcut -Path $linkPath;if($link.TargetPath -eq (Join-Path $installRoot 'dist\ArkBoot.exe')){Remove-Item -LiteralPath $linkPath}}}
if($installed.registry){$key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ArkWorkspace';if((Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).InstallLocation -eq $installRoot){Remove-Item -LiteralPath $key -Recurse}}
if($RemoveUserData){
    # Delete only files enumerated in the resource catalog, never entire media roots.
    $catalog=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $installRoot 'resources\catalog.json') -Raw | ConvertFrom-Json
    foreach($asset in $catalog.files.PSObject.Properties){foreach($variant in $asset.Value.PSObject.Properties){$target=[IO.Path]::GetFullPath((Join-Path $installRoot $variant.Value.file));if(-not $target.StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '素材路径越界'};if(Test-Path -LiteralPath $target){Remove-Item -LiteralPath $target}}}
    $local=[IO.Path]::GetFullPath((Join-Path $installRoot '.local'))
    if(-not $local.StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '数据路径越界'}
    if(Test-Path -LiteralPath $local){if((Get-Item -LiteralPath $local).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '数据目录为链接，已保留'};Remove-Item -LiteralPath $local -Recurse -Force}
}
$preserved=@()
foreach($file in $installed.files){
    $target=[IO.Path]::GetFullPath((Join-Path $installRoot $file.path))
    if(-not $target.StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '卸载路径越界'}
    if(Test-Path -LiteralPath $target){if((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $file.sha256){Remove-Item -LiteralPath $target -Force}else{$preserved+=$file.path}}
}
[IO.File]::WriteAllText((Join-Path $installRoot '.ark-workspace-data.json'),(@{schemaVersion=1;root=$installRoot;uninstalledVersion=$installed.version}|ConvertTo-Json),(New-Object Text.UTF8Encoding $false))
Remove-Item -LiteralPath $record
Write-Output "程序已卸载，Codex 保持运行。默认保留已下载素材和个人设置。保留的已修改程序文件：$($preserved.Count)"
