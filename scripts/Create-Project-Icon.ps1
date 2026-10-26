param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object Drawing.Bitmap(256,256)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode=[Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::FromArgb(255,21,27,32))
$accent=New-Object Drawing.Pen([Drawing.Color]::FromArgb(255,148,210,224),8)
$white=New-Object Drawing.Pen([Drawing.Color]::FromArgb(255,231,236,240),13)
$graphics.DrawRectangle($accent,26,26,204,204)
$graphics.DrawLines($white,[Drawing.PointF[]]@([Drawing.PointF]::new(76,187),[Drawing.PointF]::new(127,67),[Drawing.PointF]::new(177,187)))
$graphics.DrawLine($accent,96,144,161,144)
$graphics.DrawLine($accent,169,106,192,62)
$stream=New-Object IO.MemoryStream
$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
$data=$stream.ToArray()
$target=[IO.File]::Create([IO.Path]::GetFullPath($Path));$writer=New-Object IO.BinaryWriter($target)
try{$writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]1);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([byte]0);$writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$data.Length);$writer.Write([uint32]22);$writer.Write($data)}finally{$writer.Dispose();$stream.Dispose();$graphics.Dispose();$bitmap.Dispose();$accent.Dispose();$white.Dispose()}
