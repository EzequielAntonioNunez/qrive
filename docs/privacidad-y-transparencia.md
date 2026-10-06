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
> Los datos se conservan como máximo 365 días desde que termina la sesión. Puedes ejercer tus derechos ante la UFV en **[Validar UFV: canal de ejercicio de derechos]**. Más información: **[enlace a la segunda capa]**.

### Segunda capa

**Responsable del tratamiento.** Universidad Francisco de Vitoria, **[Validar UFV: datos identificativos y dirección]**. Delegado de Protección de Datos: **[Validar UFV: contacto del DPO]**.

**Qué datos tratamos**

- Datos identificativos: nombre (tal como lo registra el docente) y correo electrónico institucional.
- Datos de acceso: la autenticación la realiza Cloudflare Access con tu cuenta UFV.
- Datos de la actividad: sesión en la que participas, momento en que te unes, opción elegida en cada situación y tiempo empleado en decidir.

**Qué datos no tratamos.** No se graba ni se envía tu voz: el reconocimiento de las palabras «uno», «dos», «tres», «cuatro» y «repetir» se hace en tu propio equipo. No se usa la cámara. No se infieren emociones, estrés, motivación ni otros estados psicológicos.

**Para qué.** Desarrollar la actividad formativa, mostrar a tu docente el desarrollo de la sesión y realizar el debriefing con el grupo. Los resultados no se usan para tomar decisiones automatizadas sobre ti.

**Base jurídica.** **[Validar UFV]** Véase la propuesta de la Parte B, apartado 3.

**Quién accede.** Tu docente y el profesorado con rol de instructor en la plataforma. Al finalizar la sesión, el resto de participantes puede ver el debriefing del grupo con los nombres y las opciones elegidas. Cloudflare, Inc. presta la infraestructura como encargado del tratamiento.

**Dónde se tratan.** En la infraestructura de Cloudflare. La base de datos principal se aloja en la Unión Europea. Algunos componentes del servicio pueden tratar datos fuera de la UE **[Validar UFV: texto final según la Parte B, apartado 4]**.

**Cuánto tiempo.** Hasta 365 días desde la finalización de la sesión, salvo que tu docente la elimine antes.

**Tus derechos.** Acceso, rectificación, supresión, oposición, limitación y portabilidad, ante la UFV en **[Validar UFV]**. También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).

**Cookies.** El acceso usa una cookie técnica de autenticación de Cloudflare Access, necesaria para el funcionamiento del servicio. No se usan cookies analíticas ni publicitarias.

---

## Parte B · Nota técnica para el DPO

### 1. Descripción del sistema

| Componente | Función | Tecnología |
|---|---|---|
| Control de acceso | Autentica a cada usuario antes de llegar a la aplicación. | Cloudflare Access (Zero Trust). La aplicación verifica la firma del token de Access en cada petición a la API. |
| API | Lógica de sesiones, miembros, escenarios, exportación y borrado. | Cloudflare Workers. |
| Estado vivo de cada sesión | Participantes, decisiones, indicadores y reloj mientras la sesión está activa. | Cloudflare Durable Objects (un objeto por sesión). |
| Base de datos | Organización, usuarios, roles, sesiones, eventos, escenarios y auditoría. | Cloudflare D1. |
| Cola de eventos | Traslada los eventos de la sesión a la base de datos. | Cloudflare Queues. |
| Almacenamiento de ficheros | Ficheros del simulador (programa WebGL). No contiene datos personales. | Cloudflare R2. |
| Consola web | Interfaz del docente. | Aplicación web servida por el mismo dominio. |
| Simulador | Cliente del participante (personaje, voz, interacción). | Unity WebGL en el navegador, servido por el mismo dominio y protegido por Access. |

No hay llamadas a proveedores de inteligencia artificial durante el uso: los textos del personaje están escritos en el escenario y las locuciones son ficheros de audio generados de antemano. El cliente no contiene claves de servicios de IA y la funcionalidad de personajes con IA está desactivada.

**Organización (tenant).** Todos los datos pertenecen a una organización; la UFV es una organización separada y cada consulta a la base de datos filtra por organización.

### 2. Inventario de datos personales

Verificado en el código y en el esquema de base de datos del MVP.

| Dato | Dónde se guarda | Origen | Finalidad | Acceso |
|---|---|---|---|---|
| Correo electrónico institucional | D1, tabla de usuarios | Alta por el docente; el correo del token de Access se usa para identificar al usuario en cada petición. | Identificación y control de acceso. | Instructores de la organización (lista de miembros). |
| Nombre visible | D1, tabla de usuarios; copia en el estado de la sesión (Durable Object) | Alta por el docente. | Mostrar quién participa y el debriefing. | Instructores; participantes de la organización (ver nota 1). |
| Rol (instructor o participante) | D1, tabla de miembros | Alta por el docente. | Autorización. | Instructores. |
| Identificador interno del usuario (UUID aleatorio) | D1 (usuarios, eventos, auditoría), Durable Object, cola de eventos | Generado por el sistema. | Seudonimización de eventos y auditoría. | Instructores; sistema. |
| Unión a la sesión y hora | Durable Object; evento en D1 | Simulador. | Desarrollo de la sesión. | Instructores; participantes de la organización (nota 1). |
| Decisión por fase, hora y tiempo empleado (ms) | Durable Object; evento en D1 | Simulador. | Indicadores, informe y debriefing. | Instructores; participantes de la organización (nota 1). |
| Texto de incidentes (escrito por el docente) | Durable Object; evento en D1; cola | Consola. | Desarrollo de la sesión. | Instructores; participantes (nota 1). Puede contener datos personales si el docente los escribe (nota 2). |
| Registro de auditoría | D1, tabla de auditoría | Sistema. | Trazabilidad: creación, control, exportación y borrado de sesiones, altas de miembros, publicación de escenarios. Solo IDs seudónimos. | Equipo técnico (no se muestra en la consola). |
| Datos de autenticación de Access (correo, proveedor de identidad, IP, fecha) | Cloudflare Access | Inicio de sesión. | Control de acceso y seguridad. | Administradores de la cuenta de Cloudflare. |
| Registros técnicos del servicio | Cloudflare Workers | Sistema. | Diagnóstico y seguridad. Incluyen el UUID del usuario en avisos de límite de peticiones; no incluyen nombre ni correo. | Equipo técnico. |

**Lo que no se trata:** audio o grabaciones de voz, imagen o vídeo, datos biométricos, emociones o estados psicológicos, ubicación, pulsaciones de teclado o movimientos del ratón fuera de la elección de opción.

**Seudonimización.** Los eventos de simulación y los mensajes de la cola solo contienen identificadores aleatorios (organización, sesión, usuario), nunca nombres ni correos. La identidad se resuelve únicamente en la consola del docente.

**Nota 1 · Visibilidad entre participantes.** **[Pendiente técnico] [Validar UFV]** En la versión actual, cualquier usuario autenticado de la organización (también un participante) puede consultar a través de la API la lista de sesiones de la organización y el estado de cualquiera de ellas, que incluye los nombres de los participantes y sus decisiones. La consola muestra el debriefing con nombres a los participantes cuando la sesión termina. Se recomienda restringir el acceso de cada participante a las sesiones en las que participa, o decidir expresamente que el debriefing nominal es visible para el grupo e informarlo.

**Nota 2 · Texto libre.** El texto de los incidentes es libre (máximo 200 caracteres). La guía docente indica no introducir datos personales.

### 3. Finalidad y base jurídica sugerida

**Finalidad:** desarrollo de actividades formativas de simulación y toma de decisiones, seguimiento de la sesión por el docente y debriefing con el grupo.

**Propuesta de base jurídica (RGPD, art. 6.1) · [Validar UFV]**

| Supuesto | Base sugerida | Comentario |
|---|---|---|
| Actividad integrada en una asignatura o plan de estudios | Art. 6.1.b: ejecución de la relación académica derivada de la matrícula. | Encaja si la actividad forma parte de la docencia. El DPO puede valorar alternativamente el art. 6.1.e en la medida en que la normativa universitaria lo ampare. |
| Formación del personal (PDI, PTGAS) | Art. 6.1.b (relación laboral) o 6.1.f (interés legítimo en la formación). | Si se usa 6.1.f, documentar la ponderación. |
| Actividades voluntarias, pilotos o investigación sobre la propia herramienta | Art. 6.1.a (consentimiento) o 6.1.f. | El consentimiento solo es válido si la participación es realmente libre y existe alternativa sin perjuicio. |

**No se recomienda** basar en el consentimiento las actividades obligatorias de una asignatura, por el desequilibrio entre la universidad y el estudiante.

**Uso del informe en la calificación · [Validar UFV].** El informe calcula puntuaciones con reglas fijas del escenario. Si una actividad es evaluable, la calificación debe decidirla el docente con su criterio; el informe no debe ser la única base (art. 22 RGPD).

**Evaluación de impacto (EIPD) · [Validar UFV].** Valorar si es necesaria. Elementos a considerar: tratamiento de datos de estudiantes en un contexto de evaluación, uso de una tecnología nueva y volumen previsto. Elementos que reducen el riesgo: minimización, ausencia de biometría y de perfilado, seudonimización de eventos y plazo de conservación limitado.

### 4. Ubicación de los datos y transferencias

| Componente | Ubicación configurada | Datos personales | Estado |
|---|---|---|---|
| D1 (base de datos) | Unión Europea, según la configuración de la cuenta documentada por el equipo técnico. | Sí: correo, nombre, rol, eventos seudonimizados, auditoría. | **[Validar UFV]** Comprobar en el panel de Cloudflare que la base de datos está en la jurisdicción UE. |
| R2 (ficheros) | Jurisdicción UE (configurada en el despliegue). | No: solo los ficheros del simulador. | Correcto. |
| Durable Objects (estado de cada sesión) | **Sin jurisdicción UE configurada.** Cloudflare sitúa cada objeto cerca de la primera petición, normalmente en Europa para usuarios en España, sin garantía de permanencia en la UE. | Sí: nombres de participantes, decisiones y tiempos. | **[Pendiente técnico]** Crear los objetos de sesión con jurisdicción UE. |
| Queues (cola de eventos) | **Sin jurisdicción UE**: la API de Cloudflare rechazó la opción UE al crear la cola. | Solo identificadores seudónimos y eventos; puede incluir el texto de incidentes. | **[Pendiente técnico]** Crear la cola con jurisdicción UE cuando esté disponible o sustituirla por escritura directa en D1. |
| Workers (ejecución de la API) | Red global de Cloudflare: cada petición se procesa en el centro de datos más cercano al usuario. | En tránsito, durante la petición. | **[Validar UFV]** Valorar si se requiere restringir el procesamiento a la UE (servicios regionales de Cloudflare). |
| Cloudflare Access | Servicio global de Cloudflare. | Correo, IP y datos de autenticación. | **[Validar UFV]** Revisar plazo de conservación de los registros de Access. |

Cloudflare, Inc. es una empresa con sede en Estados Unidos. Las transferencias internacionales que pudieran producirse están cubiertas, según Cloudflare, por su adhesión al Marco de Privacidad de Datos UE-EE. UU. y por cláusulas contractuales tipo en su acuerdo de tratamiento de datos. **[Validar UFV]** Confirmar con la documentación vigente de Cloudflare.

### 5. Plazos de conservación

Verificado en el código y la configuración del despliegue:

- **Sesiones:** una tarea programada se ejecuta **cada día a las 03:17 UTC** y borra las sesiones **finalizadas** hace más de **365 días** (valor configurable en el despliegue). Borra el estado de la sesión, sus eventos y la propia sesión, y anota el borrado en la auditoría. Procesa hasta 200 sesiones por ejecución.
- **Sesiones no finalizadas:** **no** se borran automáticamente. **[Pendiente técnico] [Validar UFV]** Definir un plazo también para sesiones abandonadas (por ejemplo, contado desde su creación).
- **Usuarios y miembros** (correo, nombre, rol): **no tienen plazo ni procedimiento de borrado** en el MVP. **[Pendiente técnico] [Validar UFV]** Definir el plazo (por ejemplo, fin del curso académico) e implementar la baja de miembros.
- **Auditoría:** se conserva sin plazo. Solo contiene identificadores seudónimos. **[Validar UFV]** Fijar el plazo de conservación de la auditoría.
- **Ficheros exportados** (CSV o JSON descargados por el docente): quedan fuera del sistema, bajo la responsabilidad del docente. **[Validar UFV]** Indicar dónde deben guardarse y cuándo borrarse.
- **Copias de seguridad:** D1 mantiene recuperación a un momento anterior durante un periodo limitado gestionado por Cloudflare; un dato borrado puede permanecer en ese histórico hasta que caduca. **[Validar UFV]** Confirmar el periodo con la documentación de Cloudflare.

### 6. Derechos de los interesados

| Derecho | Cómo se atiende en el MVP | Estado |
|---|---|---|
| Acceso y portabilidad | El instructor descarga la sesión completa en JSON (estado, participantes, decisiones, eventos e informe) o el debriefing en CSV. La exportación queda en la auditoría. | Disponible. Hay que extraer del fichero solo los datos de la persona solicitante. |
| Supresión | El instructor elimina una sesión completa («Eliminar sesión»): se borran el estado y los eventos; solo queda una anotación en la auditoría. | Disponible por sesión. **[Pendiente técnico]** No se puede borrar a un único participante de una sesión ni dar de baja a un miembro de la organización desde la consola. |
| Rectificación | — | **[Pendiente técnico]** Volver a dar de alta un correo existente no actualiza el nombre. Hoy requiere intervención técnica. |
| Oposición y limitación | Se atiende de forma organizativa (no incluir a la persona en sesiones). | **[Validar UFV]** Procedimiento. |
| No ser objeto de decisiones automatizadas | El sistema no toma decisiones sobre las personas. | Mantener en la guía docente que el informe no es la única base de calificación. |

**[Validar UFV]** Canal de ejercicio de derechos, responsable interno y plazo de respuesta.

### 7. Medidas de seguridad

- Autenticación previa con Cloudflare Access; la API verifica la firma, el emisor y la audiencia del token en cada petición.
- Autorización por rol en el servidor; la identidad y la organización nunca se toman del cliente.
- Separación de organizaciones: todas las consultas filtran por organización.
- Límite de 300 peticiones por minuto y usuario.
- Cifrado en tránsito (HTTPS) y en reposo (gestionado por Cloudflare).
- Credenciales fuera del código fuente; la dirección pública alternativa del servicio está desactivada para que solo se acceda por el dominio protegido.
- Auditoría de acciones de control, exportaciones, borrados, altas de miembros y publicación de escenarios.
- Escenarios publicados inmutables: cualquier cambio crea una versión nueva y cada sesión conserva la versión con la que empezó.

### 8. Encargados del tratamiento

| Entidad | Servicio | Estado |
|---|---|---|
| Cloudflare, Inc. | Infraestructura (Workers, D1, Durable Objects, Queues, R2, Access). | **[Validar UFV]** El servicio está desplegado en una cuenta de Cloudflare de desarrollo cuya titularidad no es de la UFV. Decidir si la cuenta pasa a ser de la UFV (con el acuerdo de tratamiento de Cloudflare a nombre de la UFV) o si se mantiene con un tercero. |
| Desarrollador o proveedor del servicio | Desarrollo, mantenimiento y operación; acceso técnico a los datos. | **[Validar UFV] Pendiente: contrato de encargo de tratamiento (art. 28 RGPD, DPA)**, con la lista de subencargados (Cloudflare). |

### 9. Datos de los participantes en el proceso de voz y personaje

- **Voz del participante:** el reconocimiento por palabras clave («uno», «dos», «tres», «cuatro», «repetir») se ejecuta en el equipo del participante. No se graba, no se almacena y no se envía audio al servidor; solo se envía la opción elegida, igual que con un clic. **[Validar UFV]** Servicios Informáticos debe confirmar que la configuración de voz de los equipos de aula no envía audio a servicios externos.
- **Voz de VictorIA:** ver Parte C.

---

## Parte C · Transparencia sobre inteligencia artificial (Reglamento Europeo de IA)

### 1. Qué es VictorIA

VictorIA es un **personaje virtual**. En el MVP no es un sistema de IA que converse: sus intervenciones son textos fijos escritos en cada escenario y reproducidos con locuciones generadas de antemano. No genera respuestas en tiempo real ni se adapta al participante.

- **Imagen:** modelo 3D provisional de una biblioteca abierta de personajes ficticios (Microsoft Rocketbox, licencia MIT). No representa a una persona real. El personaje definitivo está pendiente de producción.
- **Voz:** sintética, generada **una sola vez y sin conexión** con modelos de código abierto:
  - Motor de síntesis Chatterbox Multilingual (Resemble AI, licencia MIT), que **incorpora una marca de agua inaudible** (Perth) que permite identificar el audio como generado por IA.
  - El timbre parte de una voz de referencia **también sintética** (Kokoro-82M, voz `ef_dora`, licencia Apache 2.0). **No se ha clonado la voz de ninguna persona real.**
  - En tiempo de ejecución no hay ningún servicio ni clave de IA.
- **Evolución prevista:** si la voz final se graba con una locutora profesional, se hará con contrato y **consentimiento expreso** para ese uso, y se actualizará este documento.

### 2. Qué no hace el sistema

- **No infiere emociones, estrés, nerviosismo, motivación ni estados psicológicos**, ni por cámara, ni por voz, ni por biometría. No usa la cámara y no analiza la voz más allá de reconocer cinco palabras clave en el propio equipo. (Este tipo de reconocimiento de emociones está prohibido en contextos educativos y laborales por el art. 5.1.f del Reglamento de IA.)
- **No evalúa a las personas.** Cada opción del escenario lleva una valoración de diseño (*Mejor opción*, *Aceptable* o *Crítica*) que se refiere a la decisión según la buena práctica que enseña el escenario. El informe aplica reglas fijas y transparentes (indicadores, porcentajes y recuentos), no un modelo de aprendizaje automático.
- **No toma decisiones automatizadas con efectos sobre la persona.** No asigna calificaciones, no decide el acceso a estudios ni detecta conductas. Cualquier decisión académica la toma el docente.

### 3. Obligaciones de transparencia y aviso propuesto

Aunque en el MVP no hay interacción con un sistema de IA en tiempo real, la voz y la imagen de VictorIA son contenido sintético. Se recomienda informar de forma clara antes de la primera interacción.

**[Pendiente técnico] [Validar UFV]** Hoy ni el simulador ni la consola muestran un aviso específico. Texto propuesto para la pantalla inicial del simulador y para la presentación del docente:

> **VictorIA es un personaje virtual.** Su imagen y su voz se han generado por ordenador y sus intervenciones están guionizadas por el equipo docente. No es una persona real ni una inteligencia artificial que converse contigo. No se graba tu voz ni tu imagen.

**Clasificación de riesgo · [Validar UFV].** El MVP no usa IA para evaluar resultados de aprendizaje, decidir el acceso o la admisión, ni vigilar a estudiantes durante pruebas (supuestos de alto riesgo del anexo III, punto 3, del Reglamento de IA). Si en fases posteriores se incorporan personajes conversacionales con IA o evaluación asistida, habrá que revisar esta clasificación, mantener la supervisión humana y actualizar este documento antes de activarlas.

---

## Parte D · Puntos que debe validar la UFV

**Legales y organizativos**

1. Base jurídica para cada tipo de actividad (asignatura, formación del personal, pilotos voluntarios).
2. Necesidad de evaluación de impacto (EIPD).
3. Textos definitivos del aviso de privacidad (primera y segunda capa) y canal de ejercicio de derechos.
4. Titularidad de la cuenta de Cloudflare y acuerdo de tratamiento con Cloudflare.
5. Contrato de encargo de tratamiento (DPA) con el desarrollador o proveedor del servicio.
6. Aceptación de la ubicación actual de los componentes sin jurisdicción UE (Durable Objects, Queues) mientras se corrigen, y de la ejecución global de Workers y Access.
7. Plazos de conservación: sesiones finalizadas (365 días propuestos), sesiones no finalizadas, miembros, auditoría, registros de Access y ficheros exportados.
8. Visibilidad del debriefing nominal entre participantes.
9. Uso del informe en actividades evaluables (nunca como única base de calificación).
10. Texto y ubicación del aviso de transparencia sobre VictorIA.
11. Confirmación por Servicios Informáticos de la configuración de voz de los equipos de aula.

**Cambios técnicos pendientes**

1. Crear los objetos de sesión (Durable Objects) con jurisdicción UE.
2. Cola de eventos con jurisdicción UE, o sustituirla.
3. Baja de miembros, rectificación del nombre y borrado de un participante concreto.
4. Plazo de conservación para sesiones no finalizadas, miembros y auditoría.
5. Limitar a cada participante a las sesiones en las que participa.
6. Mostrar el aviso de transparencia en el simulador.
7. Conectar Cloudflare Access con el proveedor de identidad de la UFV y trasladar el servicio al dominio definitivo.
