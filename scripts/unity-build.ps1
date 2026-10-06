# Regenera la escena AXYRO y compila el cliente Windows en unity/AXYRO.Simulation/Build/AXYRO-Demo.exe.
# Cierra el editor de Unity antes de ejecutarlo: el modo batch no puede abrir un proyecto ya abierto.
# Uso: pnpm unity:build    (otra ruta del editor: $env:UNITY_EDITOR = 'C:\...\Unity.exe')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$unity = if ($env:UNITY_EDITOR) { $env:UNITY_EDITOR } else { 'C:\Program Files\Unity\Hub\Editor\6000.3.25f1\Editor\Unity.exe' }
if (-not (Test-Path $unity)) { throw "No encuentro Unity en $unity. Define `$env:UNITY_EDITOR con la ruta de Unity.exe 6000.3.25f1." }
$project = Join-Path $root 'unity\AXYRO.Simulation'
$logs = Join-Path $root '.local-state\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'unity-build.log'
Write-Host 'Compilando Unity (puede tardar unos minutos)...'
$process = Start-Process -FilePath $unity -ArgumentList @('-batchmode', '-quit', '-projectPath', "`"$project`"", '-executeMethod', 'AxyroSceneBuilder.BuildWindows', '-logFile', "`"$log`"") -Wait -PassThru -NoNewWindow
$result = Select-String -Path $log -Pattern 'AXYRO_BUILD_RESULT' | Select-Object -Last 1
if ($process.ExitCode -ne 0 -or -not $result -or $result.Line -notmatch 'Succeeded') {
  Get-Content $log -Tail 40
  throw "La compilación de Unity falló. Log completo: $log"
}
Write-Host "OK: $($result.Line.Trim())"
Write-Host "Ejecutable: $project\Build\AXYRO-Demo.exe"
