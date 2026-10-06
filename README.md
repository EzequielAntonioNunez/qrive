# AXYRO SIM / DECISION

Primer corte ejecutable del escenario **Negociación con proveedor**. Incluye un panel web para instructor y participante, API Hono en Cloudflare Workers, estado de sesión en Durable Objects, datos en D1 y eventos persistidos a través de Queues.

El panel web es la consola del instructor y del participante: permite ver participantes, dar de alta miembros internos, controlar fases, lanzar incidentes y ajustar indicadores; la cronología registra cada acción. La web no muestra ningún personaje.

Según la arquitectura v1.1, **Unity** es el cliente de simulación y se hace cargo del personaje, renderizado, animación, audio, interacción y ejecución local. **Rive** sirve al HUD, estados y feedback dentro de Unity. **React** es la consola del instructor y administración. El personaje «Elena Vega» de Unity (retrato con parpadeo y habla por amplitud de audio) sigue siendo un **prototipo visual**; queda pendiente sustituirlo por un personaje producido y animado antes de cerrar la etapa Simulation Core.

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

Demo completa en segundo plano (API, consola web y cliente Unity con una sesión ya creada):

```powershell
pnpm demo
pnpm demo:stop
```

Los logs quedan en `.local-state/logs/`. Si no existe la compilación Windows de Unity, abre la escena en el editor y pulsa Play.

## Cliente Unity

El proyecto `unity/AXYRO.Simulation` usa Unity **6000.3.25f1** y el paquete Rive para Unity **v0.5.1**. La escena `Assets/Scenes/AXYRO Avatar Demo.unity` se genera con el menú `AXYRO > Crear escena de avatar` (`Editor/AxyroSceneBuilder.cs`).

`AxyroSessionClient` conecta la escena con la API local (`http://127.0.0.1:8787/api`) como `demo-participant`. Con `--axyro-session=<id>` queda fijado a esa sesión; sin él, sigue siempre la sesión más reciente, de modo que al crear una sesión nueva en la consola Unity cambia solo. Consulta el estado cada 1,5 s, sincroniza fase y estado con el personaje, muestra la cuenta atrás, la consecuencia de cada decisión y avisa durante 10 s de incidentes y tiempos agotados. La consola indica si Unity está conectado.

- Con sesión local: `J` se une a la sesión, `1`/`2`/`3` envían la decisión de la fase actual y `Espacio` reproduce la intervención. Pausa y finalización del instructor se reflejan en Unity.
- Sin sesión: demo autónoma; `1`/`2`/`3` cambian de fase y `Espacio` reproduce la voz.

El HUD Rive se edita en `assets/hud/scene.rml`; el `.riv` compilado se versiona en `unity/AXYRO.Simulation/Assets/AXYRO/hud.riv`. Los tres WAV se generaron con la voz española local mediante `scripts/generate-avatar-voice.ps1`. La animación de boca responde a la amplitud del audio, no a fonemas. La compilación Windows se guarda en `unity/AXYRO.Simulation/Build/`, ignorada por Git.

El cliente Unity solo usa la identidad demo de bucle local. Un cliente remoto necesitará su propio flujo de autenticación con Cloudflare Access; nunca un token incluido en la build.

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

## Escenarios

Los escenarios son datos versionados en D1 (tabla `scenarios`, migración `0002`). El escenario de catálogo `supplier-negotiation` vive en `shared/simulation.ts` y se publica automáticamente en D1 la primera vez que se consulta. Cada sesión guarda una copia del escenario con el que empezó, así que publicar una versión nueva no altera sesiones en curso.

- `GET /api/scenarios`: última versión de cada escenario visible (catálogo + propios de la organización).
- `GET /api/scenarios/:id`: definición completa; sirve de plantilla para crear otro.
- `POST /api/scenarios`: el instructor publica un escenario propio o una versión nueva. Se valida con `shared/scenario.ts` (1–8 fases, 2–4 opciones, efectos entre -50 y 50, `characterLine` obligatorio) y se audita. Las versiones son inmutables y deben crecer; los IDs del catálogo están reservados.
- `POST /api/sessions` acepta `{ "scenarioId": "..." }`. La consola muestra un selector cuando hay más de un escenario.

Unity toma títulos y textos del personaje de la API y admite escenarios con cualquier número de fases y hasta 4 opciones (teclas 1–4). La locución WAV solo existe para el escenario de catálogo; en otros escenarios el botón de voz se desactiva.

## Debriefing y Performance Report

El informe sigue el formato de la arquitectura: decisiones correctas (% de opciones valoradas `best`), tiempo de reacción (% medio de tiempo sobrante frente al límite de la fase), objetivos cumplidos, decisiones críticas (opciones `poor`) y tiempos agotados. Cada opción del escenario puede llevar `quality: best | acceptable | poor`; es una valoración de diseño de la decisión, no de la persona. No se infieren emociones ni estados psicológicos. La consola muestra el debriefing por fase y el instructor puede descargarlo en CSV (separador `;`, UTF-8 con BOM para Excel).

## Datos personales (RGPD)

- Exportación: `GET /api/sessions/:id/export` (instructor) devuelve estado, eventos e informe. En la consola, «Exportar JSON».
- Borrado: `DELETE /api/sessions/:id` (instructor) elimina la sesión en D1 y en su Durable Object; solo queda la entrada de auditoría. En la consola, «Eliminar sesión» con confirmación.
- Retención: un cron diario (`17 3 * * *`) borra las sesiones finalizadas hace más de `RETENTION_DAYS` días (365 por defecto) y lo audita.
- Los eventos y la cola solo llevan IDs seudónimos. Pendiente: cola con jurisdicción UE y borrado de miembros.

## Demo en navegador

`pnpm build:standalone` genera en `dist/standalone/` la consola con la API emulada dentro del navegador, usando el mismo motor. Sirve para enseñar el flujo de instructor y participante sin servidor ni Unity. No se despliega con el Worker.

## Identidad visual

La consola usa la identidad UFV de la plantilla `UFV_Rockw_25_03`: azul UFV `#003865`, tinta `#001A33`, acento `#649EFF`, coral `#FF5D74` y carmesí `#C03656` para riesgo y decisiones críticas; Arial para texto y Rockwell para titulares (con alternativas serif si no está instalada). Los logos están en `web/public/brand/` y la configuración de marca en `web/brand.ts`, de modo que otro cliente solo cambia esos archivos. La escena Unity usa la misma paleta; regenérala con `AXYRO > Crear escena de avatar` para aplicarla.

## Temporizadores de fase

Cada fase del escenario define `timeLimitSec` y `timeoutRiskDelta` (8, 5 y 4 minutos). El reloj de la primera fase arranca con el primer participante, se congela al pausar y se reinicia al avanzar. Al vencer, la alarma del Durable Object emite `timer_expired` (actor `system`) y aplica la penalización de riesgo; la fase no avanza sola y se puede seguir decidiendo. La consola y Unity muestran la cuenta atrás, y el informe cuenta los tiempos agotados.

## Contratos y configuración

- `shared/events.ts`: catálogo versionado de eventos (`EVENT_SCHEMA_VERSION`). Solo IDs seudónimos.
- `shared/contracts/ai-provider.ts` y `shared/contracts/context-engine.ts`: interfaces de AI Provider y Context Engine. Sin implementación hasta la macrofase de IA avanzada.
- `worker/flags.ts`: feature flags desde la variable `FEATURE_FLAGS` (JSON). `phase_timers` desactiva las alarmas; `ai_characters` y `realtime_websocket` están reservados.
- Rate limiting: binding `API_LIMITER`, 300 peticiones por minuto y usuario en el entorno cloud. No se aplica en modo local.

## Contrato de API

`GET /api/scenarios`, `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/commands`, `GET /api/sessions/:id/events` y `GET/POST /api/memberships` para instructores. Los comandos incluyen un `id` para idempotencia. Los roles y la organización se resuelven en el servidor; la identidad demo solo existe en `wrangler.local.jsonc`.
