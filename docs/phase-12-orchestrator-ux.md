# Fase 12 — Orchestrator UX & Advanced Features

> **Estado**: Investigacion
> **Dependencia**: Fase 11 (Headless LLM Orchestrator)
> **Entregable**: Runner transcripts en GUI, web chat interactivo, model routing inteligente, streaming cross-runner, marketplace de MCP tools, federation entre JorchBots
> **Al terminar**: JorchBot es una plataforma completa de orquestacion donde el usuario ve y controla todo via web, el sistema elige el mejor LLM automaticamente, y multiples instancias pueden colaborar

---

## Nota Arquitectural

> Esta fase convierte al orquestador de Fase 11 en una **plataforma con UX
> completa**. Fase 11 construye el motor (LLMRunner, MCP, Memory, Sub-Agents).
> Fase 12 construye la **experiencia** encima:
>
> - **Transcripts**: Ver que hacen los runners en tiempo real (read-only, auditoria)
> - **Chat Web**: Interactuar con runners desde el browser (como WhatsApp pero en la web)
> - El sistema elige automaticamente que LLM usar para cada tarea
> - Los runners se comunican con streaming en tiempo real
> - Un marketplace de tools MCP amplia las capacidades
> - Multiples instancias de JorchBot se federan entre si
>
> **Contexto clave**: Los usuarios de JorchBot interactuan via WhatsApp/Telegram.
> **No ven la terminal de los CLIs.** El GUI web es su unica ventana al estado
> real de los runners.
>
> **Reuso de OpenClaw**: OpenClaw ya tiene un chat view completo (`ui/src/ui/views/chat.ts`)
> con streaming, tool call rendering, message grouping, attachments, markdown sidebar,
> y focus mode. Actualmente esta oculto (`HIDDEN_TABS`). **Ambas features (Transcripts
> y Chat) reusan este componente** — Transcripts usa solo el thread rendering (sin
> compose area), Chat lo usa completo. Esto reduce significativamente el esfuerzo
> vs construir desde cero.

---

## 1. Transcripts (Monitoreo Read-Only)

### El Problema

Hoy, cuando un usuario envia un mensaje a JorchBot via WhatsApp, el ClaudeRunner
procesa la peticion en background. El usuario solo ve la respuesta final. No tiene
forma de ver:

- Que esta haciendo el runner ahora mismo
- Que tools esta usando
- Si esta leyendo archivos, escribiendo codigo, corriendo tests
- Por que esta tardando

Los CLIs (Claude Code, Codex, Gemini) tienen su propia UI en terminal — pero
JorchBot corre headless. Nadie ve esa terminal.

### La Solucion

Un tab **Transcripts** en el GUI dedicado a monitoreo y auditoria. Es una vista
**read-only** — no envias mensajes, solo observas lo que los runners hacen.

**Estructura del tab**:

```
┌─ [Overview] [Nodes] [Chat] [Transcripts] [Tunnels] [Settings] ─┐
│                                                                   │
│  Transcripts                                                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Runner          │ Project │ Status   │ Duration │ Last Activity│
│  │─────────────────┼─────────┼──────────┼──────────┼─────────────│
│  │ Claude Code     │ myapp   │ 🟢 Active│ 12m 34s  │ Editing...  │
│  │ Codex           │ api     │ 🟢 Active│ 3m 12s   │ Running tests│
│  │ Claude Code     │ frontend│ ⚫ Done   │ 45m 12s  │ Completed   │
│  │ Gemini          │ docs    │ 🔴 Failed│ 2m 03s   │ Error       │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  [Filters: Project ▾] [Status ▾] [Runner Type ▾] [Date ▾]       │
└───────────────────────────────────────────────────────────────────┘
```

**Click en un runner** → entra al detalle read-only del flow completo:

```
┌─ Transcript: myapp (Claude Code) ──────────────── [← Back] ───┐
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Claude                                              10:32  │ │
│  │ I'll read the auth module to understand the current        │ │
│  │ implementation.                                            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Tool: Read ─────────────────────────────────────────────┐   │
│  │ src/auth/login.ts (lines 1-45)                  120ms    │   │
│  │ > Show output                                             │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─ Tool: Edit ─────────────────────────────────────────────┐   │
│  │ src/auth/login.ts (line 23)                      45ms    │   │
│  │ > Show diff                                               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Claude                                              10:33  │ │
│  │ I've fixed the authentication bug. The issue was...        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ Status ─────────────────────────────────────────────────┐   │
│  │ Completed · 1m 23s · 12,450 tokens · ctx: 8%             │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                 │
│                                         [Jump to latest]        │
└─────────────────────────────────────────────────────────────────┘
```

**Sin compose area** — esto es solo observacion/auditoria. El thread rendering
se reusa del chat view existente de OpenClaw (`ui/src/ui/views/chat.ts`).

### Pipeline de Datos

```
AgentRunner subprocess (Phase 10)
  │  Emite eventos: text, toolUse, toolResult, result, error
  │
  ▼
Transcript Bridge (nuevo)
  │  Normaliza eventos → formato semantico
  │  Emite via WebSocket al GUI (jb.session.output)
  │  Persiste a disco (JSONL) para historial
  │
  ├──────────────────────────────┐
  ▼                              ▼
WebSocket → Browser            JSONL file → Memory Indexer
  │                              (Fase 11D)
  ▼
Transcripts Tab (Lit component)
  │  Lista de runners/sesiones
  │  Click → detalle read-only (thread rendering)
  │  Virtual scrolling para performance
  │  Auto-scroll + "jump to latest"
```

### Eventos Semanticos del Transcript

Phase 10 define eventos normalizados en `AgentRunner`. El Transcript Bridge
los mapea a eventos para el GUI:

| AgentRunner Event (Phase 10) | Evento GUI              | Renderizado                       |
| ---------------------------- | ----------------------- | --------------------------------- |
| `text` (streaming chunks)    | `transcript.message`    | Burbuja de texto                  |
| `toolUse` (tool + input)     | `transcript.tool.start` | Card con nombre del tool + params |
| `toolResult` (output)        | `transcript.tool.end`   | Card expandible con resultado     |
| `result` (final)             | `transcript.done`       | Barra de status "Completed"       |
| `error`                      | `transcript.error`      | Banner rojo con error             |

### Virtual Scrolling

Una sesion larga puede generar miles de eventos. Renderizar todos como nodos DOM
causa performance issues. Solucion: **virtual scrolling**.

**Como funciona**: Solo se renderizan los ~30-50 items visibles en el viewport.
El contenedor tiene la altura total calculada (`N * avgItemHeight`), pero los
elementos fuera del viewport no existen en el DOM.

**Para Lit (UI de JorchBot)**: Usar `@tanstack/virtual-core` (framework-agnostic)
o implementacion custom:

```typescript
// Pseudocodigo — concepto, no implementacion
class TranscriptView {
  private events: TranscriptEvent[] = [];
  private scrollTop = 0;
  private containerHeight = 0;

  get visibleRange(): { start: number; end: number } {
    const start = Math.floor(this.scrollTop / AVG_ITEM_HEIGHT);
    const end = start + Math.ceil(this.containerHeight / AVG_ITEM_HEIGHT) + OVERSCAN;
    return { start: Math.max(0, start), end: Math.min(this.events.length, end) };
  }

  // Solo renderiza events[visibleRange.start..visibleRange.end]
}
```

**Stick-to-bottom**: Si el usuario esta al final, auto-scroll cuando llegan
nuevos eventos. Si scrollea hacia arriba, detener auto-scroll y mostrar boton
"Jump to latest".

### Backpressure

Si el runner produce output mas rapido de lo que el browser puede consumir:

1. **Server-side**: Monitorear `ws.bufferedAmount` antes de enviar. Si supera
   threshold (64KB), hacer `child.stdout.pause()`. Resumir cuando el buffer baje.
2. **Client-side**: Batch DOM updates con `requestAnimationFrame` (max 60fps).
   No renderizar mas de 1 update cada 16ms.
3. **Ring buffer**: Mantener max 10,000 eventos en memoria. Los mas viejos se
   descartan del render pero permanecen en el JSONL en disco.

### xterm.js para ShellRunner

Para los ShellRunner (comandos shell directos), el output es PTY raw con ANSI
escape codes. Para estos, usar [xterm.js](https://xtermjs.org/) (el mismo
emulador que usa VS Code):

```
ShellRunner → PTY output → WebSocket → xterm.js (browser)
```

xterm.js renderiza colores, cursor positioning, scroll — todo lo que un terminal
real hace. Solo se usa para ShellRunner, no para LLMRunners (cuyo output es
semantico via AgentRunner events).

---

## 2. Chat Web (Interactivo)

### El Problema

Hoy la unica forma de interactuar con JorchBot es via WhatsApp/Telegram. Si el
usuario esta frente al browser (viendo el dashboard), no puede enviar prompts —
tiene que cambiar a WhatsApp. Esto rompe el flujo.

### La Solucion

Un tab **Chat** en el GUI que permite iniciar sesiones, enviar prompts, aprobar
tools y ver respuestas — todo desde el browser. Basicamente WhatsApp pero en
la web, sin necesidad de canal externo.

**UX: Tabs como browser** — cada sesion abierta es un tab. Puedes tener multiples
chats activos simultaneamente:

```
┌─ [Overview] [Nodes] [Chat] [Transcripts] [Tunnels] [Settings] ─┐
│                                                                   │
│  Chat                                                             │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ [myapp (Claude)] [api (Codex)] [+ New Session]              │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │                                                             │  │
│  │  Claude                                              10:32  │  │
│  │  I'll read the auth module to understand the current        │  │
│  │  implementation.                                            │  │
│  │                                                             │  │
│  │  ┌─ Tool: Read ──────────────────────────────────────────┐  │  │
│  │  │ src/auth/login.ts (lines 1-45)               120ms   │  │  │
│  │  │ > Show output                                         │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  ┌─ Tool Approval ───────────────────────────────────────┐  │  │
│  │  │ Edit: src/auth/login.ts (line 23)                     │  │  │
│  │  │ [Approve] [Reject] [Approve All]                      │  │  │
│  │  └───────────────────────────────────────────────────────┘  │  │
│  │                                                             │  │
│  │  Claude                                              10:33  │  │
│  │  I've fixed the authentication bug. The issue was...        │  │
│  │                                                             │  │
│  ├─────────────────────────────────────────────────────────────┤  │
│  │ [📎] Type your message...                         [Send ➤] │  │
│  └─────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────┘
```

### Reuso de OpenClaw Chat View

OpenClaw ya tiene un chat component completo en `ui/src/ui/views/chat.ts` (617 LOC)
que incluye exactamente lo que necesitamos:

| Feature existente            | Uso en Chat Web                             |
| ---------------------------- | ------------------------------------------- |
| Streaming text rendering     | Output en vivo del runner                   |
| Tool calls (expand/collapse) | Ver que tools usa el runner                 |
| Tool results                 | Ver output de cada tool                     |
| Compose area                 | Enviar prompts al runner                    |
| Attachments (image paste)    | Enviar archivos/screenshots                 |
| Message grouping por rol     | Agrupar mensajes user/assistant/tool        |
| Compaction indicators        | Sesiones largas de Claude Code se compactan |
| Focus mode                   | Ya tenemos Focus Model en JorchBot          |
| Markdown sidebar             | Ver codigo formateado al lado               |
| showThinking toggle          | Mostrar/ocultar tool calls verbose          |

**Lo que agregamos encima**:

- **Session tabs** — multiples chats abiertos simultaneamente
- **New Session dialog** — elegir proyecto + runner type (Claude/Codex/Gemini)
- **Runner type badge** — indicar que LLM esta corriendo (Phase 10)
- **Tool approval buttons** — aprobar/rechazar tools desde la web
- **Project context header** — mostrar proyecto, Jorchfile, contexto %

### Backend Wiring

El chat de OpenClaw conecta a su API de agentes (Layer 1). Para JorchBot,
lo reconectamos al pipeline de Phase 10 + Phase 11:

```
Browser (compose) → WebSocket (jb.session.input) → SessionManager → AgentRunner
                                                                         │
AgentRunner events ← Phase 10 normaliza output de cualquier runner       │
  │                                                                      │
  ▼                                                                      │
WebSocket (jb.session.output) → Browser (thread rendering)               │
                                                                         │
Tool Approval:                                                           │
AgentRunner (toolApproval event) → WebSocket → Browser (approval buttons)│
Browser ([Approve]) → WebSocket (jb.tool.approve) → AgentRunner          │
```

**Es un cambio de plumbing, no de UI.** La interfaz queda igual, solo cambia
de donde vienen y a donde van los mensajes.

### Diferencia con Transcripts

| Aspecto             | Transcripts (Seccion 1) | Chat Web (Seccion 2)         |
| ------------------- | ----------------------- | ---------------------------- |
| **Proposito**       | Monitoreo / auditoria   | Interaccion directa          |
| **Modo**            | Read-only               | Bidireccional                |
| **Compose**         | No                      | Si — enviar prompts          |
| **Approvals**       | No — solo observa       | Si — aprobar/rechazar tools  |
| **Vista**           | Lista → detalle         | Tabs por sesion              |
| **Inicia sesiones** | No                      | Si — "+ New Session"         |
| **Analogia**        | Logs de CI/CD           | WhatsApp en el browser       |
| **Reuso chat**      | Solo thread rendering   | Thread + compose + approvals |

---

## 3. Model Routing Inteligente

### El Problema

En Fase 11, el usuario debe elegir manualmente que LLM usar por proyecto en el
Jorchfile (`llm = claude`). Pero:

- Para un refactor complejo → Claude es mejor (reasoning fuerte)
- Para documentacion larga → Gemini es mejor (1M context)
- Para API scaffolding → Codex puede ser suficiente (y mas rapido)
- Para una pregunta simple → Cualquier modelo pequeno basta

El usuario no deberia tener que pensar en esto.

### Estrategias de Routing

#### Estrategia 1: Rule-Based (inmediata, sin ML)

Reglas deterministicas basadas en caracteristicas del prompt/tarea:

```typescript
// src/routing/rule-router.ts — concepto

type TaskSignal = {
  promptLength: number; // tokens estimados del prompt
  taskType?: string; // de Jorchfile o deteccion automatica
  projectSize?: number; // archivos en el proyecto
  requiresReasoning?: boolean; // prompt contiene "analyze", "debug", "why"
  requiresLargeContext?: boolean; // prompt referencia >10 archivos
};

function routeByRules(signal: TaskSignal): string {
  // Tareas que necesitan mucho contexto → Gemini (1M)
  if (signal.requiresLargeContext || signal.promptLength > 50_000) {
    return "gemini";
  }
  // Tareas de razonamiento complejo → Claude (mejor reasoning)
  if (signal.requiresReasoning) {
    return "claude";
  }
  // API / scaffolding → Codex
  if (signal.taskType === "api" || signal.taskType === "scaffold") {
    return "codex";
  }
  // Default
  return config.runners.default;
}
```

**Ventajas**: Cero latencia, cero costo, predecible, debuggeable.
**Desventajas**: Reglas rigidas, no aprende.

#### Estrategia 2: Semantic Router (embeddings)

Clasificar el prompt por intencion usando embeddings y comparar con centroides
de cada modelo:

```
Prompt: "Analyze the API docs for breaking changes in v2.0"
  │
  ▼ embed()
[0.23, -0.15, 0.87, ...]  (vector 384-dim)
  │
  ├── cosine_sim(claude_centroid) = 0.72
  ├── cosine_sim(codex_centroid)  = 0.45
  └── cosine_sim(gemini_centroid) = 0.91  ← Winner
  │
  ▼
Route → Gemini (docs/analysis specialist)
```

**Centroides**: Se construyen offline embeddeando descripciones de las fortalezas
de cada modelo. Ejemplo:

- `claude_centroid` = avg(embed("complex code refactoring"), embed("debugging"),
  embed("architectural decisions"), ...)
- `gemini_centroid` = avg(embed("documentation analysis"), embed("long document
  summary"), embed("large codebase review"), ...)

**Ventajas**: Entiende semantica, no solo keywords.
**Desventajas**: Requiere buenos centroides, latencia de embedding (~50ms).

#### Estrategia 3: RouteLLM (ML classifier)

Usar [RouteLLM](https://github.com/lm-sys/RouteLLM) — un clasificador entrenado
en preferencias humanas (Chatbot Arena) que decide "modelo fuerte" vs "modelo
debil":

- **85% reduccion de costos** manteniendo 95% de calidad GPT-4
- Router `sw_ranking`: No requiere GPU, ~5ms latencia
- OpenAI-compatible API — facil de integrar

**Para JorchBot**: No aplica directamente porque usamos CLIs (no API), pero el
concepto del clasificador si aplica. Se podria entrenar un clasificador ligero
(BERT small) en datos de tareas de JorchBot para routing.

**Recomendacion**: No vale la pena en esta etapa. Rule-based + semantic router
cubre el 90% de los casos.

### Configuracion del Router

```json
{
  "routing": {
    "enabled": true,
    "strategy": "rules",
    "rules": {
      "largeContext": { "threshold": 50000, "model": "gemini" },
      "reasoning": { "keywords": ["analyze", "debug", "why", "refactor"], "model": "claude" },
      "api": { "keywords": ["api", "endpoint", "rest", "graphql"], "model": "codex" }
    },
    "fallback": "claude"
  }
}
```

**Jorchfile override**: El usuario siempre puede forzar `llm = claude` en el
Jorchfile. El router solo actua cuando `llm = auto`.

```
PROJECT myapp
  path = ~/projects/myapp
  llm = auto          # ← Router decide

PROJECT api
  path = ~/projects/api
  llm = codex         # ← Forzado a Codex
```

---

## 4. Streaming Cross-Runner

### El Problema

En Fase 11, `ask_agent` y `spawn_agent` son **request-response**: el runner A
pide algo al runner B y espera el resultado final. No hay visibilidad de lo que
B esta haciendo mientras procesa.

Esto importa cuando:

- Runner B tarda 2 minutos en analizar — el usuario ve "silencio"
- Runner A quiere reaccionar a findings parciales de B
- El GUI quiere mostrar progreso de tareas delegadas

### La Solucion

Agregar un modo `stream: true` a las interacciones inter-runner:

```typescript
// MCP action: ask_agent con streaming
{
  action: "ask_agent",
  params: {
    project: "api",
    question: "Run the full test suite and report results",
    stream: true,       // ← Nuevo: streaming mode
    timeoutMs: 180_000
  }
}
```

**Flujo con streaming**:

```
Runner A (myapp/claude)                    Runner B (api/codex)
     │                                           │
     │  ask_agent("api", question, stream:true)  │
     │ ─────────────────────────────────────────> │
     │                                           │ start processing...
     │                                           │
     │  ← stream_event: "Running test suite..."  │
     │  ← stream_event: "45/120 tests passed..." │
     │  ← stream_event: "Found 3 failures..."    │
     │  ← stream_event: "Analyzing failures..."  │
     │                                           │
     │  ← final_result: { passed: 117, failed: 3,│
     │       failures: [...] }                    │
     │                                           │
     │  (Runner A ve progreso en tiempo real)     │
```

**Implementacion**: El Transcript Bridge (seccion 1) ya captura NDJSON del runner.
Para streaming cross-runner:

1. Runner A envia `ask_agent(stream: true)` al MCP orchestrator
2. Orchestrator crea un `ReadableStream` vinculado al output de Runner B
3. MCP response es un streaming response (chunked)
4. Runner A recibe chunks parciales como `stream_event`s
5. GUI tambien recibe los eventos via WebSocket (vista multi-transcript)

### Vista GUI: Multi-Transcript

Cuando hay streaming cross-runner, el GUI puede mostrar multiples transcripts
side-by-side:

```
┌─ myapp (Claude) ─────────────┬─ api (Codex) ─────────────────┐
│                               │                                │
│ 🤖 "I'll ask the api agent   │ 🤖 "Running test suite..."     │
│ to run the tests..."          │                                │
│                               │ ⏳ 45/120 passed               │
│ ⏳ Waiting for api agent...   │ ⏳ 90/120 passed               │
│                               │ ❌ 3 failures found:           │
│                               │   - auth.test.ts:23            │
│                               │   - user.test.ts:45            │
│                               │   - api.test.ts:67             │
│                               │                                │
│ 🤖 "The api agent found 3    │ ✅ Completed · 117/120 passed  │
│ test failures. Let me fix..." │                                │
│                               │                                │
│ ✏️ Tool: Edit auth.test.ts    │                                │
└───────────────────────────────┴────────────────────────────────┘
```

---

## 5. MCP Tool Marketplace

### El Problema

Fase 11 define un MCP server propio de JorchBot con tools internos (memory,
messaging, cron, agents). Pero el ecosistema MCP ya tiene **miles de servers**
que podrian ampliar las capacidades:

- GitHub MCP → operaciones de repos, PRs, issues
- PostgreSQL MCP → consultas a base de datos
- Slack MCP → enviar/leer mensajes
- Stripe MCP → gestion de pagos
- Y 17,000+ mas en registros publicos

### Registros Existentes (2025-2026)

| Registro                                 | Servers | Diferenciador                             |
| ---------------------------------------- | ------- | ----------------------------------------- |
| [mcp.so](https://mcp.so)                 | 17,000+ | Catalogo mas grande, playground           |
| [Glama.ai](https://glama.ai/mcp/servers) | 9,000+  | Hosting managed, Firecracker VM isolation |
| [Smithery.ai](https://smithery.ai)       | 2,800+  | CLI de gestion, curado, verificado        |
| MCP Registry (oficial)                   | Preview | Descubrimiento programatico, code signing |

### Integracion con JorchBot

**NO construimos un marketplace propio.** Integramos con los existentes:

```
┌─ GUI: MCP Tools ──────────────────────────────────────┐
│                                                        │
│  Installed (3)                    Available             │
│  ┌──────────────────────┐       ┌────────────────────┐ │
│  │ ✅ jorchbot (builtin)│       │ 🔍 Search registry │ │
│  │ ✅ github            │       │                    │ │
│  │ ✅ postgres          │       │ Results:           │ │
│  └──────────────────────┘       │  📦 stripe-mcp     │ │
│                                 │  📦 slack-mcp      │ │
│  [Configure] [Remove]           │  📦 jira-mcp       │ │
│                                 │  [Install]          │ │
│                                 └────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

**Workflow**:

1. Usuario busca un MCP tool en el GUI (query a Smithery API)
2. Selecciona e instala (via `npx @smithery/cli install`)
3. JorchBot regenera MCP config para los runners activos
4. El tool queda disponible para todos los runners

### Seguridad

Los MCP servers de terceros son **codigo ejecutable no confiable**. Riesgos:

| Riesgo                               | Probabilidad          | Mitigacion                                           |
| ------------------------------------ | --------------------- | ---------------------------------------------------- |
| Tool poisoning (hidden instructions) | Alta                  | Validar descripciones, allowlist                     |
| Credential exposure                  | Alta (53% de servers) | Nunca pasar secrets del sistema al MCP               |
| Excessive permissions                | Alta                  | Sandbox con filesystem/network restringido           |
| Supply chain attack                  | Media                 | Pinear versiones, verificar hashes                   |
| Prompt injection via results         | Media                 | Sanitizar output del MCP antes de inyectar al runner |

**Modelo de confianza**:

```
Tier 1 (trusted)  → jorchbot (builtin), MCP servers del usuario
Tier 2 (verified) → Smithery verified, oficial MCP Registry con code signing
Tier 3 (untrusted)→ Todo lo demas

Tier 1: Sin restricciones
Tier 2: Filesystem limitado al proyecto, network permitido
Tier 3: Sandbox completo (container/chroot), filesystem read-only, network egress controlado
```

**Config**:

```json
{
  "mcp": {
    "marketplace": {
      "enabled": true,
      "registry": "smithery",
      "autoUpdate": false,
      "trustPolicy": "verified-only"
    },
    "installed": {
      "github": { "version": "1.2.3", "tier": "verified", "env": { "GITHUB_TOKEN": "..." } },
      "postgres": { "version": "0.9.0", "tier": "verified", "env": { "DATABASE_URL": "..." } }
    }
  }
}
```

### Token Impact

Cada MCP server adicional agrega tools al context window. Con la estrategia
Orchestrator-Delegate de Fase 11 (1 unified tool), el overhead del MCP propio
es ~200 tokens. Pero los MCP tools de terceros se registran **directamente** en
el runner — cada uno agrega ~500 tokens.

**Mitigacion**: Aplicar la misma estrategia de Progressive Discovery:

- Los tools de terceros no se cargan automaticamente
- El runner pide `jorchbot_request({ action: "mcp.search", query: "github PR" })`
- El orchestrator busca en los tools instalados y retorna el schema relevante
- Solo entonces el runner llama al tool especifico

Esto mantiene el overhead base en ~200 tokens independientemente de cuantos
MCP tools esten instalados.

---

## 6. Federation entre JorchBots

### El Problema

Un JorchBot es single-instance. Corre en una maquina, gestiona N proyectos.
Pero hay escenarios donde multiples instancias necesitan colaborar:

| Escenario              | Descripcion                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| **Equipo distribuido** | Dev A tiene JorchBot-A, Dev B tiene JorchBot-B. Ambos trabajan en el mismo repo. |
| **Multi-machine**      | JorchBot en laptop (rapido, local) + JorchBot en servidor (potente, 24/7)        |
| **Staging + Prod**     | JorchBot-staging coordina deploys con JorchBot-production                        |
| **Especializado**      | JorchBot-frontend (Claude) + JorchBot-backend (Codex) + JorchBot-infra (Gemini)  |

### A2A Protocol (Google / Linux Foundation)

La federacion se implementa usando el [protocolo A2A](https://a2a-protocol.org) —
un estandar abierto para comunicacion agent-to-agent. 150+ organizaciones lo
adoptan (Google, Salesforce, SAP, AWS, Atlassian).

**Por que A2A y no un protocolo custom**:

- Estandar abierto (Apache 2.0, Linux Foundation)
- Diseñado especificamente para agentes autonomos
- Complementa MCP (MCP = agent→tools, A2A = agent→agent)
- Auth incorporado (OAuth 2.0, mTLS)
- Streaming incorporado (SSE para tareas largas)
- Cualquier otro sistema A2A-compatible podria hablar con JorchBot

### Agent Cards (Descubrimiento)

Cada JorchBot publica un **Agent Card** que describe sus capacidades:

```json
{
  "name": "JorchBot-Alpha",
  "description": "Development orchestrator for frontend projects",
  "url": "https://alpha.tailnet.ts.net:18789",
  "provider": {
    "organization": "My Team",
    "url": "https://myteam.dev"
  },
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "authentication": {
    "schemes": ["Bearer"]
  },
  "skills": [
    {
      "id": "code-review",
      "name": "Code Review",
      "description": "Deep code review using Claude Code",
      "inputModes": ["text/plain"],
      "outputModes": ["application/json"]
    },
    {
      "id": "test-runner",
      "name": "Test Runner",
      "description": "Run project test suites via Codex",
      "inputModes": ["text/plain"],
      "outputModes": ["application/json"]
    },
    {
      "id": "doc-analysis",
      "name": "Documentation Analysis",
      "description": "Analyze large codebases and docs via Gemini (1M context)",
      "inputModes": ["text/plain"],
      "outputModes": ["application/json"]
    }
  ]
}
```

**Descubrimiento**:

- **Tailscale DNS**: Cada JorchBot publica su Agent Card en
  `https://<hostname>.tailnet.ts.net:18789/.well-known/agent.json`
- **Manual registration**: El usuario agrega instancias remotas en la config
- **mDNS/Bonjour**: Para LAN discovery (nice-to-have)

### Flujo de Delegacion Federada

```
Usuario → JorchBot-A (laptop):
  "Run the full test suite for the API project"

JorchBot-A:
  1. No tiene el proyecto "api" localmente
  2. Consulta registry de peers conocidos
  3. Encuentra JorchBot-B (servidor) tiene skill "test-runner" + proyecto "api"
  4. Delega via A2A:

     POST https://server.tailnet.ts.net:18789/a2a/tasks/send
     Authorization: Bearer <tailscale-token>
     {
       "jsonrpc": "2.0",
       "method": "tasks/send",
       "params": {
         "message": {
           "role": "user",
           "parts": [{ "kind": "text", "text": "Run full test suite for api project" }]
         }
       }
     }

  5. JorchBot-B ejecuta (Codex runner, test suite)
  6. JorchBot-A recibe streaming progress via SSE
  7. JorchBot-A retorna resultado al usuario via WhatsApp
```

### Seguridad

| Capa              | Mecanismo     | Detalle                                              |
| ----------------- | ------------- | ---------------------------------------------------- |
| **Network**       | Tailscale     | Solo peers en el mismo tailnet pueden conectarse     |
| **Transport**     | TLS           | HTTPS obligatorio (Tailscale HTTPS certs)            |
| **Auth**          | Device tokens | Reusar el device auth existente de JorchBot (Fase 6) |
| **Authorization** | Scoped skills | Cada peer solo puede invocar skills explicitos       |
| **Audit**         | Event log     | Todas las delegaciones federadas se loguean          |

**Config**:

```json
{
  "federation": {
    "enabled": false,
    "publishCard": true,
    "peers": [
      {
        "name": "JorchBot-Server",
        "url": "https://server.tailnet.ts.net:18789",
        "token": "..."
      }
    ],
    "allowedSkills": ["test-runner", "doc-analysis"],
    "blockedSkills": ["shell-exec"]
  }
}
```

### Memoria Compartida Federada

Con federation, la memoria vectorial puede ser consultada cross-instance:

```
JorchBot-A: jorchbot_request({ action: "memory_search", params: { query: "auth module", scope: "federation" } })
  │
  ├── Busca local (sqlite-vec) → 3 resultados
  ├── Busca en JorchBot-B via A2A → 2 resultados
  └── Merge + rank → top 5 resultados
```

Esto NO replica la base de datos. Cada instancia mantiene su propia memoria.
Las busquedas federadas son queries remotas on-demand.

---

## 7. Fases de Implementacion

| Sub-fase | Nombre                     | Entregable                                                                | Esfuerzo |
| -------- | -------------------------- | ------------------------------------------------------------------------- | -------- |
| **12A**  | Transcript Bridge          | AgentRunner events → WebSocket streaming + persistencia JSONL             | 3-4 dias |
| **12B**  | Transcripts Tab            | Lista de runners + detalle read-only (reusa thread rendering de OpenClaw) | 3-4 dias |
| **12C**  | Chat Tab                   | Session tabs + compose + tool approvals (reusa chat view de OpenClaw)     | 3-4 dias |
| **12D**  | Shell Terminal UI          | xterm.js integration para ShellRunner output                              | 2-3 dias |
| **12E**  | Rule-Based Router          | Task signal detection + routing rules + config schema                     | 2-3 dias |
| **12F**  | Semantic Router            | Embedding-based routing + model centroids                                 | 3-4 dias |
| **12G**  | Cross-Runner Streaming     | stream mode para ask_agent/spawn_agent + multi-transcript GUI             | 4-5 dias |
| **12H**  | MCP Marketplace UI         | Registry search + install + config + trust tiers                          | 4-5 dias |
| **12I**  | MCP Progressive Discovery  | Proxy layer para tools de terceros + token optimization                   | 2-3 dias |
| **12J**  | A2A Agent Card             | Publicar/consumir Agent Cards + skill registry                            | 3-4 dias |
| **12K**  | A2A Task Delegation        | tasks/send + SSE streaming + result handling                              | 4-5 dias |
| **12L**  | Federation Auth & Security | Tailscale auth + scoping + audit logging                                  | 3-4 dias |
| **12M**  | Federation Memory          | Cross-instance memory search + merge ranking                              | 2-3 dias |
| **12N**  | Polish + Tests             | Integration tests, edge cases, docs                                       | 3-4 dias |

**Total estimado: 44-58 dias de desarrollo.**

**Orden recomendado**: 12A → 12B/12C (paralelo) → 12D → 12E → 12F → 12G → 12H/12I (paralelo) → 12J → 12K → 12L → 12M → 12N

**MVP de Fase 12**: 12A + 12B + 12C + 12E = Transcripts + Chat + Rule-Based Router
(~12-15 dias). Esto ya transforma la experiencia del usuario — puede ver y controlar
runners desde el browser.

**Nota sobre reuso**: Gracias al chat view existente de OpenClaw, 12B y 12C son
significativamente mas rapidos de lo que serian construyendo desde cero. El thread
rendering, tool cards, streaming, message grouping, attachments y markdown sidebar
ya estan implementados (~617 LOC en `ui/src/ui/views/chat.ts`).

---

## 8. Riesgos y Mitigaciones

| Riesgo                                           | Probabilidad | Impacto | Mitigacion                                                   |
| ------------------------------------------------ | ------------ | ------- | ------------------------------------------------------------ |
| NDJSON format cambia entre CLI versions          | Media        | Alto    | Parsers versionados, tests de compatibilidad                 |
| Virtual scrolling bugs con variable-height items | Alta         | Medio   | Height cache, measure-after-render, fallback a scroll normal |
| MCP tools de terceros maliciosos                 | Alta         | Alto    | Trust tiers, sandbox, allowlist, version pinning             |
| A2A protocol breaking changes (v0.3 → v1.0)      | Alta         | Medio   | Abstraction layer, feature flag                              |
| Federation latency (cross-network)               | Media        | Medio   | Timeouts, caching, async delegation                          |
| Token overhead con muchos MCP tools instalados   | Alta         | Alto    | Progressive discovery proxy                                  |
| Cross-runner deadlock                            | Baja         | Alto    | Timeout estricto, cycle detection, max concurrent            |
| Backpressure overwhelms server memory            | Baja         | Alto    | Ring buffer, ws.bufferedAmount monitoring, pause/resume      |

---

## 9. NO se construye en esta fase

- **Fine-tuning de modelos** (fuera de scope permanentemente)
- **ML-based router** (RouteLLM) — rule-based + semantic router es suficiente
- **Custom MCP registry** — integramos con Smithery, no construimos propio
- **Cross-JorchBot streaming** (ver output de otro JorchBot en tiempo real)
- **Automatic peer discovery** (mDNS) — manual registration es suficiente

---

## 10. Definicion de "Terminado"

**Transcripts (monitoreo)**:

- [ ] Tab Transcripts muestra lista de runners/sesiones con status, proyecto, duracion
- [ ] Click en runner → detalle read-only con thread rendering completo
- [ ] Filtros por proyecto, status, runner type, fecha
- [ ] Virtual scrolling funcional con 10,000+ eventos
- [ ] xterm.js funcional para ShellRunner output

**Chat Web (interactivo)**:

- [ ] Tab Chat con session tabs (multiples chats simultaneos)
- [ ] "+ New Session" dialog: elegir proyecto + runner type
- [ ] Compose area: enviar prompts al runner
- [ ] Tool approval buttons: aprobar/rechazar desde la web
- [ ] Streaming en vivo, tool cards, message grouping (reusado de OpenClaw)

**Model Routing**:

- [ ] Model router rule-based funcional (`llm = auto` en Jorchfile)
- [ ] Semantic router con embeddings (optional, si rule-based no basta)

**Cross-Runner Streaming**:

- [ ] `ask_agent(stream: true)` funcional
- [ ] Multi-transcript view en GUI (side-by-side)

**MCP Marketplace**:

- [ ] Buscar, instalar, configurar tools de terceros
- [ ] Progressive discovery para tools de terceros (token optimization)

**Federation**:

- [ ] A2A Agent Card publicable/consumible
- [ ] Delegar tareas entre JorchBots via A2A
- [ ] Federation auth via Tailscale + device tokens
- [ ] Federated memory search funcional

**General**:

- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Referencias

### Transcript Streaming

- [Claude Code Headless Mode](https://code.claude.com/docs/en/headless)
- [xterm.js](https://xtermjs.org/)
- [websocketd](https://github.com/joewalnes/websocketd)
- [Node.js Backpressure in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams)
- [claude-code-log JSONL viewer](https://github.com/daaain/claude-code-log)

### Model Routing

- [RouteLLM (LMSYS, ICLR 2025)](https://github.com/lm-sys/RouteLLM)
- [Not Diamond — Model Router](https://www.notdiamond.ai/)
- [Unify.ai — Dynamic Routing](https://unify.ai/)
- [Task-Based LLM Routing (Portkey)](https://portkey.ai/blog/task-based-llm-routing/)
- [vLLM Semantic Router](https://blog.vllm.ai/2025/09/11/semantic-router.html)

### MCP Marketplace

- [Smithery.ai](https://smithery.ai/)
- [Glama.ai MCP Servers](https://glama.ai/mcp/servers)
- [mcp.so](https://mcp.so/)
- [MCP Registry (oficial)](https://modelcontextprotocol.io)
- [State of MCP Security 2025 (Astrix)](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/)

### Federation / A2A

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Agent Discovery](https://a2a-protocol.org/latest/topics/agent-discovery/)
- [A2A Streaming & Async](https://a2a-protocol.org/latest/topics/streaming-and-async/)
- [A2A + MCP Relationship](https://a2a-protocol.org/latest/topics/a2a-and-mcp/)
- [Secure A2A with Auth0](https://auth0.com/blog/auth0-google-a2a/)
