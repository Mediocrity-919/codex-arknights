param([ValidateRange(0,65535)][int]$Port = 0)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Theme-Connection.ps1')
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$report = [ordered]@{ observedAt = [DateTime]::UtcNow.ToString('o'); platform = 'windows'; package = $null; running = $false; mainPid = $null; debugPort = $Port; debuggerVerified = $false; listener = $null; reason = ''; pets = 'requires-ui-verification' }
try {
    $package = Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -First 1
    if (-not $package) { throw '未发现当前用户安装的 OpenAI.Codex 应用包' }
    $exe = Join-Path $package.InstallLocation 'app\ChatGPT.exe'
    if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $package.InstallLocation 'app\Codex.exe' }
    $report.package = [ordered]@{ version = $package.Version.ToString(); family = $package.PackageFamilyName; executable = $exe }
    $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe' OR Name = 'Codex.exe'")
    $mainCandidates = @($processes | Where-Object { $_.ExecutablePath -eq $exe -and $_.CommandLine -notmatch '--type(?:=|\s)' })
    $report.running = $mainCandidates.Count -gt 0
    $commandPort = 0
    if ($mainCandidates.Count -eq 1) {
        $report.mainPid = $mainCandidates[0].ProcessId
        $commandPort = Get-ThemeCommandPort $mainCandidates[0].CommandLine
    }
    $report.debugPort = $(if($Port -gt 0){$Port}else{$commandPort})
    $listeners = @()
    if($report.debugPort -gt 0) { $listeners = @(Get-NetTCPConnection -LocalPort $report.debugPort -State Listen -ErrorAction SilentlyContinue) }
    if ($listeners.Count -gt 0) {
        $owners = @($listeners.OwningProcess | Select-Object -Unique)
        $loopbackOnly = @($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }).Count -eq 0
        if ($owners.Count -eq 1 -and $owners[0] -eq $report.mainPid -and $loopbackOnly -and $commandPort -eq $report.debugPort -and $commandPort -gt 0) {
            $report.debuggerVerified = $true
            $report.listener = [ordered]@{ pid = $owners[0]; address = ($listeners.LocalAddress -join ','); port = $report.debugPort }
            $report.reason = '已核对监听端口属于当前安装包的主进程，且只监听回环地址'
        } else { $report.reason = '端口占用者或绑定地址未通过校验；拒绝连接' }
    } elseif ($report.running) { $report.reason = 'Codex 正在运行，但未发现本工具所需的调试入口；先保存工作，退出后使用专用启动脚本' }
    else { $report.reason = 'Codex 尚未运行；可使用专用启动脚本进行接入验证' }
} catch { $report.reason = $_.Exception.Message }
$report | ConvertTo-Json -Depth 5 -Compress
