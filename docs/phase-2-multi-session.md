# Fase 2 - Workspaces Multi-Sesion

> **Estado**: Pendiente
> **Dependencia**: Fase 1
> **Entregable**: Multiples sesiones de Claude Code + shell directo + focus model
> **Al terminar**: Puedes tener frontend y backend como sesiones separadas, cambiar entre ellas, y ejecutar comandos shell

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> **Arquitectura de dos capas**: OpenClaw ya tiene sistema multi-agente nativo
> con RPC completo (`agents.list`, `agents.create`, `agents.update`, `agents.delete`).
> Cada agente tiene workspace directory, tools, skills, y almacenamiento de sesion
> en `~/.openclaw/agents/{agentId}/sessions/{sessionKey}.jsonl`.
>
> - **Capa 1 (reusar de OpenClaw)**: Gestion de agentes, almacenamiento de sesion,
>   WebSocket control plane, auto-compaction (`sessions.compact`), herencia de
>   tool policies, memory system (SQLite + sqlite-vec).
> - **Capa 2 (construir nuevo)**: ClaudeRunner como child process, Focus Model
>   (cual sesion esta "enfocada" en el chat single-threaded de WP), ShellRunner
>   para `$` commands, context % tracking.
>
> **SessionManager** debe ser un wrapper sobre los agentes de OpenClaw, no una
> reimplementacion. El Focus Model es 100% JorchBot — OpenClaw no tiene concepto
> de "sesion enfocada" porque cada canal tiene su propia conversacion.
>
> **Auto-Compaction**: OpenClaw maneja overflow de contexto automaticamente via
> `sessions.compact` RPC. No necesitamos reimplementar esto.

## Objetivo

Convertir la sesion unica de fase 1 en un sistema multi-sesion donde cada sesion
es un **workspace completo** (Claude Code + Shell) con un modelo de enfoque
que maneja la comunicacion por el canal single-threaded de WhatsApp.

---

## Entregables

1. Session Manager (wrapper sobre multi-agente nativo de OpenClaw)
2. Focus Model (sesion activa vs background — nuevo, OpenClaw no lo tiene)
3. Shell Runner (via `exec` tool de OpenClaw + deteccion de comandos peligrosos)
4. Shortcuts de shell (`/ls`, `/cat`, `/grep`, `/pwd`, `/git`, `/tree`)
5. Logs por sesion (almacenamiento y consulta)
6. Notificaciones de background (aprobaciones, errores, completados)

---

## Tareas

### 2.1 Session Manager (wrapper sobre multi-agente nativo)

> **IMPORTANTE (rev. 2)**: NO crear SessionManager from scratch. Usar el sistema
> multi-agente nativo de OpenClaw como backend. El SessionManager es un **wrapper**
> que traduce comandos de JorchBot a llamadas RPC de OpenClaw.

- [ ] Crear `src/sessions/manager.ts` como wrapper sobre OpenClaw agents RPC
- [ ] `/new` → `agents.create()` RPC + iniciar ClaudeRunner
- [ ] `/stop` → matar ClaudeRunner + `agents.delete()` RPC
- [ ] `/list` → `agents.list()` RPC + Focus Model state
- [ ] `/switch` → actualizar Focus Model (DB)
- [ ] `/compact` → `sessions.compact` RPC (ya existe en OpenClaw)
- [ ] Cada proyecto JorchBot = un agente OpenClaw con workspace configurado
- [ ] Persistir metadata adicional en DB JorchBot (tabla sessions): focus state, context %, modes
- [ ] Restaurar sesiones al reiniciar el Gateway
- [ ] Limite configurable de sesiones simultaneas (default: 5)

**Mapeo interno (comandos → RPC)**:

| Comando JorchBot    | Internamente                            |
| ------------------- | --------------------------------------- |
| `/new frontend`     | `agents.create()` RPC + `ClaudeRunner`  |
| `/switch frontend`  | Actualiza Focus Model en DB             |
| `/list`             | `agents.list()` RPC + Focus Model       |
| `/stop frontend`    | Mata `ClaudeRunner` + `agents.delete()` |
| `/compact frontend` | `sessions.compact` RPC                  |
| `/status`           | `gateway.health` + `gateway.status` RPC |

```typescript
// src/sessions/manager.ts
// Wrapper sobre multi-agente nativo de OpenClaw
export class SessionManager {
  // Llama agents.create() RPC + inicia ClaudeRunner
  async create(project: string, path: string): Promise<Session>;

  // Mata ClaudeRunner + agents.delete() RPC
  async destroy(sessionId: string): Promise<void>;

  // Actualiza Focus Model en DB
  async focus(sessionId: string): Promise<void>;

  // agents.list() RPC + Focus Model state
  async list(): Promise<Session[]>;

  // Query DB por focused = true
  async getFocused(): Promise<Session | null>;

  // Query DB por project name
  async getByProject(project: string): Promise<Session | null>;
}
```

**Criterio de aceptacion**: `/new frontend`, `/new backend`, `/switch frontend`, `/list` funcionan. Internamente usan agents RPC de OpenClaw.

### 2.2 Focus Model

- [ ] Solo UNA sesion enfocada a la vez
- [ ] Mensajes libres van a la sesion enfocada
- [ ] Comandos `$` van a la sesion enfocada
- [ ] Background sessions: buffer de output en DB

**Reglas de mensajes background**:

| Evento en background | Se envia a WP? | Formato                                                  |
| -------------------- | -------------- | -------------------------------------------------------- |
| Aprobacion necesaria | SI             | `[backend] 🔔 (bg) Necesita aprobacion: ...` + botones   |
| Tarea completada     | SI             | `[backend] 🔔 (bg) Completado. X archivos modificados.`  |
| Error                | SI             | `[backend] 🔴 (bg) Error: ...`                           |
| Context 70%          | SI             | `[backend] ⚠️ (bg) Context al 70%`                       |
| Context 90%          | SI             | `[backend] 🔴 (bg) Context al 90%. Usa /compact backend` |
| Output normal        | NO (va a logs) | Solo visible con `/logs backend`                         |

- [ ] Implementar buffer de mensajes por sesion
- [ ] Implementar filtro de notificaciones background
- [ ] Taggear todos los mensajes con `[project_name]`

**Criterio de aceptacion**: Estar en frontend, recibir notificacion de backend, responder sin cambiar de sesion.

### 2.3 Shell Runner (via exec tool de OpenClaw)

> **NOTA (rev. 2)**: OpenClaw tiene un `exec` tool con `BashProcessRegistry` que ya
> maneja timeouts, signal handling, y process tracking. Considerar reusar esto en vez
> de construir `child_process.exec` custom. El ShellRunner puede ser un wrapper sobre
> el exec tool existente, agregando solo la deteccion de comandos peligrosos.

- [ ] Crear `src/sessions/shell-runner.ts`
- [ ] Evaluar reusar `exec` tool de OpenClaw (BashProcessRegistry)
- [ ] Si se reusa: wrapper sobre exec tool + deteccion de peligrosos
- [ ] Si no se reusa: `child_process.exec` como fallback
- [ ] Detectar prefijo `$` en mensajes entrantes
- [ ] Ejecutar comando en el directorio del workspace activo
- [ ] Capturar stdout + stderr
- [ ] Timeout configurable (default: 30s)
- [ ] Detectar comandos peligrosos (rm -rf, shutdown, etc.) → pedir confirmacion
- [ ] No consumir tokens de Claude (ejecucion directa, no via LLM)

```typescript
// src/sessions/shell-runner.ts
// Considerar wrapper sobre exec tool de OpenClaw (BashProcessRegistry)
export class ShellRunner {
  async execute(
    command: string,
    options: {
      cwd: string;
      timeout?: number;
    },
  ): Promise<ShellResult>;

  isDangerous(command: string): boolean;
}
```

**Lista de comandos peligrosos** (piden confirmacion):

- `rm -rf`, `rm -r`
- `sudo`, `su`
- `shutdown`, `reboot`
- `kill -9`
- `chmod 777`
- `> /dev/null` (redireccion destructiva)
- `DROP TABLE`, `DELETE FROM` (SQL)
- `git push --force`, `git reset --hard`

**Criterio de aceptacion**: `$ ls src/` muestra archivos, `$ rm -rf /` pide confirmacion.

### 2.4 Shortcuts de Shell

- [ ] Implementar en command router:

| Shortcut                 | Ejecucion real              | Notas                             |
| ------------------------ | --------------------------- | --------------------------------- |
| `/ls [path]`             | `ls -la [path]`             | Default: directorio del workspace |
| `/cat <file>`            | `cat <file>`                | Con chunking si es largo          |
| `/grep <pattern> [path]` | `grep -rn <pattern> [path]` | Con colores/lineas                |
| `/pwd`                   | `pwd`                       | Muestra directorio actual         |
| `/git <args>`            | `git <args>`                | Cualquier comando git             |
| `/tree [depth]`          | `tree -L [depth]`           | Default depth: 3                  |

**Criterio de aceptacion**: `/ls src/` muestra archivos del workspace activo.

### 2.5 Comandos de sesion

- [ ] Implementar en command router:

| Comando              | Accion                                         |
| -------------------- | ---------------------------------------------- |
| `/new <name> [path]` | Crea workspace. Si no hay path, pregunta       |
| `/switch <name>`     | Cambia sesion enfocada                         |
| `/list`              | Lista sesiones con estado, context %, modo     |
| `/stop <name>`       | Detiene sesion (mata procesos, cierra tunnels) |
| `/compact <name>`    | Ejecuta compact de Claude Code                 |
| `/logs <name> [n]`   | Ultimos n mensajes (default 20)                |
| `/replay <name>`     | Re-envia ultima accion de la sesion            |
| `/history`           | Resumen de todas las sesiones                  |

**Formato de /list**:

```
Sesiones activas:
● frontend (enfocada) - Context: 18% - Mode: confirm+verbose
○ backend (background) - Context: 8% - Mode: confirm+verbose
○ mobile (background) - Context: 0% - Mode: auto+silent
```

**Criterio de aceptacion**: Todos los comandos funcionan y persisten en DB.

### 2.6 Logs por sesion

- [ ] Guardar todos los mensajes en DB (tabla messages)
- [ ] Cada mensaje tiene: sessionId, direction, type, content, metadata, timestamp
- [ ] `/logs <name>` consulta DB y formatea para WP
- [ ] `/logs <name> full` genera documento TXT y lo envia como adjunto
- [ ] Implementar cleanup job: purgar logs vencidos segun retencion configurada

**Criterio de aceptacion**: `/logs backend` muestra los ultimos 20 mensajes de esa sesion.

### 2.7 Aprobaciones via Claude Code Hooks

> **IMPORTANTE (rev. 3 — 2026-02-19)**: El flujo de aprobacion via stdin (escribir "yes"/"no" al
> stdin de Claude Code) NO funciona. Claude Code se cuelga en modo headless con stdin piped.
> Se requiere `--dangerously-skip-permissions` para operacion headless. La aprobacion a nivel de
> herramienta se implementa via **hooks `PreToolUse` de Claude Code**.

**Arquitectura**: Claude Code ejecuta un hook script ANTES de cada herramienta de escritura/modificacion
(Edit, Write, Bash, etc.). El hook script:

1. Recibe JSON con `tool_name` y `tool_input` (ej: que archivo editar, que comando ejecutar)
2. Llama al gateway JorchBot via HTTP (`POST /api/tool-approval`)
3. El gateway envia botones WhatsApp al usuario via Kapso
4. El hook espera (poll) hasta que el usuario responda
5. Devuelve `allow` o `deny` a Claude Code

**Ventajas sobre stdin**:

- Funciona con `--dangerously-skip-permissions` (requerido para headless)
- El usuario ve el **detalle completo** de lo que Claude quiere hacer (diff, comando, etc.)
- No es solo si/no: puede inyectar contexto (`additionalContext`) o modificar parametros (`updatedInput`)
- Herramientas de lectura (Read, Glob, Grep) pasan sin aprobacion — solo escritura necesita OK

**Tareas**:

- [ ] Crear script de hook PreToolUse (`src/hooks/tool-approval.ts`)
- [ ] Crear script de hook PostToolUse + PostToolUseFailure (`src/hooks/tool-result.ts`) para reportar resultados y errores
- [ ] Crear endpoints en gateway (`POST/GET /api/tool-approval`, `POST /api/tool-result`)
- [ ] Reescribir ApprovalManager: HTTP-based en vez de stdin
- [ ] Generar `.claude/settings.local.json` con config de hooks al crear sesion
- [ ] Formatear mensajes de aprobacion para WhatsApp (diff para Edit, comando para Bash)
- [ ] Cada boton de aprobacion lleva `approvalId` + `sessionId` en metadata
- [ ] Al recibir click en boton, JorchBot extrae approvalId y rutea al proceso correcto
- [ ] Botones de background incluyen nombre: `[backend] 🔧 Edit: src/api/...`
- [ ] No cambiar sesion enfocada al responder aprobacion de background

**Referencia de hooks**: Claude Code tiene 14 tipos de hook events. Fase 2 usa 3:
`PreToolUse` (aprobacion), `PostToolUse` (reporte de resultados), `PostToolUseFailure` (reporte de errores).
Otros hooks utiles para fases futuras: `Notification` (detectar Claude idle), `Stop` (detectar preguntas
via `last_assistant_message`), `PreCompact` (notificar antes de auto-compaction). Ver SPEC seccion 2.6.8.

**Nota sobre preguntas de Claude**: Cuando Claude hace preguntas (pide clarificacion, assumptions, etc.),
NO hay un hook especial. Las preguntas fluyen como texto normal via `ClaudeRunner.on("text")` → WhatsApp.
No se necesita hook adicional para esto.

**Importante**: `PermissionRequest` hooks NO se disparan en modo headless (`-p`). Solo `PreToolUse` funciona.

**Criterio de aceptacion**: Usuario ve detalle de cada tool call, toca Aprobar/Rechazar en WhatsApp.
Claude Code procede o se ajusta segun la decision. Aprobaciones de background funcionan sin cambiar enfoque.

---

## Definicion de "Terminado"

- [ ] `/new frontend ~/projects/app/frontend` crea workspace con Claude Code
- [ ] `/new backend ~/projects/app/backend` crea segundo workspace
- [ ] `/switch frontend` cambia el enfoque
- [ ] Mensajes libres van a la sesion enfocada
- [ ] `$ git status` ejecuta en el directorio del workspace activo
- [ ] `/ls src/` lista archivos del workspace activo
- [ ] Notificaciones de background llegan tagueadas
- [ ] Aprobaciones de background funcionan sin cambiar enfoque
- [ ] `/logs backend` muestra historial
- [ ] `/list` muestra todas las sesiones con estado
- [ ] Sesiones persisten en DB y se restauran al reiniciar
- [ ] Tests pasan, CI en verde

---

## Notas tecnicas

- **Sesiones = agentes OpenClaw**: Cada sesion JorchBot es un agente en el sistema multi-agente de OpenClaw. SessionManager es un wrapper, no una reimplementacion.
- **ClaudeRunner** corre como child process por sesion con `--dangerously-skip-permissions` + `stdin: "ignore"`. La aprobacion de herramientas NO va por stdin — va por hooks `PreToolUse`.
- **Hooks PreToolUse**: Scripts que Claude Code ejecuta ANTES de cada herramienta. Son sincronos y bloquean a Claude Code hasta que el usuario apruebe o rechace via WhatsApp. Config en `.claude/settings.local.json` del workspace.
- **14 hook events disponibles**: Claude Code soporta 14 tipos de hooks. Fase 2 usa 3 (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`). `PermissionRequest` NO funciona en modo headless. Preguntas de Claude fluyen como texto normal (no necesitan hook). Ver SPEC seccion 2.6.8 para tabla completa.
- **Fase 1 (interino)**: Usa `REMOTE_SYSTEM_PROMPT` para que Claude describa su plan y espere confirmacion conversacional. Fase 2 lo reemplaza con aprobacion real a nivel de herramienta via hooks.
- **ShellRunner** debe evaluar reusar `exec` tool de OpenClaw (BashProcessRegistry ya tiene timeouts, signals, tracking). Fallback: `child_process.exec`.
- **Focus Model** es un estado en DB JorchBot (solo una sesion con `focused = true`). OpenClaw no tiene este concepto.
- **Auto-compaction** ya existe via `sessions.compact` RPC. Solo conectarlo al comando `/compact`.
- **Session write locking** y queue management ya resueltos en OpenClaw. No reimplementar.
- Los botones de Kapso tienen un payload maximo. El metadata (`approvalId` + `sessionId`) debe caber en ese payload.
