# Simulador de decisiones UFV · Privacidad y transparencia

> **Borrador para revisión por la Universidad Francisco de Vitoria.** Este documento no es un aviso legal definitivo. Las bases jurídicas, los plazos y los textos dirigidos a los participantes deben ser validados por el Delegado de Protección de Datos (DPO) y la Secretaría General de la UFV. Los puntos que requieren decisión o validación se marcan con **[Validar UFV]**; los que dependen de un cambio técnico pendiente, con **[Pendiente técnico]**.
>
> Fecha de la revisión técnica: 6 de octubre de 2026. Versión revisada: MVP para el piloto.

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
> La Universidad Francisco de Vitoria trata tu nombre, tu correo institucional, las decisiones que tomas en el simulador y el tiempo que tardas en tomarlas para desarrollar la actividad formativa y comentar los resultados en el aula.
>
> No se graba tu voz ni tu imagen, y no se analizan emociones ni estados psicológicos. La valoración de cada opción se refiere a la decisión, no a ti, y ningún sistema toma decisiones automáticas sobre ti.
>
> VictorIA es un personaje virtual: su imagen y su voz se han generado por ordenador y sus intervenciones están guionizadas.
>
> Los datos de cada sesión se conservan como máximo 365 días desde que termina (o desde que se creó, si no llega a terminar). Puedes ejercer tus derechos ante la UFV en **[Validar UFV: canal de ejercicio de derechos]**. Más información: **[enlace a la segunda capa]**.

### Segunda capa

**Responsable del tratamiento.** Universidad Francisco de Vitoria, **[Validar UFV: datos identificativos y dirección]**. Delegado de Protección de Datos: **[Validar UFV: contacto del DPO]**.

**Qué datos tratamos**

- Datos identificativos: nombre y correo electrónico, dados de alta por el docente. Se admiten correos de cualquier dominio.
- Acceso invitado (si el docente lo usa): basta el PIN de la sesión y un alias, sin correo ni cuenta; vale solo para esa sesión y caduca (ver Parte B, plazos).
- Datos de acceso: código personal de seis cifras (solo se guarda una huella protegida, no el código), sesión técnica y fecha de cada acceso.
- Datos de la actividad: sesión en la que participas, momento en que te unes, opción elegida en cada situación y tiempo empleado en decidir.

**Qué datos no tratamos.** En el navegador el simulador no usa la cámara y, en la configuración actual, tampoco el micrófono. **[Validar UFV]** La respuesta por voz en el navegador es opcional y la activa el propio participante. Hoy usa un proyecto de reconocimiento de voz Soniox situado en **Estados Unidos**, lo que supone una **transferencia internacional** de la voz del participante. Antes de abrir el micrófono el simulador lo explica y pide una segunda pulsación («Aceptar y activar»); si no se acepta, se responde con el ratón. Mientras la voz está activa, el audio va del navegador a Soniox para transcribir la frase; ni el servidor del simulador ni Unity reciben ni guardan el audio, y el micrófono se corta al desactivarlo o cambiar de pestaña. El DPO debe validar la transferencia (garantías del proveedor y condiciones de conservación de Soniox) o exigir un proyecto en la región UE, que se activa sin cambiar el código. **[Validar UFV]** Si el participante responde con sus propias palabras en lugar de decir el número, el texto transcrito de esa frase (sin nombre, correo ni identificador) se envía al modelo de decisión Clef de Cloudflare Workers AI junto con la situación y sus opciones, para asignarla a una opción. Clef no genera texto ni valora a la persona: solo devuelve la probabilidad de cada opción; si duda, el simulador pide confirmación y la decisión la confirma siempre el participante. La frase no se guarda en registros ni eventos. Está pendiente confirmar con Cloudflare la ubicación de ese procesamiento. En la versión de escritorio para Windows, si se responde por voz, el reconocimiento de las palabras «uno», «dos», «tres», «cuatro» y «repetir» se hace en el propio equipo y no se graba ni se envía el audio. No se infieren emociones, estrés, motivación ni otros estados psicológicos.

**Para qué.** Desarrollar la actividad formativa, mostrar a tu docente el desarrollo de la sesión y realizar el debriefing con el grupo. Los resultados no se usan para tomar decisiones automatizadas sobre ti.

**Base jurídica.** **[Validar UFV]** Véase la propuesta de la Parte B, apartado 3.

**Quién accede.** Tu docente y el profesorado con rol de instructor en la plataforma. Los demás participantes no ven tu nombre, tus decisiones ni tus resultados: cada participante solo ve los suyos. Cloudflare, Inc. presta la infraestructura como encargado del tratamiento.

**Dónde se tratan.** En la infraestructura de Cloudflare. La base de datos y el estado de las sesiones se alojan en la Unión Europea. Algunos componentes del servicio pueden tratar datos fuera de la UE **[Validar UFV: texto final según la Parte B, apartado 4]**.

**Cuánto tiempo.** Los datos de cada sesión, hasta 365 días desde su finalización (o desde su creación si no se finaliza), salvo que tu docente la elimine antes. Tu nombre y correo, mientras seas miembro de la organización **[Validar UFV: plazo]**.

**Tus derechos.** Acceso, rectificación, supresión, oposición, limitación y portabilidad, ante la UFV en **[Validar UFV]**. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

**Cookies.** El acceso usa una cookie técnica de sesión de AXYRO, necesaria para el funcionamiento del servicio. Caduca a las 24 horas; no se usan cookies analíticas ni publicitarias.

---

## Parte B · Nota técnica para el DPO

### 1. Descripción del sistema

| Componente | Función | Tecnología |
|---|---|---|
| Control de acceso | Autentica a cada usuario mediante correo y código personal. | Cloudflare Worker y D1. El código se guarda como HMAC con un secreto del Worker; la sesión se verifica en cada petición. |
| API | Lógica de sesiones, miembros, escenarios, exportación y borrado. | Cloudflare Workers. |
| Estado vivo de cada sesión | Participantes, decisiones, indicadores y reloj de la sesión. | Cloudflare Durable Objects (un objeto por sesión, en la jurisdicción UE). |
| Base de datos | Organización, usuarios, roles, sesiones, eventos, escenarios y auditoría. | Cloudflare D1. |
| Cola de eventos | Traslada los eventos de la sesión a la base de datos. | Cloudflare Queues. |
| Almacenamiento de ficheros | Ficheros del simulador (programa WebGL). No contiene datos personales. | Cloudflare R2 (jurisdicción UE). |
| Consola web | Interfaz del docente. | Aplicación web servida por el mismo dominio. |
| Simulador | Cliente del participante (personaje, voz, interacción). | Unity WebGL en el navegador, servido por el mismo dominio y protegido por la sesión de AXYRO. |
| Registros técnicos | Diagnóstico y seguridad. | Registros de Cloudflare Workers (observabilidad activada). |

No hay llamadas a proveedores de inteligencia artificial durante el uso: los textos del personaje están escritos en el escenario y las locuciones son ficheros de audio generados de antemano. El cliente no contiene claves de servicios de IA y la funcionalidad de personajes con IA está desactivada.

**Organización (tenant).** Todos los datos pertenecen a una organización; la UFV es una organización separada, cada usuario pertenece a una sola organización y cada consulta a la base de datos filtra por organización.

### 2. Inventario de datos personales

Verificado en el código y en el esquema de base de datos del MVP.

| Dato | Dónde se guarda | Origen | Finalidad | Acceso |
|---|---|---|---|---|
| Correo electrónico | D1, tabla de usuarios | Alta por el docente; se usa junto al código personal para identificarse. | Identificación y control de acceso. | Instructores de la organización (lista de miembros). |
| Nombre visible | D1, tabla de usuarios; copia en el estado de cada sesión en la que participa (Durable Object) | Alta por el docente, corregible por el docente. | Mostrar quién participa y el debriefing. | Instructores; el propio participante. |
| Rol (docente o participante) | D1, tabla de miembros | Alta por el docente; solo el propietario asigna el rol docente. | Autorización. | Instructores. |
| Identificador interno del usuario (UUID aleatorio) | D1 (usuarios, eventos, auditoría), Durable Object, cola de eventos, registros técnicos | Generado por el sistema. | Seudonimización de eventos, auditoría y registros. | Instructores; sistema. |
| Unión a la sesión y hora | Durable Object; evento en D1 | Simulador. | Desarrollo de la sesión. | Instructores; el propio participante. |
| Decisión por fase, hora y tiempo empleado (ms) | Durable Object; evento en D1 | Simulador. | Indicadores, informe y debriefing. | Instructores; el propio participante. |
| Indicadores e informe individual | Durable Object (se calculan a partir de las decisiones) | Sistema. | Informe por participante y media de la clase. | Instructores; el propio participante. |
| Texto de incidentes (escrito por el docente) | Durable Object y exportaciones. No sale a la cola ni llega a la tabla de eventos de D1. | Consola. | Desarrollo de la sesión. | Instructores; participantes de esa sesión. Puede contener datos personales si el docente los escribe (nota 2). |
| Registro de auditoría | D1, tabla de auditoría | Sistema. | Trazabilidad: creación, control, exportación y borrado de sesiones, altas y bajas de miembros, publicación de escenarios y borrados por retención. Solo IDs seudónimos. | Equipo técnico (no se muestra en la consola). |
| Código de acceso y usos | D1, tablas `access_codes` y `access_code_uses` | Generación por el docente e inicio de sesión. Se guarda el HMAC del código, su estado y fecha de cada uso; el código en claro solo se muestra una vez. | Control de acceso y auditoría. | Instructores: contador y últimas fechas; equipo técnico: registro completo. |
| Sesión técnica | D1, tabla `access_sessions`, y cookie HTTP segura | Inicio de sesión. En D1 solo se guarda el hash del token; caduca a las 24 horas o al revocar el código. | Mantener la sesión iniciada. | Sistema. |
| Invitados y PIN de sesión | D1, tablas `guests` y `session_pins`, y cookie HTTP segura | Unión con PIN y alias. Alias, sesión, hash del token y caducidad; el PIN de seis cifras se guarda en claro porque el docente lo proyecta y solo vale para una sesión no finalizada. | Participar en una sesión sin cuenta. | Sistema; el alias lo ve el docente como nombre del participante. |
| Registros técnicos del servicio | Cloudflare Workers | Sistema. | Diagnóstico y seguridad. Una línea por petición con identificador de petición, método, ruta, código de respuesta, duración y UUID de organización y usuario; avisos de límite de peticiones y errores. No incluyen nombre ni correo. | Equipo técnico. |

**Lo que no se trata:** audio o grabaciones de voz, imagen o vídeo, datos biométricos, emociones o estados psicológicos, ubicación, pulsaciones de teclado o movimientos del ratón fuera de la elección de opción.

**Seudonimización.** Los eventos de simulación y los mensajes de la cola solo contienen identificadores aleatorios (organización, sesión, usuario), nunca nombres ni correos. La cola, además, aplica una lista blanca de campos por tipo de evento (identificadores del escenario y valores numéricos): cualquier otro campo, como el texto de un incidente, se sustituye por una marca de «redactado» y se vuelve a filtrar al escribir en D1. La identidad se resuelve únicamente en la consola del docente.

**Nota 1 · Visibilidad entre participantes.** Cada participante recibe una vista filtrada de la sesión: solo sus propias decisiones, indicadores e informe, sin nombres ni decisiones de otros participantes. En las situaciones en las que aún no ha decidido tampoco recibe la valoración de las opciones ni sus efectos. Solo puede listar las sesiones a las que se ha unido y no puede consultar la cronología de eventos. Los instructores ven todas las sesiones de su organización con los nombres.

**Nota 2 · Texto libre.** El texto de los incidentes es libre (máximo 200 caracteres) y lo ven los participantes de la sesión. La consola y la guía docente indican no introducir datos personales.

### 3. Finalidad y base jurídica sugerida

**Finalidad:** desarrollo de actividades formativas de simulación y toma de decisiones, seguimiento de la sesión por el docente y debriefing con el grupo.

**Propuesta de base jurídica (RGPD, art. 6.1) · [Validar UFV]**

| Supuesto | Base sugerida | Comentario |
|---|---|---|
| Actividad integrada en una asignatura o plan de estudios | Art. 6.1.b: ejecución de la relación académica derivada de la matrícula. | Encaja si la actividad forma parte de la docencia. El DPO puede valorar alternativamente el art. 6.1.e en la medida en que la normativa universitaria lo ampare. |
| Formación del personal (PDI, PTGAS) | Art. 6.1.b (relación laboral) o 6.1.f (interés legítimo en la formación). | Si se usa 6.1.f, documentar la ponderación. |
| Actividades voluntarias, pilotos o investigación sobre la propia herramienta | Art. 6.1.a (consentimiento) o 6.1.f. | El consentimiento solo es válido si la participación es realmente libre y existe alternativa sin perjuicio. |

**No se recomienda** basar en el consentimiento las actividades obligatorias de una asignatura, por el desequilibrio entre la universidad y el estudiante.

**Entrega de códigos · [Validar UFV].** El docente da de alta manualmente a cada persona y le entrega su código personal por un canal privado. Valorar el procedimiento de entrega, reposición y revocación para el piloto.

**Uso del informe en la calificación · [Validar UFV].** El informe calcula puntuaciones con reglas fijas del escenario. Si una actividad es evaluable, la calificación debe decidirla el docente con su criterio; el informe no debe ser la única base (art. 22 RGPD).

**Evaluación de impacto (EIPD) · [Validar UFV].** Valorar si es necesaria. Elementos a considerar: tratamiento de datos de estudiantes en un contexto de evaluación, uso de una tecnología nueva y volumen previsto. Elementos que reducen el riesgo: minimización, ausencia de biometría y de perfilado, seudonimización de eventos, vista restringida de cada participante y plazos de conservación limitados.

### 4. Ubicación de los datos y transferencias

| Componente | Ubicación configurada | Datos personales | Estado |
|---|---|---|---|
| D1 (base de datos) | Unión Europea, según la configuración de la cuenta documentada por el equipo técnico. | Sí: correo, nombre, rol, eventos seudonimizados, auditoría. | **[Validar UFV]** Comprobar en el panel de Cloudflare que la base de datos está en la jurisdicción UE. |
| R2 (ficheros) | Jurisdicción UE (configurada en el despliegue). | No: solo los ficheros del simulador. | Correcto. |
| Durable Objects (estado de cada sesión) | Jurisdicción UE (configurada en el despliegue). | Sí: nombres de participantes, decisiones, tiempos y texto de incidentes. | Correcto. |
| Queues (cola de eventos) | **Sin jurisdicción UE**: la API de Cloudflare rechazó la opción UE al crear la cola. | Solo identificadores seudónimos y campos de una lista blanca (identificadores del escenario y valores numéricos). No lleva nombres, correos ni texto de incidentes. | **[Validar UFV]** Aceptar esta ubicación con esa minimización, o **[Pendiente técnico]** recrear la cola en la UE cuando esté disponible o sustituirla por escritura directa en D1. |
| Workers (ejecución de la API) y sus registros | Red global de Cloudflare: cada petición se procesa en el centro de datos más cercano al usuario. | En tránsito, durante la petición; los registros solo con UUID. | **[Validar UFV]** Valorar si se requiere restringir el procesamiento a la UE (servicios regionales de Cloudflare) y el plazo de conservación de los registros. |

Cloudflare, Inc. es una empresa con sede en Estados Unidos. Las transferencias internacionales que pudieran producirse están cubiertas, según Cloudflare, por su adhesión al Marco de Privacidad de Datos UE-EE. UU. y por cláusulas contractuales tipo en su acuerdo de tratamiento de datos. **[Validar UFV]** Confirmar con la documentación vigente de Cloudflare.

### 5. Plazos de conservación

Verificado en el código y la configuración del despliegue. Una tarea programada se ejecuta **cada día a las 03:17 UTC**:

- **Sesiones finalizadas:** se borran a los **365 días** de su finalización (valor configurable en el despliegue). Se borran el estado de la sesión, sus eventos y la propia sesión, y el borrado se anota en la auditoría. Hasta 200 sesiones por ejecución.
- **Sesiones no finalizadas:** se borran a los **365 días** de su creación, con el mismo procedimiento.
- **Auditoría:** las entradas se borran a los **730 días** (configurable). Solo contienen identificadores seudónimos.
- **Acceso invitado:** quien entra con el PIN de la sesión y un alias, sin correo ni cuenta, solo puede participar en esa sesión. Se guardan el alias y una huella de la sesión técnica; caducan a las **12 horas** o **2 horas después de finalizar la sesión** (para consultar su informe), y la tarea diaria los borra; también desaparecen al borrar la sesión. El PIN deja de valer al finalizar o borrar la sesión. El alias aparece como nombre del participante en el estado de la sesión, que sigue el plazo de las sesiones; eventos y auditoría solo llevan un identificador seudónimo. **[Validar UFV]** Recomendar en el aviso que el alias no sea el nombre completo.
- **Usuarios y miembros** (correo, nombre, rol): **sin plazo automático**. El instructor puede dar de baja a un miembro por la API (sin botón en la consola todavía); la baja borra su correo y su nombre de la base de datos. La copia del nombre en el estado de las sesiones en las que participó se mantiene hasta que esas sesiones se eliminan o caducan. **[Validar UFV]** Definir el plazo (por ejemplo, fin del curso académico).
- **Ficheros exportados** (CSV o JSON descargados por el docente): quedan fuera del sistema, bajo la responsabilidad del docente. **[Validar UFV]** Indicar dónde deben guardarse y cuándo borrarse.
- **Copias de seguridad:** D1 mantiene recuperación a un momento anterior durante un periodo limitado gestionado por Cloudflare; un dato borrado puede permanecer en ese histórico hasta que caduca. **[Validar UFV]** Confirmar el periodo con la documentación de Cloudflare.

### 6. Derechos de los interesados

| Derecho | Cómo se atiende en el MVP | Estado |
|---|---|---|
| Acceso y portabilidad | El instructor que creó la sesión descarga la sesión completa en JSON (estado, participantes, decisiones, eventos e informe) o el debriefing en CSV. La exportación queda en la auditoría. | Disponible. Hay que extraer del fichero solo los datos de la persona solicitante. |
| Supresión | Por sesión: el instructor que la creó la elimina («Eliminar sesión»); se borran el estado y los eventos y solo queda una anotación en la auditoría. Por persona: baja del miembro por la API, que borra su correo y su nombre. | Disponible. **[Pendiente técnico]** No se puede borrar a un único participante de una sesión, y la baja de miembros aún no tiene botón en la consola. |
| Rectificación | El instructor vuelve a dar de alta el correo con el nombre correcto desde la consola. | Disponible. |
| Oposición y limitación | Se atiende de forma organizativa (no incluir a la persona en sesiones). | **[Validar UFV]** Procedimiento. |
| No ser objeto de decisiones automatizadas | El sistema no toma decisiones sobre las personas. | Mantener en la guía docente que el informe no es la única base de calificación. |

**[Validar UFV]** Canal de ejercicio de derechos, responsable interno y plazo de respuesta.

### 7. Medidas de seguridad

- Autenticación propia con correo y código personal; HMAC del código con secreto del Worker, límite de intentos y sesiones con cookie segura. Cambiar o revocar un código invalida sus sesiones.
- Autorización por rol en el servidor; la identidad y la organización nunca se toman del cliente. Solo el propietario inicial asigna el rol de docente.
- Separación de organizaciones: todas las consultas filtran por organización y un correo no puede darse de alta en dos organizaciones.
- No se puede degradar ni dar de baja al propietario de la organización ni al último instructor.
- Protección frente a peticiones de otros sitios (CSRF): las operaciones que modifican datos solo se aceptan desde el propio dominio y con cuerpo JSON.
- Cabeceras de seguridad en la API, la consola y el simulador: política de seguridad de contenidos, HTTPS obligatorio (HSTS), protección frente a incrustación en otros sitios, sin envío de la dirección de la página a terceros sin acceso a la cámara y con el micrófono permitido solo en la página del simulador, que únicamente lo abre si la voz UE está configurada y el participante la activa.
- Límite de 300 peticiones por minuto y usuario.
- Registros técnicos sin nombres ni correos, con un identificador por petición para el diagnóstico; un error interno no devuelve detalles al usuario.
- Cifrado en tránsito (HTTPS) y en reposo (gestionado por Cloudflare).
- Credenciales fuera del código fuente (el correo del propietario inicial se guarda como secreto del despliegue); la dirección pública alternativa del servicio está desactivada para que solo se acceda por el dominio protegido.
- Auditoría de acciones de control, exportaciones, borrados, altas y bajas de miembros y publicación de escenarios.
- Escenarios publicados inmutables: cualquier cambio crea una versión nueva y cada sesión conserva la versión con la que empezó.

### 8. Encargados del tratamiento

| Entidad | Servicio | Estado |
|---|---|---|
| Cloudflare, Inc. | Infraestructura (Workers, D1, Durable Objects, Queues y R2). | **[Validar UFV]** El servicio está desplegado en una cuenta de Cloudflare de desarrollo cuya titularidad no es de la UFV. Decidir si la cuenta pasa a ser de la UFV (con el acuerdo de tratamiento de Cloudflare a nombre de la UFV) o si se mantiene con un tercero. |
| Desarrollador o proveedor del servicio | Desarrollo, mantenimiento y operación; acceso técnico a los datos. | **[Validar UFV] Pendiente: contrato de encargo de tratamiento (art. 28 RGPD, DPA)**, con la lista de subencargados (Cloudflare). |

### 9. Datos de los participantes en el proceso de voz y personaje

- **Voz del participante:** el simulador en el navegador no usa el micrófono (el servidor lo bloquea expresamente). Solo la versión de escritorio para Windows admite respuesta por voz: el reconocimiento por palabras clave («uno», «dos», «tres», «cuatro», «repetir») se ejecuta en el propio equipo; no se graba, no se almacena y no se envía audio al servidor, solo la opción elegida, igual que con un clic. Si el equipo no permite abrir el micrófono, la voz se desactiva y se responde con ratón o teclado. **[Validar UFV]** Si se usa la versión de escritorio, Servicios Informáticos debe confirmar que la configuración de voz de los equipos de aula no envía audio a servicios externos.
- **Voz de VictorIA:** ver Parte C.

---

## Parte C · Transparencia sobre inteligencia artificial (Reglamento Europeo de IA)

### 1. Qué es VictorIA

VictorIA es un **personaje virtual**. En el MVP no es un sistema de IA que converse: sus intervenciones son textos fijos escritos en cada escenario y reproducidos con locuciones generadas de antemano. No genera respuestas en tiempo real ni se adapta al participante.

- **Imagen:** modelo 3D provisional de una biblioteca abierta de personajes ficticios (Microsoft Rocketbox, licencia MIT). No representa a una persona real. El personaje definitivo está pendiente de producción.
- **Voz:** locuciones sintéticas creadas antes del despliegue con Soniox TTS (voz «Carmen») a partir de las frases públicas de cada escenario. El proyecto actual de síntesis está en Estados Unidos; no se envían datos ni voz de participantes. Los WAV se incluyen en Unity y, en tiempo de ejecución, el navegador no llama a Soniox ni contiene su clave.
- **Evolución prevista:** si la voz final se graba con una locutora profesional, se hará con contrato y **consentimiento expreso** para ese uso, y se actualizará este documento.

### 2. Qué no hace el sistema

- **No infiere emociones, estrés, nerviosismo, motivación ni estados psicológicos**, ni por cámara, ni por voz, ni por biometría. No usa la cámara y no analiza la voz más allá de reconocer cinco palabras clave en el propio equipo (solo en la versión de escritorio). (Este tipo de reconocimiento de emociones está prohibido en contextos educativos y laborales por el art. 5.1.f del Reglamento de IA.)
- **No evalúa a las personas.** Cada opción del escenario lleva una valoración de diseño (*Mejor opción*, *Aceptable* o *Crítica*) que se refiere a la decisión según la buena práctica que enseña el escenario. El informe aplica reglas fijas y transparentes (indicadores, porcentajes y recuentos), no un modelo de aprendizaje automático.
- **No toma decisiones automatizadas con efectos sobre la persona.** No asigna calificaciones, no decide el acceso a estudios ni detecta conductas. Cualquier decisión académica la toma el docente.

### 3. Obligaciones de transparencia y aviso

Aunque en el MVP no hay interacción con un sistema de IA en tiempo real, la voz y la imagen de VictorIA son contenido sintético, y así se informa:

- **Simulador:** aviso permanente en pantalla: «VictorIA es un personaje virtual: su imagen y su voz son sintéticas.».
- **Consola:** aviso en cada sesión de que VictorIA es un personaje virtual con imagen y voz sintéticas e intervenciones guionizadas; de que no es una IA que converse; y de que no se infieren emociones y las valoraciones se refieren a las decisiones.

**[Validar UFV]** Texto definitivo de ambos avisos. Texto ampliado propuesto para la presentación del docente o el aula virtual:

> **VictorIA es un personaje virtual.** Su imagen y su voz se han generado por ordenador y sus intervenciones están guionizadas por el equipo docente. No es una persona real ni una inteligencia artificial que converse contigo. No se graba tu voz ni tu imagen.

**Clasificación de riesgo · [Validar UFV].** El MVP no usa IA para evaluar resultados de aprendizaje, decidir el acceso o la admisión, ni vigilar a estudiantes durante pruebas (supuestos de alto riesgo del anexo III, punto 3, del Reglamento de IA). Si en fases posteriores se incorporan personajes conversacionales con IA o evaluación asistida, habrá que revisar esta clasificación, mantener la supervisión humana y actualizar este documento antes de activarlas.

### 4. Modo IA en vivo (demo) · [Validar UFV]

Modo separado del simulador, activable por configuración (`ai_live_demo`) y reservado a instructores, pensado para demostraciones. A diferencia del MVP, aquí VictorIA **sí usa IA generativa**: los documentos que sube el instructor (PDF, DOCX, TXT, MD o texto pegado) se guardan en R2 (UE) y se procesan con Cloudflare Workers AI (conversión a texto, vectores y un modelo de lenguaje) para generar situaciones, opciones, reacciones y respuestas basadas solo en esos documentos. La ubicación del procesamiento de Workers AI no está garantizada en la UE. La voz de este modo (síntesis de VictorIA y reconocimiento de la persona) usa el proyecto Soniox de **Estados Unidos** (transferencia internacional). La interfaz debe avisar de que el contenido lo genera una IA y puede contener errores. No se guardan las frases dichas, solo la opción elegida; los textos de los documentos no van a registros ni auditoría. **No se deben subir documentos con datos personales** ni usar este modo con estudiantes hasta que el DPO valide proveedores, ubicación y base jurídica, y se revise la clasificación de riesgo del apartado 3.

---

## Parte D · Puntos que debe validar la UFV

**Legales y organizativos**

1. Base jurídica para cada tipo de actividad (asignatura, formación del personal, pilotos voluntarios).
2. Necesidad de evaluación de impacto (EIPD).
3. Textos definitivos del aviso de privacidad (primera y segunda capa) y canal de ejercicio de derechos.
4. Titularidad de la cuenta de Cloudflare y acuerdo de tratamiento con Cloudflare.
5. Contrato de encargo de tratamiento (DPA) con el desarrollador o proveedor del servicio.
6. Aceptación de la cola de eventos sin jurisdicción UE (con la minimización descrita) y de la ejecución global de Workers.
7. Plazos de conservación: sesiones (365 días propuestos), auditoría de acciones y accesos (730 días propuestos), miembros, registros técnicos y ficheros exportados.
8. Procedimiento de entrega, reposición y revocación de códigos personales.
9. Uso del informe en actividades evaluables (nunca como única base de calificación).
10. Texto de los avisos de transparencia sobre VictorIA.
11. Si se usa la versión de escritorio con voz: confirmación por Servicios Informáticos de la configuración de voz de los equipos de aula.

**Cambios técnicos pendientes**

1. Cola de eventos con jurisdicción UE, o sustituirla (si la UFV no acepta la configuración actual).
2. Botón de baja de miembros en la consola y borrado de un participante concreto dentro de una sesión.
3. Plazo automático de conservación para los miembros, cuando la UFV lo fije.
4. Trasladar el servicio al dominio definitivo cuando la UFV lo decida. La aplicación antigua de Cloudflare Access ya se retiró de `axyro.qhel.dev`.
