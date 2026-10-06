# Simulador de decisiones UFV · Lista de verificación de la entrega del MVP

Lista para cerrar la entrega del MVP a la Universidad Francisco de Vitoria y preparar el piloto. Marca cada casilla cuando el punto esté verificado en el entorno que usará la UFV.

Responsables: **Dev** (equipo de desarrollo), **UFV-SI** (Servicios Informáticos), **UFV-DPO** (Delegado de Protección de Datos / Secretaría General), **UFV-Doc** (profesorado responsable del piloto).

---

## 1. Técnica

### Código y calidad

- [x] Cambios locales confirmados y subidos al repositorio; la rama principal compila y CI pasa. (Dev)
- [x] La verificación completa del proyecto (tests, comprobación de tipos y compilación) pasa sin errores. (Dev)
- [x] Puerta de calidad de 50 simulaciones consecutivas superada con la API local (6 oct 2026); el script usa la identidad de demostración. (Dev)
- [ ] Prueba de humo contra la API desplegada con cuentas de prueba y código de acceso. (Dev)
- [ ] Despliegue automático activado en la integración continua (variable de repositorio `CLOUDFLARE_DEPLOY` y credenciales de despliegue) o despliegue manual documentado. Hoy se despliega a mano. (Dev)
- [x] Comprobación de salud de la API (`/api/health`) correcta tras el despliegue. (Dev)

### Despliegue y dominio

- [x] Migraciones de base de datos aplicadas en el entorno remoto. (Dev)
- [ ] Dominio definitivo decidido (por ejemplo, bajo `ufv.es`) y servicio trasladado; la dirección provisional queda retirada o redirigida. (UFV-SI, Dev)
- [ ] La dirección pública alternativa del servicio y las URL de vista previa siguen desactivadas. (Dev)
- [x] Simulador WebGL compilado, publicado en `/simulador/` y probado con una sesión autenticada. (Dev)
- [ ] Probado en los navegadores y equipos de aula de la UFV (Chrome y Edge, red de la UFV con inspección TLS). (UFV-SI, Dev)
- [ ] Audio de VictorIA y sincronización labial correctos en los equipos de aula. (UFV-Doc)
- [ ] Respuesta por voz en el navegador (secreto `SONIOX_API_KEY`, región en `SONIOX_REGION`; hoy proyecto Soniox de EE. UU. con aviso previo al participante): transferencia internacional aceptada por el DPO o proyecto en la UE; permiso de micrófono, interrupción de VictorIA y decisión por voz probados en los equipos de aula. (Dev, UFV-SI, UFV-DPO)
- [ ] Solo si se usa la versión de escritorio para Windows: respuesta por voz local (Vosk) probada en esos equipos; donde Windows no deja abrir el micrófono aparece «Voz no disponible · elige con el ratón». (UFV-SI)
- [ ] Prueba de carga con el tamaño de grupo previsto para el piloto (participantes simultáneos y límite de 300 peticiones por minuto y usuario). (Dev)

### Acceso e identidad

- [x] Pantalla propia de acceso con correo y código personal de seis cifras comprobada en producción. (Dev)
- [x] Códigos únicos por usuario, revocación inmediata de la sesión, límite de cinco intentos por correo y minuto y auditoría de accesos comprobados en producción con cuentas de prueba. (Dev)
- [x] Cloudflare Access retirado del dominio para que la infraestructura sea transparente al usuario. (Dev)
- [ ] Propietario inicial de la organización con una cuenta de la UFV (hoy es una cuenta externa de desarrollo, guardada como secreto del despliegue). (Dev, UFV-SI)
- [ ] Docentes del piloto dados de alta por el propietario y con código personal. (Dev)
- [x] Prueba de aislamiento: un usuario sin código recibe «Acceso no autorizado»; un participante no puede crear, exportar ni borrar sesiones y no ve decisiones ni resultados de sus compañeros. (Dev)

### Datos y privacidad (implementación)

- [ ] Estado de las sesiones (Durable Objects) en la jurisdicción UE comprobado en el entorno desplegado (configurado en el código). (Dev)
- [ ] Cola de eventos: aceptada por el DPO sin jurisdicción UE (solo IDs seudónimos y campos de una lista blanca, sin texto de incidentes) o recreada en la UE. (Dev, UFV-DPO)
- [ ] Ubicación UE de la base de datos D1 comprobada en el panel de Cloudflare. (Dev)
- [ ] Tarea diaria de conservación activa (03:17 UTC: sesiones a los 365 días, también las no finalizadas desde su creación; auditoría a los 730 días) y comprobada con datos de prueba. (Dev)
- [ ] Baja de miembros (hoy por API) y rectificación del nombre (volviendo a dar de alta) probadas; pendiente el botón de baja en la consola y el borrado de un participante concreto dentro de una sesión. (Dev)
- [ ] Vista del participante comprobada: solo sus sesiones, sus decisiones y sus resultados, sin valoraciones antes de decidir. (Dev)
- [ ] Exportar JSON y Eliminar sesión probados desde la consola; la auditoría registra ambos. (Dev)
- [ ] Copias de seguridad y recuperación de la base de datos documentadas y probadas. (Dev)

---

## 2. Legal y cumplimiento

- [ ] Base jurídica decidida para cada tipo de actividad (ver *Privacidad y transparencia*, Parte B, apartado 3). (UFV-DPO)
- [ ] Decisión sobre la evaluación de impacto (EIPD) documentada. (UFV-DPO)
- [ ] Registro de actividades de tratamiento actualizado. (UFV-DPO)
- [ ] Aviso de privacidad para participantes aprobado (primera y segunda capa) y publicado donde se vaya a mostrar. (UFV-DPO)
- [ ] Canal y plazo de ejercicio de derechos definidos. (UFV-DPO)
- [ ] Titularidad de la cuenta de Cloudflare decidida y acuerdo de tratamiento de Cloudflare a nombre del responsable o encargado que corresponda. (UFV-DPO, Dev)
- [ ] Contrato de encargo de tratamiento (DPA) firmado con el desarrollador o proveedor del servicio. (UFV-DPO)
- [ ] Ubicación de los datos y transferencias internacionales aceptadas por el DPO. (UFV-DPO)
- [ ] Plazos de conservación aprobados: sesiones, sesiones no finalizadas, miembros, auditoría de accesos, registros técnicos y ficheros exportados. (UFV-DPO)
- [ ] Decisión sobre la entrega privada y reposición de códigos personales del piloto. (UFV-DPO, UFV-SI)
- [ ] Criterio sobre el uso del informe en actividades evaluables (nunca como única base de calificación). (UFV-Doc, UFV-DPO)

### Reglamento Europeo de IA

- [ ] Texto de los avisos de transparencia sobre VictorIA (ya visibles en el simulador y en la consola) aprobado. (UFV-DPO)
- [ ] Confirmado que no se infieren emociones ni estados psicológicos y que no se usa la cámara. (Dev)
- [ ] Confirmado que las valoraciones son de la decisión y no de la persona, y que el informe usa reglas fijas. (Dev)
- [ ] Confirmado que no hay llamadas a proveedores de IA en ejecución ni claves de IA en el simulador; personajes con IA desactivados. (Dev)
- [ ] Documentada la procedencia de la voz: locuciones del guion generadas con Soniox TTS, voz «Carmen», desde el proyecto actual en región Estados Unidos; el navegador reproduce los WAV ya compilados y no envía audio ni texto a Soniox. Revisar las condiciones de uso antes del piloto. (Dev, UFV-DPO)
- [ ] Si se sustituye por una locutora real o se clona una voz: contrato y consentimiento expreso firmados antes de usarla. (UFV, Dev)

### Licencias y propiedad intelectual

- [ ] Inventario de licencias y condiciones de terceros revisado: modelo 3D provisional (Microsoft Rocketbox, MIT), sincronización labial (uLipSync, MIT), locuciones Soniox TTS, reconocimiento de voz local en Windows y su modelo de idioma, Rive, Unity y dependencias web. (Dev)
- [ ] Uso de logos y plantilla de marca UFV autorizado por Comunicación. (UFV)
- [ ] Propiedad de los escenarios y contenidos creados para la UFV acordada. (UFV, Dev)

---

## 3. Contenidos

- [ ] Escenarios «Uso responsable de la IA en la universidad», «IA generativa en la docencia» e «IA en la atención al estudiante» revisados por un experto de la UFV: situaciones, opciones, consecuencias y valoraciones. (UFV-Doc)
- [ ] La opción «Anonimizar… y usar solo la herramienta de IA autorizada por la universidad» se corresponde con la herramienta y la política reales de la UFV; se sabe cuál es esa herramienta para citarla en el debriefing. (UFV-Doc, UFV-SI)
- [ ] Coherencia con la normativa interna de la UFV sobre uso de IA y con las guías docentes. (UFV-Doc)
- [ ] Explicación de cada opción («por qué») e idea clave de cada fase revisadas; el simulador y el debriefing de la consola ya las muestran. Los escenarios publicados no se modifican: un cambio es una versión nueva. (UFV-Doc)
- [ ] Locuciones de VictorIA revisadas de oído (pronunciación, ritmo, naturalidad) para todas las fases. (UFV-Doc)
- [ ] Personaje definitivo decidido (el actual es provisional). (UFV)
- [ ] Textos de interfaz revisados en español y sin el nombre interno del producto, incluida la pantalla propia de código de acceso. (Dev, UFV-Doc)
- [ ] Escenario de negociación: decidir si se ofrece en el piloto o se oculta. (UFV-Doc)

---

## 4. Formación y piloto

- [ ] *Guía docente* revisada y entregada a los docentes del piloto. (UFV-Doc)
- [ ] *Guía del participante* publicada en el aula virtual o entregada antes de la sesión. (UFV-Doc)
- [ ] Sesión de formación para docentes (30–45 minutos): crear sesión, alta de participantes, controles, debriefing, exportar y eliminar. (Dev, UFV-Doc)
- [ ] Sesión de ensayo completa con un grupo reducido en un aula real. (UFV-Doc)
- [ ] Contacto de soporte durante el piloto y procedimiento de incidencias definidos. (UFV-SI, Dev)
- [ ] Indicadores del piloto acordados: utilidad, facilidad de uso, fiabilidad, participación, valor percibido, problemas operativos y calidad del informe. (UFV-Doc, Dev)
- [ ] Encuesta breve para docentes y participantes al terminar el piloto (sin datos de salud ni psicológicos). (UFV-Doc)
- [ ] Sesiones de prueba eliminadas antes de empezar el piloto. (Dev, UFV-Doc)

---

## 5. Documentación entregada

- [ ] Guía docente (`docs/guia-docente.md`).
- [ ] Guía del participante (`docs/guia-participante.md`).
- [ ] Privacidad y transparencia (`docs/privacidad-y-transparencia.md`), validada por el DPO.
- [ ] Esta lista de verificación (`docs/checklist-entrega-ufv.md`), completada y firmada.
- [ ] Documentación técnica de despliegue, operación y recuperación para Servicios Informáticos.

**Aceptación de la entrega**

| Rol | Nombre | Fecha | Firma |
|---|---|---|---|
| Responsable académico UFV | | | |
| Servicios Informáticos UFV | | | |
| Delegado de Protección de Datos UFV | | | |
| Equipo de desarrollo | | | |
