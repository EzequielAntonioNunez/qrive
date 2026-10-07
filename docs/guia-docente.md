# Simulador de decisiones UFV · Guía docente

Esta guía explica cómo preparar, dirigir y cerrar una sesión del **Simulador de decisiones** de la Universidad Francisco de Vitoria. Está pensada para el profesorado y el personal que actúa como **docente (instructor)** de una sesión.

> **Estado del documento:** versión para el piloto del MVP, revisada el 7 de octubre de 2026. Los puntos marcados con **[Pendiente UFV]** dependen de decisiones o configuraciones que todavía debe cerrar la Universidad.

---

## 1. Qué es y cómo se organiza

El simulador presenta a un grupo una serie de situaciones en las que hay que tomar una decisión. Una tutora virtual, **VictorIA**, plantea cada situación; cada participante elige una opción y ve su consecuencia. El docente sigue la votación en directo, revela la mejor opción y cierra con un debriefing apoyado en el informe de la sesión.

### 1.1 Superficies

| Superficie | Quién la usa | Para qué |
|---|---|---|
| **Consola web** | Docentes | Preparar y dirigir sesiones. Menú lateral: **Inicio**, **Sesiones** (con **Nueva sesión**), **Analítica**, **Escenarios** y **Participantes y accesos**. Cada sesión tiene su panel con las pestañas **En directo**, **Participantes** e **Informe**. |
| **Proyector** | Docente, en la pantalla del aula | Vista a pantalla completa con el QR y el código de unión, el recuento de votos en directo, la respuesta revelada, los comentarios de VictorIA y la comparación con la media. Solo muestra datos agregados, nunca nombres. Se abre con **Proyectar**. |
| **Vista móvil** | Participantes (móvil, tableta u ordenador) | Unirse con el QR o el código en `/unirse`, escuchar a VictorIA, elegir y ver el resultado en `/jugar/…`. No requiere cuenta ni instalar nada. |
| **Simulador 3D** | Participantes con ordenador (opcional) | VictorIA en 3D, con voz, lip sync y reacciones habladas. Se abre en el navegador desde el enlace de la sesión o con **Abrir en 3D** desde la vista móvil. |
| **Modo IA en vivo (demo)** | Solo docentes | Demostración aparte en la que VictorIA genera situaciones a partir de documentos que sube el docente (apartado 12). No se usa con estudiantes salvo decisión expresa de la UFV. |

La consola no muestra a VictorIA en 3D: el personaje aparece en el simulador 3D; en el móvil y en el proyector aparece con su texto y su voz.

### 1.2 Roles y permisos

- **Propietario de la organización:** es un docente que, además, es el único que puede dar el rol docente a otra persona y crear o revocar códigos de docentes.
- **Docente:** crea sesiones, da de alta participantes y ve **todas las sesiones de su organización**. Lo que puede hacer con cada sesión depende de quién la creó:

| Acción | Quién puede |
|---|---|
| Conducirla: avanzar, pausar, reanudar, finalizar, lanzar incidentes, ajustar indicadores | Solo el docente que la creó. |
| Simular clase / Quitar simulados | Solo el docente que la creó. |
| Regenerar el código de unión (PIN) | En la consola, el docente que conduce la sesión. |
| Renombrar, exportar datos (JSON) y eliminar | El docente que la creó; si ya no es miembro de la organización, cualquier otro docente. |
| Duplicar | Cualquier docente de la organización. |
| Ver la sesión, su informe, el proyector, el QR y el código | Cualquier docente de la organización (la consola avisa de que la conduce otro docente). |
| Analítica y «Comparar con la media» | Cualquier docente de la organización. |

- **Participante con cuenta:** persona dada de alta con su correo y un código personal. Solo ve sus propias decisiones, indicadores y resultados, y solo las sesiones a las que se ha unido.
- **Invitado:** entra con el código de seis cifras de una sesión y un **alias**, sin correo ni cuenta. Solo puede usar esa sesión (cualquier otra acción responde «Acceso de invitado limitado a su sesión.») y su acceso caduca (apartado 14). Recibe la misma vista filtrada que cualquier participante.

Ningún participante ve los nombres, alias, decisiones ni resultados de sus compañeros.

---

## 2. Antes de la sesión

### 2.1 Requisitos

**Dos formas de entrar para los participantes:**

| Modo | Cómo entra | Cuándo usarlo |
|---|---|---|
| **Invitado (recomendado en el aula)** | Escanea el QR o abre `/unirse`, teclea el código de seis cifras de la sesión y elige un alias. | Clases presenciales, demostraciones y grupos sin alta previa. No hace falta dar de alta a nadie. |
| **Con cuenta** | Abre el enlace del simulador e introduce su correo y su código personal de seis cifras. | Cuando se quiera identificar a cada persona por su nombre o que vea sus sesiones en «Mis sesiones». Requiere alta previa (apartado 4). Se admite cualquier dominio de correo. |

**Voz (opcional):**

- Los participantes pueden responder hablando si el servicio de voz está configurado. Antes de abrir el micrófono se muestra un aviso: la voz se transcribe con **Soniox en Estados Unidos** (transferencia internacional) y no se guarda el audio. Solo se activa si la persona pulsa **Aceptar y activar**; siempre se puede responder tocando la opción.
- Las órdenes cortas («la dos», «opción B») se resuelven en el propio navegador. Si la persona explica su respuesta con sus palabras, la frase se envía a **Clef**, un modelo de decisión de Cloudflare Workers AI que solo la asigna a una de las opciones existentes y pide confirmación si duda; no genera texto ni valora a nadie.

**Equipos:**

- **Participantes:** móvil o tableta con navegador actualizado (para la vista móvil), u ordenador con Chrome o Edge (para el simulador 3D). Auriculares o el altavoz del dispositivo si se quiere oír a VictorIA.
- **Aula:** un ordenador conectado al proyector y, si VictorIA va a comentar los resultados en voz alta, con salida de audio a la sala.
- **Red:** la vista móvil y el proyector se actualizan en directo por WebSocket; si la red lo bloquea, siguen funcionando con consultas periódicas.

### 2.2 Dirección de acceso

Entra en la dirección provisional del entorno (pendiente del dominio definitivo de la UFV) e introduce tu correo y tu código personal en la pantalla **Accede con tu código**.

**[Pendiente UFV]** Está previsto trasladar el servicio a un dominio definitivo de la Universidad; cuando ocurra, se actualizará esta guía. Mientras tanto, el bloque del QR no muestra la dirección escrita: el QR la contiene y el docente puede copiarla con **Copiar enlace de unión**.

### 2.3 Preparación recomendada (15 minutos)

1. Revisa el escenario en **Escenarios**: situaciones, opciones, valoración, «por qué» e idea clave (los participantes no ven la valoración hasta que deciden).
2. Si vas a usar cuentas, da de alta y genera los códigos con antelación (apartado 4), no en el aula.
3. Haz una prueba con **Demo rápida** (apartado 11) en el equipo del aula: proyector, audio y, si procede, la voz de VictorIA. Elimina después esa sesión.
4. Decide la dinámica: un dispositivo por persona, o uno por pequeño grupo que decide en común.
5. Ten preparado el guion de debriefing (apartado 8).

---

## 3. Crear y gestionar sesiones

### 3.1 Nueva sesión (asistente en tres pasos)

Pulsa **Nueva sesión** (menú lateral, Inicio o Sesiones) o **Crear sesión** desde un escenario.

1. **Escenario:** elige uno del catálogo. **Ver situaciones** muestra su contenido sin valoraciones. Hoy el catálogo incluye:
   - **Uso responsable de la IA en la universidad** (por defecto): tres situaciones de 3 minutos (*Datos personales*, *Verificación* y *Evaluación justa*). Indicadores: **Confianza**, **Productividad** y **Riesgo**.
   - **IA generativa en la docencia**: tres situaciones de 3 minutos (*Actividad evaluable con IA*, *Feedback asistido por IA* y *Materiales y derechos de autor*). Indicadores: Aprendizaje, Eficiencia y Riesgo.
   - **IA en la atención al estudiante**: tres situaciones de 3 minutos (*Respuesta errónea del asistente*, *Sesgo en la priorización de becas* y *Transparencia ante el estudiante*). Indicadores: Confianza, Agilidad y Riesgo.
   - **Renegociación con un proveedor estratégico**: tres fases de 8, 5 y 4 minutos. Indicadores: Relación, Margen y Riesgo.
2. **Detalles:** nombre de la sesión, opcional (hasta 80 caracteres; por ejemplo, «Ética de la IA · 3.º Derecho · Grupo A»). Si lo dejas vacío, se muestra el escenario y la fecha. No escribas nombres de estudiantes.
3. **Listo:** enlace para participantes con cuenta, bloque **Únete desde el móvil** (QR y código) y botones **Abrir panel de la sesión** y **Proyectar en clase**.

Cada sesión guarda una copia del escenario con el que empezó: si se publica una versión nueva, las sesiones ya creadas no cambian.

### 3.2 Listado de sesiones

En **Sesiones** verás todas las sesiones de la organización:

- **Buscar** por nombre, escenario o docente; **filtros** *Todas*, *En curso*, *En pausa*, *Finalizadas* y *Mías*; **Ordenar** por más recientes, más antiguas, nombre o estado.
- **Selección múltiple** (solo de tus sesiones): **Finalizar**, **Eliminar** o **Quitar selección**. Antes de cerrar o borrar se pide confirmación.
- **Menú de cada fila:** Abrir, Proyectar en clase, Copiar enlace para participantes, Pausar o Reanudar, Finalizar, Ver informe y, en el bloque inferior, **Renombrar**, **Duplicar**, **Exportar datos (JSON)** y **Eliminar**. Solo aparecen las acciones que te corresponden (apartado 1.2).

**Inicio** resume las sesiones en curso, las finalizadas recientemente y unos indicadores de la organización; desde cada tarjeta se puede abrir, proyectar, pausar o finalizar.

### 3.3 Escenarios y «Tus escenarios»

**Escenarios** muestra el catálogo de la UFV y, si tu organización ha publicado escenarios propios, el grupo **Tus escenarios**. Los escenarios convertidos desde el Modo IA llevan la marca **Creado con IA · revisado por …** (apartado 12.3) y no tienen locución grabada: VictorIA aparece como texto.

---

## 4. Participantes y accesos

Solo hace falta si vas a usar el acceso con cuenta. En **Participantes y accesos**:

1. Pulsa **Dar de alta** e introduce **Nombre y apellidos**, **Correo electrónico** (de cualquier dominio) y, si eres propietario, el **Rol**. Deja marcada **Generar su código de acceso ahora** para obtener el código al momento.
2. Copia las seis cifras del código y entrégaselas a la persona por un canal privado. **El código solo se muestra una vez.**

En la tabla, el menú de cada persona ofrece:

- **Generar código** o **Generar código nuevo**: el código anterior deja de funcionar y se cierran las sesiones abiertas con él.
- **Revocar código**: desactiva el acceso.
- **Dar de baja**: retira a la persona de la organización y revoca su código; si no pertenece a otra organización, se borran su nombre y su correo. Sus decisiones en sesiones pasadas se conservan con un identificador seudónimo. No se puede deshacer.

El panel **Últimos accesos** muestra los diez accesos más recientes (correctos o con un código revocado) y la columna **Código** indica cuántas veces se ha usado.

Ten en cuenta:

- El alta **no envía ningún correo**: tú entregas el código y el enlace.
- El correo debe coincidir con el que la persona escribirá al entrar.
- El nombre es el que verás en la sesión, en el informe y en las exportaciones. **Usa solo el nombre necesario** (por ejemplo, nombre y primer apellido).
- **Corregir un nombre:** vuelve a dar de alta a la persona con el mismo correo y el nombre correcto.
- Cada persona pertenece a una sola organización: si el correo ya es de otra, el alta se rechaza («Ese correo no se puede dar de alta en esta organización.»).
- No se puede dar de baja al propietario ni al último docente, ni darte de baja a ti mismo.

---

## 5. Invitar a la clase

### 5.1 «Únete desde el móvil» (camino principal en el aula)

El bloque **Únete desde el móvil** aparece en el último paso del asistente, en la pestaña **En directo** de la sesión y en el proyector (tecla **Q**). Contiene:

- **QR** con el enlace de unión de la sesión.
- **Código de seis cifras** (por ejemplo, «483 920»), para quien prefiera teclearlo en `/unirse`.
- **Regenerar código**: invalida el código actual y crea otro (pide confirmación). Úsalo si el código se ha difundido fuera del aula.
- **Copiar enlace de unión**: copia el enlace del QR para pegarlo en el aula virtual o el chat.

Cada participante escanea el QR, escribe un alias y pulsa **Entrar**. El código deja de valer al finalizar la sesión.

Recomienda a los participantes un **alias sin datos personales** (por ejemplo, el nombre de pila, unas iniciales o «Mesa 3»). El alias aparece en tu consola, en el informe y en las exportaciones; nunca en el proyector ni a los compañeros. Si dos personas eligen el mismo alias, el segundo pasa a ser «Ana 2».

### 5.2 Simulador 3D

En **En directo**, el bloque **Simulador 3D en el ordenador** ofrece **Copiar enlace** y **Abrir simulador**:

- Los participantes con cuenta abren el enlace e introducen su correo y su código; se unen automáticamente.
- Los invitados pueden pasar al 3D con **Abrir en 3D** desde la vista móvil (solo en ordenador o tableta). La primera carga descarga unos 38 MB; las siguientes salen de la caché del navegador.
- Si tú abres el enlace, entras como **observador** («Estás viendo la sesión como docente»): no cuentas como participante.

La consola indica si hay un simulador 3D conectado («Simulador abierto»).

### 5.3 Llegadas tarde

Un participante puede unirse **en cualquier situación** mientras la sesión no haya finalizado. Empieza en la situación en curso, con los indicadores iniciales y sin decisiones previas; las situaciones anteriores no las puede responder.

---

## 6. Dirigir la sesión

### 6.1 El reloj de cada situación

- El reloj de la primera situación **empieza cuando se une el primer participante**, no al crear la sesión.
- En cada situación nueva el reloj se reinicia con su tiempo.
- Al **pausar**, el reloj se congela y nadie puede decidir; al **reanudar**, continúa desde donde estaba.
- Si el tiempo **se agota**, el indicador de Riesgo sube (8 o 10 puntos según la situación) **a quien aún no había decidido** y queda registrado. **La situación no avanza sola** y se puede seguir decidiendo, también desde el móvil («Se acabó el tiempo de esta situación: puedes decidir igualmente.»); esas decisiones aparecen en el informe y en el CSV como tomadas tras agotarse el tiempo.

### 6.2 Controles del docente

La barra de acciones de la sesión y el proyector ofrecen estos controles (solo al docente que creó la sesión):

| Control | Qué hace | Cuándo usarlo |
|---|---|---|
| **Siguiente situación** | Abre la siguiente situación. Requiere al menos una decisión en la actual. | Cuando la mayoría ha decidido o se agota el tiempo previsto. |
| **Pausar / Reanudar** | Congela la sesión y el reloj. | Para aclarar una duda, abrir un debate a mitad de situación o resolver un problema técnico. |
| **Finalizar** | Cierra la sesión **en cualquier momento** y fija el informe. Si quedan situaciones por jugar, pide confirmación («¿Finalizar la sesión antes de tiempo?») y el informe refleja solo las trabajadas. En la última situación el botón se llama **Finalizar sesión**. | Al terminar la última situación, o antes si falta tiempo de clase. |
| **Herramientas del docente → Lanzar un incidente** | Añade un acontecimiento imprevisto (texto de hasta 200 caracteres) con un efecto en Riesgo de −10, −5, +5, +10 o +15 (+5 por defecto). Afecta a toda la clase y queda en el registro de actividad. | Para introducir presión o un giro («El vicerrectorado pide el informe hoy mismo»). |
| **Herramientas del docente → Ajustar un indicador de la clase** | Fija uno de los tres indicadores entre 0 y 100 para todos. Queda registrado. | Para preparar una situación concreta o corregir un desajuste. Con moderación. |
| **Simular clase / Quitar simulados** | Añade o retira 20 participantes simulados (apartado 11). | Solo para demostraciones y pruebas. |
| **Proyectar** | Abre el proyector a pantalla completa. | Siempre que proyectes en el aula. |

**No escribas datos personales en los incidentes** (nombres de estudiantes, casos reales identificables): los participantes lo ven y el texto se guarda en la sesión y en las exportaciones.

### 6.3 El proyector

Proyecta siempre el **proyector**, no la consola: la consola muestra nombres y alias, el proyector solo datos agregados.

- **Barra superior:** **Únete (QR)**, **Voz de VictorIA**, **Pausar** / **Reanudar** y **Finalizar** (estos tres, solo para el docente que conduce la sesión), **Pantalla completa** y **Salir**.
- **Teclas:** **Q** muestra u oculta el panel **Únete (QR)**; **V** activa o desactiva la **Voz de VictorIA**; **Esc** corta primero el comentario de VictorIA o la comparación y, después, cierra el proyector.
- Mientras la situación está abierta se ven las opciones, el porcentaje y el número de votos, el anillo de cuántos han decidido y el reloj. **Ninguna valoración se muestra hasta revelar la respuesta.**
- **Mostrar respuesta** (cuando ya hay votos) resalta la **Mejor opción** y muestra la **idea clave**. La respuesta también se revela al avanzar, al finalizar o al agotarse el tiempo.
- Al avanzar, el proyector se queda en la situación que acaba de cerrarse para comentarla; **Ver situación N →** lleva a la nueva. La barra inferior permite repasar situaciones anteriores.
- El docente que conduce la sesión tiene además, en el lateral, **Mostrar respuesta**, **Siguiente situación →** y, en la última, **Finalizar sesión**. **Finalizar** pide la misma confirmación que en la consola si se cierra antes de tiempo.
- **Comparar con la media** abre la tarjeta **Vuestra clase frente a la media**: el porcentaje de decisiones óptimas de la clase frente a la media de las demás sesiones de la organización de los últimos 365 días. Se abre sola al finalizar la sesión con el proyector abierto. Si no hay otras sesiones con datos, indica «Primera sesión de la organización: aún no hay media con la que comparar». Solo datos de grupo.

### 6.4 Cómo leer los indicadores

- Cada participante tiene **sus propios indicadores**: los cambian sus decisiones, el tiempo agotado cuando aún no había decidido, los incidentes y tus ajustes.
- En la consola ves la **media de la clase**; cada participante ve solo los suyos.
- Cada participante decide **una vez por situación** y no puede cambiar su respuesta. Hasta que decide, no ve la valoración de las opciones ni la idea clave.
- En el escenario por defecto: **Confianza** (de la comunidad universitaria en el trabajo realizado), **Productividad** (tiempo y esfuerzo) y **Riesgo** (legal, reputacional o de injusticia). Riesgo alto es malo.

---

## 7. El informe y el debriefing

### 7.1 Dónde está

- **En directo → Qué se decidió y por qué:** decisiones agrupadas por situación, con cuántos participantes eligieron cada opción, su consecuencia, su valoración, el «por qué» y la idea clave. El botón **CSV** descarga el detalle (una fila por decisión, con el nombre o alias del participante, separador «;», se abre directamente en Excel).
- **Pestaña Participantes:** cada persona con su situación actual, última actividad, puntuación, decisiones óptimas y críticas. **Excluir simulados de las estadísticas** quita la clase simulada de los cálculos.
- **Pestaña Informe** (*Informe provisional* mientras la sesión sigue abierta): el **informe de impacto** maquetado para A4. **Descargar PDF** abre el diálogo de impresión; elige «Guardar como PDF». **Excluir simulados** aparece si la sesión tuvo clase simulada.

El PDF incluye la tabla **Resultados por participante con sus nombres o alias**: trátalo como un documento con datos personales (apartado 14).

### 7.2 Qué mide

El informe de la consola es el **de la clase**: la puntuación y los objetivos se calculan con la media de los indicadores, y el resto con todas las decisiones. **Resultados por participante** aplica el mismo cálculo a cada persona. Cada participante ve solo su informe individual.

| Indicador | Cómo se calcula |
|---|---|
| **Puntuación /100** | Media de los dos primeros indicadores y de (100 − Riesgo). |
| **Decisiones óptimas** | Porcentaje de decisiones que el escenario valora como *Mejor opción*. |
| **Tiempo de reacción** | Porcentaje medio de tiempo que quedaba en la situación al decidir (en el CSV). |
| **Objetivos** | Tres: los dos primeros indicadores ≥ 55 y Riesgo ≤ 40. |
| **Decisiones críticas** | Número de decisiones valoradas como *Crítica*. |
| **Tiempos agotados** | En la clase, situaciones en las que venció el reloj; en el individual, las que vencieron sin que la persona hubiera decidido. |

El informe de impacto añade la distribución de votos por situación, las decisiones más frecuentes, las ideas clave y una nota metodológica. Si la sesión se finalizó antes de tiempo, las situaciones no jugadas aparecen como «Sin jugar».

### 7.3 Cómo usarlo bien

- La valoración es **de la decisión según el diseño del escenario, no de la persona**. Preséntala así: «esta opción es la que mejor protege…», nunca «has suspendido».
- En las sesiones el resultado se calcula con **reglas fijas del escenario**: no interviene ningún modelo de IA en la valoración. El sistema **no mide emociones, estrés ni estados psicológicos**, y no observa por cámara ni analiza la voz.
- El informe es un apoyo para la conversación. **No lo uses como única base para calificar** a nadie: si la actividad es evaluable, la valoración la haces tú con tu criterio.
- Para comentar con el grupo usa el **proyector** o el informe sin la tabla de participantes; no proyectes la consola, que muestra nombres y alias.

---

## 8. Guion de debriefing (10 minutos) · «Uso responsable de la IA en la universidad»

**Objetivo:** que el grupo formule con sus palabras tres reglas prácticas: proteger los datos personales, verificar lo que produce la IA y no delegar en un detector una decisión que afecta a una persona.

**Material:** el proyector con la respuesta revelada en cada situación (o el informe sin nombres) y una pizarra para anotar las tres reglas.

| Minuto | Bloque |
|---|---|
| 0:00 – 1:00 | Apertura |
| 1:00 – 3:30 | Situación 1 · Datos personales |
| 3:30 – 6:00 | Situación 2 · Verificación |
| 6:00 – 8:30 | Situación 3 · Evaluación justa |
| 8:30 – 10:00 | Cierre y compromiso |

### 0:00 – 1:00 · Apertura

- «¿Con qué palabra describiríais la sesión?» (ronda rápida, sin debatir).
- Muestra la tarjeta **Vuestra clase frente a la media** o la puntuación de la clase. Recuerda que valoramos decisiones, no personas, y que no hay preguntas trampa: las tres situaciones son reales y frecuentes.

### 1:00 – 3:30 · Situación 1: Datos personales

*VictorIA quiere pegar en un chat de IA la hoja con las notas y comentarios de 120 alumnos para redactar informes individuales.*

| Opción | Valoración del escenario |
|---|---|
| Anonimizar los datos y usar solo la herramienta de IA autorizada por la universidad | Mejor opción |
| Renunciar a la IA y redactar todos los informes a mano | Aceptable |
| Pegar la hoja completa en un chat de IA público | Crítica |

Preguntas para el grupo:

1. ¿Qué opción elegisteis la mayoría y qué os hizo decidir?
2. ¿Qué datos de esa hoja son personales? ¿Bastaría con quitar los nombres o hay otros datos que permiten identificar a un alumno?
3. ¿Qué diferencia hay entre una herramienta de IA autorizada por la universidad y un chat público? ¿Sabéis cuál está autorizada en la UFV?
4. Quien eligió hacerlo a mano: ¿qué se pierde y qué se gana? ¿Es «no usar IA» siempre lo más responsable?

**Idea clave:** antes de pegar nada, pregúntate de quién son los datos y adónde van. Anonimiza y usa solo herramientas autorizadas.

### 3:30 – 6:00 · Situación 2: Verificación

*La IA ha resumido la nueva normativa de evaluación con tres referencias legales; el resumen va al claustro esta tarde.*

| Opción | Valoración del escenario |
|---|---|
| Comprobar cada referencia en la fuente oficial antes de enviarlo | Mejor opción |
| Enviarlo como borrador generado con IA pendiente de revisión | Aceptable |
| Pedir a la misma IA que confirme que las referencias son correctas | Crítica |
| Enviarlo tal cual: la IA suele acertar | Crítica |

Preguntas para el grupo:

1. ¿Por qué un texto que «suena muy convincente» puede ser incorrecto? ¿Os ha pasado?
2. ¿Por qué no sirve pedir a la misma IA que se verifique a sí misma?
3. Avisar de que es un borrador hecho con IA es transparente. ¿Es suficiente? ¿A quién le corresponde verificar?
4. ¿Cuáles son las fuentes oficiales que usaríais para comprobar una referencia normativa?

**Idea clave:** quien firma, responde. La IA propone; la verificación en la fuente es tuya.

### 6:00 – 8:30 · Situación 3: Evaluación justa

*Un detector dice que un trabajo de fin de grado tiene un 80 % de probabilidad de estar escrito con IA. La guía docente permite usar IA si se declara.*

| Opción | Valoración del escenario |
|---|---|
| Revisar el trabajo, hablar con el alumno y aplicar la guía docente | Mejor opción |
| Ignorarlo: no hay forma de saberlo | Crítica |
| Suspender basándote solo en el detector | Crítica |

Preguntas para el grupo:

1. ¿Qué significa realmente un «80 % de probabilidad»? ¿Es una prueba?
2. ¿Qué derechos tiene el estudiante antes de que se tome una decisión que le afecta?
3. Si la guía docente permite usar IA declarándolo, ¿qué deberíamos comprobar exactamente?
4. ¿Por qué ignorarlo tampoco es neutral?

**Idea clave:** un detector es un indicio, no una prueba. Las decisiones que afectan a una persona las toma una persona, con evidencias y con garantías.

### 8:30 – 10:00 · Cierre y compromiso

- Pide al grupo que dicte las tres reglas y escríbelas en la pizarra (por ejemplo: *anonimiza y usa herramientas autorizadas*; *verifica en la fuente antes de compartir*; *no decidas sobre personas solo con un detector*).
- Pregunta: «¿Qué vais a hacer distinto la próxima semana?». Una respuesta por persona o por grupo.
- Si quedó tiempo agotado en alguna situación, coméntalo en positivo: en la vida real también se decide con prisa, y por eso conviene tener reglas claras de antemano.

---

## 9. Analítica

**Analítica** (menú lateral) muestra cómo decide la clase **en conjunto** en tu organización. Cualquier docente puede consultarla.

- **Filtros:** periodo (*Últimos 30 días*, *Últimos 90 días*, *Últimos 12 meses* o *Todo*), escenario e **Incluir clases simuladas** (desactivado por defecto).
- **Bloques:** totales (sesiones, participantes, decisiones, finalización, decisiones óptimas y mediana del tiempo de decisión), **Evolución semanal**, **Dónde necesita refuerzo la clase** (situaciones con menor proporción de decisiones óptimas y la opción no óptima más elegida), **Impacto en los indicadores** (sesiones finalizadas), **Por escenario** y **Sesiones recientes**.
- Solo datos agregados: nunca muestra ni ordena a personas. Cuando no hay datos indica «Sin datos aún», nunca 0 %. Una decisión de hace unos segundos puede tardar un poco en contar.

Úsala para preparar el debate o revisar qué situaciones conviene reforzar, no para evaluar a nadie.

---

## 10. Voz de VictorIA en el proyector

Cuando se revela la respuesta de una situación que el proyector vio abierta, VictorIA comenta el resultado de la clase con una frase **de plantilla fija** (sin IA generativa) que usa los datos agregados reales: el porcentaje que eligió la mejor opción y, si llega al 15 %, la opción no óptima más elegida. También comenta la comparación con la media. Habla de «la clase» y de decisiones, nunca de personas; sin votos no hay comentario.

- El comentario aparece **siempre como subtítulo**, con la nota «Comentario automático generado a partir de los votos» (o «…de los datos agregados»). Se cierra con × o **Esc**.
- Si el servicio de voz está configurado, el botón **Voz de VictorIA** (tecla **V**) lo lee en voz alta con síntesis de **Soniox en tiempo real** (voz «Carmen»). El texto que se envía a Soniox es solo esa frase de plantilla, sin nombres ni datos de participantes. El navegador recuerda si la dejaste activada.
- El audio se habilita con tu primer clic o tecla dentro del proyector. Cambiar de situación o pulsar **Esc** corta la voz. Si la voz falla, queda solo el subtítulo.

---

## 11. Clase simulada y Demo rápida

- **Simular clase** (en la barra de la sesión, solo el docente que la creó) añade 20 **participantes simulados** («Participante simulado 01», …) que deciden solos a los pocos segundos de abrirse cada situación. Sirven para ensayar el proyector, la revelación de la respuesta y el informe sin alumnos. **Quitar simulados** los retira con sus decisiones.
- **Demo rápida** (Inicio y Sesiones) crea en un clic una sesión del escenario por defecto llamada «Demo · <fecha y hora>», añade la clase simulada y abre el proyector.
- Los simulados aparecen marcados como *Simulado* en la consola y en el informe. Puedes excluirlos de las estadísticas, del informe y de la analítica; la analítica los excluye por defecto.
- **Elimina las sesiones de demostración** («Demo · …» y de prueba) en cuanto termines, y siempre antes de empezar el piloto: aunque se excluyan, ocupan el listado y se conservan hasta su borrado.

---

## 12. Modo IA en vivo (demo)

Es una **demostración separada** del simulador de clase, solo para docentes. Está activa en el entorno actual y se accede desde **Escenarios**. A diferencia de las sesiones, aquí VictorIA **sí usa IA generativa**.

### 12.1 Cómo funciona

1. Crea una **colección de conocimiento** (**Nueva colección**) y sube documentos: PDF, DOCX, TXT, MD o texto pegado (hasta 20 MB y 300 000 caracteres por documento, 10 documentos por colección). Un PDF escaneado sin texto no se puede leer.
2. Inicia una **partida** de 3 a 6 situaciones, opcionalmente con un tema.
3. VictorIA genera cada situación y cuatro opciones **solo a partir de los fragmentos de tus documentos**, citándolos; la narra con voz sintética, tú respondes por voz o tocando la opción, y te contesta preguntas sobre el contenido («No lo sé con estos documentos» si no está).

La pantalla muestra en todo momento «Generado con IA a partir de tus documentos · puede contener errores».

### 12.2 Reglas de uso

- **No subas documentos con datos personales** (listas de clase, notas, expedientes, correos, casos identificables) ni digas datos personales en voz alta. Los documentos se guardan en el almacenamiento del servicio y se procesan con Cloudflare Workers AI, cuya ubicación de procesamiento no está garantizada en la UE; la voz se procesa con Soniox en Estados Unidos.
- No uses este modo con estudiantes hasta que la UFV lo valide (ver *Privacidad y transparencia*, Parte C).
- Las colecciones **no se borran solas**: elimina las que ya no uses (y las de prueba) desde la propia colección. Las partidas se borran automáticamente a los 365 días.
- Si se alcanza la cuota diaria de IA aparece «Se ha alcanzado el límite diario de IA. Inténtalo más tarde.».

### 12.3 «Convertir en escenario para clase»

Al terminar una partida (o desde **Partidas recientes** de la colección, con al menos 2 situaciones generadas), **Convertir en escenario para clase** crea un **borrador** con las situaciones ya generadas, sin volver a usar la IA. Antes de publicarlo **debes revisarlo**: textos, opciones, valoración de cada opción, «por qué» e idea clave. El borrador se guarda solo en tu navegador hasta que lo publiques.

Al pulsar **Publicar escenario** confirmas que has revisado el contenido generado con IA. El escenario queda en **Tus escenarios** con la marca **Creado con IA · revisado por <tu nombre>** y se usa como cualquier otro (QR, proyector, informe, analítica). Las sesiones con estos escenarios avisan a los participantes de que el escenario se redactó con IA y lo revisó un docente. Como cualquier escenario publicado, no se puede modificar: un cambio es una versión nueva.

---

## 13. Buenas prácticas de facilitación

**Antes**

- Presenta a VictorIA como lo que es: **un personaje virtual con imagen y voz sintéticas**. En las sesiones de clase sus intervenciones están escritas de antemano en el escenario (o redactadas con IA y revisadas por un docente, si el escenario lo indica) y sus reacciones son grabaciones fijas; no conversa ni se adapta a la persona. La conversación con IA solo existe en el Modo IA en vivo, que es una demostración aparte.
- Explica qué se registra (alias o nombre, decisiones y tiempos) y qué no (audio, imagen, emociones). Explica que la voz es opcional y dónde se procesa. Puedes apoyarte en la *Guía del participante*.
- Recomienda un alias sin datos personales.
- Deja claro si la actividad es formativa o evaluable y con qué criterios.

**Durante**

- Proyecta el **proyector**, no la consola.
- Deja que el reloj trabaje: no avances en cuanto decide el primero; espera a la mayoría o a que se agote el tiempo previsto.
- Usa la pausa para preguntar «¿qué estáis valorando?» antes de **Mostrar respuesta**.
- Usa los incidentes con intención y avisa en el debriefing de que los introdujiste tú.
- Si trabajan en grupos, pide que una persona distinta confirme la decisión en cada situación.

**En el debriefing**

- Empieza por lo que pensaron, no por la valoración del escenario.
- Habla de decisiones y de consecuencias, nunca de personas. Usa los datos agregados del proyector.
- Valida las opciones «aceptables»: a menudo son razonables y abren el mejor debate.
- Cierra con reglas concretas y aplicables.

**Después**

- Si descargas el PDF, el CSV o el JSON, guárdalos solo en almacenamiento de la UFV y bórralos cuando ya no los necesites: contienen nombres o alias.
- Elimina las sesiones de prueba y de demostración.

---

## 14. Datos de la sesión: exportar y eliminar

Desde el menú **Más** de la sesión o el menú de su fila en **Sesiones**:

- **Exportar datos (JSON):** descarga todo lo registrado en la sesión (estado, participantes, decisiones, cronología de eventos e informe). Úsalo para atender una solicitud de acceso o portabilidad o para archivar resultados según indique la UFV. La exportación queda anotada en la auditoría.
- **Eliminar → Eliminar definitivamente:** borra la sesión, sus decisiones, sus indicadores y su informe, y también su **código de unión y los invitados** que entraron con él. **No se puede deshacer.** Solo queda una anotación en la auditoría de que la sesión se eliminó, sin su contenido. En **Sesiones** puedes eliminar varias a la vez con la selección múltiple.

Solo el docente que creó la sesión puede exportarla o eliminarla (si ya no es miembro de la organización, cualquier otro docente).

**Conservación automática:**

- Las sesiones **finalizadas** se borran **365 días después de su finalización**, y las que nunca se finalizan, **365 días después de su creación**.
- El **acceso de un invitado** caduca a las **12 horas** de unirse o **2 horas después de finalizar la sesión** (para que pueda leer su resumen), lo que ocurra antes; después se borra. Su alias se mantiene en los datos de la sesión hasta que esta se elimine o caduque.
- Las partidas del Modo IA se borran a los 365 días; las colecciones, solo cuando las elimina el docente.

Aun así, elimina las sesiones de prueba en cuanto no las necesites.

Si un participante pide acceder a sus datos o que se borren, sigue el procedimiento de la UFV para el ejercicio de derechos. Hoy no se puede borrar a una sola persona dentro de una sesión: se elimina la sesión completa o se atiende por el procedimiento que indique la UFV. **[Pendiente UFV]** Definir el canal (DPO o Secretaría General) y el plazo de respuesta.

---

## 15. Problemas frecuentes

| Mensaje o situación | Qué significa | Qué hacer |
|---|---|---|
| «El correo o el código no son correctos. Revisa los datos o pide un código nuevo a tu docente.» | Al entrar con cuenta: el correo no coincide con el alta, el código se ha cambiado o revocado, o la persona no es miembro. | Comprueba el correo y genera un código nuevo en **Participantes y accesos**. |
| «Demasiados intentos. Espera unos minutos y vuelve a probar.» / «Demasiados intentos. Espera unos minutos.» | Límite de seguridad de intentos de acceso o de códigos de sesión erróneos (en un aula toda la clase suele compartir la misma conexión). | Esperar unos minutos y teclear el código con cuidado; mejor escanear el QR. |
| «Ese código no corresponde a ninguna sesión abierta. Revísalo en la pantalla del aula.» / «El código ya no es válido. Revísalo en la pantalla del aula.» | En `/unirse`: código mal tecleado, regenerado o de una sesión finalizada o eliminada. | Proyecta el QR (tecla **Q**) y comprueba el código actual. |
| «Esta sesión ya ha terminado. Pide el código de la sesión actual.» | El código es de una sesión finalizada. | Crea o duplica una sesión y comparte su QR. |
| «El alias debe tener entre 2 y 30 caracteres: letras, números, espacios, punto, guion o guion bajo.» | Alias no válido (también se rechazan correos y direcciones web). | Elegir otro alias. |
| «Acceso de invitado limitado a su sesión.» | Un invitado ha intentado abrir algo que no es su sesión. | Que vuelva a `/unirse` con el código de la sesión correcta. |
| «La sesión ha terminado · Tu acceso de invitado ha caducado» (móvil) | Han pasado 12 horas o la sesión terminó hace más de 2 horas. | Si hay una sesión nueva, unirse con su código. |
| «Reconectando…» / «Sin conexión. Reintentando…» | Corte de red o de la conexión en directo. | Esperar unos segundos; si persiste, recargar la página. |
| «No encuentro esta sesión. Comprueba el enlace o el código de la pantalla del aula…» (3D) | Enlace incompleto, sesión eliminada o de otra organización. | Vuelve a copiar el enlace desde la consola. |
| «Abre el simulador desde el enlace que te comparta tu docente.» (3D) | Se abrió el simulador sin el enlace de la sesión. | Comparte el enlace completo con **Copiar enlace**. |
| «No tienes acceso a esta sesión o tu acceso ha caducado…» (3D) | Sin cuenta válida o invitado caducado o de otra sesión. | Entrar con el código de la pantalla del aula o pedir acceso. |
| «Sin conexión con la sesión · reintentando…» (3D) | Corte de red. | Esperar; si persiste, recargar la página. |
| «Voz no disponible · elige con el ratón» | Solo en el ejecutable de Windows: no hay micrófono o Windows no deja abrirlo. | Responder con el ratón o las teclas 1-4. |
| «Permite el micrófono en el navegador para responder con la voz.» (móvil) | Se denegó el permiso de micrófono. | Responder tocando la opción o dar permiso en el navegador. |
| «Ese correo no se puede dar de alta en esta organización.» | El correo ya pertenece a otra organización. | Avisa al equipo técnico. |
| «Espera al menos una decisión.» | Se intentó avanzar sin ninguna decisión en la situación. | Espera a que decida al menos un participante. |
| «Reanuda la sesión antes de avanzar.» | La sesión está pausada. | Pulsa **Reanudar**. |
| «Es la última fase; finaliza la sesión.» | Estás en la última situación. | Pulsa **Finalizar sesión**. |
| «Demasiadas peticiones. Espera unos segundos.» | Límite de seguridad de uso (300 peticiones por minuto y usuario). | Esperar y reintentar. |
| «Se ha alcanzado el límite diario de IA. Inténtalo más tarde.» | Modo IA en vivo: cuota diaria de Workers AI agotada. | Volver a intentarlo otro día o avisar al equipo técnico. |

**Soporte:** **[Pendiente UFV]** Indicar el contacto de soporte durante el piloto.
