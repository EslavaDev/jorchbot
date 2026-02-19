# Fase 0 - Fundacion

> **Estado**: Casi completo (sub-fases 0A-0H terminadas, pendientes: 0I.2 push CI, 0J verificacion final)
> **Dependencia**: Ninguna
> **Entregable**: Fork limpio de OpenClaw con DB, estructura de proyecto, y CI basico

---

## Objetivo

Tener un repositorio `jorchbot` funcional basado en OpenClaw, limpio de modulos
innecesarios, con base de datos SQLite configurada y la estructura lista para
recibir los modulos de las fases siguientes.

---

## Entregables

Al completar esta fase, tendremos:

1. Repo `jorchbot` en GitHub (personal, luego se migra)
2. Fork de OpenClaw con branding JorchBot
3. Modulos innecesarios eliminados o deshabilitados
4. SQLite + Drizzle ORM configurado con schema inicial
5. Estructura de directorios definida
6. CI basico (lint + tests)
7. `jorchbot` CLI funcional (arranca el Gateway sin canales)

---

## Tareas

### 0.1 Fork y setup del repositorio

- [ ] Fork de https://github.com/openclaw/openclaw
- [ ] Renombrar a `jorchbot`
- [ ] Actualizar `package.json`: name, description, author, repository
- [ ] Actualizar README con branding JorchBot
- [ ] Limpiar CHANGELOG / HISTORY
- [ ] Verificar que `pnpm install` y `pnpm build` funcionan

**Criterio de aceptacion**: `pnpm build` compila sin errores.

### 0.2 Auditar y limpiar modulos de OpenClaw

OpenClaw tiene 15+ channel adapters y muchas features que JorchBot no necesita en fase 0.
Hay que deshabilitar (no eliminar) lo que no usaremos inicialmente.

**Mantener**:

- Gateway core (WebSocket server, session model, command routing)
- WebChat (lo reutilizamos como base para la GUI en fase 6)
- Plugin system / extension architecture
- Auth system (DM pairing)
- CLI (`jorchbot` command)

**Deshabilitar (no eliminar, solo desconectar del build)**:

- Canal WhatsApp (Baileys) — lo reemplazamos con Kapso en fase 1
- Canal Telegram (gramY) — lo reconectamos en fase 7
- Canal Slack, Discord, Signal, iMessage, Google Chat
- Todas las extensions (BlueBubbles, Teams, Matrix, etc.)
- Voice Wake / Talk Mode
- Browser automation (CDP)
- Device Nodes (macOS app, iOS, Android)
- Cron jobs
- Gmail Pub/Sub
- Live Canvas / A2UI

**Criterio de aceptacion**: `jorchbot start` levanta el Gateway sin errores. No intenta conectar a ningun canal de mensajeria.

### 0.3 Configurar SQLite + Drizzle ORM

- [ ] Instalar dependencias: `better-sqlite3`, `drizzle-orm`, `drizzle-kit`
- [ ] Crear directorio `src/db/`
- [ ] Crear schema inicial en `src/db/schema.ts`
- [ ] Configurar `drizzle.config.ts`
- [ ] Generar migracion inicial con `drizzle-kit generate`
- [ ] Implementar `src/db/index.ts` (singleton de conexion)
- [ ] Auto-migrate al iniciar el Gateway
- [ ] DB file location: `~/.jorchbot/jorchbot.db`

**Schema inicial**:

```typescript
// src/db/schema.ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  project: text("project").notNull(),
  path: text("path").notNull(),
  claudeSessionId: text("claude_session_id"),
  mode: text("mode").notNull().default("confirm"), // confirm|plan|auto
  outputMode: text("output_mode").notNull().default("verbose"), // verbose|summary|silent
  contextPercent: integer("context_percent").default(0),
  status: text("status").notNull().default("active"), // active|stopped|error|paused
  focused: integer("focused", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").references(() => sessions.id),
  direction: text("direction").notNull(), // inbound|outbound|system
  type: text("type").notNull(), // text|approval|command|error|notification|shell
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON string
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const tunnels = sqliteTable("tunnels", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id),
  localPort: integer("local_port").notNull(),
  assignedPort: integer("assigned_port"),
  url: text("url"),
  provider: text("provider").notNull(), // tailscale-serve|tailscale-funnel
  mode: text("mode").notNull().default("serve"), // serve|funnel
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").references(() => sessions.id),
  action: text("action").notNull(),
  context: text("context"),
  status: text("status").notNull().default("pending"), // pending|approved|rejected|expired
  userFeedback: text("user_feedback"), // feedback del "Yes + feedback"
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
```

**Criterio de aceptacion**: Al iniciar `jorchbot start`, la DB se crea automaticamente en `~/.jorchbot/jorchbot.db` con todas las tablas.

### 0.4 Estructura de directorios

```
jorchbot/
├── src/
│   ├── gateway/              # Gateway core (heredado de OpenClaw)
│   ├── channels/             # Channel registry (heredado de OpenClaw)
│   ├── sessions/
│   │   └── jorchbot/
│   │       ├── manager.ts        # Fase 2: SessionManager (wrapper sobre agents RPC)
│   │       ├── focus-model.ts    # Fase 2: Focus Model (sesion activa vs background)
│   │       ├── claude-runner.ts  # Fase 1: Claude Code headless subprocess
│   │       └── shell-runner.ts   # Fase 2: Shell Runner (comandos $ directos)
│   ├── jorchfile/
│   │   ├── parser.ts         # Fase 3: Jorchfile parser
│   │   └── executor.ts       # Fase 3: Command executor
│   ├── tunnels/
│   │   ├── manager.ts        # Fase 4: Tunnel Manager
│   │   ├── tailscale.ts      # Fase 4: Tailscale integration (unico provider)
│   │   └── port-manager.ts   # Fase 4: Port auto-discovery
│   ├── commands/
│   │   └── router.ts         # Fase 1: Command routing (/new, /switch, etc.)
│   ├── approvals/
│   │   └── manager.ts        # Fase 1: Approval flow (Yes/No/Feedback)
│   ├── messages/
│   │   └── chunker.ts        # Fase 5: Message splitting/chunking
│   ├── gui/                  # Fase 6: Extender Control UI existente (puerto 18789)
│   ├── db/
│   │   ├── index.ts          # DB connection singleton
│   │   ├── schema.ts         # Drizzle schema
│   │   └── migrations/       # SQL migrations
│   ├── errors/
│   │   └── index.ts          # JorchBot error class hierarchy
│   └── utils/
│       └── logger.ts         # Logging utility
├── extensions/
│   └── kapso/                # Fase 1: WhatsApp via Kapso (channel plugin via Plugin SDK)
├── config/
│   └── default.ts            # Default configuration
├── tests/
│   ├── unit/
│   └── e2e/
├── drizzle.config.ts
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
└── README.md
```

> **NOTA ARQUITECTURAL (rev. 2)**:
>
> - **Kapso** se implementa como **channel plugin** en `extensions/kapso/` usando el Plugin SDK de OpenClaw. Esto hereda gratis: DM pairing, message chunking, access control.
> - **Sesiones** usan el **multi-agente nativo** de OpenClaw (`agents.create/update/delete`). No se crea un SessionManager custom.
> - **Shell execution** considera reusar el `exec` tool de OpenClaw (BashProcessRegistry con timeouts, signals).
> - **Tunnels** usan **solo Tailscale** (Serve y Funnel). Sin Cloudflare.
> - **Focus Model** es el unico concepto nuevo de sesion (OpenClaw no tiene "sesion enfocada").

- [ ] Crear estructura de directorios con archivos placeholder
- [ ] Cada directorio tiene un `index.ts` que exporta el modulo

**Criterio de aceptacion**: La estructura existe y el proyecto compila.

### 0.5 Configuracion de JorchBot

- [ ] Crear `~/.jorchbot/` como directorio de configuracion
- [ ] Crear `~/.jorchbot/config.json` con defaults
- [ ] Implementar config loader que mergea defaults + user config

```json
// ~/.jorchbot/config.json (defaults)
{
  "gateway": {
    "port": 18789,
    "host": "127.0.0.1"
  },
  "db": {
    "path": "~/.jorchbot/jorchbot.db",
    "logRetentionDays": 7,
    "summaryRetentionDays": 30,
    "errorRetentionDays": 90,
    "maxSizeMb": 500
  },
  "channels": {
    "kapso": {
      "enabled": false,
      "apiKey": ""
    },
    "telegram": {
      "enabled": false,
      "botToken": ""
    }
  },
  "tunnels": {
    "defaultMode": "serve",
    "tailscale": {
      "enabled": true
    }
  },
  "approvals": {
    "timeoutMinutes": 10,
    "pauseTimeoutMinutes": 60
  }
}
```

**Criterio de aceptacion**: `jorchbot start` carga la config, crea `~/.jorchbot/` si no existe.

### 0.6 CLI basico

- [ ] Comando `jorchbot start` — levanta el Gateway
- [ ] Comando `jorchbot stop` — detiene el Gateway
- [ ] Comando `jorchbot status` — muestra estado del Gateway
- [ ] Comando `jorchbot config` — muestra/edita configuracion
- [ ] Comando `jorchbot version` — muestra version

**Criterio de aceptacion**: Todos los comandos funcionan desde terminal.

### 0.7 CI basico

- [ ] GitHub Action: lint (oxlint)
- [ ] GitHub Action: type check (tsc --noEmit)
- [ ] GitHub Action: tests (vitest)
- [ ] GitHub Action: build

**Criterio de aceptacion**: PR checks pasan en verde.

---

## Definicion de "Terminado" (Definition of Done)

- [ ] `pnpm install && pnpm build` funciona sin errores
- [ ] `jorchbot start` levanta el Gateway, crea la DB, carga la config
- [ ] `jorchbot stop` detiene el Gateway limpiamente
- [ ] Todos los tests pasan
- [ ] CI en verde
- [ ] No hay referencias a "OpenClaw" en el codigo visible al usuario (branding limpio)
- [ ] README actualizado con instrucciones de setup

---

## Notas Tecnicas

- No eliminar modulos de OpenClaw, solo desconectarlos. Facilita cherry-pick de fixes upstream.
- La DB se crea con migraciones automaticas al iniciar. No requiere setup manual.
- El Gateway debe arrancar aunque no haya canales configurados (modo "headless").
- **Estrategia rev. 2**: Extender OpenClaw, no reconstruir. Reusar multi-agente, sessions, DM pairing, tool policies. Solo ClaudeRunner y Focus Model son componentes nuevos de runtime.
- **Dos SQLite coexisten**: OpenClaw memory (`~/.jorchbot/memory/`) + JorchBot metadata (`~/.jorchbot/jorchbot.db`).
- **Config**: JorchBot usa JSON (`~/.jorchbot/config.json`) para config Layer 2, Gateway usa JSON5 (`~/.jorchbot/jorchbot.json`) para config Layer 1. En fase 2 se consolidan en un solo archivo.
- **State dir renombrado**: `~/.openclaw/` → `~/.jorchbot/` (definido en `src/config/paths.ts`: `NEW_STATE_DIRNAME = ".jorchbot"`).
