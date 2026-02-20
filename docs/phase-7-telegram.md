# Fase 7 - Telegram

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Canal Telegram completo con inline keyboards, code blocks, y file attachments
> **Al terminar**: Puedes usar JorchBot desde Telegram con la misma funcionalidad que WhatsApp, con inline keyboards para aprobaciones y Markdown nativo para codigo

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> OpenClaw ya tiene un adaptador de Telegram basado en **gramY** (grammY).
> Esta deshabilitado en JorchBot Phase 0 pero el codigo existe.
> JorchBot debe reconectar este adaptador y extenderlo con las features
> especificas de JorchBot.
>
> **Capa 1 (reusar)**: Adaptador gramY existente, message flow pipeline,
> DM pairing, session management, message chunking (textLimit).
>
> **Capa 2 (construir)**: Inline keyboards para aprobaciones JorchBot,
> code block formatting, file attachments para output largo,
> session prefix formatting, /mode y /tunnel commands via Telegram,
> mapping de focus model a Telegram.
>
> **Ventaja de Telegram sobre WhatsApp**:
>
> - Sin restricciones de IA (API oficial, gratuita)
> - Markdown/HTML nativo (code blocks reales)
> - Archivos hasta 4GB (vs 100MB en WP)
> - Sin ventana de 24 horas
> - Inline keyboards ilimitados (vs 3 botones en Kapso)

---

## Objetivo

Reconectar y extender el adaptador de Telegram de OpenClaw para que funcione
como canal completo de JorchBot, con todas las features de sesion, aprobacion,
y comandos. Telegram es el canal secundario / fallback cuando WhatsApp no
esta disponible o para usuarios que prefieren Telegram.

---

## Entregables

1. Reconexion del adaptador gramY existente
2. Inline keyboards para aprobaciones (Yes/No/Feedback)
3. Formateo de codigo con Markdown (code blocks reales)
4. File attachments para output largo
5. Todos los comandos JorchBot funcionales en Telegram
6. Focus model mapping (sesion activa/background)
7. DM pairing via Telegram
8. Soporte dual: WhatsApp + Telegram simultaneo

---

## Tareas

### 7.1 Reconectar Adaptador gramY

OpenClaw tiene el adaptador de Telegram en el codebase pero deshabilitado
en JorchBot Phase 0.

- [ ] Auditar el adaptador gramY existente en OpenClaw
- [ ] Re-habilitar en la configuracion del Gateway
- [ ] Verificar que el message flow pipeline funciona (webhook → normalize → route → respond)
- [ ] Configurar webhook URL o long-polling para desarrollo
- [ ] Crear BotFather bot y obtener token
- [ ] Agregar `telegram` a config: `channels.telegram.enabled: true`

```json
// ~/.jorchbot/jorchbot.json (extracto)
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "BOT_TOKEN",
      "dmPolicy": "pairing",
      "allowFrom": ["123456789"]
    }
  }
}
```

**Criterio de aceptacion**: JorchBot recibe mensajes de Telegram y puede responder texto basico.

### 7.2 Inline Keyboards para Aprobaciones

Telegram soporta inline keyboards con botones ilimitados (vs 3 en Kapso).
Esto permite aprobaciones mas ricas.

**Aprobacion simple** (3 botones inline):

```
[frontend] Claude quiere ejecutar:
> Edit: src/components/Login.tsx (lineas 34-42)

[Yes] [Yes + feedback] [No]
```

**Aprobacion compleja** (multiples botones en grid):

```
[frontend] Claude quiere ejecutar 3 acciones:
1. Edit: Login.tsx
2. Edit: package.json
3. Bash: npm install

[Aprobar todo]  [Rechazar todo]
[Yes + feedback]
[Aprobar 1] [Aprobar 2] [Aprobar 3]
[Ver diff]  [Ver razonamiento]
```

- [ ] Implementar `TelegramApprovalKeyboard` builder
- [ ] Mapear callback_data a sessionId + actionId + respuesta
- [ ] Manejar callback queries (responder al boton presionado)
- [ ] Editar mensaje original al resolver aprobacion (marcar como resuelto)
- [ ] Timeout de botones (eliminar keyboard despues de 1 hora)

```typescript
// Ejemplo de inline keyboard
const keyboard = new InlineKeyboard()
  .text("Yes", `approve:${sessionId}:${actionId}:yes`)
  .text("Yes + feedback", `approve:${sessionId}:${actionId}:feedback`)
  .text("No", `approve:${sessionId}:${actionId}:no`)
  .row()
  .text("Ver diff", `approve:${sessionId}:${actionId}:diff`);
```

**Criterio de aceptacion**: Aprobaciones en Telegram usan inline keyboards. Al presionar "Yes", Claude Code continua.

### 7.3 Formateo de Codigo (Markdown/HTML)

Telegram soporta Markdown y HTML nativamente. Aprovechar esto para code blocks reales.

**Ventaja sobre WhatsApp**: En WP el codigo se envia como texto plano.
En Telegram se puede enviar con syntax highlighting real.

- [ ] Detectar bloques de codigo en output de Claude Code
- [ ] Envolver en ` ```language ... ``` ` de Telegram Markdown
- [ ] Soportar MarkdownV2 (requiere escapar caracteres especiales)
- [ ] Fallback a HTML si MarkdownV2 falla (caracteres problematicos)
- [ ] Diffs con formato monospace
- [ ] Inline code para nombres de archivos y comandos

````
[frontend] Editado src/components/Login.tsx:

```typescript
// Linea 34-42
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailRegex.test(email)) {
  setError("Email invalido");
  return;
}
````

Context: 23%

```

- [ ] Escapar caracteres especiales de MarkdownV2: `_*[]()~>#+-=|{}.!`
- [ ] Truncar bloques de codigo largos con "... (ver completo)"

**Criterio de aceptacion**: Codigo se muestra con monospace y syntax highlighting en Telegram.

### 7.4 File Attachments para Output Largo

Telegram soporta archivos de hasta 4GB. Aprovechar para output largo.

- [ ] Implementar `TelegramChunker` que usa `sendDocument` para output > 12K chars
- [ ] Generar archivo temporal `.txt` con output completo
- [ ] Enviar como documento adjunto con caption resumido
- [ ] Para diffs largos: enviar como `.diff` o `.patch`
- [ ] Para logs: enviar como `.log`
- [ ] Limpiar archivos temporales despues de enviar

```

[frontend] Build completado (output: 45KB)
[documento adjunto: build-log-frontend.txt]

Resumen: 23 modulos compilados, bundle 1.2MB, 0 warnings.
Context: 23%

```

**Criterio de aceptacion**: Output de mas de 12K chars se envia como documento adjunto en Telegram.

### 7.5 Comandos JorchBot en Telegram

Todos los comandos de JorchBot deben funcionar en Telegram.

| Comando WP | Comando Telegram | Nota |
|------------|-----------------|------|
| `/new frontend` | `/new frontend` | Igual |
| `/switch frontend` | `/switch frontend` | Igual |
| `/list` | `/list` | Igual |
| `/stop frontend` | `/stop frontend` | Igual |
| `/mode auto` | `/mode auto` | Igual |
| `/tunnel frontend` | `/tunnel frontend` | Igual |
| `/tunnels` | `/tunnels` | Igual |
| `/gui` | `/gui` | Igual |
| `/status` | `/status` | Igual |
| `$ ls src/` | `$ ls src/` | Igual |
| texto libre | texto libre | Igual |

- [ ] Registrar todos los comandos en Telegram via BotFather (`/setcommands`)
- [ ] Telegram menu de comandos (autocomplete al escribir `/`)
- [ ] Misma logica de CommandRouter, solo cambia el adaptador de canal

**Nota**: Los comandos de Telegram no necesitan prefijo `/` especial ya que
JorchBot usa `/` como prefijo en todos los canales. Telegram lo interpreta
como comando nativo del bot.

**Criterio de aceptacion**: Todos los comandos funcionan igual que en WhatsApp.

### 7.6 Focus Model en Telegram

El Focus Model funciona igual que en WhatsApp: una sesion enfocada, las demas en background.

- [ ] Misma logica de prefijo: `[frontend]`, `[backend]`
- [ ] Notificaciones de background con emoji de estado
- [ ] Aprobaciones de background con inline keyboards tagueados
- [ ] `/switch` cambia sesion enfocada

**Criterio de aceptacion**: Multi-sesion funciona en Telegram con el mismo UX que en WhatsApp.

### 7.7 DM Pairing via Telegram

OpenClaw ya tiene DM pairing para Telegram. Verificar que funciona con JorchBot.

- [ ] Verificar que el flujo de 6 digitos funciona en Telegram
- [ ] `jorchbot pairing approve <codigo>` aprueba usuarios de Telegram
- [ ] Allowlist separada para Telegram (Telegram user IDs, no numeros de telefono)
- [ ] Config: `channels.telegram.dmPolicy` y `channels.telegram.allowFrom`

**Criterio de aceptacion**: Un desconocido recibe codigo de pairing. Tras aprobacion, puede usar JorchBot.

### 7.8 Soporte Dual: WhatsApp + Telegram Simultaneo

Ambos canales pueden estar activos al mismo tiempo para el mismo usuario.

- [ ] Las sesiones son compartidas: si creas `/new frontend` desde WP, se ve en Telegram
- [ ] El Focus Model es por canal: puedes tener frontend enfocado en WP y backend en Telegram
- [ ] Mensajes de Claude Code se envian al canal desde donde se hizo la peticion
- [ ] Aprobaciones se envian al canal donde se origino la accion
- [ ] `/list` muestra lo mismo en ambos canales

**Flujo dual**:

```

-- WhatsApp --
User: /new frontend
Bot: [frontend] Sesion creada.

-- Telegram --
User: /list
Bot: Sesiones activas: \* frontend (enfocada en WP) - Context: 0%

User: /switch frontend
Bot: [frontend] Sesion enfocada (Telegram).
Nota: tambien enfocada en WhatsApp.

User: arregla el bug del login
Bot: [frontend] (via Telegram) Analizando...

```

- [ ] Tracking de `lastChannel` por sesion (WP o Telegram)
- [ ] Opcion de enviar notificaciones a ambos canales (`config.dualNotify: true`)
- [ ] Por defecto, respuesta solo al canal que origino la peticion

**Criterio de aceptacion**: Crear sesion en WP, verla en Telegram. Enviar comando desde Telegram, recibir respuesta en Telegram.

---

## NO se construye en esta fase

- Grupos de Telegram (solo DM)
- Voice messages
- Video attachments
- Bot menus avanzados (menu buttons, web apps)
- Telegram Mini Apps
- Telegram Payments

---

## Definicion de "Terminado"

- [ ] Adaptador gramY reconectado y funcional
- [ ] Inline keyboards para todas las aprobaciones
- [ ] Codigo con format Markdown/HTML real
- [ ] Output largo como documento adjunto
- [ ] Todos los comandos JorchBot funcionan en Telegram
- [ ] Focus model funcional en Telegram
- [ ] DM pairing funcional en Telegram
- [ ] Soporte dual WP + Telegram simultaneo
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- gramY es el framework de Telegram que OpenClaw ya usa. No cambiar a otra libreria.
- Telegram Bot API: `https://core.telegram.org/bots/api`
- Rate limits de Telegram: 30 msg/s global, 1 msg/s por chat individual.
- `callback_data` de inline keyboards esta limitado a 64 bytes. Usar IDs cortos, no JSONs largos.
- MarkdownV2 de Telegram requiere escapar muchos caracteres. Si el formatting falla, usar HTML como fallback.
- Para desarrollo, usar long-polling (`bot.start()`). Para produccion, usar webhooks.
- Telegram user IDs son numericos (no phone numbers). El allowlist usa IDs, no telefonos.
```
