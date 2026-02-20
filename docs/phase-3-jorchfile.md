# Fase 3 - Jorchfile Engine

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Ultima actualizacion**: 2026-02-19 (rev. 1 — review completo)
> **Entregable**: Archivo de configuracion por proyecto con comandos predefinidos, background tasks, auto-port, tunnel basico, Makefile reader
> **Al terminar**: `/dev frontend` levanta el server en bg con port auto + tunnel, `/test backend` corre tests, `/new frontend` inyecta instructions, `/tasks` lista procesos en bg, `/stop-cmd frontend dev` mata el dev server

---

## Objetivo

Implementar el Jorchfile: un archivo de configuracion estilo Makefile que define
proyectos, sus comandos, instrucciones para Claude Code, configuracion de ports,
tunnels, y modos. Los comandos del Jorchfile son **shortcuts dinamicos por proyecto**
que ejecutan shell commands o Claude Code commands en background.

---

## Decisiones Clave (rev. 1 — 2026-02-19)

| Aspecto            | Decision                                                                                  | Razon                                                     |
| ------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Formato            | Makefile-like custom                                                                      | Diferenciador UX — se siente como herramienta de dev      |
| Multi-linea        | Backslash continuation (`\`) + file reference (`@path`)                                   | Soporta instrucciones largas sin romper el formato        |
| Config             | Unified JSON5 (`jorchbot.json`). SETTINGS del Jorchfile **tiene prioridad** como override | Un solo archivo de config. Jorchfile es mas especifico    |
| Comandos           | Dinamicos per-project. Son shortcuts de shell o claude commands                           | Cada proyecto define sus propios comandos                 |
| Background         | Long-running commands corren en bg. `/tasks` lista, `/stop-cmd` mata                      | `/dev` no debe bloquear el chat                           |
| Port               | Auto-management: detecta puerto libre, inyecta `PORT` env var                             | Evita conflictos cuando multiples proyectos corren        |
| Tunnel             | Basico: `tailscale serve <port>` cuando `tunnel = serve`                                  | Complementa `/dev` para acceso via tailnet                |
| Hot-reload         | Detecta cambios en Jorchfile. **Mata sesiones** de proyectos modificados                  | Evita estado inconsistente                                |
| `/new` + Jorchfile | Si el nombre del proyecto existe en Jorchfile, su config tiene prioridad                  | Jorchfile es la fuente de verdad para proyectos definidos |
| Sin sesion activa  | `/dev frontend` auto-crea sesion si no existe                                             | Menos friccion, el usuario no necesita `/new` primero     |
| Prioridad          | built-in > Jorchfile > shell shortcuts (Phase 2) > Makefile                               | Jorchfile commands ganan sobre `/ls`, `/cat`, etc.        |

---

## Entregables

1. Error classes para Phase 3 (`src/errors/index.ts`)
2. Jorchfile parser con soporte multi-linea (`src/jorchfile/parser.ts`)
3. Jorchfile executor con background execution (`src/jorchfile/executor.ts`)
4. Background Task Manager con `/tasks` y `/stop-cmd` (`src/jorchfile/task-manager.ts`)
5. Port auto-management (`src/jorchfile/port-manager.ts`)
6. Tunnel basico — Tailscale Serve/Funnel (`src/jorchfile/tunnel.ts`)
7. Integracion con Session Manager (auto-path, auto-instructions, auto-session)
8. Makefile reader (`src/jorchfile/makefile-reader.ts`)
9. Comando `/projects` para listar proyectos definidos
10. Hot-reload del Jorchfile con kill de sesiones afectadas
11. Command priority registration en CommandRouter

---

## Tareas

### 3.0 Error Classes

- [ ] Agregar a `src/errors/index.ts`:
  - `JorchfileParseError` — Syntax errors en el Jorchfile
  - `JorchfileValidationError` — Campos requeridos faltantes (ej: `path`)
  - `JorchfileProjectNotFoundError` — Proyecto no encontrado en Jorchfile
  - `JorchfileCommandNotFoundError` — Comando no encontrado para un proyecto
  - `MakefileReadError` — No se pudo leer/parsear un Makefile
  - `BackgroundTaskStartError` — Tarea de background no pudo iniciar
  - `BackgroundTaskNotFoundError` — Tarea de background no encontrada por PID o nombre
- [ ] Todas extienden `JorchBotError`
- [ ] Verify: `pnpm check` clean

**Criterio de aceptacion**: 7 nuevas error classes exportadas desde `src/errors/index.ts`.

### 3.1 Jorchfile Parser

- [ ] Crear `src/jorchfile/parser.ts`
- [ ] Ubicacion del archivo: `~/.jorchbot/Jorchfile`
- [ ] Parsear formato Makefile-like:

```makefile
# Comentarios con #

PROJECT frontend
  path = ~/projects/my-app/frontend
  dev = npm run dev
  build = npm run build
  test = npm run test
  lint = npm run lint
  port = 3000
  tunnel = serve
  approve = confirm
  output = verbose
  instructions = Eres experto en React y Next.js. \
    Usa App Router con TypeScript. \
    Sigue las convenciones del proyecto.

PROJECT backend
  path = ~/projects/my-app/backend
  dev = python manage.py runserver
  test = pytest
  migrate = python manage.py migrate
  port = 8000
  tunnel = serve
  approve = confirm
  output = verbose
  instructions = @./backend-instructions.md

SETTINGS
  log_retention_days = 7
  summary_retention_days = 30
  error_retention_days = 90
  db_max_size_mb = 500
```

**Reglas del parser**:

- `PROJECT <name>` inicia un bloque de proyecto
- `SETTINGS` inicia el bloque de configuracion global
- Indentacion con 2 espacios indica campo del bloque
- `key = value` es un campo
- Campos reservados: `path`, `port`, `tunnel`, `funnel_path`, `approve`, `output`, `instructions`
- Cualquier otro campo es un **comando custom** ejecutable (shortcut de shell)
- Lineas en blanco y `#` comentarios se ignoran

**Multi-linea** (dos mecanismos):

1. **Backslash continuation**: Lineas que terminan con `\` continuan en la siguiente.
   Las lineas de continuacion se trimean y unen con espacio.

```makefile
  instructions = Eres experto en React y Next.js. \
    Usa App Router con TypeScript. \
    Sigue las convenciones del proyecto.
  # → "Eres experto en React y Next.js. Usa App Router con TypeScript. Sigue las convenciones del proyecto."
```

2. **File reference**: Valores que empiezan con `@` se tratan como paths relativos
   al directorio del proyecto (campo `path`) o absolutos.

```makefile
  instructions = @./INSTRUCTIONS.md
  # → Lee el contenido de ~/projects/my-app/frontend/INSTRUCTIONS.md
```

**SETTINGS como override**: Los campos de SETTINGS sobreescriben los valores
correspondientes en `jorchbot.json` → `jorchbot.db`. El Jorchfile es mas especifico
y tiene prioridad. Mapeo:

| SETTINGS field           | jorchbot.json path                 | Default |
| ------------------------ | ---------------------------------- | ------- |
| `log_retention_days`     | `jorchbot.db.retentionDays`        | 7       |
| `summary_retention_days` | `jorchbot.db.summaryRetentionDays` | 30      |
| `error_retention_days`   | `jorchbot.db.errorRetentionDays`   | 90      |
| `db_max_size_mb`         | `jorchbot.db.maxSizeMb`            | 500     |

```typescript
// src/jorchfile/parser.ts
interface JorchProject {
  name: string;
  path: string;
  port?: number;
  tunnel?: "serve" | "funnel";
  funnelPath?: string;
  approve?: "confirm" | "plan" | "auto";
  output?: "verbose" | "summary" | "silent";
  instructions?: string;
  commands: Record<string, string>; // { dev: "npm run dev", test: "pytest", migrate: "python manage.py migrate" }
}

interface JorchSettings {
  logRetentionDays?: number;
  summaryRetentionDays?: number;
  errorRetentionDays?: number;
  dbMaxSizeMb?: number;
}

interface Jorchfile {
  projects: JorchProject[];
  settings: JorchSettings;
}

export function parseJorchfile(content: string): Jorchfile;
```

- [ ] Validar campos requeridos (`path` es obligatorio por proyecto)
- [ ] Expandir `~` a home directory
- [ ] Validar que path existe (warning si no, no error fatal)
- [ ] Resolver `@path` en campo `instructions` leyendo el archivo
- [ ] Parsear backslash continuations
- [ ] Lanzar `JorchfileParseError` en syntax errors
- [ ] Lanzar `JorchfileValidationError` en campos faltantes
- [ ] Tests unitarios del parser (formato basico, multi-linea, @file, SETTINGS, errores)

**Criterio de aceptacion**: Parser lee el Jorchfile con multi-linea y file references, produce un objeto `Jorchfile` estructurado.

### 3.2 Jorchfile Executor

- [ ] Crear `src/jorchfile/executor.ts`
- [ ] Registrar comandos del Jorchfile **dinamicamente** en el CommandRouter
- [ ] Cada `/<command> [project]` ejecuta el comando definido en el Jorchfile para ese proyecto
- [ ] Comandos son **per-project** — cada proyecto tiene sus propios shortcuts

**Logica de resolucion**:

1. Si se da proyecto: `/<cmd> <project>` → ejecuta en ese proyecto
2. Si no se da proyecto: `/<cmd>` → ejecuta en la sesion enfocada
3. Si no hay sesion enfocada → error con mensaje claro
4. Si el proyecto no tiene sesion activa → **auto-crea sesion** (como si fuera `/new <project>`)

```
/dev frontend         → ejecuta "npm run dev" en ~/projects/my-app/frontend (bg)
/test                 → ejecuta "pytest" en el workspace enfocado (foreground)
/migrate backend      → ejecuta "python manage.py migrate" en backend (foreground)
/lint frontend        → ejecuta "npm run lint" en frontend (foreground)
```

**Foreground vs Background**:

- Comandos `dev` y `build` se ejecutan en **background** por defecto (long-running)
- El resto se ejecuta en **foreground** (output directo al chat)
- El usuario puede forzar background con `&`: `/test frontend &`
- Foreground commands usan ShellRunner (de Phase 2) con output chunked al chat

**Criterio de aceptacion**: `/dev frontend` ejecuta el comando en bg, `/test backend` ejecuta en foreground. Auto-crea sesion si no existe.

### 3.3 Background Task Manager

- [ ] Crear `src/jorchfile/task-manager.ts`
- [ ] Registrar cada proceso background con: PID, project, command name, start time, status
- [ ] Almacenar en memoria (no en DB — son efimeros)

**Comandos nuevos**:

| Comando                     | Accion                                                                   |
| --------------------------- | ------------------------------------------------------------------------ |
| `/tasks`                    | Lista todos los procesos en background con PID, project, command, uptime |
| `/stop-cmd <project> <cmd>` | Mata el proceso background de un comando especifico                      |
| `/stop-cmd <project>`       | Mata TODOS los procesos background del proyecto                          |

```
User: /tasks
Bot:  Background tasks:
      PID    Project    Command   Uptime     Port
      12345  frontend   dev       2h 15m     3000
      12389  backend    dev       45m        8001
      12401  frontend   build     2m         -

User: /stop-cmd frontend dev
Bot:  [frontend] ✓ Stopped "dev" (PID 12345)
      Tunnel closed: https://mi-pc.tailnet.ts.net:3000

User: /stop-cmd backend
Bot:  [backend] ✓ Stopped 1 background task(s)
```

- [ ] Cleanup automatico: cuando un proceso termina (exit), removerlo de la lista
- [ ] Al destruir una sesion (`/stop <project>`), matar todos sus background tasks
- [ ] Enviar output de background tasks a logs (accesible via `/logs`)
- [ ] Enviar notificacion al chat cuando un background task termina o falla:

```
[frontend] 🔔 Background task "build" finished (exit 0, 3m 22s)
[backend] 🔴 Background task "dev" crashed (exit 1). Use /logs backend to see output.
```

**Criterio de aceptacion**: `/tasks` lista procesos bg, `/stop-cmd frontend dev` mata un proceso especifico.

### 3.4 Port Auto-Management

- [ ] Crear `src/jorchfile/port-manager.ts`
- [ ] Antes de ejecutar un comando `dev`, verificar si el puerto esta libre
- [ ] Si el puerto definido en `port` esta ocupado, auto-increment hasta encontrar uno libre
- [ ] Inyectar `PORT` como variable de entorno al ejecutar el comando

```typescript
async function findAvailablePort(desired: number): Promise<number> {
  if (await isPortFree(desired)) return desired;
  for (let port = desired + 1; port < desired + 100; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found near ${desired}`);
}
```

**Ejecucion**:

```bash
# En vez de ejecutar directamente:
npm run dev

# JorchBot ejecuta:
PORT=3001 npm run dev
```

- [ ] Notificar al usuario si el puerto cambio:

```
[backend] ⚠️ Puerto 3000 ocupado (usado por frontend).
[backend] ✓ Dev server corriendo en localhost:3001 (auto-asignado)
```

- [ ] Registrar el puerto asignado en el Task Manager (visible en `/tasks`)
- [ ] Frameworks que respetan `PORT` automaticamente: Next.js, Vite, Express, Django, Flask
- [ ] Si el Jorchfile no define `port`, no hacer port management (ejecutar tal cual)

**Criterio de aceptacion**: `/dev backend` cuando port 3000 esta ocupado, auto-asigna 3001, notifica, y muestra en `/tasks`.

### 3.5 Tunnel Basico (Tailscale Serve/Funnel)

- [ ] Crear `src/jorchfile/tunnel.ts`
- [ ] Cuando un comando `dev` se ejecuta y el proyecto tiene `tunnel = serve`:
  1. Detectar el puerto asignado (del Port Manager)
  2. Ejecutar `tailscale serve --bg <port>`
  3. Enviar URL al chat: `https://<device>.<tailnet>.ts.net:<port>`
- [ ] Cuando `tunnel = funnel`:
  1. Ejecutar `tailscale funnel --bg <port>`
  2. Pedir confirmacion al usuario antes (Funnel es publico)
  3. Enviar URL al chat
- [ ] `funnel_path` se reserva para Phase 4 (reverse proxy multi-proyecto)
- [ ] Cuando `/stop-cmd` mata un dev server, cerrar el tunnel asociado:
  - `tailscale serve off <port>`
- [ ] Si Tailscale no esta instalado, warning claro (no error fatal)

```
User: /dev frontend
Bot:  [frontend] ✓ Dev server corriendo en localhost:3000 (bg, PID 12345)
      [frontend] ✓ Tunnel activo (tailnet only):
                   https://mi-pc.tailnet.ts.net:3000

User: /stop-cmd frontend dev
Bot:  [frontend] ✓ Stopped "dev" (PID 12345)
      [frontend] ✓ Tunnel closed: https://mi-pc.tailnet.ts.net:3000
```

> **NOTA**: Esta es la integracion basica de tunnels. Phase 4 agrega: `/tunnels` command
> (listar todos), reverse proxy path-based para Funnel, gestion avanzada de lifecycle,
> y robustez en edge cases.

**Criterio de aceptacion**: `/dev frontend` con `tunnel = serve` levanta Tailscale Serve y envia URL al chat. `/stop-cmd` cierra el tunnel.

### 3.6 Integracion con Session Manager

Cuando el usuario ejecuta `/new <project>` o un comando del Jorchfile para un proyecto sin sesion:

1. Session Manager busca `PROJECT <project>` en el Jorchfile
2. Si existe en Jorchfile → **config del Jorchfile tiene prioridad**:
   - Usa el `path` del Jorchfile
   - Inyecta `instructions` como system prompt
   - Aplica `approve` y `output` como modos default
3. Si no existe en Jorchfile → crea sesion a demanda:
   - Pide path al usuario
   - Crea sesion sin instructions, con modos default

- [ ] Modificar `/new` para buscar en Jorchfile primero
- [ ] Si path del Jorchfile no existe en disco, lanzar error claro
- [ ] Si ya hay sesion activa para ese proyecto, preguntar si quiere otra o reusar
- [ ] **Auto-create**: Cuando se ejecuta `/<cmd> <project>` y no hay sesion, crearla automaticamente usando config del Jorchfile

**Flujos**:

```
User: /new frontend
Bot:  [frontend] ✓ Workspace creado (desde Jorchfile)
      Path: ~/projects/my-app/frontend
      Mode: confirm + verbose
      Instructions: "Eres experto en React y Next.js..."
      Context: 0%

User: /new random-project
Bot:  "random-project" no esta en el Jorchfile.
      Escribe el path del proyecto:

User: ~/projects/experiments/random
Bot:  [random-project] ✓ Workspace creado
      Path: ~/projects/experiments/random
      Mode: confirm + verbose (default)
      Context: 0%

User: /dev frontend    (sin sesion previa)
Bot:  [frontend] ✓ Workspace auto-created (desde Jorchfile)
      Path: ~/projects/my-app/frontend
      [frontend] ✓ Dev server corriendo en localhost:3000 (bg, PID 12345)
      [frontend] ✓ Tunnel: https://mi-pc.tailnet.ts.net:3000
```

**Criterio de aceptacion**: `/new frontend` usa config del Jorchfile. `/dev frontend` sin sesion la crea automaticamente.

### 3.7 Makefile Reader

- [ ] Crear `src/jorchfile/makefile-reader.ts`
- [ ] Al entrar a un workspace, detectar si existe `Makefile` en el path
- [ ] Parsear targets del Makefile (solo nombres, no contenido)
- [ ] Registrar targets como comandos ejecutables via `/make <target>`
- [ ] Listar targets con `/make` (sin argumento)

```
User: /make
Bot:  [frontend] Targets del Makefile:
      - deploy
      - clean
      - docker-build
      - docker-run

User: /make deploy
Bot:  [frontend] $ make deploy
      (output del comando...)
```

- [ ] Lanzar `MakefileReadError` si el Makefile tiene errores de sintaxis
- [ ] Si no hay Makefile, `/make` responde: "No Makefile found in this workspace"

**Criterio de aceptacion**: `/make deploy` ejecuta `make deploy` en el directorio del workspace.

### 3.8 Comando /projects

- [ ] Lista todos los proyectos definidos en el Jorchfile
- [ ] Muestra sus comandos disponibles
- [ ] Indica cuales tienen sesion activa
- [ ] Indica cuales tienen background tasks corriendo

```
User: /projects
Bot:  Proyectos en Jorchfile:
      1. frontend (~/projects/my-app/frontend)
         Comandos: dev, build, test, lint
         Sesion: ● activa (enfocada, 18%)
         Tasks: dev (PID 12345, port 3000)

      2. backend (~/projects/my-app/backend)
         Comandos: dev, test, migrate
         Sesion: ○ activa (background, 8%)
         Tasks: -

      3. mobile (~/projects/my-app/mobile)
         Comandos: dev
         Sesion: sin sesion
         Tasks: -
```

**Criterio de aceptacion**: `/projects` lista todos los proyectos con estado de sesion y background tasks.

### 3.9 Hot-reload del Jorchfile

- [ ] Detectar cambios en `~/.jorchbot/Jorchfile` (file watcher: `fs.watch` o chokidar)
- [ ] Re-parsear automaticamente
- [ ] Notificar al user: `"Jorchfile actualizado. 3 proyectos cargados."`
- [ ] **Si un proyecto con sesion activa fue modificado**: matar la sesion de ese proyecto
  - Matar todos sus background tasks
  - Cerrar tunnels asociados
  - Notificar: `[frontend] ⚠️ Jorchfile changed. Session destroyed. Use /new frontend to recreate.`
- [ ] Si un proyecto fue eliminado del Jorchfile: misma logica (kill session + notify)
- [ ] Si un proyecto nuevo fue agregado: solo notificar, no crear sesion
- [ ] Re-registrar comandos en CommandRouter

**Criterio de aceptacion**: Editar el Jorchfile mata sesiones de proyectos afectados y recarga comandos.

### 3.10 Command Priority en CommandRouter

- [ ] Modificar `src/commands/router.ts` para soportar comandos registrados dinamicamente
- [ ] Implementar jerarquia de prioridad:

```
1. Built-in JorchBot commands  → /new, /switch, /list, /stop, /tasks, /stop-cmd,
                                  /compact, /logs, /status, /help, /projects, /make
2. Jorchfile project commands  → /dev, /test, /build, /lint, /migrate, /<custom>
3. Phase 2 shell shortcuts     → /ls, /cat, /grep, /pwd, /git, /tree
4. Makefile targets            → /make <target>
5. Free text                   → Claude Code session
```

- [ ] Si un Jorchfile command tiene el mismo nombre que un shell shortcut, Jorchfile gana
- [ ] Si un Jorchfile command tiene el mismo nombre que un Makefile target, Jorchfile gana
- [ ] Para forzar Makefile: `/make <target>`
- [ ] Documentar conflictos en `/help`

**Criterio de aceptacion**: Jorchfile `/test` tiene prioridad sobre un hipotetico shell shortcut. `/make` siempre ejecuta Makefile.

---

## Comandos Nuevos (resumen)

| Comando                     | Accion                                                       |
| --------------------------- | ------------------------------------------------------------ |
| `/projects`                 | Lista proyectos del Jorchfile con estado                     |
| `/tasks`                    | Lista background tasks (PID, project, command, port, uptime) |
| `/stop-cmd <project> <cmd>` | Mata un background task especifico                           |
| `/stop-cmd <project>`       | Mata TODOS los background tasks del proyecto                 |
| `/make [target]`            | Lista o ejecuta targets del Makefile                         |
| `/<custom> [project]`       | Ejecuta comando custom del Jorchfile                         |

---

## NO se construye en esta fase

- `/tunnels` command completo (Phase 4)
- Reverse proxy path-based para Funnel multi-proyecto (Phase 4)
- Tunnel lifecycle management avanzado (Phase 4)
- `/replay`, `/history` commands (Phase 5)
- Modos plan/auto/silent via `/mode` (Phase 5)
- "Yes + feedback" en aprobaciones (Phase 5)
- Listas Kapso para aprobaciones complejas (Phase 5)

---

## Nota sobre Skills de OpenClaw (rev. 2)

> **Overlap con Skills**: El campo `instructions` del Jorchfile se solapa con el
> sistema de Skills de OpenClaw. Las Skills proveen guia de lenguaje natural para
> tools (documentacion inyectada al prompt), con discovery por workspace/agent/bundled.
>
> **Considerar**: En vez de inyectar `instructions` como `--append-system-prompt`,
> el Jorchfile Engine podria generar **Skills dinamicamente** (un `SKILL.md` temporal
> por proyecto) que se inyectan via el sistema de Skills existente. Esto permitiria:
>
> - Reusar el discovery system de OpenClaw
> - Combinar instructions del Jorchfile con Skills del workspace
> - Variables de entorno por skill (`skills.entries[skillName].env`)
>
> **Decision**: Implementar `--append-system-prompt` primero (simple). Evaluar migracion
> a Skills en una iteracion futura si los beneficios lo justifican.

---

## Definicion de "Terminado"

- [ ] Error classes para Phase 3 exportadas desde `src/errors/index.ts`
- [ ] Jorchfile parser funciona con formato definido (multi-linea, @file, SETTINGS)
- [ ] `/dev frontend` ejecuta en bg con auto-port + tunnel serve
- [ ] `/test backend` ejecuta en foreground con output chunked
- [ ] `/new frontend` usa path e instructions del Jorchfile
- [ ] `/dev frontend` sin sesion previa auto-crea sesion
- [ ] `/tasks` lista procesos background con PID, project, command, port, uptime
- [ ] `/stop-cmd frontend dev` mata el proceso y cierra tunnel
- [ ] `/make deploy` ejecuta target del Makefile
- [ ] `/projects` lista proyectos con estado de sesion y tasks
- [ ] Jorchfile hot-reload mata sesiones de proyectos afectados
- [ ] Jorchfile commands tienen prioridad sobre shell shortcuts de Phase 2
- [ ] SETTINGS del Jorchfile sobreescriben defaults de `jorchbot.json`
- [ ] Errores de parsing son claros y utiles
- [ ] Tests pasan, CI en verde
