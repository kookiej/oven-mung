# 게임용 에셋 렌더 — render_game.py. 출력은 game/ (PNG·GLB·meta.json), export_game.py가 public/assets로 옮긴다
# 예) & renders\blender_cartoon\game.ps1 -groups 'stage' -only 'stage/knead' -samples 16
param([string]$groups = 'stage,tool,bread,glb', [string]$only = '', [string]$samples = '32', [string]$out = 'game')
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$dir = Join-Path $here $out
New-Item -ItemType Directory -Force $dir | Out-Null
$env:GROUPS = $groups; $env:ONLY = $only; $env:SAMPLES = $samples
$bl = "$env:LOCALAPPDATA\Microsoft\WindowsApps\blender-launcher.exe"
Start-Process -FilePath $bl -ArgumentList @('--background','--factory-startup','--python',"`"$here\render_game.py`"",'--',"`"$dir`"") -Wait -NoNewWindow -RedirectStandardOutput "$dir\_stdout.txt" -RedirectStandardError "$dir\_stderr.txt"
Get-Content "$dir\_log.txt"

