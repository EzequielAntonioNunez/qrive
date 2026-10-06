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

`AxyroSessionClient` conecta la escena con la API local (`http://127.0.0.1:8787/api`) como `demo-participant` (en WebGL, con la identidad real; ver «Simulador en el navegador»). Con `--axyro-session=<id>` queda fijado a esa sesión; sin él, sigue siempre la sesión más reciente, de modo que al crear una sesión nueva en la consola Unity cambia solo. El participante se une automáticamente a la sesión, en cualquier fase mientras no haya terminado. Consulta el estado cada 1,5 s, sincroniza fase y estado con el tutor, muestra la cuenta atrás, la consecuencia de cada decisión y avisa durante 10 s de incidentes y tiempos agotados. La consola indica si Unity está conectado.

- Decidir: clic en las tarjetas de opción, por voz («uno», «dos», «tres»; «repetir» vuelve a reproducir la intervención) o con las teclas `1`–`4`. La voz se reconoce en el propio equipo con Vosk (Apache 2.0, modelo `vosk-model-small-es-0.42` en `Assets/StreamingAssets/vosk-model-es/`, librería en `Assets/Plugins/x86_64/`) con una gramática cerrada de órdenes: el audio del micrófono solo se procesa en memoria, no se envía ni se guarda. El micrófono se cierra mientras habla el tutor o la ventana no tiene el foco. Si falta el micrófono, el modelo o la librería, o Windows no deja abrir el micrófono, la voz queda desactivada («Voz no disponible · elige con el ratón») y se elige con ratón o teclado. Comprobado en un portátil con Intel Smart Sound: el micrófono falla también fuera de Unity (MME error 11), así que no es un fallo del simulador.
- `Espacio` reproduce o detiene la intervención; `F11` (o `Alt+Intro`) alterna pantalla completa; `Esc` cierra.
- Se abre siempre en ventana de 1600×900 (`--axyro-fullscreen` para arrancar en pantalla completa).
- Sin sesión: demo autónoma; `1`/`2`/`3` cambian de fase.
- Pausa y finalización del instructor se reflejan en Unity.
- Argumentos de QA: `--axyro-autodecide=<1-4>` elige esa opción en cada fase; `--axyro-capture=<png>` guarda una captura tras `--axyro-capture-delay=<s>` (3 s por defecto); `--axyro-capture-feedback=<png>` captura la animación de respuesta a la decisión; `--axyro-autoplay` reproduce la intervención al arrancar.

El HUD Rive se edita en `assets/hud/scene.rml`; el `.riv` compilado se versiona en `unity/AXYRO.Simulation/Assets/AXYRO/hud.riv`.

El ejecutable Windows solo usa la identidad demo de bucle local (`--axyro-session=<id>` o `--axyro-session <id>`). El participante remoto usa la build WebGL servida desde el mismo dominio (ver «Simulador en el navegador»); nunca un token incluido en la build.

## Simulador en el navegador

El participante abre el simulador 3D en el navegador, sin instalar nada, desde `https://axyro.qhel.dev/simulador/?sesion=<id>`.

1. El instructor crea la sesión en la consola. En «Experiencia del participante» aparece el enlace para participantes con «Copiar enlace» y «Abrir simulador».
2. El docente registra a cada persona en «Vista general › Personas y códigos» con cualquier dirección de correo, le asigna un rol y genera su código personal de seis cifras. El código se muestra una sola vez; el docente lo entrega por un canal privado. Cada persona pertenece a una sola organización.
3. Al abrir el enlace, la persona introduce correo y código en la página de AXYRO. El Worker crea una sesión propia de 24 horas con cookie segura. El código se guarda en D1 como HMAC con un secreto del Worker; no viaja dentro de la build WebGL. Cambiar o revocar el código invalida las sesiones activas.
4. El cliente consulta `GET /api/me` para conocer su identidad y rol, se une a la sesión y decide con el ratón o con la tecla correspondiente a una opción. Se puede unir en cualquier fase mientras la sesión no haya terminado: quien llega tarde empieza en la fase actual con los indicadores iniciales.

Comportamiento del cliente en WebGL (`AxyroSessionClient.cs`, `#if UNITY_WEBGL && !UNITY_EDITOR`): la API es `<origen>/api`, sin cabecera `x-demo-user`, y la sesión sale del parámetro `sesion`. Sin él muestra «Abre el simulador desde el enlace que te comparta tu docente». Un instructor que abre el enlace ve la sesión sin poder decidir. No hay voz por micrófono: la escena web se genera sin `AxyroVoiceCommands`. El lip sync de uLipSync funciona en WebGL leyendo las muestras del clip (`autoAudioSyncOnWebGL`); por eso las locuciones llevan en WebGL `Decompress On Load`. El navegador no reproduce audio hasta el primer clic del participante.

### Compilar y publicar

```powershell
pnpm unity:webgl        # con el editor de Unity cerrado; requiere el módulo «Web Build Support»
pnpm deploy:cloud
```

- `scripts/unity-webgl.ps1` ejecuta `AxyroSceneBuilder.BuildWebGL` (escena regenerada, plantilla `Assets/WebGLTemplates/UFV/`, Brotli con `decompressionFallback`, nombres con hash, sin el modelo Vosk) en `unity/AXYRO.Simulation/Build/WebGL` y lo copia a `web/public/simulador/`. Esta salida se versiona para que GitHub Actions despliegue el mismo simulador sin instalar Unity. Vite lo incluye en `dist/web` y el despliegue lo sube como static assets.
- Los static assets de Workers admiten como máximo 25 MiB por fichero. Los ficheros que lo superan se suben a R2 (`axyro-files/simulador/<ruta>`, jurisdicción UE) con `wrangler r2 object put --remote`. `pnpm unity:webgl -SkipBuild` repite solo la publicación.
- El Worker atiende `/simulador` y `/simulador/*` antes que los assets (`run_worker_first`): sirve el asset si existe y, si no, el objeto de R2 con su `Content-Type` (`.wasm` → `application/wasm`, `.data`/`.unityweb` → `application/octet-stream`) y caché `immutable` para `Build/` (`worker/simulator.ts`). `/simulador` redirige a `/simulador/` conservando `?sesion=` y, si no hay sesión de AXYRO, muestra la página propia de acceso antes de cargar Unity.
- En local: con `pnpm dev:api` y `pnpm dev:web`, el enlace de la consola apunta a `http://127.0.0.1:5173/simulador/index.html?sesion=<id>` (Vite no resuelve la carpeta). Con la API local el cliente WebGL detecta el modo demo en `/api/me` y actúa como participante demo.

## Voz del tutor

Las locuciones son WAV generados con la API de Soniox a partir del guion público e incluidos en Unity. En tiempo de ejecución no hay ninguna llamada a Soniox ni clave en el cliente.

- Motor: Soniox TTS RT v2, voz `Carmen` (femenina, español de España). Se envía a Soniox únicamente `characterLine` de los escenarios versionados, sin audio ni datos de participantes.
- Cada WAV se nombra por el id de fase (`Assets/AXYRO/Audio/<idDeFase>.wav`). Los escenarios sin locución no reproducen voz.

```powershell
$env:SONIOX_API_KEY = '<clave del proyecto Soniox>'
node scripts/tts/generate_soniox.mjs --phase datos-personales # muestra en .local-state/tts/soniox-preview/
node scripts/tts/generate_soniox.mjs --all --install         # actualiza los 12 WAV de Unity
Remove-Item Env:SONIOX_API_KEY
pnpm unity:webgl
```

La clave disponible hoy pertenece a un proyecto Soniox de Estados Unidos. Solo se usa para sintetizar el guion público; la respuesta por micrófono en la nube requiere un proyecto Soniox de la región UE y permanece desactivada hasta disponer de él. En Windows, las órdenes de voz siguen reconociéndose localmente con Vosk.

`export-lines.mjs` vuelca las frases (`characterLine`) de los escenarios de catálogo. `generate_voice.py` admite `--only <ids>`, `--exaggeration`, `--cfg`, `--seed` y `--variants` (tres combinaciones de expresividad para elegir de oído).

Entorno Python en `.local-state/tts/.venv`, creado con uv: Python 3.11 y PyTorch 2.8 con CUDA 12.8 (`cu128`), necesario para la GPU Blackwell. En la red de la UFV, que inspecciona TLS, hay que exportar `UV_SYSTEM_CERTS=1` al instalar y tener `truststore` en el entorno (los scripts lo inyectan si está disponible).

## Verificación

```powershell
pnpm check
pnpm smoke
```

`pnpm smoke` necesita la API local en marcha. `SMOKE_RUNS=50` permite ejecutar la puerta de calidad de 50 simulaciones internas.

## Despliegue

- CI (`.github/workflows/ci.yml`): `pnpm check` en cada push y pull request. En push a `main`, el job `deploy` aplica las migraciones D1 remotas, despliega el Worker y comprueba `/api/health`, pero **solo si la variable de repositorio `CLOUDFLARE_DEPLOY` vale `true`** (Settings › Secrets and variables › Actions › Variables) y existen los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`. Sin la variable el job queda omitido, no fallido. Hoy no está activado.
- Mientras tanto: `pnpm deploy:cloud` desde un equipo con sesión `wrangler login` activa (tests, migraciones D1 remotas y despliegue).
- Secretos del Worker: `BOOTSTRAP_OWNER_EMAIL` identifica al propietario inicial y `ACCESS_CODE_PEPPER` protege los códigos de seis cifras. Se guardan como secretos de Cloudflare, nunca en `wrangler.jsonc` ni en Git. En local la API usa la identidad demo.
- Tras cambiar la escena o el código de Unity, ejecuta `pnpm unity:webgl` y confirma también `web/public/simulador/` en Git. El CI comprueba que la build está presente; en el navegador se pulsa «Escuchar» para iniciar la locución y después aparecen las opciones.
- En la red de la UFV, `curl.exe` necesita `--ssl-no-revoke` para las comprobaciones HTTPS.

## Cloudflare

Los recursos en la cuenta de desarrollo son `axyro-db` (D1, EU), `axyro-files` (R2, EU) y `axyro-events` (Queue). `wrangler.jsonc` contiene el ID público de D1 y reserva `axyro.qhel.dev` para el Worker. Las credenciales se mantienen fuera de Git. La URL `workers.dev` y las URL de vista previa están desactivadas. La autenticación de usuarios la ofrece AXYRO con correo y código; Cloudflare solo sirve la infraestructura.

Otras variables de `wrangler.jsonc`: `SESSIONS_JURISDICTION` (`eu`: Durable Objects de sesión en la UE), `RETENTION_DAYS` (365), `AUDIT_RETENTION_DAYS` (730) y `FEATURE_FLAGS`. `ACCESS_CODE_PEPPER` y `BOOTSTRAP_OWNER_EMAIL` son secretos del Worker. `observability` está activado (logs del Worker en el panel).

Entorno cloud de desarrollo: <https://axyro.qhel.dev/>. Se entra con correo y código personal.

El dominio definitivo (p. ej. bajo `ufv.es`) está por decidir; al cambiarlo hay que actualizar `wrangler.jsonc`, `scripts/deploy.ps1` y `.github/workflows/ci.yml`.

La cuenta permite desplegar Workers y gestionar Queues/R2. Si la API administrativa de D1 responde 7403, la migración puede aplicarse desde un Worker local con la vinculación D1 remota; no se debe omitir una migración sin verificarla. La cola actual se creó sin jurisdicción porque la API de Queues rechazó la opción `eu`; sus mensajes solo llevan IDs seudónimos y los campos de la lista blanca `QUEUE_DETAIL_FIELDS` (`worker/room.ts`): el texto de los incidentes no sale a la cola.

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

### Modo individual

Cada participante tiene sus propios indicadores (`participantMeters`): sus decisiones y los vencimientos de reloj solo le afectan a él; los incidentes y los ajustes del docente afectan a todos. `meters` es la media de la clase. El informe del instructor es el de la clase (puntuación y objetivos sobre la media) con `participantReports`, el informe de cada participante, que la consola muestra en «Resultados por participante».

El participante solo recibe `participantView` y `participantReport` (`roomPayload` en `worker/room.ts`): sus indicadores, sus decisiones y su informe, sin datos de compañeros, y sin `quality`, `rationale`, `effects` ni `takeaway` en las fases en las que aún no ha decidido (con la sesión finalizada se muestra todo). La lista `GET /api/sessions` del participante solo incluye las sesiones a las que se ha unido, y no puede leer `/events`.

## Datos personales (RGPD)

- Exportación: `GET /api/sessions/:id/export` devuelve estado, eventos e informe. En la consola, «Exportar JSON».
- Borrado de sesión: `DELETE /api/sessions/:id` elimina la sesión en D1 y en su Durable Object; solo queda la entrada de auditoría. En la consola, «Eliminar sesión» con confirmación. Exportar y borrar quedan para el instructor que creó la sesión (o cualquier instructor si el creador ya no es miembro).
- Baja de miembros: `DELETE /api/memberships/:userId` (instructor; sin botón en la consola). Si al usuario no le quedan membresías, se borran también su correo y su nombre; la auditoría solo guarda IDs. No se puede dar de baja a uno mismo, al propietario inicial ni al último instructor (409).
- Retención: un cron diario (`17 3 * * *`) borra las sesiones finalizadas hace más de `RETENTION_DAYS` días (365 por defecto) y las no finalizadas creadas hace más de ese plazo (hasta 200 por ejecución), y lo audita; también borra las entradas de `audit_log` con más de `AUDIT_RETENTION_DAYS` días (730).
- Durable Objects de sesión en la jurisdicción UE (`SESSIONS_JURISDICTION = "eu"`). D1 y R2 también en la UE; la cola no (ver «Cloudflare»).
- Los eventos y la cola solo llevan IDs seudónimos; la cola, además, solo los campos de `QUEUE_DETAIL_FIELDS` (la nota del incidente se queda en el Durable Object y no llega a D1 por la cola). El consumidor vuelve a filtrar por si llegan mensajes antiguos.
- Voz en Unity: el reconocimiento es local y por palabras clave; no se graba ni se envía audio.

## Demo en navegador

`pnpm build:standalone` genera en `dist/standalone/` la consola con la API emulada dentro del navegador, usando el mismo motor. Sirve para enseñar el flujo de instructor y participante sin servidor ni Unity. No se despliega con el Worker.

## Identidad visual

La consola usa la identidad UFV de la plantilla `UFV_Rockw_25_03`: azul UFV `#003865`, tinta `#001A33`, acento `#649EFF`, coral `#FF5D74` y carmesí `#C03656` para riesgo y decisiones críticas; Arial para texto y Rockwell para titulares (con alternativas serif si no está instalada). Los logos están en `web/public/brand/` y la configuración de marca (organización, logos y nombre de producto) en `web/brand.ts`, de modo que otro cliente solo cambia esos archivos. La interfaz no muestra la marca interna. La escena Unity usa la misma paleta; regenérala con `AXYRO > Crear escena de avatar` para aplicarla.

## Temporizadores de fase

Cada fase del escenario define `timeLimitSec` y `timeoutRiskDelta`. El reloj de la primera fase arranca con el primer participante, se congela al pausar y se reinicia al avanzar. Al vencer, la alarma del Durable Object emite `timer_expired` (actor `system`) y aplica la penalización de riesgo solo a quien aún no ha decidido en la fase; la fase no avanza sola y se puede seguir decidiendo. La consola y Unity muestran la cuenta atrás, y el informe cuenta los tiempos agotados.

## Contratos y configuración

- `shared/events.ts`: catálogo versionado de eventos (`EVENT_SCHEMA_VERSION`). Solo IDs seudónimos.
- `shared/contracts/ai-provider.ts` y `shared/contracts/context-engine.ts`: interfaces de AI Provider y Context Engine. Sin implementación hasta la macrofase de IA avanzada.
- `worker/flags.ts`: feature flags desde la variable `FEATURE_FLAGS` (JSON). `phase_timers` desactiva las alarmas; `ai_characters` y `realtime_websocket` están reservados.
- Rate limiting: binding `API_LIMITER`, 300 peticiones por minuto y usuario en el entorno cloud. No se aplica en modo local.

## Seguridad

- Identidad (`worker/auth.ts`, `worker/access-codes.ts`): la API resuelve la cookie de sesión contra D1 en cada petición y comprueba que el código siga activo y la membresía vigente. El código tiene seis cifras, es único y se almacena como HMAC con `ACCESS_CODE_PEPPER`; el secreto no está en D1. D1 aplica de forma transaccional un máximo de cinco intentos por correo y 120 por IP en 60 segundos; los limitadores de Cloudflare quedan como defensa adicional. La sesión dura 24 horas. La unión a una simulación se registra también de forma síncrona para que aparezca al instante en la lista del participante.
- Membresías: un usuario pertenece a una sola organización. Solo el propietario inicial asigna el rol docente; un docente puede registrar participantes. Los permisos efectivos se derivan de la membresía en el servidor. Cambiar o revocar el código invalida la sesión. Cada uso correcto, y cada intento con un código revocado conocido, queda en `access_code_uses`; la consola muestra contador y últimos accesos.
- CSRF: `POST`/`PUT`/`PATCH`/`DELETE` en `/api/*` exigen `Sec-Fetch-Site` `same-origin` o `none` (o, sin esa cabecera, un `Origin` del mismo host) y cuerpo `application/json` (salvo `DELETE` sin cuerpo); si no, 403. Un JSON mal formado es un 400 «Cuerpo JSON no válido.».
- Cabeceras: CSP distinta para API, consola y `/simulador` (esta admite WebAssembly y los scripts en línea de la plantilla de Unity), HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: same-origin`, COOP/CORP y `Permissions-Policy` sin cámara ni micrófono. El Worker atiende todo salvo `/assets/*` y `/brand/*` (`run_worker_first`) para poder añadirlas.
- Observabilidad: cada respuesta lleva `x-request-id` (el `cf-ray` si existe) y cada petición deja un log JSON con método, ruta, estado, duración y los IDs seudónimos de organización y usuario, sin correos. Un 500 devuelve el `requestId`, no el detalle del error.

## Contrato de API

- Cualquier miembro: `GET /api/me`, `GET /api/scenarios`, `GET /api/scenarios/:id`, `GET /api/sessions` (el participante, solo las suyas), `GET /api/sessions/:id` (vista por rol) y `POST /api/sessions/:id/commands`.
- Instructor: `POST /api/scenarios`, `POST /api/sessions`, `GET /api/sessions/:id/events`, `GET /api/sessions/:id/export`, `DELETE /api/sessions/:id`, `GET/POST /api/memberships`, `DELETE /api/memberships/:userId` y gestión de códigos con `GET /api/access-codes`, `POST/DELETE /api/access-codes/:userId`.
- Acceso: `POST /api/auth/login` acepta correo y código; `POST /api/auth/logout` cierra la sesión. La entrega del código es responsabilidad del docente; nunca se envía correo desde la plataforma.
- `GET /api/health` sin autenticación de la API.

Los comandos incluyen un `id` para idempotencia. Los roles y la organización se resuelven en el servidor; la identidad demo solo existe en `wrangler.local.jsonc` (`worker/local.ts`).
