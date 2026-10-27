$ErrorActionPreference='Stop'
$themeRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$fixture=[IO.Path]::GetFullPath((Join-Path $themeRoot ('.local\shortcut-test-'+[guid]::NewGuid().ToString('N'))))
if(-not $fixture.StartsWith((Join-Path $themeRoot '.local')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Unexpected fixture root'}
foreach($folder in @('scripts','dist','desktop','programs','pinned')){New-Item -ItemType Directory -Path (Join-Path $fixture $folder)-Force|Out-Null}
# Repoint only the three folder sources in the production script; all COM link
# creation, checksum backups, bind/restore and collision checks remain unchanged.
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'Bind-Codex-Launch.ps1'))
$source=$source.Replace('$desktop = [Environment]::GetFolderPath(''Desktop'')','$desktop = Join-Path $projectRoot ''desktop''').Replace('$programs = [Environment]::GetFolderPath(''Programs'')','$programs = Join-Path $projectRoot ''programs''').Replace('$pinned = Join-Path $env:APPDATA ''Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar''','$pinned = Join-Path $projectRoot ''pinned''')
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\Bind-Codex-Launch.ps1'),$source,(New-Object Text.UTF8Encoding $true))
$native=Join-Path $env:WINDIR 'System32\notepad.exe'
$probe=@{package=@{executable=$native}}|ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\Probe-Host.ps1'),("Write-Output '"+$probe+"'"),(New-Object Text.UTF8Encoding $true))
[IO.File]::WriteAllText((Join-Path $fixture 'scripts\Update-Launcher-Icon.ps1'),'param([string]$NativeExecutable) Join-Path (Split-Path $PSScriptRoot -Parent) ''dist\fixture.ico''',(New-Object Text.UTF8Encoding $true))
Copy-Item -LiteralPath (Join-Path $themeRoot 'dist\ArkBoot.exe') -Destination (Join-Path $fixture 'dist\ArkBoot.exe')
Copy-Item -LiteralPath (Join-Path $themeRoot 'dist\ChatGPT-Launcher.ico') -Destination (Join-Path $fixture 'dist\fixture.ico')
. (Join-Path $themeRoot 'scripts\Windows-Shortcut.ps1')
Copy-Item -LiteralPath (Join-Path $themeRoot 'scripts\Windows-Shortcut.ps1') -Destination (Join-Path $fixture 'scripts\Windows-Shortcut.ps1')
$links=@((Join-Path $fixture 'desktop\Codex.lnk'),(Join-Path $fixture 'programs\ChatGPT.lnk'))
$hashes=@{}
try{
    foreach($linkPath in $links){Save-ThemeShortcut -Path $linkPath -TargetPath $native -Arguments '' -WorkingDirectory $fixture -Description 'Original fixture' -IconPath '';$hashes[$linkPath]=(Get-FileHash -LiteralPath $linkPath -Algorithm SHA256).Hash}
    & (Join-Path $fixture 'scripts\Bind-Codex-Launch.ps1')|Out-Null
    foreach($linkPath in $links){$link=Get-ThemeShortcut -Path $linkPath;if($link.TargetPath -ne (Join-Path $fixture 'dist\ArkBoot.exe')){throw 'Fixture link was not bound'}}
    & (Join-Path $fixture 'scripts\Bind-Codex-Launch.ps1') -Restore|Out-Null
    foreach($linkPath in $links){if((Get-FileHash -LiteralPath $linkPath -Algorithm SHA256).Hash -ne $hashes[$linkPath]){throw 'Restored link differs from original'}}
    if(Test-Path -LiteralPath (Join-Path $fixture '.local\shortcut-backups\binding.json')){throw 'Restored active binding manifest was not archived'}
    & (Join-Path $fixture 'scripts\Bind-Codex-Launch.ps1')|Out-Null
    & (Join-Path $fixture 'scripts\Bind-Codex-Launch.ps1') -Restore|Out-Null
    $report=@{boundAndRestored=$true;originalBytesPreserved=$true;rebindAfterRestore=$true;realDesktopUntouched=$true}
    $report|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $themeRoot 'test-results\shortcut-recovery.json') -Encoding UTF8
    $report|ConvertTo-Json
}finally{
    if(-not $fixture.StartsWith((Join-Path $themeRoot '.local')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing cleanup outside fixture'}
    Remove-Item -LiteralPath $fixture -Recurse -Force
}
