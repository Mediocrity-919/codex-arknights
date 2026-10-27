param([string]$Destination=(Join-Path $env:LOCALAPPDATA 'ArkWorkspace'),[switch]$BindExistingShortcuts,[switch]$SkipShortcuts,[switch]$SkipRegistry)
$ErrorActionPreference='Stop'
$packageRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$installRoot=[IO.Path]::GetFullPath($Destination).TrimEnd('\')
if($installRoot -eq [IO.Path]::GetPathRoot($installRoot).TrimEnd('\') -or $installRoot -eq $packageRoot){throw '请选择独立安装目录，不要覆盖当前包或磁盘根目录'}
$manifest=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $packageRoot 'release-manifest.json') -Raw | ConvertFrom-Json
$priorInstall=$null
if(Test-Path -LiteralPath $installRoot){
    if((Get-Item -LiteralPath $installRoot).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '安装目录不能是目录链接'}
    $existingRecord=Join-Path $installRoot '.install-manifest.json'
    if(Test-Path -LiteralPath $existingRecord){$priorInstall=Get-Content -Encoding UTF8 -LiteralPath $existingRecord -Raw|ConvertFrom-Json}
    $dataRecord=Join-Path $installRoot '.ark-workspace-data.json'
    $recognized=$false
    foreach($recordPath in @($existingRecord,$dataRecord)){if(Test-Path -LiteralPath $recordPath){$previous=Get-Content -Encoding UTF8 -LiteralPath $recordPath -Raw|ConvertFrom-Json;if($previous.root -ne $installRoot){throw '目标目录记录不匹配'};$recognized=$true}}
    if((Get-ChildItem -LiteralPath $installRoot -Force | Select-Object -First 1) -and -not $recognized){throw '目标目录不是已有主题安装；请选择空目录'}
    if(Test-Path -LiteralPath (Join-Path $installRoot 'scripts\Stop-Theme.ps1')){& (Join-Path $installRoot 'scripts\Stop-Theme.ps1') -Quiet}
}
foreach($file in $manifest.files){
    $source=[IO.Path]::GetFullPath((Join-Path $packageRoot $file.path))
    $target=[IO.Path]::GetFullPath((Join-Path $installRoot $file.path))
    if(-not $source.StartsWith($packageRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $target.StartsWith($installRoot+'\',[StringComparison]::OrdinalIgnoreCase)){throw '安装清单路径越界'}
    if((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.sha256){throw "安装文件校验失败：$($file.path)"}
}
New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
foreach($file in $manifest.files){
    $target=Join-Path $installRoot $file.path
    $parent=Split-Path -Parent $target
    if(Test-Path -LiteralPath $parent){$ancestor=Get-Item -LiteralPath $parent;while($ancestor.FullName.Length -ge $installRoot.Length){if($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw '安装文件夹含目录链接'};$ancestor=$ancestor.Parent;if(-not $ancestor){break}}}
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    if((Test-Path -LiteralPath $target) -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $file.sha256){$preserved=Join-Path $installRoot ('.local\program-backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'\'+$file.path);New-Item -ItemType Directory -Path (Split-Path -Parent $preserved) -Force|Out-Null;Copy-Item -LiteralPath $target -Destination $preserved -Force}
    Copy-Item -LiteralPath (Join-Path $packageRoot $file.path) -Destination $target -Force
}
$oldShortcuts=@();if($priorInstall){$oldShortcuts=@($priorInstall.shortcuts|Where-Object {$_})}
$installed=@{schemaVersion=1;root=$installRoot;version=$manifest.version;files=$manifest.files;shortcuts=@($oldShortcuts);boundExisting=([bool]$BindExistingShortcuts -or [bool]$priorInstall.boundExisting);registry=((-not $SkipRegistry) -or [bool]$priorInstall.registry)}
# Recovery manifest is written before touching shortcuts or registry.
$record=Join-Path $installRoot '.install-manifest.json'
[IO.File]::WriteAllText($record,($installed|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding $false))
if(-not $SkipShortcuts){
    if($BindExistingShortcuts){& (Join-Path $installRoot 'scripts\Bind-Codex-Launch.ps1')}
    else{
        $linkPath=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Codex 壁纸版.lnk'
        $shell=New-Object -ComObject WScript.Shell
        if(Test-Path -LiteralPath $linkPath){$old=$shell.CreateShortcut($linkPath);if($old.TargetPath -ne (Join-Path $installRoot 'dist\ArkBoot.exe')){throw '同名快捷方式属于其他程序，已保留'}}
        . (Join-Path $installRoot 'scripts\Windows-Shortcut.ps1')
        Save-ThemeShortcut -Path $linkPath -TargetPath (Join-Path $installRoot 'dist\ArkBoot.exe') -Arguments '--auto' -WorkingDirectory $installRoot -Description 'Codex' -IconPath (Join-Path $installRoot 'dist\ChatGPT-Launcher.ico')
        $installed.shortcuts=@(($installed.shortcuts+@($linkPath))|Select-Object -Unique)
    }
}
if(-not $SkipRegistry){
    $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ArkWorkspace'
    New-Item -Path $key -Force | Out-Null
    $values=@{DisplayName='ARK Workspace (Windows beta)';DisplayVersion=$manifest.version;InstallLocation=$installRoot;UninstallString=('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $installRoot 'scripts\Uninstall-Theme.ps1')+'"');DisplayIcon=(Join-Path $installRoot 'dist\ArkBoot.exe')}
    foreach($entry in $values.GetEnumerator()){New-ItemProperty -Path $key -Name $entry.Key -Value $entry.Value -PropertyType String -Force | Out-Null}
}
[IO.File]::WriteAllText($record,($installed|ConvertTo-Json -Depth 8),(New-Object Text.UTF8Encoding $false))
Write-Output "安装完成：$installRoot。默认保留原 Codex 入口。素材可在壁纸中心按需下载。"
