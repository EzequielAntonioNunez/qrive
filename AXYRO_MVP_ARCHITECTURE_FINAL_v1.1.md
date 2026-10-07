# AXYRO — Arquitectura y Roadmap de MVP

**Versión:** 1.1  
**Estado:** Baseline técnico definitivo para desarrollo del MVP  
**Objetivo:** construir y validar AXYRO SIM LAB con una arquitectura preparada para crecer hacia VR, IA avanzada y despliegues enterprise.

---

# 1. Producto

## AXYRO SIM LAB

Plataforma de simulación interactiva para:

- capacitación empresarial;
- educación;
- entrenamiento;
- simulación de situaciones reales;
- toma de decisiones;
- evaluación;
- debriefing;
- analítica de desempeño.

## Primer producto

### AXYRO SIM / DECISION

Una persona o equipo entra en un escenario y debe:

1. recibir información;
2. analizar una situación;
3. interactuar con personajes o sistemas;
4. tomar decisiones;
5. afrontar consecuencias;
6. resolver nuevos eventos;
7. recibir feedback;
8. realizar un debriefing con instructor.

El objetivo del MVP es validar que **empresas y centros educativos están dispuestos a utilizar y pagar por este tipo de simulación**.

---

# 2. Principio de producto

> **Build once. Deploy everywhere. Measure everything.**

No construiremos una aplicación nueva para cada cliente.

Construiremos un motor común donde podamos sustituir:

- escenario;
- contenido;
- reglas;
- branding;
- personajes;
- dificultad;
- assets;
- objetivos;
- métricas;
- evaluación.

---

# 3. Stack tecnológico inicial

## Simulación

### Unity 6 LTS + C#

Responsabilidades:

- motor de simulación;
- lógica;
- 2D / 3D;
- físicas;
- interacción;
- cámaras;
- sensores;
- audio;
- dispositivos;
- XR / VR futuro;
- ejecución local.

## Interfaz

### Rive

Responsabilidades:

- HUD;
- interfaces;
- animaciones;
- estados;
- feedback;
- puntuaciones;
- transiciones;
- componentes visuales reutilizables.

Rive se utilizará dentro de Unity y podrá reutilizarse en web.

## Frontend web

### React + TypeScript + Vite

Para:

- panel del instructor;
- administración;
- sesiones;
- escenarios;
- resultados;
- analytics;
- configuración.

## Backend

### TypeScript + Hono + Cloudflare Workers

Responsabilidades:

- API;
- autenticación;
- organizaciones;
- usuarios;
- sesiones;
- escenarios;
- resultados;
- permisos;
- auditoría;
- integración con IA;
- coordinación con Unity.

---

# 4. Estrategia Cloudflare-first

Durante validación utilizaremos Cloudflare siempre que sea viable.

Servicios previstos:

- Workers;
- D1;
- R2;
- Durable Objects;
- Queues;
- Workflows;
- Vectorize;
- AI Search;
- Workers AI;
- AI Gateway;
- Access;
- DNS;
- CDN;
- SSL;
- DDoS;
- WAF disponible en el plan utilizado.

## Objetivo

> **Coste cloud inicial lo más próximo posible a 0 €/mes.**

No añadiremos Azure, AWS o GCP mientras no exista una necesidad real de cliente, escala o compliance.

---

# 5. Arquitectura general

```text
                    AXYRO SIM LAB
                          │
                   Unity + Rive
                          │
                  HTTPS / WebSocket
                          │
                   CLOUDFLARE EDGE
                          │
                   Workers + Hono
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
       D1           Durable Objects          R2
        │                 │                  │
   negocio           realtime            archivos
        │
        ├────────── Queues
        │
        ├────────── Workflows
        │
        ├────────── AI Search / Vectorize
        │
        └────────── AI Gateway
                         │
              ┌──────────┼───────────┐
              │          │           │
          Workers AI   OpenAI    Anthropic / Gemini
```

---

# 6. Arquitectura híbrida

La simulación debe funcionar principalmente en local.

## Local

Unity gestiona:

- renderizado;
- lógica crítica;
- interacción;
- sensores;
- cámaras;
- audio;
- estado mínimo de contingencia;
- experiencia en tiempo real.

## Cloud

Cloudflare gestiona:

- usuarios;
- autenticación;
- escenarios;
- configuración;
- sincronización;
- resultados;
- IA;
- analytics;
- administración;
- conocimiento;
- auditoría.

## Principio

> La simulación no debe depender de Internet para ejecutar cada frame.

Esto mejora:

- latencia;
- estabilidad;
- privacidad;
- coste;
- resiliencia.

---

# 7. AXYRO Context Engine

> **Importante:** durante el MVP se diseñarán los contratos, eventos e interfaces necesarias para soportar el Context Engine, pero la implementación completa de Realtime RAG, personajes IA y voz pertenece a la **Fase 3 — IA avanzada**. No debe bloquear la validación inicial.

El RAG tradicional no es suficiente para una simulación.

AXYRO necesita un sistema capaz de combinar:

- conocimiento estable;
- estado de la simulación;
- historial de usuario;
- contexto del escenario;
- eventos que acaban de ocurrir.

Ese sistema será:

# AXYRO Context Engine

---

# 8. RAG en tiempo real — Realtime RAG

## Objetivo

Permitir que la IA conozca simultáneamente:

- qué está pasando ahora;
- qué ocurrió anteriormente;
- qué sabe el escenario;
- qué sabe el usuario;
- qué dicen los documentos;
- cuáles son las reglas;
- qué decisiones se han tomado.

## Arquitectura

```text
                 AXYRO CONTEXT ENGINE
                         │
              pregunta / acción / voz
                         │
                         ▼
                  CONTEXT ROUTER
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
  LIVE MEMORY      KNOWLEDGE RAG      USER MEMORY
 Durable Objects   AI Search /        D1
                   Vectorize
        │                │                │
 estado actual      documentos        historial
 decisiones         normativa         progreso
 temporizadores     procedimientos     permisos
 participantes      escenario          resultados
        │                │                │
        └────────────────┼────────────────┘
                         │
                         ▼
                    RERANKING
                         │
                         ▼
                    LLM / AGENT
                         │
                         ▼
                respuesta / acción
                         │
                         ▼
                  Unity / VR / Web
```

---

# 9. Las cuatro memorias

## 9.1 Live Memory

### Tecnología

**Durable Objects**

Contiene información que cambia en tiempo real:

- participantes;
- posición lógica;
- decisiones;
- objetos;
- temporizadores;
- eventos;
- estado del escenario;
- variables;
- objetivos;
- consecuencias;
- conversación reciente.

### Regla

Esta información debe poder consultarse inmediatamente.

No depende de generar embeddings.

## 9.2 Knowledge Memory

### Tecnología

**R2 + AI Search + Vectorize**

Contendrá:

- manuales;
- procedimientos;
- normativa;
- documentación;
- contenido educativo;
- documentación empresarial;
- políticas;
- conocimiento del escenario;
- material de referencia.

## 9.3 User Memory

### Tecnología

**D1**

Contendrá:

- usuario;
- organización;
- rol;
- permisos;
- cursos;
- progreso;
- simulaciones anteriores;
- resultados;
- competencias;
- historial autorizado.

La IA no recibe toda esta información.

Solo se recupera lo necesario para cada acción.

## 9.4 Scenario Memory

Contendrá:

- objetivos;
- reglas;
- fases;
- personajes;
- restricciones;
- información oculta;
- eventos posibles;
- condiciones;
- dificultad;
- lógica de evaluación.

---

# 10. Memoria caliente y memoria persistente

La arquitectura debe trabajar a dos velocidades.

```text
HOT MEMORY
milisegundos
Durable Objects

        +

PERSISTENT / KNOWLEDGE MEMORY
D1 + R2 + AI Search + Vectorize
```

No intentaremos vectorizar cada evento en tiempo real.

---

# 11. Flujo de actualización

Un evento importante sigue este flujo:

```text
Unity
  ↓
Durable Object
  ↓
estado realtime actualizado
  ↓
Queue
  ↓
procesamiento
  ↓
D1 / R2
  ↓
AI Search / Vectorize cuando corresponda
```

Esto evita bloquear la simulación.

---

# 12. Ejemplo

El participante dice:

> «Aceptaría un 8 % de reducción si firmamos tres años.»

El Context Engine recupera:

```text
LIVE
El proveedor rechazó anteriormente un 12 %.
Quedan 8 minutos.
Existe otra oferta activa.

KNOWLEDGE
La política permite descuentos entre 5 % y 10 %.
Los contratos de tres años tienen prioridad.

USER
El equipo todavía dispone de margen presupuestario.

SCENARIO
Objetivo: mantener proveedor sin perder margen.
```

Ese contexto se entrega al LLM.

La respuesta del personaje IA se genera en función de la simulación real.

---

# 13. IA Provider

AXYRO no dependerá de un único proveedor.

Implementaremos una capa propia.

```text
AIProvider

├── Workers AI
├── OpenAI
├── Azure OpenAI
├── Anthropic
├── Google Gemini
└── modelos locales
```

---

# 14. AI Gateway

Toda llamada externa a modelos debe pasar por una capa controlada.

```text
Unity / Web
     ↓
AXYRO Backend
     ↓
AI Gateway
     ↓
Modelo
```

Objetivos:

- control de costes;
- rate limiting;
- fallback;
- selección de modelos;
- logging;
- trazabilidad;
- seguridad;
- guardrails;
- cambio de proveedor.

Unity nunca tendrá claves de proveedores IA.

---

# 15. Voz y conversación realtime

La arquitectura debe quedar preparada para:

```text
micrófono
   ↓
Speech-to-Text
   ↓
AXYRO Context Engine
   ↓
LLM
   ↓
Text-to-Speech
   ↓
personaje IA
```

Debe soportar streaming para reducir latencia percibida.

---

# 16. VR / XR

No desarrollaremos una aplicación VR separada.

Unity será el motor común.

## Evolución

```text
MVP
PC + pantallas
      ↓
VR
Meta Quest / OpenXR
      ↓
MR / XR
otros dispositivos
```

Los siguientes elementos serán compartidos:

- escenarios;
- backend;
- Context Engine;
- usuarios;
- resultados;
- IA;
- analytics;
- reglas;
- evaluación.

VR será simplemente otro cliente de AXYRO.

---

# 17. Datos

## D1

Base principal del MVP.

Contendrá:

- tenants;
- organizaciones;
- usuarios;
- roles;
- escenarios;
- sesiones;
- resultados;
- configuraciones;
- auditoría.

## R2

Contendrá:

- documentación;
- assets;
- audio;
- informes;
- datasets;
- contenido;
- archivos generados.

## Durable Objects

Contendrá estado vivo:

- sesiones;
- participantes;
- sincronización;
- temporizadores;
- realtime;
- multiplayer.

---

# 18. Multi-tenant

AXYRO será multiempresa desde el principio.

```text
AXYRO

├── Universidad A
│   ├── profesores
│   ├── alumnos
│   └── simulaciones
│
├── Empresa B
│   ├── instructores
│   ├── empleados
│   └── simulaciones
│
└── Empresa C
```

Todo recurso debe pertenecer a un tenant.

---

# 19. Seguridad

Desde el MVP:

- HTTPS;
- autenticación;
- autorización;
- roles;
- separación de tenants;
- rate limiting;
- validación de entradas;
- secretos fuera del código;
- logs de seguridad;
- auditoría;
- dependencias actualizadas;
- análisis de vulnerabilidades;
- backups;
- recuperación.

---

# 20. GDPR / RGPD

Aplicaremos:

- minimización;
- privacidad desde el diseño;
- privacidad por defecto;
- separación entre identidad y telemetría;
- retención configurable;
- borrado;
- exportación;
- auditoría;
- control de acceso;
- cifrado;
- seudonimización cuando corresponda.

---

# 21. Telemetría

No repetiremos datos personales en cada evento.

Ejemplo:

```text
user_id = usr_82af
session_id = ses_4732
scenario_id = crisis_01
event = decision
value = option_b
time_ms = 12400
```

La identidad real se resuelve únicamente cuando sea necesaria.

---

# 22. AI Act

AXYRO no utilizará IA para inferir mediante cámara, voz o biometría:

- estrés;
- emociones;
- nerviosismo;
- motivación;
- estado psicológico.

Sí podrá medir:

- decisiones;
- tiempos;
- resultados;
- errores;
- acciones;
- secuencia;
- objetivos;
- interacción.

---

# 23. Evaluación

La IA podrá:

- analizar;
- resumir;
- recomendar;
- explicar;
- detectar patrones;
- generar feedback.

Cuando la evaluación pueda afectar de manera significativa a una persona:

```text
IA
 ↓
recomendación
 ↓
humano
 ↓
decisión
```

Human-in-the-loop.

---

# 24. Transparencia IA

Cuando un usuario interactúe con un personaje o agente IA deberá saberlo.

Ejemplo:

> Estás interactuando con un personaje controlado por inteligencia artificial.

---

# 25. Auditoría

Registrar como mínimo:

- organización;
- usuario;
- sesión;
- escenario;
- versión del escenario;
- acción;
- fecha;
- resultado;
- cambios administrativos;
- proveedor IA;
- modelo;
- versión;
- configuración relevante;
- decisiones IA relevantes.

La trazabilidad forma parte del producto.

---

# 26. Observabilidad

Desde el MVP debemos poder saber:

- qué ocurrió;
- cuándo ocurrió;
- dónde falló;
- cuánto tardó;
- qué modelo se utilizó;
- cuánto costó;
- qué usuario/sesión estaba implicado.

No necesitamos una plataforma enterprise inicialmente, pero sí eventos estructurados desde el primer día.

---

# 27. Portabilidad

Cloudflare es la infraestructura inicial, no una dependencia permanente.

Diseñaremos adaptadores internos.

```text
D1
 ↓
PostgreSQL

R2
 ↓
S3 / Azure Blob

Queues
 ↓
Kafka / Service Bus

Workers AI
 ↓
Azure / OpenAI / Anthropic / Gemini

Access
 ↓
Entra / Okta / Google
```

---

# 28. Roadmap oficial

AXYRO se desarrollará en **tres macrofases**.

La arquitectura debe estar preparada desde el primer día para las tres, pero no construiremos funciones de fases posteriores antes de validar la anterior.

---

# MACROFASE 1 — MVP ACTUAL

## Objetivo

Validar el producto sin VR y sin depender de IA avanzada.

Debemos demostrar que una simulación interactiva aporta valor real a una empresa o centro educativo.

## Stack

- Unity 6 LTS;
- C#;
- Rive;
- React;
- TypeScript;
- Vite;
- Hono;
- Cloudflare Workers;
- D1;
- R2;
- Durable Objects;
- Queues;
- Workflows;
- Workers AI cuando aporte valor;
- AI Gateway;
- Cloudflare Access;
- GitHub.

## No incluye todavía

- VR como requisito;
- personajes IA complejos;
- conversación por voz completa;
- escenarios generados dinámicamente;
- Realtime RAG completo en producción;
- adaptación automática avanzada de dificultad.

## Sí debe quedar preparado

- contratos para AI Provider;
- eventos estructurados;
- Context Engine interfaces;
- persistencia de contexto;
- telemetría;
- auditoría;
- multi-tenant;
- APIs compatibles con futuros clientes VR.

---

## ETAPA 0 — Foundation

### Objetivo

Construir la base técnica correcta.

### Entregables

- repositorio;
- arquitectura;
- CI/CD;
- entornos;
- modelo multi-tenant;
- autenticación;
- autorización;
- estructura de datos;
- logging estructurado;
- auditoría;
- gestión de secretos;
- feature flags;
- definición de eventos;
- contratos API Unity ↔ backend;
- interfaz AI Provider;
- interfaces del futuro Context Engine.

### Gate

No avanzar hasta tener:

- despliegue reproducible;
- tests básicos;
- aislamiento entre tenants;
- secretos fuera del código;
- logs estructurados;
- errores identificables.

---

## ETAPA 1 — Simulation Core

### Producto

**AXYRO SIM / DECISION v0.1**

### Debe permitir

- cargar escenario;
- iniciar sesión;
- gestionar participantes;
- ejecutar fases;
- lanzar eventos;
- tomar decisiones;
- aplicar consecuencias;
- manejar temporizadores;
- finalizar sesión;
- calcular resultados básicos.

### Stack principal

- Unity;
- Rive;
- Workers;
- D1;
- Durable Objects.

### Gate

> 50 ejecuciones internas consecutivas sin error crítico.

---

## ETAPA 2 — Instructor Console

### Objetivo

Permitir que el instructor controle la simulación sin entrar en Unity.

### Debe permitir

- ver sesión activa;
- ver participantes;
- lanzar eventos;
- cambiar variables;
- introducir incidentes;
- pausar;
- continuar;
- finalizar;
- consultar resultados.

---

## ETAPA 3 — Data, Reporting & Audit

### Objetivo

Convertir la experiencia en un sistema medible.

### Capturar

- eventos;
- decisiones;
- tiempos;
- errores;
- acciones;
- objetivos;
- resultados;
- cambios administrativos.

### Debe generar

**AXYRO Performance Report**

Ejemplo:

```text
Decisiones correctas        82 %
Tiempo de reacción          74 %
Objetivos completados       91 %
Riesgos identificados       68 %

Decisiones críticas         7
Errores recuperados         3
Objetivos no alcanzados     2
```

### Regla

No inferir emociones, estrés, motivación o estados psicológicos.

---

## ETAPA 4 — Piloto real

### Objetivo

Validar mercado.

Realizar pilotos con:

- universidad;
- empresa;
- centro de formación.

### Medir

- utilidad;
- facilidad de uso;
- fiabilidad;
- engagement;
- valor percibido;
- intención de compra;
- disposición a pagar;
- problemas operativos;
- calidad del reporting.

### Pregunta principal

> ¿Existe un cliente dispuesto a pagar por AXYRO SIM LAB?

---

## ETAPA 5 — MVP comercial básico

Solo después de validar interés real.

### Añadir

- onboarding;
- gestión de organizaciones;
- roles;
- escenarios;
- reporting;
- backups;
- gestión de errores;
- documentación;
- soporte;
- privacidad;
- términos;
- DPA;
- seguridad mínima empresarial.

---

# MACROFASE 2 — VR / XR

## Objetivo

Llevar los escenarios validados a realidad virtual sin crear otro producto.

## Principio

> **No se crea un backend VR.**

Mantenemos el mismo proyecto Unity y la misma plataforma AXYRO.

## Tecnología

- Unity;
- Rive;
- OpenXR;
- Meta Quest 3 / 3S inicialmente.

## Reutilizamos

- escenarios;
- API;
- D1;
- R2;
- usuarios;
- organizaciones;
- reglas;
- reporting;
- analytics;
- auditoría;
- AI Gateway;
- Context Engine.

## Arquitectura

```text
AXYRO PLATFORM
      │
      ├── PC / Pantallas
      │
      └── VR / OpenXR
              │
              ▼
         mismas APIs
              │
         mismo backend
```

## Gate

No priorizar VR hasta que al menos un escenario no-VR esté validado con usuarios reales.

---

# MACROFASE 3 — IA AVANZADA

## Objetivo

Convertir AXYRO en una plataforma de simulación adaptativa e inteligente.

Esta fase incorpora el **AXYRO Context Engine** completo.

---

## ETAPA IA-1 — Realtime RAG

### Implementar

- Live Memory;
- Knowledge Memory;
- User Memory;
- Scenario Memory;
- Context Router;
- retrieval;
- reranking;
- context assembly;
- trazabilidad.

### Stack

```text
Live Memory
Durable Objects

Knowledge Memory
R2 + AI Search + Vectorize

User Memory
D1

Scenario Memory
D1 + R2
```

### Principio

No vectorizar cada evento de la simulación.

Usar:

```text
HOT MEMORY
Durable Objects
milisegundos

+

KNOWLEDGE MEMORY
D1 / R2 / AI Search / Vectorize
persistente
```

---

## ETAPA IA-2 — Personajes IA

### Ejemplos

- cliente;
- paciente;
- empleado;
- proveedor;
- manager;
- periodista;
- tutor;
- adversario.

### Cada personaje tendrá

- rol;
- objetivos;
- conocimiento;
- restricciones;
- información disponible;
- memoria de sesión;
- comportamiento;
- reglas del escenario.

### Flujo

```text
Unity
  ↓
AXYRO Backend
  ↓
Context Engine
  ↓
AI Gateway
  ↓
LLM
  ↓
respuesta
  ↓
Unity
```

---

## ETAPA IA-3 — Voz en tiempo real

### Flujo

```text
Micrófono
   ↓
Speech-to-Text
   ↓
Context Engine
   ↓
LLM
   ↓
Text-to-Speech
   ↓
Personaje IA
```

### Requisitos

- streaming;
- interrupciones;
- turn-taking;
- latencia controlada;
- trazabilidad.

---

## ETAPA IA-4 — Escenarios dinámicos

La IA podrá:

- introducir eventos;
- generar variaciones;
- modificar presión temporal;
- adaptar información disponible;
- introducir nuevos incidentes;
- cambiar comportamiento de personajes.

Siempre dentro de reglas definidas por el escenario.

---

## ETAPA IA-5 — Evaluación asistida

La IA podrá:

- analizar;
- resumir;
- explicar;
- recomendar;
- detectar patrones;
- generar feedback.

### Regla

Cuando la evaluación pueda afectar significativamente a una persona:

```text
IA
 ↓
recomendación
 ↓
instructor / profesor
 ↓
decisión
```

---

## ETAPA IA-6 — Adaptación de dificultad

El sistema podrá modificar:

- complejidad;
- ritmo;
- cantidad de información;
- eventos;
- restricciones;

según el progreso observable dentro de la simulación.

No utilizará inferencias biométricas de emociones o estados psicológicos.

---

# 29. AXYRO Context Engine

El Context Engine debe diseñarse desde el MVP aunque su implementación completa pertenezca a IA avanzada.

Sus cuatro memorias serán:

```text
01 LIVE MEMORY
qué está pasando ahora

02 KNOWLEDGE MEMORY
qué sabe el sistema

03 USER MEMORY
qué sabemos del participante

04 SCENARIO MEMORY
qué debe ocurrir
```

Esto permitirá posteriormente combinar en una sola interacción:

- lo ocurrido hace milisegundos;
- lo ocurrido durante la sesión;
- historial autorizado;
- reglas;
- documentación;
- conocimiento empresarial o educativo.

---

# 30. AI Provider y AI Gateway

AXYRO no dependerá de un único proveedor.

```text
AIProvider

├── Workers AI
├── OpenAI
├── Azure OpenAI
├── Anthropic
├── Google Gemini
└── modelos locales
```

Toda llamada externa debe pasar por:

```text
Unity / Web
     ↓
AXYRO Backend
     ↓
AI Gateway
     ↓
modelo
```

Objetivos:

- seguridad;
- cambio de proveedor;
- control de costes;
- rate limiting;
- fallback;
- trazabilidad;
- guardrails.

Unity nunca contiene claves de proveedores IA.

---

# 31. Seguridad y cumplimiento

Desde el primer commit:

- multi-tenant;
- autenticación;
- autorización;
- roles;
- separación de datos;
- HTTPS;
- validación de entradas;
- secretos fuera del código;
- rate limiting;
- auditoría;
- logs estructurados;
- backups;
- retención;
- exportación;
- borrado;
- minimización de datos;
- Privacy by Design.

## GDPR / RGPD

Separar identidad y telemetría.

Ejemplo:

```text
user_id = usr_82af
session_id = ses_4732
scenario_id = crisis_01
event = decision
value = option_b
time_ms = 12400
```

No repetir datos personales innecesariamente.

## AI Act

No inferir mediante IA:

- emociones;
- estrés;
- nerviosismo;
- motivación;
- estado psicológico;

a partir de cámara, voz o biometría en contextos educativos o laborales.

Sí medir:

- decisiones;
- tiempos;
- acciones;
- errores;
- resultados;
- objetivos;
- secuencia de eventos.

## Transparencia

El usuario debe saber cuándo interactúa con un agente o personaje controlado por IA.

---

# 32. Portabilidad

Cloudflare es la infraestructura del MVP, no una dependencia irreversible.

Diseñaremos adaptadores internos.

```text
D1              → PostgreSQL
R2              → S3 / Azure Blob
Queues          → Kafka / Service Bus
Workers AI      → Azure / OpenAI / Anthropic / Gemini
Access          → Entra / Okta / Google
```

No añadiremos multi-cloud durante validación.

---

# 33. Qué NO construir todavía

No añadir inicialmente:

- Kubernetes;
- microservicios;
- Kafka;
- Redis;
- ClickHouse;
- infraestructura multi-cloud;
- PostgreSQL gestionado;
- Azure;
- AWS;
- GCP;
- VR antes de validar;
- digital twins complejos;
- biometría emocional;
- modelos propios;
- hardware personalizado costoso.

---

# 34. KPIs del MVP

## Fiabilidad

- crash rate;
- errores;
- sesiones completadas;
- reconexiones.

## Rendimiento

- latencia Unity ↔ backend;
- latencia realtime;
- tiempo de carga;
- FPS.

## Producto

- sesiones;
- participantes;
- escenarios completados;
- abandono;
- feedback;
- valor percibido;
- intención de compra;
- disposición a pagar.

## IA

Estos KPIs se activarán cuando utilicemos IA:

- latencia;
- tokens;
- coste;
- errores;
- fallback;
- calidad de retrieval;
- respuestas incorrectas;
- alucinaciones.

---

# 35. Principios de ingeniería

1. **Local-first para la simulación.**
2. **Cloud-first para coordinación y datos.**
3. **Event-driven desde el MVP.**
4. **Provider-independent para IA.**
5. **Multi-tenant desde el inicio.**
6. **Privacy by Design.**
7. **Observability by Design.**
8. **Human-in-the-loop cuando corresponda.**
9. **Reutilización antes que personalización ad hoc.**
10. **Escalar solo cuando exista demanda.**

---

# 36. Arquitectura objetivo

```text
                       AXYRO
                         │
                  Experience Layer
                         │
           ┌─────────────┼─────────────┐
           │                           │
      Unity + Rive                  Web App
           │                           │
           └─────────────┬─────────────┘
                         │
                     AXYRO API
                         │
                Simulation Engine
                         │
                 Context Engine
                         │
       ┌─────────────────┼─────────────────┐
       │                 │                 │
 Live Memory       Knowledge Memory    User Memory
       │                 │                 │
Durable Objects     AI Search            D1
                    Vectorize
                    R2
       │                 │                 │
       └─────────────────┼─────────────────┘
                         │
                    AI Gateway
                         │
        ┌────────────────┼─────────────────┐
        │                │                 │
   Workers AI          OpenAI          Other LLM
                         │
                         ▼
                 Analytics / Audit
```

---

# 37. Decisión definitiva para desarrollo

## Fase inmediata

Construir:

> **AXYRO SIM / DECISION**

con:

- Unity 6 LTS;
- C#;
- Rive;
- React;
- TypeScript;
- Vite;
- Hono;
- Cloudflare Workers;
- D1;
- R2;
- Durable Objects;
- Queues;
- Workflows;
- AI Gateway;
- Workers AI cuando aporte valor;
- Cloudflare Access;
- GitHub.

## Orden obligatorio

```text
1. Foundation
2. Simulation Core
3. Instructor Console
4. Data + Reporting + Audit
5. Pilot
6. Commercial MVP

--------- después de validar ---------

7. VR / OpenXR

--------- IA avanzada ---------

8. Realtime RAG
9. AI Characters
10. Voice
11. Dynamic Scenarios
12. AI-assisted Evaluation
13. Adaptive Difficulty

--------- cuando lo exija el negocio ---------

14. Enterprise Infrastructure
```

## Regla de arquitectura

Aunque una función pertenezca a una fase posterior, **no diseñar el MVP de forma que impida añadirla**.

Eso aplica especialmente a:

- VR;
- Context Engine;
- Realtime RAG;
- múltiples proveedores IA;
- multi-tenant;
- auditoría;
- infraestructura enterprise.

## Objetivo

> **Validar primero el valor del producto. Añadir complejidad solo cuando la validación o un cliente la justifique.**

---

# Addendum · Estado real y decisiones a 7 de octubre de 2026

Este addendum no modifica el cuerpo del documento: recoge dónde la implementación se ha separado del plan y qué falta para cerrar el MVP. Detalle técnico en `README.md`; estado y pendientes en `CLAUDE.md`; documentación para la UFV en `docs/`.

## Decisiones que difieren del plan

- **Identidad.** Cloudflare Access está retirado. El acceso es propio: miembros con correo y código personal de seis cifras (HMAC en D1, sesión de 24 h) e **invitados** con el PIN de seis cifras de una sesión y un alias, con ámbito limitado a esa sesión y caducidad de 12 h (o 2 h tras finalizar). El código antiguo de Access solo existe tras `LEGACY_ACCESS_AUTH`.
- **Recuperación (RAG).** Sin Vectorize ni AI Search: embeddings `bge-m3` guardados como vectores Float32 en R2 (UE), un fichero por documento, y similitud coseno en el propio Worker; fragmentos y citas en D1.
- **Sin AI Gateway ni Workflows todavía.** El Worker llama a Workers AI directamente (`gpt-oss-120b`, `bge-m3`, `toMarkdown`, Clef). Las interfaces `shared/contracts/ai-provider.ts` y `context-engine.ts` siguen sin implementación.
- **Proveedor de voz: Soniox**, proyecto en región **EE. UU.** (`SONIOX_REGION = us`, transferencia internacional avisada al usuario y pendiente del DPO). Locuciones y 33 reacciones pregrabadas con Soniox TTS; STT en tiempo real para participantes (credenciales de un solo uso) y TTS en tiempo real para el proyector y el Modo IA (credenciales de 15 min solo para docentes). En Windows, Vosk local.
- **Funciones de la macrofase 3 adelantadas como demo** tras el flag `ai_live_demo` (activo en el entorno actual, solo docentes): Modo IA en vivo con colecciones de documentos, situaciones generadas con citas y voz en tiempo real (IA-1, IA-3 e IA-4 parciales); «Convertir en escenario para clase», que pasa una partida a un escenario versionado con **revisión docente obligatoria** antes de publicar (`origin: ai`). El producto de clase sigue siendo determinista; su única IA es Clef para asignar una respuesta libre por voz a una opción existente.
- **La web es también cliente del participante.** Además de la consola, hay vista móvil (`/unirse`, `/jugar/:id`) con voz y reacciones, y proyector para el aula. Unity WebGL queda como experiencia 3D opcional («Abrir en 3D»).
- **Tiempo real** por WebSocket con hibernación del Durable Object, con consulta periódica de respaldo.
- **Analítica agregada** de la organización (`GET /api/analytics`) y comparación con la media (`/benchmark`), solo desde D1 y sin datos por persona.

## Huecos del MVP

**P1 · antes del piloto**

- Copias de seguridad de D1: procedimiento de restauración documentado y probado.
- Despliegue automático en CI (`CLOUDFLARE_DEPLOY`) y entorno de staging separado de producción.
- RGPD por persona: borrado y exportación de un participante concreto dentro de una sesión.
- Comprobación de ubicación UE (D1, R2) y confirmación de dónde procesa Workers AI.
- Medición del piloto: encuesta e indicadores de la etapa 4.

**P2**

- Auditoría de IA: registro por llamada de modelo, versión, uso y resultado (hoy solo se auditan colecciones, documentos, partidas y publicaciones).
- Telemetría de cliente (errores de Unity WebGL y de la vista móvil).
- Seguridad de la cadena de suministro: escaneo de dependencias en CI.
- Reintento de decisiones en Unity ante fallos de red.

**P3**

- Métricas del informe previstas en la etapa 3 aún no implementadas: «riesgos identificados» y «errores recuperados».
- Puerta de calidad de 50 simulaciones (`SMOKE_RUNS=50`) dentro de CI, no solo en local.
