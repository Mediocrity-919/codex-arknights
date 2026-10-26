$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
. (Join-Path $PSScriptRoot 'Runtime.ps1')
$sessionPath = Join-Path $taskRoot '.local\session.json'
if (Test-Path -LiteralPath $sessionPath) {
    $session = Get-Content -Encoding UTF8 -LiteralPath $sessionPath -Raw | ConvertFrom-Json
    $uri = [Uri]$session.url
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($session.pid)"
    if ($process) {
        if ($process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'src[\\/]server\.mjs') { throw 'The saved PID is not the theme helper.' }
        $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $uri.Port -State Listen -ErrorAction Stop
        if ($listener.OwningProcess -ne $session.pid) { throw 'The helper port owner changed.' }
        if([version]$session.version -ge [version]'0.11.0') { & (Join-Path $PSScriptRoot 'Stop-Theme.ps1') -Quiet }
        else {
        $removed = $false
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            try {
                $result = Invoke-RestMethod -Uri ($uri.GetLeftPart('Authority') + '/api/native') -Method Post -Headers @{'X-Lab-Token'=$uri.Fragment.TrimStart('#');Origin=$uri.GetLeftPart('Authority')} -ContentType 'application/json' -Body '{"action":"remove"}'
                $removed = $true
                break
            } catch { Start-Sleep -Milliseconds 300 }
        }
        if (-not $removed) { throw 'Could not detach the current theme helper.' }
        Stop-Process -Id $session.pid
        }
    }
}
# Reorganize only the four user-provided videos, within this workspace.
$moves = @(
    @('背景-邀月.mp4','动态壁纸\背景\邀月\背景-邀月.mp4'),
    @('纯烬艾雅法拉-1.mp4','动态壁纸\干员\06_医疗\纯烬艾雅法拉\纯烬艾雅法拉-1.mp4'),
    @('黍-1.mp4','动态壁纸\干员\03_重装\黍\黍-1.mp4'),
    @('黍-2.mp4','动态壁纸\干员\03_重装\黍\黍-2.mp4')
)
foreach ($pair in $moves) {
    $source = [IO.Path]::GetFullPath((Join-Path $taskRoot $pair[0]))
    $destination = [IO.Path]::GetFullPath((Join-Path $taskRoot $pair[1]))
    foreach ($target in @($source,$destination)) {
        if (-not $target.StartsWith($taskRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Move escaped the workspace.' }
    }
    if (Test-Path -LiteralPath $source) {
        if (Test-Path -LiteralPath $destination) { throw 'Destination exists; no files will be overwritten.' }
        New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
        Move-Item -LiteralPath $source -Destination $destination
    }
}
foreach ($folder in @('01_先锋','02_近卫','03_重装','04_狙击','05_术师','06_医疗','07_辅助','08_特种')) {
    New-Item -ItemType Directory -Path (Join-Path $taskRoot "动态壁纸\干员\$folder") -Force | Out-Null
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$serverFile=Join-Path $taskRoot 'src\server.mjs'
$helper = Start-Process -FilePath (Get-ThemeNode) -ArgumentList ('"'+$serverFile+'"'),'--auto-attach' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRoot ".local\server-$stamp.log") -RedirectStandardError (Join-Path $taskRoot ".local\server-$stamp.error.log") -PassThru
Write-Output "Updated local theme helper PID: $($helper.Id)"
