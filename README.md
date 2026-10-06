# AXYRO SIM / DECISION

Primer corte ejecutable del escenario **Negociación con proveedor**. Incluye un panel web para instructor y participante, API Hono en Cloudflare Workers, estado de sesión en Durable Objects, datos en D1 y eventos persistidos a través de Queues.

La definición de alcance está en [AXYRO_MVP_ARCHITECTURE_FINAL_v1.1.md](./AXYRO_MVP_ARCHITECTURE_FINAL_v1.1.md). VR, personajes IA y RAG avanzado pertenecen a fases posteriores.

## Desarrollo local

Requiere Node.js 24 y pnpm 12.

```powershell
pnpm install
pnpm db:local
pnpm dev:api
```

En otra terminal:

```powershell
pnpm dev:web
```

Abre `http://127.0.0.1:5173`. El selector local alterna entre instructor y participante. Los datos locales persisten en `.local-state/`, ignorado por Git.

## Verificación

```powershell
pnpm check
pnpm smoke
```

`pnpm smoke` necesita la API local en marcha. `SMOKE_RUNS=50` permite ejecutar la puerta de calidad de 50 simulaciones internas.

## Cloudflare

Los recursos de AXYRO en la cuenta de desarrollo son `axyro-db` (D1, EU), `axyro-files` (R2, EU) y `axyro-events` (Queue). `wrangler.jsonc` contiene el ID público de D1 y reserva el dominio `axyro.qhel.dev` para el Worker. Las credenciales deben mantenerse fuera de Git. La URL `workers.dev` y las URL de vista previa están desactivadas para que el despliegue se sirva por el dominio protegido. El Worker remoto usa Cloudflare Access con el equipo `bitter-cake-9de8.cloudflareaccess.com`. La aplicación Access `AXYRO SIM / DECISION` protege todo `axyro.qhel.dev` con una política limitada a `ezequiel@identy.cloud`, y su identificador `aud` está configurado en el Worker.

Entorno cloud de desarrollo: <https://axyro.qhel.dev/>. Se requiere iniciar sesión mediante Cloudflare Access.

El token utilizado para desarrollo debe permitir migraciones D1, Workers y configuración de Access. Para conectar el dominio personalizado, Cloudflare requiere `Workers Routes Write` limitado a la zona `qhel.dev`; para crear la aplicación y sus políticas, requiere `Access: Apps and Policies Write`. La cola actual se creó sin jurisdicción porque la API de Queues rechazó la opción `eu`; sus mensajes llevan IDs seudónimos y eventos, sin nombres ni correos.

## Contrato de API

`GET /api/scenarios`, `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/commands`, `GET /api/sessions/:id/events` y `GET/POST /api/memberships` para instructores. Los comandos incluyen un `id` para idempotencia. Los roles y la organización se resuelven en el servidor; la identidad demo solo existe en `wrangler.local.jsonc`.
