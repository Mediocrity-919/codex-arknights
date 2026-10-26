param([switch]$Apply)
$ErrorActionPreference='Stop'
$probe = & (Join-Path $PSScriptRoot 'Probe-Host.ps1') | ConvertFrom-Json
if(-not $probe.running -or -not $probe.mainPid) { throw 'No unique installed ChatGPT main process.' }
$process=Get-Process -Id $probe.mainPid
if($process.Path -ne $probe.package.executable) { throw 'Process path changed.' }
$process.Refresh()
$handle=$process.MainWindowHandle
if($handle -eq [IntPtr]::Zero) { throw 'No main window.' }
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class ArkWindowLayerRepair {
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
}
'@
[uint32]$ownerPid=0
$null=[ArkWindowLayerRepair]::GetWindowThreadProcessId($handle,[ref]$ownerPid)
if($ownerPid -ne $probe.mainPid) { throw 'Window owner changed.' }
$before=([ArkWindowLayerRepair]::GetWindowLong($handle,-20) -band 8) -ne 0
if($Apply -and $before) {
    # Remove only the verified main window's accidental topmost flag. Do not
    # move, resize, activate, close or terminate anything.
    if(-not [ArkWindowLayerRepair]::SetWindowPos($handle,[IntPtr](-2),0,0,0,0,0x213)) { throw 'Could not restore normal window layer.' }
}
$after=([ArkWindowLayerRepair]::GetWindowLong($handle,-20) -band 8) -ne 0
[pscustomobject]@{pid=$probe.mainPid;handle=$handle.ToInt64();beforeTopmost=$before;afterTopmost=$after;applied=[bool]$Apply} | ConvertTo-Json
