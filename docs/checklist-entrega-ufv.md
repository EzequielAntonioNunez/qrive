# Simulador de decisiones UFV · Lista de verificación de la entrega del MVP

Lista para cerrar la entrega del MVP a la Universidad Francisco de Vitoria y preparar el piloto. Marca cada casilla cuando el punto esté verificado en el entorno que usará la UFV.

Responsables: **Dev** (equipo de desarrollo), **UFV-SI** (Servicios Informáticos), **UFV-DPO** (Delegado de Protección de Datos / Secretaría General), **UFV-Doc** (profesorado responsable del piloto).

---

## 1. Técnica

### Código y calidad

- [ ] Cambios locales confirmados y subidos al repositorio; la rama principal compila. (Dev)
- [ ] La verificación completa del proyecto (tests, comprobación de tipos, compilación y simulación del despliegue) pasa sin errores. (Dev)
- [ ] Prueba de humo contra la API desplegada superada, incluida la puerta de calidad de 50 simulaciones. (Dev)
- [ ] Integración continua configurada con sus credenciales de despliegue, o procedimiento manual de despliegue documentado. (Dev)
- [ ] Comprobación de salud de la API (`/api/health`) correcta tras el despliegue. (Dev)

### Despliegue y dominio

- [ ] Migraciones de base de datos aplicadas en el entorno remoto. (Dev)
- [ ] Dominio definitivo decidido (por ejemplo, bajo `ufv.es`) y servicio trasladado; la dirección provisional queda retirada o redirigida. (UFV-SI, Dev)
- [ ] La dirección pública alternativa del servicio y las URL de vista previa siguen desactivadas. (Dev)
- [ ] Simulador WebGL compilado, publicado en `/simulador/` y probado desde el enlace de una sesión real. (Dev)
- [ ] Probado en los navegadores y equipos de aula de la UFV (Chrome y Edge, red de la UFV con inspección TLS). (UFV-SI, Dev)
- [ ] Audio de VictorIA y sincronización labial correctos en los equipos de aula. (UFV-Doc)
- [ ] Respuesta por voz probada en los equipos donde se vaya a usar; el mensaje «Voz no disponible · elige con el ratón» aparece donde no esté disponible. (UFV-SI)
- [ ] Prueba de carga con el tamaño de grupo previsto para el piloto (participantes simultáneos y límite de 300 peticiones por minuto y usuario). (Dev)

### Acceso e identidad

- [ ] Cloudflare Access conectado al proveedor de identidad de la UFV (cuentas institucionales). (UFV-SI, Dev)
- [ ] Política de acceso ampliada a docentes y participantes del piloto (por dominio o por grupo), no a correos individuales. (UFV-SI)
- [ ] Aplicación de Access renombrada para que la pantalla de inicio de sesión muestre solo la marca UFV. (Dev)
- [ ] Propietario inicial de la organización con una cuenta de la UFV (hoy es una cuenta externa de desarrollo). (Dev, UFV-SI)
- [ ] Docentes del piloto dados de alta como instructores (hoy solo por API; la consola solo da de alta participantes). (Dev)
- [ ] Prueba de aislamiento: un usuario sin alta recibe «Acceso no autorizado»; un participante no puede controlar ni exportar sesiones. (Dev)

### Datos y privacidad (implementación)

- [ ] Estado de las sesiones (Durable Objects) creado con jurisdicción UE. (Dev)
- [ ] Cola de eventos con jurisdicción UE, o alternativa sin cola fuera de la UE. (Dev)
- [ ] Ubicación UE de la base de datos D1 comprobada en el panel de Cloudflare. (Dev)
- [ ] Tarea diaria de conservación activa (03:17 UTC, 365 días) y comprobada con una sesión de prueba. (Dev)
- [ ] Plazo de borrado para sesiones no finalizadas. (Dev)
- [ ] Baja de miembros, rectificación del nombre y borrado de un participante concreto. (Dev)
- [ ] Cada participante solo puede consultar las sesiones en las que participa. (Dev)
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
- [ ] Plazos de conservación aprobados: sesiones, sesiones no finalizadas, miembros, auditoría, registros de Access y ficheros exportados. (UFV-DPO)
- [ ] Decisión sobre la visibilidad del debriefing nominal entre participantes. (UFV-DPO, UFV-Doc)
- [ ] Criterio sobre el uso del informe en actividades evaluables (nunca como única base de calificación). (UFV-Doc, UFV-DPO)

### Reglamento Europeo de IA

- [ ] Aviso de transparencia sobre VictorIA (personaje virtual, imagen y voz sintéticas, intervenciones guionizadas) visible en el simulador antes de la primera interacción. (Dev, UFV-DPO)
- [ ] Confirmado que no se infieren emociones ni estados psicológicos y que no se usa la cámara. (Dev)
- [ ] Confirmado que las valoraciones son de la decisión y no de la persona, y que el informe usa reglas fijas. (Dev)
- [ ] Confirmado que no hay llamadas a proveedores de IA en ejecución ni claves de IA en el simulador; personajes con IA desactivados. (Dev)
- [ ] Documentada la procedencia de la voz: generada sin conexión con modelos de código abierto, con referencia sintética, sin clonar a personas reales y con marca de agua inaudible. (Dev)
- [ ] Si la voz definitiva es de una locutora: contrato y consentimiento expreso firmados antes de usarla. (UFV, Dev)

### Licencias y propiedad intelectual

- [ ] Inventario de licencias de terceros revisado: modelo 3D provisional (Microsoft Rocketbox, MIT), sincronización labial (uLipSync, MIT), síntesis de voz (Chatterbox, MIT; Kokoro-82M, Apache 2.0), reconocimiento de voz local y su modelo de idioma, Rive, Unity y dependencias web. (Dev)
- [ ] Uso de logos y plantilla de marca UFV autorizado por Comunicación. (UFV)
- [ ] Propiedad de los escenarios y contenidos creados para la UFV acordada. (UFV, Dev)

---

## 3. Contenidos

- [ ] Escenario «Uso responsable de la IA en la universidad» revisado por un experto de la UFV: situaciones, opciones, consecuencias y valoraciones. (UFV-Doc)
- [ ] La opción «Anonimizar… y usar solo la herramienta de IA autorizada por la universidad» se corresponde con la herramienta y la política reales de la UFV; se sabe cuál es esa herramienta para citarla en el debriefing. (UFV-Doc, UFV-SI)
- [ ] Coherencia con la normativa interna de la UFV sobre uso de IA y con las guías docentes. (UFV-Doc)
- [ ] Valorar una versión nueva del escenario con una explicación por opción y una idea clave por fase (el formato de escenario ya las admite; falta mostrarlas en el debriefing de la consola). Los escenarios publicados no se modifican: un cambio es una versión nueva. (UFV-Doc, Dev)
- [ ] Locuciones de VictorIA revisadas de oído (pronunciación, ritmo, naturalidad) para todas las fases. (UFV-Doc)
- [ ] Personaje definitivo decidido (el actual es provisional). (UFV)
- [ ] Textos de interfaz revisados en español y sin el nombre interno del producto, incluidos el título de la pantalla vacía de la consola (hoy alude a una negociación), la pantalla de inicio de sesión de Access y los nombres de los ficheros exportados (CSV y JSON). (Dev, UFV-Doc)
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
