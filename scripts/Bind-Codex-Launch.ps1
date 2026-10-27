param([switch]$Restore)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$launcher = Join-Path $projectRoot 'dist\ArkBoot.exe'
$backupRoot = Join-Path $projectRoot '.local\shortcut-backups'
$manifestPath = Join-Path $backupRoot 'binding.json'
$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$pinned = Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'
. (Join-Path $PSScriptRoot 'Windows-Shortcut.ps1')
function Check-LinkPath([string]$path) {
    $full = [IO.Path]::GetFullPath($path)
    if([IO.Path]::GetExtension($full) -ne '.lnk') { throw 'Only shortcut files can be bound' }
    if(-not (@($desktop,$programs,$pinned) | Where-Object { $full.StartsWith(([IO.Path]::GetFullPath($_)+'\'),[StringComparison]::OrdinalIgnoreCase) })) { throw 'Shortcut outside supported user folders' }
    return $full
}
if($Restore) {
    if(-not (Test-Path -LiteralPath $manifestPath)) { Write-Output 'No bound shortcuts to restore'; return }
    $manifest = Get-Content -Encoding UTF8 -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach($entry in $manifest.entries) {
        $destination = Check-LinkPath $entry.path
        if(Test-Path -LiteralPath $destination) {
            $current = (Get-ThemeShortcut -Path $destination)
            if($current.TargetPath -ne $launcher -or $current.Arguments -ne '--auto') { Write-Output "Skipped externally changed shortcut: $destination"; continue }
        }
        if($entry.backup) {
            $backup = [IO.Path]::GetFullPath((Join-Path $backupRoot $entry.backup))
            if(-not $backup.StartsWith($backupRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup path escaped backup directory' }
            if((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Shortcut backup checksum changed' }
            Copy-Item -LiteralPath $backup -Destination $destination -Force
        } elseif(Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination }
        Write-Output "Restored: $destination"
    }
    $restoredManifest=Join-Path $backupRoot ('binding-restored-'+[guid]::NewGuid().ToString('N')+'.json')
    Move-Item -LiteralPath $manifestPath -Destination $restoredManifest
    return
}
if(-not (Test-Path -LiteralPath $launcher)) { throw 'Build the formal launcher first' }
$probe = & (Join-Path $PSScriptRoot 'Probe-Host.ps1') | ConvertFrom-Json
if(-not $probe.package) { throw 'Installed Codex package not found' }
$nativeExe = $probe.package.executable
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$entries = @()
if(Test-Path -LiteralPath $manifestPath) { $entries = @((Get-Content -Encoding UTF8 -LiteralPath $manifestPath -Raw | ConvertFrom-Json).entries) }
$candidates = @()
foreach($folder in @($desktop,$programs,$pinned)) {
    if(Test-Path -LiteralPath $folder) {
        foreach($item in Get-ChildItem -LiteralPath $folder -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue) {
            $link = (Get-ThemeShortcut -Path $item.FullName)
            if($link.TargetPath -eq $nativeExe -or $link.TargetPath -eq $launcher) { $candidates += $item.FullName }
        }
    }
}
$desktopLink = Join-Path $desktop 'Codex.lnk'
if(Test-Path -LiteralPath $desktopLink) {
    $current = (Get-ThemeShortcut -Path $desktopLink)
    if($current.TargetPath -ne $nativeExe -and $current.TargetPath -ne $launcher) { throw 'Desktop Codex.lnk belongs to a different application; preserved' }
}
$candidates += $desktopLink
$iconPath = & (Join-Path $PSScriptRoot 'Update-Launcher-Icon.ps1') -NativeExecutable $nativeExe
foreach($candidate in ($candidates | Select-Object -Unique)) {
    $destination = Check-LinkPath $candidate
    if(-not ($entries | Where-Object { $_.path -eq $destination })) {
        $backup = $null; $checksum=$null
        if(Test-Path -LiteralPath $destination) {
            $backup = [guid]::NewGuid().ToString('N')+'.lnk'
            Copy-Item -LiteralPath $destination -Destination (Join-Path $backupRoot $backup)
            $checksum = (Get-FileHash -LiteralPath (Join-Path $backupRoot $backup) -Algorithm SHA256).Hash
        }
        $entries += [pscustomobject]@{path=$destination;backup=$backup;sha256=$checksum}
        # Save recovery information before changing the shortcut.
        @{launcher=$launcher;entries=$entries} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
    }
    Save-ThemeShortcut -Path $destination -TargetPath $launcher -Arguments '--auto' -WorkingDirectory $projectRoot -Description 'Codex' -IconPath $iconPath
    $check = (Get-ThemeShortcut -Path $destination)
    if($check.TargetPath -ne $launcher -or $check.Arguments -ne '--auto' -or $check.IconLocation -ne ($iconPath+',0')) { throw 'Shortcut verification failed' }
    Write-Output "Bound: $destination"
}
