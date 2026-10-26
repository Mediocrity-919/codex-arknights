# Poll only the authenticated, lightweight readiness endpoint. A temporary HTTP
# timeout must not be confused with a fatal error returned by the theme itself.
function Get-ThemeReadiness($Session,[int]$TimeoutSec=4) {
    return Invoke-RestMethod -Uri ($Session.uri.GetLeftPart('Authority')+'/api/ready') -Headers $Session.headers -TimeoutSec $TimeoutSec
}
function Wait-ThemeReadiness($Session,[scriptblock]$ReadSession,[string]$ExpectedVersion,[int]$HostPid,[int]$TimeoutSeconds=30,[int]$PollMilliseconds=350) {
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while($watch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $state=$null
        try {
            if(-not $Session){$Session=& $ReadSession}
            if($Session){$state=Get-ThemeReadiness $Session}
        } catch {
            # WebException inherits InvalidOperationException in Windows
            # PowerShell; catch transport failures before inspecting app errors.
            $Session=$null
        }
        if($state){
            if($state.serviceVersion -ne $ExpectedVersion){throw '主题助手版本尚未更新，请重新运行壁纸启动入口'}
            if($state.native.applied -and $state.native.hostPid -eq $HostPid -and $state.native.playback.firstFrameReady){return $state}
            if($state.native.error){throw [string]$state.native.error}
        }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
    throw '壁纸首帧准备超时，已保留 Codex；可稍后从壁纸中心重试'
}
