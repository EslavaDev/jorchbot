# Fase 11 - Headless LLM Orchestrator

> **Estado**: Investigacion
> **Dependencia**: Fase 8 (Multi-LLM + Security), Fase 6 (GUI)
> **Entregable**: Orquestador multi-LLM headless con memoria vectorial, messaging, cron, sub-agentes, y MCP server compartido
> **Al terminar**: JorchBot es una plataforma de orquestacion multi-LLM donde agentes Claude/Codex/Gemini colaboran con memoria compartida, se comunican entre si, y ejecutan tareas programadas — todo via CLI headless a coste de suscripcion

---

## Nota Arquitectural

> Esta fase transforma JorchBot de un "Claude Code remote control" a un
> **orquestador multi-LLM headless**. La idea central es:
>
> - **Tomar toda la funcionalidad de OpenClaw** (memory, messaging, cron, subagents,
>   tool policies, heartbeat)
> - **Reemplazar el motor de ejecucion** (LLM API calls) por **CLIs headless**
>   (Claude Code, Codex CLI, Gemini CLI)
> - **Exponer las capacidades via MCP server** para que cualquier CLI las consuma
>
> **Beneficio economico**: API calls cuestan por token. CLIs headless usan la
> suscripcion/free tier del servicio. Para el mismo trabajo, el ahorro es
> significativo a escala.

---

## 1. Vision General

### El Problema

OpenClaw tiene un ecosistema completo de agentes: memoria vectorial, messaging
cross-channel, cron jobs, sub-agentes, tool policies. Pero su motor de ejecucion
usa `getReplyFromConfig()` que hace API calls directos al LLM — **pagando por
token en cada interaccion**.

JorchBot ya resolvio parte del problema: ClaudeRunner ejecuta Claude Code como
subprocess headless. Pero hoy solo tiene:

- ✅ ClaudeRunner (Claude Code headless)
- ❌ Sin memoria vectorial (no recuerda conversaciones pasadas)
- ❌ Sin messaging (runners no pueden enviar alertas proactivamente)
- ❌ Sin cron (no hay tareas programadas)
- ❌ Sin sub-agentes (runners no se comunican entre si)
- ❌ Solo Claude Code (no Codex, no Gemini)

### La Solucion

Construir un **JorchBot MCP Server** que expone todas las capacidades de
OpenClaw como MCP tools, consumibles por cualquier CLI headless:

```
┌────────────────────────────────────────────────────┐
│              JorchBot MCP Server                   │
│                                                    │
│  memory_search    → sqlite-vec + embeddings        │
│  memory_get       → file read from indexed store   │
│  send_message     → Kapso/Telegram/GUI delivery    │
│  spawn_agent      → new LLM runner subprocess      │
│  ask_agent        → inter-runner query             │
│  cron_add         → scheduled task registration    │
│  cron_list        → list scheduled tasks           │
│  session_list     → active sessions info           │
│  session_status   → context %, tokens, status      │
│  heartbeat_status → heartbeat monitoring info      │
│                                                    │
│  Transport: stdio (subprocess) o HTTP/SSE          │
└───────────────────────┬────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   claude --mcp     codex --mcp     gemini --mcp
```

---

## 2. Problema Critico: MCP Token Overhead

### El Problema de los Tokens

Los MCP tools consumen tokens en el context window del LLM. Cada herramienta
registrada consume entre **100-1,000 tokens** solo en su definicion (schema +
descripcion). Datos reales:

| MCP Server               | Tools | Tokens consumidos | Tokens/tool |
| ------------------------ | ----- | ----------------- | ----------- |
| MySQL server             | 106   | ~54,600           | ~515        |
| GitHub MCP               | 93    | ~55,000           | ~591        |
| mcp-omnisearch           | 20    | ~14,214           | ~711        |
| Setup tipico (4 servers) | 167   | ~60,000           | ~359        |

**Impacto**: Un MCP server con 10 tools consume ~5,000-7,000 tokens antes de
que el runner procese su primer prompt. Con el context window de 200K de Claude
Code, esto es ~3%. Pero si sumas el system prompt, HEARTBEAT.md, instrucciones
del proyecto, y el historial de conversacion, cada token cuenta.

### Estrategias de Optimizacion Comprobadas

#### Estrategia 1: Progressive Discovery (Speakeasy) — **96% reduccion**

En vez de cargar todas las tool definitions al inicio, se usa un pattern de
3 pasos:

1. `search_tools("query")` → retorna nombres + descripciones breves (~50 tokens total)
2. `describe_tools(["tool_a", "tool_b"])` → retorna schemas completos solo de las seleccionadas
3. `execute_tool("tool_a", params)` → ejecuta

**Resultado**: 400 tools pasan de 400K tokens a ~4K tokens iniciales.

#### Estrategia 2: Vector-Based Tool Filtering (Redis) — **98% reduccion**

Almacenar embeddings de las descripciones de tools. En cada query, buscar las
3-5 tools mas relevantes via cosine similarity.

**Resultado**: 23K tokens → 800 tokens. Latencia: 3.4s → 392ms.

#### Estrategia 3: Claude Code Tool Search (built-in) — **95% reduccion**

Claude Code activa automaticamente Tool Search cuando los MCP tools superan el
10% del context window. Construye un indice ligero y carga tools on-demand.

**Resultado**: ~77K tokens → ~8.7K tokens con 50+ tools.

#### Estrategia 4: Code Execution Approach (Anthropic) — **98.7% reduccion**

Convertir tool definitions en archivos TypeScript en el filesystem. El agente
navega directorios y carga definiciones on-demand.

**Resultado**: 150K tokens → 2K tokens.

### Nuestra Estrategia: Orchestrator-Delegate Pattern

Para JorchBot, la estrategia optima combina las anteriores con un **patron de
orquestacion delegada**:

```
┌───────────────────────────────────────────────┐
│           LLM Runner (Claude/Codex/Gemini)    │
│                                               │
│  Solo tiene 1 MCP tool registrado:            │
│  ┌─────────────────────────────────────────┐  │
│  │  jorchbot_request(action, params)       │  │
│  │  "Envia una solicitud al orquestador    │  │
│  │   JorchBot para ejecutar acciones como  │  │
│  │   buscar en memoria, enviar mensajes,   │  │
│  │   o comunicarse con otros agentes."     │  │
│  └─────────────────────────────┬───────────┘  │
│                                │               │
└────────────────────────────────┼───────────────┘
                                 │ MCP call
                                 ▼
┌───────────────────────────────────────────────┐
│           JorchBot Orchestrator               │
│  (MCP server inteligente)                     │
│                                               │
│  Recibe: { action: "memory_search",           │
│            params: { query: "auth module" } }  │
│                                               │
│  Ejecuta internamente:                        │
│  1. MemoryIndexManager.search(query)          │
│  2. Filtra resultados (top 5, score > 0.35)   │
│  3. Formatea respuesta compacta               │
│  4. Retorna al runner                         │
│                                               │
│  Acciones disponibles:                        │
│  ├── memory_search(query, maxResults)         │
│  ├── memory_get(path, from, lines)            │
│  ├── send_message(channel, to, text)          │
│  ├── spawn_agent(project, llm, prompt)        │
│  ├── ask_agent(project, question)             │
│  ├── cron_add(schedule, prompt, project)      │
│  ├── cron_list()                              │
│  ├── cron_remove(id)                          │
│  ├── session_list()                           │
│  ├── session_status(project)                  │
│  └── heartbeat_status()                       │
└───────────────────────────────────────────────┘
```

**Ventaja clave**: El runner solo tiene **1 tool** registrado (~200 tokens de
overhead) en vez de 10+ (~5,000+ tokens). El orchestrator hace todo el trabajo
pesado server-side, sin consumir tokens del runner.

**Overhead estimado por runner**: ~200-300 tokens (1 tool definition). Comparado
con ~5,000-7,000 tokens (10 tools individuales). **Reduccion: ~95%**.

### Alternativa: Multi-Tool con Schema Minimo

Si la experiencia con 1 tool es limitante (el runner no sabe que acciones hay),
se puede usar un hibrido:

```
Tools registrados (schema minimo, ~50 tokens cada uno):
  - jorchbot_memory(query)         # "Search past conversations and project history"
  - jorchbot_message(to, text)     # "Send a message to a channel or user"
  - jorchbot_agent(project, prompt)# "Communicate with another agent"
  - jorchbot_cron(action, params)  # "Manage scheduled tasks"
  - jorchbot_status()              # "Get system status"
```

5 tools × ~50 tokens = ~250 tokens. Aun asi **95%+ de reduccion** vs schemas
completos.

---

## 3. Componentes Detallados

### 3.1 LLMRunner Interface (base para multi-LLM)

Extraer una interfaz abstracta de ClaudeRunner que todos los backends implementen:

```typescript
// src/runners/llm-runner.ts

interface LLMRunnerEvents {
  text: [text: string];
  toolUse: [request: LLMToolUseRequest];
  result: [result: LLMRunnerResult];
  error: [error: Error];
}

interface LLMRunner extends EventEmitter<LLMRunnerEvents> {
  readonly name: string; // "claude" | "codex" | "gemini"
  readonly displayName: string; // "Claude Code" | "OpenAI Codex" | "Gemini CLI"

  start(options: LLMStartOptions): Promise<LLMRunnerResult>;
  resume(options: LLMResumeOptions): Promise<LLMRunnerResult>;
  stop(): Promise<void>;

  getSessionId(): string | null;
  getStatus(): LLMRunnerStatus;
  getTokenCounts(): { input: number; output: number };
  getContextPercent(): number;
  getContextLimit(): number;
  setEnv(env: Record<string, string>): void;
}

interface LLMStartOptions {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
  timeoutMs?: number;
  skipPermissions?: boolean;
  mcpConfig?: string; // Path to MCP config file
}

type LLMRunnerStatus = "idle" | "running" | "stopped" | "error";
```

**Implementaciones**:

| Runner       | CLI Command                                   | Output Format          | Session Mgmt        | MCP Support                  |
| ------------ | --------------------------------------------- | ---------------------- | ------------------- | ---------------------------- |
| ClaudeRunner | `claude -p "..." --output-format stream-json` | NDJSON streaming       | `--resume <id>`     | `--mcp-config` ✅            |
| CodexRunner  | `codex exec --json "..."`                     | JSONL                  | `--session-id <id>` | `codex mcp add` ✅           |
| GeminiRunner | `gemini "..."`                                | Text/JSON configurable | Conversation-based  | `~/.gemini/settings.json` ✅ |

**Dato critico**: Los tres CLIs mayores ya soportan MCP como protocolo nativo.
Esto significa que un solo JorchBot MCP Server sirve a los tres sin adaptacion.

### 3.2 JorchBot MCP Server

Un MCP server implementado con `@modelcontextprotocol/sdk` que expone las
capacidades de JorchBot a cualquier CLI:

```typescript
// src/mcp/jorchbot-mcp-server.ts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "jorchbot",
  version: "1.0.0",
  description: "JorchBot orchestration tools: memory, messaging, agents, cron",
});

// Tool: Unified orchestrator request (1 tool, minimal token overhead)
server.registerTool(
  "jorchbot_request",
  {
    title: "JorchBot Request",
    description:
      "Execute an action via the JorchBot orchestrator. Actions: " +
      "memory_search, memory_get, send_message, spawn_agent, ask_agent, " +
      "cron_add, cron_list, session_list, session_status, heartbeat_status",
    inputSchema: z.object({
      action: z.string(),
      params: z.record(z.unknown()).optional(),
    }),
  },
  async ({ action, params }) => {
    // Route to internal handler based on action
    const result = await orchestrator.execute(action, params ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);
```

**Transporte**: stdio (para subprocesos) o HTTP/SSE (para conexiones remotas).

**Nota sobre Zod**: El MCP SDK tiene un issue de compatibilidad con Zod 4
([issue #1429](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1429)).
JorchBot usa Zod 4.x. Opciones:

1. Usar el re-export de Zod del SDK: `import { z } from "@modelcontextprotocol/sdk/zod"`
2. Esperar a que el SDK soporte Zod 4 nativamente
3. Usar schemas JSON directos en vez de Zod para las tool definitions del MCP

### 3.3 Memory System (Vector Search)

Reusar el sistema de memoria de OpenClaw (Layer 1) conectandolo a las sesiones
de JorchBot.

#### Arquitectura

```
ClaudeRunner session output (NDJSON stream)
  │
  ▼
Transcript Writer (new)
  │  Escribe: ~/.jorchbot/agents/{project}/sessions/{date}.jsonl
  ▼
Memory Sync (existing Layer 1)
  │  Lee JSONL → parsea User:/Assistant: → chunking (400 tokens, 80 overlap)
  ▼
Embedding Provider
  │  Local: embeddinggemma-300m (free, no API)
  │  Remote: text-embedding-3-small ($0.02/1M tokens)
  ▼
sqlite-vec (existing Layer 1)
  │  Vector storage + cosine similarity search
  │  + FTS5 BM25 keyword search (hybrid)
  ▼
MCP Tool: memory_search(query)
  │  Retorna: top 5 chunks relevantes
  ▼
Runner recibe contexto de conversaciones pasadas
```

#### Embedding Provider Recommendation

| Provider                    | Costo              | Calidad (MTEB) | Latencia    | Recomendado para                         |
| --------------------------- | ------------------ | -------------- | ----------- | ---------------------------------------- |
| Local (embeddinggemma-300m) | $0                 | ~80%           | ~50ms/chunk | Dev, self-hosted, offline                |
| text-embedding-3-small      | $0.02/1M tokens    | ~82%           | ~20ms/chunk | Produccion con presupuesto               |
| nomic-embed-text-v1         | $0 (local)         | ~81%           | ~30ms/chunk | Mejor calidad local, contexto largo (8K) |
| Gemini embedding-001        | Free tier generoso | ~80%           | ~25ms/chunk | Ya tienes Gemini API key                 |

**Recomendacion**: Empezar con **embeddings locales** (embeddinggemma o nomic).
Cero costo, cero dependencia, funciona offline. Migrar a remote solo si la
calidad no es suficiente.

#### Costos de Indexacion

Para un proyecto tipico con 50 sesiones de conversacion (~500 chunks totales):

| Provider               | Tokens totales | Costo indexacion | Costo busqueda/dia |
| ---------------------- | -------------- | ---------------- | ------------------ |
| Local                  | N/A            | $0.00            | $0.00              |
| text-embedding-3-small | ~200K          | $0.004           | ~$0.001            |
| Gemini embedding-001   | ~200K          | Free tier        | Free tier          |

**Conclusion**: El costo de memoria vectorial es **negligible** incluso con
providers remotos.

#### Optimizacion de Memoria y Tokens

1. **Indexacion incremental**: Solo re-indexar chunks que cambiaron (hash-based delta)
2. **Cache de embeddings**: No re-embeddear texto identico (Layer 1 ya tiene esto)
3. **Resultado compacto**: El MCP tool retorna max 5 snippets de ~700 chars cada uno
   (~3,500 chars = ~1,000 tokens). Mucho menos que incluir transcripts completos.
4. **Temporal decay**: Resultados recientes pesan mas que antiguos (configurable)
5. **Source filtering**: Buscar solo en sesiones del proyecto actual, no en todos

### 3.4 Messaging (Cross-Channel Delivery)

Permitir que runners envien mensajes proactivamente a canales:

```typescript
// MCP action: send_message
{
  action: "send_message",
  params: {
    channel: "kapso",      // o "telegram", "gui"
    to: "+52...",           // opcional, default = session owner
    text: "Build failed: 3 tests failing in auth module",
    buttons: [              // opcional
      { id: "fix", title: "Auto-fix" },
      { id: "ignore", title: "Ignore" },
    ]
  }
}
```

**Implementacion**: Reusar el sistema de delivery existente de JorchBot
(`sendReplyTo` del SessionManager). El MCP tool simplemente delega al delivery
layer.

**Caso de uso**: Un runner detecta un error en el build y envia un mensaje a
WhatsApp sin que el usuario haya preguntado nada.

### 3.5 Cron (Tareas Programadas)

Reusar el sistema de cron de OpenClaw adaptandolo a runners headless:

```typescript
// MCP action: cron_add
{
  action: "cron_add",
  params: {
    name: "morning-report",
    schedule: "0 9 * * *",      // Cron expression
    timezone: "America/Mexico_City",
    project: "myapp",            // Runner target
    prompt: "Generate a morning status report covering: build status, test results, open PRs",
    delivery: {
      channel: "kapso",
      to: "+52..."
    }
  }
}

// Cuando el cron fires:
// 1. Cron scheduler → runner.resume({ prompt })
// 2. Runner ejecuta, responde
// 3. Respuesta → delivery via canal
```

**Tipos de cron**:

| Tipo         | Sesion                        | Contexto             | Ejemplo         |
| ------------ | ----------------------------- | -------------------- | --------------- |
| Main session | Reutiliza sesion del proyecto | Completo (historial) | Health check    |
| Isolated     | Nueva sesion temporal         | Limpio               | Reporte semanal |
| System event | Inyecta evento en heartbeat   | Heartbeat decide     | Reminder        |

### 3.6 Sub-Agents (Inter-Runner Communication)

Permitir que un runner spawne o consulte a otros runners:

```typescript
// MCP action: spawn_agent — crea un nuevo runner y retorna resultado
{
  action: "spawn_agent",
  params: {
    project: "docs",
    llm: "gemini",             // Gemini tiene 1M context, ideal para docs
    prompt: "Review the API documentation for breaking changes in v2.0",
    waitForResult: true,       // Bloquear hasta que termine
    timeoutMs: 120_000         // 2 min max
  }
}
// → Retorna: { result: "Found 3 breaking changes: ...", tokens: 15000, durationMs: 45000 }

// MCP action: ask_agent — envia pregunta a runner existente
{
  action: "ask_agent",
  params: {
    project: "api",            // Runner ya corriendo
    question: "Is the /users endpoint stable? Any recent failures?",
    waitForResult: true,
    timeoutMs: 60_000
  }
}
// → Retorna: { answer: "Yes, /users is stable. Last 24h: 0 failures, avg response 120ms" }
```

**Restricciones de seguridad**:

- Max spawn depth: 2 (un runner puede spawnar un sub-runner, pero no mas)
- Max concurrent sub-runners: 3
- Timeout obligatorio (default: 2 min)
- Sub-runners NO heredan MCP tools del padre (evita recursion infinita)

**Modelo de comunicacion**:

```
Runner A (myapp/claude)                    Runner B (api/codex)
     │                                           │
     │  ask_agent("api", "status?")              │
     │ ─────────────────────────────────────────> │
     │                                           │ runner.resume({prompt: "status?"})
     │                                           │ ...procesando...
     │                                           │
     │           { answer: "all good" }          │
     │ <───────────────────────────────────────── │
     │                                           │
     │  (continua con la info recibida)          │
```

### 3.7 Runner Registry y Configuracion

```typescript
// src/runners/runner-registry.ts

type RunnerFactory = (options: { contextLimit?: number }) => LLMRunner;

const BUILTIN_RUNNERS: Record<string, RunnerFactory> = {
  claude: (opts) => new ClaudeRunner(opts),
  codex: (opts) => new CodexRunner(opts),
  gemini: (opts) => new GeminiRunner(opts),
};

class RunnerRegistry {
  private runners = new Map<string, RunnerFactory>();

  register(name: string, factory: RunnerFactory): void;
  create(name: string, options?: { contextLimit?: number }): LLMRunner;
  list(): string[];
  has(name: string): boolean;
}
```

**Config** (`~/.jorchbot/config.json`):

```json
{
  "runners": {
    "default": "claude",
    "claude": {
      "enabled": true,
      "contextLimit": 200000,
      "binary": "claude"
    },
    "codex": {
      "enabled": true,
      "contextLimit": 128000,
      "binary": "codex"
    },
    "gemini": {
      "enabled": false,
      "contextLimit": 1000000,
      "binary": "gemini",
      "env": {
        "GOOGLE_API_KEY": "..."
      }
    }
  }
}
```

**Jorchfile**:

```
PROJECT myapp
  path = ~/projects/myapp
  llm = claude
  memory = on
  heartbeat = 30m

PROJECT api
  path = ~/projects/api
  llm = codex
  memory = on

PROJECT docs
  path = ~/projects/docs
  llm = gemini
  memory = on
```

---

## 4. Detalles de Implementacion por Runner

### 4.1 ClaudeRunner (existente, adaptar)

**CLI**: `claude -p "prompt" --output-format stream-json`

**MCP config**: Claude Code soporta `--mcp-config <path>` o `~/.claude.json`:

```json
{
  "mcpServers": {
    "jorchbot": {
      "command": "node",
      "args": ["/path/to/jorchbot-mcp-server.js"],
      "env": {
        "JORCHBOT_SESSION_ID": "...",
        "JORCHBOT_GATEWAY_PORT": "18789"
      }
    }
  }
}
```

**Tool Search built-in**: Claude Code activa automaticamente Tool Search cuando
MCP tools superan 10% del context. No requiere configuracion.

**Cambios necesarios**:

1. Pasar `--mcp-config` al spawn (nuevo flag en ClaudeRunner)
2. Generar `.claude.json` temporal por sesion con config del MCP server
3. Almacenar transcripts como JSONL para indexacion de memoria

**Constraint conocido**: El Agent SDK tiene ~12s de overhead por invocacion.
Usar `--resume` mitiga esto para sesiones multi-turn.

### 4.2 CodexRunner (nuevo)

**CLI**: `codex exec --json "prompt"`

**Output**: JSONL (diferente al NDJSON de Claude)

**MCP config**: `codex mcp add jorchbot -- node /path/to/mcp-server.js`

O en `~/.codex/config.toml`:

```toml
[mcp.jorchbot]
command = "node"
args = ["/path/to/jorchbot-mcp-server.js"]
```

**Sesiones**: Thread-based (`--session-id <id>`)

**Diferencias clave vs Claude**:

- Output JSONL en vez de NDJSON
- Thread ID en vez de session ID
- Auth via OAuth (necesita workaround para headless servers sin browser)
- No tiene `--dangerously-skip-permissions` equivalente

**Parsing**: Crear `CodexOutputParser` que mapea JSONL → LLMRunnerEvents.

### 4.3 GeminiRunner (nuevo)

**CLI**: `gemini "prompt"` (flag exacto depende de la version)

**Output**: Text/JSON configurable

**MCP config**: `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "jorchbot": {
      "command": "node",
      "args": ["/path/to/jorchbot-mcp-server.js"]
    }
  }
}
```

**Sesiones**: Conversation-based (persiste en disco)

**Diferencias clave**:

- Auth simple: `GOOGLE_API_KEY` env var (sin browser required)
- Context window masivo: 1M tokens (ideal para docs/analisis)
- CLI menos madura que Claude Code y Codex
- Output format menos estable (puede cambiar entre versiones)

**Caso de uso ideal**: Proyectos de documentacion, analisis de codigo grande,
tareas que necesitan mucho contexto.

---

## 5. MCP Server: Implementacion Detallada

### 5.1 Dependencias

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.0"
  }
}
```

**Nota Zod 4**: El SDK re-exporta Zod desde `@modelcontextprotocol/sdk/zod`.
Usar este re-export para las tool definitions del MCP para evitar conflictos
con Zod 4.x de JorchBot.

### 5.2 Arquitectura del Server

```
src/mcp/
  ├── server.ts              # McpServer setup + tool registration
  ├── orchestrator.ts        # Request router + action handlers
  ├── actions/
  │   ├── memory.ts          # memory_search, memory_get
  │   ├── messaging.ts       # send_message
  │   ├── agents.ts          # spawn_agent, ask_agent
  │   ├── cron.ts            # cron_add, cron_list, cron_remove
  │   └── status.ts          # session_list, session_status, heartbeat_status
  ├── mcp-config-generator.ts # Genera .claude.json / config.toml por sesion
  └── types.ts               # Tipos compartidos
```

### 5.3 Token Budget por Interaccion

| Componente                      | Tokens estimados | Notas                                 |
| ------------------------------- | ---------------- | ------------------------------------- |
| Tool definition (1 unified)     | ~200-300         | Schema del `jorchbot_request` tool    |
| Memory search result (5 chunks) | ~1,000-1,500     | ~300 chars × 5 snippets               |
| Message delivery confirmation   | ~50              | "Message sent to +52..."              |
| Session status response         | ~100-200         | JSON con status de sesiones           |
| Cron list response              | ~100-300         | Lista de jobs programados             |
| **Total overhead por request**  | **~200-500**     | Minimal vs 5,000+ con tools separados |

### 5.4 MCP Config Generation

Para cada sesion, JorchBot genera un archivo de configuracion MCP temporal:

```typescript
// src/mcp/mcp-config-generator.ts

function generateMcpConfig(params: {
  project: string;
  sessionId: string;
  gatewayPort: number;
  mcpServerPath: string;
}): string {
  const config = {
    mcpServers: {
      jorchbot: {
        command: process.execPath, // node binary
        args: [params.mcpServerPath],
        env: {
          JORCHBOT_SESSION_ID: params.sessionId,
          JORCHBOT_GATEWAY_PORT: String(params.gatewayPort),
          JORCHBOT_PROJECT: params.project,
        },
      },
    },
  };
  // Write to temp file, return path
  const configPath = path.join(tmpdir(), `jorchbot-mcp-${params.sessionId}.json`);
  writeFileSync(configPath, JSON.stringify(config));
  return configPath;
}
```

---

## 6. Transcript Storage y Memory Indexing

### 6.1 Transcript Writer

Cada sesion de runner debe guardar sus transcripts como JSONL para que el
memory indexer los procese:

```typescript
// src/sessions/jorchbot/transcript-writer.ts

class TranscriptWriter {
  private stream: WriteStream;

  constructor(sessionId: string, project: string) {
    const dir = path.join(homedir(), ".jorchbot", "agents", project, "sessions");
    mkdirSync(dir, { recursive: true });
    const filename = `${new Date().toISOString().split("T")[0]}.jsonl`;
    this.stream = createWriteStream(path.join(dir, filename), { flags: "a" });
  }

  writeUser(text: string): void {
    this.stream.write(
      JSON.stringify({
        type: "message",
        message: { role: "user", content: text },
      }) + "\n",
    );
  }

  writeAssistant(text: string): void {
    this.stream.write(
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: text },
      }) + "\n",
    );
  }

  close(): void {
    this.stream.end();
  }
}
```

### 6.2 Memory Sync Triggers

| Trigger          | Cuando                          | Config                                      |
| ---------------- | ------------------------------- | ------------------------------------------- |
| On session start | Runner se inicia o resume       | `sync.onSessionStart: true`                 |
| Before search    | Antes de cada `memory_search`   | `sync.onSearch: true`                       |
| Delta threshold  | Cada 100KB o 50 mensajes nuevos | `sync.sessions.deltaBytes`, `deltaMessages` |
| File watcher     | Cambio en transcript detectado  | `sync.watch: true`                          |
| Interval         | Cada N minutos                  | `sync.intervalMinutes`                      |

### 6.3 Chunking Strategy

El memory system de OpenClaw ya tiene chunking optimizado:

- **Target**: 400 tokens por chunk
- **Overlap**: 80 tokens (para no perder contexto en los bordes)
- **Estimacion**: UTF-8 bytes / 4 (conservador)
- **Formato**: Cada chunk mantiene `startLine` y `endLine` para citaciones

Para transcripts de sesion, el chunking agrupa mensajes consecutivos
User+Assistant como unidad semantica.

---

## 7. Gestion de Recursos y Escalabilidad

### 7.1 Consumo de Memoria por Runner

| Runner                    | RAM estimada | Notas                  |
| ------------------------- | ------------ | ---------------------- |
| ClaudeRunner (claude CLI) | ~150-300 MB  | Node.js + WASM tooling |
| CodexRunner (codex CLI)   | ~200-400 MB  | Heavier runtime        |
| GeminiRunner (gemini CLI) | ~100-200 MB  | Go-based, mas ligero   |
| MCP Server por sesion     | ~20-50 MB    | Node.js process        |
| Memory indexer            | ~50-100 MB   | sqlite + embeddings    |

**Con 5 sesiones activas**: ~1-2 GB RAM total. Manejable en un servidor moderno.

### 7.2 Process Lifecycle

```
Gateway start
  │
  ├─ Inicializar RunnerRegistry
  ├─ Inicializar MemoryIndexManager (per-project)
  ├─ Inicializar Cron Scheduler
  │
  ▼
Session create (project: "myapp", llm: "claude")
  │
  ├─ Generar MCP config temporal
  ├─ Spawn ClaudeRunner con --mcp-config
  ├─ Spawn MCP Server (stdio, subprocess del runner)
  ├─ Inicializar TranscriptWriter
  ├─ Registrar en MemoryIndexManager
  │
  ▼
Session active
  │
  ├─ Runner emite text/toolUse/result events
  ├─ TranscriptWriter persiste a JSONL
  ├─ MemoryIndexManager sync incremental
  ├─ MCP tools disponibles para el runner
  │
  ▼
Session destroy
  │
  ├─ Stop runner (SIGTERM → SIGKILL)
  ├─ Flush TranscriptWriter
  ├─ Final sync de MemoryIndexManager
  ├─ Cleanup MCP config temporal
  ├─ Cleanup MCP server process
```

### 7.3 Graceful Degradation

| Fallo              | Comportamiento                                 |
| ------------------ | ---------------------------------------------- |
| MCP server crash   | Runner sigue funcionando sin tools JorchBot    |
| Embedding API down | Fallback a FTS5 keyword search (no vector)     |
| Memory DB corrupta | Reconstruir desde transcripts JSONL            |
| Runner crash       | SessionManager detecta, notifica, auto-cleanup |
| Sub-agent timeout  | Retornar error al runner padre, no bloquear    |

---

## 8. Integracion con GUI (Fase 6 extension)

### Nuevas secciones en el dashboard

1. **Memory**: Status de indexacion, buscar en memoria, ver chunks
2. **Agents**: Vista de runners activos con LLM, context %, comunicacion
3. **Cron**: Jobs programados, historial de ejecucion, logs
4. **MCP**: Status del MCP server, tools registrados, metricas de uso

### WebSocket events nuevos

```typescript
// Eventos que el MCP server emite al GUI via WebSocket
"mcp.tool_call"     → { project, action, params, durationMs }
"memory.search"     → { project, query, results: number, durationMs }
"memory.sync"       → { project, chunksIndexed, totalChunks }
"agent.spawn"       → { parent, child, llm, prompt }
"agent.communicate" → { from, to, question, answer }
"cron.fired"        → { jobId, name, project, status }
```

---

## 9. Configuracion Completa

```json
{
  "gateway": { "port": 18789, "host": "127.0.0.1" },

  "runners": {
    "default": "claude",
    "claude": { "enabled": true, "contextLimit": 200000 },
    "codex": { "enabled": true, "contextLimit": 128000 },
    "gemini": { "enabled": false, "contextLimit": 1000000 }
  },

  "memory": {
    "enabled": true,
    "provider": "local",
    "model": "embeddinggemma-300m-qat-Q8_0",
    "chunking": { "tokens": 400, "overlap": 80 },
    "query": {
      "maxResults": 5,
      "minScore": 0.35,
      "hybrid": { "vectorWeight": 0.7, "textWeight": 0.3 }
    },
    "sync": {
      "onSessionStart": true,
      "onSearch": true,
      "sessions": { "deltaBytes": 100000, "deltaMessages": 50 }
    }
  },

  "mcp": {
    "enabled": true,
    "strategy": "unified",
    "tools": ["memory", "messaging", "agents", "cron", "status"]
  },

  "cron": {
    "enabled": false,
    "maxJobs": 20,
    "timezone": "America/Mexico_City"
  },

  "agents": {
    "maxSubAgents": 3,
    "maxSpawnDepth": 2,
    "defaultTimeout": 120000,
    "communication": true
  }
}
```

---

## 10. Fases de Implementacion

| Sub-fase | Nombre                         | Entregable                                     | Esfuerzo |
| -------- | ------------------------------ | ---------------------------------------------- | -------- |
| **11A**  | LLMRunner Interface            | Interfaz abstracta + refactor ClaudeRunner     | 2-3 dias |
| **11B**  | Runner Registry                | Registro de backends + config schema           | 1-2 dias |
| **11C**  | JorchBot MCP Server (skeleton) | MCP server basico con 1 tool unified           | 3-4 dias |
| **11D**  | Memory Integration             | Transcript writer + indexer + MCP memory tools | 4-5 dias |
| **11E**  | Messaging via MCP              | send_message tool + channel delivery           | 1-2 dias |
| **11F**  | CodexRunner                    | Nuevo runner para Codex CLI                    | 3-4 dias |
| **11G**  | GeminiRunner                   | Nuevo runner para Gemini CLI                   | 3-4 dias |
| **11H**  | Cron via MCP                   | Cron scheduler + MCP cron tools                | 3-4 dias |
| **11I**  | Sub-Agents                     | spawn_agent + ask_agent + safety rails         | 4-5 dias |
| **11J**  | GUI Extension                  | Memory, agents, cron, MCP panels               | 3-4 dias |
| **11K**  | Polish + Tests                 | Integration tests, edge cases, docs            | 3-4 dias |

**Total estimado: 30-40 dias de desarrollo.**

**Orden recomendado**: 11A → 11B → 11C → 11D → 11E → 11F/11G (paralelo) → 11H → 11I → 11J → 11K

---

## 11. Riesgos y Mitigaciones

| Riesgo                         | Probabilidad | Impacto | Mitigacion                                           |
| ------------------------------ | ------------ | ------- | ---------------------------------------------------- |
| MCP SDK incompatible con Zod 4 | Alta         | Medio   | Usar re-export de Zod del SDK o schemas JSON raw     |
| Claude Code 12s spawn overhead | Confirmado   | Medio   | Reusar sesiones con `--resume`, no spawns frecuentes |
| Codex CLI output format cambia | Media        | Alto    | Parsers versionados, tests de compatibilidad         |
| Gemini CLI inestable           | Media        | Medio   | Feature flag para habilitar/deshabilitar             |
| Memory indexing lento          | Baja         | Bajo    | Embeddings locales, delta indexing, background sync  |
| Token overhead de MCP tools    | Alta         | Alto    | Orchestrator-delegate pattern (1 tool, ~200 tokens)  |
| Sub-agent recursion infinita   | Baja         | Alto    | Max depth 2, timeout obligatorio, no herencia MCP    |
| Concurrent runners OOM         | Media        | Alto    | Limits configurable, monitoring de memoria           |

---

## 12. NO se construye en esta fase

- **Runner Transcripts UI** → movido a [Fase 12](./phase-12-orchestrator-ux.md)
- **Model routing inteligente** → movido a [Fase 12](./phase-12-orchestrator-ux.md)
- **Streaming cross-runner** → movido a [Fase 12](./phase-12-orchestrator-ux.md)
- **Marketplace de MCP tools** → movido a [Fase 12](./phase-12-orchestrator-ux.md)
- **Federation entre JorchBots** → movido a [Fase 12](./phase-12-orchestrator-ux.md)
- **Fine-tuning de modelos** (fuera de scope permanentemente — JorchBot orquesta CLIs, no entrena modelos)

---

## 13. Definicion de "Terminado"

- [ ] LLMRunner interface definida y ClaudeRunner refactorizado
- [ ] RunnerRegistry funcional con al menos Claude + 1 runner adicional
- [ ] JorchBot MCP Server corriendo con tools unified
- [ ] Memory vectorial indexando transcripts y retornando resultados relevantes
- [ ] send_message via MCP funcional (Kapso + Telegram)
- [ ] Cron scheduler registrando y ejecutando jobs
- [ ] Sub-agents: spawn_agent y ask_agent funcionales con safety rails
- [ ] GUI: secciones de memory, agents, cron
- [ ] Token overhead de MCP < 500 tokens por sesion
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Referencias

### Documentacion

- [MCP Specification](https://modelcontextprotocol.io)
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [Codex CLI MCP Docs](https://developers.openai.com/codex/mcp)
- [Gemini CLI MCP Docs](https://geminicli.com/docs/tools/mcp-server/)
- [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)

### Research

- [MCP Tool Schema Bloat: Hidden Token Tax](https://layered.dev/mcp-tool-schema-bloat-the-hidden-token-tax-and-how-to-fix-it/)
- [Speakeasy: 100x Token Reduction](https://www.speakeasy.com/blog/how-we-reduced-token-usage-by-100x-dynamic-toolsets-v2)
- [Redis: Solving MCP Tool Overload](https://redis.io/blog/from-reasoning-to-retrieval-solving-the-mcp-tool-overload-problem/)
- [Anthropic: Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [10 Strategies to Reduce MCP Token Bloat](https://thenewstack.io/how-to-reduce-mcp-token-bloat/)
- [mcp-agent: Orchestrator Pattern](https://github.com/lastmile-ai/mcp-agent)

### Multi-Agent Patterns

- [CrewAI](https://docs.crewai.com)
- [LangGraph](https://www.langchain.com/langgraph)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [IBM MCP Architecture Patterns](https://developer.ibm.com/articles/mcp-architecture-patterns-ai-systems/)
