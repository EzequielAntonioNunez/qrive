# Simulador de decisiones UFV

Plataforma de simulación para formación y toma de decisiones. Primer despliegue: Universidad Francisco de Vitoria (UFV). Todo lo que ve el usuario lleva la marca UFV: la consola web se presenta como «Simulador de decisiones» (`web/brand.ts`) y el cliente Unity como «Simulador UFV». **AXYRO** es solo el nombre interno del código, del repositorio y de los recursos de Cloudflare.

Incluye una consola web para instructor y participante, API Hono en Cloudflare Workers, estado de sesión en Durable Objects, datos en D1 y eventos persistidos a través de Queues.

La consola web permite ver participantes, dar de alta miembros internos, controlar fases, lanzar incidentes y ajustar indicadores; la cronología registra cada acción. La web no muestra ningún personaje.

Según la arquitectura v1.1, **Unity** es el cliente de simulación y se hace cargo del personaje, renderizado, animación, audio, interacción y ejecución local. **Rive** se usa solo para el HUD dentro de Unity (indicadores de hablando/escuchando). **React** es solo la consola del instructor y administración.

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

El proyecto `unity/AXYRO.Simulation` usa Unity **6000.3.25f1** con URP, el paquete Rive para Unity **v0.5.1** y uLipSync **v3.1.5** (MIT). La escena `Assets/Scenes/AXYRO Avatar Demo.unity` se genera con el menú `AXYRO > Crear escena de avatar` (`Editor/AxyroSceneBuilder.cs`). `pnpm unity:build` (con el editor cerrado) la regenera y compila el ejecutable Windows `unity/AXYRO.Simulation/Build/Simulador-UFV.exe`; la carpeta `Build/` está ignorada por Git.

### Tutor 3D

- Modelo provisional: Microsoft Rocketbox `Business_Female_04` (MIT), importado por `Editor/AxyroTutorSetup.cs` en `Characters/Tutor/` (FBX, texturas, animaciones y `Tutor.controller`). El personaje definitivo está previsto con Reallusion Character Creator 4.
- `AxyroTutor3D.cs`: alterna animaciones de escucha y de habla, parpadeo aleatorio y mirada a cámara por IK.
- Lip sync con uLipSync (perfil femenino de ejemplo): las vocales A, I, U, E, O y la N se mapean a los visemas del modelo.
- Escena de oficina con fondo desenfocado, iluminación de estudio y postproceso URP (`Rendering/AXYRO-Volume.asset`).

### Interacción

`AxyroSessionClient` conecta la escena con la API local (`http://127.0.0.1:8787/api`) como `demo-participant` (en WebGL, con la identidad real; ver «Simulador en el navegador»). Con `--axyro-session=<id>` queda fijado a esa sesión; sin él, sigue siempre la sesión más reciente, de modo que al crear una sesión nueva en la consola Unity cambia solo. El participante se une automáticamente en cuanto hay una sesión activa. Consulta el estado cada 1,5 s, sincroniza fase y estado con el tutor, muestra la cuenta atrás, la consecuencia de cada decisión y avisa durante 10 s de incidentes y tiempos agotados. La consola indica si Unity está conectado.

- Decidir: clic en las tarjetas de opción, por voz («uno», «dos», «tres»; «repetir» vuelve a reproducir la intervención) o con las teclas `1`–`4`. La voz se reconoce en el propio equipo con Vosk (Apache 2.0, modelo `vosk-model-small-es-0.42` en `Assets/StreamingAssets/vosk-model-es/`, librería en `Assets/Plugins/x86_64/`) con una gramática cerrada de órdenes: el audio del micrófono solo se procesa en memoria, no se envía ni se guarda. El micrófono se cierra mientras habla el tutor o la ventana no tiene el foco. Si falta el micrófono, el modelo o la librería, se elige con ratón o teclado.
- `Espacio` reproduce o detiene la intervención; `F11` (o `Alt+Intro`) alterna pantalla completa; `Esc` cierra.
- Se abre siempre en ventana de 1600×900 (`--axyro-fullscreen` para arrancar en pantalla completa).
- Sin sesión: demo autónoma; `1`/`2`/`3` cambian de fase.
- Pausa y finalización del instructor se reflejan en Unity.

El HUD Rive se edita en `assets/hud/scene.rml`; el `.riv` compilado se versiona en `unity/AXYRO.Simulation/Assets/AXYRO/hud.riv`.

El ejecutable Windows solo usa la identidad demo de bucle local (`--axyro-session=<id>` o `--axyro-session <id>`). El participante remoto usa la build WebGL servida desde el mismo dominio (ver «Simulador en el navegador»); nunca un token incluido en la build.

## Simulador en el navegador

El participante abre el simulador 3D en el navegador, sin instalar nada, desde `https://axyro.qhel.dev/simulador/?sesion=<id>`.

1. El instructor crea la sesión en la consola. En «Experiencia del participante» aparece el enlace para participantes con «Copiar enlace» y «Abrir simulador».
2. **Alta del participante (imprescindible):** en «Participantes › Miembros de la organización», el instructor añade nombre y correo con «Añadir participante» (`POST /api/memberships`, rol `participant`). El Worker solo reconoce a quien tiene una membresía en D1: sin ella, `/api/*` responde 401 y el simulador muestra «No tienes acceso a esta sesión. Pide a tu docente que te dé de alta.». Un usuario pertenece a una sola organización (la primera membresía que encuentra `worker/auth.ts`), y la sesión debe ser de esa organización (si no, 404).
3. Además, la política de Cloudflare Access debe admitir el correo del participante (hoy solo admite `ezequiel@identy.cloud`; para la UFV, una regla por dominio `@ufv.es` o por grupo). Esto se configura en el panel de Access, no en el código.
4. El participante abre el enlace, inicia sesión en Access y se carga la build WebGL. Al ser el mismo origen, la cookie de Access viaja sola en cada petición: el cliente consulta `GET /api/me` para conocer su id y rol, se une a la sesión y decide con el ratón o con las teclas `1`–`4`. La unión solo es posible en la primera fase (la sesión no debe haber avanzado).

Comportamiento del cliente en WebGL (`AxyroSessionClient.cs`, `#if UNITY_WEBGL && !UNITY_EDITOR`): la API es `<origen>/api`, sin cabecera `x-demo-user`, y la sesión sale del parámetro `sesion`. Sin él muestra «Abre el simulador desde el enlace que te comparta tu docente». Un instructor que abre el enlace ve la sesión sin poder decidir. No hay voz por micrófono: la escena web se genera sin `AxyroVoiceCommands`. El lip sync de uLipSync funciona en WebGL leyendo las muestras del clip (`autoAudioSyncOnWebGL`); por eso las locuciones llevan en WebGL `Decompress On Load`. El navegador no reproduce audio hasta el primer clic del participante.

### Compilar y publicar

```powershell
pnpm unity:webgl        # con el editor de Unity cerrado; requiere el módulo «Web Build Support»
pnpm deploy:cloud
```

- `scripts/unity-webgl.ps1` ejecuta `AxyroSceneBuilder.BuildWebGL` (escena regenerada, plantilla `Assets/WebGLTemplates/UFV/`, Brotli con `decompressionFallback`, nombres con hash, sin el modelo Vosk) en `unity/AXYRO.Simulation/Build/WebGL` y lo copia a `web/public/simulador/` (ignorado por Git). Vite lo incluye en `dist/web` y el despliegue lo sube como static assets.
- Los static assets de Workers admiten como máximo 25 MiB por fichero. Los ficheros que lo superan se suben a R2 (`axyro-files/simulador/<ruta>`, jurisdicción UE) con `wrangler r2 object put --remote`. `pnpm unity:webgl -SkipBuild` repite solo la publicación.
- El Worker atiende `/simulador` y `/simulador/*` antes que los assets (`run_worker_first`): sirve el asset si existe y, si no, el objeto de R2 con su `Content-Type` (`.wasm` → `application/wasm`, `.data`/`.unityweb` → `application/octet-stream`) y caché `immutable` para `Build/` (`worker/simulator.ts`). `/simulador` redirige a `/simulador/` conservando `?sesion=`. Cloudflare Access protege todas estas rutas igual que la consola.
- En local: con `pnpm dev:api` y `pnpm dev:web`, el enlace de la consola apunta a `http://127.0.0.1:5173/simulador/index.html?sesion=<id>` (Vite no resuelve la carpeta). Con la API local el cliente WebGL detecta el modo demo en `/api/me` y actúa como participante demo.

## Voz del tutor

Las locuciones son WAV generados una sola vez en local e incluidos en Unity; en tiempo de ejecución no hay ningún servicio ni clave de IA.

- Motor: Chatterbox Multilingual (Resemble AI, MIT), que añade una marca de agua inaudible (Perth) para identificar el audio como sintético.
- Timbre: se clona una referencia **sintética** creada con Kokoro-82M, voz `ef_dora` (Apache 2.0), con `scripts/tts/make_reference.py`. No se clona a ninguna persona real. La voz final requerirá una locutora contratada con consentimiento expreso.
- Cada WAV se nombra por el id de fase (`Assets/AXYRO/Audio/<idDeFase>.wav`). Los escenarios sin locución no reproducen voz.

```powershell
node scripts/tts/export-lines.mjs .local-state/tts/lines.json
python scripts/tts/make_reference.py --out .local-state/tts/elena-reference.wav   # solo la primera vez
python scripts/tts/generate_voice.py --lines .local-state/tts/lines.json --voice .local-state/tts/elena-reference.wav --out unity/AXYRO.Simulation/Assets/AXYRO/Audio
```

`export-lines.mjs` vuelca las frases (`characterLine`) de los escenarios de catálogo. `generate_voice.py` admite `--only <ids>`, `--exaggeration`, `--cfg`, `--seed` y `--variants` (tres combinaciones de expresividad para elegir de oído).

Entorno Python en `.local-state/tts/.venv`, creado con uv: Python 3.11 y PyTorch 2.8 con CUDA 12.8 (`cu128`), necesario para la GPU Blackwell. En la red de la UFV, que inspecciona TLS, hay que exportar `UV_SYSTEM_CERTS=1` al instalar y tener `truststore` en el entorno (los scripts lo inyectan si está disponible).

## Verificación

```powershell
pnpm check
pnpm smoke
```

`pnpm smoke` necesita la API local en marcha. `SMOKE_RUNS=50` permite ejecutar la puerta de calidad de 50 simulaciones internas.

## Despliegue

- CI (`.github/workflows/ci.yml`): `pnpm check` en cada push y pull request. En push a `main`, el job `deploy` aplica las migraciones D1 remotas, despliega el Worker y comprueba `/api/health`. Necesita los secretos de GitHub `CLOUDFLARE_API_TOKEN` (aún sin crear; sin él el job falla) y `CLOUDFLARE_ACCOUNT_ID`.
- Mientras tanto: `pnpm deploy:cloud` desde un equipo con sesión `wrangler login` activa (tests, migraciones D1 remotas y despliegue).
- En la red de la UFV, `curl.exe` necesita `--ssl-no-revoke` para las comprobaciones HTTPS.

## Cloudflare

Los recursos en la cuenta de desarrollo son `axyro-db` (D1, EU), `axyro-files` (R2, EU) y `axyro-events` (Queue). `wrangler.jsonc` contiene el ID público de D1 y reserva el dominio `axyro.qhel.dev` para el Worker. Las credenciales deben mantenerse fuera de Git. La URL `workers.dev` y las URL de vista previa están desactivadas para que el despliegue se sirva por el dominio protegido. El Worker remoto usa Cloudflare Access con el equipo `bitter-cake-9de8.cloudflareaccess.com`. La aplicación Access `AXYRO SIM / DECISION` protege todo `axyro.qhel.dev` con una política limitada a `ezequiel@identy.cloud`, y su identificador `aud` está configurado en el Worker.

Entorno cloud de desarrollo: <https://axyro.qhel.dev/>. Se requiere iniciar sesión mediante Cloudflare Access.

**Pendiente de marca:** el dominio `axyro.qhel.dev` y el nombre de la aplicación Access `AXYRO SIM / DECISION` se ven en la pantalla de inicio de sesión. Hay que renombrar la aplicación Access y mover el Worker al dominio definitivo (por decidir, p. ej. bajo `ufv.es`), actualizando `wrangler.jsonc`, `scripts/deploy.ps1` y `.github/workflows/ci.yml`.

El token de desarrollo permite desplegar con `Workers Editor`, aplicar migraciones D1 y gestionar Queues/R2; `Workers Routes Write` está limitado a `qhel.dev`. La aplicación Access y sus políticas se administran por separado en el panel. La cola actual se creó sin jurisdicción porque la API de Queues rechazó la opción `eu`; sus mensajes llevan IDs seudónimos y eventos, sin nombres ni correos.

## Escenarios

Los escenarios son datos versionados en D1 (tabla `scenarios`, migración `0002`). Los escenarios de catálogo viven en `catalogScenarios` (`shared/simulation.ts`) y se publican automáticamente en D1 al consultarse:

- `ia-buenas-practicas` «Uso responsable de la IA en la universidad» (`defaultScenario`): fases `datos-personales`, `verificacion` y `evaluacion`, de 3 minutos cada una. Indicadores con etiquetas propias: Confianza, Productividad y Riesgo. Versión 3 (añade `rationale` y `takeaway`).
- `ia-docencia` «IA generativa en la docencia» (VictorIA): fases `actividad-evaluable`, `feedback-asistido` y `materiales-fuentes`, de 3 minutos cada una. Indicadores Aprendizaje, Eficiencia y Riesgo.
- `ia-atencion-estudiantes` «IA en la atención al estudiante» (VictorIA): fases `chatbot-plazos`, `sesgo-becas` y `transparencia-ia`, de 3 minutos cada una. Indicadores Confianza, Agilidad y Riesgo.
- `supplier-negotiation` «Renegociación con un proveedor estratégico»: fases `prepare`, `counteroffer` y `close` (8, 5 y 4 minutos). Indicadores Relación, Margen y Riesgo.

Aprendizaje explícito: cada opción puede llevar `rationale` (por qué es o no buena práctica, hasta 300 caracteres) y cada fase un `takeaway` (la idea clave de buena práctica, hasta 240). Ambos son opcionales; el informe los incluye en cada entrada del debriefing (`timeline[].rationale` de la opción elegida y `timeline[].takeaway` de la fase, `null` si no existen) para que la consola y Unity puedan mostrarlos. Los escenarios de VictorIA los rellenan en todas sus fases y opciones.

Cada sesión guarda una copia del escenario con el que empezó, así que publicar una versión nueva no altera sesiones en curso.

- `GET /api/scenarios`: última versión de cada escenario visible (catálogo + propios de la organización).
- `GET /api/scenarios/:id`: definición completa; sirve de plantilla para crear otro.
- `POST /api/scenarios`: el instructor publica un escenario propio o una versión nueva. Se valida con `shared/scenario.ts` (1–8 fases, 2–4 opciones, efectos entre -50 y 50, `characterLine` obligatorio, `meterLabels` opcional con `relationship`, `margin` y `risk` de hasta 24 caracteres, `rationale` y `takeaway` opcionales) y se audita. Las versiones son inmutables y deben crecer; los IDs del catálogo están reservados.
- `POST /api/sessions` acepta `{ "scenarioId": "..." }`. La consola muestra un selector cuando hay más de un escenario.

Los indicadores internos son siempre `relationship`, `margin` y `risk`; `meterLabels` solo cambia cómo se muestran (sin él: Relación, Margen, Riesgo).

Unity toma títulos y textos del personaje de la API y admite escenarios con cualquier número de fases y hasta 4 opciones. Solo hay locución para las fases con WAV generado (ver «Voz del tutor»).

## Debriefing y Performance Report

El informe sigue el formato de la arquitectura: decisiones correctas (% de opciones valoradas `best`), tiempo de reacción (% medio de tiempo sobrante frente al límite de la fase), objetivos cumplidos, decisiones críticas (opciones `poor`) y tiempos agotados. Cada opción del escenario puede llevar `quality: best | acceptable | poor`; es una valoración de diseño de la decisión, no de la persona. No se infieren emociones ni estados psicológicos. La consola muestra el debriefing por fase y el instructor puede descargarlo en CSV (separador `;`, UTF-8 con BOM para Excel).

## Datos personales (RGPD)

- Exportación: `GET /api/sessions/:id/export` (instructor) devuelve estado, eventos e informe. En la consola, «Exportar JSON».
- Borrado: `DELETE /api/sessions/:id` (instructor) elimina la sesión en D1 y en su Durable Object; solo queda la entrada de auditoría. En la consola, «Eliminar sesión» con confirmación.
- Retención: un cron diario (`17 3 * * *`) borra las sesiones finalizadas hace más de `RETENTION_DAYS` días (365 por defecto) y lo audita.
- Los eventos y la cola solo llevan IDs seudónimos. Pendiente: cola con jurisdicción UE y borrado de miembros.
- Voz en Unity: el reconocimiento es local y por palabras clave; no se graba ni se envía audio.

## Demo en navegador

`pnpm build:standalone` genera en `dist/standalone/` la consola con la API emulada dentro del navegador, usando el mismo motor. Sirve para enseñar el flujo de instructor y participante sin servidor ni Unity. No se despliega con el Worker.

## Identidad visual

La consola usa la identidad UFV de la plantilla `UFV_Rockw_25_03`: azul UFV `#003865`, tinta `#001A33`, acento `#649EFF`, coral `#FF5D74` y carmesí `#C03656` para riesgo y decisiones críticas; Arial para texto y Rockwell para titulares (con alternativas serif si no está instalada). Los logos están en `web/public/brand/` y la configuración de marca (organización, logos y nombre de producto) en `web/brand.ts`, de modo que otro cliente solo cambia esos archivos. La interfaz no muestra la marca interna. La escena Unity usa la misma paleta; regenérala con `AXYRO > Crear escena de avatar` para aplicarla.

## Temporizadores de fase

Cada fase del escenario define `timeLimitSec` y `timeoutRiskDelta`. El reloj de la primera fase arranca con el primer participante, se congela al pausar y se reinicia al avanzar. Al vencer, la alarma del Durable Object emite `timer_expired` (actor `system`) y aplica la penalización de riesgo; la fase no avanza sola y se puede seguir decidiendo. La consola y Unity muestran la cuenta atrás, y el informe cuenta los tiempos agotados.

## Contratos y configuración

- `shared/events.ts`: catálogo versionado de eventos (`EVENT_SCHEMA_VERSION`). Solo IDs seudónimos.
- `shared/contracts/ai-provider.ts` y `shared/contracts/context-engine.ts`: interfaces de AI Provider y Context Engine. Sin implementación hasta la macrofase de IA avanzada.
- `worker/flags.ts`: feature flags desde la variable `FEATURE_FLAGS` (JSON). `phase_timers` desactiva las alarmas; `ai_characters` y `realtime_websocket` están reservados.
- Rate limiting: binding `API_LIMITER`, 300 peticiones por minuto y usuario en el entorno cloud. No se aplica en modo local.

## Contrato de API

`GET /api/scenarios`, `GET/POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/commands`, `GET /api/sessions/:id/events` y `GET/POST /api/memberships` para instructores. Los comandos incluyen un `id` para idempotencia. Los roles y la organización se resuelven en el servidor; la identidad demo solo existe en `wrangler.local.jsonc`.
