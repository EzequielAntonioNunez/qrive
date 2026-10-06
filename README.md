# AXYRO SIM / DECISION

Primer corte ejecutable del escenario **Negociación con proveedor**. Incluye un panel web para instructor y participante, API Hono en Cloudflare Workers, estado de sesión en Durable Objects, datos en D1 y eventos persistidos a través de Queues.

El panel web permite ver participantes, dar de alta miembros internos y ajustar indicadores; la cronología registra cada ajuste. La escena «Elena Vega» que aparece actualmente en web y Unity es un **prototipo visual de exploración**, no la experiencia de simulación objetivo. No debe presentarse como el avatar final del MVP.

Según la arquitectura v1.1, **Unity** debe ser el cliente de simulación y hacerse cargo del personaje, renderizado, animación, audio, interacción y ejecución local. **Rive** debe servir al HUD, estados, feedback y transiciones dentro de Unity, con reutilización opcional de componentes de interfaz en web. **React** es principalmente la consola del instructor y administración. Falta sustituir el retrato Rive por un personaje producido y animado en Unity y conectar ese cliente a las sesiones y decisiones de la API antes de considerar terminada la etapa Simulation Core.

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

## Avatar y demostración Unity

El arte editable del prototipo vive en `assets/avatar/scene.rml`. Su archivo `.riv` compilado está versionado en `web/public/avatar.riv` y `unity/AXYRO.Simulation/Assets/AXYRO/avatar.riv`. Si editas este prototipo con la CLI de Rive, ejecuta `powershell -File scripts/build-avatar.ps1` para actualizar ambos clientes. El archivo no representa el personaje definitivo de Unity.

El proyecto `unity/AXYRO.Simulation` usa Unity **6000.3.25f1** y el paquete Rive para Unity **v0.5.1**. Abre `Assets/Scenes/AXYRO Avatar Demo.unity` y pulsa Play. Las teclas `1`, `2` y `3` cambian la fase; espacio o el botón de la escena reproducen el audio y activan la animación de habla. Los tres WAV se generaron con la voz española local mediante `scripts/generate-avatar-voice.ps1` y están incluidos en el proyecto. La compilación Windows se guarda en `unity/AXYRO.Simulation/Build/`, ignorada por Git.

La voz web depende de las voces disponibles en el navegador. La animación de boca responde al estado de reproducción; todavía no representa fonemas individuales. La escena Unity comparte el personaje y los diálogos del escenario, pero la conexión de decisiones con la API de sesiones queda para la siguiente integración.

## Verificación

```powershell
pnpm check
pnpm smoke
```

`pnpm smoke` necesita la API local en marcha. `SMOKE_RUNS=50` permite ejecutar la puerta de calidad de 50 simulaciones internas.

## Cloudflare

Los recursos de AXYRO en la cuenta de desarrollo son `axyro-db` (D1, EU), `axyro-files` (R2, EU) y `axyro-events` (Queue). `wrangler.jsonc` contiene el ID público de D1 y reserva el dominio `axyro.qhel.dev` para el Worker. Las credenciales deben mantenerse fuera de Git. La URL `workers.dev` y las URL de vista previa están desactivadas para que el despliegue se sirva por el dominio protegido. El Worker remoto usa Cloudflare Access con el equipo `bitter-cake-9de8.cloudflareaccess.com`. La aplicación Access `AXYRO SIM / DECISION` protege todo `axyro.qhel.dev` con una política limitada a `ezequiel@identy.cloud`, y su identificador `aud` está configurado en el Worker.

Entorno cloud de desarrollo: <https://axyro.qhel.dev/>. Se requiere iniciar sesión mediante Cloudflare Access.

El token de desarrollo permite desplegar con `Workers Editor`, aplicar migraciones D1 y gestionar Queues/R2; `Workers Routes Write` está limitado a `qhel.dev`. La aplicación Access y sus políticas se administran por separado en el panel. La cola actual se creó sin jurisdicción porque la API de Queues rechazó la opción `eu`; sus mensajes llevan IDs seudónimos y eventos, sin nombres ni correos.

## Contrato de API

`GET /api/scenarios`, `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/commands`, `GET /api/sessions/:id/events` y `GET/POST /api/memberships` para instructores. Los comandos incluyen un `id` para idempotencia. Los roles y la organización se resuelven en el servidor; la identidad demo solo existe en `wrangler.local.jsonc`.
