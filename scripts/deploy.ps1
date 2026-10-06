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
Step 'Cuenta de Cloudflare' { pnpm exec wrangler whoami }
Step 'Migraciones D1 remotas' { pnpm exec wrangler d1 migrations apply axyro-db --remote }
Step 'Despliegue del Worker' { pnpm exec wrangler deploy }
Write-Host "`n== Comprobación"
$code = & curl.exe -s -o NUL -w '%{http_code}' --max-time 20 'https://axyro.qhel.dev/api/health'
# Cloudflare Access responde con redirección (302) al login: el dominio está activo y protegido.
if ($code -match '^(200|302|401|403)$') { Write-Host "axyro.qhel.dev responde ($code)." } else { Write-Warning "axyro.qhel.dev respondió '$code'. Revisa el panel de Cloudflare." }
Write-Host 'OK: despliegue completado. Abre https://axyro.qhel.dev/ e inicia sesión con Cloudflare Access.'
