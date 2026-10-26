param([switch]$Quiet)
$ErrorActionPreference='Stop'
$themeRoot=Split-Path -Parent $PSScriptRoot
$sessionFile=Join-Path $themeRoot '.local\session.json'
if(-not(Test-Path -LiteralPath $sessionFile)){return}
$saved=Get-Content -Encoding UTF8 -LiteralPath $sessionFile -Raw | ConvertFrom-Json
$uri=[uri]$saved.url
if($uri.Scheme -ne 'http' -or $uri.Host -ne '127.0.0.1'){throw '助手地址未通过验证'}
$owner=Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$saved.pid)"
if(-not $owner){return}
$absoluteServer=Join-Path $themeRoot 'src\server.mjs'
if($owner.Name -ne 'node.exe' -or -not($owner.CommandLine -like ('*'+$absoluteServer+'*') -or $owner.CommandLine -match '(?:\s|\")src[\\/]server\.mjs(?:\s|\"|$)')){throw '助手进程验证未通过'}
$listener=Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $uri.Port -State Listen -ErrorAction Stop
if($listener.OwningProcess -ne $saved.pid){throw '助手端口归属变化'}
$headers=@{'X-Lab-Token'=$uri.Fragment.TrimStart('#');Origin=$uri.GetLeftPart('Authority')}
$null=Invoke-RestMethod -Uri ($uri.GetLeftPart('Authority')+'/api/shutdown') -Method Post -Headers $headers -ContentType 'application/json' -Body '{}' -TimeoutSec 15
for($attempt=0;$attempt -lt 100;$attempt++){if(-not(Get-Process -Id $saved.pid -ErrorAction SilentlyContinue)){break};Start-Sleep -Milliseconds 100}
if(Get-Process -Id $saved.pid -ErrorAction SilentlyContinue){throw '助手仍在退出，请稍后重试；未强制终止客户端'}
if(-not $Quiet){Write-Output '壁纸助手已退出，Codex 保持运行。'}
