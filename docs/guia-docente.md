# Simulador de decisiones UFV · Guía docente

Esta guía explica cómo preparar, dirigir y cerrar una sesión del **Simulador de decisiones** de la Universidad Francisco de Vitoria. Está pensada para el profesorado y el personal que actúa como **instructor** de una sesión.

> **Estado del documento:** versión para el piloto del MVP. Los puntos marcados con **[Pendiente UFV]** dependen de decisiones o configuraciones que todavía debe cerrar la Universidad.

---

## 1. Qué es y cómo se organiza

El simulador presenta a un grupo una serie de situaciones (fases) en las que hay que tomar una decisión. Una tutora virtual, **VictorIA**, plantea cada situación con voz y gestos; los participantes eligen una opción y ven su consecuencia. Al final, el docente conduce un debriefing con el informe de la sesión.

Hay dos piezas:

| Pieza | Quién la usa | Para qué |
|---|---|---|
| **Consola web** | Docente (instructor) | Crear sesiones, dar de alta participantes, controlar fases, pausar, lanzar incidentes, ajustar indicadores, ver el informe y gestionar los datos. |
| **Simulador** | Participantes (y el docente, si quiere proyectarlo) | Ver y escuchar a VictorIA, leer la situación y elegir una opción con el ratón o el teclado. Se abre en el navegador, sin instalar nada. |

La consola no muestra a VictorIA; el personaje solo aparece en el simulador.

**Roles**

- **Instructor:** crea y dirige sesiones, da de alta participantes, exporta y elimina datos. Solo el instructor que creó una sesión puede controlarla (avanzar, pausar, finalizar, lanzar incidentes), exportarla o eliminarla; si ese instructor deja de ser miembro de la organización, cualquier otro instructor puede exportarla o eliminarla. Todos los instructores de la organización ven todas sus sesiones.
- **Participante:** se une a la sesión desde el enlace del simulador y toma decisiones. Solo ve sus propias decisiones, indicadores y resultados, nunca los de sus compañeros, y solo las sesiones a las que se ha unido.

---

## 2. Antes de la sesión

### 2.1 Requisitos

- **Código personal.** Cada persona necesita su correo y un código único de seis cifras. El código se genera en la consola y se entrega por un canal privado. No se exige un dominio concreto de correo.
- **Alta en la organización.** Cada persona debe ser miembro de la organización con un rol (docente o participante). El alta es manual y la realiza el docente antes de compartir el enlace (apartado 4).
- **Equipos de los participantes:** navegador actualizado (Chrome o Edge recomendados) y altavoces o auriculares para oír a VictorIA. En el navegador se responde con el ratón o el teclado; no se usa el micrófono.
- **Aula:** si vas a proyectar a VictorIA para todo el grupo, prevé un equipo con salida de audio a la sala.

### 2.2 Dirección de acceso

Entra en **<https://axyro.qhel.dev>** e introduce tu correo y código personal en la pantalla de AXYRO.

**[Pendiente UFV]** Es la dirección provisional del entorno de pruebas. Está previsto trasladar el servicio a un dominio definitivo de la Universidad; cuando ocurra, se actualizará esta guía.

### 2.3 Preparación recomendada (15 minutos)

1. Revisa el escenario que vas a usar: lee el resumen, las situaciones y las opciones (puedes crear una sesión de prueba y eliminarla después).
2. Da de alta y crea un código para cada participante con antelación (apartado 4), no en el aula.
3. Prueba el enlace del simulador en el equipo del aula y comprueba el audio.
4. Decide la dinámica: un equipo por persona, o un equipo por pequeño grupo que decide en común.
5. Ten preparado el guion de debriefing (apartado 8).

---

## 3. Crear una sesión y elegir escenario

1. En la barra lateral, apartado **Escenario para nuevas sesiones**, elige el escenario. El selector aparece cuando hay más de uno disponible. Hoy el catálogo incluye:
   - **Uso responsable de la IA en la universidad** (por defecto): tres situaciones de 3 minutos cada una (*Datos personales*, *Verificación* y *Evaluación justa*). Indicadores: **Confianza**, **Productividad** y **Riesgo**.
   - **IA generativa en la docencia**: tres situaciones de 3 minutos (*Actividad evaluable con IA*, *Feedback asistido por IA* y *Materiales y derechos de autor*). Indicadores: Aprendizaje, Eficiencia y Riesgo.
   - **IA en la atención al estudiante**: tres situaciones de 3 minutos (*Respuesta errónea del asistente*, *Sesgo en la priorización de becas* y *Transparencia ante el estudiante*). Indicadores: Confianza, Agilidad y Riesgo.
   - **Renegociación con un proveedor estratégico**: tres fases de 8, 5 y 4 minutos. Indicadores: Relación, Margen y Riesgo.
2. Pulsa **+ Nueva** (o **Crear sesión** si aún no tienes ninguna).
3. La sesión aparece en la lista **Sesiones** con su estado: *En curso*, *Pausada* o *Finalizada*.

Cada sesión guarda una copia del escenario con el que empezó. Si se publica una versión nueva de un escenario, las sesiones ya creadas no cambian.

---

## 4. Dar de alta a los participantes

Cada participante necesita un alta y un código personal, con independencia de su dominio de correo.

En **Vista general**, bloque **Personas y códigos**:

1. Escribe **Nombre** y **Correo** del participante y pulsa **Añadir persona**.
2. Pulsa **Crear código** junto a su nombre, copia las seis cifras y entrégaselas por un canal privado. El código solo se muestra una vez.

Ten en cuenta:

- El alta **no envía ningún correo**. Tú compartes el enlace del simulador y el código por separado (apartado 5).
- El correo debe coincidir con el de la cuenta con la que la persona inicia sesión.
- El nombre es el que verás en la sesión, en el debriefing y en el CSV. **Usa solo el nombre necesario** (por ejemplo, nombre y primer apellido, o el nombre con el que se identifica en clase).
- **Corregir un nombre:** vuelve a añadir a la persona con el mismo correo y el nombre correcto. El rol docente solo lo asigna el propietario.
- Cada persona pertenece a una sola organización. Si el correo ya es de otra, el alta se rechaza («Ese correo no se puede dar de alta en esta organización.»).
- **Cambiar código** invalida el anterior y las sesiones abiertas con él. **Revocar** desactiva el acceso; la consola muestra cuántas veces se usó y la fecha de los últimos accesos.
- El propietario puede dar de alta a otros docentes. La baja de una persona sigue disponible por API; no se puede dar de baja al propietario ni al último docente.

---

## 5. Compartir el enlace del simulador

Con la sesión abierta, en el bloque **Experiencia del participante** verás **Enlace para participantes**:

- **Copiar enlace:** copia la dirección para pegarla en el aula virtual, el chat de la asignatura o la pizarra.
- **Abrir simulador:** abre el simulador en una pestaña nueva. Si lo abres tú, entras como **observador** («Estás viendo la sesión como docente»): es útil para proyectar a VictorIA para todo el grupo sin que cuente como participante.

Cuando un participante abre el enlace e inicia sesión, **se une automáticamente**. En el panel **Participantes → En la sesión** verás quién ha entrado, y la consola indica si el simulador está conectado.

**Llegadas tarde:** un participante puede unirse **en cualquier fase** mientras la sesión no haya finalizado. Empieza en la situación en curso, con los indicadores iniciales y sin decisiones previas; su tiempo de reacción cuenta desde que entra. Las situaciones anteriores no las puede responder.

---

## 6. Dirigir la sesión

### 6.1 El reloj de cada fase

- El reloj de la primera fase **empieza cuando se une el primer participante**, no al crear la sesión. Mientras tanto, la consola muestra «empieza al unirse».
- En cada fase nueva el reloj se reinicia con el tiempo de esa fase.
- Al **pausar**, el reloj se congela y los participantes no pueden decidir; al **reanudar**, continúa desde donde estaba.
- Si el tiempo **se agota**, el indicador de Riesgo sube (8 o 10 puntos según la fase) **a quien aún no había decidido** en esa fase, se avisa en el simulador y queda registrado. **La fase no avanza sola** y se puede seguir decidiendo; esas decisiones aparecen en el debriefing como «tras agotar el tiempo».

### 6.2 Controles del instructor

En el bloque **Control del docente** verás cuántos participantes hay y cuántas decisiones se han tomado en la fase actual.

| Control | Qué hace | Cuándo usarlo |
|---|---|---|
| **Pausar / Reanudar** | Congela la sesión y el reloj. | Para aclarar una duda, gestionar un problema técnico o abrir un debate a mitad de fase. |
| **Siguiente fase →** | Pasa a la siguiente situación. Requiere al menos una decisión en la fase actual. | Cuando la mayoría ha decidido o se agota el tiempo previsto. |
| **Finalizar sesión** | Cierra la sesión y fija el informe. Solo está disponible en la última fase, tras al menos una decisión. | Al terminar la última situación, antes del debriefing. |
| **Lanzar** (incidente) | Añade un acontecimiento imprevisto (texto de hasta 200 caracteres) con el efecto en Riesgo que elijas (de −10 a +15; +5 por defecto). Afecta a todos los participantes y queda en la cronología. | Para introducir presión o un giro («El vicerrectorado pide el informe hoy mismo»). |
| **Ajustar indicador** | Fija Confianza, Productividad o Riesgo a un valor entre 0 y 100 para todos los participantes. Queda registrado. | Para preparar una situación concreta o corregir un desajuste. Úsalo con moderación. |

**No escribas datos personales en los incidentes** (nombres de alumnos, casos reales identificables): los participantes lo ven y el texto se guarda en la sesión y en las exportaciones.

### 6.3 Cómo leer los indicadores

- Cada participante tiene **sus propios indicadores**: solo los cambian sus decisiones, el tiempo agotado cuando aún no había decidido, los incidentes y tus ajustes.
- En la consola ves la **media de la clase**; cada participante ve solo los suyos.
- Cada participante decide **una vez por fase** y no puede cambiar su respuesta. Hasta que decide, no ve la valoración de las opciones ni la idea clave de la fase.
- En el escenario de IA: **Confianza** (de la comunidad universitaria en el trabajo realizado), **Productividad** (tiempo y esfuerzo) y **Riesgo** (legal, reputacional o de injusticia). Riesgo alto es malo.

---

## 7. El informe de desempeño y el debriefing

La consola muestra el **Informe de resultados** durante toda la sesión y el panel **Debriefing** con las decisiones registradas.

### 7.1 Qué mide el informe

El informe de la consola es el **de la clase**: la puntuación y los objetivos se calculan con la media de los indicadores, y el resto con todas las decisiones. Debajo, **Resultados por participante** muestra el mismo cálculo para cada persona. Cada participante ve solo su informe individual.

| Indicador | Cómo se calcula |
|---|---|
| **Puntuación /100** | Media de Confianza, Productividad y (100 − Riesgo). |
| **Decisiones correctas** | Porcentaje de decisiones que el escenario valora como *Mejor opción*. |
| **Tiempo de reacción** | Porcentaje medio de tiempo que quedaba en la fase al decidir. |
| **Objetivos** | Se cumplen tres: Confianza ≥ 55, Productividad ≥ 55 y Riesgo ≤ 40. |
| **Decisiones críticas** | Número de decisiones valoradas como *Crítica*. |
| **Tiempos agotados** | En la clase, fases en las que venció el reloj; en el individual, las que vencieron sin que la persona hubiera decidido. |

El panel **Debriefing** lista cada decisión con la fase, la opción elegida, su consecuencia, la valoración (*Mejor opción*, *Aceptable* o *Crítica*), el porqué de la opción y la idea clave de la fase (si el escenario los incluye), el nombre del participante y los segundos que tardó. Con **Descargar CSV** obtienes la misma información en una hoja de cálculo (separador «;», se abre directamente en Excel).

### 7.2 Cómo usarlo bien

- La valoración es **de la decisión según el diseño del escenario, no de la persona**. Preséntala así: «esta opción es la que mejor protege…», nunca «has suspendido».
- El sistema **no mide emociones, estrés ni estados psicológicos**, y no observa por cámara ni analiza la voz.
- El informe es un apoyo para la conversación. **No lo uses como única base para calificar** a nadie: si la actividad es evaluable, la valoración la haces tú con tu criterio.
- Cada participante solo ve sus propias decisiones y resultados; los nombres del debriefing solo los ves tú. Si vas a proyectar la consola, avisa antes o comenta los resultados de forma agregada.

---

## 8. Guion de debriefing (10 minutos) · «Uso responsable de la IA en la universidad»

**Objetivo:** que el grupo formule con sus palabras tres reglas prácticas: proteger los datos personales, verificar lo que produce la IA y no delegar en un detector una decisión que afecta a una persona.

**Material:** panel Debriefing en pantalla (o resultados agregados), pizarra para anotar las tres reglas.

| Minuto | Bloque |
|---|---|
| 0:00 – 1:00 | Apertura |
| 1:00 – 3:30 | Situación 1 · Datos personales |
| 3:30 – 6:00 | Situación 2 · Verificación |
| 6:00 – 8:30 | Situación 3 · Evaluación justa |
| 8:30 – 10:00 | Cierre y compromiso |

### 0:00 – 1:00 · Apertura

- «¿Con qué palabra describiríais la sesión?» (ronda rápida, sin debatir).
- Muestra la puntuación y los tres indicadores finales. Recuerda que valoramos decisiones, no personas, y que no hay preguntas trampa: las tres situaciones son reales y frecuentes.

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
- Si quedó tiempo agotado en alguna fase, coméntalo en positivo: en la vida real también se decide con prisa, y por eso conviene tener reglas claras de antemano.

---

## 9. Buenas prácticas de facilitación

**Antes**

- Presenta a VictorIA como lo que es: **un personaje virtual con voz sintética**, con intervenciones guionizadas. No es una persona real ni una IA que converse.
- Explica qué se registra (decisiones y tiempos) y qué no (audio, imagen, emociones). Puedes apoyarte en la *Guía del participante*.
- Deja claro si la actividad es formativa o evaluable y con qué criterios.

**Durante**

- Deja que el reloj trabaje: no avances en cuanto decide el primero; espera a la mayoría o a que se agote el tiempo previsto.
- Usa la pausa para preguntar «¿qué estáis valorando?» sin revelar la respuesta.
- Usa los incidentes con intención y avisa en el debriefing de que los introdujiste tú.
- Si trabajan en grupos, pide que una persona distinta pulse la decisión en cada fase.

**En el debriefing**

- Empieza por lo que pensaron, no por la valoración del escenario.
- Habla de decisiones y de consecuencias, nunca de personas. Evita señalar a quien eligió una opción crítica; usa los datos agregados.
- Valida las opciones «aceptables»: a menudo son razonables y abren el mejor debate.
- Cierra con reglas concretas y aplicables, no con conclusiones abstractas.

**Después**

- Si descargas el CSV o el JSON, guárdalo solo en almacenamiento de la UFV y bórralo cuando ya no lo necesites.
- Elimina las sesiones de prueba.

---

## 10. Datos de la sesión: exportar y eliminar

En el panel **Datos de la sesión**:

- **Exportar JSON:** descarga todo lo registrado en la sesión (estado, decisiones, cronología de eventos e informe). Úsalo para atender una solicitud de acceso o portabilidad o para archivar resultados según indique la UFV. La exportación queda anotada en la auditoría.
- **Eliminar sesión → Eliminar definitivamente:** borra la sesión, sus decisiones y su cronología. **No se puede deshacer.** Solo queda una anotación en la auditoría de que la sesión se eliminó, sin su contenido.

Solo el docente que creó la sesión puede exportarla o eliminarla (si ya no es miembro de la organización, cualquier otro docente).

**Conservación automática:** las sesiones **finalizadas** se borran automáticamente **365 días después de su finalización**, y las que nunca se finalizan, **365 días después de su creación**. Aun así, elimina las sesiones de prueba en cuanto no las necesites.

Si un participante pide acceder a sus datos o que se borren, sigue el procedimiento de la UFV para el ejercicio de derechos. **[Pendiente UFV]** Definir el canal (DPO o Secretaría General) y el plazo de respuesta.

---

## 11. Problemas frecuentes

| Mensaje o situación | Qué significa | Qué hacer |
|---|---|---|
| «Correo o código no válido» / «No tienes acceso a esta sesión.» | El correo no coincide con el alta, el código se ha cambiado o revocado, o la persona no es miembro de la organización. | Comprueba el correo y genera un código nuevo en **Personas y códigos**. |
| «No encuentro esta sesión. Comprueba el enlace…» | El enlace está incompleto, la sesión se eliminó o es de otra organización. | Vuelve a copiar el enlace desde la consola. |
| «Abre el simulador desde el enlace que te comparta tu docente.» | Se abrió el simulador sin el enlace de la sesión. | Comparte el enlace completo con **Copiar enlace**. |
| «Simulación completada» al abrir el enlace | La sesión ya está finalizada. | Crea una sesión nueva y comparte su enlace. |
| «Ese correo no se puede dar de alta en esta organización.» | El correo ya pertenece a otra organización. | Avisa al equipo técnico. |
| «Sin conexión con la sesión · reintentando…» | Corte de red. | Esperar unos segundos; si persiste, recargar la página. |
| «Voz no disponible · elige con el ratón» | Solo en el ejecutable de Windows: no hay micrófono o Windows no deja abrirlo. | Responder con el ratón o las teclas 1-4. |
| «Espera al menos una decisión.» | Se intentó avanzar sin ninguna decisión en la fase. | Espera a que decida al menos un participante. |
| «Reanuda la sesión antes de avanzar.» | La sesión está pausada. | Pulsa **Reanudar**. |
| «Es la última fase; finaliza la sesión.» | Estás en la última situación. | Pulsa **Finalizar sesión**. |
| «Demasiadas peticiones. Espera unos segundos.» | Límite de seguridad de uso (300 peticiones por minuto y usuario). | Esperar y reintentar. |

**Soporte:** **[Pendiente UFV]** Indicar el contacto de soporte durante el piloto.
