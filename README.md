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

### Acceso invitado con PIN de sesión

Para clases abiertas y demostraciones, cualquiera en el aula puede entrar sin cuenta: escanea el QR o abre `/unirse`, teclea el PIN de seis cifras de la sesión y un alias, y juega en `/jugar/<id>` como participante de esa sesión (`worker/guests.ts`).

- PIN: `GET /api/sessions/:id/pin` (instructor de la organización; lo crea si falta) → `{ pin, joinUrl }`; `POST` con `{}` lo regenera y revoca el anterior. Es único entre los PIN activos y se revoca al finalizar la sesión (409 si se pide después) o se borra con ella.
- Públicas: `GET /api/join/:pin` → `{ scenarioTitle, sessionName, status }` o 404; `POST /api/join` con `{ pin, alias }` → 201 `{ sessionId, alias, participantId }`, une al invitado en directo y fija la cookie de sesión (`axyro_session`, HttpOnly, SameSite=Lax, 12 horas). Volver a unirse a la misma sesión desde el mismo navegador conserva el participante; unirse a otra sustituye la cookie anterior (también la de un miembro).
- Alias de 2 a 30 caracteres (letras, números, espacios, «.», «-», «_»; sin correos ni direcciones web). Los repetidos en la sesión pasan a «Ana 2», «Ana 3»...
- Límites: `AUTH_IP_LIMITER` por IP y, contra la fuerza bruta, 30 PIN fallidos por IP cada 10 minutos (holgado porque una clase suele compartir IP).
- Ámbito: un invitado (`guest-<uuid>`) solo puede usar `GET /api/me`, su sesión (`GET`, `/live` y comandos `join`/`decide`), la voz para su sesión y `POST /api/auth/logout`; el resto responde 403 «Acceso de invitado limitado a su sesión.». Cuenta como participante real (no simulado) y recibe la misma vista filtrada que cualquier participante.
- Caducidad: 12 horas o, al finalizar la sesión, dos horas de margen para leer su informe. El cron borra los invitados caducados.

Comportamiento del cliente en WebGL (`AxyroSessionClient.cs`, `#if UNITY_WEBGL && !UNITY_EDITOR`): la API es `<origen>/api`, sin cabecera `x-demo-user`, y la sesión sale del parámetro `sesion`. Sin él muestra «Abre el simulador desde el enlace que te comparta tu docente». Un instructor que abre el enlace ve la sesión sin poder decidir. La escena web sustituye Vosk por `AxyroWebVoice`, que recibe las órdenes de Soniox desde el navegador cuando hay una clave UE configurada. El lip sync de uLipSync funciona en WebGL leyendo las muestras del clip (`autoAudioSyncOnWebGL`); por eso las locuciones llevan en WebGL `Decompress On Load`. El navegador no reproduce audio hasta el primer clic del participante.

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

### Reacciones de VictorIA a cada decisión

Tras confirmar una decisión, VictorIA responde por voz con la misma voz Carmen (mismo modelo, 48 kHz, WAV PCM 16 bits). El guion se deriva de forma determinista de los escenarios publicados, sin cambiarlos: una entrada breve según la valoración de la **decisión** (`best`: «Buena decisión.», «Bien visto.»…; `acceptable`: «Es un paso, pero se puede hacer mejor.»…; `poor`: «Cuidado.», «Ojo con esta decisión.»…, alternadas en orden fijo), la `consequence` de la opción y, si cabe en unos 230 caracteres y no repite la consecuencia, la primera frase de su `rationale`. Nunca valora a la persona. Solo hay reacciones en las fases con locución y personaje VictorIA (33 opciones de `ia-buenas-practicas`, `ia-docencia` e `ia-atencion-estudiantes`); la negociación con proveedor no las tiene.

- `export-reactions.mjs` escribe `scripts/tts/reactions.json` (para revisar: `text` es el subtítulo y `speech` lo que se envía a Soniox, con siglas como RGPD desarrolladas) y el catálogo de Unity `Audio/Reacciones/Resources/Reacciones/reacciones.json`.
- `generate_reactions.mjs` genera cada clip, lo iguala en sonoridad (RMS medio) a las locuciones de situación con pico máximo de -1 dBFS y comprueba duración, silencio y saturación. Con `--install` copia los WAV a `Assets/AXYRO/Audio/Reacciones/Resources/Reacciones/<idFase>__<idOpcion>.wav` (con su `.meta`: Decompress On Load en WebGL, como las locuciones) y una versión MP3 a `web/public/voz/reacciones/` para la vista móvil. `--only <id,...>` limita la generación y `--reuse` no llama a Soniox.
- Unity (`AxyroAvatarDemo.PlayReaction`, `AxyroReactions.cs`) carga el clip con `Resources.Load` y lo reproduce por la misma fuente de voz, así que uLipSync mueve la boca; dispara el gesto de `AxyroTutor3D.React`, muestra la reacción como subtítulo y mantiene el panel de resultado. Si el docente avanza, la reacción se corta. «Repetir» vuelve a plantear la situación. En el modo demostración sin sesión (Windows y editor) también se puede elegir una opción con el ratón y escuchar la reacción.
- La vista móvil (`/jugar/:id`) empieza la reacción al tocar «Confirmar» (gesto necesario en iOS) y ofrece «Escuchar a VictorIA» en la tarjeta del resultado. Si falta el audio, solo se muestra el texto.

```powershell
node scripts/tts/export-reactions.mjs
$env:SONIOX_API_KEY = '<clave del proyecto Soniox>'
node scripts/tts/generate_reactions.mjs --install
Remove-Item Env:SONIOX_API_KEY
```

### Respuesta por micrófono en WebGL

En producción, guarda la clave del proyecto Soniox como secreto del Worker `SONIOX_API_KEY` e indica la región de ese proyecto en la variable `SONIOX_REGION` de `wrangler.jsonc` (`us` hoy; `eu` cuando haya proyecto en la UE). Sin la clave, el botón de micrófono permanece oculto y el simulador sigue funcionando con ratón y teclado. La clave requiere permisos de **Temporary API keys** y **Speech-to-Text real-time**. El secreto se lee en cada petición: no hace falta volver a desplegar.

```powershell
pnpm exec wrangler secret put SONIOX_API_KEY
```

Con `SONIOX_REGION=us` hay transferencia internacional de la voz: el primer clic en «Activar voz» muestra dónde se transcribe y solo el segundo («Aceptar y activar») abre el micrófono. Pendiente de validación por el DPO (ver `docs/privacidad-y-transparencia.md`).

El botón «Activar voz» pide permiso al navegador. El Worker autentica al participante y emite una clave temporal de un solo uso, válida 60 segundos para abrir una sesión de hasta 10 minutos. El audio PCM mono de 16 kHz va del navegador al WebSocket de Soniox de la región configurada; ni el Worker ni Unity reciben el audio. Unity recibe únicamente el estado del micrófono, la señal de interrupción y la frase final. La interrupción requiere voz detectada en el micrófono y texto provisional de Soniox; detiene la locución Carmen y el lip sync y muestra las opciones. Las decisiones se registran solo cuando Soniox emite `<end>`. Se puede desactivar con el mismo botón; al ocultar la pestaña se corta el micrófono.

**Respuesta libre con Clef.** Las órdenes cortas («la dos», «repetir») van directas a Unity. Una frase con palabras propias se envía a `POST /api/voice/interpret` (`{ sessionId, phrase }`, solo participantes). El Worker toma las opciones de la fase actual del estado de la sesión (nunca del cliente) y llama al modelo de decisión `@cf/cloudflare/clef-flash` de Workers AI (binding `AI`, `worker/voice-intent.ts`). La respuesta es `{ kind: 'decide' | 'confirm' | 'unclear', option, confidence, phaseId }`: se exige a la vez la probabilidad de la opción y la `confidence` global de Clef (las frases fuera de tema dan probabilidad alta pero `confidence` baja): con ambas ≥ 0,75 se decide; con probabilidad ≥ 0,45 y `confidence` ≥ 0,6 el navegador pregunta «¿Te refieres a la opción N?» y espera «sí»/«no», y por debajo pide repetir. La decisión llega a Unity como la palabra del número, por el mismo camino que el ratón. La frase no se registra.

Para pruebas **locales exclusivamente**, `worker/local.ts` acepta `SONIOX_TEST_API_KEY` en `.dev.vars` y usa el endpoint global de Soniox. El Worker de producción ignora esta clave aunque se configure por error. En Windows, las órdenes de voz siguen reconociéndose localmente con Vosk.

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
- `POST /api/sessions` acepta `{ "scenarioId": "...", "name": "..." }` (`name` opcional, 1–80 caracteres tras recortar; sin él, la consola muestra el título del escenario y la fecha). Responde 201 con el cuerpo del Durable Object (`state`, `report`, `clients`, `liveTally`) y `session`, la fila del listado. La consola muestra un selector cuando hay más de un escenario.
- `GET /api/sessions` (máximo 200; activas y pausadas primero, después por fecha de creación descendente; una consulta a D1, sin llamar a los Durable Objects) devuelve filas `{ id, name, scenarioId, scenarioTitle, scenarioVersion, status: 'active'|'paused'|'complete', createdAt, completedAt, instructorId, instructorName, mine, participantCount, simulatedCount, phaseIndex, phaseCount }`. `participantCount`/`simulatedCount` salen de los eventos `participant_joined` (IDs `sim-` = clase simulada, incluidos los ya retirados) y solo los recibe el instructor. `phaseIndex` sale del último `phase_advanced` en D1 (0 si no hay ninguno; null si la versión del escenario no está en D1).
- `PATCH /api/sessions/:id` con `{ "name": "..." }` renombra (quien puede exportar o borrar la sesión) y devuelve `{ session }`; se audita como `session_renamed` sin el texto del nombre.
- `POST /api/sessions/:id/duplicate` (cuerpo `{}` en JSON; cualquier instructor de la organización) crea una sesión nueva con la misma versión del escenario y el nombre «<nombre o título> (copia)», hasta 80 caracteres. Misma respuesta 201 que `POST /api/sessions`; se audita como `session_duplicated`.
- `sessions.status` en D1 cambia con los comandos `pause`, `resume` y `complete`, y la fase con `advance`: la API escribe ese evento en D1 en el momento (idempotente con la cola), así el listado no espera a la cola. El fin del temporizador de una fase no finaliza la sesión.

Los indicadores internos son siempre `relationship`, `margin` y `risk`; `meterLabels` solo cambia cómo se muestran (sin él: Relación, Margen, Riesgo).

Unity toma títulos y textos del personaje de la API y admite escenarios con cualquier número de fases y hasta 4 opciones. Solo hay locución para las fases con WAV generado (ver «Voz del tutor»).

## Debriefing y Performance Report

El informe sigue el formato de la arquitectura: decisiones correctas (% de opciones valoradas `best`), tiempo de reacción (% medio de tiempo sobrante frente al límite de la fase), objetivos cumplidos, decisiones críticas (opciones `poor`) y tiempos agotados. Cada opción del escenario puede llevar `quality: best | acceptable | poor`; es una valoración de diseño de la decisión, no de la persona. No se infieren emociones ni estados psicológicos. La consola muestra el debriefing por fase y el instructor puede descargarlo en CSV (separador `;`, UTF-8 con BOM para Excel).

### Modo individual

Cada participante tiene sus propios indicadores (`participantMeters`): sus decisiones y los vencimientos de reloj solo le afectan a él; los incidentes y los ajustes del docente afectan a todos. `meters` es la media de la clase. El informe del instructor es el de la clase (puntuación y objetivos sobre la media) con `participantReports`, el informe de cada participante, que la consola muestra en «Resultados por participante».

El participante solo recibe `participantView` y `participantReport` (`roomPayload` en `worker/room.ts`): sus indicadores, sus decisiones y su informe, sin datos de compañeros, y sin `quality`, `rationale`, `effects` ni `takeaway` en las fases en las que aún no ha decidido (con la sesión finalizada se muestra todo). La lista `GET /api/sessions` del participante solo incluye las sesiones a las que se ha unido, y no puede leer `/events`.

## Tiempo real

`GET /api/sessions/:id/live` con `Upgrade: websocket` abre un WebSocket (API de hibernación del Durable Object `SessionRoom`). Mismas comprobaciones que `GET /api/sessions/:id` (cookie, `API_LIMITER`, sesión de la organización: si no, 401/404) y, además, `Origin` igual al propio origen (403; en local se admite 127.0.0.1/localhost) y cabecera `Upgrade` (426). El Worker reenvía el upgrade con la identidad en una cabecera interna que construye él; nunca la del cliente. Se desactiva con el flag `realtime_websocket` (404).

- Al conectar y tras cada cambio (unión, decisión, pausa, reanudación, avance, fin, incidente, ajuste, vencimiento del reloj, clase simulada) el servidor envía `{"type":"session","data": …}`, donde `data` es exactamente el cuerpo de `GET /api/sessions/:id` para la identidad de ese socket (calculado con `roomPayload`): el participante sigue recibiendo solo su vista.
- El cliente puede enviar el texto `ping` (respuesta `pong`, automática) o `{"type":"ping"}` (respuesta `{"type":"pong"}`); cualquier otro mensaje se ignora: los cambios van por la API HTTP.
- La consulta periódica sigue funcionando igual (Unity WebGL consulta; la consola vuelve a consultar si el WebSocket falla). La CSP de la consola añade `wss://<host>` a `connect-src`. En desarrollo, el proxy de Vite necesita `ws: true` para `/api`.
- Solo el instructor recibe `liveTally: { phaseId, counts, decided, total }` (votos por índice de opción de la fase activa, participantes que ya han decidido en ella y participantes unidos). El participante nunca lo recibe.

### Clase simulada (demostraciones)

`POST /api/sessions/:id/demo-class` con `{ "count": 1-40 }` (20 por defecto) añade participantes simulados, solo para el instructor que creó la sesión y mientras no haya terminado (máximo 40 a la vez). Son seudónimos (`sim-<8 caracteres de la sesión>-NN`, «Participante simulado NN»), no son usuarios ni membresías y llevan `simulated: true` en `state.participants` y en `report.participantReports`. Se unen y deciden por el mismo camino del motor que una persona: la alarma del Durable Object (multiplexada con el reloj de fase) hace decidir a cada uno a los 2-12 s de empezar la fase, con un reparto por valoración de la opción de 45 % mejor, 35 % aceptable y 20 % mala; en pausa esperan. `DELETE /api/sessions/:id/demo-class` los retira con sus decisiones e indicadores (los eventos ya emitidos se conservan con su ID `sim-…`). Ambas operaciones devuelven el cuerpo de `GET /api/sessions/:id` más `demoClass: { added, total }` o `{ removed, total }` y quedan en la auditoría.

## Modo IA en vivo (demo)

Modo aparte del producto determinista, para demostraciones: no cambia escenarios, motor, sesiones, invitados ni analítica. Flag `ai_live_demo` (activo en `wrangler.jsonc`; con el flag desactivado todas sus rutas son 404) y **solo instructores** (participante 403; los invitados quedan fuera por la lista cerrada de `guests.ts`). Código en `worker/ai-routes.ts` (rutas), `worker/knowledge.ts` (colecciones, extracción, fragmentos, vectores y recuperación), `worker/ai-live.ts` (partidas, voz, resumen) y `worker/ai-live-prompts.ts` (prompts, esquemas y validadores). Migración `0008_ai_live.sql`.

1. El instructor crea una colección y sube contenido: PDF, DOCX, TXT, MD o texto pegado.
2. Inicia una partida sobre la colección (3-6 situaciones, opcionalmente con un tema).
3. Para cada situación el servidor recupera fragmentos de la colección y genera la narración y cuatro opciones (1 mejor, 1-2 aceptables, 1-2 malas) **solo** con esos fragmentos, citándolos. VictorIA la narra (TTS en tiempo real en el cliente), la persona responde por voz (STT en el cliente) y el servidor interpreta la frase, responde preguntas sobre el contenido y reacciona a la decisión.

**Almacenamiento.** Originales en R2 (UE) en `knowledge/<tenant>/<colección>/<documento>`; vectores en `….vec` (Float32 normalizados, uno por fragmento): un binario por documento cuesta muy poca CPU frente a miles de BLOB de D1. En D1: `knowledge_collections`, `knowledge_documents`, `knowledge_chunks` (texto y pista de cita: página o encabezado), `ai_runs` (estado, tema, anclas) y `ai_turns` (una fila por situación: JSON generado, opción elegida y reacción; nunca la frase dicha). Todo con `tenant_id`.

**Procesamiento.** PDF y DOCX se convierten con Workers AI `toMarkdown` (gratuito para estos formatos y fuera de la CPU del Worker; se quitan los metadatos del fichero); TXT y MD tal cual. Un PDF escaneado sin texto queda en estado `error` con un mensaje claro. Fragmentos de ~900 caracteres con ~150 de solapamiento; embeddings `@cf/baai/bge-m3` (1024 dimensiones, lotes de 50). Recuperación por coseno en el propio Worker sobre los vectores de la colección (caché por isolate). La subida es síncrona: `processing` → `ready` | `error`.

**Modelo.** `@cf/openai/gpt-oss-120b` (cambiable con la variable `AI_LIVE_MODEL`), con `response_format` `json_schema`, `reasoning_effort: low` y validación estricta propia; una salida no válida se reintenta una vez y después es 502 `AI_INVALID`. Evaluado el 7 de octubre con la misma guía en español: gpt-oss-120b dio JSON válido con narraciones y opciones más concretas, ~12-15 s y ~85 neuronas por situación (~670 tokens de salida) y respuestas a preguntas en 1-3 s (~35-40 neuronas); `llama-3.3-70b-instruct-fp8-fast` también válido pero más genérico, 15-24 s y ~135-155 neuronas; `qwen3.8-27b` agotó los tokens sin JSON (26 s, ~450 neuronas). Para que la espera no se note, la primera situación se genera al crear la partida y cada `/next` genera por adelantado solo la siguiente (`ctx.waitUntil`); `ai_turns` evita generar dos veces la misma (reclamación en D1 y espera). Las reacciones a cada opción se generan con la situación, así que decidir es inmediato; el resumen final se prepara al responder la última.

**Voz.** Atajos locales sin IA («la dos», «opción 3», «repite», «siguiente», «sí»/«no» tras una confirmación); si no, Clef con el conjunto ampliado `opcion_1..4`, `pregunta`, `repetir`, `siguiente`, `ninguna` y el mismo doble umbral que en las sesiones. Las preguntas se responden con los cinco fragmentos más parecidos («No lo sé con estos documentos» si no está). Claves Soniox: `POST /api/voice/tts-key` (TTS, instructor, `TTS_LIMITER` 30/min) y `POST /api/voice/temporary-key` con `{ aiRunId }` (STT, solo el instructor dueño de la partida). Con el flag, la consola admite micrófono (`Permissions-Policy`), los WebSocket de Soniox en `connect-src` y `blob:` en `media-src`.

**Contrato** (todas las rutas: flag, instructor, organización; recurso de otra organización o persona = 404; errores `{ error, code? }`):

- `GET /api/knowledge/collections` → `{ collections: [{ id, name, documentCount, chunkCount, createdAt }] }`; `POST` `{ name }` (1-80) → 201 `{ collection }`; `DELETE /api/knowledge/collections/:id` (R2, fragmentos, documentos y partidas).
- `GET /api/knowledge/collections/:id/documents` → `{ documents: [{ id, name, mime, bytes, chars, status, error, createdAt }] }`; `POST` `{ name, mime, dataBase64 }` o `{ name, text }` → 201 `{ document }`, o 422 `{ error, code: 'DOCUMENT_UNREADABLE', document }` si no se ha podido leer (queda en la lista con `status: 'error'`); 413 si supera 20 MB (cuerpo JSON de hasta ~27 MB) o 300 000 caracteres; 415 formato no admitido. `DELETE /api/knowledge/documents/:id`.
- `POST /api/ai-runs` `{ collectionId, situations?: 3-6 (4), focus?: ≤200 }` → 201 `{ run: { id, collectionId, situationsTotal, index: 0, status: 'active', focus, createdAt } }`; 409 si la colección no tiene documentos listos.
- `GET /api/ai-runs/:id` → `{ run, current, history: [{ situation, chosen, reaction }], summary }`. `current` es la situación en curso **sin responder** (null si no hay); `index` y `situation.index` empiezan en 0. `DELETE /api/ai-runs/:id`.
- `POST /api/ai-runs/:id/next` → `{ situation: { id, index, title, narration, options: [{ label, quality, consequence, rationale, sources }], sources: [{ id, document, location, excerpt }] } }` (la misma mientras no se responda; avanza tras responder) o, tras la última, `{ done: true, summary: { spoken, takeaways[3], optimalCount, total } }`. Las opciones llevan `quality`: la interfaz no debe mostrarla antes de responder.
- `POST /api/ai-runs/:id/answer` `{ phrase } | { optionIndex: 0-3 }` → `{ kind: 'decision', optionIndex, reaction: { spoken, quality, sources } } | { kind: 'confirm', optionIndex, prompt } | { kind: 'answer', spoken, sources } | { kind: 'repeat' } | { kind: 'next' } | { kind: 'unclear', spoken }`. «Siguiente» sin responder salta la situación (`chosen: null`).
- Códigos de error: `AI_QUOTA` (429, «Se ha alcanzado el límite diario de IA»: cuota de Workers AI agotada, p. ej. 10 000 neuronas al día del plan gratuito), `AI_FAILED`/`AI_INVALID` (502), `AI_PENDING` (503, la situación tarda más de 60 s), `RATE_LIMITED` (429, `AI_LIMITER` 20/min por instructor).

**Límites.** 20 MB por fichero, 10 documentos y 1500 fragmentos por colección, 300 000 caracteres por documento, 50 colecciones por organización. Las partidas se borran con la retención diaria (`RETENTION_DAYS`); las colecciones las borra el instructor.

**Local.** `pnpm dev:api:ai` (`wrangler.ai.local.jsonc`: como `dev:api` con el flag activo y Workers AI remoto; requiere `wrangler login` y consume neuronas de la cuenta).

## Datos personales (RGPD)

- Exportación: `GET /api/sessions/:id/export` devuelve estado, eventos e informe. En la consola, «Exportar JSON».
- Borrado de sesión: `DELETE /api/sessions/:id` elimina la sesión en D1 y en su Durable Object; solo queda la entrada de auditoría. En la consola, «Eliminar sesión» con confirmación. Exportar y borrar quedan para el instructor que creó la sesión (o cualquier instructor si el creador ya no es miembro).
- Baja de miembros: `DELETE /api/memberships/:userId` (instructor; sin botón en la consola). Si al usuario no le quedan membresías, se borran también su correo y su nombre; la auditoría solo guarda IDs. No se puede dar de baja a uno mismo, al propietario inicial ni al último instructor (409).
- Retención: un cron diario (`17 3 * * *`) borra las sesiones finalizadas hace más de `RETENTION_DAYS` días (365 por defecto) y las no finalizadas creadas hace más de ese plazo (hasta 200 por ejecución), y lo audita; también borra las entradas de `audit_log` con más de `AUDIT_RETENTION_DAYS` días (730).
- Durable Objects de sesión en la jurisdicción UE (`SESSIONS_JURISDICTION = "eu"`). D1 y R2 también en la UE; la cola no (ver «Cloudflare»).
- Los eventos y la cola solo llevan IDs seudónimos; la cola, además, solo los campos de `QUEUE_DETAIL_FIELDS` (la nota del incidente se queda en el Durable Object y no llega a D1 por la cola). El consumidor vuelve a filtrar por si llegan mensajes antiguos.
- Voz en Unity: el reconocimiento es local y por palabras clave; no se graba ni se envía audio.
- Acceso invitado: solo alias, sin correo; limitado a una sesión y con caducidad (12 horas, o dos horas tras finalizar la sesión). En D1 quedan el alias y el hash del token hasta que el cron los borra o se borra la sesión; el alias vive además en el estado de la sesión como nombre del participante. Eventos, cola y auditoría solo llevan el ID seudónimo `guest-<uuid>`.

## Demo en navegador

`pnpm build:standalone` genera en `dist/standalone/` la consola con la API emulada dentro del navegador, usando el mismo motor. Sirve para enseñar el flujo de instructor y participante sin servidor ni Unity. No se despliega con el Worker.

## Identidad visual

La consola usa la identidad UFV de la plantilla `UFV_Rockw_25_03`: azul UFV `#003865`, tinta `#001A33`, acento `#649EFF`, coral `#FF5D74` y carmesí `#C03656` para riesgo y decisiones críticas; Arial para texto y Rockwell para titulares (con alternativas serif si no está instalada). Los logos están en `web/public/brand/` y la configuración de marca (organización, logos y nombre de producto) en `web/brand.ts`, de modo que otro cliente solo cambia esos archivos. La interfaz no muestra la marca interna. La escena Unity usa la misma paleta; regenérala con `AXYRO > Crear escena de avatar` para aplicarla.

## Temporizadores de fase

Cada fase del escenario define `timeLimitSec` y `timeoutRiskDelta`. El reloj de la primera fase arranca con el primer participante, se congela al pausar y se reinicia al avanzar. Al vencer, la alarma del Durable Object emite `timer_expired` (actor `system`) y aplica la penalización de riesgo solo a quien aún no ha decidido en la fase; la fase no avanza sola y se puede seguir decidiendo. La consola y Unity muestran la cuenta atrás, y el informe cuenta los tiempos agotados.

## Contratos y configuración

- `shared/events.ts`: catálogo versionado de eventos (`EVENT_SCHEMA_VERSION`). Solo IDs seudónimos.
- `shared/contracts/ai-provider.ts` y `shared/contracts/context-engine.ts`: interfaces de AI Provider y Context Engine. Sin implementación hasta la macrofase de IA avanzada.
- `worker/flags.ts`: feature flags desde la variable `FEATURE_FLAGS` (JSON). `phase_timers` desactiva las alarmas del reloj; `realtime_websocket` (activo por defecto) habilita el WebSocket de tiempo real; `ai_live_demo` habilita el «Modo IA en vivo (demo)»; `ai_characters` está reservado.
- Rate limiting: binding `API_LIMITER`, 300 peticiones por minuto y usuario en el entorno cloud. No se aplica en modo local.

## Seguridad

- Identidad (`worker/auth.ts`, `worker/access-codes.ts`): la API resuelve la cookie de sesión contra D1 en cada petición y comprueba que el código siga activo y la membresía vigente. El código tiene seis cifras, es único y se almacena como HMAC con `ACCESS_CODE_PEPPER`; el secreto no está en D1. D1 aplica de forma transaccional un máximo de cinco intentos por correo y 120 por IP en 60 segundos; los limitadores de Cloudflare quedan como defensa adicional. La sesión dura 24 horas. La unión a una simulación se registra también de forma síncrona para que aparezca al instante en la lista del participante.
- Membresías: un usuario pertenece a una sola organización. Solo el propietario inicial asigna el rol docente; un docente puede registrar participantes. Los permisos efectivos se derivan de la membresía en el servidor. Cambiar o revocar el código invalida la sesión. Cada uso correcto, y cada intento con un código revocado conocido, queda en `access_code_uses`; la consola muestra contador y últimos accesos.
- CSRF: `POST`/`PUT`/`PATCH`/`DELETE` en `/api/*` exigen `Sec-Fetch-Site` `same-origin` o `none` (o, sin esa cabecera, un `Origin` del mismo host) y cuerpo `application/json` (salvo `DELETE` sin cuerpo); si no, 403. Un JSON mal formado es un 400 «Cuerpo JSON no válido.».
- Cabeceras: CSP distinta para API, consola y `/simulador` (esta admite WebAssembly y los scripts en línea de la plantilla de Unity), HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: same-origin`, COOP/CORP y `Permissions-Policy` sin cámara ni micrófono. El Worker atiende todo salvo `/assets/*` y `/brand/*` (`run_worker_first`) para poder añadirlas.
- Observabilidad: cada respuesta lleva `x-request-id` (el `cf-ray` si existe) y cada petición deja un log JSON con método, ruta, estado, duración y los IDs seudónimos de organización y usuario, sin correos. Un 500 devuelve el `requestId`, no el detalle del error.

## Contrato de API

- Cualquier miembro: `GET /api/me`, `GET /api/scenarios`, `GET /api/scenarios/:id`, `GET /api/sessions` (el participante, solo las suyas), `GET /api/sessions/:id` (vista por rol), `GET /api/sessions/:id/live` (WebSocket) y `POST /api/sessions/:id/commands`.
- Instructor: `POST /api/scenarios`, `POST /api/sessions`, `POST /api/sessions/:id/duplicate`, `PATCH /api/sessions/:id` (quien puede gestionarla), `POST/DELETE /api/sessions/:id/demo-class` (el de la sesión), `GET /api/sessions/:id/events`, `GET /api/analytics`, `GET /api/sessions/:id/export`, `DELETE /api/sessions/:id`, `GET/POST /api/memberships`, `DELETE /api/memberships/:userId` y gestión de códigos con `GET /api/access-codes`, `POST/DELETE /api/access-codes/:userId`.
- Acceso: `POST /api/auth/login` acepta correo y código; `POST /api/auth/logout` cierra la sesión. La entrega del código es responsabilidad del docente; nunca se envía correo desde la plataforma.
- Acceso invitado (ver «Acceso invitado con PIN de sesión»): públicas `GET /api/join/:pin` y `POST /api/join`; instructor `GET/POST /api/sessions/:id/pin`.
- `GET /api/health` sin autenticación de la API.

Los comandos incluyen un `id` para idempotencia. Los roles y la organización se resuelven en el servidor; la identidad demo solo existe en `wrangler.local.jsonc` (`worker/local.ts`).

### Analítica de la organización (`GET /api/analytics`)

Solo instructor (403 al participante). Agregados de su organización calculados en `worker/analytics.ts` con tres consultas a D1 (sesiones, eventos `simulation_events` y la versión publicada de cada escenario), sin Durable Objects ni caché (`Cache-Control: private, no-store`). Nunca devuelve IDs de personas ni las ordena: `quality` valora la opción elegida, no a quien la elige.

Parámetros opcionales: `from` y `to` (ISO; una fecha `AAAA-MM-DD` cubre el día completo en UTC; rango inclusivo sobre `sessions.created_at`; por defecto `to` = ahora y `from` = 365 días antes), `scenarioId` y `includeSimulated` (`true`/`false`, por defecto `false`). Un filtro no válido es un 400. Se analizan como máximo las 2000 sesiones más recientes del rango.

```
{
  range: { from, to },                       // ISO normalizados
  totals: { sessions, sessionsCompleted, sessionsActive /* activas + pausadas */, participants /* personas distintas, nunca simulados */,
            simulatedParticipants /* simulados distintos unidos, siempre informativo */, decisions,
            completionRate, optimalRate, avgDecisionSeconds },
  trend: [{ week /* lunes ISO AAAA-MM-DD, UTC */, sessions, participants, decisions, optimalRate }],
  scenarios: [{ scenarioId, title, sessions, participants, decisions, optimalRate, completionRate }],
  phases: [{ scenarioId, scenarioTitle, phaseId, phaseTitle, decisions, optimalRate,
             distribution: [{ optionId, label, quality, count, share }], mostChosenNonOptimal: { optionId, label, share } | null }],
  meters: [{ scenarioId, meter, label, avgStart, avgEnd, delta }],
  recentSessions: [{ id, name, scenarioTitle, status, createdAt, participants, optimalRate }]
}
```

- Decisiones: eventos `decision` (detail `phaseId`, `optionId`, `durationMs`), una por persona y fase; la valoración, la etiqueta y los efectos salen de la versión del escenario de su sesión. Títulos y orden de opciones, de la versión más reciente usada en el rango.
- `optimalRate`: decisiones con opción `best` / decisiones con opción valorada. `completionRate`: participantes de sesiones finalizadas que decidieron en todas las fases / participantes de sesiones finalizadas (quien se une tarde no puede completar las fases anteriores). `avgDecisionSeconds`: **mediana** de `durationMs` en segundos (un decimal); el motor cuenta desde el inicio de la fase, la unión si fue posterior o la última reanudación.
- `trend`: hasta 12 semanas que terminan en la de `to`, sin empezar antes de la de `from`; siempre rellenada con ceros. Todo se asigna a la semana de creación de la sesión.
- `phases`: solo fases con decisiones; primero las de menor `optimalRate` (dónde más se equivoca la clase), a igualdad las de más decisiones. `distribution` incluye las opciones no elegidas (`count` 0) y `share` = `count` / decisiones de la fase. `mostChosenNonOptimal` es la opción valorada no `best` más elegida; null si nadie eligió una o la fase no valora sus opciones.
- `meters`: solo sesiones finalizadas. `avgStart` = indicadores iniciales; `avgEnd` = media de los indicadores finales por participante, reconstruidos con los eventos persistidos (unión, efectos de cada decisión, incidentes, vencimientos y ajustes manuales). Etiquetas de `meterLabels` o Relación/Margen/Riesgo.
- `participants` de `trend`, `scenarios` y `recentSessions` sigue a `includeSimulated`; `totals.participants` cuenta siempre solo personas.
- **Campos que pueden ser null**: `totals.completionRate`, `totals.optimalRate`, `totals.avgDecisionSeconds`, y `optimalRate`/`completionRate` de `trend`, `scenarios`, `phases` y `recentSessions` (sin denominador: la consola muestra «Sin datos aún», nunca 0 %), `phases[].mostChosenNonOptimal`, `distribution[].quality` (opción sin valorar) y `recentSessions[].name`. Sin datos: recuentos a 0, listas vacías y `trend` con ceros; nunca `NaN`.
- Límites: las decisiones llegan a D1 por la cola, así que una decisión de hace unos segundos puede no contar aún. Retirar la clase simulada no deja evento en D1: con `includeSimulated=true`, los indicadores finales de simulados retirados pueden incluir incidentes posteriores a su retirada.
