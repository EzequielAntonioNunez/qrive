# Detiene los procesos arrancados por scripts/demo.ps1.
$root = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root '.local-state\demo.pids'
if (-not (Test-Path $pidFile)) { Write-Host 'No hay demo en marcha.'; return }
foreach ($id in Get-Content $pidFile) {
  if ($id -and (Get-Process -Id $id -ErrorAction SilentlyContinue)) {
    & taskkill.exe /PID $id /T /F | Out-Null
    Write-Host "Detenido PID $id"
  }
}
Remove-Item $pidFile -Force
