param([string]$FfmpegPath,[string]$PythonPath,[string]$ModelDirectory,[switch]$Interactive)
$ErrorActionPreference='Stop'
$themeRoot=Split-Path -Parent $PSScriptRoot
if($Interactive){
    Add-Type -AssemblyName System.Windows.Forms
    $picker=New-Object Windows.Forms.OpenFileDialog
    $picker.Title='选择 FFmpeg 可执行文件';$picker.Filter='FFmpeg (ffmpeg*.exe)|ffmpeg*.exe'
    if($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){return};$FfmpegPath=$picker.FileName
    $choice=[Windows.Forms.MessageBox]::Show('是否同时启用可选的 NVIDIA CUDA AI 超分？需要已安装 NumPy、PyTorch CUDA 的 Python 和模型权重。只下载原片可选“否”。','可选 AI 环境',[Windows.Forms.MessageBoxButtons]::YesNo)
    if($choice -eq [Windows.Forms.DialogResult]::Yes){
        $picker.Title='选择 AI 环境中的 python.exe';$picker.Filter='Python (python.exe)|python.exe'
        if($picker.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){return};$PythonPath=$picker.FileName
        $folder=New-Object Windows.Forms.FolderBrowserDialog;$folder.Description='选择包含 realesr-animevideov3-x2.bin/.param 的模型目录'
        if($folder.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){return};$ModelDirectory=$folder.SelectedPath
    }
}
if(-not $FfmpegPath){throw '请指定 FFmpeg 路径，或使用 -Interactive'}
$ffmpeg=(Resolve-Path -LiteralPath $FfmpegPath).Path
$null=& $ffmpeg -version
if($LASTEXITCODE -ne 0){throw 'FFmpeg 无法运行'}
$config=@{ffmpeg=$ffmpeg}
if($PythonPath -or $ModelDirectory){
    if(-not $PythonPath -or -not $ModelDirectory){throw '启用 AI 时需同时指定 PythonPath 和 ModelDirectory'}
    $python=(Resolve-Path -LiteralPath $PythonPath).Path
    $models=(Resolve-Path -LiteralPath $ModelDirectory).Path
    foreach($name in @('realesr-animevideov3-x2.bin','realesr-animevideov3-x2.param')){if(-not(Test-Path -LiteralPath (Join-Path $models $name))){throw "缺少模型文件 $name"}}
    $null=& $python -c 'import numpy,torch; assert torch.cuda.is_available(), "NVIDIA CUDA unavailable"'
    if($LASTEXITCODE -ne 0){throw 'Python AI 依赖或 CUDA 未就绪；可以只配置 FFmpeg 并使用原片'}
    $config.python=$python;$config.modelDir=$models
}
New-Item -ItemType Directory -Path (Join-Path $themeRoot '.local') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $themeRoot '.local\runtime.json'),($config|ConvertTo-Json),(New-Object Text.UTF8Encoding $false))
Write-Output '视频处理工具已验证。重启主题助手后生效；不需要重启 Codex。'
if($Interactive){[Windows.Forms.MessageBox]::Show('工具已验证，壁纸中心会自动更新可用功能。','配置完成')|Out-Null}
