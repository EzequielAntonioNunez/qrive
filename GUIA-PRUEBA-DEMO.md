# Guía de prueba en el equipo de la demo

Guía paso a paso para comprobar, en el equipo y la red reales de la presentación, todo lo que no se pudo probar en el equipo de desarrollo: audio y lip sync, micrófono real en móvil, escaneo del QR, simulador 3D en el navegador y Modo IA con un documento real.

- **Tiempo necesario:** unos 60 minutos la primera vez (unos 20 si solo repasas la lista final).
- **Dirección de la plataforma:** https://axyro.qhel.dev
- **Regla de oro:** haz la prueba completa **en el mismo equipo, navegador, red y sala** que usarás en la demo. Si algo falla, anota el paso y el mensaje exacto (sección 12).

---

## 0. Qué necesitas antes de empezar

| Necesitas | Detalle |
|---|---|
| Equipo de la demo | El portátil que irá conectado al proyector o pantalla. Chrome o Edge actualizados (Menú ⋮ → Ayuda → Información). |
| Altavoces | Los que usarás en la sala (o los del portátil). Volumen al 70 % para empezar. |
| Micrófono | El del portátil o uno externo. Comprueba que Windows lo detecta: *Configuración → Sistema → Sonido → Entrada* y habla: la barra debe moverse. |
| Dos móviles | Uno **iPhone** (Safari) y uno **Android** (Chrome), con cámara y datos o wifi. |
| Tu acceso de docente | Tu correo y tu código personal de seis cifras. |
| Un documento para el Modo IA | PDF o Word **con texto seleccionable** (no escaneado) y **sin datos personales**, por ejemplo una política o guía de uso de IA. Entre 5 y 40 páginas es lo ideal. |
| Red | La wifi de la sala si es posible. Si no la conoces, prueba con la red que vayas a usar y ten a mano el móvil para compartir datos como plan B. |

---

## 1. Preparar el equipo (5 minutos)

1. **Cierra** las aplicaciones que puedan usar el micrófono o los altavoces: Teams, Zoom, Meet, grabadoras.
2. **Desactiva el ahorro de energía y el apagado de pantalla** durante la demo: *Configuración → Sistema → Energía* → «Nunca» al estar enchufado.
3. **Conecta el proyector o la pantalla** y elige *Duplicar* (Windows + P) si quieres ver lo mismo que la sala, o *Extender* si vas a usar el proyector como segunda pantalla.
4. Abre **Chrome o Edge** y pon el zoom al **100 %** (Ctrl + 0).
5. Abre https://axyro.qhel.dev y comprueba que carga la pantalla «Accede con tu código» con el logotipo de la UFV.
6. **Permisos del navegador para la plataforma:** pulsa el icono de la izquierda de la dirección (🔒 o ajustes) → *Configuración del sitio* → **Micrófono: Permitir** y **Sonido: Permitir**. Si no aparece todavía, lo pedirá la primera vez que actives la voz.

✅ **Resultado esperado:** la página de acceso se ve bien y sin errores.

---

## 2. Entrar como docente (2 minutos)

1. En https://axyro.qhel.dev escribe **tu correo** y **tu código personal** y pulsa **Entrar**.
2. Verás **Inicio** con el mensaje de bienvenida y el botón **«Crear tu primera sesión»** (la organización está vacía: es lo correcto).
3. Revisa el menú lateral: **Inicio · Sesiones · Analítica · Escenarios · Participantes y accesos** y tu correo abajo.

✅ **Resultado esperado:** entras sin errores y no aparece ninguna sesión antigua.

---

## 3. Prueba A · Crear una sesión y abrir el proyector (5 minutos)

1. Pulsa **Nueva sesión**.
2. **Paso 1 · Escenario:** elige **«Uso responsable de la IA en la universidad»**. (Opcional: «Ver situaciones» para ver el contenido.)
3. **Paso 2 · Detalles:** escribe un nombre, por ejemplo `Prueba demo · Grupo A`, y continúa.
4. **Paso 3 · Listo:** verás el **QR**, el **código de seis cifras** y los botones **«Abrir panel de la sesión»** y **«Proyectar en clase»**. Pulsa **«Abrir panel de la sesión»**.
5. En el detalle de la sesión comprueba la barra de acciones: **Pausar**, **Siguiente situación**, **Finalizar**, **Proyectar**, **Simular clase**, **Copiar enlace** y **Más**.
6. Pulsa **Proyectar** (en la barra de acciones). Se abre la vista de proyector a pantalla completa con el panel **«Únete»** (QR y código grande).
   - En la barra superior del proyector tienes **Únete (QR)**, **Voz de VictorIA** (si el servicio de voz está activo), **Pausar** / **Reanudar**, **Finalizar**, **Pantalla completa** y **Salir**.
   - **Q** muestra u oculta el panel del QR.
   - **Esc** sale del proyector.

✅ **Resultado esperado:** el QR y el código se leen bien **desde el fondo de la sala** (compruébalo físicamente). El panel del proyector no escribe ninguna dirección, pero **el QR y el botón «Copiar enlace de unión» sí llevan la dirección provisional** (`axyro.qhel.dev/unirse/…`): el móvil la muestra al escanear. Es lo esperado mientras no haya un dominio de la UFV; solo se corrige al cambiar de dominio.

---

## 4. Prueba B · Unirse desde el móvil y votar (10 minutos)

Hazlo primero con el **iPhone** y después repítelo con el **Android**.

### 4.1 Unirse
1. Con la **cámara del móvil**, apunta al QR del proyector y toca el enlace que aparece.
   - Si el QR no se lee: abre en el móvil https://axyro.qhel.dev/unirse y escribe el código de seis cifras.
2. Verás el título de la sesión. Escribe un **alias** (2 a 30 caracteres, por ejemplo `Inversor 1`) y pulsa **Entrar**.
3. Pulsa **Empezar** (este toque activa el sonido en el iPhone).

✅ En el **proyector** el contador de participantes sube a 1.

### 4.2 Escuchar y votar tocando
1. En el móvil pulsa **▶ Escuchar a VictorIA**. **Debe oírse la voz** (sube el volumen del móvil y quita el modo silencio del iPhone).
2. Toca una opción (A, B, C…) y pulsa **Confirmar**.
3. Deben ocurrir tres cosas:
   - El móvil muestra el **resultado** con «Por qué» e «Idea clave».
   - **VictorIA responde con voz** a tu decisión (reacción hablada).
   - En el **proyector, la barra de esa opción se mueve en directo** (en uno o dos segundos).

### 4.3 Responder con la voz (en la situación siguiente)
1. En el equipo del docente pulsa **Siguiente situación** (en el proyector está en la columna derecha, bajo el temporizador, cuando hay al menos un voto).
2. En el móvil pulsa **🎙 Responder con la voz**.
3. Aparece el aviso: la voz se transcribe en Soniox (EE. UU.) y no se guarda. Pulsa **🎙 Aceptar y activar** y **permite el micrófono** cuando el móvil lo pida.
4. Prueba dos formas:
   - **Orden corta:** di claramente **«la dos»**. Debe decidir la opción 2.
   - **Con tus palabras** (en otra situación): di algo como *«yo quitaría los nombres y usaría la herramienta de la universidad»*. Debe elegir la opción correcta o preguntarte **«¿Te refieres a la opción…?»**; responde **«sí»** o **«no»**.
5. Prueba a **interrumpir** (en otra situación, con la voz activa): pulsa **▶ Escuchar a VictorIA** y, mientras habla, di «la uno». **Su voz debe cortarse al momento** (basta con que se reconozca una palabra) y se decide la opción 1.
6. **Decidir con el tiempo agotado:** en una situación deja que el temporizador llegue a 0:00 sin votar. El móvil muestra «Se acabó el tiempo de esta situación: puedes decidir igualmente» **y siguen las opciones**: elige una y confirma; la decisión se registra y aparece en el proyector.
7. Comprueba que, al pie de la pantalla del móvil, se ve el aviso discreto «VictorIA es un personaje virtual: su imagen y su voz son sintéticas.» (en un escenario creado con IA: «Escenario redactado con IA a partir de documentos y revisado por un docente…»).

> La voz (micrófono en el móvil y voz de VictorIA en el proyector) funciona con el servicio de voz configurado y **no depende de que esté activado el Modo IA en vivo**.

✅ **Resultado esperado:** en iPhone y Android se oye la voz, el micrófono funciona, la interrupción corta a VictorIA, se puede decidir con el tiempo agotado y las decisiones aparecen en el proyector.

---

## 5. Prueba C · Demo rápida, voz de VictorIA en el proyector y finalizar (8 minutos)

1. Ve a **Inicio** (o **Sesiones**) y pulsa **Demo rápida**. En unos segundos verás «Preparando la demo…» con tres pasos y se abrirá el **proyector a pantalla completa** con una sesión nueva y **20 participantes simulados**; las barras se llenan solas.
   - Alternativa manual: en el detalle de una sesión pulsa **Simular clase** y luego **Proyectar**.
2. Comprueba que en la barra superior del proyector aparece **«Voz de VictorIA»** activada (tecla **V** para activarla o desactivarla). Aparece siempre que el servicio de voz esté configurado, esté o no activado el Modo IA en vivo; si no aparece, el proyector funciona igual, solo con subtítulos.
3. Haz **un clic** en el proyector (desbloquea el audio) y, cuando haya votos, pulsa **Mostrar respuesta**:
   - Se revela la mejor opción y la **Idea clave**.
   - **VictorIA comenta en voz alta los resultados de la clase** (por ejemplo, el porcentaje que eligió la mejor opción) y aparece el texto como subtítulo con la nota «Comentario automático generado a partir de los votos».
   - Escucha cómo pronuncia los porcentajes y los títulos de las opciones. **Esc** corta la voz.
4. Avanza con **Siguiente situación** y comprueba que las barras vuelven a cero y se llenan de nuevo.
5. Sin salir del proyector, prueba **Pausar** y **Reanudar** en su barra superior (en el móvil debe verse «Sesión en pausa»).
6. Pulsa **Finalizar** en la barra superior del proyector antes de llegar a la última situación: aparece el aviso «¿Finalizar la sesión antes de tiempo?» con las situaciones que quedarán sin jugar. Pulsa **Cancelar** una vez para comprobar que no pasa nada; después vuelve a pulsar **Finalizar** y confirma con **Finalizar sesión**. (En la última situación el aviso es «¿Finalizar la sesión?».)
7. En el móvil debe aparecer el **resumen personal** de la sesión.
8. En el proyector, tras el comentario de la última situación, se abre **automáticamente** la tarjeta **«Vuestra clase frente a la media»** (al finalizar desde el proyector). En la primera sesión de la organización dirá «Primera sesión de la organización: aún no hay media con la que comparar»; a partir de la segunda sesión finalizada mostrará las dos barras. También puedes abrirla o cerrarla en cualquier momento con **Comparar con la media**.

✅ **Resultado esperado:** todo responde sin recargar la página y el indicador muestra «En directo».

---

## 6. Prueba D · Simulador 3D en el ordenador (10 minutos)

La experiencia 3D es para ordenador (pesa unos 38 MB); en móvil se usa la vista web.

1. Crea una **sesión nueva** (repite el paso 3, nombre `Prueba 3D`).
2. Abre el 3D de una de estas dos formas:
   - **Como invitado (recomendado):** en el portátil, abre en **otra ventana de incógnito** (Ctrl + Mayús + N) el enlace de unión (botón **Copiar enlace de unión** debajo del QR), entra con un alias y pulsa **Abrir en 3D**.
   - **Con cuenta de participante:** en una ventana de incógnito entra con el correo y código de una cuenta de participante y abre **Copiar enlace** → pega el enlace del simulador 3D.
3. Observa la **pantalla de carga** «Preparando a VictorIA…» con barra de progreso en MB. Anota cuánto tarda en tu red.
4. Cuando termine, **haz un clic** en la escena: VictorIA empieza a hablar.
5. Comprueba:
   - **Se oye la voz** y **se mueve la boca** al hablar (lip sync).
   - Aparece la **pantalla de la pared** con el objeto de la situación (por ejemplo, la hoja de notas difuminada).
   - Al terminar de hablar aparecen las **opciones**. Si el audio fallara, aparecen igualmente a los pocos segundos.
   - Elige con el **ratón** o con las **teclas 1–4**: VictorIA **responde con voz** y aparece el resultado a la derecha.
   - **Repetir** vuelve a reproducir la situación.
   - **F11** pantalla completa.
6. **Voz en el 3D:** pulsa **🎙 Activar voz** (arriba en el centro) → **Aceptar y activar** → permite el micrófono → di «la dos».
7. **Segunda carga:** cierra la pestaña y vuelve a abrir el 3D. Debe cargar **casi al instante** (queda en la caché del navegador).

✅ **Resultado esperado:** se oye, se mueve la boca, las opciones aparecen siempre y la segunda carga es rápida.

> **Para la demo:** abre el 3D **una vez antes de entrar a la reunión** para que quede en la caché.

---

## 7. Prueba E · Informe y analítica (5 minutos)

1. Abre la sesión finalizada de la prueba C → pestaña **Informe**.
2. Pulsa **Descargar PDF**. En el diálogo de impresión elige **Destino: Guardar como PDF**, papel **A4**, márgenes **Predeterminados**, y activa **Gráficos de fondo** (*Más opciones*). Guarda y abre el PDF.
   - Comprueba que se ven la cabecera UFV, el resumen, las barras y la tabla de participantes.
3. Ve a **Analítica**:
   - Por defecto excluye las clases simuladas: si solo hubo simulados verás un aviso con **Incluir clases simuladas**; púlsalo.
   - Revisa los indicadores, la tendencia y «Dónde necesita refuerzo la clase».

✅ **Resultado esperado:** el PDF se ve profesional y la analítica muestra datos (o «Sin datos aún» donde corresponde).

---

## 8. Prueba F · Modo IA en vivo con tu documento (15 minutos)

1. Ve a **Escenarios → pestaña «Modo IA en vivo · demo»**.
2. Pulsa **Nueva colección**, ponle nombre (por ejemplo `Política de IA`) y créala.
3. **Arrastra tu PDF o Word** a la zona de subida (o usa **Pegar texto**). Espera a que el documento quede **«Listo · N caracteres»**.
   - Si dice que no se ha podido extraer texto: el PDF es escaneado. Usa otro o pega el texto.
4. Pulsa **Iniciar simulación con IA**, elige **3 situaciones** y, si quieres, un **enfoque** (por ejemplo `protección de datos`). Inicia.
5. Pulsa **Empezar con voz** (acepta el aviso y permite el micrófono). Si prefieres probar sin micrófono: **Empezar sin micrófono** y escribe en la caja de texto.
6. Comprueba el flujo:
   - VictorIA **narra la situación** con su voz y aparecen 4 opciones con las **fuentes** de tu documento.
   - **Responde hablando** (con tus palabras o «la dos»). VictorIA reacciona explicando por qué.
   - **Hazle una pregunta** sobre el documento, por ejemplo *«¿qué dice sobre los datos personales?»*: debe contestar citando la fuente.
   - Prueba una pregunta fuera del documento (*«¿cuánto cuesta la matrícula?»*): debe decir que no lo sabe con estos documentos.
   - **Interrúmpela** hablando mientras narra.
7. Al terminar escucharás el **resumen**. Pulsa **Convertir en escenario para clase**.
8. En el **editor**, revisa los textos, cambia algo (por ejemplo el título) y pulsa **Publicar escenario**. Confirma.
9. En la página del escenario pulsa **Crear sesión con este escenario** y únete con un móvil (paso 4.1) para comprobar que funciona en clase.
   - Los escenarios creados con IA **no tienen voz pregrabada**: en el móvil no aparece «Escuchar» y en el 3D se ven los subtítulos. Es lo esperado.

⏱️ **Tiempos normales:** la primera situación tarda **12–15 segundos** (VictorIA dice una frase mientras tanto); las siguientes se preparan mientras habla.

> **Para la demo:** crea la simulación con IA **un minuto antes** de enseñarla, y ten ya subido el documento.

---

## 9. Prueba G · Participantes y accesos (opcional, 3 minutos)

1. Ve a **Participantes y accesos**.
2. Comprueba que aparecen tus usuarios con su rol y el estado de su código.
3. No generes ni revoques códigos de cuentas reales durante la prueba.

---

## 10. Dejar la plataforma limpia antes de la demo (3 minutos)

1. Ve a **Sesiones** → marca la casilla de la cabecera (**Seleccionar todas**) → **Eliminar** → **Eliminar N sesiones**.
2. (Opcional) En **Escenarios → Modo IA en vivo · demo**, deja la colección con tu documento si la vas a usar en la demo; borra las que no.
3. (Opcional) Si publicaste un escenario de prueba con IA, quedará en «Tus escenarios»; no molesta, pero puedes crear el de la demo de nuevo.
4. Abre el **simulador 3D una vez** (sección 6) para que quede en la caché.
5. Cierra las pestañas que no uses y deja abierta **Inicio** de la consola.

---

## 11. Si algo falla

| Síntoma | Qué hacer |
|---|---|
| No se oye nada | Volumen del sistema y del navegador; en el iPhone quita el modo silencio; en el 3D haz un clic en la escena; prueba con otros altavoces. |
| «Permite el micrófono…» o no escucha | Icono 🔒 junto a la dirección → Micrófono: Permitir → recarga. Cierra Teams/Zoom. En móvil: *Ajustes → Safari/Chrome → Micrófono*. |
| «Voz no disponible · elige con el ratón» | El micrófono no está accesible: elige con ratón, teclas 1–4 o tocando. La demo sigue funcionando. |
| El QR no abre nada | Abre `axyro.qhel.dev/unirse` en el móvil y escribe el código. Acerca más el móvil o sube el brillo del proyector. |
| «Ese código no corresponde a ninguna sesión abierta…», «El código ya no es válido…» o «Esta sesión ya ha terminado…» | La sesión está finalizada o el código se regeneró: usa el código que se ve ahora en el proyector. |
| «Demasiados intentos» | Espera unos minutos (protección frente a códigos al azar). |
| «Reconectando…» en la consola | Se recupera solo; si tarda, recarga la página (no se pierde nada). |
| El 3D tarda mucho en cargar | Red lenta: usa la vista web del móvil o comparte datos del móvil. La segunda carga es instantánea. |
| Modo IA: «Se ha alcanzado el límite diario de IA» | Se agotó la cuota gratuita de Cloudflare del día. Solución: plan de pago de Workers (5 $/mes) o esperar al día siguiente. |
| Modo IA: «La situación está tardando más de lo normal…» | El servidor espera hasta 60 segundos a que la situación esté lista. Espera unos segundos y vuelve a intentarlo, o recarga la página: retoma la situación en curso. |
| El proyector no habla al mostrar la respuesta | Comprueba que «Voz de VictorIA» está activada (tecla V) y que has hecho un clic en el proyector antes; si el botón no aparece, el servicio de voz no está configurado. Sin voz, el comentario aparece igualmente como subtítulo. |
| La voz de VictorIA en el Modo IA suena robótica | Se está usando la voz del navegador de reserva porque falló la de Soniox: recarga; si persiste, revisa el saldo de Soniox. |
| La página se queda en blanco | Recarga con Ctrl + F5. Si persiste, prueba en ventana de incógnito. |

---

## 12. Lista final y qué anotar

Marca cada casilla en el equipo y la red de la demo.

- [ ] Entro como docente y la organización está limpia.
- [ ] El QR se lee desde el fondo de la sala.
- [ ] iPhone: entra con alias, se oye VictorIA, voto tocando, voto por voz, interrupción por voz, reacción hablada y voto con el tiempo agotado.
- [ ] Android: lo mismo.
- [ ] El proyector se mueve en directo con cada voto.
- [ ] Demo rápida abre el proyector con la clase simulada en un clic.
- [ ] VictorIA comenta los resultados en voz alta al mostrar la respuesta (tecla V).
- [ ] Clase simulada, mostrar respuesta, siguiente, pausa y finalizar (con confirmación) funcionan desde el proyector.
- [ ] La tarjeta «Vuestra clase frente a la media» se abre sola al finalizar desde el proyector.
- [ ] 3D: carga en ___ segundos la primera vez y casi al instante la segunda.
- [ ] 3D: se oye, se mueve la boca, aparecen las opciones y responde con voz.
- [ ] 3D: la voz por micrófono funciona.
- [ ] El informe PDF se ve bien.
- [ ] La analítica muestra datos.
- [ ] Modo IA: el documento queda «Listo», narra con voz, responde preguntas citando la fuente, resumen y conversión a escenario.
- [ ] Sesiones de prueba eliminadas y 3D precargado.

**Si algo falla, anota y envíame:** el número de sección y paso, el dispositivo y navegador, el mensaje exacto (o una captura) y la hora aproximada. Con eso lo localizo en los registros del servidor.
