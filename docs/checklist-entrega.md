# AXYRO · Lista de verificación de la entrega del MVP

Lista para cerrar la entrega del MVP a una organización cliente (despacho de abogados, colegio profesional o entidad de formación jurídica) y preparar el piloto. Marca cada casilla cuando el punto esté verificado en el entorno que usará el cliente. Revisada el 15 de octubre de 2026. Los puntos que dependen de una decisión del cliente se marcan con **[Validar cliente]**.

Responsables: **Dev** (equipo de desarrollo de AXYRO), **Cliente-Sist** (sistemas o informática del cliente), **Cliente-DPD** (delegado de protección de datos del cliente o persona responsable de privacidad), **Cliente-Form** (formadores o responsables de formación del piloto).

---

## 1. Técnica

### Código y calidad

- [x] Cambios locales confirmados y subidos al repositorio; la rama principal compila y CI pasa. (Dev)
- [x] La verificación completa del proyecto (tests, comprobación de tipos y compilación) pasa sin errores. (Dev)
- [x] Puerta de calidad de 50 simulaciones consecutivas superada con la API local (6 oct 2026); el script usa la identidad de demostración. (Dev)
- [ ] Puerta de 50 simulaciones repetida tras el cambio al escenario «Uso responsable de la IA en el despacho» e incorporada a la integración continua. (Dev)
- [ ] Prueba de humo contra la API desplegada con cuentas de prueba, código de acceso e invitado por PIN. (Dev)
- [ ] Despliegue automático activado en la integración continua (variable de repositorio `CLOUDFLARE_DEPLOY` y credenciales de despliegue) o despliegue manual documentado; entorno de preproducción separado. Hoy se despliega a mano. (Dev)
- [x] Comprobación de salud de la API (`/api/health`) correcta tras el despliegue. (Dev)

### Despliegue y dominio

- [x] Migraciones de base de datos 0001 a 0005 aplicadas en el entorno remoto. (Dev)
- [ ] Migraciones 0006 (nombres de sesión), 0007 (invitados y PIN) y 0008 (Modo IA) aplicadas y verificadas en el entorno remoto. (Dev)
- [ ] Dominio de servicio confirmado: `axyro.qhel.dev` o un dominio propio si el cliente lo solicita; en ese caso, servicio trasladado y QR y enlace de unión comprobados con el nuevo dominio. **[Validar cliente]** (Cliente-Sist, Dev)
- [x] Dirección pública alternativa del servicio y URL de vista previa desactivadas en la configuración del despliegue. (Dev)
- [ ] Comprobado en el panel de Cloudflare que la dirección alternativa y las URL de vista previa siguen desactivadas. (Dev)
- [x] Simulador WebGL publicado en `/simulador/` y probado con una sesión autenticada (versión anterior). (Dev)
- [ ] Nueva compilación 3D con la marca AXYRO (despacho, pantalla por situación, cámara, reacciones habladas y pantalla de carga) publicada y verificada: carga con caché, acceso de invitados y **Abrir en 3D** desde la vista móvil. (Dev)
- [ ] Probado en los navegadores y equipos de la sala del cliente (Chrome y Edge, red corporativa con posible inspección TLS). (Cliente-Sist, Dev)
- [ ] Tiempo real por WebSocket probado en la red del cliente; si se bloquea, comprobado que la consola, el proyector y el móvil siguen con consultas periódicas. (Cliente-Sist, Dev)
- [ ] Audio de VictorIA y sincronización labial correctos en los equipos de la sala. (Cliente-Form)
- [ ] Solo si se usa la versión de escritorio para Windows (`Build/AXYRO.exe`): respuesta por voz local (Vosk) probada en esos equipos; donde Windows no deja abrir el micrófono aparece «Voz no disponible · elige con el ratón». (Cliente-Sist)
- [ ] Prueba de carga con el tamaño de grupo previsto para el piloto (participantes simultáneos desde la misma red, límite de 300 peticiones por minuto y usuario y límite de 30 códigos fallidos por IP). (Dev)

### Vista móvil, invitados y voz

- [ ] Unión por QR y por código en `/unirse` probada con iPhone y Android (escaneo del QR con la cámara, alias, **Entrar**, **Empezar**). (Dev, Cliente-Form)
- [ ] En iPhone y Android: audio de las situaciones (**Escuchar a VictorIA**), reacción hablada al confirmar y repetición desde el resultado. (Dev, Cliente-Form)
- [ ] Voz en el móvil probada en iPhone y Android: aviso y **Aceptar y activar**, órdenes cortas («la dos», «opción B»), respuesta libre con confirmación e interrupción de VictorIA al hablar. (Dev, Cliente-Sist)
- [ ] Decisión en el móvil después de agotarse el tiempo comprobada. (Dev)
- [ ] Avisos de personaje virtual y de origen IA (en escenarios convertidos desde el Modo IA) visibles en la vista móvil. (Dev)
- [ ] Respuesta por voz en el simulador 3D (secreto `SONIOX_API_KEY`, región en `SONIOX_REGION`; hoy proyecto de EE. UU. con aviso previo): permiso de micrófono, interrupción de VictorIA y decisión por voz probados en los equipos de la sala. (Dev, Cliente-Sist)
- [ ] Clave Soniox con saldo suficiente para el piloto y permisos de claves temporales, reconocimiento en tiempo real y síntesis en tiempo real; credenciales de reconocimiento de un solo uso (60 s) y de síntesis de 15 minutos comprobadas. (Dev)
- [ ] Workers AI: cuota diaria y plan de la cuenta suficientes para Clef y, si se mantiene, el Modo IA (mensaje «Se ha alcanzado el límite diario de IA» comprobado). (Dev)

### Consola y proyector

- [ ] Proyector probado en la sala: QR (tecla **Q**), voz de VictorIA (tecla **V**), **Mostrar respuesta**, comparación con la media, **Pausar** / **Reanudar** y **Finalizar** (también antes de tiempo, con confirmación) y **Esc**. (Dev, Cliente-Form)
- [ ] Voz de VictorIA en el proyector con salida de audio de la sala y subtítulo cuando no hay voz. (Cliente-Form)
- [ ] **Demo rápida** y **Simular equipo / Quitar simulados** probados; exclusión de simulados en informe y analítica. (Dev)
- [ ] **Analítica** comprobada con datos reales: filtros, «Sin datos aún» sin cifras inventadas y exclusión de simulados por defecto. (Dev)
- [ ] Informe de impacto: **Descargar PDF** (A4) y CSV comprobados. (Dev, Cliente-Form)

### Acceso e identidad

- [x] Pantalla propia de acceso con correo y código personal de seis cifras comprobada en producción. (Dev)
- [x] Códigos únicos por usuario, revocación inmediata de la sesión, límite de cinco intentos por correo y minuto y auditoría de accesos comprobados en producción con cuentas de prueba. (Dev)
- [x] Cloudflare Access retirado del dominio para que la infraestructura sea transparente al usuario. (Dev)
- [ ] Organización del cliente creada y propietario inicial con una cuenta del cliente (hoy la organización inicial «AXYRO» tiene como propietaria una cuenta de desarrollo, guardada como secreto del despliegue). **[Validar cliente]** (Dev, Cliente-Sist)
- [ ] Formadores del piloto dados de alta por el propietario y con código personal. (Dev)
- [x] Prueba de aislamiento: un usuario sin código recibe «Acceso no autorizado»; un participante no puede crear, exportar ni borrar sesiones y no ve decisiones ni resultados de sus compañeros. (Dev)
- [ ] Prueba de aislamiento de invitados en producción: fuera de su sesión reciben «Acceso de invitado limitado a su sesión.»; no ven a sus compañeros; el PIN deja de valer al finalizar. (Dev)

### Datos y privacidad (implementación)

- [ ] Estado de las sesiones (Durable Objects) en la jurisdicción UE comprobado en el entorno desplegado (configurado en el código). (Dev)
- [ ] Cola de eventos: aceptada por el DPD del cliente sin jurisdicción UE (solo IDs seudónimos y campos de una lista blanca, sin texto de incidentes) o recreada en la UE. (Dev, Cliente-DPD)
- [ ] Ubicación UE de la base de datos D1 y de R2 comprobada en el panel de Cloudflare. (Dev)
- [ ] Tarea diaria de conservación activa (03:17 UTC) y comprobada con datos de prueba: sesiones a los 365 días (también las no finalizadas desde su creación), auditoría y usos de códigos a los 730 días, invitados caducados (12 h o 2 h tras finalizar), PIN revocados a las 24 h, límites de intentos a las 24 h y partidas del Modo IA a los 365 días. (Dev)
- [ ] **Dar de baja** desde «Participantes y accesos» y rectificación del nombre (volviendo a dar de alta) probadas; también **Retirar de la sesión** y **Exportar sus datos (JSON)** de un participante concreto (pestaña «Participantes» de la sesión). (Dev)
- [ ] Vista del participante comprobada (miembro e invitado): solo sus sesiones, sus decisiones y sus resultados, sin valoraciones antes de decidir. (Dev)
- [ ] **Exportar datos (JSON)** y **Eliminar** (individual y por selección) probados desde la consola; la auditoría registra ambos y el borrado elimina PIN e invitados. (Dev)
- [ ] Copias de seguridad y recuperación de la base de datos documentadas y probadas (procedimiento de restauración). (Dev)

---

## 2. Legal y cumplimiento

- [ ] Base jurídica decidida para cada tipo de actividad (ver *Privacidad y transparencia*, Parte B, apartado 3). **[Validar cliente]** (Cliente-DPD)
- [ ] Finalidad de la analítica agregada y de la comparación «Vuestro equipo frente a la media» aceptada e informada. (Cliente-DPD)
- [ ] Decisión sobre la evaluación de impacto (EIPD) documentada. (Cliente-DPD)
- [ ] Registro de actividades de tratamiento del cliente actualizado. (Cliente-DPD)
- [ ] Aviso de privacidad para participantes aprobado (primera y segunda capa), incluido el aviso para invitados (alias sin datos personales), y publicado donde se vaya a mostrar. (Cliente-DPD)
- [ ] Canal y plazo de ejercicio de derechos definidos. (Cliente-DPD)
- [ ] Cuenta de Cloudflare (del proveedor o propia del cliente) decidida y acuerdo de tratamiento de Cloudflare que cubra este uso. **[Validar cliente]** (Cliente-DPD, Dev)
- [ ] Ubicación del procesamiento de Workers AI (Clef y Modo IA) confirmada con Cloudflare y aceptada. (Cliente-DPD, Dev)
- [ ] Soniox: acuerdo de tratamiento y transferencia internacional de voz (reconocimiento y síntesis, proyecto en EE. UU.) aceptados por el DPD del cliente, o proyecto en la UE. (Cliente-DPD, Dev)
- [ ] Contrato de encargo de tratamiento (DPA) firmado entre el cliente (responsable) y el proveedor de AXYRO (encargado), con Cloudflare y Soniox como subencargados. (Cliente-DPD)
- [ ] Ubicación de los datos y transferencias internacionales aceptadas por el DPD del cliente. (Cliente-DPD)
- [ ] Plazos de conservación aprobados: sesiones, sesiones no finalizadas, invitados, miembros, auditoría de accesos, registros técnicos, partidas y colecciones del Modo IA y ficheros exportados. (Cliente-DPD)
- [ ] Política de colecciones del Modo IA (sin datos personales ni información de clientes, revisión y plazo de borrado) aprobada. (Cliente-DPD)
- [ ] Decisión sobre el flag `ai_live_demo` (Modo IA en vivo, activo hoy) durante el piloto. (Cliente-DPD, Cliente-Form)
- [ ] Decisión sobre la entrega privada y reposición de códigos personales del piloto. (Cliente-DPD, Cliente-Sist)
- [ ] Criterio sobre el uso del informe en actividades evaluables o acreditables (nunca como única base de evaluación). (Cliente-Form, Cliente-DPD)

### Reglamento Europeo de IA

- [ ] Texto de los avisos de transparencia sobre VictorIA (simulador 3D, vista móvil, consola y proyector) aprobado. (Cliente-DPD)
- [ ] Aviso de origen IA en los escenarios convertidos desde el Modo IA («Creado con IA · revisado por …» y aviso al participante) aprobado. (Cliente-DPD)
- [ ] Confirmado que no se infieren emociones ni estados psicológicos y que no se usa la cámara. (Dev)
- [ ] Confirmado que las valoraciones son de la decisión y no de la persona, y que el informe usa reglas fijas sin IA. (Dev)
- [ ] Inventario de IA en ejecución documentado y aceptado: en las sesiones, Clef (Workers AI) para asignar la respuesta libre por voz a una opción, con confirmación si duda; en el Modo IA, `toMarkdown`, `bge-m3` y `gpt-oss-120b`. Ningún cliente contiene claves de IA. (Dev, Cliente-DPD)
- [ ] Clasificación de riesgo revisada con el Modo IA activo y la conversión de partidas en escenarios (supervisión humana obligatoria). (Cliente-DPD)
- [ ] Documentada la procedencia de la voz: locuciones de situación y reacciones habladas (16 en el escenario por defecto) generadas de antemano con Soniox TTS (voz «Carmen», proyecto en EE. UU.), reproducidas sin llamar a Soniox; síntesis en tiempo real con Soniox para los comentarios del proyector y el Modo IA. Condiciones de uso revisadas antes del piloto. (Dev, Cliente-DPD)
- [ ] Si se sustituye por una locutora real o se clona una voz: contrato y consentimiento expreso firmados antes de usarla. (Dev)

### Licencias y propiedad intelectual

- [ ] Inventario de licencias y condiciones de terceros revisado: modelo 3D provisional (Microsoft Rocketbox, MIT), sincronización labial (uLipSync, MIT), reconocimiento de voz local en Windows (Vosk, Apache 2.0) y su modelo de idioma, Rive, Unity, generador de QR (qrcode-generator, MIT) y dependencias web. (Dev)
- [ ] Condiciones de Soniox TTS para las locuciones y reacciones pregrabadas y para la síntesis en tiempo real revisadas. (Dev)
- [ ] Modelos de Workers AI: `gpt-oss-120b` (Apache 2.0), `bge-m3` (MIT), Clef y condiciones de uso de Workers AI revisados. (Dev)
- [ ] Recursos de la escena 3D de despacho (mobiliario, pantalla y contenidos ficticios) confirmados como creados en el propio proyecto. (Dev)
- [ ] Si el cliente quiere su logotipo o su marca junto a la de AXYRO: autorización de uso por escrito. **[Validar cliente]** (Cliente-Form)
- [ ] Propiedad de los escenarios y contenidos creados para el cliente acordada, incluidos los escenarios redactados con IA. **[Validar cliente]** (Cliente-Form, Dev)

---

## 3. Contenidos

- [ ] Escenario «Uso responsable de la IA en el despacho» (*Secreto profesional*, *Jurisprudencia inventada*, *Contratar un proveedor de IA* y *Transparencia con el cliente*) revisado por un abogado experto designado por el cliente: situaciones, opciones, consecuencias, valoraciones y referencias normativas (secreto profesional, Código Deontológico y Estatuto General de la Abogacía Española, RGPD/LOPDGDD y Reglamento de IA). (Cliente-Form)
- [ ] La opción «… usar solo la herramienta de IA contratada por el despacho» se corresponde con la herramienta y la política reales del cliente; se sabe cuál es esa herramienta para citarla en el debriefing. **[Validar cliente]** (Cliente-Form, Cliente-Sist)
- [ ] Coherencia con la política interna del cliente sobre uso de IA y con las normas deontológicas del colegio que corresponda. (Cliente-Form)
- [ ] Explicación de cada opción («por qué») e idea clave de cada situación revisadas; el simulador, el móvil y la consola ya las muestran. Los escenarios publicados no se modifican: un cambio es una versión nueva. (Cliente-Form)
- [ ] Locuciones de VictorIA revisadas de oído (pronunciación, ritmo, naturalidad) para todas las situaciones. (Cliente-Form)
- [ ] Las reacciones habladas revisadas (texto y audio): hablan de la decisión, nunca de la persona. (Cliente-Form)
- [ ] Plantillas de los comentarios de VictorIA en el proyector y de la comparación con la media revisadas. (Cliente-Form)
- [ ] Procedimiento de revisión de escenarios redactados con IA antes de publicarlos (quién revisa, criterios y registro). (Cliente-Form)
- [ ] Personaje definitivo decidido (el actual es provisional). (Dev)
- [ ] Textos de interfaz revisados en español y con la marca AXYRO, incluidas la pantalla propia de código de acceso, la vista móvil, el QR y el enlace de unión (dominio visible), y el nombre técnico de la cookie de sesión. (Dev, Cliente-Form)

---

## 4. Formación y piloto

- [ ] *Guía del formador* revisada y entregada a los formadores del piloto. (Cliente-Form)
- [ ] *Guía del participante* publicada en la intranet o entregada antes de la sesión. (Cliente-Form)
- [ ] Sesión de formación para formadores (30–45 minutos): crear sesión, QR y código, proyector (Q, V, Mostrar respuesta, Pausar, Finalizar), debriefing, informe, analítica, exportar y eliminar; Modo IA solo si el cliente lo mantiene. (Dev, Cliente-Form)
- [ ] Lista de comprobación para el equipo de la sala entregada a los formadores (como la guía de prueba interna, sin nombres internos). (Dev)
- [ ] Sesión de ensayo completa con un grupo reducido en una sala real, con móviles de los participantes. (Cliente-Form)
- [ ] Contacto de soporte durante el piloto y procedimiento de incidencias definidos. (Cliente-Sist, Dev)
- [ ] Indicadores del piloto acordados: utilidad, facilidad de uso, fiabilidad, participación, valor percibido, problemas operativos y calidad del informe. (Cliente-Form, Dev)
- [ ] Encuesta breve para formadores y participantes al terminar el piloto (sin datos de salud ni psicológicos). (Cliente-Form)
- [ ] Sesiones de prueba y de demostración («Demo · …») eliminadas antes de empezar el piloto. (Dev, Cliente-Form)
- [ ] Colecciones de prueba del Modo IA eliminadas antes de empezar el piloto. (Dev, Cliente-Form)

---

## 5. Documentación entregada

- [ ] Guía del formador (`docs/guia-formador.md`).
- [ ] Guía del participante (`docs/guia-participante.md`).
- [ ] Privacidad y transparencia (`docs/privacidad-y-transparencia.md`), validada por el DPD del cliente.
- [ ] Esta lista de verificación (`docs/checklist-entrega.md`), completada y firmada.
- [ ] Documentación técnica de despliegue, operación y recuperación (`docs/operacion-y-recuperacion.md`) para el equipo de sistemas.

**Aceptación de la entrega**

| Rol | Nombre | Fecha | Firma |
|---|---|---|---|
| Responsable de formación del cliente | | | |
| Sistemas del cliente | | | |
| Delegado de protección de datos del cliente | | | |
| Equipo de desarrollo de AXYRO | | | |
