# Todo en uno: despliega la API y la consola, compila Unity y arranca la demo local.
# Uso: pnpm ship
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'deploy.ps1')
& (Join-Path $PSScriptRoot 'unity-build.ps1')
& (Join-Path $PSScriptRoot 'demo.ps1')
