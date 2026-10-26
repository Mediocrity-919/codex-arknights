param([string]$ResultFile)
# Compatibility entry; the formal service owns readiness and lifecycle.
& (Join-Path $PSScriptRoot 'Start-Boot-Service.ps1') -ResultFile $ResultFile
