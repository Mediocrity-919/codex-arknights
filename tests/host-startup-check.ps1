$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot 'scripts\Theme-Connection.ps1')
function Assert-True($condition,[string]$message) { if(-not $condition) { throw $message } }
Assert-True ((Get-ThemeCommandPort '"C:\test\ChatGPT.exe" --remote-debugging-port=51234') -eq 51234) 'Alternate port was not parsed'
Assert-True ((Get-ThemeCommandPort 'app --remote-debugging-port "51235"') -eq 51235) 'Quoted port was not parsed'
foreach($command in @('app','app --remote-debugging-port=0','app --remote-debugging-port=70000','app --remote-debugging-port=9376oops')) {
    Assert-True ((Get-ThemeCommandPort $command) -eq 0) 'Invalid port was accepted'
}
$occupied = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$occupied.ExclusiveAddressUse=$true;$occupied.Start()
try {
    $blockedPort = $occupied.LocalEndpoint.Port
    $chosen = Get-AvailableThemePort $blockedPort
    Assert-True ($chosen -ne $blockedPort -and $chosen -gt 0) 'Occupied port did not fall back'
    $check = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$chosen)
    try { $check.ExclusiveAddressUse=$true;$check.Start() } finally { $check.Stop() }
} finally { $occupied.Stop() }

# Exercise the production probe with controlled process/listener snapshots.
$global:ArkProbeMockExe = 'C:\ArkFixture\app\ChatGPT.exe'
$global:ArkProbeMockProcesses = @([pscustomobject]@{ProcessId=1234;ExecutablePath=$global:ArkProbeMockExe;CommandLine='app --remote-debugging-port=51234'})
$global:ArkProbeMockListeners = @([pscustomobject]@{OwningProcess=1234;LocalAddress='127.0.0.1';LocalPort=51234})
function Get-AppxPackage { param($Name) [pscustomobject]@{InstallLocation='C:\ArkFixture';Version='1.0';PackageFamilyName='Fixture'} }
function Get-CimInstance { param($ClassName,$Filter) $global:ArkProbeMockProcesses }
function Get-NetTCPConnection { param($LocalPort,$State,$ErrorAction) $global:ArkProbeMockListeners | Where-Object {$_.LocalPort -eq $LocalPort} }
function Test-Path { param($LiteralPath) if($LiteralPath -eq $global:ArkProbeMockExe){return $true};Microsoft.PowerShell.Management\Test-Path -LiteralPath $LiteralPath }
$probeScript = Join-Path $projectRoot 'scripts\Probe-Host.ps1'
$result = & $probeScript | ConvertFrom-Json
Assert-True ($result.debuggerVerified -and $result.debugPort -eq 51234) 'Verified alternate port was rejected'
$global:ArkProbeMockListeners[0].OwningProcess=9999
Assert-True (-not (& $probeScript | ConvertFrom-Json).debuggerVerified) 'Foreign port owner accepted'
$global:ArkProbeMockListeners[0].OwningProcess=1234;$global:ArkProbeMockListeners[0].LocalAddress='0.0.0.0'
Assert-True (-not (& $probeScript | ConvertFrom-Json).debuggerVerified) 'Non-loopback listener accepted'
$global:ArkProbeMockListeners[0].LocalAddress='127.0.0.1'
Assert-True (-not (& $probeScript -Port 9376 | ConvertFrom-Json).debuggerVerified) 'Mismatched explicit port accepted'
$global:ArkProbeMockProcesses[0].CommandLine='app'
$global:ArkProbeMockListeners=@([pscustomobject]@{OwningProcess=9999;LocalAddress='127.0.0.1';LocalPort=9376})
$result = & $probeScript | ConvertFrom-Json
Assert-True ($result.running -and $result.mainPid -eq 1234 -and -not $result.debuggerVerified -and $result.debugPort -eq 0) 'Plain client was confused with stale listener'
$global:ArkProbeMockProcesses=@()
Assert-True (-not (& $probeScript | ConvertFrom-Json).running) 'Stale listener was treated as a running client'
Write-Output 'PASS: free-port fallback, alternate-port discovery, process ownership, loopback-only validation, stale-listener isolation.'
