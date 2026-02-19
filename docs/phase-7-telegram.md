# Fase 7 - Telegram

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Canal Telegram completo como alternativa/complemento a WhatsApp
> **Al terminar**: Misma funcionalidad de WP pero en Telegram, con inline keyboards y code blocks

---

## Objetivo

Agregar Telegram como canal de mensajeria con paridad funcional a WhatsApp.
Telegram tiene ventajas naturales para desarrollo: code blocks nativos, sin limite
de AI bots, archivos de hasta 4GB, y sin ventana de 24h.

---

## Entregables

1. gramY adapter reconectado y adaptado para JorchBot
2. Inline keyboards para aprobaciones (equivalente a botones Kapso)
3. Code blocks con Markdown (output de codigo formateado)
4. Comandos de Telegram (menu de bot)
5. Dual-channel: recibir por WP, notificar por Telegram, o viceversa

---

## Tareas

### 7.1 Reconectar gramY adapter

OpenClaw ya tiene Telegram via gramY. Reconectar y adaptar:

- [ ] Re-habilitar `src/channels/telegram/` del fork de OpenClaw
- [ ] Adaptar al nuevo command router de JorchBot
- [ ] Implementar la misma interfaz de adapter que Kapso

```typescript
// src/channels/telegram/adapter.ts
export class TelegramAdapter {
  async sendText(chatId: number, text: string): Promise<void>;
  async sendButtons(chatId: number, text: string, buttons: Button[]): Promise<void>;
  async sendDocument(chatId: number, filename: string, content: Buffer): Promise<void>;
  async sendImage(chatId: number, image: Buffer, caption?: string): Promise<void>;
}
```

**Criterio de aceptacion**: Enviar mensaje por Telegram, recibir respuesta de Claude Code.

### 7.2 Inline keyboards para aprobaciones

Telegram soporta inline keyboards (botones dentro del mensaje):

```
[frontend] Claude quiere ejecutar:
> Edit: Login.tsx (lineas 34-42)

[✅ Yes]  [✅ Yes + feedback]  [❌ No]
```

- [ ] Mapear botones de Kapso a inline keyboards de gramY
- [ ] Callback data con sessionId + requestId
- [ ] Editar mensaje despues de tocar boton (cambiar botones por resultado)

**Ventaja sobre WP**: Telegram permite **editar el mensaje original** despues de
tocar un boton. Asi el boton desaparece y se reemplaza por el resultado:

```
ANTES:
[frontend] Claude quiere ejecutar: Edit Login.tsx
[✅ Yes]  [✅ Yes + feedback]  [❌ No]

DESPUES (user toco Yes):
[frontend] Claude quiere ejecutar: Edit Login.tsx
✓ Aprobado
```

**Criterio de aceptacion**: Aprobaciones funcionan con inline keyboards.

### 7.3 Code blocks con Markdown

Telegram soporta Markdown y HTML nativo. Usar para output de codigo:

- [ ] Formatear output de Claude Code con Markdown de Telegram:
  - Code blocks: ` ```lang ... ``` `
  - Bold: `**texto**`
  - Monospace inline: `` `codigo` ``
- [ ] Formatear output de shell con monospace
- [ ] Formatear diffs con syntax highlighting (best-effort)

````
[frontend] Editado src/components/Login.tsx:

```tsx
// Linea 34-42 (nuevo)
const emailSchema = z.string().email("Email invalido");
const passwordSchema = z.string().min(8, "Minimo 8 caracteres");
````

✓ Completado. Context: 15%

````

**Criterio de aceptacion**: Codigo aparece formateado en Telegram.

### 7.4 Comandos de Telegram (BotFather menu)

Registrar comandos en BotFather para que aparezcan en el menu del bot:

- [ ] `/new` - Crear workspace
- [ ] `/switch` - Cambiar sesion
- [ ] `/list` - Listar sesiones
- [ ] `/status` - Estado del Gateway
- [ ] `/help` - Ayuda
- [ ] `/dev` - Levantar dev server
- [ ] `/test` - Ejecutar tests
- [ ] `/mode` - Cambiar modo
- [ ] `/tunnels` - Ver tunnels
- [ ] `/logs` - Ver logs
- [ ] `/gui` - URL de la GUI

**Criterio de aceptacion**: Menu de comandos visible en Telegram.

### 7.5 Dual-channel (opcional)

Poder usar ambos canales simultaneamente:

- [ ] Config para habilitar WP + Telegram al mismo tiempo
- [ ] Ambos canales comparten las mismas sesiones
- [ ] Mensajes de un canal no se replican al otro (a menos que se configure)
- [ ] Opcion: "notificar background por Telegram, trabajar por WP"

**Caso de uso**: Usas WP para interactuar (es tu chat principal), pero las
notificaciones de background las recibes por Telegram (para no mezclar).

```json
// config.json
{
  "channels": {
    "kapso": { "enabled": true, "role": "primary" },
    "telegram": { "enabled": true, "role": "notifications" }
  }
}
````

**Criterio de aceptacion**: Recibir notificaciones de background por Telegram mientras trabajas por WP.

---

## Definicion de "Terminado"

- [ ] Todos los comandos de WP funcionan en Telegram
- [ ] Inline keyboards para aprobaciones
- [ ] Code blocks formateados
- [ ] Menu de bot configurado
- [ ] Dual-channel funciona (opcional)
- [ ] Tests pasan, CI en verde

---

## Ventajas de Telegram sobre WhatsApp

| Feature            | WhatsApp (Kapso)      | Telegram (gramY)             |
| ------------------ | --------------------- | ---------------------------- |
| AI bots permitidos | Riesgo de ban         | Sin restriccion              |
| Code blocks        | No                    | Si (Markdown nativo)         |
| Editar mensajes    | No                    | Si (post-approval cleanup)   |
| Archivos           | 100MB max             | 4GB max                      |
| Ventana de tiempo  | 24h (luego templates) | Sin limite                   |
| Costo              | $0-25/mes (Kapso)     | $0 (gratis)                  |
| Botones            | 3 max                 | Ilimitados (inline keyboard) |
| Listas             | 10 items              | Ilimitadas (inline keyboard) |
