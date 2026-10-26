param([string]$ResultFile, [string]$LaunchId = ([guid]::NewGuid().ToString('N')))
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Theme-Connection.ps1')
. (Join-Path $PSScriptRoot 'Runtime.ps1')
. (Join-Path $PSScriptRoot 'Boot-Readiness.ps1')
$expectedVersion=Get-ThemeVersion
$local = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $local -Force | Out-Null
if($LaunchId -notmatch '^[a-f0-9]{32}$') { throw 'Invalid launch identifier' }
$status = [ordered]@{launchId=$LaunchId;pid=0;phase=0;clientReady=$false;debugPort=0;themeReady=$false;finished=$false;message='正在启动 Codex'}
if($ResultFile) {
    $ResultFile = [IO.Path]::GetFullPath($ResultFile)
    if(-not $ResultFile.StartsWith([IO.Path]::GetFullPath($local) + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Result must stay in .local' }
}
function Publish-Status {
    $text = $status | ConvertTo-Json -Compress
    if($ResultFile) {
        $temporary = $ResultFile + '.tmp'
        [IO.File]::WriteAllText($temporary,$text,(New-Object System.Text.UTF8Encoding $false))
        # PowerShell 5 coerces $null to an empty string for this overload.
        # NullString preserves a genuine null backup path for File.Replace.
        if(Test-Path -LiteralPath $ResultFile) { [IO.File]::Replace($temporary,$ResultFile,[NullString]::Value) }
        else { [IO.File]::Move($temporary,$ResultFile) }
    }
}
function Read-ThemeSession {
    try {
        $saved = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $local 'session.json') -Raw | ConvertFrom-Json
        $uri = [uri]$saved.url
        if($uri.Host -ne '127.0.0.1' -or $uri.Scheme -ne 'http' -or -not $uri.Fragment) { return $null }
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$saved.pid)"
        $server = Join-Path $projectRoot 'src\server.mjs'
        $validCommand = $owner.CommandLine -like ('*' + $server + '*') -or $owner.CommandLine -match '(?:\s|\")src[\\/]server\.mjs(?:\s|\"|$)'
        $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $uri.Port -State Listen -ErrorAction SilentlyContinue
        if($owner.Name -ne 'node.exe' -or -not $validCommand -or $listener.OwningProcess -ne $saved.pid) { return $null }
        $headers = @{'X-Lab-Token'=$uri.Fragment.TrimStart('#');Origin=$uri.GetLeftPart('Authority')}
        # Identity is independent of response speed. Do not spawn duplicate helpers
        # merely because an otherwise verified helper is briefly busy.
        return @{saved=$saved;uri=$uri;headers=$headers}
    } catch { return $null }
}
$lock = New-Object Threading.Mutex($false,('Local\ArkThemeService-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value))
$locked = $false
try {
    Publish-Status
    try { $locked = $lock.WaitOne(40000) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if(-not $locked) { throw '另一个启动任务仍在连接，请稍后重试' }
    $probe = & (Join-Path $PSScriptRoot 'Probe-Host.ps1') | ConvertFrom-Json
    if(-not $probe.package) { throw $probe.reason }
    if(-not $probe.running) {
        # Old Chromium listeners may remain reserved after their parent exits.
        # Select another port without terminating any process or blocking Codex.
        $startPort = Get-AvailableThemePort
        $status.debugPort = $startPort
        $status.message = '正在启动 Codex 并连接主题'; Publish-Status
        # The visible Codex window is the user's requested application.
        Start-Process -FilePath $probe.package.executable -ArgumentList ("--remote-debugging-port=$startPort"),'--remote-debugging-address=127.0.0.1'
        for($attempt=0;$attempt -lt 8;$attempt++) {
            Start-Sleep -Milliseconds 400
            $probe = & (Join-Path $PSScriptRoot 'Probe-Host.ps1') | ConvertFrom-Json
            if($probe.running -and $probe.debuggerVerified) { break }
        }
    }
    if(-not $probe.running -or -not $probe.mainPid) { throw '未发现唯一的 Codex 主进程' }
    $main = Get-CimInstance Win32_Process -Filter "ProcessId=$($probe.mainPid)" | Where-Object { $_.ExecutablePath -eq $probe.package.executable -and $_.CommandLine -notmatch '--type=' }
    if(-not $main) { throw 'Codex 进程验证未通过' }
    $status.pid = [int]$main.ProcessId
    $status.clientReady = $true
    $status.debugPort = $probe.debugPort
    $status.phase = 1; $status.message = '正在连接主题'; Publish-Status
    if(-not $probe.debuggerVerified) {
        $status.message = '先进入 Codex；壁纸需完整退出后从桌面 Codex 重新启动'
        return
    }
    $session = Read-ThemeSession
    if($session -and $session.saved.version -ne $expectedVersion) {
        # This script independently verifies the helper PID/port before updating it.
        $null = & (Join-Path $PSScriptRoot 'Update-LocalTheme.ps1')
        $session = $null
    } elseif(-not $session) {
        $runtime = Get-ThemeNode
        $server = Join-Path $projectRoot 'src\server.mjs'
        Start-Process -FilePath $runtime -ArgumentList ('"'+$server+'"'),'--auto-attach' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $local "service-$LaunchId.log") -RedirectStandardError (Join-Path $local "service-$LaunchId.error.log") | Out-Null
    }
    if($session) {
        $existing=$null
        try {$existing=Get-ThemeReadiness $session} catch {}
        if(-not $existing -or -not $existing.native.applied -or $existing.native.hostPid -ne $status.pid){
            try {
                $null = Invoke-RestMethod -Uri ($session.uri.GetLeftPart('Authority')+'/api/native') -Headers $session.headers -Method Post -ContentType 'application/json' -Body '{"action":"apply","media":"video"}' -TimeoutSec 20
            } catch [System.Net.WebException] {
                # An apply request can still be running after the caller times out,
                # or an existing attach may return 409. Readiness polling owns the deadline.
                if($_.Exception.Status -ne [Net.WebExceptionStatus]::Timeout -and [int]$_.Exception.Response.StatusCode -ne 409){throw}
            }
        }
    }
    $status.phase = 2; $status.message = '正在准备壁纸首帧'; Publish-Status
    $null=Wait-ThemeReadiness -Session $session -ReadSession {Read-ThemeSession} -ExpectedVersion $expectedVersion -HostPid $status.pid
    $status.themeReady = $true; $status.phase = 3; $status.message = '壁纸已就绪 · 正在进入'

} catch {
    $status.message = $_.Exception.Message
    [IO.File]::WriteAllText((Join-Path $local "boot-service-$LaunchId.error.log"),($_ | Out-String),(New-Object System.Text.UTF8Encoding $false))
} finally {
    try {
        $status.finished = $true; Publish-Status
        if(-not $ResultFile) { $status | ConvertTo-Json -Compress }
    } finally {
        if($locked) { $lock.ReleaseMutex() }; $lock.Dispose()
    }
}
