$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    rive assets/avatar --once
    if ($LASTEXITCODE -ne 0) { throw 'Rive no pudo compilar el avatar.' }
    $source = Join-Path $root 'assets\avatar\build\axyro-avatar.riv'
    foreach ($target in @('web\public\avatar.riv', 'unity\AXYRO.Simulation\Assets\AXYRO\avatar.riv')) {
        $absoluteTarget = Join-Path $root $target
        New-Item -ItemType Directory -Path (Split-Path $absoluteTarget) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $absoluteTarget -Force
    }
    Write-Output 'Avatar Rive actualizado en web y Unity.'
} finally {
    Pop-Location
}
