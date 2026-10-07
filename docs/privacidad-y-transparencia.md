# Simulador de decisiones UFV · Privacidad y transparencia

> **Borrador para revisión por la Universidad Francisco de Vitoria.** Este documento no es un aviso legal definitivo. Las bases jurídicas, los plazos y los textos dirigidos a los participantes deben ser validados por el Delegado de Protección de Datos (DPO) y la Secretaría General de la UFV. Los puntos que requieren decisión o validación se marcan con **[Validar UFV]**; los que dependen de un cambio técnico pendiente, con **[Pendiente técnico]**.
>
> Fecha de la revisión técnica: 7 de octubre de 2026. Versión revisada: MVP para el piloto, con acceso de invitados, voz opcional y Modo IA en vivo (demo) activo en el entorno actual.

Contenido:

- **Parte A.** Borrador de aviso para participantes.
- **Parte B.** Nota técnica para el DPO de la UFV.
- **Parte C.** Transparencia sobre inteligencia artificial (Reglamento Europeo de IA).
- **Parte D.** Puntos que debe validar la UFV.

---

## Parte A · Borrador de aviso para participantes

*Texto pensado para mostrarse antes de la primera sesión (aula virtual, correo o pantalla inicial). Primera capa breve y segunda capa con el detalle.*

### Primera capa

> **Simulador de decisiones · Información sobre tus datos**
>
> La Universidad Francisco de Vitoria trata los datos con los que participas en el simulador (un **alias** si entras como invitado con el código de la sesión, o tu **nombre y correo** si entras con cuenta), las decisiones que tomas y el tiempo que tardas en tomarlas, para desarrollar la actividad formativa, comentar los resultados en el aula y obtener estadísticas agregadas de la actividad.
>
> No se graba tu voz ni tu imagen, y no se analizan emociones ni estados psicológicos. La valoración de cada opción se refiere a la decisión, no a ti, y ningún sistema toma decisiones automáticas sobre ti.
>
> Responder con la voz es **opcional**. Si la activas, tu voz se transcribe con un proveedor situado en **Estados Unidos** y, si respondes con tus palabras, un modelo de IA asigna la frase a una opción; no se guarda el audio ni la frase.
>
> VictorIA es un personaje virtual: su imagen y su voz son sintéticas. Sus intervenciones están escritas de antemano (o redactadas con IA y revisadas por un docente, cuando así se indica).
>
> Los datos de cada sesión se conservan como máximo 365 días desde que termina (o desde que se creó, si no llega a terminar); el acceso de invitado caduca en horas. Puedes ejercer tus derechos ante la UFV en **[Validar UFV: canal de ejercicio de derechos]**. Más información: **[enlace a la segunda capa]**.

### Segunda capa

**Responsable del tratamiento.** Universidad Francisco de Vitoria, **[Validar UFV: datos identificativos y dirección]**. Delegado de Protección de Datos: **[Validar UFV: contacto del DPO]**.

**Qué datos tratamos**

- **Acceso invitado** (el habitual en el aula): un **alias** de 2 a 30 caracteres que eliges tú, sin correo ni cuenta. Recomendamos que no sea tu nombre completo ni contenga datos personales. El acceso vale solo para esa sesión y caduca.
- **Acceso con cuenta:** nombre y correo electrónico (de cualquier dominio) dados de alta por el docente; código personal de seis cifras (solo se guarda una huella protegida, no el código), sesión técnica y fecha de cada acceso.
- **Datos de la actividad:** sesión en la que participas, momento en que te unes, opción elegida en cada situación y tiempo empleado en decidir.
- **Voz, solo si la activas:** el audio de tu micrófono mientras la voz está activa y el texto transcrito de tu frase (ver «Voz» más abajo).
- **En tu dispositivo:** el navegador recuerda tu último alias y que ya pulsaste «Empezar» en la sesión.

**Qué datos no tratamos.** No se usa la cámara. No se guardan grabaciones ni el audio de tu voz. No se infieren emociones, estrés, motivación ni otros estados psicológicos. No se registra lo que haces fuera del simulador.

**Voz (opcional).** Antes de abrir el micrófono el simulador explica dónde se procesa y pide una segunda pulsación («Aceptar y activar»); si no la aceptas, respondes tocando la opción. Mientras la voz está activa, el audio va directamente de tu navegador al servicio de transcripción **Soniox**, en **Estados Unidos** (transferencia internacional). Si dices la opción («la dos», «opción B») se resuelve en tu propio navegador; si respondes con tus palabras, el texto transcrito de esa frase (sin nombre, correo ni identificador) se envía a un modelo de Cloudflare Workers AI que solo la asigna a una de las opciones y pide confirmación si duda. Ni el audio ni la frase se guardan en el simulador. El micrófono se corta al desactivarlo o al cambiar de pestaña.

**Para qué.** Desarrollar la actividad formativa, mostrar a tu docente el desarrollo de la sesión, realizar el debriefing con el grupo (en la pantalla del aula solo se muestran totales de la clase) y obtener **estadísticas agregadas** de la organización, como la proporción de decisiones óptimas por situación o la comparación «Vuestra clase frente a la media», que nunca identifican ni ordenan a personas. Los resultados no se usan para tomar decisiones automatizadas sobre ti.

**Base jurídica.** **[Validar UFV]** Véase la propuesta de la Parte B, apartado 3.

**Quién accede.** Tu docente y el profesorado con rol docente en la plataforma de la organización. Los demás participantes no ven tu alias o nombre, tus decisiones ni tus resultados. Prestan servicios como encargados o subencargados del tratamiento Cloudflare, Inc. (infraestructura y modelos de IA de Workers AI) y Soniox (transcripción y síntesis de voz) **[Validar UFV: cadena de encargos]**.

**Dónde se tratan.** En la infraestructura de Cloudflare. La base de datos, el almacenamiento de ficheros y el estado de las sesiones se alojan en la Unión Europea. La transcripción de voz se realiza en Estados Unidos, y otros componentes (procesamiento en el borde, cola de eventos y modelos de IA) pueden tratar datos fuera de la UE **[Validar UFV: texto final según la Parte B, apartado 4]**.

**Cuánto tiempo.** Los datos de cada sesión, incluido tu alias, hasta 365 días desde su finalización (o desde su creación si no se finaliza), salvo que tu docente la elimine antes. El acceso de invitado caduca a las 12 horas o 2 horas después de finalizar la sesión. Si tienes cuenta, tu nombre y correo se conservan mientras seas miembro de la organización **[Validar UFV: plazo]**.

**Tus derechos.** Acceso, rectificación, supresión, oposición, limitación y portabilidad, ante la UFV en **[Validar UFV]**. Si participaste como invitado, solo podremos localizar tus datos por el alias y la sesión. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

**Cookies y almacenamiento local.** El acceso usa una única cookie técnica de sesión, necesaria para el funcionamiento del servicio: caduca a las 24 horas si entras con cuenta y a las 12 horas si entras como invitado. El navegador guarda además tu último alias para la próxima vez. No se usan cookies analíticas ni publicitarias.

---

## Parte B · Nota técnica para el DPO

### 1. Descripción del sistema

| Componente | Función | Tecnología |
|---|---|---|
| Control de acceso | Miembros: correo y código personal. Invitados: código de seis cifras de la sesión (PIN) y alias. | Cloudflare Worker y D1. El código personal se guarda como HMAC con un secreto del Worker; la sesión se verifica en cada petición. |
| API | Sesiones, miembros, invitados, escenarios, analítica, exportación y borrado. | Cloudflare Workers. |
| Estado vivo de cada sesión | Participantes (nombre o alias), decisiones, indicadores y reloj. | Cloudflare Durable Objects (un objeto por sesión, en la jurisdicción UE). Actualización en directo por WebSocket. |
| Base de datos | Organización, usuarios, roles, sesiones, eventos, invitados, escenarios, auditoría y datos del Modo IA. | Cloudflare D1. |
| Cola de eventos | Traslada los eventos de la sesión a la base de datos. | Cloudflare Queues. |
| Almacenamiento de ficheros | Ficheros grandes del simulador 3D y, en el Modo IA, los documentos originales que sube el docente y sus vectores. | Cloudflare R2 (jurisdicción UE). |
| Consola web y proyector | Interfaz del docente; vista agregada para la pantalla del aula. | Aplicación web servida por el mismo dominio. |
| Vista móvil | Cliente del participante en el navegador (`/unirse`, `/jugar`). | Aplicación web servida por el mismo dominio. |
| Simulador 3D | Cliente del participante (personaje, voz, interacción). | Unity WebGL en el navegador, servido por el mismo dominio y solo con una sesión válida (miembro o invitado de esa sesión). |
| Voz | Transcripción opcional de la respuesta del participante; voz sintética de VictorIA en el proyector y en el Modo IA. | Soniox (proyecto en Estados Unidos). El Worker solo emite credenciales temporales; el audio va directamente del navegador a Soniox. |
| Modelos de IA | Clef: asigna una respuesta libre por voz a una opción. Modo IA en vivo: conversión de documentos, vectores y modelo de lenguaje. | Cloudflare Workers AI (`clef-flash`, `toMarkdown`, `bge-m3`, `gpt-oss-120b`). |
| Registros técnicos | Diagnóstico y seguridad. | Registros de Cloudflare Workers (observabilidad activada). |

**IA en ejecución.** En las **sesiones de clase** la única IA es Clef, y solo si el participante responde por voz con sus propias palabras. El **Modo IA en vivo (demo)** está activo en el entorno actual, reservado a docentes, y usa IA generativa (Parte C, apartado 4). Ni el simulador 3D ni el navegador contienen claves de proveedores: el Worker emite credenciales temporales de Soniox.

**Organización (tenant).** Todos los datos pertenecen a una organización; cada usuario pertenece a una sola organización y cada consulta a la base de datos filtra por organización.

### 2. Inventario de datos personales

Verificado en el código y en el esquema de base de datos (migraciones 0001 a 0008).

| Dato | Dónde se guarda | Origen | Finalidad | Acceso |
|---|---|---|---|---|
| Correo electrónico | D1, usuarios | Alta por el docente. | Identificación y control de acceso. | Docentes de la organización. |
| Nombre visible | D1, usuarios; copia en el estado de cada sesión en la que participa | Alta por el docente. | Mostrar quién participa, informe y debriefing. | Docentes; el propio participante. |
| Rol | D1, miembros | Alta por el docente; solo el propietario asigna el rol docente. | Autorización. | Docentes. |
| Identificador interno (UUID aleatorio; `guest-<uuid>` para invitados) | D1 (usuarios, invitados, eventos, auditoría), Durable Object, cola, registros técnicos; se envía a Soniox como referencia de la credencial temporal | Sistema. | Seudonimización de eventos, auditoría, registros y trazabilidad de credenciales. | Docentes; sistema. |
| Alias del invitado | D1, `guests` (hasta que caduca el acceso o se borra la sesión); copia en el estado de la sesión como nombre del participante | El propio invitado. | Participar sin cuenta. | Docentes de la organización; el propio invitado. Nunca en el proyector. |
| PIN de la sesión | D1, `session_pins`, en claro | Sistema. | Unión de invitados; el docente lo proyecta. Solo vale para una sesión no finalizada. | Docentes; quien lo vea en el aula. |
| Nombre de la sesión | D1, sesiones | Docente (opcional, hasta 80 caracteres). | Distinguir sesiones. No sale a la auditoría. | Docentes. Puede contener datos personales si el docente los escribe. |
| Unión a la sesión y hora | Durable Object; evento en D1 | Cliente. | Desarrollo de la sesión y analítica. | Docentes; el propio participante. |
| Decisión por situación, hora y tiempo empleado | Durable Object; evento en D1 | Cliente. | Indicadores, informe, debriefing y analítica agregada. | Docentes; el propio participante. Agregada en el proyector. |
| Indicadores e informe individual | Durable Object (calculados) | Sistema. | Informe por participante y media de la clase. | Docentes; el propio participante. |
| Texto de incidentes | Durable Object y exportaciones (no sale a la cola ni a D1) | Docente. | Desarrollo de la sesión. | Docentes; participantes de esa sesión. Puede contener datos personales si el docente los escribe (nota 2). |
| Registro de auditoría | D1, `audit_log` | Sistema. | Trazabilidad de control de sesiones, exportaciones, borrados, altas y bajas, códigos, uniones de invitados, PIN regenerados, publicación de escenarios, colecciones, documentos y partidas del Modo IA y borrados por retención. Solo IDs seudónimos. | Equipo técnico (no se muestra en la consola). |
| Código de acceso y usos | D1, `access_codes` y `access_code_uses` | Docente e inicio de sesión. HMAC del código, estado y fecha de cada uso. | Control de acceso y auditoría. | Docentes: contador y últimos accesos; equipo técnico: registro completo. |
| Sesión técnica | D1, `access_sessions` y `guests` (hash del token); cookie HTTP segura | Inicio de sesión o unión. | Mantener la sesión iniciada. | Sistema. |
| Límites de intentos | D1, `access_login_limits` (hash de correo o de IP, ventana y contador) | Sistema. | Protección frente a fuerza bruta. | Sistema. |
| Escenarios publicados por la organización | D1, escenarios (JSON, versión, ID de quien publica); `origin` si procede del Modo IA | Docente. | Uso en sesiones. La consola muestra el nombre del docente que publicó («revisado por …»). | Docentes de la organización; los participantes ven el contenido. |
| Colecciones de conocimiento (Modo IA) | D1: nombre de la colección, nombre de fichero, tipo, tamaño y estado de cada documento, y fragmentos de texto con su pista de cita; R2 (UE): documento original y vectores | Docente. | Generar situaciones basadas en esos documentos. | Docentes de la organización. **Puede contener datos personales si se suben documentos con ellos** (nota 3). |
| Partidas del Modo IA | D1, `ai_runs` (tema, estado) y `ai_turns` (situación generada, opción elegida y reacción); nunca la frase dicha | Docente y modelo. | Desarrollo de la demostración y conversión en escenario. | Docente que la creó. |
| Audio de voz | No se guarda. Del navegador a Soniox (EE. UU.) mientras la voz está activa. | Participante (o docente en el Modo IA). | Transcripción. | Soniox, según sus condiciones **[Validar UFV]**. |
| Frase transcrita | No se guarda. A Cloudflare Workers AI (Clef) si es una respuesta libre; en el Modo IA, también las preguntas del docente al modelo de lenguaje con fragmentos de los documentos. | Participante o docente. | Asignar la respuesta a una opción o contestar la pregunta. | Cloudflare, según sus condiciones. |
| Texto de los comentarios del proyector | No se guarda. A Soniox (síntesis en tiempo real) si la voz del proyector está activa. Frases de plantilla con porcentajes agregados, sin nombres. | Sistema. | Voz de VictorIA en el aula. | Soniox. |
| Almacenamiento del navegador | Dispositivo del usuario: alias del invitado (`localStorage`), marca de «Empezar» en la sesión (`sessionStorage`), preferencia de voz del proyector y borrador del editor de escenarios del Modo IA (`localStorage`) | Usuario. | Comodidad de uso. | Solo el propio dispositivo. |
| Exportaciones | Fuera del sistema: JSON, CSV y PDF del informe con nombres o alias | Docente. | Archivo y debriefing. | Docente responsable del fichero. |
| Registros técnicos | Cloudflare Workers | Sistema. | Diagnóstico y seguridad: identificador de petición, método, ruta, código de respuesta, duración y UUID de organización y usuario. Sin nombres, correos, textos de documentos ni frases. | Equipo técnico. |

**Lo que no se trata:** grabaciones de voz, imagen o vídeo, datos biométricos, emociones o estados psicológicos, ubicación, pulsaciones de teclado o movimientos del ratón fuera de la elección de opción.

**Seudonimización.** Los eventos de simulación, la cola y la auditoría solo contienen identificadores aleatorios, nunca nombres, alias ni correos. La cola aplica además una lista blanca de campos por tipo de evento (identificadores del escenario y valores numéricos): cualquier otro campo, como el texto de un incidente, se sustituye por una marca de «redactado» y se vuelve a filtrar al escribir en D1. La identidad se resuelve únicamente en la consola del docente.

**Nota 1 · Visibilidad entre participantes.** Cada participante (miembro o invitado) recibe una vista filtrada de la sesión: solo sus propias decisiones, indicadores e informe, sin nombres ni decisiones de otros. En las situaciones en las que aún no ha decidido tampoco recibe la valoración de las opciones ni sus efectos. El proyector del aula muestra solo totales. Los docentes ven todas las sesiones de su organización con nombres y alias.

**Nota 2 · Texto libre.** El nombre de la sesión, el texto de los incidentes y el tema de las partidas del Modo IA son libres. La consola y la guía docente indican no introducir datos personales.

**Nota 3 · Documentos del Modo IA.** Los documentos se procesan con Workers AI y se almacenan en R2 y D1 hasta que el docente borra el documento o la colección. La interfaz y la guía docente prohíben subir datos personales, pero el sistema no puede impedirlo técnicamente. **[Validar UFV]** Política de uso de colecciones.

### 3. Finalidad y base jurídica sugerida

**Finalidades:** (1) desarrollo de actividades formativas de simulación y toma de decisiones, seguimiento de la sesión por el docente y debriefing con el grupo; (2) analítica agregada de la organización y comparación de una clase con la media de la organización, sin datos por persona; (3) demostraciones del Modo IA en vivo, solo con docentes.

**Propuesta de base jurídica (RGPD, art. 6.1) · [Validar UFV]**

| Supuesto | Base sugerida | Comentario |
|---|---|---|
| Actividad integrada en una asignatura o plan de estudios | Art. 6.1.b: ejecución de la relación académica derivada de la matrícula. | Encaja si la actividad forma parte de la docencia. El DPO puede valorar alternativamente el art. 6.1.e en la medida en que la normativa universitaria lo ampare. |
| Formación del personal (PDI, PTGAS) | Art. 6.1.b (relación laboral) o 6.1.f (interés legítimo en la formación). | Si se usa 6.1.f, documentar la ponderación. |
| Actividades voluntarias, pilotos o investigación sobre la propia herramienta | Art. 6.1.a (consentimiento) o 6.1.f. | El consentimiento solo es válido si la participación es realmente libre y existe alternativa sin perjuicio. |
| Analítica agregada y comparación con la media | Compatible con la finalidad docente (art. 6.4) o 6.1.f. | Solo agregados; valorar si se informa expresamente. |
| Respuesta por voz | La propia de la actividad, con aviso previo y alternativa sin voz. | La voz es opcional; la transferencia internacional requiere garantías (apartado 4). |

**No se recomienda** basar en el consentimiento las actividades obligatorias de una asignatura, por el desequilibrio entre la universidad y el estudiante.

**Acceso invitado · [Validar UFV].** El invitado se identifica solo con un alias elegido por él. Recomendar en el aviso y en el aula un alias sin datos personales. Valorar si en actividades evaluables se exige el acceso con cuenta.

**Entrega de códigos · [Validar UFV].** El docente da de alta manualmente a cada persona y le entrega su código personal por un canal privado. Valorar el procedimiento de entrega, reposición y revocación para el piloto.

**Uso del informe en la calificación · [Validar UFV].** El informe calcula puntuaciones con reglas fijas del escenario. Si una actividad es evaluable, la calificación debe decidirla el docente con su criterio; el informe no debe ser la única base (art. 22 RGPD).

**Evaluación de impacto (EIPD) · [Validar UFV].** Valorar si es necesaria. Elementos a considerar: datos de estudiantes en un contexto educativo, uso de tecnologías nuevas (voz e IA), transferencia internacional de voz y volumen previsto. Elementos que reducen el riesgo: minimización (alias de invitado), ausencia de biometría y de perfilado, seudonimización de eventos, vista restringida de cada participante, voz opcional sin almacenamiento y plazos de conservación limitados.

### 4. Ubicación de los datos y transferencias

| Componente | Ubicación configurada | Datos personales | Estado |
|---|---|---|---|
| D1 (base de datos) | Unión Europea, según la configuración de la cuenta documentada por el equipo técnico. | Sí: correo, nombre, rol, alias, eventos seudonimizados, auditoría, fragmentos de documentos del Modo IA. | **[Validar UFV]** Comprobar en el panel de Cloudflare que la base de datos está en la jurisdicción UE. |
| R2 (ficheros) | Jurisdicción UE (configurada en el despliegue). | Ficheros del simulador (sin datos personales) y documentos del Modo IA (pueden contenerlos si se suben). | Correcto, con la política de la nota 3. |
| Durable Objects (estado de cada sesión) | Jurisdicción UE (configurada en el despliegue). | Sí: nombres o alias, decisiones, tiempos y texto de incidentes. | Correcto. |
| Queues (cola de eventos) | **Sin jurisdicción UE**: la API de Cloudflare rechazó la opción UE al crear la cola. | Solo identificadores seudónimos y campos de la lista blanca. | **[Validar UFV]** Aceptar con esa minimización, o **[Pendiente técnico]** recrear la cola en la UE o sustituirla por escritura directa en D1. |
| Workers (ejecución de la API) y sus registros | Red global de Cloudflare: cada petición se procesa en el centro de datos más cercano. | En tránsito; los registros solo con UUID. | **[Validar UFV]** Valorar si se requiere restringir el procesamiento a la UE y el plazo de conservación de los registros. |
| Workers AI (Clef y Modo IA) | **Sin garantía de procesamiento en la UE.** | Frase transcrita de la respuesta libre (sin identificadores); en el Modo IA, documentos, fragmentos y preguntas del docente. | **[Validar UFV]** Confirmar con Cloudflare la ubicación del procesamiento y sus condiciones de conservación. |
| Soniox · reconocimiento de voz (STT) | **Estados Unidos** (`SONIOX_REGION = us`). Se activa sin cambios de código con un proyecto en la UE. | Audio de la voz mientras está activa; identificador seudónimo como referencia de la credencial. | **[Validar UFV]** Transferencia internacional: garantías del proveedor (DPA, cláusulas contractuales tipo) y conservación, o exigir un proyecto en la UE. |
| Soniox · síntesis de voz (TTS) | **Estados Unidos**. | Textos de plantilla del proyector (agregados, sin nombres) y textos generados en el Modo IA; identificador seudónimo del docente. | **[Validar UFV]** Mismo análisis. |
| Síntesis del navegador | Dispositivo del docente (y, según el sistema operativo, el servicio de voz del navegador). | En el Modo IA, si falla la voz de Soniox, el texto generado se lee con la síntesis de voz del navegador. | Informativo. El proyector de las sesiones nunca usa la síntesis del navegador. |

Cloudflare, Inc. y Soniox tienen sede en Estados Unidos. Las transferencias internacionales que pudieran producirse deben estar cubiertas por el Marco de Privacidad de Datos UE-EE. UU. y por cláusulas contractuales tipo en sus acuerdos de tratamiento. **[Validar UFV]** Confirmar con la documentación vigente de cada proveedor.

### 5. Plazos de conservación

Verificado en el código y la configuración del despliegue. Una tarea programada se ejecuta **cada día a las 03:17 UTC**:

| Dato | Plazo |
|---|---|
| Sesiones finalizadas (estado, eventos, PIN e invitados) | **365 días** desde la finalización (configurable). Hasta 200 sesiones por ejecución; el borrado se anota en la auditoría. |
| Sesiones no finalizadas | **365 días** desde su creación, con el mismo procedimiento. |
| Acceso invitado (alias y hash del token en `guests`) | **12 horas** desde la unión o **2 horas** después de finalizar la sesión, lo que ocurra antes; la tarea diaria borra los caducados. Desaparece también al borrar la sesión. El alias sigue en el estado de la sesión hasta que esta se borra. |
| PIN de la sesión | Deja de valer al finalizar la sesión o al regenerarlo; los revocados se borran a las **24 horas**. |
| Sesiones técnicas de miembros | 24 horas; se borran al caducar o al revocar el código. |
| Usos de códigos de acceso (`access_code_uses`) | **730 días**. |
| Límites de intentos (`access_login_limits`) | **24 horas**. |
| Auditoría | **730 días** (configurable). Solo identificadores seudónimos. |
| Partidas del Modo IA (`ai_runs`, `ai_turns`) | **365 días** desde su creación. |
| Colecciones y documentos del Modo IA | **Sin plazo automático**: los borra el docente (al borrar una colección se borran sus documentos, fragmentos, vectores y partidas). **[Validar UFV]** Fijar un plazo. |
| Usuarios y miembros (correo, nombre, rol) | **Sin plazo automático.** La baja desde la consola («Dar de baja») borra el correo y el nombre si la persona no pertenece a otra organización; la copia del nombre en las sesiones en las que participó se mantiene hasta que se eliminan o caducan. **[Validar UFV]** Definir el plazo (por ejemplo, fin del curso académico). |
| Ficheros exportados (JSON, CSV, PDF) | Fuera del sistema, bajo la responsabilidad del docente. **[Validar UFV]** Indicar dónde guardarlos y cuándo borrarlos. |
| Copias de seguridad | D1 mantiene recuperación a un momento anterior durante un periodo limitado gestionado por Cloudflare; un dato borrado puede permanecer en ese histórico hasta que caduca. **[Validar UFV]** Confirmar el periodo. |

### 6. Derechos de los interesados

| Derecho | Cómo se atiende en el MVP | Estado |
|---|---|---|
| Acceso y portabilidad | El docente que creó la sesión descarga la sesión completa en JSON (estado, participantes, decisiones, eventos e informe) o el detalle en CSV. La exportación queda en la auditoría. | Disponible. Hay que extraer del fichero solo los datos de la persona solicitante. Los invitados solo se pueden localizar por alias y sesión. |
| Supresión | Por sesión: el docente que la creó la elimina; se borran estado, eventos, PIN e invitados y solo queda una anotación en la auditoría. Por persona con cuenta: **Dar de baja** en «Participantes y accesos» borra su correo y su nombre. | Disponible. **[Pendiente técnico]** No se puede borrar a un único participante dentro de una sesión ni exportar los datos de una sola persona. |
| Rectificación | El docente vuelve a dar de alta el correo con el nombre correcto. Un invitado no puede cambiar su alias. | Disponible para miembros. |
| Oposición y limitación | Se atiende de forma organizativa (no incluir a la persona en sesiones; ofrecer la alternativa sin voz). | **[Validar UFV]** Procedimiento. |
| No ser objeto de decisiones automatizadas | El sistema no toma decisiones sobre las personas. | Mantener en la guía docente que el informe no es la única base de calificación. |

**[Validar UFV]** Canal de ejercicio de derechos, responsable interno y plazo de respuesta.

### 7. Medidas de seguridad

- Autenticación propia con correo y código personal; HMAC del código con secreto del Worker, límite de intentos transaccional en D1 (cinco por correo y 120 por IP por minuto) y sesiones con cookie segura (HttpOnly, SameSite=Lax). Cambiar o revocar un código invalida sus sesiones.
- **Invitados con ámbito cerrado:** solo pueden leer su sesión, unirse y decidir en ella, pedir la voz para su sesión y cerrar su acceso; cualquier otra ruta responde 403. Contra la fuerza bruta del PIN, como máximo **30 códigos fallidos por IP cada 10 minutos**, además del límite por IP.
- Autorización por rol en el servidor; la identidad y la organización nunca se toman del cliente. Solo el propietario asigna el rol docente.
- Separación de organizaciones: todas las consultas filtran por organización y un correo no puede darse de alta en dos organizaciones.
- No se puede degradar ni dar de baja al propietario ni al último docente.
- Protección CSRF: las operaciones que modifican datos solo se aceptan desde el propio dominio y con cuerpo JSON. El WebSocket de tiempo real exige que el origen sea el propio dominio.
- Cabeceras de seguridad: política de seguridad de contenidos por superficie, HTTPS obligatorio (HSTS), protección frente a incrustación, sin envío de la dirección de la página a terceros, sin cámara y con el micrófono limitado al propio dominio (simulador 3D y páginas web, cuando el servicio de voz está configurado). El micrófono solo se abre si la persona activa la voz y acepta el aviso.
- Límites de uso: 300 peticiones por minuto y usuario; credenciales de voz para participantes (6 por minuto), voz sintética (30 por minuto por docente) e IA del Modo IA (20 por minuto por docente), además de la cuota diaria de Workers AI.
- Credenciales de voz temporales: las de reconocimiento son de un solo uso y valen 60 segundos; las de síntesis, solo para docentes, valen 15 minutos. La clave del proveedor nunca llega al navegador.
- Registros técnicos sin nombres, correos, textos de documentos ni frases, con un identificador por petición; un error interno no devuelve detalles al usuario.
- Cifrado en tránsito (HTTPS) y en reposo (gestionado por Cloudflare).
- Credenciales fuera del código fuente (secretos del despliegue); las direcciones públicas alternativas del servicio están desactivadas.
- Auditoría de acciones de control, exportaciones, borrados, altas y bajas, códigos, uniones de invitados, PIN regenerados, publicación de escenarios y acciones del Modo IA (sin texto de documentos ni frases).
- Escenarios publicados inmutables: cualquier cambio crea una versión nueva y cada sesión conserva la versión con la que empezó.

### 8. Encargados y subencargados del tratamiento

| Entidad | Servicio | Estado |
|---|---|---|
| Cloudflare, Inc. | Infraestructura (Workers, D1, Durable Objects, Queues y R2) y modelos de IA (Workers AI). | **[Validar UFV]** El servicio está desplegado en una cuenta de Cloudflare de desarrollo cuya titularidad no es de la UFV. Decidir si la cuenta pasa a ser de la UFV (con el acuerdo de tratamiento de Cloudflare a nombre de la UFV) o si se mantiene con un tercero. Confirmar la ubicación del procesamiento de Workers AI. |
| Soniox | Reconocimiento de voz en tiempo real y síntesis de voz (proyecto en Estados Unidos). | **[Validar UFV]** Acuerdo de tratamiento, garantías de la transferencia internacional y condiciones de conservación de Soniox, o proyecto en la UE. |
| Desarrollador o proveedor del servicio | Desarrollo, mantenimiento y operación; acceso técnico a los datos. | **[Validar UFV] Pendiente: contrato de encargo de tratamiento (art. 28 RGPD, DPA)**, con la lista de subencargados (Cloudflare y Soniox). |

### 9. Voz de los participantes

- **Vista móvil y simulador 3D en el navegador:** respuesta por voz opcional con Soniox, como se describe en la Parte A. El navegador muestra el aviso de transferencia antes de abrir el micrófono; las órdenes cortas se resuelven en el navegador; las frases libres se interpretan con Clef y se confirma la opción si hay duda. Hablar mientras VictorIA habla la interrumpe. Ni el servidor del simulador ni Unity reciben ni guardan el audio.
- **Versión de escritorio para Windows (si se usa):** el reconocimiento de las palabras «uno», «dos», «tres», «cuatro» y «repetir» se hace en el propio equipo; no se graba ni se envía el audio. **[Validar UFV]** Servicios Informáticos debe confirmar que la configuración de voz de los equipos de aula no envía audio a servicios externos.
- **Voz de VictorIA:** ver Parte C.

---

## Parte C · Transparencia sobre inteligencia artificial (Reglamento Europeo de IA)

### 1. Qué es VictorIA

VictorIA es un **personaje virtual** con imagen y voz sintéticas. En las sesiones de clase **no es un sistema de IA que converse**: sus intervenciones son textos escritos en cada escenario y sus reacciones a cada decisión son grabaciones fijas. No genera respuestas en tiempo real ni se adapta a la persona. Solo en el **Modo IA en vivo** (apartado 4), reservado a docentes, genera contenido con IA.

- **Imagen:** modelo 3D provisional de una biblioteca abierta de personajes ficticios (Microsoft Rocketbox, licencia MIT). No representa a una persona real. El personaje definitivo está pendiente de producción.
- **Voz de las situaciones y reacciones:** locuciones sintéticas creadas antes del despliegue con Soniox TTS (voz «Carmen») a partir de las frases públicas de cada escenario: 12 locuciones de situación y **33 reacciones habladas** a las opciones de los escenarios de VictorIA, derivadas de forma determinista de la valoración de la decisión, su consecuencia y su «por qué». Se incluyen como ficheros de audio en el simulador 3D y en la vista móvil; reproducirlas no llama a Soniox ni envía datos.
- **Comentarios del proyector:** al revelar la respuesta, VictorIA comenta el resultado con **frases de plantilla fijas** (sin IA generativa) que usan solo porcentajes agregados de la clase. Si la voz del proyector está activa, la frase se sintetiza **en tiempo real con Soniox**. Siempre aparece como subtítulo con la nota «Comentario automático generado a partir de los votos».
- **Escenarios redactados con IA:** un docente puede convertir una partida del Modo IA en un escenario de clase. La conversión no usa IA; el docente **debe revisar** el borrador y confirmar la revisión al publicarlo. Estos escenarios llevan la marca «Creado con IA · revisado por …» y los participantes ven el aviso de origen.
- **Evolución prevista:** si la voz final se graba con una locutora profesional, se hará con contrato y **consentimiento expreso** para ese uso, y se actualizará este documento.

### 2. Qué no hace el sistema

- **No infiere emociones, estrés, nerviosismo, motivación ni estados psicológicos**, ni por cámara, ni por voz, ni por biometría. No usa la cámara. La voz solo se transcribe para elegir una opción. (El reconocimiento de emociones está prohibido en contextos educativos y laborales por el art. 5.1.f del Reglamento de IA.)
- **No evalúa a las personas.** Cada opción lleva una valoración de diseño (*Mejor opción*, *Aceptable* o *Crítica*) que se refiere a la decisión. El informe de las sesiones aplica reglas fijas y transparentes; no interviene ningún modelo de IA en la valoración. Clef solo asigna una frase a una opción existente, con confirmación del participante si duda.
- **No toma decisiones automatizadas con efectos sobre la persona.** No asigna calificaciones, no decide el acceso a estudios ni detecta conductas. Cualquier decisión académica la toma el docente.

### 3. Obligaciones de transparencia y aviso

- **Simulador 3D:** aviso permanente en pantalla: «VictorIA es un personaje virtual: su imagen y su voz son sintéticas.».
- **Vista móvil:** aviso de personaje virtual y, en escenarios redactados con IA, aviso de que el escenario se redactó con IA y lo revisó un docente. El panel de voz indica que un modelo de IA asigna la frase a una opción.
- **Consola:** aviso en cada sesión de que VictorIA es un personaje virtual, con el origen del escenario, y de que no se infieren emociones.
- **Proyector:** nota de comentario automático en cada comentario de VictorIA.
- **Modo IA en vivo:** distintivo permanente «Generado con IA a partir de tus documentos · puede contener errores» y fuentes citadas en cada situación.

**[Validar UFV]** Texto definitivo de los avisos. Texto ampliado propuesto para la presentación del docente o el aula virtual:

> **VictorIA es un personaje virtual.** Su imagen y su voz se han generado por ordenador. Lo que dice en la sesión está escrito de antemano por el equipo docente (o redactado con IA y revisado por un docente, si así se indica). No es una persona real ni una inteligencia artificial que converse contigo. No se graba tu voz ni tu imagen. Si respondes con la voz, un modelo de IA solo asigna tu frase a una de las opciones.

**Clasificación de riesgo · [Validar UFV].** El sistema no usa IA para evaluar resultados de aprendizaje, decidir el acceso o la admisión, ni vigilar a estudiantes durante pruebas (supuestos de alto riesgo del anexo III, punto 3, del Reglamento de IA). Con el Modo IA activo y la conversión de partidas en escenarios, hay que revisar la clasificación, mantener la supervisión humana (revisión docente obligatoria antes de publicar) y documentarlo antes de usarlo con estudiantes.

### 4. Modo IA en vivo (demo) · [Validar UFV]

Modo separado de las sesiones de clase, **activo en el entorno actual** (configuración `ai_live_demo`) y reservado a docentes. Aquí VictorIA **usa IA generativa**:

- **Datos:** documentos que sube el docente (PDF, DOCX, TXT, MD o texto pegado) con su nombre de fichero; fragmentos de texto y vectores; tema de la partida; situaciones generadas, opción elegida y reacción. No se guardan las frases dichas.
- **Procesamiento:** Cloudflare Workers AI convierte los documentos a texto (`toMarkdown`), calcula vectores (`bge-m3`) y genera situaciones, opciones, reacciones y respuestas con un modelo de lenguaje (`gpt-oss-120b`), recibiendo fragmentos de los documentos y las preguntas del docente. La ubicación de este procesamiento no está garantizada en la UE.
- **Voz:** reconocimiento y síntesis con Soniox en Estados Unidos, con aviso de transferencia; si la síntesis falla, se usa la del navegador.
- **Almacenamiento y plazos:** originales y vectores en R2 (UE); resto en D1. Partidas, 365 días; colecciones, hasta que el docente las borra.
- **Transparencia:** la interfaz avisa de que el contenido lo genera una IA y puede contener errores, cita las fuentes y prohíbe subir datos personales. Los textos de documentos y las frases no van a registros ni auditoría.

**No se deben subir documentos con datos personales** ni usar este modo con estudiantes hasta que el DPO valide proveedores, ubicación y base jurídica, y se revise la clasificación de riesgo. **[Validar UFV]** Decidir si `ai_live_demo` permanece activo durante el piloto.

---

## Parte D · Puntos que debe validar la UFV

**Legales y organizativos**

1. Base jurídica para cada tipo de actividad (asignatura, formación del personal, pilotos voluntarios) y para la analítica agregada y la comparación con la media.
2. Necesidad de evaluación de impacto (EIPD).
3. Textos definitivos del aviso de privacidad (primera y segunda capa) y canal de ejercicio de derechos.
4. Titularidad de la cuenta de Cloudflare y acuerdo de tratamiento con Cloudflare.
5. Contrato de encargo de tratamiento (DPA) con el desarrollador o proveedor del servicio, con Cloudflare y Soniox como subencargados.
6. **Soniox:** acuerdo de tratamiento y garantías de la transferencia internacional de voz (reconocimiento y síntesis), o proyecto en la UE.
7. **Workers AI:** ubicación del procesamiento de Clef y de los modelos del Modo IA, y condiciones de conservación.
8. Aceptación de la cola de eventos sin jurisdicción UE (con la minimización descrita) y de la ejecución global de Workers.
9. Plazos de conservación: sesiones (365 días propuestos), auditoría de acciones y accesos (730 días), invitados (12 horas o 2 horas tras finalizar), partidas del Modo IA (365 días), colecciones (sin plazo hoy), miembros, registros técnicos y ficheros exportados.
10. **Política de alias de invitados:** aviso en el aula, recomendación de alias sin datos personales y si las actividades evaluables exigen cuenta.
11. **Política de colecciones del Modo IA:** prohibición de datos personales, revisión y plazo de borrado.
12. **Decisión sobre `ai_live_demo` durante el piloto** (activo hoy) y sobre el uso de escenarios redactados con IA con estudiantes.
13. Procedimiento de entrega, reposición y revocación de códigos personales.
14. Uso del informe en actividades evaluables (nunca como única base de calificación).
15. Texto de los avisos de transparencia sobre VictorIA, el origen de los escenarios y la voz.
16. Revisión de la clasificación de riesgo del Reglamento de IA con el Modo IA activo.
17. Si se usa la versión de escritorio con voz: confirmación por Servicios Informáticos de la configuración de voz de los equipos de aula.

**Cambios técnicos pendientes**

1. Cola de eventos con jurisdicción UE, o sustituirla (si la UFV no acepta la configuración actual).
2. Borrado y exportación de los datos de un participante concreto dentro de una sesión.
3. Plazo automático de conservación para los miembros y para las colecciones del Modo IA, cuando la UFV los fije.
4. Proyecto Soniox en la región UE, si la UFV no acepta la transferencia.
5. Trasladar el servicio al dominio definitivo cuando la UFV lo decida. La antigua protección de acceso de Cloudflare ya está retirada; el acceso es propio (correo y código, o PIN y alias).
