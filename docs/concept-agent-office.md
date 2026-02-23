# Concept: Agent Office — Inter-Agent Collaboration Framework

> **Status**: Nice-to-have / Vision
> **Dependencia**: Fase 11 (Headless LLM Orchestrator)
> **Tipo**: Documento conceptual — no es spec, no es fase
> **Idioma**: Espanol (doc de investigacion)

---

## Nota

> Este documento describe una vision a largo plazo para JorchBot: un sistema
> donde los agentes LLM se **comunican entre si**, **critican** y **mejoran**
> el trabajo de los demas, y **colaboran** de forma emergente — como una oficina
> real donde cada "empleado" tiene un rol, habilidades, y la capacidad de
> consultar a sus colegas.
>
> Esto NO es un requisito para las fases 0-11. Es una referencia para futuras
> iteraciones una vez que el orquestador multi-LLM (Fase 11) este funcionando.

---

## 1. La Metafora

Una oficina real tiene:

| Oficina Real            | Agent Office                                               |
| ----------------------- | ---------------------------------------------------------- |
| Empleados con roles     | Agentes con Agent Cards (capabilities)                     |
| Directorio de empleados | Agent Registry (quien puede hacer que)                     |
| Reunion de equipo       | Group Chat (multiple agentes conversan)                    |
| Asignar tarea           | Delegation (manager → especialista)                        |
| Consultar colega        | Ask Agent (pregunta lateral sin transferir control)        |
| Transferir proyecto     | Handoff (transferencia completa de control)                |
| Code review / QA        | Reflection Loop (critica → revision → re-critica)          |
| Manual de procesos      | SOPs (Standard Operating Procedures por rol)               |
| Pizarron compartido     | Blackboard (base de conocimiento compartida)               |
| Slack de la empresa     | Event Stream (comunicacion asincrona, persistente)         |
| Memoria institucional   | Shared Memory (4 capas: corto, largo, entidad, contextual) |
| Brainstorming           | Emergent Collaboration (speaker selection dinamico)        |

---

## 2. Patrones Existentes Investigados

### 2.1 CrewAI — Tripulacion con Roles

CrewAI es el framework mas cercano a la metafora de oficina. Cada agente tiene
`role`, `goal`, y `backstory`. Cuando `allow_delegation=True`, los agentes
reciben automaticamente 2 tools: **Delegate Work** y **Ask Question**.

**Modelos de ejecucion**:

- **Secuencial**: Tareas fluyen linealmente entre agentes
- **Jerarquico**: Un Manager descompone objetivos y delega a especialistas
- **Paralelo**: Multiples agentes trabajan simultaneamente

**Memoria compartida**: Short-term, long-term, entity, y contextual memory.
Los agentes aprenden de colaboraciones previas.

**Scoping**: `allowed_agents` controla quien puede delegar a quien (organigramas
jerarquicos).

### 2.2 LangGraph — Grafos de Estado

LangGraph modela workflows como **maquinas de estado** (grafos dirigidos).
Nodos = agentes, aristas = flujo de control, estado compartido centralizado.

**Patron Supervisor**: Un agente supervisor recibe requests, evalua que
especialista debe manejarla, y rutea via aristas condicionales.

**Patron Reflection** (critica iterativa): Agente principal + agente critico en
un ciclo: producir → criticar → revisar → re-criticar. Se repite hasta que el
critico aprueba. Libreria oficial: `langgraph-reflection`.

**Workflows ciclicos**: A diferencia de DAGs tradicionales, LangGraph soporta
ciclos — agentes pueden iterar sobre su propio output para mejorar calidad.

### 2.3 AutoGen (Microsoft) — Conversacion como Coordinacion

AutoGen trata la interaccion entre agentes como **conversacion**. Los agentes
son "conversable" y se comunican via lenguaje natural.

**Patrones de conversacion**:

| Patron          | Descripcion                                                      |
| --------------- | ---------------------------------------------------------------- |
| Two-Agent Chat  | Dos agentes conversan ida y vuelta                               |
| Sequential Chat | Cadena de chats con "carryover" (resumen pasa al siguiente)      |
| Group Chat      | Multiples agentes en un thread compartido con `GroupChatManager` |
| Nested Chat     | Un agente crea un sub-equipo interno como "monologoo interno"    |

**Seleccion de speaker en Group Chat**:

- Round Robin, Random, Auto (LLM decide), Manual, Custom function

**Insight clave**: La conversacion en lenguaje natural **es** el mecanismo de
coordinacion. No necesitas APIs rigidas — los agentes se coordinan hablando.

### 2.4 OpenAI Swarm / Agents SDK — Handoffs

Dos primitivas: **Agents** y **Handoffs**.

- **Handoff** (transferencia completa): El agente transfiere toda la conversacion
  a otro agente. Como pasar una llamada telefonica.
- **Agent-as-tool** (delegacion parcial): El agente llama a otro como herramienta
  pero mantiene el control. Como pedirle algo a un colega.

**Mapeo a oficina**: "Te paso este proyecto completo" (handoff) vs. "Puedes
revisar esto por mi?" (agent-as-tool).

### 2.5 A2A Protocol (Google) — Estandar Abierto

A2A es un **protocolo de interoperabilidad** (Apache 2.0, Linux Foundation) para
que agentes de cualquier framework se comuniquen. 150+ organizaciones lo adoptan.

**Agent Cards** (descubrimiento de capacidades):

```json
{
  "name": "CodeReview Agent",
  "description": "Reviews code for quality and security",
  "url": "https://agents.example.com/code-review",
  "capabilities": { "streaming": true, "pushNotifications": true },
  "skills": [
    {
      "id": "security-review",
      "name": "Security Code Review",
      "description": "Analyzes code for security vulnerabilities"
    }
  ]
}
```

Agent Cards se publican en un **well-known URI** o en **registros/catalogos**.
Los agentes consultan estos para descubrir quien puede hacer que.

**Lifecycle de tareas**: `submitted` → `working` → `input-required` →
`completed` / `failed` / `canceled`. Para tareas largas, SSE o webhooks.

**Relacion con MCP**: MCP = como un agente accede a **tools**. A2A = como los
agentes hablan **entre si**. Son complementarios.

### 2.6 Arquitecturas Reales

#### ChatDev — La Empresa Virtual

Simula una empresa de software completa:

- **Roles**: CEO, CTO, CPO, Programmer, Designer, Tester, Reviewer
- **Fases waterfall**: Design → Coding → Testing → Docs
- **Chat Chains**: Conversaciones estructuradas entre pares de roles
- **MacNet (2024)**: Evolucion con DAGs para topologia de colaboracion,
  escala a 1000+ agentes sin desbordar contexto

#### MetaGPT — SOPs como Codigo

Filosofia: "Code = SOP(Team)". Cada rol sigue procedimientos estandarizados:

- Product Manager → PRD
- Architect → System Design
- Project Manager → Task List
- Engineer → Code

Cada output se verifica contra SOPs antes de pasar al siguiente rol.

#### Blackboard Architecture

Patron clasico revivido para LLMs:

- **Pizarron compartido**: Base de conocimiento donde agentes publican y leen
- **Unidad de control**: Evalua estado del pizarron y selecciona siguiente agente
- **Contribucion oportunista**: Agentes actuan cuando detectan cambios relevantes
- Investigacion (bMAS): 13-57% mejora vs patrones coordinador tradicionales

#### Multi-Agent Reflexion (MAR)

- Multiples "personas" diversas intentan la misma tarea independientemente
- Un **juez** sintetiza las criticas en una reflexion unificada
- Separar acting, diagnosing, critiquing y aggregating reduce puntos ciegos
- +3 pts en HotPotQA, +6.2 pts en HumanEval pass@1

---

## 3. Diseño Conceptual: JorchBot Agent Office

### 3.1 Componentes del Office

```
┌──────────────────────────────────────────────────────────────┐
│                     AGENT OFFICE                             │
│                                                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │   Registry   │  │  Blackboard  │  │    Event Bus     │    │
│  │  (Directorio │  │  (Pizarron   │  │  (Comunicacion   │    │
│  │   de agentes │  │   compartido)│  │   asincrona)     │    │
│  │   + Agent    │  │              │  │                  │    │
│  │   Cards)     │  │  - findings  │  │  office.task.*   │    │
│  │              │  │  - warnings  │  │  office.review.* │    │
│  └──────┬───────┘  │  - status    │  │  office.alert.*  │    │
│         │          └──────┬───────┘  └────────┬─────────┘    │
│         │                 │                   │              │
│  ┌──────┴─────────────────┴───────────────────┴──────────┐   │
│  │                 Office Manager (Orchestrator)          │   │
│  │                                                       │   │
│  │  - Recibe requests del usuario o del sistema          │   │
│  │  - Consulta Registry para encontrar agente adecuado   │   │
│  │  - Delega, transfiere, o rutea segun complejidad      │   │
│  │  - Monitorea blackboard para intervenir si necesario  │   │
│  │  - Coordina reflection loops cuando se requiere QA    │   │
│  └───────┬───────────────────────────────────────────────┘   │
│          │                                                    │
│  ┌───────┴────────────────────────────────────────────────┐  │
│  │                    Agent Pool                           │  │
│  │                                                         │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐  │  │
│  │  │ Claude  │  │ Codex   │  │ Gemini  │  │ Claude   │  │  │
│  │  │ (myapp) │  │ (api)   │  │ (docs)  │  │ (review) │  │  │
│  │  │         │  │         │  │         │  │          │  │  │
│  │  │ Role:   │  │ Role:   │  │ Role:   │  │ Role:    │  │  │
│  │  │ Dev     │  │ API Dev │  │ Analyst │  │ Reviewer │  │  │
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬─────┘  │  │
│  │       │            │            │             │         │  │
│  │       └────────────┴──────┬─────┴─────────────┘         │  │
│  │                           │                              │  │
│  │              Shared Memory (4 capas)                     │  │
│  │              ┌─────────────────────────┐                 │  │
│  │              │ Short-term (tarea actual)│                 │  │
│  │              │ Long-term (patrones)     │                 │  │
│  │              │ Entity (conocimiento)    │                 │  │
│  │              │ Contextual (proyecto)    │                 │  │
│  │              └─────────────────────────┘                 │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Roles Predefinidos

Cada agente en el Office tiene un **rol** que define su comportamiento,
herramientas permitidas, y SOPs:

| Rol              | Descripcion                                 | LLM Ideal       | Tools                              |
| ---------------- | ------------------------------------------- | --------------- | ---------------------------------- |
| **Developer**    | Escribe y modifica codigo                   | Claude Code     | filesystem, git, shell             |
| **Reviewer**     | Revisa PRs, encuentra bugs, sugiere mejoras | Claude Code     | filesystem, git (read-only)        |
| **Analyst**      | Analiza documentacion, genera reportes      | Gemini (1M ctx) | filesystem (read-only), web search |
| **API Engineer** | Trabaja con APIs, tests, integracion        | Codex           | filesystem, shell, http            |
| **Tester**       | Ejecuta tests, reporta resultados           | Cualquiera      | shell (test commands only)         |
| **Planner**      | Descompone tareas complejas en sub-tareas   | Claude Code     | memory_search, session_list        |

### 3.3 Modos de Interaccion

Tres modos, inspirados en OpenAI Agents SDK + CrewAI:

#### 1. Delegation (Asignar)

El Office Manager o un agente senior asigna una tarea a un especialista.
El agente que asigna **retiene control** y espera el resultado.

```
Manager: "Gemini (docs), analyze the API docs for breaking changes in v2.0"
Gemini (docs): → analiza → retorna resultado al Manager
Manager: → sintetiza resultado → responde al usuario
```

**Mapeo JorchBot**: `spawn_agent(project, llm, prompt, waitForResult: true)`

#### 2. Consultation (Consultar)

Un agente pregunta a otro sin transferir control. El consultado responde
y ambos siguen con su trabajo.

```
Claude (myapp): "Codex (api), is the /users endpoint stable?"
Codex (api): "Yes, 0 failures in 24h, avg 120ms"
Claude (myapp): → continua su trabajo con la info recibida
```

**Mapeo JorchBot**: `ask_agent(project, question)`

#### 3. Handoff (Transferir)

Un agente determina que otro es mas adecuado y **transfiere el control
completo** de la conversacion/tarea.

```
Claude (myapp): "This needs deep doc analysis (>500K tokens). Handing off to Gemini."
→ Handoff: conversation context → Gemini (docs)
Gemini (docs): → analiza con su contexto de 1M tokens → responde directamente al usuario
```

**Mapeo JorchBot**: Nuevo concepto — requiere transferencia de contexto. Mas
complejo que delegation. Nice-to-have.

### 3.4 Reflection Loop (Critica y Mejora)

El patron mas valioso para **calidad de codigo**. Inspirado en LangGraph
Reflection y MAR:

```
                 ┌─────────────────────────────────────┐
                 │                                     │
                 ▼                                     │
┌──────────┐  produce  ┌──────────┐  critique  ┌──────┴───┐
│ Developer │─────────→│  Output  │──────────→│ Reviewer │
│ (Claude)  │          │ (codigo) │           │ (Claude) │
└──────────┘          └──────────┘           └──────────┘
     ▲                                            │
     │         revise if needed                   │
     └────────────────────────────────────────────┘
                                                  │
                                           approve? ──→ Done
```

**Flujo**:

1. Developer produce codigo
2. Reviewer critica (seguridad, calidad, patrones)
3. Si hay issues → Developer revisa y re-produce
4. Reviewer re-evalua
5. Repetir hasta aprobacion (max 3 iteraciones)

**Implementacion potencial**:

```typescript
// Conceptual — no es spec, solo vision
async function reflectionLoop(params: {
  producer: LLMRunner;
  reviewer: LLMRunner;
  task: string;
  maxIterations: number;
}): Promise<ReflectionResult> {
  let output = await params.producer.start({ prompt: params.task });

  for (let i = 0; i < params.maxIterations; i++) {
    const review = await params.reviewer.start({
      prompt: `Review this output and provide critique. If it's good, respond with APPROVED.\n\n${output.text}`,
    });

    if (review.text.includes("APPROVED")) {
      return { output, iterations: i + 1, approved: true };
    }

    // Revise based on critique
    output = await params.producer.resume({
      prompt: `Revise based on this feedback:\n\n${review.text}`,
    });
  }

  return { output, iterations: params.maxIterations, approved: false };
}
```

### 3.5 Blackboard (Pizarron Compartido)

Un espacio de conocimiento compartido donde los agentes publican descubrimientos,
advertencias, y estado. Otros agentes leen el pizarron y actuan cuando detectan
algo relevante.

**Ejemplo de flujo**:

```
1. Claude (myapp) publica: "Found deprecated API call in auth.ts:42"
2. Codex (api) lee el pizarron, detecta que es relevante para el
3. Codex (api) publica: "Confirmed: /v1/auth is deprecated. Replacement: /v2/auth"
4. Claude (myapp) lee la actualizacion, migra automaticamente
5. Claude (review) lee el cambio, critica, aprueba
```

**Implementacion potencial**: Tabla SQLite `office_blackboard`:

```sql
CREATE TABLE office_blackboard (
  id INTEGER PRIMARY KEY,
  author TEXT NOT NULL,          -- "myapp/claude"
  type TEXT NOT NULL,            -- "finding" | "warning" | "status" | "request"
  topic TEXT NOT NULL,           -- "api-deprecation"
  content TEXT NOT NULL,         -- El mensaje
  relevantTo TEXT,               -- Proyectos/agentes relevantes (JSON array)
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER,             -- Auto-cleanup
  resolved BOOLEAN DEFAULT 0
);
```

Los agentes consultan via MCP: `jorchbot_request({ action: "blackboard_read", params: { topic: "api-*" } })`.

### 3.6 Memoria Compartida (4 Capas)

Inspirado en CrewAI, adaptado a JorchBot:

| Capa           | Que almacena                                                   | Duracion   | Compartida       |
| -------------- | -------------------------------------------------------------- | ---------- | ---------------- |
| **Short-term** | Contexto de la tarea actual                                    | Session    | No (per-runner)  |
| **Long-term**  | Patrones aprendidos, decisiones arquitecturales                | Permanente | Si (per-project) |
| **Entity**     | Conocimiento sobre entidades especificas (APIs, modulos, deps) | Permanente | Si (global)      |
| **Contextual** | Contexto del proyecto (stack, convenciones, estructura)        | Permanente | Si (per-project) |

**Short-term** ya existe implicitamente (el context window del runner).
**Long-term** y **Entity** son extensiones del memory system de Fase 11.
**Contextual** se puede pre-popular desde el Jorchfile + CLAUDE.md.

### 3.7 Event Bus (Comunicacion Asincrona)

Para colaboracion que no requiere respuesta inmediata. Los agentes publican
eventos y otros escuchan:

```typescript
// Eventos del Office
type OfficeEvent =
  | { type: "office.task.assigned"; from: string; to: string; task: string }
  | { type: "office.task.completed"; agent: string; task: string; summary: string }
  | { type: "office.review.requested"; from: string; artifact: string }
  | { type: "office.review.completed"; reviewer: string; approved: boolean; feedback: string }
  | { type: "office.alert"; agent: string; severity: "info" | "warn" | "error"; message: string }
  | { type: "office.blackboard.update"; author: string; topic: string }
  | { type: "office.agent.joined"; agent: string; role: string }
  | { type: "office.agent.left"; agent: string; reason: string };
```

**Transporte**: WebSocket events del gateway existente. No necesita Kafka —
JorchBot es single-instance. Los eventos se persisten en SQLite para historial.

---

## 4. Escenarios de Uso

### 4.1 Code Review Automatizado

```
Usuario: "Review the PR #42 changes"

Office Manager:
  1. Lee PR diff (via MCP tool)
  2. Asigna a Claude (review) rol Reviewer
  3. Claude (review) critica el codigo
  4. Si encuentra issues criticos:
     a. Publica findings al Blackboard
     b. Notifica al Developer original
     c. Inicia Reflection Loop si aplica
  5. Retorna reporte consolidado al usuario
```

### 4.2 Analisis Multi-Perspectiva (MAR)

```
Usuario: "Analyze the security of the auth module"

Office Manager:
  1. Spawn 3 agentes en paralelo con diferentes perspectivas:
     - Claude (security focus): "Analyze auth.ts for OWASP vulnerabilities"
     - Codex (api focus): "Analyze auth endpoints for input validation"
     - Gemini (docs focus): "Analyze auth documentation for security gaps"
  2. Espera resultados de los 3
  3. Spawn Claude (reviewer) como juez:
     "Synthesize these 3 security analyses into a unified report"
  4. Retorna reporte sintetizado al usuario
```

### 4.3 Tarea Compleja Descompuesta

```
Usuario: "Migrate the API from REST to GraphQL"

Office Manager (Planner):
  1. Descomponer en sub-tareas:
     a. Analyze current REST endpoints → Gemini (analyst)
     b. Design GraphQL schema → Claude (architect)
     c. Implement resolvers → Claude (developer)
     d. Update tests → Codex (tester)
     e. Update documentation → Gemini (docs)
  2. Ejecutar en orden con dependencias
  3. Reflection Loop entre cada paso (reviewer verifica)
  4. Reportar progreso al usuario via canal
```

### 4.4 Monitored Continuo (Blackboard + Cron)

```
Cron job: Every 4 hours

  1. Claude (monitor) ejecuta health check del proyecto
  2. Publica al Blackboard: { type: "status", topic: "health-check", ... }
  3. Si detecta degradacion:
     a. Publica: { type: "warning", topic: "performance", ... }
     b. Codex (api) lee el warning, corre profiling automatico
     c. Publica: { type: "finding", topic: "performance", content: "N+1 query in..." }
  4. Claude (developer) lee finding, genera fix
  5. Claude (reviewer) revisa fix
  6. Si aprobado → notifica al usuario con el PR listo
```

---

## 5. Prioridades de Implementacion

Esto NO es un backlog formal. Son sugerencias de orden para cuando esta
funcionalidad se construya:

### Tier 1 — Fundamentals (viene con Fase 11)

- [x] `spawn_agent` / `ask_agent` (ya planificado en Fase 11I)
- [x] Runner Registry (ya planificado en Fase 11B)
- [x] MCP Server (ya planificado en Fase 11C)
- [x] Memory vectorial (ya planificado en Fase 11D)

### Tier 2 — Office Foundation

- [ ] Agent Cards (capability manifests per-runner)
- [ ] Agent Registry con discovery
- [ ] Blackboard (SQLite table + MCP actions)
- [ ] Reflection Loop (2-agent produce-critique cycle)

### Tier 3 — Advanced Collaboration

- [ ] Event Bus con persistencia
- [ ] Handoff pattern (transferencia completa de contexto)
- [ ] Group Chat (multi-agent conversation thread)
- [ ] Memoria compartida de 4 capas
- [ ] SOPs por rol (system prompts especializados)

### Tier 4 — Emergent Intelligence

- [ ] MAR (Multi-Agent Reflexion con juez)
- [ ] Dynamic speaker selection (LLM decide quien habla)
- [ ] Blackboard con contribucion oportunista
- [ ] Nested chat (sub-equipo interno como "think tank")
- [ ] Cross-office collaboration (multiples JorchBot instances)

---

## 6. Consideraciones Tecnicas

### 6.1 Token Budget

Cada interaccion office consume tokens de **ambos** runners involucrados:

- ask_agent: ~500 tokens (pregunta) + ~500 tokens (respuesta)
- spawn_agent: ~200 tokens (setup) + costo completo de la sesion
- Reflection loop: N iteraciones x (produccion + critica) — puede ser costoso

**Mitigacion**: Limitar reflection loops a 3 iteraciones max. Usar resumen
compacto para carryover entre chats. Preferir consultation sobre spawn cuando
sea suficiente.

### 6.2 Concurrencia

Con N runners activos haciendo ask_agent entre si, hay riesgo de:

- **Deadlock**: A espera a B, B espera a A
- **Thundering herd**: Todos piden a todos simultaneamente
- **Cascading timeouts**: A timeout causa timeout en todos los que dependen

**Mitigacion**: Timeouts estrictos, max concurrent inter-agent calls (3),
deteccion de ciclos en el dependency graph.

### 6.3 Privacidad y Scoping

No todos los agentes deben ver todo:

- Un agente del proyecto `api` no deberia acceder a memoria de `secrets-mgmt`
- El Reviewer deberia tener acceso read-only al filesystem
- Sub-agents no heredan permisos del padre

**Mapeo a tool policies de OpenClaw**: Reusar el sistema existente de tool
policies para restringir que MCP actions puede usar cada agente.

### 6.4 A2A vs Interno

Para JorchBot single-instance, A2A protocol es overkill. Los Agent Cards y el
registry pueden ser implementaciones internas simples (objetos en memoria,
no HTTP endpoints).

Sin embargo, si en el futuro se quiere **federacion** (multiples JorchBots
coordinandose), A2A seria el protocolo natural de comunicacion.

**Recomendacion**: Disenar Agent Cards compatible con A2A spec para future-proofing,
pero implementar transport interno (no HTTP).

---

## 7. Que NO es el Agent Office

- **No es un framework generico de agentes** — es especifico para JorchBot
- **No es autonomo al 100%** — el usuario siempre tiene control y visibilidad
- **No es un reemplazo de CI/CD** — complementa, no sustituye pipelines existentes
- **No requiere infraestructura adicional** — todo corre en el mismo proceso JorchBot
- **No es Skynet** — limites estrictos de profundidad, concurrencia, y permisos

---

## Referencias

### Frameworks

- [CrewAI](https://docs.crewai.com) — role-based crew orchestration
- [LangGraph](https://www.langchain.com/langgraph) — graph-based agent workflows
- [AutoGen](https://microsoft.github.io/autogen/) — conversation-driven multi-agent
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/) — handoffs + agents-as-tools
- [ChatDev](https://github.com/OpenBMB/ChatDev) — virtual software company
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT) — SOPs as code

### Protocolos

- [A2A Protocol](https://a2a-protocol.org) — agent-to-agent communication standard (Google, Linux Foundation)
- [MCP](https://modelcontextprotocol.io) — agent-to-tools communication standard (Anthropic)

### Research

- [Multi-Agent Reflexion (MAR)](https://arxiv.org/abs/2512.20845) — diverse personas + judge synthesis
- [bMAS Blackboard](https://arxiv.org/html/2507.01701v1) — blackboard architecture for LLM multi-agent
- [CAMEL](https://arxiv.org/abs/2303.17760) — role-playing via inception prompting
- [Confluent: Event-Driven Multi-Agent Patterns](https://www.confluent.io/blog/event-driven-multi-agent-systems/)
- [IBM: MCP Architecture Patterns](https://developer.ibm.com/articles/mcp-architecture-patterns-ai-systems/)
