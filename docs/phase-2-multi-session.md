# Fase 2 - Workspaces Multi-Sesion

> **Estado**: Pendiente
> **Dependencia**: Fase 1
> **Entregable**: Multiples sesiones de Claude Code + shell directo + focus model
> **Al terminar**: Puedes tener frontend y backend como sesiones separadas, cambiar entre ellas, y ejecutar comandos shell

---

## Objetivo

Convertir la sesion unica de fase 1 en un sistema multi-sesion donde cada sesion
es un **workspace completo** (Claude Code + Shell) con un modelo de enfoque
que maneja la comunicacion por el canal single-threaded de WhatsApp.

---

## Entregables

1. Session Manager (crear, destruir, enfocar, listar sesiones)
2. Focus Model (sesion activa vs background)
3. Shell Runner (ejecutar comandos directos con prefijo `$`)
4. Shortcuts de shell (`/ls`, `/cat`, `/grep`, `/pwd`, `/git`, `/tree`)
5. Logs por sesion (almacenamiento y consulta)
6. Notificaciones de background (aprobaciones, errores, completados)

---

## Tareas

### 2.1 Session Manager

- [ ] Crear `src/sessions/manager.ts`
- [ ] Implementar creacion de sesion (con project name y path)
- [ ] Implementar destruccion de sesion (cleanup de procesos)
- [ ] Implementar focus/switch (cambiar sesion activa)
- [ ] Implementar listing (todas las sesiones con estado)
- [ ] Persistir sesiones en DB (tabla sessions)
- [ ] Restaurar sesiones al reiniciar el Gateway
- [ ] Limite configurable de sesiones simultaneas (default: 5)

```typescript
// src/sessions/manager.ts
export class SessionManager {
  async create(project: string, path: string): Promise<Session>;
  async destroy(sessionId: string): Promise<void>;
  async focus(sessionId: string): Promise<void>;
  async list(): Promise<Session[]>;
  async getFocused(): Promise<Session | null>;
  async getByProject(project: string): Promise<Session | null>;
}
```

**Criterio de aceptacion**: `/new frontend`, `/new backend`, `/switch frontend`, `/list` funcionan.

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

### 2.3 Shell Runner

- [ ] Crear `src/sessions/shell-runner.ts`
- [ ] Detectar prefijo `$` en mensajes entrantes
- [ ] Ejecutar comando en el directorio del workspace activo
- [ ] Capturar stdout + stderr
- [ ] Timeout configurable (default: 30s)
- [ ] Detectar comandos peligrosos (rm -rf, shutdown, etc.) → pedir confirmacion
- [ ] No consumir tokens de Claude (ejecucion directa, no via LLM)

```typescript
// src/sessions/shell-runner.ts
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

### 2.7 Aprobaciones con session routing

Extender el sistema de aprobacion de fase 1 para multi-sesion:

- [ ] Cada boton de aprobacion lleva `sessionId` + `requestId` en metadata
- [ ] Al recibir click en boton, JorchBot extrae sessionId y rutea al proceso correcto
- [ ] Botones de background incluyen nombre: `[Yes backend]` `[No backend]`
- [ ] No cambiar sesion enfocada al responder aprobacion de background

**Criterio de aceptacion**: Aprobar accion de backend sin salir de frontend.

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

- Claude Code headless corre como child process por sesion. Cada sesion es un proceso independiente.
- Shell runner corre comandos via `child_process.exec` con timeout.
- El focus model es un estado en DB (solo una sesion con `focused = true`).
- Los botones de Kapso tienen un payload maximo. El metadata (sessionId + requestId) debe caber en ese payload.
