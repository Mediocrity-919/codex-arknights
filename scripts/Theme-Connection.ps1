# Shared by startup and host detection. An open port alone is never trusted.
function Get-ThemeCommandPort([string]$CommandLine) {
    $match = [regex]::Match($CommandLine, '(?:^|\s)--remote-debugging-port(?:=|\s+)"?(\d{1,5})"?(?=\s|$)', 'IgnoreCase')
    if(-not $match.Success) { return 0 }
    $value = [int]$match.Groups[1].Value
    if($value -lt 1 -or $value -gt 65535) { return 0 }
    return $value
}
function Get-AvailableThemePort([int]$Preferred = 9376) {
    foreach($candidate in @($Preferred,0)) {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,$candidate)
        try {
            $listener.ExclusiveAddressUse = $true
            $listener.Start()
            return [int]$listener.LocalEndpoint.Port
        } catch [Net.Sockets.SocketException] {
            if($candidate -eq 0) { throw }
        } finally { $listener.Stop() }
    }
    throw 'No local port available for the theme connection.'
}
