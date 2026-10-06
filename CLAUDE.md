# AXYRO SIM LAB (repo qrive)

Plataforma de simulación para formación y toma de decisiones. Primer despliegue: UFV. La referencia de alcance es `AXYRO_MVP_ARCHITECTURE_FINAL_v1.1.md`; no construir funciones de fases posteriores (VR, IA avanzada) antes de validar la anterior.

## Arquitectura
- `shared/`: motor puro en TypeScript (`engine.ts`, `simulation.ts`, `scenario.ts`, `events.ts`, `contracts/`). Sin dependencias de Cloudflare; lo usan el Worker, los tests y la demo en navegador.
- `worker/`: API Hono en Cloudflare Workers. Estado vivo de cada sesión en el Durable Object `SessionRoom`, datos en D1, eventos por Queue, retención por cron.
- `web/`: consola de instructor y participante (React + Vite). No muestra el personaje; eso es de Unity. Marca en `web/brand.ts` y `web/public/brand/` (UFV).
- `unity/AXYRO.Simulation`: cliente de simulación (Unity 6000.3.25f1, Rive 0.5.1). `AxyroSessionClient.cs` habla con la API; la escena se genera con `AXYRO > Crear escena de avatar` o `AxyroSceneBuilder.BuildWindows` en batch.

## Comandos
- `pnpm dev:api` + `pnpm dev:web`: desarrollo local (identidad demo, datos en `.local-state/`). `pnpm db:local` aplica migraciones locales.
- `pnpm check`: tests + typecheck + build + dry-run del Worker. Debe pasar antes de cualquier commit.
- `pnpm smoke` (API local en marcha; `SMOKE_RUNS=50` es la puerta de calidad de Simulation Core).
- `pnpm demo` / `pnpm demo:stop`: todo en segundo plano, incluido Unity.
- `pnpm deploy:cloud`: tests, migraciones D1 remotas y despliegue en `axyro.qhel.dev` (Cloudflare Access).
- `pnpm unity:build`: compila el ejecutable Windows (con el editor cerrado).
- `pnpm build:standalone`: demo en navegador con la API emulada.

## Reglas del proyecto
- Todo recurso pertenece a un tenant; toda consulta filtra por `tenant_id`.
- Eventos y cola solo con IDs seudónimos, nunca nombres ni correos.
- No inferir emociones ni estados psicológicos (AI Act). Las valoraciones `quality` son de la decisión, no de la persona.
- Unity nunca contiene claves de proveedores de IA.
- Los escenarios publicados son inmutables; un cambio es una versión nueva.
- Texto de interfaz y documentación en español.

## Estado y siguientes pasos
Hecho (2026-10-06): MVP en `main` y desplegado en `axyro.qhel.dev` (migración `0002` aplicada en remoto); Unity compilado y probado contra la API local (unirse y decidir llegan a la sesión).

1. Despliegue continuo: el job `deploy` de `.github/workflows/ci.yml` necesita el secreto `CLOUDFLARE_API_TOKEN` en GitHub (y `CLOUDFLARE_ACCOUNT_ID` si el token ve varias cuentas). Mientras falte, desplegar a mano con `pnpm deploy:cloud`.
2. En esta red Windows no puede comprobar la revocación de certificados: usar `curl.exe --ssl-no-revoke`.
3. Pendiente de decisión: acceso de cuentas UFV en la política de Access (hoy solo `ezequiel@identy.cloud`); producción del personaje final; cliente del participante (Windows o WebGL servido desde Cloudflare, que resolvería la autenticación con Access); Queue con jurisdicción UE; borrado de miembros; DPA con UFV.
