# Fase 1 - Canal WhatsApp + Sesion Unica

> **Estado**: Pendiente
> **Dependencia**: Fase 0
> **Entregable**: Hablar con UNA instancia de Claude Code desde WhatsApp via Kapso.ai
> **Al terminar**: Puedes enviar un mensaje por WP, Claude Code lo procesa, recibes respuesta

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> **Kapso como Channel Plugin**: Kapso se implementa como **channel plugin** en
> `extensions/kapso/` usando el Plugin SDK de OpenClaw. NO como adapter aislado.
> Al usar el Plugin SDK, Kapso hereda **gratis**:
>
> - DM pairing (autenticacion con codigo de 6 digitos)
> - Message chunking (respeto del limite de 4096 chars)
> - Access control (allowlist, politicas de acceso)
> - Message normalization y routing pipeline
>
> La implementacion debe seguir el patron de `extensions/whatsapp/` (Baileys).
>
> **ClaudeRunner**: Codigo 100% nuevo de JorchBot. OpenClaw no ejecuta
> Claude Code como subproceso. ClaudeRunner es la unica pieza de runtime
> verdaderamente nueva que JorchBot agrega sobre OpenClaw.
>
> **DM Pairing**: Se hereda automaticamente al usar el Plugin SDK. No hay
> que implementarlo — el channel plugin lo recibe gratis.

## Objetivo

Conectar WhatsApp (via Kapso.ai) al Gateway de JorchBot y poder mantener
una conversacion con una instancia de Claude Code headless. Incluye el flujo
basico de aprobacion con botones (Yes/No).

---

## Entregables

1. Canal Kapso.ai como **channel plugin** en `extensions/kapso/` via Plugin SDK
2. Claude Code Runner (ejecuta `claude -p` headless)
3. Una sesion unica de Claude Code
4. Aprobaciones basicas con botones (Yes / No)
5. Context window % en cada respuesta
6. Command router basico (/help, /status)
7. DM pairing heredado automaticamente del Plugin SDK

---

## Tareas

### 1.1 Integrar Kapso.ai como channel plugin (Plugin SDK)

- [ ] Instalar SDK: `pnpm add @kapso/whatsapp-cloud-api`
- [ ] Crear `extensions/kapso/` como workspace package
- [ ] Registrar en `package.json` manifest via `openclaw.extensions`
- [ ] Implementar channel plugin siguiendo patron de `extensions/whatsapp/`
- [ ] Implementar webhook receiver (mensajes entrantes)
- [ ] Implementar message sender (mensajes salientes)
- [ ] Implementar interactive messages (botones, hasta 3)
- [ ] Manejar la ventana de 24h (tracking del ultimo mensaje del user)
- [ ] Config: `kapsoApiKey`, `phoneNumberId`, `webhookUrl`
- [ ] Verificar que DM pairing se hereda del Plugin SDK
- [ ] Tests unitarios del plugin

**Lo que se hereda GRATIS del Plugin SDK**:

- DM pairing (codigo de 6 digitos para vincular numero de WP)
- Message chunking (textLimit por canal, 4096 default para WP)
- Access control (4 politicas: pairing, allowlist, open, disabled)
- Message normalization y routing pipeline
- Session key generation (`agent:{agentId}:{channel}:{scope}:{identifier}`)

**Webhook setup**:
JorchBot necesita un endpoint publico para recibir webhooks de Kapso.
En fase 1, el user debe configurar manualmente (Tailscale Funnel).
En fase 4, esto se automatiza.

**Estructura del plugin**:

```typescript
// extensions/kapso/index.ts
// Channel plugin via OpenClaw Plugin SDK
// Sigue el patron de extensions/whatsapp/ (Baileys)

export class KapsoChannelPlugin {
  // Plugin lifecycle
  async onActivate(): Promise<void>;
  async onDeactivate(): Promise<void>;

  // Recibir mensajes (webhook handler)
  async handleIncomingMessage(webhook: KapsoWebhook): Promise<void>;

  // Enviar texto
  async sendText(to: string, body: string): Promise<void>;

  // Enviar mensaje con botones (max 3)
  async sendButtons(to: string, body: string, buttons: Button[]): Promise<void>;

  // Enviar lista (max 10 items)
  async sendList(to: string, body: string, sections: ListSection[]): Promise<void>;

  // Enviar documento (para outputs largos)
  async sendDocument(to: string, filename: string, content: Buffer): Promise<void>;

  // Enviar imagen (para screenshots en fases futuras)
  async sendImage(to: string, image: Buffer, caption?: string): Promise<void>;
}
```

**Criterio de aceptacion**: Enviar "hola" por WP y recibir respuesta de JorchBot. DM pairing funciona sin implementacion adicional.

### 1.2 Claude Code Runner

- [ ] Crear `src/sessions/claude-runner.ts`
- [ ] Ejecutar `claude -p <prompt> --output-format stream-json`
- [ ] Parsear NDJSON streaming
- [ ] Capturar session_id para resume
- [ ] Implementar resume: `claude -p <prompt> --resume <session_id>`
- [ ] Capturar tool approval requests del stream
- [ ] Enviar approval/rejection de vuelta al proceso
- [ ] Calcular context window % desde metadata de respuesta
- [ ] Manejar errores y timeouts del proceso
- [ ] Tests unitarios

**Detalle del streaming**:

```typescript
// src/sessions/claude-runner.ts
export class ClaudeRunner {
  private process: ChildProcess | null = null;
  private sessionId: string | null = null;

  // Iniciar nueva sesion
  async start(options: {
    prompt: string;
    cwd: string;
    systemPrompt?: string;
    allowedTools?: string[];
  }): Promise<ClaudeResponse>;

  // Continuar sesion existente
  async resume(prompt: string): Promise<ClaudeResponse>;

  // Responder a aprobacion pendiente
  async respondToApproval(approved: boolean, feedback?: string): Promise<void>;

  // Obtener context %
  getContextPercent(): number;

  // Detener sesion
  async stop(): Promise<void>;
}
```

**Criterio de aceptacion**: Ejecutar Claude Code headless, obtener respuesta, hacer resume.

### 1.3 Flujo de aprobacion basico (Yes / No)

- [ ] Detectar cuando Claude Code pide aprobacion (del stream JSON)
- [ ] Enviar mensaje WP con botones: `[Yes] [No]`
- [ ] Recibir respuesta del boton via webhook
- [ ] Mapear button_id a la accion pendiente
- [ ] Enviar aprobacion/rechazo al proceso de Claude Code
- [ ] Timeout: re-enviar recordatorio a los 10 min

**Estructura del approval**:

```typescript
// Cuando Claude pide aprobacion, el stream emite:
{
  type: "tool_use_request",
  tool: "Bash",
  input: "npm install react-hook-form",
  request_id: "req_abc123"
}

// JorchBot envia a WP:
// "[session] Claude quiere ejecutar:
//  > Bash: npm install react-hook-form
//  [Yes] [No]"

// Boton metadata: { sessionId: "s1", requestId: "req_abc123", action: "approve" }
```

**Criterio de aceptacion**: Claude pide aprobacion, recibes botones en WP, tocas Yes, Claude continua.

### 1.4 Command Router basico

- [ ] Crear `src/commands/router.ts`
- [ ] Parsear mensajes que empiezan con `/`
- [ ] Implementar `/help` — lista de comandos disponibles
- [ ] Implementar `/status` — estado del Gateway y sesion activa
- [ ] Mensajes sin `/` → se envian a Claude Code
- [ ] Responder con error si no hay sesion activa y se envia mensaje libre

```typescript
// src/commands/router.ts
export class CommandRouter {
  async route(message: IncomingMessage): Promise<void> {
    if (message.text.startsWith("/")) {
      return this.handleCommand(message);
    }
    // Mensaje libre → Claude Code
    return this.forwardToClaude(message);
  }
}
```

**Criterio de aceptacion**: `/help` muestra lista, `/status` muestra estado, texto libre va a Claude.

### 1.5 Context Window % tracking

- [ ] Parsear token usage de la respuesta JSON de Claude Code
- [ ] Calcular % basado en el limite del modelo (200K para Opus, etc.)
- [ ] Incluir en cada respuesta: `Context: X% (YK/ZK tokens)`
- [ ] Guardar en DB (tabla sessions, campo contextPercent)

**Criterio de aceptacion**: Cada respuesta muestra el % de context usado.

### 1.6 Onboarding minimo

- [ ] Comando `jorchbot setup` interactivo:
  1. Pedir Kapso API key
  2. Pedir phone number ID
  3. Mostrar URL del webhook para configurar en Kapso
  4. Verificar conexion enviando mensaje de test
  5. Guardar config en `~/.jorchbot/config.json`

**Criterio de aceptacion**: Usuario nuevo puede configurar JorchBot en < 5 minutos.

---

## Definicion de "Terminado"

- [ ] Enviar mensaje por WP → recibir respuesta de Claude Code
- [ ] Kapso funciona como channel plugin en `extensions/kapso/` via Plugin SDK
- [ ] DM pairing se hereda del Plugin SDK (no implementacion adicional)
- [ ] Aprobaciones funcionan con botones Yes / No
- [ ] Context % se muestra en cada respuesta
- [ ] `/help` y `/status` funcionan
- [ ] `jorchbot setup` configura Kapso correctamente
- [ ] Sesion persiste entre mensajes (resume funciona)
- [ ] Tests pasan, CI en verde

---

## Limitaciones de esta fase (resueltas en fases posteriores)

- Solo 1 sesion de Claude Code (multi-sesion en fase 2)
- Sin shell directo (fase 2)
- Sin Jorchfile (fase 3)
- Sin tunnels automaticos (fase 4)
- Sin "Yes + feedback" (fase 5)
- Sin modos plan/auto/silent (fase 5)
- Webhook requiere setup manual (fase 4 lo automatiza con Tailscale)
