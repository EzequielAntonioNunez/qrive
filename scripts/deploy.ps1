# Verifica, aplica migraciones D1 remotas y despliega el Worker en axyro.qhel.dev.
# Usa la sesión de Wrangler de este equipo (wrangler login) o CLOUDFLARE_API_TOKEN si está definido.
# Uso: pnpm deploy:cloud
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
function Step($name, [scriptblock]$action) {
  Write-Host "`n== $name"
  & $action
  if ($LASTEXITCODE -ne 0) { throw "Falló: $name" }
}
Step 'Dependencias' { pnpm install --frozen-lockfile }
Step 'Tests y build' { pnpm check }
Step 'Cuenta de Cloudflare' {
  # wrangler whoami termina con código 0 aunque no haya sesión: hay que mirar su salida.
  $whoami = pnpm exec wrangler whoami 2>&1 | Out-String
  Write-Host $whoami
  if ($whoami -match 'not authenticated') { throw 'Wrangler no tiene sesión. Ejecuta "pnpm exec wrangler login" o define CLOUDFLARE_API_TOKEN.' }
}
Step 'Migraciones D1 remotas' {
  $pending = pnpm exec wrangler d1 migrations list axyro-db --remote 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el estado de las migraciones D1.' }
  Write-Host $pending
  if ($pending -notmatch 'No migrations to apply') { pnpm exec wrangler d1 migrations apply axyro-db --remote }
}
Step 'Despliegue del Worker' { pnpm exec wrangler deploy }
Write-Host "`n== Comprobación"
$code = & curl.exe -s --ssl-no-revoke -o NUL -w '%{http_code}' --max-time 20 'https://axyro.qhel.dev/api/health'
if ($code -eq '200') { Write-Host "axyro.qhel.dev responde ($code)." } else { Write-Warning "axyro.qhel.dev respondió '$code'. Revisa el acceso y el panel de Cloudflare." }
Write-Host 'OK: despliegue completado. Abre https://axyro.qhel.dev/ e inicia sesión con tu código personal.'
