param([string]$Archive)
$ErrorActionPreference='Stop'
$themeRoot=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
if(-not $Archive){$Archive=(Get-ChildItem -LiteralPath (Join-Path $themeRoot 'release') -Filter '*windows-x64.zip' | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName}
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$source=Join-Path $themeRoot "release\smoke-$stamp-unpacked"
$target=Join-Path $themeRoot "release\smoke-$stamp-安装 空格"
foreach($location in @($source,$target)){if(-not [IO.Path]::GetFullPath($location).StartsWith((Join-Path $themeRoot 'release')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Smoke paths must stay in release'}}
Expand-Archive -LiteralPath $Archive -DestinationPath $source
& (Join-Path $source 'scripts\Install-Theme.ps1') -Destination $target -SkipShortcuts -SkipRegistry | Out-Null
$beforePath=$env:PATH
try{
    $env:PATH=Join-Path $env:WINDIR 'System32'
    if(Get-Command node.exe -ErrorAction SilentlyContinue){throw 'Smoke test PATH still contains Node'}
    . (Join-Path $target 'scripts\Runtime.ps1')
    $node=Get-ThemeNode
    if(-not $node.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime came from outside the package'}
    $helper=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $target 'src\server.mjs')+'"') -WorkingDirectory $target -WindowStyle Hidden -RedirectStandardOutput (Join-Path $target 'smoke-out.log') -RedirectStandardError (Join-Path $target 'smoke-error.log') -PassThru
}finally{$env:PATH=$beforePath}
$sessionFile=Join-Path $target '.local\session.json'
try{
    for($n=0;$n -lt 100;$n++){if(Test-Path -LiteralPath $sessionFile){break};if($helper.HasExited){throw (Get-Content -Encoding UTF8 -LiteralPath (Join-Path $target 'smoke-error.log') -Raw)};Start-Sleep -Milliseconds 100}
    $session=Get-Content -Encoding UTF8 -LiteralPath $sessionFile -Raw|ConvertFrom-Json;$uri=[uri]$session.url
    $headers=@{'X-Lab-Token'=$uri.Fragment.TrimStart('#');Origin=$uri.GetLeftPart('Authority')}
    $state=Invoke-RestMethod -Uri ($uri.GetLeftPart('Authority')+'/api/state') -Headers $headers
    if($state.settings.sceneId -ne 'welcome' -or $state.scenes.Count -lt 1600 -or $state.native.applied){throw 'Fresh install state is not independent'}
    $media=Invoke-WebRequest -Uri ($uri.GetLeftPart('Authority')+'/media/welcome/poster') -Headers $headers -UseBasicParsing
    if($media.StatusCode -ne 200){throw 'Bundled wallpaper cannot load'}
    'keep-user-data'|Set-Content -LiteralPath (Join-Path $target '.local\keep-fixture.txt')
    Add-Content -LiteralPath (Join-Path $target 'README.md') -Value 'modified-program-file-fixture'
    & (Join-Path $target 'scripts\Uninstall-Theme.ps1') | Out-Null
    if(Test-Path -LiteralPath (Join-Path $target 'runtime\node\node.exe')){throw 'Runtime was not uninstalled'}
    if(-not(Test-Path -LiteralPath (Join-Path $target '.local\keep-fixture.txt')) -or -not(Test-Path -LiteralPath (Join-Path $target 'README.md'))){throw 'User data or modified program file was deleted'}
    if(Get-Process -Id $helper.Id -ErrorAction SilentlyContinue){throw 'Theme helper is still running'}
    & (Join-Path $source 'scripts\Install-Theme.ps1') -Destination $target -SkipShortcuts -SkipRegistry | Out-Null
    if(-not(Test-Path -LiteralPath (Join-Path $target '.local\keep-fixture.txt'))){throw 'Reinstall lost retained user data'}
    if(-not(Get-ChildItem -LiteralPath (Join-Path $target '.local\program-backups') -Filter 'README.md' -Recurse)){throw 'Reinstall did not preserve modified program file'}
    & (Join-Path $target 'scripts\Uninstall-Theme.ps1') | Out-Null
    $report=@{version=$state.serviceVersion;bundledNodeWithoutPATH=$true;unicodeAndSpacePath=$true;catalogWithoutMedia=$state.scenes.Count;defaultWallpaper=$true;installUninstall=$true;reinstallPreservesData=$true;userDataPreserved=$true;modifiedFilePreserved=$true;registryAndShortcutsUntouched=$true}
    $report|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $themeRoot 'test-results\portable-install.json') -Encoding UTF8
    $report|ConvertTo-Json
}finally{
    if(Get-Process -Id $helper.Id -ErrorAction SilentlyContinue){if(Test-Path -LiteralPath (Join-Path $target 'scripts\Stop-Theme.ps1')){& (Join-Path $target 'scripts\Stop-Theme.ps1') -Quiet}}
}
