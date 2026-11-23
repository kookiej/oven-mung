param([string]$only = '', [string]$samples = '32', [string]$res = '640', [string]$out = 'test')
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $here $out
New-Item -ItemType Directory -Force $dir | Out-Null
$env:ONLY = $only; $env:SAMPLES = $samples; $env:RES = $res
$bl = "$env:LOCALAPPDATA\Microsoft\WindowsApps\blender-launcher.exe"
Start-Process -FilePath $bl -ArgumentList @('--background','--factory-startup','--python',"`"$here\render_cartoon.py`"",'--',"`"$dir`"") -Wait -NoNewWindow -RedirectStandardOutput "$dir\_stdout.txt" -RedirectStandardError "$dir\_stderr.txt"
Get-Content "$dir\_log.txt"
