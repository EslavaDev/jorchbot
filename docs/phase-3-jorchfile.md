# Fase 3 - Jorchfile Engine

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Archivo de configuracion por proyecto con comandos predefinidos + Makefile reader
> **Al terminar**: `/dev frontend` levanta el server, `/test backend` corre tests, `/new frontend` inyecta instructions

---

## Objetivo

Implementar el Jorchfile: un archivo de configuracion estilo Makefile que define
proyectos, sus comandos, instrucciones para Claude Code, y configuracion de
tunnels y modos.

---

## Entregables

1. Jorchfile parser (lee formato INI/Makefile)
2. Jorchfile executor (ejecuta comandos predefinidos)
3. Integration con Session Manager (auto-path, auto-instructions)
4. Makefile reader (detecta y ejecuta targets del Makefile del proyecto)
5. Comando `/projects` para listar proyectos definidos
6. Validacion y errores claros del Jorchfile

---

## Tareas

### 3.1 Jorchfile Parser

- [ ] Crear `src/jorchfile/parser.ts`
- [ ] Ubicacion del archivo: `~/.jorchbot/Jorchfile`
- [ ] Parsear formato:

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
  instructions = Eres experto en React y Next.js. Usa App Router con TypeScript.

PROJECT backend
  path = ~/projects/my-app/backend
  dev = python manage.py runserver
  test = pytest
  migrate = python manage.py migrate
  port = 8000
  tunnel = serve
  approve = confirm
  output = verbose
  instructions = Backend Django con PostgreSQL. Sigue PEP8. Usa type hints.

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
- Campos reservados: `path`, `port`, `tunnel`, `approve`, `output`, `instructions`
- Cualquier otro campo es un **comando custom** ejecutable

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
  commands: Record<string, string>; // { dev: "npm run dev", test: "pytest", ... }
}

interface JorchSettings {
  logRetentionDays: number;
  summaryRetentionDays: number;
  errorRetentionDays: number;
  dbMaxSizeMb: number;
}

interface Jorchfile {
  projects: JorchProject[];
  settings: JorchSettings;
}

export function parseJorchfile(content: string): Jorchfile;
```

- [ ] Validar campos requeridos (path es obligatorio)
- [ ] Expandir `~` a home directory
- [ ] Validar que path existe (warning si no)
- [ ] Tests unitarios del parser

**Criterio de aceptacion**: Parser lee el Jorchfile y produce un objeto estructurado.

### 3.2 Jorchfile Executor

- [ ] Crear `src/jorchfile/executor.ts`
- [ ] Registrar comandos del Jorchfile en el command router
- [ ] `/<command> [project]` ejecuta el comando del proyecto

**Logica de resolucion**:

1. Si se da proyecto: `/<cmd> <project>` → ejecuta en ese proyecto
2. Si no se da proyecto: `/<cmd>` → ejecuta en la sesion enfocada
3. Si no hay sesion enfocada → error

```
/dev frontend         → ejecuta "npm run dev" en ~/projects/my-app/frontend
/test                 → ejecuta "pytest" en el workspace enfocado (si es backend)
/migrate backend      → ejecuta "python manage.py migrate" en backend
/lint frontend        → ejecuta "npm run lint" en frontend
```

- [ ] Ejecutar con ShellRunner (de fase 2) en el path del proyecto
- [ ] Output al chat (chunked si necesario)
- [ ] Background execution para long-running (dev, build)

**Criterio de aceptacion**: `/dev frontend` ejecuta el comando definido en el Jorchfile.

### 3.3 Integracion con Session Manager

Cuando el usuario crea una sesion con `/new <project>`:

1. Session Manager busca `PROJECT <project>` en el Jorchfile
2. Si existe:
   - Usa el `path` del Jorchfile
   - Inyecta `instructions` como system prompt
   - Aplica `approve` y `output` como modos default
3. Si no existe:
   - Pide path al usuario
   - Crea sesion sin instructions

- [ ] Modificar `/new` para buscar en Jorchfile primero
- [ ] Si path del Jorchfile no existe, error claro
- [ ] Si ya hay sesion activa para ese proyecto, preguntar si quiere otra

**Flujo**:

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
```

**Criterio de aceptacion**: `/new frontend` usa automaticamente path e instructions del Jorchfile.

### 3.4 Makefile Reader

- [ ] Crear `src/jorchfile/makefile-reader.ts`
- [ ] Al entrar a un workspace, detectar si existe `Makefile` en el path
- [ ] Parsear targets del Makefile (nombres, no el contenido)
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

**Jerarquia de comandos** (prioridad):

1. Comandos built-in de JorchBot (`/new`, `/switch`, `/list`, etc.)
2. Comandos del Jorchfile (`/dev`, `/test`, etc.)
3. Comandos del Makefile (`/make <target>`)

Si un comando del Jorchfile y un target del Makefile tienen el mismo nombre,
el Jorchfile gana. Para forzar Makefile: `/make <target>`.

**Criterio de aceptacion**: `/make deploy` ejecuta `make deploy` en el directorio del workspace.

### 3.5 Comando /projects

- [ ] Lista todos los proyectos definidos en el Jorchfile
- [ ] Muestra sus comandos disponibles
- [ ] Indica cuales tienen sesion activa

```
User: /projects
Bot:  Proyectos en Jorchfile:
      1. frontend (~/projects/my-app/frontend)
         Comandos: dev, build, test, lint
         Sesion: ● activa (enfocada, 18%)

      2. backend (~/projects/my-app/backend)
         Comandos: dev, test, migrate
         Sesion: ○ activa (background, 8%)

      3. mobile (~/projects/my-app/mobile)
         Comandos: dev
         Sesion: sin sesion
```

**Criterio de aceptacion**: `/projects` lista todos los proyectos con estado.

### 3.6 Hot-reload del Jorchfile

- [ ] Detectar cambios en `~/.jorchbot/Jorchfile` (file watcher)
- [ ] Re-parsear automaticamente
- [ ] Notificar al user: `"Jorchfile actualizado. 3 proyectos cargados."`
- [ ] No interrumpir sesiones activas

**Criterio de aceptacion**: Editar el Jorchfile y ver los cambios reflejados sin reiniciar.

---

## Definicion de "Terminado"

- [ ] Jorchfile parser funciona con el formato definido
- [ ] `/dev frontend` ejecuta el comando correcto
- [ ] `/new frontend` usa path e instructions del Jorchfile
- [ ] `/make deploy` ejecuta el target del Makefile
- [ ] `/projects` lista proyectos con estado
- [ ] Jorchfile se recarga automaticamente al editarlo
- [ ] Errores de parsing son claros y utiles
- [ ] Tests pasan, CI en verde
