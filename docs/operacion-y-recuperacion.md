# Operación y recuperación

Procedimientos para desplegar, volver atrás, hacer copias de seguridad, restaurar datos y atender incidentes del Simulador de decisiones en Cloudflare. Está pensado para la persona que opera el servicio, con acceso a la cuenta de Cloudflare y al repositorio.

Los puntos marcados con **[Validar UFV]** necesitan una decisión o una comprobación de la UFV antes del piloto.

## 0. Datos de partida

| Elemento | Dónde se configura | Qué guarda |
|---|---|---|
| Worker (API, consola y simulador web) | `wrangler.jsonc` → `name` | Código; sin estado propio |
| Base de datos D1 | `wrangler.jsonc` → `d1_databases[0].database_name` (en este documento, `<D1>`) | Organizaciones, usuarios, membresías, códigos (HMAC), sesiones, eventos con IDs seudónimos, auditoría, invitados, PIN, escenarios publicados, partidas del Modo IA |
| Bucket R2 (jurisdicción UE) | `wrangler.jsonc` → `r2_buckets[0].bucket_name` (`<R2>`) | Documentos del Modo IA y sus vectores; ficheros grandes del simulador WebGL |
| Durable Objects `SessionRoom` (UE) | `SESSIONS_JURISDICTION = "eu"` | Estado vivo de cada sesión (participantes, decisiones, indicadores, notas de incidentes) |
| Cola de eventos | `queues` | Eventos en tránsito hacia D1 (solo IDs seudónimos) |
| Secretos | `wrangler secret` | `ACCESS_CODE_PEPPER`, `BOOTSTRAP_OWNER_EMAIL`, `SONIOX_API_KEY` |

Todos los comandos se lanzan desde la raíz del repositorio con `pnpm exec wrangler …` y una sesión de Wrangler (`pnpm exec wrangler login`) o `CLOUDFLARE_API_TOKEN`. En la red de la UFV, `curl.exe --ssl-no-revoke`.

## 1. Despliegue

1. Rama `main` limpia y `pnpm check` en verde (tests, tipos, build y prueba en seco del Worker).
2. `pnpm deploy:cloud`: repite la verificación, aplica las migraciones D1 remotas pendientes y despliega el Worker. Al final comprueba `GET /api/health`.
3. Anota el ID de la versión desplegada: `pnpm exec wrangler deployments list`.
4. Prueba rápida en producción: iniciar sesión, crear una sesión, «Simular clase», avanzar, finalizar y ver el informe. Borra la sesión de prueba.

Con la variable de repositorio `CLOUDFLARE_DEPLOY=true` (y los secretos `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`), el CI despliega solo cada push a `main` que pase la verificación y la puerta de calidad.

**Reglas**

- Una migración D1 se aplica **antes** que el código que la usa y debe ser compatible con la versión anterior del código (solo añadir tablas, columnas o índices). Así un rollback del Worker no rompe la base de datos.
- No desplegar durante una sesión en curso salvo incidente: el Durable Object se reinicia con el código nuevo y las conexiones en directo se reabren solas (la consola vuelve a consultar), pero se nota un corte breve.
- Antes de una demostración o una sesión importante: sin despliegues en las 24 horas previas.

## 2. Volver a una versión anterior (rollback)

1. Lista de versiones y despliegues:
   ```
   pnpm exec wrangler deployments list
   pnpm exec wrangler versions list
   ```
2. Volver a la anterior (o a una concreta):
   ```
   pnpm exec wrangler rollback --message "Motivo del rollback"
   pnpm exec wrangler rollback <version-id> --message "Motivo del rollback"
   ```
3. Comprobar `GET /api/health` y repetir la prueba rápida del apartado 1.

El rollback solo cambia el código. **No deshace migraciones D1 ni datos.** Si la versión nueva escribió datos con un formato que la anterior no entiende, restaura D1 (apartado 3) o corrige hacia delante con una versión nueva.

## 3. Base de datos D1

### 3.1 Recuperación a un momento anterior (Time Travel)

D1 guarda automáticamente el historial para poder restaurar la base de datos a cualquier minuto de los **últimos 30 días** (plan Workers Paid; 7 días en el plan gratuito). No hay que activarlo. **[Validar UFV]** Confirmar el plan contratado y, con él, el plazo.

1. Obtener el marcador del momento al que se quiere volver (RFC 3339 o segundos Unix):
   ```
   pnpm exec wrangler d1 time-travel info <D1> --timestamp 2026-10-07T08:00:00Z
   ```
2. Restaurar (pide confirmación):
   ```
   pnpm exec wrangler d1 time-travel restore <D1> --timestamp 2026-10-07T08:00:00Z
   ```
   o con el marcador del paso 1: `--bookmark <marcador>`.
3. **Guardar el marcador anterior que devuelve el comando**: permite deshacer la restauración volviendo a él.

Efectos que hay que conocer:

- Las consultas en curso se cancelan y devuelven error durante la restauración: hacerlo sin sesiones abiertas.
- Todo lo escrito después del momento elegido se pierde (altas, códigos, sesiones, eventos, auditoría).
- Los Durable Objects **no** se restauran: una sesión creada después del momento elegido conserva su estado vivo, pero su fila en D1 desaparece y deja de aparecer en el listado. Se puede borrar desde la consola si se ve, o esperar a la retención.
- Un dato borrado por RGPD (sesión o participante) vuelve a aparecer si se restaura a un momento anterior al borrado. Tras una restauración, repetir los borrados RGPD registrados en la auditoría (`session_deleted`, `participant_removed`, `member_deleted`) con fecha posterior al momento restaurado.

### 3.2 Copias fuera de línea (export)

Time Travel no cubre más de 30 días ni la pérdida de la cuenta. Copia semanal a un almacenamiento de la UFV:

```
pnpm exec wrangler d1 export <D1> --remote --output copia-AAAA-MM-DD.sql
```

- El fichero contiene datos personales (correos, nombres, alias): cifrarlo y guardarlo solo en la ubicación aprobada. **[Validar UFV]** Ubicación, cifrado, responsable y plazo de conservación de las copias (coherente con el plazo de 365 días de las sesiones).
- La exportación bloquea la base de datos mientras dura: hacerla fuera del horario de clase.
- Restaurar una copia en una base de datos **nueva** (nunca encima de la de producción sin plan):
  ```
  pnpm exec wrangler d1 create <D1>-restauracion
  pnpm exec wrangler d1 execute <D1>-restauracion --remote --file copia-AAAA-MM-DD.sql
  ```
  y después apuntar `wrangler.jsonc` a la nueva base de datos y desplegar, o copiar solo las tablas necesarias.

## 4. R2 (documentos del Modo IA y simulador)

- R2 **no guarda versiones** de los objetos: un objeto borrado o sobrescrito no se puede recuperar desde Cloudflare.
- Los ficheros del simulador WebGL se pueden volver a subir desde el repositorio (`pnpm unity:webgl`), así que no necesitan copia.
- Los documentos del Modo IA y sus vectores solo existen en R2 (las citas y los fragmentos están en D1). Si se pierden, el docente vuelve a subir los documentos. Para tener copia, usar la API compatible con S3 de R2 con un token de solo lectura del bucket (endpoint de la jurisdicción UE) y una herramienta de sincronización (por ejemplo `rclone sync`) hacia un almacenamiento de la UFV. Un objeto concreto se descarga con:
  ```
  pnpm exec wrangler r2 object get <R2>/<clave> --remote --jurisdiction eu --file <fichero>
  ```
  **[Validar UFV]** Decidir si los documentos del Modo IA necesitan copia o basta con que el docente conserve los originales.

## 5. Durable Objects (estado vivo de las sesiones)

- El estado completo de cada sesión (participantes con su nombre o alias, decisiones, indicadores, notas de incidentes) vive en su Durable Object, con almacenamiento persistente y replicado por Cloudflare. D1 solo recibe los eventos con IDs seudónimos, la fila de la sesión y la auditoría.
- **Si se pierde un Durable Object, el estado de esa sesión se pierde**: los eventos de D1 no bastan para reconstruir nombres, notas ni el informe tal como se vio. La analítica agregada (que se calcula con D1) sí se conserva.
- Mitigaciones:
  - Al finalizar cada sesión, el docente descarga la exportación JSON o el informe si los necesita conservar fuera del sistema (con las mismas reglas de custodia que cualquier exportación).
  - No cambiar `SESSIONS_JURISDICTION` ni el nombre de la clase `SessionRoom`: deja inaccesibles las sesiones existentes.
  - Cloudflare permite recuperar un Durable Object con almacenamiento SQLite a un momento de los últimos 30 días, pero exige código específico que hoy no existe. **[Validar UFV]** Decidir si hace falta antes del piloto.
- Una sesión cuyo Durable Object no responde aparece en el listado pero no abre: el docente puede borrarla desde la consola; la retención la elimina igualmente.

## 6. Secretos

| Secreto | Efecto al cambiarlo | Procedimiento |
|---|---|---|
| `ACCESS_CODE_PEPPER` | **Invalida todos los códigos personales** de seis cifras (se guardan como HMAC con este secreto). Las sesiones ya iniciadas en los navegadores siguen hasta que caducan. Los invitados no se ven afectados. | Solo si se sospecha que se ha filtrado. Avisar antes a los docentes; `pnpm exec wrangler secret put ACCESS_CODE_PEPPER` (valor aleatorio de 32 caracteres o más); después, generar y entregar códigos nuevos desde «Participantes y accesos», empezando por el propietario. |
| `SONIOX_API_KEY` | La voz en tiempo real deja de funcionar hasta que el valor nuevo está activo; las claves temporales ya entregadas caducan solas (60 s o 15 min). | Crear la clave nueva en Soniox (mismo proyecto y región que `SONIOX_REGION`), `pnpm exec wrangler secret put SONIOX_API_KEY`, probar la voz y revocar la antigua en Soniox. Rotación recomendada: cada 6 meses o ante cualquier sospecha. |
| `BOOTSTRAP_OWNER_EMAIL` | Cambia quién es el propietario (asigna docentes y ve el registro de auditoría). | Solo por decisión de la UFV; el nuevo correo debe ser ya instructor de la organización. |

`pnpm exec wrangler secret list` muestra los nombres configurados (nunca los valores). Los secretos no se guardan en el repositorio ni en `wrangler.jsonc`.

## 7. Incidentes

1. **Detectar y acotar.** ¿Falla para todos o para una persona? ¿Consola, vista móvil o simulador 3D? ¿Desde cuándo? ¿Coincide con un despliegue (`wrangler deployments list`)?
2. **Registros en vivo:**
   ```
   pnpm exec wrangler tail --format pretty
   pnpm exec wrangler tail --status error
   pnpm exec wrangler tail --search API_ERROR
   ```
   Cada respuesta lleva la cabecera `x-request-id`, y los errores 500 la devuelven también en el cuerpo (`requestId`): pedirla a quien ve el error y buscarla en los registros. Códigos útiles: `API_ERROR`, `ROOM_ERROR`, `QUEUE_FLUSH_FAILED`, `EVENT_PERSIST_FAILED`, `CSRF_REJECTED`, `RATE_LIMITED`, `AI_CALL_FAILED`, `AI_QUOTA`, `SONIOX_TEMP_KEY_FAILED`.
3. **Histórico:** panel de Cloudflare → Workers → el Worker → Observability (registros con búsqueda y métricas; `observability.enabled` en `wrangler.jsonc`).
4. **Mitigar:** rollback (apartado 2) si empezó con un despliegue; desactivar una función con `FEATURE_FLAGS` (por ejemplo `ai_live_demo`) y desplegar; en una clase en curso, seguir con la vista móvil o la consola si falla el 3D.
5. **Datos personales:** si el incidente puede afectar a datos personales (acceso indebido, filtración, borrado), avisar en el momento al responsable de la UFV. **[Validar UFV]** Canal, responsable y plazo (el RGPD fija 72 horas para notificar a la autoridad cuando procede).
6. **Cerrar:** anotar causa, impacto, acciones y prevención; revisar el registro de auditoría (consola → «Participantes y accesos» → «Auditoría», solo el propietario).

## 8. Simulacro mensual de restauración

Una vez al mes, fuera del horario de clase, y anotado con fecha y resultado:

1. `pnpm exec wrangler d1 export <D1> --remote --output simulacro.sql`.
2. Crear una base de datos temporal, cargar la copia (apartado 3.2) y comprobar con `pnpm exec wrangler d1 execute <temporal> --remote --command "SELECT COUNT(*) FROM sessions"` que las tablas principales tienen datos.
3. `pnpm exec wrangler d1 time-travel info <D1> --timestamp <hace 24 h>`: comprobar que devuelve un marcador.
4. Comprobar que la copia semanal del apartado 3.2 existe, se puede descifrar y no supera el plazo de conservación.
5. Borrar la base de datos temporal (`pnpm exec wrangler d1 delete <temporal>`) y el fichero `simulacro.sql`.
6. Anotar la duración y cualquier problema. **[Validar UFV]** Dónde se registra el simulacro y quién lo revisa.
