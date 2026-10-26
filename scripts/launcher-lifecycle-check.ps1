$ErrorActionPreference='Stop'
$themeRoot=Split-Path -Parent $PSScriptRoot
$reports=@()
foreach($case in @('ready','delay','failure','skip','timeout')){
    $process=Start-Process -FilePath (Join-Path $themeRoot 'dist\ArkBoot.exe') -ArgumentList "--test=$case",'--test-hidden' -WindowStyle Hidden -PassThru
    if(-not $process.WaitForExit(55000)){throw "启动器测试未退出：$case"}
    $r=Get-Content -Encoding UTF8 -LiteralPath (Join-Path $themeRoot ".local\launcher-test-$case.json") -Raw | ConvertFrom-Json
    if(-not $r.webViewDisposed -or $r.elapsedSeconds -gt 52){throw "生命周期测试失败：$case"}
    if($case -in @('ready','delay') -and -not $r.completed){throw "未完成就绪交接：$case"}
    if($case -eq 'skip' -and -not $r.skipped){throw 'Esc 跳过分支失败'}
    if($case -in @('failure','timeout') -and -not $r.failed){throw "失败回退分支未触发：$case"}
    $reports+=@{case=$case;completed=$r.completed;skipped=$r.skipped;failed=$r.failed;seconds=$r.elapsedSeconds;disposed=$r.webViewDisposed}
    Write-Output "PASS launcher: $case"
}
$reports|ConvertTo-Json -Depth 5|Set-Content -LiteralPath (Join-Path $themeRoot 'test-results\launcher-lifecycle.json') -Encoding UTF8
