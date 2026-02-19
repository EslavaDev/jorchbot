# Fase 5 - UX Avanzado

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Modos (plan/auto/confirm), Yes+feedback, listas Kapso, smart chunking
> **Al terminar**: Experiencia pulida comparable al CLI de Claude Code pero desde WhatsApp

---

## Objetivo

Refinar la experiencia de usuario para que sea tan productiva como usar Claude Code
en el CLI. Agregar el flujo de "Yes + feedback", modos de operacion, listas para
aprobaciones complejas, y smart message chunking.

---

## Entregables

1. Flujo completo de aprobacion: Yes / Yes+feedback / No / Ver detalles
2. Modos de aprobacion: confirm, plan, auto
3. Modos de output: verbose, summary, silent
4. Listas de Kapso para aprobaciones multi-accion
5. Smart message chunking (split, truncate, document)
6. Timeout y pause de aprobaciones

---

## Tareas

### 5.1 Flujo "Yes + feedback"

Extender el sistema de aprobacion de fase 1 con el tercer boton:

**Botones por mensaje de aprobacion**:

```
[Yes]  [Yes + feedback]  [No]
```

- [ ] Agregar boton "Yes + feedback" al mensaje de aprobacion
- [ ] Al tocar "Yes + feedback", JorchBot entra en **modo escucha**
- [ ] El siguiente mensaje de texto del user se captura como feedback
- [ ] Se envia a Claude Code como contexto junto con la aprobacion
- [ ] Timeout del modo escucha: 2 minutos (si no escribe, cancela)
- [ ] Indicator visual: `[frontend] ✏️ Esperando tu feedback...`

```
Bot:  [frontend] Claude quiere ejecutar:
      > Edit: src/components/Login.tsx (lineas 34-42)
      > Agregar validacion con regex

      [Yes] [Yes + feedback] [No]

User: *toca "Yes + feedback"*

Bot:  [frontend] ✏️ Escribe tu feedback para Claude:

User: usa zod en vez de regex, y agrega tests unitarios

Bot:  [frontend] ✓ Aprobado con feedback.
      Claude recibio: "usa zod en vez de regex, y agrega tests unitarios"
      Ejecutando...
```

- [ ] Implementar estado `awaiting_feedback` en la sesion
- [ ] Mientras esta en `awaiting_feedback`, los mensajes NO van a Claude directamente
- [ ] Cancelar con `/cancel` o timeout

**Criterio de aceptacion**: "Yes + feedback" funciona end-to-end.

### 5.2 Modos de aprobacion

- [ ] Implementar comando `/mode <mode> [project]`
- [ ] Guardar modo en DB (tabla sessions, campo mode)
- [ ] Aplicar modo al crear sesion desde Jorchfile (`approve = auto`)

**Modo `confirm`** (default):

- Cada tool use de Claude Code genera un mensaje de aprobacion
- Botones: [Yes] [Yes + feedback] [No]
- Mapeo: equivale a `--allowedTools ""` (ninguno pre-aprobado)

**Modo `plan`**:

- Se inyecta `--append-system-prompt "Antes de ejecutar cambios, presenta un plan detallado y espera aprobacion."`
- Claude describe lo que hara ANTES de hacerlo
- Usuario aprueba el plan completo
- Luego Claude ejecuta todo (auto-accept de las acciones individuales del plan aprobado)

**Modo `auto`**:

- Se pasa `--allowedTools "Read,Edit,Bash,Grep,Glob,Write"` (todos pre-aprobados)
- Claude ejecuta sin preguntar
- Output se envia segun output mode
- ADVERTENCIA al activar: `"⚠️ Modo auto activado. Claude ejecutara sin pedir permiso."`

```
User: /mode plan
Bot:  [frontend] ✓ Modo cambiado a: plan
      Claude presentara un plan antes de ejecutar cambios.

User: /mode auto
Bot:  [frontend] ⚠️ Modo cambiado a: auto
      Claude ejecutara SIN pedir permiso.
      Usa /mode confirm para volver al modo seguro.

User: /mode confirm
Bot:  [frontend] ✓ Modo cambiado a: confirm
      Claude pedira aprobacion por cada accion.
```

**Criterio de aceptacion**: Los 3 modos funcionan y afectan el comportamiento de Claude Code.

### 5.3 Modos de output

- [ ] Implementar `/mode verbose|summary|silent [project]`
- [ ] Guardar en DB (campo outputMode)

**Modo `verbose`** (default):

- Cada accion de Claude se reporta: archivo leido, editado, comando ejecutado
- Streaming de output (batched cada 3 segundos)
- Formato: `[frontend] Leyendo src/Login.tsx...`

**Modo `summary`**:

- Solo envia: inicio, resultado final, errores
- No envia acciones intermedias
- Formato: `[frontend] Trabajando...` → `[frontend] ✓ 3 archivos editados. Context: 15%`

**Modo `silent`**:

- Solo envia: aprobaciones pendientes + resultado final
- Ideal cuando estas en reunion
- Formato: (nada durante ejecucion) → `[frontend] ✓ Completado. Context: 15%`

**Combinaciones**:

| Approval          | Output                                 | Resultado               |
| ----------------- | -------------------------------------- | ----------------------- |
| confirm + verbose | Maximo detalle y control               | Default ideal           |
| confirm + summary | Ves poco pero controlas todo           | Para estar semi-atento  |
| plan + verbose    | Ves el plan detallado, luego ejecucion | Para tareas grandes     |
| auto + verbose    | Ves todo pero no apruebas nada         | Confianza + visibilidad |
| auto + silent     | No ves nada, solo resultado            | Maximo autonomia        |

**Criterio de aceptacion**: Cambiar a silent elimina mensajes intermedios.

### 5.4 Listas de Kapso para aprobaciones complejas

Cuando Claude propone multiples acciones, usar **lista interactiva** (hasta 10 items):

```
[frontend] Claude quiere ejecutar 4 acciones:

▼ Selecciona una opcion
  ┌─────────────────────────────────────────────┐
  │ ✅ Aprobar todas (4 acciones)                │
  │ ✅ Aprobar + feedback                        │
  │ ❌ Rechazar todas                            │
  │ ──────────────────────────────                │
  │ 👁️ Ver todas las acciones                    │
  │ 👁️ Ver razonamiento de Claude                │
  │ ──────────────────────────────                │
  │ ✅ Solo: Edit Login.tsx                       │
  │ ✅ Solo: Edit validation.ts                   │
  │ ❌ Skip: Bash npm install                    │
  │ ❌ Skip: Edit package.json                   │
  └─────────────────────────────────────────────┘
```

- [ ] Detectar cuando Claude propone 2+ acciones
- [ ] Generar lista dinamica con cada accion individual
- [ ] Permitir aprobar/rechazar acciones individualmente
- [ ] "Ver todas las acciones" envia detalle de cada una
- [ ] "Ver razonamiento" envia el texto de Claude explicando por que

**Criterio de aceptacion**: Lista interactiva aparece con 2+ acciones de Claude.

### 5.5 Smart Message Chunking

- [ ] Crear `src/messages/chunker.ts`

**Algoritmo de chunking**:

```typescript
export class MessageChunker {
  // Divide un mensaje largo respetando limites logicos
  chunk(content: string, maxLength: number = 4096): string[];

  // Decide la estrategia de envio
  async send(adapter: KapsoAdapter, to: string, sessionTag: string, content: string): Promise<void>;
}
```

**Reglas de splitting**:

1. Si cabe en 1 mensaje (< 4096): enviar directo
2. Si cabe en 2-3 mensajes (< 12288): split inteligente
   - Nunca cortar en medio de un bloque de codigo (```)
   - Preferir cortar en lineas vacias
   - Header en cada chunk: `[frontend] (1/3)`, `(2/3)`, etc.
3. Si es mas largo (> 12288): truncar + adjuntar documento
   - Primer mensaje: resumen (primeras ~3500 chars)
   - Segundo mensaje: documento TXT adjunto con contenido completo

**Criterio de aceptacion**: Output de 50KB se envia como resumen + documento adjunto.

### 5.6 Timeout y pause de aprobaciones

- [ ] Aprobacion pendiente > 10 minutos → re-enviar recordatorio
- [ ] Aprobacion pendiente > 60 minutos → pausar sesion
- [ ] Notificar: `[frontend] ⏸️ Sesion pausada (timeout de aprobacion)`
- [ ] Reanudar con `/resume <project>` o respondiendo a la aprobacion
- [ ] Guardar aprobaciones pendientes en DB (tabla approvals)
- [ ] Al reiniciar Gateway, restaurar aprobaciones pendientes

```
-- 10 minutos sin respuesta --
Bot: [frontend] 🔔 Recordatorio: aprobacion pendiente
     > Edit: Login.tsx (agregar validacion)
     [Yes] [Yes + feedback] [No]

-- 60 minutos sin respuesta --
Bot: [frontend] ⏸️ Sesion pausada por timeout.
     Responde a la aprobacion o escribe /resume frontend
```

**Criterio de aceptacion**: Timeout funciona y la sesion se pausa/reanuda correctamente.

---

## Definicion de "Terminado"

- [ ] "Yes + feedback" funciona end-to-end
- [ ] `/mode plan`, `/mode auto`, `/mode confirm` funcionan
- [ ] `/mode verbose`, `/mode summary`, `/mode silent` funcionan
- [ ] Listas de Kapso aparecen con 2+ acciones
- [ ] Smart chunking divide mensajes correctamente
- [ ] Documentos adjuntos se envian para output largo
- [ ] Timeout + pause funcionan
- [ ] Tests pasan, CI en verde
