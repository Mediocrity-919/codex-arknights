param([string]$PackageRoot=$env:ARK_ACCEPTANCE_ROOT)
$ErrorActionPreference='Stop'
if($env:GITHUB_ACTIONS -ne 'true' -or $PackageRoot -notlike '*acceptance-sandbox*'){throw 'This integration test requires the disposable GitHub Windows runner'}
$package=[IO.Path]::GetFullPath($PackageRoot)
$reportRoot=$package
if($env:ARK_ACCEPTANCE_ARCHIVE){$package=Join-Path $env:RUNNER_TEMP ('acceptance-sandbox-pristine-'+[guid]::NewGuid().ToString('N'));Expand-Archive -LiteralPath $env:ARK_ACCEPTANCE_ARCHIVE -DestinationPath $package}
$target=Join-Path $env:RUNNER_TEMP ('acceptance-sandbox-installed '+[guid]::NewGuid().ToString('N'))
$desktop=[Environment]::GetFolderPath('Desktop')
# Hosted runners do not start Explorer, so the standard Desktop shell folder
# may not exist yet. Prepare the ordinary desktop prerequisite for COM links.
if(-not $desktop){throw 'Runner has no Desktop shell folder'}
New-Item -ItemType Directory -Path $desktop -Force | Out-Null
$desktopLink=Join-Path $desktop 'Codex 壁纸版.lnk'
$registry='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\ArkWorkspace'
if((Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $registry)){throw 'Runner contains an existing install; refusing to modify it'}
$checks=@()
try{
 & (Join-Path $package 'scripts\Install-Theme.ps1') -Destination $target | Out-Null
 $shell=New-Object -ComObject WScript.Shell
 $link=$shell.CreateShortcut($desktopLink)
 if($link.TargetPath -ne (Join-Path $target 'dist\ArkBoot.exe') -or $link.Arguments -ne '--auto' -or $link.Description -ne 'Codex'){throw 'Installed desktop shortcut is incorrect'}
 if((Get-ItemProperty -LiteralPath $registry).InstallLocation -ne $target){throw 'Installed registry entry is incorrect'}
 $checks+=@{name='Actual desktop shortcut and HKCU uninstall registration';passed=$true}
 New-Item -ItemType Directory -Path (Join-Path $target '.local') -Force|Out-Null
 'retained'|Set-Content -LiteralPath (Join-Path $target '.local\test-personal.txt')
 'unrelated'|Set-Content -LiteralPath (Join-Path $target 'my-notes.txt')
 & (Join-Path $target 'scripts\Uninstall-Theme.ps1') | Out-Null
 if((Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $registry)){throw 'Uninstall did not remove its shortcut or registration'}
 if(-not(Test-Path -LiteralPath (Join-Path $target '.local\test-personal.txt')) -or -not(Test-Path -LiteralPath (Join-Path $target 'my-notes.txt'))){throw 'Uninstall deleted personal files'}
 $checks+=@{name='Actual uninstall restores desktop and registry, retains personal and unrelated files';passed=$true}
 & (Join-Path $package 'scripts\Install-Theme.ps1') -Destination $target | Out-Null
 $link=$shell.CreateShortcut($desktopLink);$link.TargetPath=Join-Path $env:WINDIR 'System32\notepad.exe';$link.Save()
 $modifiedHash=(Get-FileHash -LiteralPath $desktopLink).Hash
 & (Join-Path $target 'scripts\Uninstall-Theme.ps1') | Out-Null
 if((Get-FileHash -LiteralPath $desktopLink).Hash -ne $modifiedHash){throw 'Uninstall changed an externally edited shortcut'}
 $checks+=@{name='Externally modified shortcut is preserved';passed=$true}
 $collisionTarget=Join-Path $env:RUNNER_TEMP ('acceptance-sandbox-collision-'+[guid]::NewGuid().ToString('N'))
 $rejected=$false
 try{& (Join-Path $package 'scripts\Install-Theme.ps1') -Destination $collisionTarget | Out-Null}catch{$rejected=$true}
 if(-not $rejected -or (Get-FileHash -LiteralPath $desktopLink).Hash -ne $modifiedHash){throw 'Installer did not preserve a conflicting desktop shortcut'}
 if(Test-Path -LiteralPath (Join-Path $collisionTarget 'scripts\Uninstall-Theme.ps1')){& (Join-Path $collisionTarget 'scripts\Uninstall-Theme.ps1')|Out-Null}
 $checks+=@{name='Conflicting shortcut is rejected without overwriting it';passed=$true}
 $unrelated=Join-Path $env:RUNNER_TEMP ('acceptance-sandbox-unrelated-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $unrelated|Out-Null
 'unrelated'|Set-Content -LiteralPath (Join-Path $unrelated 'keep.txt')
 $rejected=$false
 try{& (Join-Path $package 'scripts\Install-Theme.ps1') -Destination $unrelated -SkipShortcuts -SkipRegistry|Out-Null}catch{$rejected=$true}
 if(-not $rejected -or (Get-Content -LiteralPath (Join-Path $unrelated 'keep.txt')) -ne 'unrelated'){throw 'Installer did not preserve unrelated destination'}
 $checks+=@{name='Unrelated nonempty destination is rejected';passed=$true}
 $checks|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $reportRoot 'test-results\windows-install-integration.json') -Encoding UTF8
 $checks|ConvertTo-Json -Depth 5
}finally{
 if(Test-Path -LiteralPath (Join-Path $target 'scripts\Uninstall-Theme.ps1')){& (Join-Path $target 'scripts\Uninstall-Theme.ps1')|Out-Null}
 # Only this test-created shortcut is removed; the runner started without one.
 if(Test-Path -LiteralPath $desktopLink){Remove-Item -LiteralPath $desktopLink -Force}
}
