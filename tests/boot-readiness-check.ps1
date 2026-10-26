$ErrorActionPreference='Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\Boot-Readiness.ps1')
function Assert-True($Value,[string]$Message){if(-not $Value){throw $Message}}
$script:calls=0
$script:mode='recover'
$fixtureSession=@{uri=[uri]'http://127.0.0.1:54321';headers=@{'X-Lab-Token'='fixture'}}
function Invoke-RestMethod {
    param($Uri,$Headers,$TimeoutSec)
    Assert-True ($Uri -eq 'http://127.0.0.1:54321/api/ready') 'Startup queried the expensive catalog endpoint'
    $script:calls++
    if($script:mode -eq 'recover' -and $script:calls -eq 1){throw [Net.WebException]::new('Fixture timeout',[Net.WebExceptionStatus]::Timeout)}
    return [pscustomobject]@{serviceVersion='fixture';native=[pscustomobject]@{applied=$true;hostPid=123;error=$(if($script:mode -eq 'error'){'Fixture media failure'}else{$null});playback=@{firstFrameReady=($script:mode -eq 'recover' -and $script:calls -ge 3)}}}
}
$ready=Wait-ThemeReadiness -Session $fixtureSession -ReadSession {$fixtureSession} -ExpectedVersion fixture -HostPid 123 -TimeoutSeconds 2 -PollMilliseconds 1
Assert-True ($ready.native.playback.firstFrameReady -and $script:calls -eq 3) 'Temporary timeout did not recover'
$script:mode='error'
try{$null=Wait-ThemeReadiness -Session $fixtureSession -ReadSession {$fixtureSession} -ExpectedVersion fixture -HostPid 123 -TimeoutSeconds 1 -PollMilliseconds 1;throw 'Expected media failure'}catch{Assert-True ($_.Exception.Message -eq 'Fixture media failure') 'Actual media error was swallowed'}
$script:mode='pending'
try{$null=Wait-ThemeReadiness -Session $fixtureSession -ReadSession {$fixtureSession} -ExpectedVersion fixture -HostPid 123 -TimeoutSeconds 1 -PollMilliseconds 10;throw 'Expected deadline'}catch{Assert-True ($_.Exception.Message -match '首帧准备超时') 'Readiness did not respect its deadline'}
Write-Output 'PASS: lightweight readiness, temporary timeout retry, explicit media errors, bounded deadline.'
