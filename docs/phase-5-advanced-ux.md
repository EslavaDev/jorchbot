# Fase 5 - UX Avanzado

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Modos de operacion, listas Kapso, smart chunking, Yes+feedback, timeouts
> **Al terminar**: `/mode auto` activa auto-accept, aprobaciones complejas usan listas de 10 items, output largo se envia como documento, "Yes+feedback" permite aprobar con instrucciones adicionales

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> OpenClaw ya tiene:
>
> - **Auto-compaction**: `sessions.compact` RPC — JorchBot lo expone via `/compact`
> - **Tool approval**: `exec.ask` modes (off/on-miss/always) — base para modos confirm/auto
> - **Message chunking**: `textLimit` por canal (4096 default) — base para smart split
>
> **Capa 1 (reusar)**: Auto-compaction, tool approval engine, textLimit.
>
> **Capa 2 (construir)**: Modos de operacion (approval + output), Yes+feedback flow,
> listas Kapso para aprobaciones complejas, smart chunking avanzado, approval timeout,
> streaming batched output.

---

## Objetivo

Implementar las features de UX que hacen que JorchBot sea comodo de usar desde
WhatsApp: modos de operacion configurables, aprobaciones ricas con feedback,
manejo inteligente de mensajes largos, y timeouts de aprobacion.

---

## Entregables

1. Modos de aprobacion: confirm (default), plan, auto
2. Modos de output: verbose (default), summary, silent
3. Comando /mode para cambiar modos en tiempo real
4. Flujo "Yes + feedback" (aprobar con instrucciones adicionales)
5. Listas Kapso para aprobaciones complejas (hasta 10 items)
6. Smart chunking de mensajes largos (4 niveles)
7. Approval timeout con recordatorio y pausa
8. Streaming batched para output en tiempo real

---

## Tareas

### 5.1 Modos de Aprobacion

Cada sesion tiene un modo de aprobacion que controla cuanta autonomia tiene Claude Code.

| Modo                | Comportamiento                                    | `--allowedTools` de Claude Code     |
| ------------------- | ------------------------------------------------- | ----------------------------------- |
| `confirm` (default) | Cada accion pide aprobacion via boton             | Solo Read, Grep, Glob               |
| `plan`              | Claude planifica, muestra plan, espera aprobacion | Solo Read, Grep, Glob               |
| `auto`              | Auto-aprueba todo. Claude ejecuta sin preguntar   | Read, Edit, Write, Bash, Grep, Glob |

```typescript
// src/sessions/jorchbot/modes.ts
type ApprovalMode = "confirm" | "plan" | "auto";
type OutputMode = "verbose" | "summary" | "silent";

interface SessionModes {
  approval: ApprovalMode;
  output: OutputMode;
}
```

- [ ] Agregar columnas `approvalMode` y `outputMode` a tabla `sessions`
- [ ] Default: `confirm` + `verbose`
- [ ] Al crear sesion, leer defaults del Jorchfile (`approve`, `output` fields)
- [ ] Mapear modos a flags de Claude Code:
  - `confirm`: `--allowedTools "Read,Grep,Glob"` (lo demas requiere hooks approval)
  - `plan`: Igual que confirm + `--append-system-prompt "Always create a plan first..."`
  - `auto`: `--dangerously-skip-permissions` o allowedTools completo
- [ ] Cambio de modo NO reinicia la sesion de Claude Code (aplica en el siguiente mensaje)

**Criterio de aceptacion**: Sesion en modo `auto` ejecuta sin pedir aprobacion. Modo `confirm` pide aprobacion para cada Edit/Bash.

### 5.2 Modos de Output

Controlan cuanto detalle recibe el usuario en el chat.

| Modo                | Que se envia al chat                              | Que va solo a logs  |
| ------------------- | ------------------------------------------------- | ------------------- |
| `verbose` (default) | Todo: archivos leidos, editados, comandos, output | Nada (todo visible) |
| `summary`           | Inicio de tarea, resultado final, errores         | Pasos intermedios   |
| `silent`            | Solo aprobaciones necesarias y resultado final    | Todo lo demas       |

- [ ] Implementar `OutputFilter` en `src/sessions/jorchbot/output-filter.ts`
- [ ] Filtrar mensajes segun modo antes de enviar al canal
- [ ] Los mensajes filtrados se guardan en logs (tabla `messages`) siempre
- [ ] Aprobaciones SIEMPRE se envian al chat independientemente del modo
- [ ] Errores SIEMPRE se envian al chat independientemente del modo

```typescript
interface OutputFilter {
  shouldSendToChat(message: SessionMessage, mode: OutputMode): boolean;
}
```

**Criterio de aceptacion**: En modo `silent`, solo se ven aprobaciones y resultado final en el chat. En `/logs`, se ve todo.

### 5.3 Comando /mode

```
/mode <approval|output> [project]
```

| Comando               | Accion                                     |
| --------------------- | ------------------------------------------ |
| `/mode plan`          | Cambia sesion activa a plan mode           |
| `/mode auto`          | Cambia sesion activa a auto-accept         |
| `/mode confirm`       | Cambia sesion activa a confirm (default)   |
| `/mode verbose`       | Cambia sesion activa a verbose output      |
| `/mode summary`       | Cambia sesion activa a solo resumen        |
| `/mode silent`        | Cambia sesion activa a silent              |
| `/mode auto frontend` | Cambia sesion especifica                   |
| `/mode`               | Muestra modos actuales de la sesion activa |

**Flujo**:

```
User: /mode auto
Bot:  [frontend] Modo cambiado a auto-accept.
      Claude ejecutara sin pedir aprobacion.
      Usa /mode confirm para volver al modo normal.

User: /mode silent
Bot:  [frontend] Output cambiado a silent.
      Solo veras aprobaciones y resultado final.

User: /mode
Bot:  [frontend] Modos actuales:
      Aprobacion: auto (Claude ejecuta sin preguntar)
      Output: silent (solo resultado final)
```

- [ ] Registrar `/mode` en CommandRouter
- [ ] Detectar automaticamente si el argumento es approval o output mode
- [ ] Persistir cambio en DB (tabla `sessions`)
- [ ] Enviar confirmacion al chat con descripcion del modo

**Criterio de aceptacion**: `/mode auto` cambia el modo, y el siguiente mensaje a Claude Code se ejecuta sin aprobacion.

### 5.4 Flujo "Yes + feedback"

Replica la funcionalidad de escribir texto en lugar de Tab en Claude Code CLI.
El usuario aprueba Y envia instrucciones adicionales.

**Botones de aprobacion actualizados** (3 botones Kapso):

```
[frontend] Claude quiere ejecutar:
> Edit: src/components/Login.tsx (lineas 34-42)
> Agregar validacion de email con regex

[Yes] [Yes + feedback] [No]
```

**Flujo de "Yes + feedback"**:

```
User: *toca "Yes + feedback"*
Bot:  [frontend] Escribe tu feedback para Claude:

User: usa zod para la validacion, no regex
Bot:  [frontend] Aprobado con feedback.
      Claude recibio: "usa zod para la validacion, no regex"
      Ejecutando...
```

- [ ] Implementar estado `awaiting_feedback` en la sesion
- [ ] Cuando el usuario toca "Yes + feedback":
  1. Sesion entra en modo `awaiting_feedback`
  2. JorchBot envia "Escribe tu feedback para Claude:"
  3. El siguiente mensaje de texto se toma como feedback
  4. Se envia aprobacion + feedback a Claude Code (via stdin del proceso)
  5. Sesion sale de `awaiting_feedback`
- [ ] Si el usuario envia un comando (`/algo`) mientras esta en `awaiting_feedback`:
  - Se cancela el feedback
  - Se ejecuta el comando normalmente
  - La aprobacion queda pendiente
- [ ] Timeout de `awaiting_feedback`: 5 minutos, luego cancelar y re-enviar botones

**Criterio de aceptacion**: "Yes + feedback" permite aprobar con instrucciones que Claude Code recibe y aplica.

### 5.5 Listas Kapso para Aprobaciones Complejas

Cuando Claude Code propone multiples acciones, usar listas de Kapso (hasta 10 items)
en vez de solo 3 botones.

**Trigger**: Claude Code pide aprobacion para 2+ acciones en una sola peticion.

```
[frontend] Claude quiere ejecutar 3 acciones:

1. Edit: src/components/Login.tsx (validacion de email)
2. Edit: package.json (agregar zod)
3. Bash: npm install

Ver opciones (toca para expandir lista)
  +----------------------------------+
  | Yes - Aprobar todo               |
  | Yes + feedback                   |
  | No - Rechazar todo               |
  | Ver diff completo                |
  | Ver razonamiento de Claude       |
  | Aprobar solo accion 1            |
  | Aprobar solo accion 2            |
  | Aprobar solo accion 3            |
  +----------------------------------+
```

- [ ] Detectar cuando la aprobacion involucra multiples acciones
- [ ] Construir lista de Kapso con opciones granulares
- [ ] "Ver diff completo": envia el diff como mensaje adicional, re-envia lista
- [ ] "Ver razonamiento": envia el reasoning de Claude, re-envia lista
- [ ] Aprobacion individual: aprueba solo esa accion, rechaza las demas
- [ ] Mapear seleccion del usuario a respuesta de Claude Code hooks

```typescript
interface ComplexApproval {
  sessionId: string;
  actions: ApprovalAction[];
  kapsoListId: string;
}

interface ApprovalAction {
  id: string;
  tool: string; // "Edit", "Bash", etc.
  description: string;
  details: string; // diff, comando, etc.
}
```

**Criterio de aceptacion**: Aprobacion con 3+ acciones muestra lista Kapso. El usuario puede aprobar acciones individuales.

### 5.6 Smart Chunking de Mensajes Largos

WhatsApp limita a 4,096 caracteres por mensaje. JorchBot maneja esto en 4 niveles.

**Nivel 1 — Smart Split (output < 12K chars)**:

- Divide por lineas vacias o secciones naturales
- Nunca corta en medio de un bloque de codigo
- Header: `[frontend] (1/3)`, `[frontend] (2/3)`, etc.
- Maximo 3 chunks seguidos

**Nivel 2 — Truncate + Document (output > 12K chars)**:

- Envia resumen truncado (primer chunk)
- Envia output completo como documento adjunto (TXT via Kapso)
- `[frontend] Output largo (45KB). Resumen arriba, completo en documento adjunto.`

**Nivel 3 — Streaming Batched (modo verbose, tiempo real)**:

- Acumula output en buffer de 3 segundos
- Envia batch cada 3 segundos (si hay contenido nuevo)
- Respeta limite de 4096 por batch
- Al final envia resumen con resultado

**Nivel 4 — Solo resultado (modo summary/silent)**:

- Solo envia resultado final (exito/error + resumen corto)
- Todo lo demas va a logs

```typescript
// src/channels/kapso/chunker.ts
interface ChunkOptions {
  maxChars: number; // 4096 default
  maxChunks: number; // 3 default
  sessionPrefix: string; // "[frontend]"
  outputMode: OutputMode;
}

interface ChunkResult {
  chunks: string[];
  hasDocument: boolean;
  documentContent?: string;
  documentName?: string;
}

function chunkMessage(content: string, options: ChunkOptions): ChunkResult;
```

- [ ] Implementar `chunkMessage()` con los 4 niveles
- [ ] Respetar bloques de codigo (no cortar dentro de ``` blocks)
- [ ] Respetar limites de linea (no cortar palabras)
- [ ] Generar documento adjunto para output largo (TXT)
- [ ] Enviar documento via API de Kapso (`sendDocument`)
- [ ] Rate limiting: no mas de 5 mensajes/segundo al mismo chat

**Criterio de aceptacion**: Output de 50K chars se envia como resumen + documento adjunto. Output de 8K chars se divide en 2 chunks sin cortar codigo.

### 5.7 Approval Timeout

Si el usuario no responde a una aprobacion, JorchBot gestiona timeouts.

| Tiempo | Accion (sesion activa)            | Accion (sesion background)      |
| ------ | --------------------------------- | ------------------------------- |
| 10 min | Re-envia recordatorio con botones | No spamea, marca como pendiente |
| 1 hora | Pausa la sesion de Claude Code    | Pausa la sesion                 |

```
-- A los 10 minutos (sesion activa) --
[frontend] Recordatorio: aprobacion pendiente hace 10 min.
> Edit: src/components/Login.tsx
[Yes] [Yes + feedback] [No]

-- A la 1 hora --
[frontend] Sesion pausada por timeout de aprobacion.
Responde a la aprobacion pendiente o escribe /resume frontend.
```

- [ ] Timer por aprobacion pendiente (configurable en config.json)
- [ ] `approval_reminder_minutes: 10` (default)
- [ ] `approval_timeout_minutes: 60` (default)
- [ ] Al pausar: detener Claude Code subprocess, mantener session_id
- [ ] `/resume <project>`: re-enviar aprobacion pendiente y reactivar sesion
- [ ] En `/list`, mostrar sesiones con aprobaciones pendientes

```
User: /list
Bot:  Sesiones activas:
      * frontend (enfocada) - Context: 23% - APROBACION PENDIENTE (15 min)
      o backend (background) - Context: 8% - idle
```

**Criterio de aceptacion**: A los 10 min se re-envia recordatorio. A la 1 hora se pausa la sesion.

### 5.8 Streaming Batched

Para output en tiempo real (ej: `npm install` con muchas lineas), enviar
en batches en vez de linea por linea.

- [ ] Buffer de 3 segundos para acumular output de Claude Code
- [ ] Si el buffer tiene contenido al expirar, enviar como un mensaje
- [ ] Respetar limite de 4096 chars por batch
- [ ] Indicador de "escribiendo..." mientras se acumula
- [ ] Al finalizar el comando, flush inmediato del buffer restante

**Criterio de aceptacion**: `npm install` muestra progreso cada 3 segundos en vez de spamear linea por linea.

---

## NO se construye en esta fase

- Aprobaciones parciales de diff (aprobar parte de un archivo) — demasiado complejo
- Voice messages (enviar aprobacion por voz) — fuera de scope
- Reacciones de WhatsApp como shortcuts (ej: thumbs up = approve) — Kapso no lo soporta aun
- Integracion con Telegram (Fase 7 maneja UX de Telegram)

---

## Definicion de "Terminado"

- [ ] Modos `confirm`, `plan`, `auto` funcionan y afectan el comportamiento de Claude Code
- [ ] Modos `verbose`, `summary`, `silent` filtran output correctamente
- [ ] `/mode` cambia modos en tiempo real sin reiniciar sesion
- [ ] "Yes + feedback" permite aprobar con instrucciones
- [ ] Aprobaciones complejas (3+ acciones) usan listas Kapso
- [ ] Output largo se divide en chunks o se envia como documento
- [ ] Streaming batched muestra progreso cada 3 segundos
- [ ] Timeout de aprobacion re-envia a 10 min, pausa a 1 hora
- [ ] Columnas `approvalMode` y `outputMode` persistidas en DB
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- Los modos se combinan: `auto + silent` es el modo mas autonomo. `confirm + verbose` es el default mas detallado.
- El cambio de modo es instantaneo y reversible.
- `plan` mode funciona inyectando instrucciones en el system prompt de Claude Code, NO es un feature nativo del CLI headless.
- Kapso permite maximo 3 botones O 1 lista de hasta 10 items por mensaje interactivo. No ambos.
- El streaming batched debe respetar el rate limit de Kapso (30 msg/s global, pero recomendado <5/s).
- Los documentos adjuntos via Kapso usan `sendDocument` y soportan hasta 100MB.
