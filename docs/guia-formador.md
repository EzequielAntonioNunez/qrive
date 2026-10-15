# AXYRO · Guía del formador

Esta guía explica cómo preparar, dirigir y cerrar una sesión de **AXYRO · Simulador de decisiones** en un despacho de abogados, un colegio profesional o cualquier programa de formación jurídica. Está pensada para las personas que actúan como **formador** de una sesión (rol interno `instructor`).

> **Estado del documento:** versión para el piloto del MVP, revisada el 15 de octubre de 2026. Los puntos marcados con **[Validar cliente]** dependen de decisiones o configuraciones que todavía debe cerrar la organización cliente.

---

## 1. Qué es y cómo se organiza

El simulador presenta a un equipo una serie de situaciones en las que hay que tomar una decisión. Una tutora virtual, **VictorIA**, plantea cada situación; cada participante elige una opción y ve su consecuencia. El formador sigue la votación en directo, revela la mejor opción y cierra con un debriefing apoyado en el informe de la sesión.

### 1.1 Superficies

| Superficie | Quién la usa | Para qué |
|---|---|---|
| **Consola web** | Formadores | Preparar y dirigir sesiones. Menú lateral: **Inicio**, **Sesiones** (con **Nueva sesión**), **Analítica**, **Escenarios** y **Participantes y accesos**. Cada sesión tiene su panel con las pestañas **En directo**, **Participantes** e **Informe**. |
| **Proyector** | Formador, en la pantalla de la sala | Vista a pantalla completa con el QR y el código de unión, el recuento de votos en directo, la respuesta revelada, los comentarios de VictorIA y la comparación con la media. Solo muestra datos agregados, nunca nombres. Se abre con **Proyectar**. |
| **Vista móvil** | Participantes (móvil, tableta u ordenador) | Unirse con el QR o el código en `/unirse`, escuchar a VictorIA, elegir y ver el resultado en `/jugar/…`. No requiere cuenta ni instalar nada. |
| **Simulador 3D** | Participantes con ordenador (opcional) | VictorIA en 3D, con voz, lip sync y reacciones habladas. Se abre en el navegador desde el enlace de la sesión o con **Abrir en 3D** desde la vista móvil. |
| **Modo IA en vivo (demo)** | Solo formadores | Demostración aparte en la que VictorIA genera situaciones a partir de documentos que sube el formador (apartado 12). No se usa con participantes salvo decisión expresa de la organización cliente. |

La consola no muestra a VictorIA en 3D: el personaje aparece en el simulador 3D; en el móvil y en el proyector aparece con su texto y su voz.

### 1.2 Roles y permisos

- **Propietario de la organización:** es un formador que, además, es el único que puede dar el rol de formador a otra persona y crear o revocar códigos de formadores.
- **Formador:** crea sesiones, da de alta participantes y ve **todas las sesiones de su organización**. Lo que puede hacer con cada sesión depende de quién la creó:

| Acción | Quién puede |
|---|---|
| Conducirla: avanzar, pausar, reanudar, finalizar, lanzar incidentes, ajustar indicadores | Solo el formador que la creó. |
| Simular equipo / Quitar simulados | Solo el formador que la creó. |
| Regenerar el código de unión (PIN) | En la consola, el formador que conduce la sesión. |
| Renombrar, exportar datos (JSON) y eliminar | El formador que la creó; si ya no es miembro de la organización, cualquier otro formador. |
| Duplicar | Cualquier formador de la organización. |
| Ver la sesión, su informe, el proyector, el QR y el código | Cualquier formador de la organización (la consola avisa de que la conduce otro formador). |
| Analítica y «Comparar con la media» | Cualquier formador de la organización. |

- **Participante con cuenta:** persona dada de alta con su correo y un código personal. Solo ve sus propias decisiones, indicadores y resultados, y solo las sesiones a las que se ha unido.
- **Invitado:** entra con el código de seis cifras de una sesión y un **alias**, sin correo ni cuenta. Solo puede usar esa sesión (cualquier otra acción responde «Acceso de invitado limitado a su sesión.») y su acceso caduca (apartado 14). Recibe la misma vista filtrada que cualquier participante.

Ningún participante ve los nombres, alias, decisiones ni resultados de sus compañeros.

---

## 2. Antes de la sesión

### 2.1 Requisitos

**Dos formas de entrar para los participantes:**

| Modo | Cómo entra | Cuándo usarlo |
|---|---|---|
| **Invitado (recomendado en la sala)** | Escanea el QR o abre `/unirse`, teclea el código de seis cifras de la sesión y elige un alias. | Sesiones presenciales, demostraciones y equipos sin alta previa. No hace falta dar de alta a nadie. |
| **Con cuenta** | Abre el enlace del simulador e introduce su correo y su código personal de seis cifras. | Cuando se quiera identificar a cada persona por su nombre o que vea sus sesiones en «Mis sesiones». Requiere alta previa (apartado 4). Se admite cualquier dominio de correo. |

**Voz (opcional):**

- Los participantes pueden responder hablando si el servicio de voz está configurado. Antes de abrir el micrófono se muestra un aviso: la voz se transcribe con **Soniox en Estados Unidos** (transferencia internacional) y no se guarda el audio. Solo se activa si la persona pulsa **Aceptar y activar**; siempre se puede responder tocando la opción.
- Las órdenes cortas («la dos», «opción B») se resuelven en el propio navegador. Si la persona explica su respuesta con sus palabras, la frase se envía a **Clef**, un modelo de decisión de Cloudflare Workers AI que solo la asigna a una de las opciones existentes y pide confirmación si duda; no genera texto ni valora a nadie.

**Equipos:**

- **Participantes:** móvil o tableta con navegador actualizado (para la vista móvil), u ordenador con Chrome o Edge (para el simulador 3D). Auriculares o el altavoz del dispositivo si se quiere oír a VictorIA.
- **Sala:** un ordenador conectado al proyector o a la pantalla y, si VictorIA va a comentar los resultados en voz alta, con salida de audio a la sala.
- **Red:** la vista móvil y el proyector se actualizan en directo por WebSocket; si la red lo bloquea, siguen funcionando con consultas periódicas.

### 2.2 Dirección de acceso

Entra en la dirección del servicio (hoy `axyro.qhel.dev`) e introduce tu correo y tu código personal en la pantalla **Accede con tu código**.

**[Validar cliente]** Si la organización decide usar un dominio propio, se actualizará esta guía. El QR contiene siempre el enlace de unión y el formador puede copiarlo con **Copiar enlace de unión**.

### 2.3 Preparación recomendada (15 minutos)

1. Revisa el escenario en **Escenarios**: situaciones, opciones, valoración, «por qué» e idea clave (los participantes no ven la valoración hasta que deciden).
2. Si vas a usar cuentas, da de alta y genera los códigos con antelación (apartado 4), no en la sala.
3. Haz una prueba con **Demo rápida** (apartado 11) en el equipo de la sala: proyector, audio y, si procede, la voz de VictorIA. Elimina después esa sesión.
4. Decide la dinámica: un dispositivo por persona, o uno por pequeño grupo que decide en común.
5. Ten preparado el guion de debriefing (apartado 8).

---

## 3. Crear y gestionar sesiones

### 3.1 Nueva sesión (asistente en tres pasos)

Pulsa **Nueva sesión** (menú lateral, Inicio o Sesiones) o **Crear sesión** desde un escenario.

1. **Escenario:** elige uno del catálogo. **Ver situaciones** muestra su contenido sin valoraciones. Hoy el catálogo incluye:
   - **Uso responsable de la IA en el despacho** (por defecto): cuatro situaciones (*Secreto profesional*, 3 min 30 s; *Jurisprudencia inventada*, 3 min; *Contratar un proveedor de IA*, 4 min; *Transparencia con el cliente*, 3 min). Indicadores: **Confianza del cliente**, **Deontología** y **Riesgo**.
   - Si tu organización ha publicado escenarios propios, aparecen también en **Tus escenarios** (apartado 3.3).
2. **Detalles:** nombre de la sesión, opcional (hasta 80 caracteres; por ejemplo, «Área Mercantil · Grupo A»). Si lo dejas vacío, se muestra el escenario y la fecha. No escribas nombres de participantes ni de clientes.
3. **Listo:** enlace para participantes con cuenta, bloque **Únete desde el móvil** (QR y código) y botones **Abrir panel de la sesión** y **Proyectar en la sala**.

Cada sesión guarda una copia del escenario con el que empezó: si se publica una versión nueva, las sesiones ya creadas no cambian.

### 3.2 Listado de sesiones

En **Sesiones** verás todas las sesiones de la organización:

- **Buscar** por nombre, escenario o formador; **filtros** *Todas*, *En curso*, *En pausa*, *Finalizadas* y *Mías*; **Ordenar** por más recientes, más antiguas, nombre o estado.
- **Selección múltiple** (solo de tus sesiones): **Finalizar**, **Eliminar** o **Quitar selección**. Antes de cerrar o borrar se pide confirmación.
- **Menú de cada fila:** Abrir, Proyectar en la sala, Copiar enlace para participantes, Pausar o Reanudar, Finalizar, Ver informe y, en el bloque inferior, **Renombrar**, **Duplicar**, **Exportar datos (JSON)** y **Eliminar**. Solo aparecen las acciones que te corresponden (apartado 1.2).

**Inicio** resume las sesiones en curso, las finalizadas recientemente y unos indicadores de la organización; desde cada tarjeta se puede abrir, proyectar, pausar o finalizar.

### 3.3 Escenarios y «Tus escenarios»

**Escenarios** muestra el catálogo de AXYRO y, si tu organización ha publicado escenarios propios, el grupo **Tus escenarios**. Los escenarios convertidos desde el Modo IA llevan la marca **Creado con IA · revisado por …** (apartado 12.3) y no tienen locución grabada: VictorIA aparece como texto.

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
- No se puede dar de baja al propietario ni al último formador, ni darte de baja a ti mismo.

---

## 5. Invitar al equipo

### 5.1 «Únete desde el móvil» (camino principal en la sala)

El bloque **Únete desde el móvil** aparece en el último paso del asistente, en la pestaña **En directo** de la sesión y en el proyector (tecla **Q**). Contiene:

- **QR** con el enlace de unión de la sesión.
- **Código de seis cifras** (por ejemplo, «483 920»), para quien prefiera teclearlo en `/unirse`.
- **Regenerar código**: invalida el código actual y crea otro (pide confirmación). Úsalo si el código se ha difundido fuera de la sala.
- **Copiar enlace de unión**: copia el enlace del QR para pegarlo en la intranet o en el chat de la sesión.

Cada participante escanea el QR, escribe un alias y pulsa **Entrar**. El código deja de valer al finalizar la sesión.

Recomienda a los participantes un **alias sin datos personales** (por ejemplo, el nombre de pila, unas iniciales o «Mesa 3»). El alias aparece en tu consola, en el informe y en las exportaciones; nunca en el proyector ni a los compañeros. Si dos personas eligen el mismo alias, el segundo pasa a ser «Ana 2».

### 5.2 Simulador 3D

En **En directo**, el bloque **Simulador 3D en el ordenador** ofrece **Copiar enlace** y **Abrir simulador**:

- Los participantes con cuenta abren el enlace e introducen su correo y su código; se unen automáticamente.
- Los invitados pueden pasar al 3D con **Abrir en 3D** desde la vista móvil (solo en ordenador o tableta). La primera carga descarga unos 38 MB; las siguientes salen de la caché del navegador.
- Si tú abres el enlace, entras como **observador** («Estás viendo la sesión como formador»): no cuentas como participante.

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

### 6.2 Controles del formador

La barra de acciones de la sesión y el proyector ofrecen estos controles (solo al formador que creó la sesión):

| Control | Qué hace | Cuándo usarlo |
|---|---|---|
| **Siguiente situación** | Abre la siguiente situación. Requiere al menos una decisión en la actual. | Cuando la mayoría ha decidido o se agota el tiempo previsto. |
| **Pausar / Reanudar** | Congela la sesión y el reloj. | Para aclarar una duda, abrir un debate a mitad de situación o resolver un problema técnico. |
| **Finalizar** | Cierra la sesión **en cualquier momento** y fija el informe. Si quedan situaciones por jugar, pide confirmación («¿Finalizar la sesión antes de tiempo?») y el informe refleja solo las trabajadas. En la última situación el botón se llama **Finalizar sesión**. | Al terminar la última situación, o antes si falta tiempo. |
| **Herramientas del formador → Lanzar un incidente** | Añade un acontecimiento imprevisto (texto de hasta 200 caracteres) con un efecto en Riesgo de −10, −5, +5, +10 o +15 (+5 por defecto). Afecta a todo el equipo y queda en el registro de actividad. | Para introducir presión o un giro («El juzgado adelanta la vista a mañana»). |
| **Herramientas del formador → Ajustar un indicador** | Fija uno de los tres indicadores entre 0 y 100 para todos. Queda registrado. | Para preparar una situación concreta o corregir un desajuste. Con moderación. |
| **Simular equipo / Quitar simulados** | Añade o retira 20 participantes simulados (apartado 11). | Solo para demostraciones y pruebas. |
| **Proyectar** | Abre el proyector a pantalla completa. | Siempre que proyectes en la sala. |

**No escribas datos personales ni datos de clientes en los incidentes** (nombres de participantes, asuntos reales identificables): los participantes lo ven y el texto se guarda en la sesión y en las exportaciones.

### 6.3 El proyector

Proyecta siempre el **proyector**, no la consola: la consola muestra nombres y alias, el proyector solo datos agregados.

- **Barra superior:** **Únete (QR)**, **Voz de VictorIA**, **Pausar** / **Reanudar** y **Finalizar** (estos tres, solo para el formador que conduce la sesión), **Pantalla completa** y **Salir**.
- **Teclas:** **Q** muestra u oculta el panel **Únete (QR)**; **V** activa o desactiva la **Voz de VictorIA**; **Esc** corta primero el comentario de VictorIA o la comparación y, después, cierra el proyector.
- Mientras la situación está abierta se ven las opciones, el porcentaje y el número de votos, el anillo de cuántos han decidido y el reloj. **Ninguna valoración se muestra hasta revelar la respuesta.**
- **Mostrar respuesta** (cuando ya hay votos) resalta la **Mejor opción** y muestra la **idea clave**. La respuesta también se revela al avanzar, al finalizar o al agotarse el tiempo.
- Al avanzar, el proyector se queda en la situación que acaba de cerrarse para comentarla; **Ver situación N →** lleva a la nueva. La barra inferior permite repasar situaciones anteriores.
- El formador que conduce la sesión tiene además, en el lateral, **Mostrar respuesta**, **Siguiente situación →** y, en la última, **Finalizar sesión**. **Finalizar** pide la misma confirmación que en la consola si se cierra antes de tiempo.
- **Comparar con la media** abre la tarjeta **Vuestro equipo frente a la media**: el porcentaje de decisiones óptimas del equipo frente a la media de las demás sesiones de la organización de los últimos 365 días. Se abre sola al finalizar la sesión con el proyector abierto. Si no hay otras sesiones con datos, indica «Primera sesión de la organización: aún no hay media con la que comparar». Solo datos de grupo.

### 6.4 Cómo leer los indicadores

- Cada participante tiene **sus propios indicadores**: los cambian sus decisiones, el tiempo agotado cuando aún no había decidido, los incidentes y tus ajustes.
- En la consola ves la **media del equipo**; cada participante ve solo los suyos.
- Cada participante decide **una vez por situación** y no puede cambiar su respuesta. Hasta que decide, no ve la valoración de las opciones ni la idea clave.
- En el escenario por defecto: **Confianza del cliente** (en el despacho y en su trabajo), **Deontología** (respeto del secreto profesional, la diligencia y la lealtad con el cliente) y **Riesgo** (legal, deontológico o reputacional). Riesgo alto es malo.

---

## 7. El informe y el debriefing

### 7.1 Dónde está

- **En directo → Qué se decidió y por qué:** decisiones agrupadas por situación, con cuántos participantes eligieron cada opción, su consecuencia, su valoración, el «por qué» y la idea clave. El botón **CSV** descarga el detalle (una fila por decisión, con el nombre o alias del participante, separador «;», se abre directamente en Excel).
- **Pestaña Participantes:** cada persona con su situación actual, última actividad, puntuación, decisiones óptimas y críticas. **Excluir simulados de las estadísticas** quita el equipo simulado de los cálculos.
- **Pestaña Informe** (*Informe provisional* mientras la sesión sigue abierta): el **informe de impacto** maquetado para A4. **Descargar PDF** abre el diálogo de impresión; elige «Guardar como PDF». **Excluir simulados** aparece si la sesión tuvo equipo simulado.

El PDF incluye la tabla **Resultados por participante con sus nombres o alias**: trátalo como un documento con datos personales (apartado 14).

### 7.2 Qué mide

El informe de la consola es el **del equipo**: la puntuación y los objetivos se calculan con la media de los indicadores, y el resto con todas las decisiones. **Resultados por participante** aplica el mismo cálculo a cada persona. Cada participante ve solo su informe individual.

| Indicador | Cómo se calcula |
|---|---|
| **Puntuación /100** | Media de los dos primeros indicadores y de (100 − Riesgo). |
| **Decisiones óptimas** | Porcentaje de decisiones que el escenario valora como *Mejor opción*. |
| **Tiempo de reacción** | Porcentaje medio de tiempo que quedaba en la situación al decidir (en el CSV). |
| **Objetivos** | Tres: los dos primeros indicadores ≥ 55 y Riesgo ≤ 40. |
| **Decisiones críticas** | Número de decisiones valoradas como *Crítica*. |
| **Tiempos agotados** | En el informe del equipo, situaciones en las que venció el reloj; en el individual, las que vencieron sin que la persona hubiera decidido. |

El informe de impacto añade la distribución de votos por situación, las decisiones más frecuentes, las ideas clave y una nota metodológica. Si la sesión se finalizó antes de tiempo, las situaciones no jugadas aparecen como «Sin jugar».

### 7.3 Cómo usarlo bien

- La valoración es **de la decisión según el diseño del escenario, no de la persona**. Preséntala así: «esta opción es la que mejor protege el secreto profesional…», nunca «lo has hecho mal».
- En las sesiones el resultado se calcula con **reglas fijas del escenario**: no interviene ningún modelo de IA en la valoración. El sistema **no mide emociones, estrés ni estados psicológicos**, y no observa por cámara ni analiza la voz.
- El informe es un apoyo para la conversación. **No lo uses como única base para evaluar** a nadie (por ejemplo, en una evaluación del desempeño o en una acreditación de formación): si la actividad es evaluable, la valoración la haces tú con tu criterio.
- Para comentar con el equipo usa el **proyector** o el informe sin la tabla de participantes; no proyectes la consola, que muestra nombres y alias.

---

## 8. Guion de debriefing (12 minutos) · «Uso responsable de la IA en el despacho»

**Objetivo:** que el equipo formule con sus palabras cuatro reglas prácticas: proteger el secreto profesional y los datos del cliente, verificar en fuentes oficiales lo que produce la IA, contratar las herramientas con garantías y ser transparente con el cliente.

**Material:** el proyector con la respuesta revelada en cada situación (o el informe sin nombres) y una pizarra para anotar las cuatro reglas.

| Minuto | Bloque |
|---|---|
| 0:00 – 1:00 | Apertura |
| 1:00 – 3:30 | Situación 1 · Secreto profesional |
| 3:30 – 6:00 | Situación 2 · Jurisprudencia inventada |
| 6:00 – 8:30 | Situación 3 · Contratar un proveedor de IA |
| 8:30 – 11:00 | Situación 4 · Transparencia con el cliente |
| 11:00 – 12:00 | Cierre y compromiso |

### 0:00 – 1:00 · Apertura

- «¿Con qué palabra describiríais la sesión?» (ronda rápida, sin debatir).
- Muestra la tarjeta **Vuestro equipo frente a la media** o la puntuación del equipo. Recuerda que valoramos decisiones, no personas, y que no hay preguntas trampa: las cuatro situaciones son reales y frecuentes en la práctica.

### 1:00 – 3:30 · Situación 1: Secreto profesional

*Una abogada junior quiere pegar el expediente completo de un cliente (nombre, DNI, historia clínica e informes periciales) en un chat de IA generativa público y gratuito para que le redacte una demanda por negligencia médica.*

| Opción | Valoración del escenario |
|---|---|
| Eliminar los datos que identifican al cliente y a terceros y usar solo la herramienta de IA contratada por el despacho | Mejor opción |
| Redactar la demanda sin IA para no correr ningún riesgo | Aceptable |
| Llamar al cliente, pedirle permiso de palabra y pegar el expediente completo | Crítica |
| Pegar el expediente completo en el chat público | Crítica |

Preguntas para el equipo:

1. ¿Qué opción elegisteis la mayoría y qué os hizo decidir?
2. ¿Qué datos de ese expediente son de categoría especial? ¿Bastaría con quitar el nombre o hay otros datos que permiten identificar al cliente o a terceros?
3. ¿Qué diferencia hay entre una herramienta contratada por el despacho y un chat público? ¿Sabéis cuál está autorizada en vuestro despacho?
4. ¿Por qué un permiso verbal del cliente no resuelve el problema? ¿Es «no usar IA» siempre lo más responsable?

**Idea clave:** el secreto profesional y el RGPD también rigen frente a la IA. Elimina los datos identificativos y sensibles y trabaja solo con herramientas contratadas por el despacho con garantías.

### 3:30 – 6:00 · Situación 2: Jurisprudencia inventada

*El plazo para presentar un escrito de oposición vence hoy. El borrador generado con IA cita tres sentencias del Tribunal Supremo, pero una no aparece en CENDOJ.*

| Opción | Valoración del escenario |
|---|---|
| Comprobar cada sentencia en CENDOJ o en la base de datos del despacho y retirar las que no se puedan verificar | Mejor opción |
| Quitar todas las citas jurisprudenciales y presentar el escrito sin ellas | Aceptable |
| Pedir a la misma IA que confirme que las sentencias existen | Crítica |
| Presentarlo tal cual: no hay tiempo para revisar | Crítica |

Preguntas para el equipo:

1. ¿Por qué una sentencia que «encaja a la perfección» puede no existir? ¿Os ha pasado?
2. ¿Por qué no sirve pedir a la misma IA que se verifique a sí misma?
3. ¿Quién responde ante el tribunal y ante el cliente por lo que se presenta? ¿Traslada la prisa la responsabilidad a la herramienta?
4. ¿Qué fuentes oficiales usaríais para comprobar una cita?

**Idea clave:** quien firma, responde. La IA puede inventar sentencias verosímiles: verifica cada cita en fuentes oficiales antes de presentar.

### 6:00 – 8:30 · Situación 3: Contratar un proveedor de IA

*El despacho quiere contratar una herramienta de IA. El proveedor ofrece aceptar sus condiciones generales en línea; no está claro dónde se alojan los datos ni si se usarán para entrenar sus modelos.*

| Opción | Valoración del escenario |
|---|---|
| Exigir contrato de encargado del tratamiento, confidencialidad, no entrenar con datos de clientes, datos en la UE o con garantías, y formar al equipo | Mejor opción |
| Probar la herramienta solo con documentos sin datos de clientes hasta cerrar el contrato | Aceptable |
| Aceptar las condiciones generales en línea: el proveedor es conocido | Crítica |
| Empezar ya con la versión gratuita y con casos reales mientras se negocia el contrato | Crítica |

Preguntas para el equipo:

1. ¿Qué debe incluir, como mínimo, el contrato con un proveedor que va a tratar datos de clientes (artículo 28 del RGPD)?
2. ¿Por qué importa si el proveedor entrena con los contenidos y dónde los aloja?
3. ¿Qué exige el Reglamento de IA sobre la alfabetización en IA del personal?
4. ¿Qué se gana y qué falta en la opción de probar sin datos de clientes?

**Idea clave:** antes de introducir datos de clientes en una herramienta de IA: contrato de encargado, confidencialidad, sin entrenamiento con esos datos, ubicación clara y formación del equipo.

### 8:30 – 11:00 · Situación 4: Transparencia con el cliente

*Una clienta recibe la minuta de un recurso y pregunta si el despacho usó IA y cómo se refleja en las horas facturadas. La hoja de encargo prevé honorarios por horas.*

| Opción | Valoración del escenario |
|---|---|
| Explicar qué tareas se apoyaron en IA, que un abogado lo revisó todo y cómo se reflejan en las horas según la hoja de encargo | Mejor opción |
| Responder que el despacho usa herramientas tecnológicas, sin entrar en detalles | Aceptable |
| Reconocer el uso de IA, pero mantener las horas como si todo se hubiera hecho a mano | Crítica |
| Decirle que no se usó IA para evitar dudas | Crítica |

Preguntas para el equipo:

1. ¿Qué debe saber el cliente sobre cómo se ha trabajado su asunto?
2. En honorarios por horas, ¿qué tiempo se puede facturar cuando una tarea se apoya en IA?
3. ¿Qué consecuencias puede tener faltar a la verdad con el cliente?
4. ¿Por qué la respuesta genérica, aunque no es falsa, se queda corta?

**Idea clave:** la confianza del cliente se apoya en la información veraz. Explica cómo se ha usado la IA, que un abogado revisó el trabajo, y factura conforme a lo pactado en la hoja de encargo.

### 11:00 – 12:00 · Cierre y compromiso

- Pide al equipo que dicte las cuatro reglas y escríbelas en la pizarra (por ejemplo: *minimiza los datos y usa solo herramientas contratadas*; *verifica cada cita en la fuente oficial*; *sin contrato y garantías no entran datos de clientes*; *di la verdad al cliente sobre el uso de la IA y factura lo pactado*).
- Pregunta: «¿Qué vais a hacer distinto la próxima semana en el despacho?». Una respuesta por persona o por grupo.
- Si quedó tiempo agotado en alguna situación, coméntalo en positivo: en la práctica también se decide con plazos encima, y por eso conviene tener reglas claras de antemano.

---

## 9. Analítica

**Analítica** (menú lateral) muestra cómo deciden los equipos **en conjunto** en tu organización. Cualquier formador puede consultarla.

- **Filtros:** periodo (*Últimos 30 días*, *Últimos 90 días*, *Últimos 12 meses* o *Todo*), escenario e **Incluir equipos simulados** (desactivado por defecto).
- **Bloques:** totales (sesiones, participantes, decisiones, finalización, decisiones óptimas y mediana del tiempo de decisión), **Evolución semanal**, **Dónde necesita refuerzo el equipo** (situaciones con menor proporción de decisiones óptimas y la opción no óptima más elegida), **Impacto en los indicadores** (sesiones finalizadas), **Por escenario** y **Sesiones recientes**.
- Solo datos agregados: nunca muestra ni ordena a personas. Cuando no hay datos indica «Sin datos aún», nunca 0 %. Una decisión de hace unos segundos puede tardar un poco en contar.

Úsala para preparar el debate o revisar qué situaciones conviene reforzar, no para evaluar a nadie.

---

## 10. Voz de VictorIA en el proyector

Cuando se revela la respuesta de una situación que el proyector vio abierta, VictorIA comenta el resultado del equipo con una frase **de plantilla fija** (sin IA generativa) que usa los datos agregados reales: el porcentaje que eligió la mejor opción y, si llega al 15 %, la opción no óptima más elegida. También comenta la comparación con la media. Habla del grupo y de decisiones, nunca de personas; sin votos no hay comentario.

- El comentario aparece **siempre como subtítulo**, con la nota «Comentario automático generado a partir de los votos» (o «…de los datos agregados»). Se cierra con × o **Esc**.
- Si el servicio de voz está configurado, el botón **Voz de VictorIA** (tecla **V**) lo lee en voz alta con síntesis de **Soniox en tiempo real** (voz «Carmen»). El texto que se envía a Soniox es solo esa frase de plantilla, sin nombres ni datos de participantes. El navegador recuerda si la dejaste activada.
- El audio se habilita con tu primer clic o tecla dentro del proyector. Cambiar de situación o pulsar **Esc** corta la voz. Si la voz falla, queda solo el subtítulo.

---

## 11. Equipo simulado y Demo rápida

- **Simular equipo** (en la barra de la sesión, solo el formador que la creó) añade 20 **participantes simulados** («Participante simulado 01», …) que deciden solos a los pocos segundos de abrirse cada situación. Sirven para ensayar el proyector, la revelación de la respuesta y el informe sin participantes reales. **Quitar simulados** los retira con sus decisiones.
- **Demo rápida** (Inicio y Sesiones) crea en un clic una sesión del escenario por defecto llamada «Demo · <fecha y hora>», añade el equipo simulado y abre el proyector.
- Los simulados aparecen marcados como *Simulado* en la consola y en el informe. Puedes excluirlos de las estadísticas, del informe y de la analítica; la analítica los excluye por defecto.
- **Elimina las sesiones de demostración** («Demo · …» y de prueba) en cuanto termines, y siempre antes de empezar el piloto: aunque se excluyan, ocupan el listado y se conservan hasta su borrado.

---

## 12. Modo IA en vivo (demo)

Es una **demostración separada** del simulador de sesiones, solo para formadores. Está activa en el entorno actual y se accede desde **Escenarios**. A diferencia de las sesiones, aquí VictorIA **sí usa IA generativa**.

### 12.1 Cómo funciona

1. Crea una **colección de conocimiento** (**Nueva colección**) y sube documentos: PDF, DOCX, TXT, MD o texto pegado (hasta 20 MB y 300 000 caracteres por documento, 10 documentos por colección). Un PDF escaneado sin texto no se puede leer.
2. Inicia una **partida** de 3 a 6 situaciones, opcionalmente con un tema.
3. VictorIA genera cada situación y cuatro opciones **solo a partir de los fragmentos de tus documentos**, citándolos; la narra con voz sintética, tú respondes por voz o tocando la opción, y te contesta preguntas sobre el contenido («No lo sé con estos documentos» si no está).

La pantalla muestra en todo momento «Generado con IA a partir de tus documentos · puede contener errores».

### 12.2 Reglas de uso

- **No subas documentos con datos personales ni información de clientes** (expedientes, escritos de asuntos reales, correos, listados de personal, casos identificables) ni digas datos personales en voz alta. Usa normativa, códigos deontológicos, protocolos internos o casos ficticios. Los documentos se guardan en el almacenamiento del servicio y se procesan con Cloudflare Workers AI, cuya ubicación de procesamiento no está garantizada en la UE; la voz se procesa con Soniox en Estados Unidos.
- No uses este modo con participantes hasta que la organización cliente lo valide (ver *Privacidad y transparencia*, Parte C).
- Las colecciones **no se borran solas**: elimina las que ya no uses (y las de prueba) desde la propia colección. Las partidas se borran automáticamente a los 365 días.
- Si se alcanza la cuota diaria de IA aparece «Se ha alcanzado el límite diario de IA. Inténtalo más tarde.».

### 12.3 «Convertir en escenario para sesiones»

Al terminar una partida (o desde **Partidas recientes** de la colección, con al menos 2 situaciones generadas), **Convertir en escenario para sesiones** crea un **borrador** con las situaciones ya generadas, sin volver a usar la IA. Antes de publicarlo **debes revisarlo**: textos, opciones, valoración de cada opción, «por qué» e idea clave. El borrador se guarda solo en tu navegador hasta que lo publiques.

Al pulsar **Publicar escenario** confirmas que has revisado el contenido generado con IA. El escenario queda en **Tus escenarios** con la marca **Creado con IA · revisado por <tu nombre>** y se usa como cualquier otro (QR, proyector, informe, analítica). Las sesiones con estos escenarios avisan a los participantes de que el escenario se redactó con IA y lo revisó un formador. Como cualquier escenario publicado, no se puede modificar: un cambio es una versión nueva.

---

## 13. Buenas prácticas de facilitación

**Antes**

- Presenta a VictorIA como lo que es: **un personaje virtual con imagen y voz sintéticas**. En las sesiones sus intervenciones están escritas de antemano en el escenario (o redactadas con IA y revisadas por un formador, si el escenario lo indica) y sus reacciones son grabaciones fijas; no conversa ni se adapta a la persona. La conversación con IA solo existe en el Modo IA en vivo, que es una demostración aparte.
- Explica qué se registra (alias o nombre, decisiones y tiempos) y qué no (audio, imagen, emociones). Explica que la voz es opcional y dónde se procesa. Puedes apoyarte en la *Guía del participante*.
- Recomienda un alias sin datos personales.
- Deja claro si la actividad es formativa o evaluable y con qué criterios.
- Recuerda que las situaciones son ficticias: nadie debe aportar datos de asuntos o clientes reales.

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
- Cierra con reglas concretas y aplicables en el despacho.

**Después**

- Si descargas el PDF, el CSV o el JSON, guárdalos solo en el almacenamiento que indique tu organización y bórralos cuando ya no los necesites: contienen nombres o alias.
- Elimina las sesiones de prueba y de demostración.

---

## 14. Datos de la sesión: exportar y eliminar

Desde el menú **Más** de la sesión o el menú de su fila en **Sesiones**:

- **Exportar datos (JSON):** descarga todo lo registrado en la sesión (estado, participantes, decisiones, cronología de eventos e informe). Úsalo para atender una solicitud de acceso o portabilidad o para archivar resultados según indique tu organización. La exportación queda anotada en la auditoría.
- **Eliminar → Eliminar definitivamente:** borra la sesión, sus decisiones, sus indicadores y su informe, y también su **código de unión y los invitados** que entraron con él. **No se puede deshacer.** Solo queda una anotación en la auditoría de que la sesión se eliminó, sin su contenido. En **Sesiones** puedes eliminar varias a la vez con la selección múltiple.

Solo el formador que creó la sesión puede exportarla o eliminarla (si ya no es miembro de la organización, cualquier otro formador).

**Conservación automática:**

- Las sesiones **finalizadas** se borran **365 días después de su finalización**, y las que nunca se finalizan, **365 días después de su creación**.
- El **acceso de un invitado** caduca a las **12 horas** de unirse o **2 horas después de finalizar la sesión** (para que pueda leer su resumen), lo que ocurra antes; después se borra. Su alias se mantiene en los datos de la sesión hasta que esta se elimine o caduque.
- Las partidas del Modo IA se borran a los 365 días; las colecciones, solo cuando las elimina el formador.

Aun así, elimina las sesiones de prueba en cuanto no las necesites.

Si un participante pide acceder a sus datos o que se borren, sigue el procedimiento de tu organización para el ejercicio de derechos. En la pestaña **Participantes** de la sesión, el menú de cada persona ofrece **Exportar sus datos (JSON)** (solo sus datos) y **Retirar de la sesión** (borra a esa persona, sus decisiones y sus indicadores; no se puede deshacer, así que exporta antes si lo necesitas). **[Validar cliente]** Definir el canal (delegado de protección de datos o la persona responsable) y el plazo de respuesta.

---

## 15. Problemas frecuentes

| Mensaje o situación | Qué significa | Qué hacer |
|---|---|---|
| «El correo o el código no son correctos. Revisa los datos o pide un código nuevo a tu formador.» | Al entrar con cuenta: el correo no coincide con el alta, el código se ha cambiado o revocado, o la persona no es miembro. | Comprueba el correo y genera un código nuevo en **Participantes y accesos**. |
| «Demasiados intentos. Espera unos minutos y vuelve a probar.» / «Demasiados intentos. Espera unos minutos.» | Límite de seguridad de intentos de acceso o de códigos de sesión erróneos (en una sala todo el equipo suele compartir la misma conexión). | Esperar unos minutos y teclear el código con cuidado; mejor escanear el QR. |
| «Ese código no corresponde a ninguna sesión abierta. Revísalo en la pantalla de la sala.» / «El código ya no es válido. Revísalo en la pantalla de la sala.» | En `/unirse`: código mal tecleado, regenerado o de una sesión finalizada o eliminada. | Proyecta el QR (tecla **Q**) y comprueba el código actual. |
| «Esta sesión ya ha terminado. Pide el código de la sesión actual.» | El código es de una sesión finalizada. | Crea o duplica una sesión y comparte su QR. |
| «El alias debe tener entre 2 y 30 caracteres: letras, números, espacios, punto, guion o guion bajo.» | Alias no válido (también se rechazan correos y direcciones web). | Elegir otro alias. |
| «Acceso de invitado limitado a su sesión.» | Un invitado ha intentado abrir algo que no es su sesión. | Que vuelva a `/unirse` con el código de la sesión correcta. |
| «La sesión ha terminado · Tu acceso de invitado ha caducado» (móvil) | Han pasado 12 horas o la sesión terminó hace más de 2 horas. | Si hay una sesión nueva, unirse con su código. |
| «Reconectando…» / «Sin conexión. Reintentando…» | Corte de red o de la conexión en directo. | Esperar unos segundos; si persiste, recargar la página. |
| «No encuentro esta sesión. Comprueba el enlace o el código de la pantalla de la sala…» (3D) | Enlace incompleto, sesión eliminada o de otra organización. | Vuelve a copiar el enlace desde la consola. |
| «Abre el simulador desde el enlace que te comparta tu formador.» (3D) | Se abrió el simulador sin el enlace de la sesión. | Comparte el enlace completo con **Copiar enlace**. |
| «No tienes acceso a esta sesión o tu acceso ha caducado…» (3D) | Sin cuenta válida o invitado caducado o de otra sesión. | Entrar con el código de la pantalla de la sala o pedir acceso. |
| «Sin conexión con la sesión · reintentando…» (3D) | Corte de red. | Esperar; si persiste, recargar la página. |
| «Voz no disponible · elige con el ratón» | Solo en el ejecutable de Windows: no hay micrófono o Windows no deja abrirlo. | Responder con el ratón o las teclas 1-4. |
| «Permite el micrófono en el navegador para responder con la voz.» (móvil) | Se denegó el permiso de micrófono. | Responder tocando la opción o dar permiso en el navegador. |
| «Ese correo no se puede dar de alta en esta organización.» | El correo ya pertenece a otra organización. | Avisa al equipo técnico. |
| «Espera al menos una decisión.» | Se intentó avanzar sin ninguna decisión en la situación. | Espera a que decida al menos un participante. |
| «Reanuda la sesión antes de avanzar.» | La sesión está pausada. | Pulsa **Reanudar**. |
| «Es la última fase; finaliza la sesión.» | Estás en la última situación. | Pulsa **Finalizar sesión**. |
| «Demasiadas peticiones. Espera unos segundos.» | Límite de seguridad de uso (300 peticiones por minuto y usuario). | Esperar y reintentar. |
| «Se ha alcanzado el límite diario de IA. Inténtalo más tarde.» | Modo IA en vivo: cuota diaria de Workers AI agotada. | Volver a intentarlo otro día o avisar al equipo técnico. |

**Soporte:** **[Validar cliente]** Indicar el contacto de soporte durante el piloto.
