# AXYRO SIM LAB (repo qrive)

Plataforma de simulación para formación y toma de decisiones. Primer despliegue: UFV. La referencia de alcance es `AXYRO_MVP_ARCHITECTURE_FINAL_v1.1.md`; no construir funciones de fases posteriores (VR, IA avanzada) antes de validar la anterior.

**Marca:** todo lo visible es 100 % UFV. «AXYRO» es solo el nombre interno de código, repositorio y recursos; no debe aparecer en interfaz, títulos, ejecutables ni en `docs/`. Consola web: «Simulador de decisiones» (`web/brand.ts`). Unity: producto «Simulador UFV», ejecutable `Build/Simulador-UFV.exe`.

## Arquitectura
- `shared/`: motor puro en TypeScript (`engine.ts`, `simulation.ts`, `scenario.ts`, `events.ts`, `contracts/`). Sin dependencias de Cloudflare; lo usan el Worker, los tests y la demo en navegador. `catalogScenarios` (se publican en D1 al consultarse) y `defaultScenario` = `ia-buenas-practicas`; `supplier-negotiation` sigue en catálogo. `meterLabels` es opcional y se valida en `scenario.ts`. Modo individual: indicadores por participante (`participantMeters`), `meters` = media de la clase, informe con `participantReports`; el participante solo recibe `participantView` y `participantReport`.
- Tiempo real: `GET /api/sessions/:id/live` (WebSocket con hibernación; Origin del propio origen, flag `realtime_websocket`). Mensajes `{"type":"session","data":<cuerpo de GET /api/sessions/:id para ese socket>}` tras cada cambio; `ping`→`pong`. Solo el instructor recibe `liveTally` `{phaseId,counts,decided,total}`. Clase simulada de demo: `POST/DELETE /api/sessions/:id/demo-class` (`worker/demo-class.ts`; `sim-…`, `simulated: true` en participantes e informes; deciden por la alarma, multiplexada con el reloj de fase). La consulta periódica sigue igual.
- `worker/`: API Hono en Cloudflare Workers. Estado vivo de cada sesión en el Durable Object `SessionRoom` (jurisdicción UE con `SESSIONS_JURISDICTION`), datos en D1, eventos por Queue (lista blanca `QUEUE_DETAIL_FIELDS` en `room.ts`), retención por cron. `auth.ts` y `access-codes.ts`: membresía en D1, correo y código personal de seis cifras, cookie de sesión y auditoría de usos. `app.ts`: CSRF, cabeceras de seguridad/CSP, `x-request-id` y logs JSON. `sessions.ts`: listado de sesiones en una sola consulta a D1 (nombre opcional de 1-80, recuentos por `participant_joined`, fase por `phase_advanced`), usado por `GET/POST/PATCH /api/sessions` y `POST /api/sessions/:id/duplicate`. `persist.ts`: `persistEvent` (cola y API); la API escribe en el momento los eventos de unión, avance, pausa, reanudación y fin para que `sessions.status` no espere a la cola.
- `web/`: consola de instructor y participante (React + Vite). No muestra el personaje; eso es de Unity. Marca en `web/brand.ts` y `web/public/brand/` (UFV).
- `unity/AXYRO.Simulation`: cliente de simulación (Unity 6000.3.25f1, URP, Rive 0.5.1 solo para el HUD, uLipSync). Tutor 3D en `Assets/AXYRO/AxyroTutor3D.cs` y `Characters/Tutor/` (provisional Rocketbox, MIT). `AxyroSessionClient.cs` habla con la API y se une solo a la sesión; decisión por ratón, voz (Vosk local, sin grabar audio; no en WebGL) o teclas 1-4. La escena se genera con `AXYRO > Crear escena de avatar` o `AxyroSceneBuilder.BuildWindows`/`BuildWebGL` en batch. Argumentos de QA: `--axyro-session=<id>`, `--axyro-autodecide=<1-4>`, `--axyro-capture=<png>`, `--axyro-capture-delay=<s>`, `--axyro-capture-feedback=<png>`, `--axyro-fullscreen`.
- `scripts/tts/`: locuciones WAV offline con Chatterbox Multilingual sobre una referencia sintética Kokoro (`ef_dora`); se nombran por id de fase. Entorno en `.local-state/tts/.venv` (ver README).

## Comandos
- `pnpm dev:api` + `pnpm dev:web`: desarrollo local (identidad demo, datos en `.local-state/`). `pnpm db:local` aplica migraciones locales.
- `pnpm check`: tests + typecheck + build + dry-run del Worker. Debe pasar antes de cualquier commit.
- `pnpm smoke` (API local en marcha; `SMOKE_RUNS=50` es la puerta de calidad de Simulation Core).
- `pnpm demo` / `pnpm demo:stop`: todo en segundo plano, incluido Unity.
- `pnpm deploy:cloud`: tests, migraciones D1 remotas pendientes y despliegue en `axyro.qhel.dev` (requiere `wrangler login`). El job `deploy` del CI solo corre en push a `main` si la variable de repositorio `CLOUDFLARE_DEPLOY` vale `true` (y existen los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`); si no, queda omitido.
- `BOOTSTRAP_OWNER_EMAIL` es un secreto del Worker (`pnpm exec wrangler secret put BOOTSTRAP_OWNER_EMAIL`), no una variable de `wrangler.jsonc`. En local no hace falta: la API usa la identidad demo.
- `pnpm unity:build`: compila el ejecutable Windows (con el editor cerrado).
- `pnpm unity:webgl`: compila Unity para el navegador y lo deja en `web/public/simulador/` (salida versionada; ficheros ≥25 MiB a R2; `-SkipBuild` solo prepara los assets); después `pnpm deploy:cloud`. Enlace `/simulador/?sesion=<id>` (ruta en `worker/simulator.ts`). El participante necesita membresía y código personal.
- `pnpm build:standalone`: demo en navegador con la API emulada.
- Red UFV: `curl.exe --ssl-no-revoke`; para uv, `UV_SYSTEM_CERTS=1` y `truststore`.

## Reglas del proyecto
- Todo recurso pertenece a un tenant; toda consulta filtra por `tenant_id`. Un usuario pertenece a una sola organización.
- Eventos y cola solo con IDs seudónimos, nunca nombres ni correos. Un tipo de evento nuevo obliga a decidir sus campos en `QUEUE_DETAIL_FIELDS`; el texto libre no sale a la cola.
- El participante nunca recibe datos de compañeros ni `quality`/`rationale`/`effects`/`takeaway` antes de decidir: toda respuesta de sesión pasa por `roomPayload`.
- Las peticiones que cambian estado son `application/json` y del mismo origen (CSRF en `worker/app.ts`).
- No inferir emociones ni estados psicológicos (AI Act). Las valoraciones `quality` son de la decisión, no de la persona.
- El producto determinista (escenarios, sesiones, invitados, analítica) solo usa como IA a Clef (Workers AI, `worker/voice-intent.ts`): asigna la respuesta libre por voz a una opción existente, con confirmación si duda; nunca genera texto ni valora a la persona.
- El «Modo IA en vivo (demo)» es aparte (flag `ai_live_demo`, solo instructores, `worker/ai-routes.ts`, `ai-live.ts`, `ai-live-prompts.ts`, `knowledge.ts`): IA generativa (Workers AI `gpt-oss-120b`, embeddings `bge-m3`, `toMarkdown`) basada solo en los documentos que sube el instructor, con aviso de transparencia en la interfaz. No toca el motor ni las sesiones; los textos de documentos y las frases dichas no van a logs, eventos ni auditoría; las valoraciones son de la decisión. No subir datos personales a las colecciones.
- Unity nunca contiene claves de proveedores de IA; la voz se genera offline y se incluye como WAV.
- No clonar la voz de personas reales sin consentimiento expreso.
- Los escenarios publicados son inmutables; un cambio es una versión nueva.
- Texto de interfaz y documentación en español.

## Estado y siguientes pasos (2026-10-07)
Añadido el 7 de octubre (desplegado): tiempo real por WebSocket con `liveTally` para el docente; clase simulada; consola con rutas (Inicio, Sesiones, Nueva sesión, detalle con pestañas, Analítica, Escenarios, Participantes y accesos); nombres de sesión, renombrar y duplicar (migración 0006); finalizar en cualquier momento (`completed.early`); `GET /api/analytics`; unión de invitados por QR/PIN con alias limitada a una sesión (migración 0007, `worker/guests.ts`) y vista móvil sin Unity (`/unirse`, `/jugar/:id`, locuciones en `web/public/voz/`); respuesta libre por voz con Clef.

Hecho: escenarios de IA con VictorIA (por defecto `ia-buenas-practicas`), marca UFV en consola y Unity, tutor 3D con lip sync y 12 locuciones Soniox TTS RT v2 (voz española `Carmen`, guion público generado fuera de la aplicación); modo individual (indicadores e informe por participante, media de clase, unión en cualquier fase, vista filtrada); seguridad (membresías con una organización por usuario, códigos personales de seis cifras, sesiones propias, auditoría de usos, límite de intentos transaccional en D1, CSRF, CSP, `x-request-id`, observability); RGPD (Durable Objects en la UE, retención de sesiones no completadas y de `audit_log` a 730 días, cola con lista blanca; la cola sigue sin jurisdicción UE); simulador WebGL publicado en `/simulador/`; `BOOTSTRAP_OWNER_EMAIL` y `ACCESS_CODE_PEPPER` como secretos; CI con despliegue condicionado a `CLOUDFLARE_DEPLOY`. La aplicación Cloudflare Access «Simulador UFV» y sus dos políticas AXYRO están retiradas. La entrada pública y el acceso propio se han probado en producción con propietario, docente y dos participantes. Se verificaron permisos, aislamiento, revocación y bloqueo de intentos; las sesiones de prueba se borraron.

Pendiente:
1. Activar el despliegue automático (`CLOUDFLARE_DEPLOY=true` con sus secretos, o Workers Builds).
2. Probar una sesión completa de extremo a extremo con los equipos y la red de la UFV, incluida la voz con micrófono real en iPhone y Android y el escaneo del QR. El QR no muestra la dirección mientras el dominio no sea de la UFV.
3. Decisiones de la UFV de `docs/checklist-entrega-ufv.md` (dominio definitivo, DPA, base jurídica, plazos, ubicación de datos, etc.).
4. Personaje definitivo con Reallusion Character Creator 4.
5. Voz por micrófono en WebGL: implementada (`AxyroWebVoice.cs`, `Plugins/WebGL/AxyroVoice.jslib`, plantilla `voice.js`, `/api/voice/*` con claves temporales Soniox de un solo uso). Se activa con el secreto `SONIOX_API_KEY`; `SONIOX_REGION` (`wrangler.jsonc`) indica la región del proyecto: hoy `us`, con aviso de transferencia internacional antes de abrir el micrófono y pendiente del DPO; `eu` cuando haya proyecto UE.
