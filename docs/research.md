# JorchBot - Research Document

> **Estado**: En investigacion / iteracion
> **Ultima actualizacion**: 2026-02-18 (rev. 2 - correcciones DeepWiki)
> **Nombre del proyecto**: JorchBot
> **Base**: Fork de OpenClaw (MIT License)

---

## 1. Problema

Hoy en dia para hacer codigo necesitas estar frente a tu IDE o entorno de desarrollo. Si tienes que salir urgente (al banco, una reunion, etc.), pierdes la capacidad de interactuar con tu entorno de desarrollo.

OpenClaw permite controlar tu sistema operativo desde apps de mensajeria, pero esta enfocado como asistente personal general, no como herramienta de desarrollo.

**JorchBot** adapta este concepto para que sea una herramienta de desarrollo remoto: controlar instancias de Claude Code, levantar proyectos, ver previews, y recibir resultados, todo desde WhatsApp/Telegram.

---

## 2. Tecnologias Investigadas

### 2.1 OpenClaw (Base del proyecto)

- **Repo**: https://github.com/openclaw/openclaw
- **Stack**: TypeScript (~85%), Node.js >= 22, pnpm monorepo
- **License**: MIT
- **Stars**: ~208,129 (febrero 2026)
- **Release cadence**: Diario (formato `YYYY.M.D`)
- **Creador principal**: Peter Steinberger (steipete) con ~8,863 commits

**Arquitectura**: Gateway-centric WebSocket control plane.

```
Messaging Platforms → Gateway (ws://127.0.0.1:18789) → Pi Agent (RPC) → LLM APIs
```

**Componentes clave**:

- **Gateway**: Control plane en localhost:18789. Maneja sesiones, routing de agentes, conexiones de canales, ejecucion de tools, cron jobs, webhooks
- **Pi Agent Runtime**: Agente RPC que se comunica con el Gateway via WebSocket
- **Channel Adapters**: Adaptadores por plataforma (WhatsApp, Telegram, Discord, Slack, etc.)
- **Session Model**: Sesion `main` para chats directos, con aislamiento de grupos
- **Device Nodes**: Apps nativas (macOS, iOS, Android) se conectan como "nodes"
- **Plugin/Extension system**: Extensions en `extensions/` como workspace packages

**Plataformas de mensajeria soportadas (15+)**:

- Built-in: WhatsApp (Baileys), Telegram (gramY), Slack (Bolt), Discord (discord.js), Google Chat, Signal (signal-cli), iMessage, WebChat
- Extensions: BlueBubbles, Microsoft Teams, Matrix, Zalo, IRC, Feishu, LINE, Mattermost, Nextcloud Talk, Nostr, Twitch, DingTalk

**Manejo de API Keys en OpenClaw**:

- Auth profiles en JSON: `~/.openclaw/agents/<agentId>/auth-profiles.json` (por agente, no global)
- 3 tipos: `api_key` (estatica), `token` (temporal), `oauth` (con refresh)
- Multi-key failover: si una key da 429, prueba la siguiente con cooldown configurable
- Failover clasifica errores: auth_error (401), billing_error (402, 24h cooldown), rate_limit (429), context_overflow (auto-compact), timeout, overloaded (529)
- Resolucion de credenciales por prioridad:
  1. `OPENCLAW_LIVE_<PROVIDER>_KEY`
  2. `<PROVIDER>_API_KEYS`
  3. `<PROVIDER>_API_KEY`
  4. `<PROVIDER>_API_KEY_*`
- Permisos: `~/.openclaw/` chmod 700, archivos de config chmod 600

**Configuracion del Gateway**:

- Formato de config: **JSON5** (con soporte de comentarios) en `~/.openclaw/openclaw.json`
- Validacion con Zod schemas (`src/config/zod-schema.ts`)
- Soporte de `$include` directives para dividir configs en multiples archivos
- Protocol version: **3** (`PROTOCOL_VERSION = 3`)
- Puerto browser/Control UI: basePort + 2 (ej: 18791 para loopback)

**RPC Methods completos del Gateway**:

| Dominio      | Metodos                                     | Proposito             |
| ------------ | ------------------------------------------- | --------------------- |
| `agent.*`    | `agent`, `agent.wait`, `agent.identity.get` | Ejecucion e identidad |
| `agents.*`   | `list`, `create`, `update`, `delete`        | **Multi-agente CRUD** |
| `sessions.*` | `list`, `patch`, `reset`, `compact`         | Gestion de sesiones   |
| `channels.*` | `status`, `logout`                          | Estado de canales     |
| `config.*`   | `get`, `set`, `patch`, `apply`              | Configuracion         |
| `node.*`     | `list`, `describe`, `invoke`, `pair.*`      | Device nodes          |
| `cron.*`     | `list`, `add`, `run`, `runs`                | Scheduling            |

**API endpoints HTTP del Gateway**:

- `/v1/chat/completions` — OpenAI-compatible API
- `/v1/responses` — OpenResponses API
- `/tools/invoke` — Invocacion directa de tools
- `/__openclaw__/health` — Health check (`{"ok": true}`)

**Sistema Multi-Agente nativo**:

- Cada agente tiene: workspace, sessions, auth profiles, skills, IDENTITY.md
- Session keys: `agent:{agentId}:{channel}:{scope}:{identifier}`
- Session transcripts: JSONL en `~/.openclaw/agents/{agentId}/sessions/{sessionKey}.jsonl`
- Queue management: `session` (secuencial por sesion) o `global` (concurrente)
- Session write locking: `acquireSessionWriteLock` previene modificaciones concurrentes
- Session reset policies: `idle` (N minutos), `daily` (hora fija), `off` (manual)
- History limits: DM sin limite, groups 100 turns (configurable)

**Auto-Compactacion de contexto**:

- Cuando el modelo devuelve `context_length_exceeded`, se activa auto-compaction
- `compactEmbeddedPiSession`: resume turnos antiguos, mantiene recientes verbatim
- Disponible via RPC: `sessions.compact`
- Tambien via directiva del usuario: `/compact`

**Memory System (SQLite + embeddings)**:

- DB per-agent en `~/.openclaw/memory/{agentId}.sqlite`
- Hybrid search: vector similarity (cosine) + BM25 keyword matching
- Providers de embeddings: OpenAI, Gemini, Voyage, local (node-llama-cpp)
- Indexa: workspace Markdown files + session transcripts
- Tools del agente: `memory_search`, `memory_get`

**Tool Policy Cascade (6 niveles, restrictivo)**:

1. Profile Resolution (minimal/coding/messaging/full)
2. Global/Agent Resolution (`tools.allow`/`deny`)
3. Provider-Specific (`tools.byProvider`)
4. Group Resolution (per-channel-group)
5. Sandbox Resolution (Docker container restrictions)
6. Subagent Resolution

- Deny SIEMPRE gana sobre allow en cualquier nivel

**Exec Tool Security**:

- `tools.exec.ask`: `"off"` | `"on-miss"` (solo no-listados) | `"always"`
- `tools.exec.security`: `"deny"` | `"allowlist"` | `"full"`
- `BashProcessRegistry`: tracking de procesos, timeouts, signal handling
- Host routing: `"sandbox"` (Docker), `"gateway"` (host), `"node"` (device)

**DM Pairing (autenticacion)**:

- Protege contra acceso no autorizado por DM
- Cuando un desconocido manda mensaje, se genera codigo de 6 digitos
- El dueño aprueba via CLI: `openclaw pairing approve <codigo>`
- El remitente se agrega al allowlist automaticamente
- 4 politicas: `pairing` (default), `allowlist` (solo listados), `open` (todos), `disabled` (ignorar)

**Control UI existente**:

- `gateway.controlUi.enabled: true` (default)
- Servido como assets estaticos desde el Gateway
- Puerto: basePort + 2 (18791 en loopback)

**Plugin SDK**:

- Exportado como `openclaw/plugin-sdk`
- 4 slots: channels, tools, memory, providers
- Manifest via `openclaw.extensions` en `package.json`
- Auto-enabling: plugins bundled se activan cuando su config section existe
- Extensions en `extensions/` como workspace packages

**Skills System**:

- Skills proveen guia de lenguaje natural para tools (documentacion inyectada al prompt)
- Discovery: workspace (`${workspaceDir}/skills/`) → agent → bundled → extraDirs
- Cada skill requiere `SKILL.md` con frontmatter (name, description, version)
- Variables de entorno por skill: `skills.entries[skillName].env`

**Service Management (ya resuelto)**:

- macOS: `launchd` (service: `bot.molt.<profile>`)
- Linux: `systemd` (service: `openclaw-gateway[-<profile>].service`)
- Windows: `schtasks` (Task Scheduler)
- Markers en environment: `OPENCLAW_SERVICE_MARKER`, `OPENCLAW_SERVICE_KIND`, `OPENCLAW_SERVICE_VERSION`

**Gaps de seguridad conocidos (que JorchBot debe resolver)**:

- Keys almacenadas en texto plano (issue #7916)
- API keys se filtran al contexto del LLM (issue #11829)
- Sin integracion con keychain del OS
- Sin encriptacion at-rest

**Onboarding**: Wizard interactivo (`openclaw onboard`) o non-interactive para scripted deploys.

**Providers soportados (14)**: OpenAI, Anthropic, Google Gemini, Google Vertex, OpenCode Zen, Z.AI, Vercel AI Gateway, OpenRouter, xAI, Groq, Cerebras, Mistral, GitHub Copilot, AWS Bedrock.

> **NOTA CRITICA**: Anthropic bloqueo el uso de suscripciones Claude Max/Pro via OAuth para terceros desde enero 2026. Solo el CLI oficial de Claude Code puede usar suscripciones. Esto NO afecta a JorchBot porque ejecutamos Claude Code headless directamente.

> **NOTA ARQUITECTURAL (rev. 2)**: OpenClaw es mucho mas completo de lo que se documento inicialmente. Ya tiene multi-agente, auto-compaction, tool approval, memory system, plugin SDK, DM pairing, y Control UI. JorchBot debe **extender** OpenClaw, no reconstruir encima. Ver seccion 17 para analisis detallado.

---

### 2.2 Claude Code (Headless)

Claude Code es el CLI oficial de Anthropic para desarrollo. Se puede ejecutar de forma programatica con el flag `-p`:

```bash
# Uso basico headless
claude -p "Fix the bug in auth.py" --allowedTools "Read,Edit,Bash"

# Salida JSON para parsing programatico
claude -p "Summarize this project" --output-format json

# Streaming JSON para output en tiempo real
claude -p "Explain recursion" --output-format stream-json --verbose

# Pipe de datos via stdin
cat error.log | claude -p "Summarize the key errors"

# Sesiones multi-turn via session IDs
session_id=$(claude -p "Start a review" --output-format json | jq -r '.session_id')
claude -p "Continue that review" --resume "$session_id"
```

**Flags clave para JorchBot**:

- `--output-format json`: JSON estructurado con result, session_id, metadata
- `--output-format stream-json`: NDJSON para streaming en tiempo real
- `--allowedTools`: Auto-aprobar tools especificos
- `--resume <session_id>`: Continuar conversaciones multi-turn
- `--continue`: Continuar la conversacion mas reciente
- `--append-system-prompt`: Instrucciones custom

**Claude Agent SDK** (Python y TypeScript):

- Python: `pip install claude-agent-sdk`
- TypeScript: `npm install @anthropic-ai/claude-agent-sdk`
- Provee: tool approval callbacks, session persistence, subagent orchestration, MCP extensibility

> **Para JorchBot**: Claude Code headless es la forma correcta de integracion. No necesitamos manejar API keys de Anthropic directamente ya que Claude Code usa la autenticacion de la maquina host (suscripcion del usuario).

---

### 2.3 WhatsApp - Kapso.ai (Canal principal)

**Decision**: Usar Kapso.ai en lugar de Baileys.

**Razones**:

- API oficial de Meta (mas estable que Baileys que es reverse-engineered)
- Soporta **botones interactivos y listas** (critico para aprobaciones de Claude Code)
- Soporta **webhooks** con retry automatico (3 intentos, backoff exponencial)
- SDK TypeScript oficial: `@kapso/whatsapp-cloud-api`
- Mas barato que Twilio (~20x)

> **INVESTIGACION: Baileys NO soporta botones ni listas.**
> Desde agosto 2024 (PR #956), Baileys elimino completamente el soporte de botones,
> listas y templates. Meta bloquea estos mensajes server-side para APIs no oficiales.
> No existe workaround viable. Solo quedan polls como alternativa (limitada).
> Esto confirma que Kapso.ai (API oficial) es la unica opcion para interactive messages.

**Pricing**:

| Plan     | Precio   | Mensajes/mes |
| -------- | -------- | ------------ |
| Free     | $0/mes   | 2,000        |
| Pro      | $25/mes  | 100,000      |
| Platform | $299/mes | 1,000,000    |

**Capacidades de mensajeria**:

- Texto: hasta 4,096 caracteres por mensaje
- Imagenes: JPEG/PNG hasta 5MB
- Documentos: hasta 100MB
- Videos: hasta 16MB
- **Botones interactivos**: Si (hasta 3 botones por mensaje)
- **Listas**: Si (hasta 10 items)
- **Webhooks**: message received, message sent, conversation inactive, etc.

**Integracion tecnica**:

```typescript
import { WhatsAppClient } from "@kapso/whatsapp-cloud-api";

const client = new WhatsAppClient({
  baseUrl: "https://api.kapso.ai/meta/whatsapp",
  kapsoApiKey: "your-api-key",
});

await client.sendText({ to: "+1234567890", body: "Build completado!" });
```

**Limitaciones**:

- Ventana de 24 horas: despues de que el user envie un mensaje, puedes responder libremente por 24h. Despues solo template messages.
- Template messages requieren aprobacion de Meta.
- Numero de telefono US solamente (funciona globalmente).
- Sin soporte de grupos aun.

> **RIESGO**: Meta prohibe chatbots de IA de proposito general en WhatsApp desde enero 2026. Sin embargo, JorchBot se puede posicionar como "herramienta de automatizacion de desarrollo" (task-oriented automation), no como chatbot general. Kapso puede ayudar a manejar esto con sus flujos estructurados (botones, listas). Se recomienda tener Telegram como fallback.

---

### 2.4 Telegram (Canal secundario / fallback)

- API oficial, gratuita, sin restricciones de IA
- Soporta Markdown/HTML y code blocks (ideal para codigo)
- Mensajes de hasta 4,096 caracteres
- Archivos de hasta 4GB
- Imagenes via `sendPhoto` (hasta 10MB)
- Inline keyboards (botones interactivos)
- Webhooks nativos
- Rate limits: 30 msg/s global, 1 msg/s por chat individual
- OpenClaw ya lo soporta via gramY

---

### 2.5 Tailscale (Tunneling)

**Decision**: Usar Tailscale como solucion de tunneling. No construir uno propio.

**Razones**:

- Zero-config VPN basado en WireGuard
- Dos modos que cubren nuestros casos:
  - **Tailscale Serve**: Expone servicio a dispositivos dentro del tailnet (privado)
  - **Tailscale Funnel**: Expone servicio a internet (publico con HTTPS automatico)
- OpenClaw ya lo integra
- Cross-platform (Mac, Windows, Linux)
- Free tier generoso (3 users, 100 devices)
- URL estable: `https://<device>.<tailnet>.ts.net/`

**Uso en JorchBot**:

```bash
# Exponer dev server del proyecto al internet
tailscale funnel 3000

# Exponer GUI de configuracion de JorchBot
tailscale serve 18789
```

**Limitaciones de Funnel**:

- Solo puertos 443, 8443, 10000 (pero proxea a cualquier puerto local)
- HTTPS/TLS solamente (no TCP/UDP raw)
- Sin custom domains (solo `*.ts.net`)
- Requiere doble opt-in (admin console + device)

> **DECISION (rev. 2)**: No usar Cloudflare como fallback. JorchBot usa **solo Tailscale** (Serve para privado, Funnel para publico). Esto simplifica la Fase 4 significativamente. Si el usuario no tiene Tailscale, debe instalarlo. OpenClaw ya integra Tailscale en su binding mode `tailnet`.

---

### 2.6 Soluciones Existentes (Competencia)

| Proyecto                 | Que hace                            | Diferencia con JorchBot                            |
| ------------------------ | ----------------------------------- | -------------------------------------------------- |
| **claude-code-telegram** | Bot de Telegram + Claude Code       | Solo Telegram, sin tunneling, sin Jorchfile        |
| **yottoCode**            | App macOS + Telegram + Agent SDK    | Solo macOS, sin WP, sin multi-sesion               |
| **OpenClaw**             | Asistente personal multi-plataforma | No enfocado en dev, sin Jorchfile, sin tunnel auto |
| **LangBot**              | 20+ LLMs a 13+ plataformas          | Generico, no dev-focused                           |

**Diferenciadores de JorchBot**:

1. Jorchfile para comandos predefinidos por proyecto
2. Multi-sesion de Claude Code con identificadores
3. Tunnel automatico con URL enviada al chat
4. GUI de configuracion accesible via tunnel
5. Context window % tracking visible al usuario
6. Botones de aprobacion via WhatsApp (Kapso)
7. Enfocado 100% en flujo de desarrollo

---

## 3. Arquitectura

```
+----------------------------------------------------------+
|                    MESSAGING LAYER                        |
|  WhatsApp (Kapso.ai)  |  Telegram (gramY)  |  App (F2)  |
+----------------------------------------------------------+
                         |
                   [Auth Layer]
                   DM Pairing (F1)
                   TOTP 2FA (F2)
                         |
                         v
+----------------------------------------------------------+
|                  JORCHBOT GATEWAY                         |
|              (fork OpenClaw, TypeScript)                  |
|                                                          |
|  +----------------------------------------------------+  |
|  |              Command Router                        |  |
|  |  /new <project>  /switch <project>  /list          |  |
|  |  /dev <project>  /test <project>  /make <target>   |  |
|  |  /status         /stop <project>  /tunnel <proj>   |  |
|  |  mensaje libre → sesion activa de Claude Code      |  |
|  +----------------------------------------------------+  |
|                         |                                |
|  +----------------------------------------------------+  |
|  |            Session Manager                         |  |
|  |  - Crea/destruye sesiones de Claude Code           |  |
|  |  - Mantiene session_id por proyecto                |  |
|  |  - Rutea mensajes a la sesion correcta             |  |
|  |  - Reporta % context window por sesion             |  |
|  |  - Envia aprobaciones del user a Claude Code       |  |
|  +----------------------------------------------------+  |
|                         |                                |
|  +----------------------------------------------------+  |
|  |            Jorchfile Engine                        |  |
|  |  - Lee ~/.jorchbot/Jorchfile (global)              |  |
|  |  - Lee Makefile por proyecto (local)               |  |
|  |  - Ejecuta comandos predefinidos                   |  |
|  |  - Cada PROJECT define: path, comandos, tunnel     |  |
|  +----------------------------------------------------+  |
|                         |                                |
|  +----------------------------------------------------+  |
|  |         Claude Code Runner                         |  |
|  |  - Ejecuta claude -p --output-format stream-json   |  |
|  |  - Resume sesiones con --resume <session_id>       |  |
|  |  - Streaming de output al chat                     |  |
|  |  - Intercepta tool approvals → botones en WP      |  |
|  |  - Usa suscripcion del usuario (no API keys)       |  |
|  +----------------------------------------------------+  |
|                         |                                |
|  +----------------------------------------------------+  |
|  |            Tunnel Manager                          |  |
|  |  - Tailscale Funnel/Serve automatico               |  |
|  |  - Lee config de tunnel del Jorchfile              |  |
|  |  - Envia URL al chat cuando levanta                |  |
|  |  - Cloudflare Quick Tunnel como fallback           |  |
|  +----------------------------------------------------+  |
|                         |                                |
|  +----------------------------------------------------+  |
|  |            Config GUI (Web)                        |  |
|  |  - Accesible via Tailscale Serve                   |  |
|  |  - Configurar proyectos, Jorchfile, sesiones       |  |
|  |  - Ver estado de sesiones en tiempo real            |  |
|  |  - Logs y monitoring                               |  |
|  |  - Gestion de API keys (futuro multi-LLM)         |  |
|  +----------------------------------------------------+  |
+----------------------------------------------------------+
```

---

## 4. Jorchfile

Formato estilo Makefile. Ubicacion global: `~/.jorchbot/Jorchfile`

```makefile
# ~/.jorchbot/Jorchfile

PROJECT frontend
  path = ~/projects/my-app/frontend
  dev = npm run dev
  build = npm run build
  test = npm run test
  tunnel = tailscale funnel 3000
  instructions = Eres un experto en React y Next.js. Este proyecto usa App Router con TypeScript.

PROJECT backend
  path = ~/projects/my-app/backend
  dev = python manage.py runserver
  test = pytest
  tunnel = tailscale funnel 8000
  instructions = Este es un backend Django con PostgreSQL. Sigue PEP8.

PROJECT mobile
  path = ~/projects/my-app/mobile
  dev = npx expo start
  tunnel = tailscale funnel 19000
  instructions = Proyecto React Native con Expo. Soporta iOS y Android.
```

**Campos por PROJECT**:

- `path` (requerido): Ruta al directorio del proyecto
- `dev`: Comando para levantar el servidor de desarrollo
- `build`: Comando para construir el proyecto
- `test`: Comando para correr tests
- `tunnel`: Comando para levantar el tunnel
- `instructions`: Instrucciones para Claude Code en esta sesion (system prompt)
- Cualquier otro campo custom es un comando ejecutable

**Interaccion desde WhatsApp**:

- `/dev frontend` → ejecuta `npm run dev` + levanta tunnel + envia URL
- `/test backend` → ejecuta `pytest` y envia resultado
- `/new frontend` → abre sesion Claude Code en el path definido, con las instructions como system prompt
- `/switch backend` → cambia sesion activa
- `/list` → muestra sesiones y su % de context window
- `/make deploy` → ejecuta `make deploy` del Makefile del proyecto activo
- Mensaje libre → se envia a Claude Code en la sesion activa

**Jerarquia de comandos**:

1. Comandos de JorchBot (`/new`, `/switch`, `/list`, `/status`, `/stop`)
2. Comandos del Jorchfile (`/dev`, `/test`, `/build`, y custom)
3. Comandos del Makefile del proyecto (`/make <target>`)
4. Mensajes libres → Claude Code

**Cuando el Makefile y el Jorchfile tienen el mismo comando**: El Jorchfile tiene prioridad (es global). Para ejecutar el del Makefile: `/make <target>`.

---

## 5. Sesiones de Claude Code

### Flujo de creacion

```
User: /new frontend
  |
  v
JorchBot:
  1. Lee Jorchfile → encuentra PROJECT frontend
  2. cd ~/projects/my-app/frontend
  3. Ejecuta: claude -p --output-format stream-json \
       --append-system-prompt "instructions del Jorchfile" \
       --allowedTools "Read,Edit,Bash,Grep,Glob"
  4. Almacena session_id
  5. Responde al chat:
     "Sesion 'frontend' creada
      Path: ~/projects/my-app/frontend
      Context: 0% usado
      Session ID: abc123"
```

### Instrucciones a Claude Code

El campo `instructions` del Jorchfile se inyecta como system prompt via `--append-system-prompt`. Adicionalmente:

- Si el proyecto tiene un `CLAUDE.md`, Claude Code lo lee automaticamente
- Si el proyecto tiene un `.cursorrules` o similar, se puede mapear
- El user puede enviar instrucciones adicionales como mensaje libre

### Flujo de interaccion

```
User: "arregla el bug del login que no valida el email"
  |
  v
JorchBot:
  1. Identifica sesion activa (frontend)
  2. Ejecuta: claude -p "arregla el bug del login..." \
       --resume <session_id> --output-format stream-json
  3. Stream del output al chat (chunked en mensajes de 4096 chars)
  4. Si Claude Code pide aprobacion:
     → Envia boton WP: [Aprobar] [Rechazar] [Ver cambios]
  5. Espera respuesta del user
  6. Envia aprobacion/rechazo a Claude Code
  7. Al finalizar reporta:
     "Completado. Context: 23% usado"
```

### Tracking de Context Window

Cada respuesta de Claude Code en formato JSON incluye metadata con token usage. JorchBot calcula el % y lo reporta:

```
[frontend] Completado
Context window: 23% (47K/200K tokens)
Sesiones activas: frontend (23%), backend (45%)
```

**Alertas automaticas**:

- 70%: "Advertencia: sesion frontend al 70% de contexto"
- 90%: "Critico: sesion frontend al 90%. Considera usar /compact o /new"
- `/compact frontend`: Ejecuta compact de Claude Code para liberar contexto

---

## 6. GUI de Configuracion

Dashboard web accesible via Tailscale Serve en el puerto del Gateway.

```bash
# Accesible solo desde dispositivos en el tailnet
tailscale serve 18789
# URL: https://<device>.<tailnet>.ts.net/
```

**Funcionalidades**:

- **Dashboard**: Estado de sesiones activas, % context, uptime
- **Jorchfile Editor**: Editar proyectos y comandos visualmente
- **Logs**: Ver output de Claude Code y comandos en tiempo real
- **Tunnels**: Estado de tunnels activos, URLs
- **Settings**: Configuracion del Gateway, canales de mensajeria
- **API Keys** (fase 2): Gestion de keys para multi-LLM

**Tech stack de la GUI**: La que ya usa OpenClaw (WebChat UI servido desde el Gateway) + extensiones para las features de JorchBot.

---

## 7. Fases de Desarrollo

> **NOTA (rev. 2)**: Este resumen de alto nivel se reemplazo por el roadmap detallado
> en [phases-index.md](./phases-index.md) con 10 fases independientes.
> Las fases originales "MVP" y "Expansion" se distribuyeron en fases 0-9.
> Ver seccion 17 para los cambios arquitecturales derivados del analisis DeepWiki.

### Fase 1 - MVP (revisado)

- [x] Fork de OpenClaw (Fase 0 completada)
- [x] Limpiar/simplificar enfocando en dev tools (Fase 0 completada)
- [ ] Kapso.ai como **channel plugin** en `extensions/kapso/` (no adapter aislado)
- [ ] Mantener Telegram como canal secundario (Fase 7)
- [ ] Claude Code headless como unico LLM (`ClaudeRunner`)
- [ ] Usar multi-agente nativo de OpenClaw para sessions (no SessionManager custom)
- [ ] Focus Model para manejar sesion activa vs background (nuevo, OpenClaw no lo tiene)
- [ ] Jorchfile engine (parser + executor)
- [ ] Command router (/new, /switch, /list, /dev, /test, etc.)
- [ ] Tunnel Manager con Tailscale Serve **unicamente** (sin Cloudflare)
- [ ] Makefile reader por proyecto
- [ ] Aprobaciones via botones de WhatsApp (Kapso) conectados al approval system existente
- [ ] Context window % tracking (extender auto-compaction existente)
- [ ] GUI: extender Control UI existente (puerto 18791), no crear nueva
- [ ] Auth: DM pairing ya existe en OpenClaw, se hereda via channel plugin

### Fase 2 - Expansion

- [ ] TOTP 2FA cada 30 min (encima de DM pairing existente)
- [ ] App movil propia
- [ ] Soporte multi-LLM (Codex, Gemini)
- [ ] Encriptacion de keys at-rest + keychain del OS
- [ ] GUI avanzada (API keys management, analytics)
- [ ] Hot-reload detection + notificacion al chat
- [ ] Screenshots automaticos del preview y envio al chat
- [ ] Soporte de grupos en WP (cuando Kapso lo habilite)

---

## 8. Riesgos

| Riesgo                                     | Probabilidad | Impacto | Mitigacion                                                                                       |
| ------------------------------------------ | ------------ | ------- | ------------------------------------------------------------------------------------------------ |
| Ban de WhatsApp por politica de IA         | Media        | Alto    | Telegram como fallback, posicionar como tool automation no chatbot general, app propia en fase 2 |
| OpenClaw cambia arquitectura drasticamente | Baja         | Medio   | Fork completo nos da independencia                                                               |
| Anthropic bloquea Claude Code headless     | Muy baja     | Alto    | Es uso documentado y soportado oficialmente                                                      |
| Tailscale Funnel restriccion de puertos    | Baja         | Bajo    | Usar Tailscale Serve (sin limite de puertos) como default                                        |
| Kapso.ai cierra o cambia pricing           | Media        | Medio   | SDK permite migrar a Meta Cloud API directo                                                      |
| Ventana de 24h de WP (template messages)   | Alta         | Medio   | Enviar template proactivo cuando sesion lleva mucho tiempo, o migrar flujo critico a Telegram    |

---

## 9. Links y Referencias

### Proyectos base

- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [Claude Code Docs - Headless](https://code.claude.com/docs/en/headless)
- [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview)

### Messaging

- [Kapso.ai](https://kapso.ai/)
- [Kapso Docs](https://docs.kapso.ai)
- [Kapso SDK (npm)](https://www.npmjs.com/package/@kapso/whatsapp-cloud-api)
- [Telegram Bot API](https://core.telegram.org/bots/api)

### Tunneling

- [Tailscale Funnel Docs](https://tailscale.com/kb/1223/funnel)
- [Tailscale Serve Docs](https://tailscale.com/kb/1312/serve)
- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)

### Seguridad

- [OpenClaw Security Issue #11829](https://github.com/openclaw/openclaw/issues/11829)
- [OpenClaw Encrypted Keys Issue #7916](https://github.com/openclaw/openclaw/issues/7916)
- [ClawShell (security proxy)](https://github.com/clawshell/clawshell)

### Competencia

- [claude-code-telegram](https://github.com/RichardAtCT/claude-code-telegram)
- [yottoCode](https://yottocode.com/)
- [LangBot](https://blog.langbot.app/en/posts/deploy-ai-bot-in-5-minutes/)

### Politica WhatsApp + IA

- [Meta bans general-purpose AI chatbots (TechCrunch)](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform/)
- [WhatsApp 2026 AI Policy Explained (Respond.io)](https://respond.io/blog/whatsapp-general-purpose-chatbots-ban)

---

## 10. Modelo de Interaccion (UX en WhatsApp)

El reto principal: WhatsApp es un chat single-threaded. No hay tabs, canales, ni hilos.
Multiples sesiones de Claude Code deben comunicarse por este unico canal.

### 10.1 Session Focus Model

Una sesion esta "enfocada" (activa) a la vez. Las demas estan en "background".

```
SESION ENFOCADA (frontend)          SESIONES EN BACKGROUND (backend, mobile)
- Recibe mensajes libres del user   - NO reciben mensajes libres
- Streaming completo de output      - Solo notificaciones criticas
- Aprobaciones inline               - Aprobaciones con tag de sesion
- Se muestra todo en tiempo real     - Output almacenado en buffer/logs
```

### 10.2 Formato de Mensajes

Todo mensaje de JorchBot lleva prefijo de sesion para que el usuario siempre sepa de donde viene:

**Sesion activa (enfocada)**:

```
[frontend] Leyendo src/components/Login.tsx...
[frontend] Editando src/components/Login.tsx (lineas 23-45)
[frontend] Ejecutando: npm run test
[frontend] ✓ Completado. Context: 23% (47K/200K)
```

**Sesion en background**:

```
[backend] 🔔 Tarea completada. 2 archivos modificados.
[backend] ⚠️ Necesita aprobacion: DELETE node_modules/
           [Aprobar] [Rechazar] [Ver detalles]
[backend] 🔴 Error en pytest: 3 tests fallaron.
```

**Regla**: Las sesiones en background SOLO envian mensajes al chat cuando:

1. Necesitan aprobacion del usuario (con botones)
2. La tarea se completo (resumen)
3. Hay un error
4. Alerta de context window (70%, 90%)

### 10.3 Modos de Operacion

Cada sesion tiene un modo configurable que controla cuanto detalle se muestra y cuanta autonomia tiene Claude Code.

**Cambiar modo desde WP**:

```
/mode plan                → Cambia sesion activa a plan mode
/mode auto                → Cambia sesion activa a auto-accept
/mode confirm             → Cambia sesion activa a confirm (default)
/mode verbose             → Cambia sesion activa a verbose output
/mode silent              → Cambia sesion activa a silent
/mode plan frontend       → Cambia sesion especifica
```

**Modos de aprobacion** (controlan lo que Claude Code puede hacer sin preguntar):

| Modo                | Comportamiento                                                          | Cuando usar                             |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------- |
| `confirm` (default) | Cada accion pide aprobacion via boton                                   | Cuando quieres control total            |
| `plan`              | Claude planifica primero, muestra plan, espera aprobacion para ejecutar | Cuando quieres revisar antes de cambios |
| `auto`              | Auto-aprueba todo. Claude ejecuta sin preguntar                         | Cuando confias y quieres velocidad      |

**Modos de output** (controlan cuanto feedback recibes):

| Modo                | Comportamiento                                                 | Cuando usar                               |
| ------------------- | -------------------------------------------------------------- | ----------------------------------------- |
| `verbose` (default) | Muestra cada accion: archivo leido, editado, comando ejecutado | Quieres estar pendiente de todo           |
| `summary`           | Solo muestra: inicio, resultado final, errores                 | Estas ocupado pero quieres saber que pasa |
| `silent`            | Solo muestra: aprobaciones necesarias y resultado final        | Estas en reunion, no quieres spam         |

**Los modos se combinan**: `confirm + verbose` es el default mas detallado. `auto + silent` es el modo mas autonomo.

**Cambiar modos es instantaneo y reversible**:

```
/mode auto          → activa auto-accept
/mode confirm       → vuelve a pedir aprobacion
/mode silent        → deja de enviar detalles
/mode verbose       → vuelve a enviar todo
```

### 10.4 Flujo de Aprobacion (Botones Kapso)

Cuando Claude Code pide permiso para ejecutar algo, JorchBot envia un **interactive message** de Kapso con botones:

**Mensaje de aprobacion (sesion activa)**:

```
[frontend] Claude quiere ejecutar:
> Bash: rm -rf node_modules && npm install

[Aprobar] [Rechazar] [Ver contexto]
```

**Si el user toca "Ver contexto"**: JorchBot envia un segundo mensaje con el contexto completo (que archivo se esta editando, el diff, el razonamiento de Claude), y luego re-envia los botones:

```
[frontend] Contexto:
Claude detecto que package-lock.json esta corrupto.
Plan: eliminar node_modules, reinstalar dependencias.
Archivos afectados: node_modules/ (eliminar), package-lock.json (regenerar)

[Aprobar] [Rechazar]
```

**Si el user toca "Aprobar"**: JorchBot envia la aprobacion a Claude Code y continua.
**Si el user toca "Rechazar"**: JorchBot envia el rechazo y Claude Code busca alternativa.

**Aprobacion desde sesion en background**:

```
[backend] 🔔 Necesita aprobacion:
> Edit: src/models/user.py (lineas 12-30)
> Cambio: agregar validacion de email

[Aprobar backend] [Rechazar backend] [Ver contexto]
```

Los botones llevan internamente el ID de la sesion + accion, asi JorchBot sabe exactamente a que sesion y accion corresponde la respuesta, sin importar que sesion esta enfocada.

### 10.5 Diferenciacion entre Sesiones

**Problema**: Si estoy en la sesion frontend y la sesion backend me responde algo, como lo diferencio?

**Solucion**: Prefijo + emoji de estado + background tag

```
[frontend] Editando Login.tsx...              ← sesion activa, output normal
[backend] 🔔 Tarea completada (background)    ← sesion background, notificacion
[backend] ⚠️ Necesita aprobacion (background)  ← sesion background, accion requerida
[mobile] 🔴 Error en build (background)        ← sesion background, error
```

**Regla de no-contaminacion**: Los mensajes de background NO interrumpen el flujo de la sesion activa. Se envian como mensajes separados, pero siempre tagueados. El usuario puede:

- Ignorarlos (si esta concentrado en frontend)
- Tocar un boton de aprobacion sin cambiar de sesion
- Hacer `/switch backend` para ver el output completo

### 10.6 Como ver output de sesiones en background

El output completo de cada sesion se almacena en un buffer interno. Para acceder:

```
/logs backend              → Ultimos 20 mensajes de la sesion backend
/logs backend 50           → Ultimos 50 mensajes
/logs backend full         → Envia log completo como documento (PDF/TXT)
/replay backend            → Re-envia la ultima accion completa de backend
/history                   → Resumen de todas las sesiones con ultimas acciones
```

Tambien accesible desde la **GUI web** (via Tailscale Serve) en tiempo real con scroll infinito y busqueda.

### 10.7 Flujo Completo Multi-Sesion (Ejemplo)

```
User: /new frontend
Bot:  [frontend] ✓ Sesion creada
      Path: ~/projects/my-app/frontend
      Mode: confirm + verbose
      Context: 0%

User: /new backend
Bot:  [backend] ✓ Sesion creada
      Path: ~/projects/my-app/backend
      Mode: confirm + verbose
      Context: 0%
      Nota: sesion "frontend" sigue activa en background

User: /switch frontend
Bot:  [frontend] ✓ Sesion enfocada
      Context: 0%

User: arregla el formulario de login, el email no se valida
Bot:  [frontend] Analizando src/components/Login.tsx...
      [frontend] Encontre el problema en linea 34: falta regex de validacion
      [frontend] Claude quiere ejecutar:
      > Edit: src/components/Login.tsx (lineas 34-42)
      > Agregar validacion de email con regex
      [Aprobar] [Rechazar] [Ver contexto]

User: *toca Aprobar*
Bot:  [frontend] ✓ Editado src/components/Login.tsx
      [frontend] Ejecutando: npm run test
      [frontend] ✓ 24/24 tests pasaron
      [frontend] ✓ Completado. Context: 12%

      [backend] 🔔 (background) Claude termino de analizar el schema.
      Necesita aprobacion:
      > Edit: src/models/user.py (agregar campo email_verified)
      [Aprobar backend] [Rechazar backend] [Ver contexto]

User: *toca Aprobar backend*  ← no cambio de sesion, sigue en frontend
Bot:  [backend] ✓ Aprobado (background). Ejecutando...

User: /mode auto
Bot:  [frontend] ✓ Modo cambiado a auto-accept
      Claude ejecutara sin pedir aprobacion.

User: ahora agrega validacion de password
Bot:  [frontend] Analizando...
      [frontend] Editado src/components/Login.tsx (lineas 45-67)
      [frontend] Editado src/utils/validation.ts (nuevo archivo)
      [frontend] Ejecutando: npm run test
      [frontend] ✓ 26/26 tests pasaron
      [frontend] ✓ Completado. Context: 18%

User: /mode confirm
Bot:  [frontend] ✓ Modo cambiado a confirm
      Claude volvera a pedir aprobacion.

User: /list
Bot:  Sesiones activas:
      ● frontend (enfocada) - Context: 18% - Mode: confirm+verbose
      ○ backend (background) - Context: 8% - Mode: confirm+verbose

User: /logs backend
Bot:  [backend] Ultimos mensajes:
      1. Analizo schema de base de datos
      2. Edito src/models/user.py (campo email_verified)
      3. Ejecuto: python manage.py makemigrations
      4. ✓ Migracion creada: 0024_add_email_verified.py
      Context: 8%
```

### 10.8 Comandos Completos

**Sesiones**:
| Comando | Accion |
|---------|--------|
| `/new <project>` | Crea sesion Claude Code para el proyecto del Jorchfile |
| `/switch <project>` | Cambia sesion enfocada |
| `/list` | Lista sesiones activas con % context y modo |
| `/stop <project>` | Detiene sesion de Claude Code |
| `/compact <project>` | Compacta contexto de Claude Code |
| `/logs <project> [n]` | Ve ultimos n mensajes de una sesion |
| `/replay <project>` | Re-envia ultima accion completa |
| `/history` | Resumen de todas las sesiones |

**Modos**:
| Comando | Accion |
|---------|--------|
| `/mode plan [project]` | Claude planifica antes de ejecutar |
| `/mode auto [project]` | Auto-aprueba todo |
| `/mode confirm [project]` | Pide aprobacion por accion (default) |
| `/mode verbose [project]` | Output detallado (default) |
| `/mode summary [project]` | Solo resumen + errores |
| `/mode silent [project]` | Solo aprobaciones + resultado final |

**Proyecto (Jorchfile)**:
| Comando | Accion |
|---------|--------|
| `/dev <project>` | Levanta dev server + tunnel + envia URL |
| `/test <project>` | Ejecuta tests |
| `/build <project>` | Ejecuta build |
| `/tunnel <project>` | Solo levanta tunnel y envia URL |
| `/make <target>` | Ejecuta target del Makefile del proyecto activo |
| `/<custom> <project>` | Ejecuta comando custom del Jorchfile |

**Sistema**:
| Comando | Accion |
|---------|--------|
| `/status` | Estado general: sesiones, tunnels, context % |
| `/help` | Lista de comandos |
| `/gui` | Envia URL de la GUI de configuracion |

**Mensajes libres**: Cualquier texto sin `/` se envia como prompt a Claude Code en la sesion enfocada.

### 10.9 Jorchfile - Campo `approve`

Se agrega campo `approve` al Jorchfile para configurar el modo default por proyecto:

```makefile
PROJECT frontend
  path = ~/projects/my-app/frontend
  dev = npm run dev
  approve = confirm
  output = verbose
  instructions = Experto en React/Next.js

PROJECT scripts
  path = ~/projects/automation
  approve = auto
  output = silent
  instructions = Scripts de automatizacion. Ejecuta sin preguntar.
```

El usuario siempre puede override con `/mode` en cualquier momento.

---

## 11. Decisiones Tecnicas

### 11.1 Lenguaje de Programacion

**TypeScript** — sin discusion.

Razones:

- OpenClaw (nuestra base) es ~85% TypeScript
- Kapso SDK es TypeScript: `@kapso/whatsapp-cloud-api`
- Claude Agent SDK tiene version TypeScript: `@anthropic-ai/claude-agent-sdk`
- gramY (Telegram) es TypeScript
- El ecosistema completo ya esta en TypeScript
- Runtime: **Node.js >= 22** (como OpenClaw)
- Package manager: **pnpm** (como OpenClaw, monorepo)

### 11.2 Pricing de Kapso / WhatsApp (Analisis completo)

**Conclusion: El costo para JorchBot es $0-25/mes en la mayoria de casos.**

**Modelo de cobro de Meta (desde julio 2025)**:
Meta cobra por **mensaje template entregado**, NO por conversacion. Pero:

- **Service messages (usuario inicia + respuestas dentro de 24h) = GRATIS, sin limite**
- Utility templates dentro de la ventana de 24h = GRATIS (desde abril 2025)
- Marketing templates = $0.0305/msg (Mexico)
- Authentication templates = $0.0085/msg (Mexico)

**Para JorchBot el costo de Meta es $0** porque:

1. El usuario SIEMPRE inicia la conversacion (abre ventana de 24h)
2. JorchBot responde dentro de la ventana (service messages = gratis)
3. JorchBot no envia marketing ni authentication templates
4. Cada mensaje nuevo del usuario reinicia la ventana de 24h

**Kapso cobra SEPARADO de Meta** (por uso de plataforma):

| Plan     | Costo | Mensajes/mes | Nota                       |
| -------- | ----- | ------------ | -------------------------- |
| Free     | $0    | 2,000        | Inbound + outbound cuentan |
| Pro      | $25   | 100,000      | ~10,000 conversaciones     |
| Platform | $299  | 1,000,000    | Para uso intensivo         |

**Costo total realista**:

| Uso    | Conversaciones/mes | Kapso | Meta | Total       |
| ------ | ------------------ | ----- | ---- | ----------- |
| Light  | ~100               | $0    | $0   | **$0/mes**  |
| Medium | ~500               | $25   | $0   | **$25/mes** |
| Heavy  | ~5,000             | $25   | $0   | **$25/mes** |

**Unico escenario donde Meta cobra**: Si JorchBot necesita re-enganchar al usuario DESPUES de 24h sin actividad (requiere template message). Solucion: enviar template proactivo tipo "Tu sesion X sigue activa. Responde para continuar." Esto reabre la ventana.

### 11.3 Base de Datos

**Decision: SQLite con better-sqlite3 + Drizzle ORM**

Razones:

- SQLite es la herramienta correcta para app local self-hosted single-instance
- ACID transactions (no se corrompe en crash)
- Queries SQL completos (filtrar logs por fecha, contar mensajes, buscar texto)
- Un solo archivo `.db` = backup trivial (copiar un archivo)
- Footprint < 1MB
- OpenClaw usa JSONL para logs + JSON para config, pero JorchBot necesita queries mas complejas

**Stack**:

- **Driver**: `better-sqlite3` (el mas rapido y maduro para Node.js)
- **ORM**: `Drizzle ORM` (ligero, type-safe, SQL-first, soporte nativo de SQLite)
- **Migraciones**: `drizzle-kit` (genera SQL versionable)

**Schema inicial**:

```typescript
// Sesiones/Workspaces
sessions: {
  id: text (PK),
  project: text,           // nombre del PROJECT en Jorchfile
  path: text,              // directorio del proyecto
  claudeSessionId: text,   // session_id de Claude Code (nullable)
  mode: text,              // confirm|plan|auto
  output: text,            // verbose|summary|silent
  contextPercent: integer,  // % de context window usado
  status: text,            // active|stopped|error
  focused: boolean,        // es la sesion enfocada?
  createdAt: timestamp,
  updatedAt: timestamp
}

// Logs de mensajes
messages: {
  id: integer (PK, autoincrement),
  sessionId: text (FK),
  direction: text,          // inbound|outbound|system
  type: text,               // text|approval|command|error|notification
  content: text,            // contenido del mensaje
  metadata: text (JSON),    // datos extra (diff, action_id, etc.)
  createdAt: timestamp
}

// Tunnels activos
tunnels: {
  id: text (PK),
  sessionId: text (FK),
  port: integer,
  assignedPort: integer,    // puerto asignado por Tailscale
  url: text,                // URL publica generada
  provider: text,           // tailscale|cloudflare
  status: text,             // active|stopped|error
  createdAt: timestamp
}

// Aprobaciones pendientes
approvals: {
  id: text (PK),
  sessionId: text (FK),
  action: text,             // descripcion de la accion
  context: text,            // contexto completo (diff, razonamiento)
  status: text,             // pending|approved|rejected|expired
  createdAt: timestamp,
  resolvedAt: timestamp
}
```

### 11.4 Retencion de Logs

**Politica por defecto** (configurable en GUI o Jorchfile):

| Tipo                       | Retencion default | Razon                                             |
| -------------------------- | ----------------- | ------------------------------------------------- |
| Session messages (verbose) | 7 dias            | Ocupan mas espacio, raramente consultados despues |
| Session summaries          | 30 dias           | Util para tracking de progreso                    |
| Errors                     | 90 dias           | Debugging y patterns                              |
| Approvals                  | 30 dias           | Auditoria                                         |
| Tunnel logs                | 7 dias            | Efimeros                                          |

**Configurable en Jorchfile global**:

```makefile
SETTINGS
  log_retention_days = 7
  summary_retention_days = 30
  error_retention_days = 90
  db_max_size_mb = 500
```

**Cleanup automatico**: Cron job diario que purga registros vencidos. Si la DB supera `db_max_size_mb`, purga los mas antiguos primero.

**Export**: `/logs <project> full` envia un documento TXT/JSON con todo el historial antes de que se purgue.

---

## 12. Manejo de Mensajes Largos (Limite 4096 chars)

### Problema

Claude Code puede generar output de miles de caracteres (diffs largos, output de tests, etc.) pero WhatsApp limita a 4,096 caracteres por mensaje.

### Estrategia de Chunking

**Nivel 1 - Smart Split (default)**:
JorchBot divide el output respetando limites logicos:

1. Nunca corta en medio de un bloque de codigo
2. Divide por lineas vacias o secciones naturales
3. Cada chunk tiene header: `[frontend] (1/3)`, `[frontend] (2/3)`, etc.
4. Maximo 3 chunks seguidos para no spamear

**Nivel 2 - Truncate + Document (output largo)**:
Si el output supera 3 chunks (~12K chars):

1. Envia resumen truncado (primer chunk)
2. Envia el output completo como **documento adjunto** (TXT)
3. Mensaje: `[frontend] Output largo (45KB). Resumen arriba, completo en documento adjunto.`

**Nivel 3 - Streaming Batched (modo verbose en tiempo real)**:
Para output en streaming (ej: npm install con muchas lineas):

1. Acumula output en buffer de 3 segundos
2. Envia batch cada 3 segundos (si hay contenido nuevo)
3. Respeta limite de 4096 por batch
4. Al final envia resumen con resultado

**Nivel 4 - Solo resultado (modo summary/silent)**:
Solo envia el resultado final (exito/error + resumen corto). Todo lo demas va a logs.

### Ejemplo practico

```
User: npm run test

-- Si output < 4096 chars --
[frontend] npm run test
✓ 24/24 tests passed (3.2s)
Context: 23%

-- Si output es 8000 chars --
[frontend] (1/2) npm run test
PASS src/components/Login.test.tsx
  ✓ renders login form (23ms)
  ✓ validates email (15ms)
  ...

[frontend] (2/2)
PASS src/utils/validation.test.tsx
  ✓ validates password strength (8ms)
✓ 24/24 tests passed (3.2s)
Context: 23%

-- Si output es 50KB (ej: build log) --
[frontend] npm run build
✓ Build completado (12.3s)
Output: 847 lineas. Resumen:
- 23 modules compiled
- Bundle size: 1.2MB
- 0 warnings
📎 Build log completo adjunto
Context: 23%
[documento: build-log-frontend-20260218.txt]
```

---

## 13. Comandos Shell (Workspace, no solo Claude Code)

### Cambio arquitectural

Una sesion NO es solo "una instancia de Claude Code". Es un **workspace completo** donde puedes:

1. Ejecutar Claude Code (para tareas de AI)
2. Ejecutar comandos shell directos (ls, pwd, grep, cat, git, etc.)
3. Ejecutar comandos del Jorchfile/Makefile
4. Navegar el filesystem del proyecto

### Modos de input en una sesion

Cuando escribes en el chat, JorchBot determina que hacer:

```
/comando       → Comando de JorchBot (built-in)
$ comando      → Shell directo en el path del workspace
texto libre    → Se envia a Claude Code
```

**El prefijo `$` activa el modo shell**. Ejecuta el comando directamente en el directorio del proyecto activo y devuelve el output.

### Comandos shell (prefijo $)

```
$ pwd                          → /Users/dev/projects/my-app/frontend
$ ls src/components/           → Login.tsx  Header.tsx  Footer.tsx ...
$ cat src/components/Login.tsx → contenido del archivo (chunked si largo)
$ grep -r "validateEmail" src/ → resultados de busqueda
$ git status                   → estado del repo
$ git log --oneline -5         → ultimos 5 commits
$ npm run test                 → ejecuta tests (output streamed)
$ docker ps                    → containers activos
```

### Shortcuts para comandos frecuentes (sin $)

Para los comandos mas comunes, JorchBot ofrece shortcuts:

| Shortcut                 | Equivalente                  | Accion               |
| ------------------------ | ---------------------------- | -------------------- |
| `/ls [path]`             | `$ ls [path]`                | Lista archivos       |
| `/cat <file>`            | `$ cat <file>`               | Lee archivo          |
| `/grep <pattern> [path]` | `$ grep -r <pattern> [path]` | Busca en archivos    |
| `/pwd`                   | `$ pwd`                      | Directorio actual    |
| `/git <cmd>`             | `$ git <cmd>`                | Operaciones git      |
| `/tree [depth]`          | `$ tree -L [depth]`          | Arbol de directorios |

### Ejemplo de flujo mixto (Claude + Shell)

```
User: /new frontend
Bot:  [frontend] ✓ Workspace creado
      Path: ~/projects/my-app/frontend

User: /ls src/components/
Bot:  [frontend] $ ls src/components/
      Login.tsx  Header.tsx  Footer.tsx  index.ts

User: /cat src/components/Login.tsx
Bot:  [frontend] $ cat src/components/Login.tsx
      (contenido del archivo...)

User: arregla la validacion del email en ese componente
Bot:  [frontend] (Claude Code) Analizando Login.tsx...
      [frontend] Claude quiere editar Login.tsx (lineas 34-42)
      [Aprobar] [Rechazar] [Ver contexto]

User: *toca Aprobar*
Bot:  [frontend] ✓ Editado Login.tsx

User: $ git diff
Bot:  [frontend] $ git diff
      (muestra el diff del cambio que hizo Claude)

User: $ git add . && git commit -m "fix email validation"
Bot:  [frontend] $ git add . && git commit -m "fix email validation"
      [main abc1234] fix email validation
      1 file changed, 8 insertions(+), 2 deletions(-)
```

### Seguridad del modo shell

- Los comandos shell se ejecutan con los permisos del usuario que corre JorchBot
- **Comandos peligrosos** (rm -rf /, shutdown, etc.) pasan por el mismo sistema de aprobacion: JorchBot detecta patrones peligrosos y pide confirmacion
- **Sandbox**: Los comandos se ejecutan en el directorio del proyecto, no en root
- El modo shell NO usa Claude Code (no consume tokens de la suscripcion)

---

## 14. Flujo de Aprobacion Detallado (Yes / No / Context)

### El problema

En Claude Code CLI tienes:

- **Tab** → Yes (aprobar)
- **Escribir texto** → Yes + feedback/contexto adicional
- **Esc/n** → No (rechazar)

En WhatsApp no hay Tab ni Esc. Solo tienes botones (max 3) y texto libre.

### Solucion: Botones + texto libre como contexto

Cuando Claude Code pide aprobacion, JorchBot envia un **interactive message** con 3 botones:

```
[frontend] Claude quiere ejecutar:
> Edit: src/components/Login.tsx (lineas 34-42)
> Agregar validacion de email con regex

[Yes] [Yes + feedback] [No]
```

**Flujo segun lo que toca el user**:

#### Boton "Yes" → Aprueba directo

```
User: *toca Yes*
Bot:  [frontend] ✓ Aprobado. Ejecutando...
```

Equivalente a Tab en CLI. Claude continua sin mas.

#### Boton "Yes + feedback" → Aprueba CON instrucciones adicionales

```
User: *toca "Yes + feedback"*
Bot:  [frontend] Escribe tu feedback para Claude:

User: usa zod para la validacion, no regex
Bot:  [frontend] ✓ Aprobado con feedback. Ejecutando...
      Claude recibio: "usa zod para la validacion, no regex"
```

JorchBot entra en **modo escucha**: el siguiente mensaje de texto del usuario
se toma como feedback/contexto y se envia a Claude Code junto con la aprobacion.
Equivalente a escribir texto en CLI en lugar de dar Tab.

#### Boton "No" → Rechaza

```
User: *toca No*
Bot:  [frontend] ✗ Rechazado.

      (Claude busca alternativa o pregunta)
Bot:  [frontend] Claude dice: "Entendido. Quieres que intente
      otra forma de validar el email?"
```

### El cuarto caso: "Ver detalles" via Lista

Para acciones complejas, JorchBot usa una **lista de Kapso** (hasta 10 items) en vez de 3 botones:

```
[frontend] Claude quiere ejecutar 3 acciones:

▼ Ver detalles (toca para expandir lista)
  ┌─────────────────────────────────┐
  │ ✅ Yes - Aprobar todo            │
  │ ✅ Yes + feedback                │
  │ ❌ No - Rechazar todo            │
  │ 👁️ Ver diff completo            │
  │ 👁️ Ver razonamiento de Claude   │
  │ ✅ Aprobar accion 1 solamente    │
  │ ✅ Aprobar accion 2 solamente    │
  │ ❌ Rechazar accion 3 solamente   │
  └─────────────────────────────────┘
```

Las listas de Kapso permiten hasta 10 opciones, lo que nos da granularidad para aprobar/rechazar acciones individuales cuando Claude propone multiples cambios.

### Aprobaciones desde sesiones en background

Los botones siempre llevan metadata interna con `sessionId + actionId`:

```
[backend] 🔔 (background) Claude quiere ejecutar:
> Bash: python manage.py migrate

[Yes backend] [Yes+fb backend] [No backend]
```

Al tocar cualquier boton, JorchBot sabe que va a la sesion `backend` accion `xyz123`.
**No cambia la sesion enfocada.** El user sigue en frontend.

### Flujo completo con feedback (ejemplo real)

```
User: refactoriza el componente Login para usar react-hook-form

Bot:  [frontend] Analizando Login.tsx...
      [frontend] Claude quiere ejecutar:
      > Edit: src/components/Login.tsx (reescribir formulario)
      > Edit: package.json (agregar react-hook-form)
      > Bash: npm install

      [Yes] [Yes + feedback] [No]

User: *toca "Yes + feedback"*

Bot:  [frontend] Escribe tu feedback para Claude:

User: usa tambien yup para el schema de validacion y asegurate de tipar todo con TS

Bot:  [frontend] ✓ Aprobado con feedback.
      Claude recibio:
      "usa tambien yup para el schema de validacion y asegurate de tipar todo con TS"
      Ejecutando...

Bot:  [frontend] Editando Login.tsx...
      [frontend] Editando package.json (react-hook-form + yup + @hookform/resolvers)
      [frontend] Ejecutando: npm install
      [frontend] ✓ 3 archivos modificados. Context: 15%
```

### Timeout de aprobacion

Si el usuario no responde a una aprobacion en **10 minutos** (configurable):

- Sesion activa: re-envia recordatorio
- Sesion background: no spamea, solo marca como "pendiente" en `/list`

Si no responde en **1 hora**: Claude Code se pausa, se notifica al user:

```
[frontend] ⏸️ Sesion pausada por timeout de aprobacion.
Responde a la aprobacion pendiente o escribe /resume frontend
```

---

## 15. Networking: Tailscale Serve (Privado) + Reverse Proxy

### Filosofia: NADA expuesto a internet por defecto

Tailscale no es solo Funnel (publico). Es una **VPN mesh** (tailnet) donde todos los
dispositivos del usuario se ven entre si en una red privada. Esto es lo que ya usas
con tu Raspberry Pi.

**Default de JorchBot: Tailscale Serve (PRIVADO)**

- Solo los dispositivos dentro del tailnet pueden acceder
- Tu Mac, tu celular, tu Raspberry — si estan en el tailnet, ven todo
- Ningun tercero en internet puede acceder
- Sin restriccion de puertos (Serve puede exponer CUALQUIER puerto)

**Opcion B: Tailscale Funnel (PUBLICO)** — solo si el user lo pide explicitamente

- Para cuando necesitas compartir con alguien fuera del tailnet
- Requiere confirmacion del usuario
- Limitado a puertos 443, 8443, 10000

### Tailscale Serve: Sin limite de puertos

A diferencia de Funnel, **Tailscale Serve puede exponer cualquier puerto**:

```bash
tailscale serve --bg 3000              # expone localhost:3000 en el tailnet
tailscale serve --bg 3001              # expone localhost:3001 en el tailnet
tailscale serve --bg 8080              # expone localhost:8080 en el tailnet
tailscale serve --bg 19000             # expone localhost:19000 en el tailnet
# Sin limite de puertos!
```

URLs resultantes (solo accesibles dentro del tailnet):

```
https://mi-pc.tailnet.ts.net:3000     ← frontend
https://mi-pc.tailnet.ts.net:3001     ← backend (auto-asignado)
https://mi-pc.tailnet.ts.net:8080     ← api
https://mi-pc.tailnet.ts.net:19000    ← mobile
```

**Esto elimina el problema de los 3 puertos de Funnel.** Con Serve, cada proyecto
tiene su propio puerto, sin limite.

### Conflicto de puertos LOCALES (dos apps en port 3000)

**Problema real**: Si frontend y backend ambos hacen `npm run dev` y ambos
quieren el puerto 3000 local, el segundo falla.

**Solucion: Auto-discovery de puerto**

JorchBot tiene un **Port Manager** que:

1. **Antes de ejecutar `dev`**: Verifica si el puerto esta ocupado

```typescript
// Pseudocodigo
async function findAvailablePort(desired: number): Promise<number> {
  if (await isPortFree(desired)) return desired;
  // Auto-increment hasta encontrar uno libre
  for (let port = desired + 1; port < desired + 100; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found near ${desired}`);
}
```

2. **Inyecta la variable de entorno PORT**: La mayoria de frameworks respetan `PORT`:

```bash
# En vez de ejecutar directamente:
npm run dev

# JorchBot ejecuta:
PORT=3001 npm run dev
```

Frameworks que respetan `PORT` automaticamente:

- Next.js (`next dev -p $PORT`)
- Vite (`--port $PORT`)
- Express (si usa `process.env.PORT`)
- Django (`runserver 0.0.0.0:$PORT`)
- Flask (`--port $PORT`)

3. **Si el framework no respeta PORT**: JorchBot parsea el comando del Jorchfile
   y reemplaza el puerto. Ejemplo:

```makefile
PROJECT backend
  dev = python manage.py runserver 0.0.0.0:3000
```

JorchBot detecta `:3000` en el comando y lo reemplaza por `:3001` si 3000 esta ocupado.

4. **Notifica al usuario**:

```
[backend] ⚠️ Puerto 3000 ocupado (usado por frontend).
[backend] ✓ Dev server corriendo en localhost:3001 (auto-asignado)
[backend] ✓ Tunnel activo (privado, tailnet only):
            https://mi-pc.tailnet.ts.net:3001
```

### Opcion publica con Reverse Proxy (path-based routing)

Si el usuario QUIERE exponer algo a internet (Funnel), y tiene multiples proyectos,
se usa **path-based routing** con un reverse proxy integrado:

```
Tailscale Funnel (puerto 443) → JorchBot Reverse Proxy
  /frontend  → localhost:3000
  /backend   → localhost:3001
  /mobile    → localhost:19000
  /gui       → localhost:18789 (GUI de JorchBot)
```

**Configuracion en GUI**: El usuario configura las rutas desde la GUI web.
Internamente JorchBot levanta un proxy HTTP simple (un server Node.js con `http-proxy`).

**URL resultante publica**:

```
https://mi-pc.tailnet.ts.net/frontend   → proyecto frontend
https://mi-pc.tailnet.ts.net/backend    → proyecto backend
https://mi-pc.tailnet.ts.net/gui        → GUI de configuracion
```

**Pero esto es OPCIONAL.** El default es Tailscale Serve (privado, puertos directos).

### Jorchfile actualizado con opciones de tunnel

```makefile
PROJECT frontend
  path = ~/projects/my-app/frontend
  dev = npm run dev
  port = 3000
  tunnel = serve                       # default: privado (tailnet only)
  instructions = Experto en React/Next.js

PROJECT backend
  path = ~/projects/my-app/backend
  dev = python manage.py runserver
  port = 8000
  tunnel = serve                       # privado

PROJECT shared-demo
  path = ~/projects/demo
  dev = npm run dev
  port = 5000
  tunnel = funnel                      # publico (internet) - requiere confirmacion
  funnel_path = /demo                  # path en el reverse proxy
```

Campos nuevos:

- `port`: Puerto local deseado (si esta ocupado, auto-increment)
- `tunnel = serve` (default): Solo accesible dentro del tailnet
- `tunnel = funnel`: Publico via Funnel (pide confirmacion)
- `funnel_path`: Path en el reverse proxy para Funnel (opcional)

### Comando /tunnels actualizado

```
User: /tunnels
Bot:  Tunnels activos:
      PRIVADOS (tailnet only):
      1. frontend → https://mi-pc.tailnet.ts.net:3000  (Serve)
      2. backend  → https://mi-pc.tailnet.ts.net:3001  (Serve, auto-port)
      3. gui      → https://mi-pc.tailnet.ts.net:18789 (Serve)

      PUBLICOS (internet):
      4. demo     → https://mi-pc.tailnet.ts.net/demo  (Funnel + proxy)
```

### Resumen de networking

| Modo                | Acceso               | Puertos                  | Cuando usar                             |
| ------------------- | -------------------- | ------------------------ | --------------------------------------- |
| **Serve** (default) | Solo tailnet         | Ilimitados               | Desarrollo personal, default seguro     |
| **Funnel**          | Internet publico     | 443, 8443, 10000         | Compartir con externos, demos           |
| **Funnel + proxy**  | Internet publico     | 1 puerto Funnel, N paths | Multiples proyectos publicos            |
| ~~Cloudflare~~      | ~~Internet publico~~ | ~~Cualquiera~~           | **ELIMINADO (rev. 2)** — solo Tailscale |

---

## 16. Resumen de Decisiones Tecnicas

| Aspecto                | Decision                                       | Razon                                          |
| ---------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Lenguaje               | TypeScript                                     | Base OpenClaw + ecosistema completo en TS      |
| Runtime                | Node.js >= 22                                  | Compatibilidad con OpenClaw                    |
| Package Manager        | pnpm                                           | Monorepo, como OpenClaw                        |
| Base de datos          | SQLite (better-sqlite3 + Drizzle ORM)          | Local-first, ACID, queries SQL, backup trivial |
| WhatsApp               | Kapso.ai (API oficial Meta)                    | Botones, listas, estable, $0-25/mes            |
| Telegram               | gramY                                          | Ya integrado en OpenClaw                       |
| Tunneling default      | Tailscale Serve (PRIVADO)                      | Solo tailnet, sin limite de puertos, seguro    |
| Tunneling publico      | Tailscale Funnel + reverse proxy               | Cuando se necesita acceso externo              |
| ~~Tunneling fallback~~ | ~~Cloudflare Quick Tunnel~~                    | **ELIMINADO (rev. 2)** — solo Tailscale        |
| Mensajes largos        | Smart split + documento adjunto                | Respetar 4096 chars sin perder info            |
| Sesiones               | Workspaces (Claude + Shell + Jorchfile)        | No solo AI, tambien comandos directos          |
| Port conflicts         | Auto-discovery + PORT env var                  | Auto-increment si puerto ocupado               |
| Logs                   | SQLite con retencion configurable (7-90 dias)  | Queryable, purgable, exportable                |
| Shell mode             | Prefijo `$` + shortcuts `/ls`, `/cat`, `/grep` | Acceso directo sin consumir tokens             |
| Aprobaciones           | 3 botones: Yes / Yes+feedback / No             | Replica Tab/texto/Esc del CLI                  |
| Aprobaciones complejas | Listas Kapso (hasta 10 items)                  | Aprobar/rechazar acciones individuales         |

---

## 17. Analisis DeepWiki: Lo que OpenClaw ya tiene (rev. 2)

> **Fuente**: https://deepwiki.com/openclaw/openclaw
> **Fecha**: 2026-02-18
> **Impacto**: Alto — cambia la estrategia de construccion de JorchBot

### 17.1 Hallazgo principal

OpenClaw es mucho mas completo de lo que el research original capturaba.
Muchas features que JorchBot planeaba construir from scratch **ya existen** en OpenClaw.

**Estrategia revisada**: JorchBot debe **extender** OpenClaw, no reconstruir encima.

```
ANTES (plan original):
  OpenClaw (limpio) → SessionManager custom → CommandRouter custom → ApprovalManager custom
  = Reconstruir 60% de lo que ya existe

DESPUES (plan revisado):
  OpenClaw (tal cual) → reemplazar Pi Agent con ClaudeRunner → Kapso como plugin → Focus Model
  = Construir 30% nuevo, reusar 70%
```

### 17.2 Dos capas — no confundir

```
CAPA 1: OpenClaw (ya existe, no reconstruir)
  - Message routing pipeline (webhook → normalize → route → session → respond)
  - Session management (keys, JSONL transcripts, write locking, queue mgmt)
  - Multi-agent CRUD (agents.list/create/update/delete)
  - DM pairing / access control (4 politicas: pairing, allowlist, open, disabled)
  - Tool approval system (exec.ask: off/on-miss/always)
  - Auto-compaction (sessions.compact)
  - Message chunking (textLimit por canal, 4096 default)
  - Service management (launchd/systemd/schtasks)
  - Control UI (puerto basePort+2)
  - Plugin SDK (channel/tool/memory/provider slots)
  - Memory system (SQLite + embeddings + BM25)
  - Config validation (Zod + JSON5)
  - Health monitoring (__openclaw__/health)

CAPA 2: JorchBot (lo nuevo, construir esto)
  - ClaudeRunner: Claude Code headless como subprocess (claude -p --output-format stream-json)
  - Kapso Channel Plugin: WhatsApp via API oficial con botones/listas
  - Focus Model: sesion enfocada vs background (OpenClaw no tiene concepto de "focus")
  - Jorchfile Engine: config por proyecto con comandos predefinidos
  - Tunnel Manager: Tailscale Serve auto + URL al chat
  - Interactive approvals: botones de Kapso conectados al approval system de Claude Code
```

### 17.3 Impacto por fase

**Fase 0 (Foundation)**: Cambio menor

- Quitar Cloudflare del schema de tunnels y de la config
- El resto del trabajo ya hecho es valido

**Fase 1 (WhatsApp + Single Session)**: Cambio medio

- Kapso debe ser un **channel plugin** en `extensions/kapso/` usando Plugin SDK
- NO crear adapter aislado en `src/channels/kapso/`
- Hereda gratis: DM pairing, message chunking, access control, message flow pipeline
- El `ClaudeRunner` sigue igual (Claude Code como subprocess)

**Fase 2 (Multi-Session)**: Cambio alto

- Usar multi-agente nativo de OpenClaw (`agents.create/update/delete`)
- NO crear SessionManager from scratch
- Cada proyecto JorchBot = un agente OpenClaw con workspace configurado
- Solo agregar: Focus Model (cual agente esta enfocado) + ClaudeRunner como backend
- Session write locking y queue management ya resueltos
- ShellRunner puede usar `exec` tool de OpenClaw (tiene BashProcessRegistry, timeouts, signal handling)

**Fase 3 (Jorchfile)**: Cambio medio

- El campo `instructions` del Jorchfile se solapa con Skills de OpenClaw
- Considerar: Jorchfile genera Skills dinamicamente (SKILL.md por proyecto)

**Fase 4 (Tunnels)**: Simplificacion

- Solo Tailscale (Serve y Funnel). Sin Cloudflare, sin reverse proxy
- OpenClaw ya tiene `gateway.bind: "tailnet"` — reusar deteccion de Tailscale

**Fase 5 (UX Advanced)**: Simplificacion

- Auto-compaction ya existe (sessions.compact RPC)
- Tool approval ya existe (exec.ask modes)
- Solo conectar estos sistemas con botones de Kapso

**Fase 6 (GUI)**: Cambio alto

- Extender Control UI existente (puerto 18791), NO crear GUI nueva
- OpenClaw ya sirve assets estaticos desde el Gateway

**Fase 8 (Security)**: Simplificacion

- Tool policy cascade de 6 niveles ya existe
- DM pairing ya protege contra acceso no autorizado
- TOTP 2FA se agrega como capa extra encima del pairing

### 17.4 Comandos de JorchBot — todos se mantienen

Los comandos que planificamos (/new, /switch, /list, /stop, etc.) **siguen siendo los mismos**.
Lo que cambia es la plomeria interna:

| Comando                | Internamente (antes)              | Internamente (despues)                  |
| ---------------------- | --------------------------------- | --------------------------------------- |
| `/new frontend ~/path` | `SessionManager.create()` custom  | `agents.create()` RPC + `ClaudeRunner`  |
| `/switch frontend`     | `SessionManager.focus()` custom   | Actualiza Focus Model                   |
| `/list`                | Query a SQLite custom             | `agents.list()` RPC + Focus Model       |
| `/stop frontend`       | `SessionManager.destroy()` custom | Mata `ClaudeRunner` + `agents.delete()` |
| `/compact frontend`    | Claude Code `--compact`           | `sessions.compact` RPC                  |
| `/status`              | Custom                            | `gateway.health` + `gateway.status` RPC |
| `$ ls src/`            | `ShellRunner` custom              | `exec` tool de OpenClaw                 |
| texto libre            | `ClaudeRunner.resume()`           | `ClaudeRunner.resume()` (sin cambio)    |

### 17.5 DM Pairing — como funciona

OpenClaw incluye un sistema de autenticacion por DM que JorchBot hereda gratis:

```
1. Desconocido manda mensaje a tu numero de WhatsApp
2. JorchBot detecta que NO esta en el allowlist
3. Genera codigo de 6 digitos (ej: 847293)
4. Responde al desconocido: "Tu codigo es: 847293. Pide al dueño que lo apruebe."
5. TU (el dueño) apruebas: jorchbot pairing approve 847293
6. El remitente se agrega al allowlist automaticamente
7. A partir de ahora puede hablar con JorchBot
```

4 politicas configurables:

- `pairing` (default): codigo + aprobacion manual
- `allowlist`: solo numeros explicitamente listados
- `open`: cualquiera (peligroso, solo para pruebas)
- `disabled`: ignora todos los DMs

Config: `channels.kapso.dmPolicy: "pairing"` + `allowFrom: ["+521234567890"]`

### 17.6 Decisions revisadas (rev. 2)

| Aspecto                | Decision original               | Decision revisada                            | Razon                                                      |
| ---------------------- | ------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Tunneling fallback     | Cloudflare Quick Tunnel         | **Eliminado**                                | Solo Tailscale                                             |
| Kapso adapter          | `src/channels/kapso/adapter.ts` | `extensions/kapso/` (channel plugin)         | Hereda DM pairing, chunking, access control                |
| Session Manager        | Custom from scratch             | Usa multi-agente nativo de OpenClaw          | Write locking, queue mgmt ya resueltos                     |
| Shell Runner           | Custom `child_process.exec`     | Considerar `exec` tool de OpenClaw           | BashProcessRegistry ya tiene timeouts, signals             |
| GUI                    | Custom desde cero               | Extender Control UI existente                | Ya existe en puerto 18791                                  |
| Auto-compaction        | Implementar manual              | Usar `sessions.compact` RPC                  | Ya existe                                                  |
| Config format          | JSON custom                     | JSON (JorchBot) convive con JSON5 (OpenClaw) | Ambos sistemas coexisten                                   |
| DB conflict con Memory | No considerado                  | Convivencia: SQLite separados                | OpenClaw SQLite para search, JorchBot SQLite para metadata |
