# AXYRO SIM LAB (repo qrive)

Plataforma de simulación para formación y toma de decisiones. Primer despliegue: UFV. La referencia de alcance es `AXYRO_MVP_ARCHITECTURE_FINAL_v1.1.md`; no construir funciones de fases posteriores (VR, IA avanzada) antes de validar la anterior.

**Marca:** todo lo visible es 100 % UFV. «AXYRO» es solo el nombre interno de código, repositorio y recursos; no debe aparecer en interfaz, títulos ni ejecutables. Consola web: «Simulador de decisiones» (`web/brand.ts`). Unity: producto «Simulador UFV», ejecutable `Build/Simulador-UFV.exe`.

## Arquitectura
- `shared/`: motor puro en TypeScript (`engine.ts`, `simulation.ts`, `scenario.ts`, `events.ts`, `contracts/`). Sin dependencias de Cloudflare; lo usan el Worker, los tests y la demo en navegador. `catalogScenarios` (se publican en D1 al consultarse) y `defaultScenario` = `ia-buenas-practicas`; `supplier-negotiation` sigue en catálogo. `meterLabels` es opcional y se valida en `scenario.ts`.
- `worker/`: API Hono en Cloudflare Workers. Estado vivo de cada sesión en el Durable Object `SessionRoom`, datos en D1, eventos por Queue, retención por cron.
- `web/`: consola de instructor y participante (React + Vite). No muestra el personaje; eso es de Unity. Marca en `web/brand.ts` y `web/public/brand/` (UFV).
- `unity/AXYRO.Simulation`: cliente de simulación (Unity 6000.3.25f1, URP, Rive 0.5.1 solo para el HUD, uLipSync). Tutor 3D en `Assets/AXYRO/AxyroTutor3D.cs` y `Characters/Tutor/` (provisional Rocketbox, MIT). `AxyroSessionClient.cs` habla con la API y se une solo a la sesión; decisión por ratón, voz (Vosk local, sin grabar audio) o teclas 1-4. La escena se genera con `AXYRO > Crear escena de avatar` o `AxyroSceneBuilder.BuildWindows` en batch.
- `scripts/tts/`: locuciones WAV offline con Chatterbox Multilingual sobre una referencia sintética Kokoro (`ef_dora`); se nombran por id de fase. Entorno en `.local-state/tts/.venv` (ver README).

## Comandos
- `pnpm dev:api` + `pnpm dev:web`: desarrollo local (identidad demo, datos en `.local-state/`). `pnpm db:local` aplica migraciones locales.
- `pnpm check`: tests + typecheck + build + dry-run del Worker. Debe pasar antes de cualquier commit.
- `pnpm smoke` (API local en marcha; `SMOKE_RUNS=50` es la puerta de calidad de Simulation Core).
- `pnpm demo` / `pnpm demo:stop`: todo en segundo plano, incluido Unity.
- `pnpm deploy:cloud`: tests, migraciones D1 remotas y despliegue en `axyro.qhel.dev` (Cloudflare Access; requiere `wrangler login`). CI despliega en push a `main` cuando exista el secreto `CLOUDFLARE_API_TOKEN`.
- `pnpm unity:build`: compila el ejecutable Windows (con el editor cerrado).
- `pnpm unity:webgl`: compila Unity para el navegador y lo publica en `/simulador/?sesion=<id>` (assets ≤25 MiB en `web/public/simulador/`, el resto en R2; ruta en `worker/simulator.ts`). El participante debe estar dado de alta como miembro y admitido en Access.
- `pnpm build:standalone`: demo en navegador con la API emulada.
- Red UFV: `curl.exe --ssl-no-revoke`; para uv, `UV_SYSTEM_CERTS=1` y `truststore`.

## Reglas del proyecto
- Todo recurso pertenece a un tenant; toda consulta filtra por `tenant_id`.
- Eventos y cola solo con IDs seudónimos, nunca nombres ni correos.
- No inferir emociones ni estados psicológicos (AI Act). Las valoraciones `quality` son de la decisión, no de la persona.
- Unity nunca contiene claves de proveedores de IA; la voz se genera offline y se incluye como WAV.
- No clonar la voz de personas reales sin consentimiento expreso.
- Los escenarios publicados son inmutables; un cambio es una versión nueva.
- Texto de interfaz y documentación en español.

## Estado y siguientes pasos (2026-10-06)
Hecho: escenario de IA responsable por defecto, marca UFV en consola y Unity, tutor 3D con lip sync y voz Chatterbox, CI con job de despliegue.

Pendiente:
1. Crear el secreto `CLOUDFLARE_API_TOKEN` en GitHub para que despliegue el CI.
2. Dominio definitivo (p. ej. de `ufv.es`) y renombrar la aplicación Access «AXYRO SIM / DECISION»; ambos se ven en el login.
3. Personaje definitivo con Reallusion Character Creator 4.
4. Locutora real con consentimiento para la voz final.
5. Cliente remoto del participante (WebGL servido desde Cloudflare, autenticación con Access).
6. Queue con jurisdicción UE; borrado de miembros; DPA con UFV.
