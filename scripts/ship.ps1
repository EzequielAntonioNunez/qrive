# Todo en uno: compila WebGL, despliega API y consola con el simulador,
# compila Windows y arranca la demo local.
# Uso: pnpm ship
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'unity-webgl.ps1')
& (Join-Path $PSScriptRoot 'deploy.ps1')
& (Join-Path $PSScriptRoot 'unity-build.ps1')
& (Join-Path $PSScriptRoot 'demo.ps1')
