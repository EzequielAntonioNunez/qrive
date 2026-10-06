# Compila el simulador Unity para el navegador (WebGL) y lo deja listo para servirse en /simulador/.
# - Ficheros de hasta 25 MiB (límite de los static assets de Workers): se copian a web/public/simulador/
#   se versionan y viajan con la consola en CI o con pnpm deploy:cloud.
# - Ficheros mayores: se suben al bucket R2 axyro-files bajo simulador/; el Worker los sirve desde ahí.
# Cierra el editor de Unity antes de ejecutarlo: el modo batch no puede abrir un proyecto ya abierto.
# Uso: pnpm unity:webgl    (otra ruta del editor: $env:UNITY_EDITOR = 'C:\...\Unity.exe')
#      pnpm unity:webgl -SkipBuild    (solo publica la última compilación de Build/WebGL)
param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root 'unity\AXYRO.Simulation'
$build = Join-Path $project 'Build\WebGL'
$target = Join-Path $root 'web\public\simulador'
$limit = 25MB

if (-not $SkipBuild) {
  $unity = if ($env:UNITY_EDITOR) { $env:UNITY_EDITOR } else { 'C:\Program Files\Unity\Hub\Editor\6000.3.25f1\Editor\Unity.exe' }
  if (-not (Test-Path $unity)) { throw "No encuentro Unity en $unity. Define `$env:UNITY_EDITOR con la ruta de Unity.exe 6000.3.25f1." }
  $webgl = Join-Path (Split-Path -Parent $unity) 'Data\PlaybackEngines\WebGLSupport'
  if (-not (Test-Path $webgl)) { throw "Falta el módulo «Web Build Support» de Unity 6000.3.25f1. Añádelo desde Unity Hub (Instalaciones > Añadir módulos)." }
  $logs = Join-Path $root '.local-state\logs'
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  $log = Join-Path $logs 'unity-webgl.log'
  Write-Host 'Compilando Unity para WebGL (la primera vez puede tardar bastante)...'
  $process = Start-Process -FilePath $unity -ArgumentList @('-batchmode', '-quit', '-projectPath', "`"$project`"", '-buildTarget', 'WebGL', '-executeMethod', 'AxyroSceneBuilder.BuildWebGL', '-logFile', "`"$log`"") -PassThru -NoNewWindow
  # Espera solo al editor; Unity puede dejar subprocesos vivos después de terminar.
  $process.WaitForExit()
  $result = Select-String -Path $log -Pattern 'AXYRO_WEBGL_RESULT' | Select-Object -Last 1
  # El resultado del BuildPipeline es la señal fiable: en batchmode Unity puede
  # devolver un código de proceso distinto de cero incluso tras compilar bien.
  if (-not $result -or $result.Line -notmatch 'Succeeded errors=0') {
    Get-Content $log -Tail 40
    throw "La compilación WebGL falló. Log completo: $log"
  }
  Write-Host "OK: $($result.Line.Trim())"
}

if (-not (Test-Path (Join-Path $build 'index.html'))) { throw "No hay compilación WebGL en $build. Ejecuta pnpm unity:webgl sin -SkipBuild." }
$build = (Resolve-Path $build).Path
$files = Get-ChildItem -Path $build -Recurse -File
$large = @($files | Where-Object { $_.Length -ge $limit })

# La carpeta de destino es una salida generada y versionada: se rehace entera.
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
New-Item -ItemType Directory -Force -Path $target | Out-Null

foreach ($file in $files) {
  $relative = $file.FullName.Substring($build.Length + 1)
  if ($file.Length -ge $limit) { continue }
  $destination = Join-Path $target $relative
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
  Copy-Item -LiteralPath $file.FullName -Destination $destination
}
$total = ($files | Measure-Object -Property Length -Sum).Sum
Write-Host ("Copiados {0} ficheros a web/public/simulador/ ({1:N1} MB en total)." -f ($files.Count - $large.Count), ($total / 1MB))

if ($large.Count -gt 0) {
  Write-Host "`n$($large.Count) fichero(s) superan 25 MiB: se suben a R2 (axyro-files/simulador/)."
  Set-Location $root
  foreach ($file in $large) {
    $key = 'simulador/' + $file.FullName.Substring($build.Length + 1).Replace('\', '/')
    Write-Host ("  {0} ({1:N1} MB)" -f $key, ($file.Length / 1MB))
    # El bucket está en la jurisdicción UE (wrangler.jsonc): sin -J eu wrangler no lo encuentra.
    pnpm exec wrangler r2 object put "axyro-files/$key" --file "$($file.FullName)" --content-type 'application/octet-stream' --remote --jurisdiction eu
    if ($LASTEXITCODE -ne 0) { throw "Falló la subida de $key a R2. ¿Tiene Wrangler sesión (pnpm exec wrangler login)?" }
  }
}

Write-Host "`nOK: simulador WebGL preparado. Publícalo con pnpm deploy:cloud y compártelo desde la consola (botón «Abrir simulador»)."
Write-Host 'En local: pnpm dev:api y pnpm dev:web, y abre http://127.0.0.1:5173/simulador/index.html?sesion=<id>.'
