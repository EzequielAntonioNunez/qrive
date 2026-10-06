# Arranca la demo local de AXYRO en segundo plano: API, consola web y cliente Unity.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/demo.ps1
# Parar: powershell -ExecutionPolicy Bypass -File scripts/demo-stop.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$logs = Join-Path $root '.local-state\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$pidFile = Join-Path $root '.local-state\demo.pids'

if (Test-Path $pidFile) { & (Join-Path $PSScriptRoot 'demo-stop.ps1') }

Write-Host 'Aplicando migraciones locales...'
& pnpm.cmd db:local | Out-Null

function Start-Background($name, $script) {
  $process = Start-Process -FilePath 'pnpm.cmd' -ArgumentList $script -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs "$name.log") -RedirectStandardError (Join-Path $logs "$name.err.log")
  Add-Content -Path $pidFile -Value $process.Id
  Write-Host "$name iniciado (PID $($process.Id))"
}

Start-Background 'api' 'dev:api'
Start-Background 'web' 'dev:web'

Write-Host 'Esperando a la API...'
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try { if ((Invoke-RestMethod 'http://127.0.0.1:8787/api/health' -TimeoutSec 2).ok) { $ready = $true; break } } catch {}
  Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Warning "La API no responde. Revisa $logs\api.err.log"; exit 1 }

# Crea una sesión para que Unity se conecte nada más arrancar.
$session = Invoke-RestMethod 'http://127.0.0.1:8787/api/sessions' -Method Post -Headers @{ 'x-demo-user' = 'instructor' } -ContentType 'application/json' -Body '{}'
$sessionId = $session.state.id
Write-Host "Sesión creada: $sessionId"

Start-Process 'http://127.0.0.1:5173'

$player = Join-Path $root 'unity\AXYRO.Simulation\Build\Simulador-UFV.exe'
if (Test-Path $player) {
  # Sin --axyro-session, Unity sigue siempre la sesión más reciente que cree el instructor.
  $unity = Start-Process -FilePath $player -PassThru
  Add-Content -Path $pidFile -Value $unity.Id
  Write-Host "Unity iniciado (PID $($unity.Id))"
} else {
  Write-Warning 'No hay compilación de Unity. Abre la escena AXYRO Avatar Demo en el editor y pulsa Play.'
}

Write-Host ''
Write-Host 'Demo en marcha. Consola: http://127.0.0.1:5173 (selecciona la sesión en la barra lateral)'
Write-Host 'Unity: J unirse · 1/2/3 decidir · Espacio voz'
Write-Host "Logs: $logs"
Write-Host 'Para parar: powershell -ExecutionPolicy Bypass -File scripts/demo-stop.ps1'
