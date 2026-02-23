# Fase 10 - AgentRunner Abstraction

> **Estado**: Pendiente
> **Dependencia**: Fase 2 (ClaudeRunner existente), Fase 8 (Security + encrypted API keys)
> **Entregable**: Interfaz AgentRunner abstracta, tool approval abstraction, refactor de ClaudeRunner, CodexRunner, GeminiRunner, RunnerRegistry, output normalization, runner lifecycle management
> **Al terminar**: SessionManager acepta cualquier runner via interfaz abstracta. ClaudeRunner refactorizado. Al menos un runner adicional (Codex o Gemini) funcional con tool approval unificado.

---

## Nota Arquitectural

> Esta fase es el **puente** entre:
>
> - **Fase 8** (security + multi-LLM basico): define _que_ runners soportar y
>   la seguridad subyacente (API keys encriptadas, audit logging).
> - **Fase 11** (headless orchestrator): asume que los runners ya tienen una
>   interfaz abstracta y se enfoca en MCP server, memoria vectorial, cron,
>   sub-agentes.
>
> Fase 10 resuelve el **como**: la arquitectura interna de runners, el
> desacoplamiento de tool approval, la normalizacion de output, y la
> evolucion del SessionManager.
>
> **Documento de referencia**: `docs/future_agent_runner.md` contiene el
> diseno original de la interfaz AgentRunner. Esta fase lo implementa.

---

## Objetivo

Extraer una interfaz abstracta `AgentRunner` de `ClaudeRunner`, implementar
el patron de tool approval desacoplado, y hacer que SessionManager trabaje
con cualquier runner via interfaz — sin conocer los detalles internos de
cada CLI.

---

## Entregables

1. Interfaz `AgentRunner` (EventEmitter-based)
2. Tool Approval Abstraction (eventos + resolveToolApproval)
3. Refactor de `ClaudeRunner` para implementar `AgentRunner`
4. `CodexRunner` implementando `AgentRunner`
5. `GeminiRunner` implementando `AgentRunner`
6. `RunnerRegistry` (factory + discovery)
7. Output normalization pipeline
8. Runner lifecycle management (health, restart, cleanup)
9. SessionManager evolution (factory pattern)
10. Integracion con OpenClaw agents (transcripts JSONL, IDENTITY.md, Skills)

---

## Tareas

### 10.1 Interfaz AgentRunner

Extraer la interfaz abstracta que todos los runners implementan. Basada en
EventEmitter para desacoplar concerns.

```typescript
// src/sessions/jorchbot/agent-runner.ts

export interface AgentRunnerEvents {
  /** Texto parcial (streaming) */
  text: [text: string];

  /** Tool invocado (informativo, ya ejecutado o en ejecucion) */
  toolUse: [request: { toolName: string; toolInput: Record<string, unknown> }];

  /** Tool necesita aprobacion antes de ejecutar */
  toolApproval: [request: ToolApprovalRequest];

  /** Tool termino (exito o fallo) */
  toolResult: [result: ToolResultNotification];

  /** Ejecucion completa */
  result: [result: RunnerResult];

  /** Error fatal */
  error: [error: Error];
}

export interface AgentRunner extends EventEmitter<AgentRunnerEvents> {
  /** Identificador del tipo de runner ("claude", "codex", "gemini") */
  readonly type: string;

  /** Nombre para mostrar ("Claude Code", "OpenAI Codex", "Gemini CLI") */
  readonly displayName: string;

  /** Soporta tool approval? Si false, nunca emite toolApproval */
  readonly supportsToolApproval: boolean;

  /** Iniciar nueva sesion */
  start(options: StartOptions): Promise<RunnerResult>;

  /** Resumir sesion existente */
  resume(options: ResumeOptions): Promise<RunnerResult>;

  /** Detener runner */
  stop(): Promise<void>;

  /** Session ID actual (null si no iniciado) */
  getSessionId(): string | null;

  /** Estado del runner */
  getStatus(): RunnerStatus;

  /** Porcentaje de context window usado (0-100) */
  getContextPercent(): number;

  /**
   * Resolver una aprobacion pendiente.
   * Solo implementado si supportsToolApproval = true.
   * Cada runner traduce esto a su mecanismo nativo.
   */
  resolveToolApproval?(
    approvalId: string,
    decision: { approved: boolean; reason?: string },
  ): Promise<void>;
}

export type RunnerStatus = "idle" | "running" | "stopped" | "error";
```

**Tipos de soporte**:

```typescript
export interface StartOptions {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
  timeoutMs?: number;
  skipPermissions?: boolean;
  mcpConfig?: string; // Path a MCP config (Fase 11)
  env?: Record<string, string>; // Env vars adicionales
}

export interface ResumeOptions {
  prompt: string;
  cwd?: string;
}

export interface RunnerResult {
  sessionId: string;
  textContent: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface ToolApprovalRequest {
  approvalId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ToolResultNotification {
  toolName: string;
  toolInput: Record<string, unknown>;
  success: boolean;
  summary: string;
}
```

- [ ] Definir interfaz `AgentRunner` en `src/sessions/jorchbot/agent-runner.ts`
- [ ] Definir tipos de soporte (`StartOptions`, `ResumeOptions`, `RunnerResult`, etc.)
- [ ] Definir `AgentRunnerEvents` con los 6 eventos
- [ ] Exportar todo desde `src/sessions/jorchbot/index.ts`

**Criterio de aceptacion**: Interfaz compilable, importable, sin implementacion concreta.

### 10.2 Tool Approval Abstraction

El problema central: cada CLI tiene un **mecanismo diferente** para tool approval,
pero el flujo del usuario es siempre el mismo (boton WP → Approve/Reject → runner
recibe decision).

**Separacion de concerns**:

```
RUNNER-SPECIFIC (varia por implementacion):
  Como intercepta tool calls el runner?
  Como recibe decisiones approve/deny?

JORCHBOT-SPECIFIC (igual para todos los runners):
  Enviar botones WP con info del tool
  Esperar que el user toque
  Rutear decision a la sesion correcta
```

**Mecanismos por runner**:

| Runner          | Mecanismo           | Detalle                                                          |
| --------------- | ------------------- | ---------------------------------------------------------------- |
| **Claude Code** | PreToolUse hooks    | Hook script → HTTP POST a gateway → poll → exit con allow/deny   |
| **Codex CLI**   | stdin pipe          | Parsear stdout para approval requests, escribir decision a stdin |
| **Gemini CLI**  | TBD (hooks o stdin) | Depende del estado del CLI al momento de implementar             |

**Flujo Claude Code (hook-based)**:

```
ClaudeRunner subprocess runs
  → Claude Code invoca PreToolUse hook script
    → Hook script POST a gateway /api/tool-approval
      → Gateway crea approval pendiente, envia botones WP
      → Hook script poll GET /api/tool-approval/:id
        → User toca [Approve] en WP
          → Gateway resuelve approval
            → Hook script recibe "approved", exit con allow JSON
              → Claude Code procede
```

**Flujo futuro runner (stdin-based)**:

```
FutureRunner subprocess runs
  → Runner output "tool_approval_needed" a stdout
    → FutureRunner parsea, emite `toolApproval` event
      → ApprovalManager envia botones WP
        → User toca [Approve]
          → SessionManager llama runner.resolveToolApproval(id, { approved: true })
            → FutureRunner escribe "approved" a subprocess stdin
              → Runner procede
```

**Runners sin tool approval**: Algunos runners no soportan approval (modo
full-auto, script executor). El flag `supportsToolApproval` maneja esto:

```typescript
if (runner.supportsToolApproval) {
  runner.on("toolApproval", (request) => {
    // Enviar botones WP, esperar respuesta
  });
} else {
  // Auto-approve, solo loggear tool use
}
```

- [ ] Implementar evento `toolApproval` en `AgentRunnerEvents`
- [ ] Implementar evento `toolResult` en `AgentRunnerEvents`
- [ ] Definir `ToolApprovalRequest` y `ToolResultNotification`
- [ ] Definir metodo `resolveToolApproval()` como opcional
- [ ] Definir flag `supportsToolApproval` como readonly
- [ ] Refactorizar `ApprovalManager` para usar eventos en vez de HTTP endpoints directos
- [ ] Los HTTP endpoints de approval quedan como detalle interno de `ClaudeRunner`

**Criterio de aceptacion**: ApprovalManager habla solo con la interfaz abstracta. Hook scripts quedan encapsulados dentro de ClaudeRunner.

### 10.3 Refactor de ClaudeRunner

Adaptar el `ClaudeRunner` existente (Fase 2) para implementar `AgentRunner`.

**Cambios requeridos**:

1. Extender `EventEmitter<AgentRunnerEvents>` en vez de EventEmitter generico
2. Implementar todos los metodos de `AgentRunner`
3. Encapsular hooks de approval como detalle interno
4. Emitir `toolApproval` cuando el hook HTTP handler reciba un request
5. Emitir `toolResult` cuando PostToolUse/PostToolUseFailure fires
6. Normalizar output a formato `RunnerResult`

**Detalles especificos de Claude Code que quedan internos**:

- `claude -p --output-format stream-json`
- `--resume <session_id>` para multi-turn
- `--dangerously-skip-permissions` para headless
- PreToolUse/PostToolUse hooks
- Hook scripts en `src/hooks/tool-approval.ts`
- HTTP endpoints `/api/tool-approval` y `/api/tool-result`
- `.claude/settings.local.json` por workspace

- [ ] Refactorizar `ClaudeRunner` para implementar `AgentRunner`
- [ ] Mover hooks como detalle de implementacion interno
- [ ] Emitir eventos normalizados (`text`, `toolUse`, `toolApproval`, `toolResult`, `result`, `error`)
- [ ] Mantener backward compatibility (no romper Fase 2)
- [ ] Tests: verificar que todos los eventos se emiten correctamente

**Criterio de aceptacion**: `ClaudeRunner` pasa type-check como `AgentRunner`. Tests existentes siguen pasando.

### 10.4 CodexRunner

Runner para OpenAI Codex CLI.

**Detalles de integracion**:

- **Auth**: `OPENAI_API_KEY` env var (almacenada encriptada, Fase 8)
- **CLI**: `codex exec --json "prompt"`
- **Output**: JSONL (diferente al NDJSON de Claude)
- **Sesiones**: Thread-based (`--session-id <id>`)
- **Tool approval**: stdin pipe (parsear stdout, escribir a stdin)
- **MCP**: `codex mcp add` o `~/.codex/config.toml`

**Diferencias clave vs Claude**:

- Output JSONL en vez de NDJSON
- Thread ID en vez de session ID
- Auth via API key (no host subscription)
- No tiene `--dangerously-skip-permissions` equivalente
- Approval via stdin, no hooks

```typescript
// src/sessions/jorchbot/codex-runner.ts

class CodexRunner extends EventEmitter<AgentRunnerEvents> implements AgentRunner {
  readonly type = "codex";
  readonly displayName = "OpenAI Codex";
  readonly supportsToolApproval = true;

  // ...parse JSONL → AgentRunnerEvents
  // ...resolveToolApproval → write to stdin
}
```

- [ ] Investigar Codex CLI: flags exactos, output format, session management
- [ ] Implementar `CodexRunner` que implementa `AgentRunner`
- [ ] Implementar `CodexOutputParser`: JSONL → `AgentRunnerEvents`
- [ ] Implementar tool approval via stdin pipe
- [ ] Requiere API key de OpenAI (encriptada, Fase 8)
- [ ] Tests con mocks de Codex CLI output

**Criterio de aceptacion**: `CodexRunner` implementa `AgentRunner`. Output normalizado identico a `ClaudeRunner`.

### 10.5 GeminiRunner

Runner para Google Gemini CLI.

**Detalles de integracion**:

- **Auth**: `GOOGLE_API_KEY` env var (simple, sin browser required)
- **CLI**: `gemini "prompt"` (flag exacto depende de la version)
- **Output**: Text/JSON configurable
- **Sesiones**: Conversation-based (persiste en disco)
- **Context window**: 1M tokens (ideal para docs/analisis)
- **MCP**: `~/.gemini/settings.json`

**Diferencias clave**:

- Auth simple (env var)
- CLI menos madura que Claude Code y Codex
- Output format menos estable (puede cambiar entre versiones)
- Context window masivo
- Tool approval: TBD (hooks, stdin, o API callback)

- [ ] Investigar Gemini CLI: flags, output format, session management, tool approval
- [ ] Implementar `GeminiRunner` que implementa `AgentRunner`
- [ ] Implementar output parser: Gemini format → `AgentRunnerEvents`
- [ ] Implementar tool approval (mecanismo depende del CLI)
- [ ] Requiere API key de Google (encriptada, Fase 8)
- [ ] Feature flag para habilitar/deshabilitar (CLI puede ser inestable)

**Criterio de aceptacion**: `GeminiRunner` implementa `AgentRunner`. Funcional al menos en modo basico (start/resume/stop).

### 10.6 RunnerRegistry

Registro central de runners disponibles con factory pattern.

```typescript
// src/sessions/jorchbot/runner-registry.ts

type RunnerFactory = (config: RunnerConfig) => AgentRunner;

interface RunnerConfig {
  contextLimit?: number;
  env?: Record<string, string>;
  binary?: string;
}

class RunnerRegistry {
  private factories = new Map<string, RunnerFactory>();

  register(name: string, factory: RunnerFactory): void;
  create(name: string, config?: RunnerConfig): AgentRunner;
  list(): string[];
  has(name: string): boolean;
  getDefault(): string;
}

// Uso
const registry = new RunnerRegistry();
registry.register("claude", (cfg) => new ClaudeRunner(cfg));
registry.register("codex", (cfg) => new CodexRunner(cfg));
registry.register("gemini", (cfg) => new GeminiRunner(cfg));
```

**Configuracion** (en `jorchbot.json` bajo `jorchbot`):

```json
{
  "jorchbot": {
    "runners": {
      "default": "claude",
      "claude": { "enabled": true, "contextLimit": 200000 },
      "codex": { "enabled": true, "contextLimit": 128000 },
      "gemini": { "enabled": false, "contextLimit": 1000000 }
    }
  }
}
```

- [ ] Implementar `RunnerRegistry` con factory pattern
- [ ] Registrar runners built-in (claude, codex, gemini)
- [ ] Agregar schema de config `runners` al `JorchBotConfigSchema` (Zod)
- [ ] Discovery: verificar que el binario del CLI existe en PATH antes de habilitar
- [ ] Default runner configurable

**Criterio de aceptacion**: `RunnerRegistry.create("codex")` retorna un `CodexRunner` funcional. Runners no disponibles lanzan error claro.

### 10.7 Output Normalization Pipeline

Cada runner produce output en formato distinto. El pipeline normaliza todo a
`AgentRunnerEvents` antes de que llegue a SessionManager.

| Runner      | Raw output         | Normalizado                        |
| ----------- | ------------------ | ---------------------------------- |
| Claude Code | NDJSON stream-json | `text`, `toolUse`, `result` events |
| Codex       | JSONL              | `text`, `toolUse`, `result` events |
| Gemini      | Text/JSON variable | `text`, `toolUse`, `result` events |

**Arquitectura**:

```
Runner subprocess stdout
  │
  ▼
OutputParser (per-runner)
  │  ClaudeOutputParser → parsea NDJSON
  │  CodexOutputParser → parsea JSONL
  │  GeminiOutputParser → parsea Text/JSON
  │
  ▼
AgentRunnerEvents (normalizados)
  │
  ▼
SessionManager (runner-agnostic)
```

- [ ] Definir interfaz `OutputParser`
- [ ] Extraer `ClaudeOutputParser` del ClaudeRunner actual
- [ ] Implementar `CodexOutputParser`
- [ ] Implementar `GeminiOutputParser`
- [ ] Mapear campos: session ID, token counts, cost, duration

**Criterio de aceptacion**: Dado el mismo prompt, los 3 runners emiten eventos con la misma estructura `RunnerResult`.

### 10.8 Runner Lifecycle Management

Gestionar salud, restart, y cleanup de runners.

**Health checks**:

```typescript
interface RunnerHealth {
  status: RunnerStatus;
  pid: number | null;
  uptime: number; // ms desde start
  lastActivity: number; // ms desde ultimo evento
  contextPercent: number;
  memoryMb: number; // RSS del proceso
}
```

**Flujos de lifecycle**:

| Evento                                | Accion                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| Runner crash (exit code != 0)         | Notificar user, cleanup, marcar sesion `error`          |
| Runner hang (sin actividad > timeout) | SIGTERM → esperar 5s → SIGKILL                          |
| Runner context overflow               | Notificar user, ofrecer `/compact` o `/new`             |
| Gateway shutdown                      | SIGTERM a todos los runners, flush transcripts, cleanup |
| Runner binary no encontrado           | Error claro: "codex not found in PATH"                  |

- [ ] Implementar health monitoring por runner (pid, uptime, lastActivity, memoryMb)
- [ ] Detectar crash de runner (exit event del child_process)
- [ ] Implementar graceful shutdown (SIGTERM → wait → SIGKILL)
- [ ] Cleanup de archivos temporales (MCP configs, etc.)
- [ ] Notificar al user via canal de messaging cuando un runner falla

**Criterio de aceptacion**: Si un runner crashea, la sesion se marca `error` y el user recibe notificacion. Gateway shutdown mata todos los runners limpiamente.

### 10.9 SessionManager Evolution

Evolucionar SessionManager de trabajar con `ClaudeRunner` directamente a usar
`AgentRunner` via `RunnerRegistry`.

```
Fase 2 (actual):
  SessionManager → ClaudeRunner (directo)

Fase 10 (despues):
  SessionManager → RunnerRegistry → AgentRunner (interfaz)
                                      ├── ClaudeRunner
                                      ├── CodexRunner
                                      └── GeminiRunner
```

**El factory pattern ya existe** en SessionManager's deps:

```typescript
// Fase 2 (actual)
createRunner: () => new ClaudeRunner();

// Fase 10 (despues)
createRunner: (type: string, config?: RunnerConfig) => registry.create(type, config);
```

**Seleccion de runner**:

1. Jorchfile: campo `llm` por PROJECT (Fase 3 extension)
2. Override: `/new frontend --llm codex`
3. Default: `runners.default` en config
4. Fallback: `"claude"`

```makefile
PROJECT frontend
  path = ~/projects/my-app/frontend
  llm = claude
  instructions = Experto en React

PROJECT backend
  path = ~/projects/my-app/backend
  llm = codex
  instructions = Python backend
```

- [ ] Refactorizar SessionManager para aceptar `AgentRunner` en vez de `ClaudeRunner`
- [ ] Inyectar `RunnerRegistry` como dependencia
- [ ] Agregar campo `llm` al Jorchfile parser (Fase 3 extension)
- [ ] `/new frontend --llm codex` override del Jorchfile
- [ ] `/list` muestra que LLM usa cada sesion
- [ ] Default global configurable en jorchbot.json: `"runners.default": "claude"`

**Criterio de aceptacion**: `/new frontend` usa el LLM del Jorchfile. `/new frontend --llm codex` override. Diferentes sesiones con diferentes runners.

### 10.10 Integracion con OpenClaw Agents

Conectar los runners abstractos con el sistema de agentes de OpenClaw (Layer 1).

**Transcripts JSONL**:

Cada sesion guarda transcripts en formato OpenClaw para compatibilidad con
memory system, Control UI, y `sessions.compact`:

```
~/.jorchbot/agents/{project}/sessions/{sessionKey}.jsonl
```

El `TranscriptWriter` se conecta a los eventos del `AgentRunner`:

```typescript
runner.on("text", (text) => transcriptWriter.writeAssistant(text));
runner.on("result", (result) => transcriptWriter.writeResult(result));
// User messages se escriben desde SessionManager antes de enviar al runner
```

**IDENTITY.md**: Ya implementado en Sub-fase 2J. Se extiende para incluir
el tipo de runner:

```markdown
# frontend

Project: frontend
Path: ~/projects/my-app/frontend
Runner: codex (CodexRunner) ← nuevo
Created: 2026-02-19
```

**Skills**: El campo `instructions` del Jorchfile genera SKILL.md (Fase 3).
Cada runner recibe las instrucciones via su mecanismo nativo:

| Runner      | Como recibe instructions                |
| ----------- | --------------------------------------- |
| Claude Code | `--append-system-prompt`                |
| Codex       | `--instructions "..."` o sistema nativo |
| Gemini      | System prompt via CLI flag              |

- [ ] Implementar `TranscriptWriter` conectado a eventos de `AgentRunner`
- [ ] Extender IDENTITY.md para incluir tipo de runner
- [ ] Mapear instructions a cada runner (flag especifico del CLI)
- [ ] Verificar compatibilidad con `sessions.compact` RPC de OpenClaw

**Criterio de aceptacion**: Transcripts de cualquier runner se guardan como JSONL compatible con OpenClaw.

---

## NO se construye en esta fase

- **MCP server para runners** → Fase 11 (Headless Orchestrator)
- **Memoria vectorial** → Fase 11
- **Cron scheduler** → Fase 11
- **Sub-agentes / inter-runner communication** → Fase 11
- **Model routing inteligente** (auto-seleccionar LLM) → futuro
- **GUI: pagina de API keys** → Fase 8 (Security GUI)
- **GUI: pagina de runner status** → Fase 11 (Orchestrator GUI)
- **Runner plugins** (cargar runners de npm) → futuro

---

## Definicion de "Terminado"

- [ ] Interfaz `AgentRunner` definida y compilable
- [ ] `ClaudeRunner` refactorizado para implementar `AgentRunner`
- [ ] Al menos un runner adicional funcional (Codex o Gemini)
- [ ] Tool approval desacoplado: ApprovalManager habla solo con interfaz abstracta
- [ ] `RunnerRegistry` funcional con factory pattern
- [ ] Output normalizado: misma estructura de eventos para todos los runners
- [ ] Runner lifecycle: health monitoring, crash detection, graceful shutdown
- [ ] SessionManager acepta `AgentRunner` via registry
- [ ] Seleccion de LLM por proyecto en Jorchfile
- [ ] Transcripts JSONL compatibles con OpenClaw
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- Cada runner es un `child_process` independiente. No comparten estado.
- El flag `supportsToolApproval` evita que SessionManager asuma un mecanismo de approval.
- Los hook scripts de Claude Code quedan como detalle interno. Nuevos runners usan stdin o su mecanismo nativo.
- Codex y Gemini CLIs pueden cambiar entre versiones. Los OutputParsers deben ser versionados.
- `RunnerRegistry` no es un plugin system — solo registra factories built-in. Runner plugins son futuro.
- OpenClaw ya tiene write locking (`acquireSessionWriteLock`). Reusar para coordinacion de runners concurrentes.
- La master key de Fase 8 protege las API keys de Codex y Gemini. Sin Fase 8, solo ClaudeRunner funciona (usa host subscription).
