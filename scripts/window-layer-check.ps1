$ErrorActionPreference='Stop'
# Test the launcher handoff against disposable off-screen windows, never the client.
$source=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot '..\launcher\BootHost.cs') -Raw
$match=[regex]::Match($source,'SetWindowPos\(target,IntPtr.Zero,0,0,0,0,(0x[0-9a-fA-F]+)\)')
if(-not $match.Success) { throw 'Launcher handoff call not found.' }
$flags=[Convert]::ToUInt32($match.Groups[1].Value.Substring(2),16)
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class ArkLayerFixture {
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr CreateWindowEx(uint ex,string cls,string name,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll",SetLastError=true)] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
}
'@
$normal=[IntPtr]::Zero
$splash=[IntPtr]::Zero
try {
 $normal=[ArkLayerFixture]::CreateWindowEx(0,'STATIC','Ark test normal',[uint32]2147483648,-32000,-32000,40,40,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
 $splash=[ArkLayerFixture]::CreateWindowEx(8,'STATIC','Ark test splash',[uint32]2147483648,-32000,-32000,40,40,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero,[IntPtr]::Zero)
 if($normal -eq [IntPtr]::Zero -or $splash -eq [IntPtr]::Zero) { throw 'Could not create test windows.' }
 if(-not [ArkLayerFixture]::SetWindowPos($splash,[IntPtr](-1),0,0,0,0,0x53)) { throw 'Fixture setup failed.' }
 if(-not [ArkLayerFixture]::SetWindowPos($normal,$splash,0,0,0,0,0x53)) { throw 'Old handoff failed.' }
 $oldPromotes=([ArkLayerFixture]::GetWindowLong($normal,-20) -band 8) -ne 0
 if(-not [ArkLayerFixture]::SetWindowPos($normal,[IntPtr](-2),0,0,0,0,0x213)) { throw 'Fixture reset failed.' }
 if(-not [ArkLayerFixture]::SetWindowPos($normal,[IntPtr]::Zero,0,0,0,0,$flags)) { throw 'New handoff failed.' }
 $newPreserves=([ArkLayerFixture]::GetWindowLong($normal,-20) -band 8) -eq 0
 if(-not $oldPromotes -or -not $newPreserves) { throw "Unexpected layer behavior: oldPromotes=$oldPromotes newPreserves=$newPreserves" }
 $result=[pscustomobject]@{oldHandoffPromotes=$oldPromotes;newHandoffPreservesNormalLayer=$newPreserves;flags=$flags;realClientUntouched=$true}
 $result | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\test-results\window-layer.json') -Encoding UTF8
 $result | ConvertTo-Json
} finally {
 if($normal -ne [IntPtr]::Zero) { $null=[ArkLayerFixture]::DestroyWindow($normal) }
 if($splash -ne [IntPtr]::Zero) { $null=[ArkLayerFixture]::DestroyWindow($splash) }
}
