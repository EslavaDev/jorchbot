# JorchBot GUI — Hallazgos Tecnicos y Plan de Adaptacion de la Control UI

> **Fase**: 6 (GUI de Configuracion)
> **Dependencia**: Fase 4 (Tunnels) — acceso via Tailscale Serve
> **Base**: Control UI de OpenClaw (Lit 3.x + Vite 7.x)
> **Filosofia**: Reusar al maximo, adaptar lo minimo, no reconstruir

---

## 1. Hallazgos Tecnicos — Estado Actual de la Control UI

### 1.1 Arquitectura General

La Control UI de OpenClaw es una **SPA madura** con las siguientes caracteristicas:

| Aspecto            | Detalle                                                               |
| ------------------ | --------------------------------------------------------------------- |
| **Framework**      | Lit 3.3.2 (web components nativos, NO React/Vue)                      |
| **Build**          | Vite 7.3.1 → `dist/control-ui/`                                       |
| **Puerto**         | Se sirve del **mismo puerto del gateway (18789)** — NO basePort+2     |
| **Entry point**    | `ui/src/main.ts` → `ui/src/ui/app.ts`                                 |
| **Root component** | `<openclaw-app>` (clase `OpenClawApp`)                                |
| **Estilos**        | CSS modules colocados + `ui/src/styles/base.css` (variables globales) |
| **i18n**           | Multi-idioma (en, pt-BR, zh-CN, zh-TW)                                |
| **Seguridad**      | CSP headers, X-Frame-Options: DENY, device auth con ECDSA P-256       |
| **Comunicacion**   | WebSocket RPC (JSON frames: `req` → `res`, server-push `event`)       |
| **Tabs**           | 4 grupos, 12 tabs                                                     |

### 1.2 Como se Sirve

El handler HTTP standalone en `src/gateway/control-ui.ts` (`handleControlUiHttpRequest`) maneja:

- **Assets estaticos**: `/assets/*`, favicon, archivos en `public/`
- **SPA fallback**: Rutas desconocidas → `index.html` (client-side routing)
- **Bootstrap config**: `/__openclaw/control-ui-config.json` (nombre, avatar, agentId)
- **Avatares de agentes**: `/openclaw/agents/<id>/avatar`
- **Security headers**: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy

Se monta en `src/gateway/server-http.ts:588-606` como parte del gateway completo de OpenClaw.

**Problema actual**: El gateway de JorchBot (`src/gateway/jorchbot-start.ts`) es un Express minimo de Phase 1 que solo tiene:

- `GET /webhooks/kapso` — verificacion de webhook
- `POST /webhooks/kapso` — recepcion de mensajes
- `GET /health` — health check

**NO monta la Control UI ni tiene WebSocket**.

### 1.3 Resolucion de Assets

`src/infra/control-ui-assets.ts` busca `dist/control-ui/index.html` en varias ubicaciones:

- Sibling de `dist/` (desarrollo)
- Package root del monorepo
- CWD + `dist/control-ui/`
- Auto-build con `pnpm ui:build` si falta

### 1.4 Build Pipeline

```
ui/src/ → vite build → dist/control-ui/ → gateway sirve assets
```

```bash
pnpm ui:build    # Produccion → dist/control-ui/
pnpm ui:dev      # Dev server en puerto 5173 con hot reload
pnpm ui:install  # Instalar deps del workspace ui/
```

### 1.5 Protocolo WebSocket

El cliente WebSocket (`ui/src/ui/gateway.ts` — clase `GatewayBrowserClient`) implementa:

1. **Conexion**: `new WebSocket(url)` al mismo host/port de la UI
2. **Challenge-response**: El server envia evento `connect.challenge` con nonce
3. **Hello**: El cliente envia `connect` con auth, device identity, client info
4. **Hello-OK**: El server responde con snapshot (presence, health, session defaults)
5. **Request-Response**: Frames `{type:"req", id, method, params}` → `{type:"res", id, ok, payload}`
6. **Events**: Server-push `{type:"event", event, payload, seq}` — para real-time
7. **Reconexion**: Auto-reconnect con backoff exponencial (800ms → 15s)

**Client name**: `"openclaw-control-ui"` (en `app-gateway.ts:141`)

### 1.6 Tabs Existentes (12 tabs, 4 grupos)

Definidos en `ui/src/ui/navigation.ts`:

```typescript
TAB_GROUPS = [
  { label: "chat", tabs: ["chat"] },
  { label: "control", tabs: ["overview", "channels", "instances", "sessions", "usage", "cron"] },
  { label: "agent", tabs: ["agents", "skills", "nodes"] },
  { label: "settings", tabs: ["config", "debug", "logs"] },
];
```

---

## 2. Inventario Completo de Metodos RPC

El gateway de OpenClaw expone **104 metodos RPC** via WebSocket. De estos, la Control UI
consume ~30 directamente. A continuacion la clasificacion completa para JorchBot:

### 2.1 REUSAR (usar tal cual) — OpenClaw los maneja

Estos metodos son genericos del gateway y funcionan sin cambios:

| #   | Metodo                    | Tab/Controller    | Funcion                                 |
| --- | ------------------------- | ----------------- | --------------------------------------- |
| 1   | `connect`                 | gateway.ts        | Autenticacion + hello handshake         |
| 2   | `health`                  | debug.ts          | Estado de salud del gateway             |
| 3   | `status`                  | debug.ts          | Resumen de status general               |
| 4   | `models.list`             | debug.ts          | Modelos LLM disponibles                 |
| 5   | `last-heartbeat`          | debug.ts          | Ultimo heartbeat registrado             |
| 6   | `config.get`              | config.ts         | Obtener configuracion completa          |
| 7   | `config.set`              | config.ts         | Guardar configuracion (raw JSON5)       |
| 8   | `config.apply`            | config.ts         | Aplicar cambios sin reiniciar           |
| 9   | `config.schema`           | config.ts         | Schema JSON para editor visual          |
| 10  | `update.run`              | config.ts         | Ejecutar auto-update                    |
| 11  | `logs.tail`               | logs.ts           | Obtener logs con paginacion/filtros     |
| 12  | `device.pair.list`        | devices.ts        | Listar dispositivos pareados/pendientes |
| 13  | `device.pair.approve`     | devices.ts        | Aprobar solicitud de pairing            |
| 14  | `device.pair.reject`      | devices.ts        | Rechazar solicitud de pairing           |
| 15  | `device.token.rotate`     | devices.ts        | Rotar token de dispositivo              |
| 16  | `device.token.revoke`     | devices.ts        | Revocar token de dispositivo            |
| 17  | `exec.approval.resolve`   | app.ts            | Resolver aprobacion de ejecucion        |
| 18  | `exec.approvals.get`      | exec-approvals.ts | Obtener config de exec approvals        |
| 19  | `exec.approvals.set`      | exec-approvals.ts | Guardar config de exec approvals        |
| 20  | `exec.approvals.node.get` | exec-approvals.ts | Exec approvals de un node               |
| 21  | `exec.approvals.node.set` | exec-approvals.ts | Guardar exec approvals de node          |

**Eventos reutilizables** (server-push):

| Evento                    | Funcion                          |
| ------------------------- | -------------------------------- |
| `connect.challenge`       | Challenge nonce para device auth |
| `presence`                | Actualizacion de presencia       |
| `device.pair.requested`   | Solicitud de pairing             |
| `device.pair.resolved`    | Pairing resuelto                 |
| `exec.approval.requested` | Aprobacion de exec solicitada    |
| `exec.approval.resolved`  | Aprobacion de exec resuelta      |
| `update.available`        | Actualizacion disponible         |

### 2.2 ADAPTAR (existen, JorchBot necesita wrapper/bridge) — 11 metodos

Estos metodos existen en OpenClaw pero JorchBot necesita adaptar la fuente de datos:

| #   | Metodo                      | Tab/Controller | Adaptacion necesaria                                               |
| --- | --------------------------- | -------------- | ------------------------------------------------------------------ |
| 1   | `sessions.list`             | sessions.ts    | Conectar a tabla `sessions` de JorchBot DB + datos de ClaudeRunner |
| 2   | `sessions.patch`            | sessions.ts    | Adaptar para propiedades de sesiones JorchBot (label, modo, etc.)  |
| 3   | `sessions.delete`           | sessions.ts    | Eliminar sesion de JorchBot DB + detener ClaudeRunner              |
| 4   | `sessions.usage`            | usage.ts       | Calcular usage desde JorchBot DB (tokens consumidos)               |
| 5   | `sessions.usage.timeseries` | usage.ts       | Serie temporal de uso por sesion                                   |
| 6   | `sessions.usage.logs`       | usage.ts       | Logs de uso detallados                                             |
| 7   | `usage.cost`                | usage.ts       | Resumen de costos por periodo                                      |
| 8   | `channels.status`           | channels.ts    | Mostrar Kapso/Telegram en vez de canales de OpenClaw               |
| 9   | `channels.logout`           | channels.ts    | Adaptar para canales JorchBot                                      |
| 10  | `config.patch`              | config.ts      | Patch parcial de config (server-side, UI usa `config.set`)         |
| 11  | `sessions.compact`          | sessions.ts    | Compactar sesion (redirigir a ClaudeRunner compact)                |

### 2.3 IMPLEMENTAR NUEVO (JorchBot-especificos) — ~20 metodos

Metodos completamente nuevos para funcionalidad de JorchBot:

#### Workspaces (Phase 2+)

| #   | Metodo                          | Funcion                                   |
| --- | ------------------------------- | ----------------------------------------- |
| 1   | `jb.workspaces.list`            | Listar workspaces configurados            |
| 2   | `jb.workspaces.get`             | Obtener detalle de un workspace           |
| 3   | `jb.workspaces.create`          | Crear workspace nuevo                     |
| 4   | `jb.workspaces.update`          | Modificar workspace (path, prompt, tools) |
| 5   | `jb.workspaces.delete`          | Eliminar workspace                        |
| 6   | `jb.workspaces.enable`          | Habilitar/deshabilitar workspace          |
| 7   | `jb.workspaces.commands.list`   | Listar comandos personalizados            |
| 8   | `jb.workspaces.commands.create` | Crear comando personalizado               |
| 9   | `jb.workspaces.commands.delete` | Eliminar comando personalizado            |

#### Estado y Control (Phase 1+)

| #   | Metodo               | Funcion                                                |
| --- | -------------------- | ------------------------------------------------------ |
| 10  | `jb.status`          | Estado global de JorchBot (uptime, sesiones, contexto) |
| 11  | `jb.session.focus`   | Cambiar sesion focused                                 |
| 12  | `jb.session.compact` | Trigger compaction de una sesion                       |
| 13  | `jb.session.stop`    | Detener una sesion                                     |
| 14  | `jb.session.restart` | Reiniciar una sesion                                   |

#### Tunnels (Phase 4+)

| #   | Metodo              | Funcion                               |
| --- | ------------------- | ------------------------------------- |
| 15  | `jb.tunnels.list`   | Listar tunnels activos                |
| 16  | `jb.tunnels.create` | Crear tunnel (Tailscale Serve/Funnel) |
| 17  | `jb.tunnels.delete` | Cerrar tunnel                         |

#### Jorchfile (Phase 3+)

| #   | Metodo                  | Funcion                                   |
| --- | ----------------------- | ----------------------------------------- |
| 18  | `jb.jorchfile.get`      | Obtener Jorchfile parseado                |
| 19  | `jb.jorchfile.commands` | Listar comandos disponibles del Jorchfile |
| 20  | `jb.jorchfile.run`      | Ejecutar comando del Jorchfile            |

**Eventos nuevos**:

| Evento              | Funcion                                      |
| ------------------- | -------------------------------------------- |
| `jb.session.output` | Streaming de output de ClaudeRunner          |
| `jb.session.state`  | Cambio de estado de sesion (contexto%, modo) |
| `jb.tunnel.state`   | Cambio de estado de tunnel                   |
| `jb.approval`       | Aprobacion pendiente de JorchBot             |

### 2.4 OMITIR (no relevantes para JorchBot) — ~60 metodos

El gateway completo de OpenClaw tiene **104 metodos RPC** en total
(`src/gateway/server-methods/`). Los siguientes no se implementan en el
gateway minimo de JorchBot:

#### Agentes y Skills (OpenClaw multi-agente — JorchBot usa ClaudeRunner)

| Metodo               | Razon                       |
| -------------------- | --------------------------- |
| `agent`              | Ejecutar agente OpenClaw    |
| `agent.identity.get` | Identidad de agente         |
| `agent.wait`         | Esperar resultado de agente |
| `agents.list`        | Listar agentes OpenClaw     |
| `agents.create`      | Crear agente                |
| `agents.update`      | Actualizar agente           |
| `agents.delete`      | Eliminar agente             |
| `agents.files.list`  | Archivos de agente          |
| `agents.files.get`   | Leer archivo de agente      |
| `agents.files.set`   | Guardar archivo de agente   |
| `skills.status`      | Skills de agentes           |
| `skills.bins`        | Binarios de skills          |
| `skills.install`     | Instalar skill              |
| `skills.update`      | Actualizar skill            |

#### Chat (JorchBot usa WhatsApp, no chat web)

| Metodo         | Razon                                             |
| -------------- | ------------------------------------------------- |
| `chat.send`    | Chat de OpenClaw (JorchBot usa WP + ClaudeRunner) |
| `chat.history` | Historial de chat OpenClaw                        |
| `chat.abort`   | Abort de chat OpenClaw                            |
| `chat.inject`  | Inyectar mensaje en chat                          |

#### Cron (Jobs programados — no relevante)

| Metodo        | Razon                    |
| ------------- | ------------------------ |
| `cron.list`   | Listar jobs              |
| `cron.status` | Estado de cron           |
| `cron.add`    | Agregar job              |
| `cron.update` | Actualizar job           |
| `cron.remove` | Eliminar job             |
| `cron.run`    | Ejecutar job             |
| `cron.runs`   | Historial de ejecuciones |

#### Nodes (Workers distribuidos — no aplica)

| Metodo               | Razon               |
| -------------------- | ------------------- |
| `node.list`          | Listar workers      |
| `node.describe`      | Describir worker    |
| `node.invoke`        | Ejecutar en worker  |
| `node.invoke.result` | Resultado de worker |
| `node.event`         | Evento de worker    |
| `node.pair.request`  | Pairing de worker   |
| `node.pair.list`     | Listar pairings     |
| `node.pair.approve`  | Aprobar pairing     |
| `node.pair.reject`   | Rechazar pairing    |
| `node.pair.verify`   | Verificar token     |
| `node.rename`        | Renombrar worker    |

#### TTS / Voice (no relevante)

| Metodo                              | Razon                        |
| ----------------------------------- | ---------------------------- |
| `tts.status`                        | Estado de text-to-speech     |
| `tts.enable` / `tts.disable`        | Activar/desactivar TTS       |
| `tts.convert`                       | Convertir texto a audio      |
| `tts.providers` / `tts.setProvider` | Proveedores TTS              |
| `voicewake.get` / `voicewake.set`   | Config de wake word          |
| `talk.config` / `talk.mode`         | Modo de conversacion por voz |

#### Web Login / Misc (no relevante)

| Metodo                                                             | Razon                                            |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `web.login.start`                                                  | Login WhatsApp via QR web (OpenClaw built-in WA) |
| `web.login.wait`                                                   | Esperar login WA web                             |
| `send`                                                             | Envio generico de mensajes                       |
| `poll`                                                             | Enviar encuesta                                  |
| `push.test`                                                        | Notificacion push de prueba                      |
| `browser.request`                                                  | Request desde browser                            |
| `system-presence`                                                  | Presencia de instancias OpenClaw                 |
| `system-event`                                                     | Evento de sistema                                |
| `set-heartbeats`                                                   | Activar heartbeats                               |
| `wizard.start` / `wizard.next` / `wizard.cancel` / `wizard.status` | Setup wizard                                     |

> **Nota**: "Omitir" significa que JorchBot no implementa estos handlers en su
> gateway minimo. El codigo de OpenClaw sigue existiendo en el codebase
> (no se elimina para mantener merge-ability con upstream).

---

## 3. Inventario Completo de Branding

Cada referencia a "OpenClaw" en la UI que necesita cambiarse a "JorchBot":

### 3.1 HTML

| Archivo         | Linea | Contenido actual                  | Cambio                            |
| --------------- | ----- | --------------------------------- | --------------------------------- |
| `ui/index.html` | 6     | `<title>OpenClaw Control</title>` | `<title>JorchBot Control</title>` |
| `ui/index.html` | 13    | `<openclaw-app></openclaw-app>`   | `<jorchbot-app></jorchbot-app>`   |

### 3.2 Root Component

| Archivo            | Linea | Contenido actual                              | Cambio                                        |
| ------------------ | ----- | --------------------------------------------- | --------------------------------------------- |
| `ui/src/ui/app.ts` | 87    | `window.__OPENCLAW_CONTROL_UI_BASE_PATH__`    | `window.__JORCHBOT_CONTROL_UI_BASE_PATH__`    |
| `ui/src/ui/app.ts` | 106   | `@customElement("openclaw-app")`              | `@customElement("jorchbot-app")`              |
| `ui/src/ui/app.ts` | 107   | `export class OpenClawApp extends LitElement` | `export class JorchBotApp extends LitElement` |

### 3.3 Render / Branding Visual

| Archivo                   | Linea | Contenido actual                              | Cambio                            |
| ------------------------- | ----- | --------------------------------------------- | --------------------------------- |
| `ui/src/ui/app-render.ts` | 128   | `alt="OpenClaw"` (logo img)                   | `alt="JorchBot"`                  |
| `ui/src/ui/app-render.ts` | 131   | `OPENCLAW` (brand title text)                 | `JORCHBOT`                        |
| `ui/src/ui/app-render.ts` | 132   | `Gateway Dashboard` (brand subtitle)          | `Dev Assistant` o `Remote Dev`    |
| `ui/src/ui/app-render.ts` | 179   | `href="https://docs.openclaw.ai"` (docs link) | Remover o cambiar a repo JorchBot |

### 3.4 CSS

| Archivo                  | Linea | Contenido actual                       | Cambio                                          |
| ------------------------ | ----- | -------------------------------------- | ----------------------------------------------- |
| `ui/src/styles/base.css` | 41    | `--accent: #ff5c5c` (rojo OpenClaw)    | Cambiar a color JorchBot (ej: `#6366f1` indigo) |
| `ui/src/styles/base.css` | 47    | `--primary: #ff5c5c`                   | Mismo nuevo color                               |
| `ui/src/styles/base.css` | 149   | `--accent: #dc2626` (light mode)       | Adaptar para light mode                         |
| `ui/src/styles/base.css` | 155   | `--primary: #dc2626` (light mode)      | Adaptar para light mode                         |
| `ui/src/styles/base.css` | 244   | `openclaw-app { display: block; ... }` | `jorchbot-app { display: block; ... }`          |

### 3.5 LocalStorage Keys

| Archivo                        | Linea | Key actual                       | Key nuevo                        |
| ------------------------------ | ----- | -------------------------------- | -------------------------------- |
| `ui/src/ui/storage.ts`         | 1     | `"openclaw.control.settings.v1"` | `"jorchbot.control.settings.v1"` |
| `ui/src/ui/device-auth.ts`     | 8     | `"openclaw.device.auth.v1"`      | `"jorchbot.device.auth.v1"`      |
| `ui/src/ui/device-identity.ts` | 17    | `"openclaw-device-identity-v1"`  | `"jorchbot-device-identity-v1"`  |

### 3.6 i18n

| Archivo                        | Linea | Uso actual                                             | Cambio                                   |
| ------------------------------ | ----- | ------------------------------------------------------ | ---------------------------------------- |
| `ui/src/i18n/lib/translate.ts` | 22    | `localStorage.getItem("openclaw.i18n.locale")`         | `"jorchbot.i18n.locale"`                 |
| `ui/src/i18n/lib/translate.ts` | 67    | `localStorage.setItem("openclaw.i18n.locale", locale)` | `"jorchbot.i18n.locale"`                 |
| `ui/src/i18n/locales/en.ts`    | 50    | `"Edit ~/.openclaw/openclaw.json safely."`             | `"Edit ~/.jorchbot/config.json safely."` |
| `ui/src/i18n/locales/pt-BR.ts` | 50    | `"Editar ~/.openclaw/openclaw.json..."`                | `"Editar ~/.jorchbot/config.json..."`    |
| `ui/src/i18n/locales/zh-CN.ts` | 50    | `"安全地编辑 ~/.openclaw/openclaw.json。"`             | `"安全地编辑 ~/.jorchbot/config.json。"` |
| `ui/src/i18n/locales/zh-TW.ts` | 50    | `"安全地編輯 ~/.openclaw/openclaw.json。"`             | `"安全地編輯 ~/.jorchbot/config.json。"` |

### 3.7 Gateway Client

| Archivo                    | Linea | Valor actual                        | Cambio                              |
| -------------------------- | ----- | ----------------------------------- | ----------------------------------- |
| `ui/src/ui/app-gateway.ts` | 141   | `clientName: "openclaw-control-ui"` | `clientName: "jorchbot-control-ui"` |

### 3.8 Server-Side

| Archivo                              | Linea | Referencia                             | Cambio                                 |
| ------------------------------------ | ----- | -------------------------------------- | -------------------------------------- |
| `src/gateway/control-ui-contract.ts` | 1     | `"/__openclaw/control-ui-config.json"` | `"/__jorchbot/control-ui-config.json"` |

### 3.9 Views (referencias a CLI/docs de OpenClaw)

| Archivo                              | Linea(s)      | Contenido                                          | Cambio                                     |
| ------------------------------------ | ------------- | -------------------------------------------------- | ------------------------------------------ |
| `ui/src/ui/views/overview.ts`        | 57,75         | `openclaw dashboard --no-open`                     | `jorchbot start` (o equivalente)           |
| `ui/src/ui/views/overview.ts`        | 58            | `openclaw doctor --generate-gateway-token`         | Adaptar a CLI de JorchBot                  |
| `ui/src/ui/views/overview.ts`        | 63,79,111,120 | `https://docs.openclaw.ai/...`                     | Remover o cambiar a repo JorchBot          |
| `ui/src/ui/views/debug.ts`           | 54            | `openclaw security audit --deep`                   | Adaptar a CLI de JorchBot                  |
| `ui/src/ui/views/usage.ts`           | 522,534,546   | `openclaw-usage-*.csv/json` (export filenames)     | `jorchbot-usage-*`                         |
| `ui/src/ui/views/skills-grouping.ts` | 10-13         | `"openclaw-workspace"`, `"openclaw-bundled"`, etc. | `"jorchbot-*"`                             |
| `ui/src/ui/app-scroll.ts`            | 159           | `openclaw-logs-*.log` (export filename)            | `jorchbot-logs-*`                          |
| `ui/src/ui/app-settings.ts`          | 254           | `window.__OPENCLAW_CONTROL_UI_BASE_PATH__`         | `window.__JORCHBOT_CONTROL_UI_BASE_PATH__` |

### 3.10 Favicon / Assets

| Archivo                          | Accion                       |
| -------------------------------- | ---------------------------- |
| `ui/public/favicon.svg`          | Reemplazar con logo JorchBot |
| `ui/public/favicon-32.png`       | Reemplazar con logo JorchBot |
| `ui/public/apple-touch-icon.png` | Reemplazar con logo JorchBot |

### 3.11 Tests

| Archivo                                | Linea | Referencia                                               | Cambio           |
| -------------------------------------- | ----- | -------------------------------------------------------- | ---------------- |
| `ui/src/ui/navigation.browser.test.ts` | 45    | `window.__OPENCLAW_CONTROL_UI_BASE_PATH__ = "/openclaw"` | `__JORCHBOT_...` |

---

## 4. Estrategia de Tabs

### 4.1 Resumen de Decisiones

| Tab            | Decision                | Detalle                                                 |
| -------------- | ----------------------- | ------------------------------------------------------- |
| **overview**   | MANTENER (adaptado)     | Dashboard con sesiones JorchBot, contexto %, tunnels    |
| **sessions**   | MANTENER (adaptado)     | Lista de sesiones JorchBot con focus model              |
| **channels**   | MANTENER (adaptado)     | Estado de Kapso/Telegram                                |
| **config**     | MANTENER                | Editor visual de `jorchbot.json`                        |
| **debug**      | MANTENER                | Diagnosticos internos del gateway                       |
| **logs**       | MANTENER                | Log viewer en tiempo real                               |
| **nodes**      | MANTENER (simplificado) | Device pairing + exec approvals                         |
| **chat**       | OCULTAR                 | JorchBot usa WhatsApp, no chat web. Evaluar en Phase 9+ |
| **instances**  | OCULTAR                 | Presencia de instancias OpenClaw, no aplica             |
| **usage**      | OCULTAR                 | Usar adaptacion simplificada en overview                |
| **cron**       | OCULTAR                 | No relevante para JorchBot                              |
| **agents**     | OCULTAR                 | Multi-agente de OpenClaw, no aplica                     |
| **skills**     | OCULTAR                 | Skills de OpenClaw, no aplica                           |
| **workspaces** | AGREGAR                 | **Nuevo tab** — gestion completa de proyectos           |
| **tunnels**    | AGREGAR (Phase 4+)      | Estado y gestion de tunnels Tailscale                   |
| **jorchfile**  | AGREGAR (Phase 3+)      | Visualizar/editar Jorchfile                             |

### 4.2 Implementacion del Ocultamiento

Los tabs se ocultan via configuracion, **NO eliminando codigo** (mantener upstream merge-ability):

```typescript
// ui/src/ui/navigation.ts — propuesta
const HIDDEN_TABS: Set<Tab> = new Set(["chat", "instances", "usage", "cron", "agents", "skills"]);

// En TAB_GROUPS, filtrar tabs ocultos
export const VISIBLE_TAB_GROUPS = TAB_GROUPS.map((group) => ({
  ...group,
  tabs: group.tabs.filter((tab) => !HIDDEN_TABS.has(tab)),
})).filter((group) => group.tabs.length > 0);
```

---

## 5. Tab "Workspaces" — Diseno Detallado

### 5.1 Proposito

Panel completo para gestionar los workspaces/proyectos de JorchBot. Reemplaza el uso de
comandos de texto (`/list`, `/new`, `/switch`) con una interfaz visual rica.

### 5.2 Funcionalidades

| Funcion                    | Descripcion                                             |
| -------------------------- | ------------------------------------------------------- |
| **Crear**                  | Nombre, path del proyecto, system prompt, allowed tools |
| **Modificar**              | Cambiar path, system prompt, modo, tools                |
| **Renombrar**              | Cambiar nombre del workspace                            |
| **Habilitar/Deshabilitar** | Pausar sin destruir (conserva config y sesion)          |
| **Eliminar**               | Eliminar workspace completo                             |
| **Comandos**               | Crear/eliminar comandos personalizados por workspace    |
| **Estado en tiempo real**  | Contexto %, modo, focused/background, ultimo mensaje    |
| **Acciones rapidas**       | Switch focus, compact, stop, restart                    |

### 5.3 Layout Visual

```
┌────────────────────────────────────────────────────────────────┐
│  Workspaces                                        [+ Create] │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────────────────────────────────┐  ┌─────────────┐│
│  │ ● frontend                    [focused]  │  │ ○ backend   ││
│  │ /home/dev/my-app/frontend                │  │ /home/d...  ││
│  │ Context: ████████░░ 45%                  │  │ Context: 8% ││
│  │ Mode: confirm+verbose                    │  │ Mode: auto  ││
│  │ Last: "Fixed the CSS issue" (2m ago)     │  │ Last: 15m   ││
│  │                                          │  │             ││
│  │ [Switch Focus] [Compact] [Stop] [⚙️]     │  │ [Focus] [⚙️]││
│  └──────────────────────────────────────────┘  └─────────────┘│
│                                                                │
│  ┌──────────────────────────────────────────┐                  │
│  │ ◌ api-service              [disabled]    │                  │
│  │ /home/dev/api-service                    │                  │
│  │ Paused — [Enable] [Delete]               │                  │
│  └──────────────────────────────────────────┘                  │
│                                                                │
│  ── Commands (frontend) ──────────────────────────             │
│  /deploy     → pnpm build && vercel deploy                     │
│  /test       → pnpm test:fast                                  │
│  /lint       → pnpm check                                      │
│  [+ Add Command]                                               │
└────────────────────────────────────────────────────────────────┘
```

### 5.4 RPC Methods del Tab Workspaces

| Metodo                          | Params                                  | Respuesta                     |
| ------------------------------- | --------------------------------------- | ----------------------------- |
| `jb.workspaces.list`            | `{}`                                    | `{ workspaces: Workspace[] }` |
| `jb.workspaces.get`             | `{ id: string }`                        | `{ workspace: Workspace }`    |
| `jb.workspaces.create`          | `{ name, path, systemPrompt?, tools? }` | `{ workspace: Workspace }`    |
| `jb.workspaces.update`          | `{ id, patch: Partial<Workspace> }`     | `{ workspace: Workspace }`    |
| `jb.workspaces.delete`          | `{ id: string }`                        | `{ ok: true }`                |
| `jb.workspaces.enable`          | `{ id, enabled: boolean }`              | `{ workspace: Workspace }`    |
| `jb.workspaces.commands.list`   | `{ workspaceId }`                       | `{ commands: Command[] }`     |
| `jb.workspaces.commands.create` | `{ workspaceId, name, command }`        | `{ command: Command }`        |
| `jb.workspaces.commands.delete` | `{ workspaceId, name }`                 | `{ ok: true }`                |

### 5.5 Tipo Workspace

```typescript
type Workspace = {
  id: string;
  name: string;
  path: string;
  systemPrompt?: string;
  allowedTools?: string[];
  mode?: "confirm" | "auto" | "plan";
  enabled: boolean;
  focused: boolean;
  contextPercent: number;
  status: "running" | "stopped" | "error";
  lastMessage?: string;
  lastMessageAt?: number;
  commands?: Command[];
};

type Command = {
  name: string; // sin slash, ej: "deploy"
  command: string; // shell command o instruccion
  description?: string;
};
```

---

## 6. Arquitectura del WebSocket Server

### 6.1 Decision: WS Minimo en jorchbot-start.ts

**NO usar** el gateway completo de OpenClaw (`server-http.ts` + `server-ws.ts`). En su lugar,
agregar un WebSocket server minimo al Express app existente de `jorchbot-start.ts`.

**Razones**:

- El gateway completo de OpenClaw tiene dependencias pesadas (multi-agente, canvas, a2ui, etc.)
- JorchBot solo necesita ~20 metodos RPC propios + los ~20 reutilizables
- Mantener el gateway liviano y especifico

### 6.2 Implementacion Propuesta

```typescript
// src/gateway/jorchbot-ws.ts — WebSocket server minimo
import { WebSocketServer } from "ws";
import type { Server } from "node:http";

export function attachWebSocket(httpServer: Server, handlers: RpcHandlers) {
  const wss = new WebSocketServer({ server: httpServer, path: "/" });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === "req") {
        const handler = handlers[frame.method];
        if (!handler) {
          ws.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "METHOD_NOT_FOUND", message: `Unknown: ${frame.method}` },
            }),
          );
          return;
        }
        try {
          const result = await handler(frame.params);
          ws.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: result }));
        } catch (err) {
          ws.send(
            JSON.stringify({
              type: "res",
              id: frame.id,
              ok: false,
              error: { code: "INTERNAL", message: String(err) },
            }),
          );
        }
      }
    });
  });

  return wss;
}
```

### 6.3 Flujo de Conexion

```
Browser → ws://device.ts.net:18789 → jorchbot-start.ts (HTTP upgrade)
       → WebSocket handshake
       → Client sends { type: "req", method: "connect", params: {...} }
       → Server sends { type: "res", ok: true, payload: hello-ok }
       → Bidireccional: requests + events
```

---

## 7. Sub-fases de Implementacion

### 7.1 Sub-fase 6A: Montar la Control UI en el Gateway

**Objetivo**: Servir la SPA desde `jorchbot-start.ts`.

**Tareas**:

- Importar `handleControlUiHttpRequest` de `src/gateway/control-ui.ts`
- Montar como middleware en el Express app (despues de `/webhooks` y `/health`)
- Adaptar bootstrap config: `assistantName: "JorchBot"`
- Cambiar `CONTROL_UI_BOOTSTRAP_CONFIG_PATH` a `/__jorchbot/...`
- Verificar que `http://localhost:18789/` carga la UI

**Dependencias**: Phase 1 completada (gateway basico funcionando)
**Esfuerzo**: 4-6 horas

### 7.2 Sub-fase 6B: Re-branding

**Objetivo**: Cambiar toda referencia a "OpenClaw" por "JorchBot".

**Tareas**:

- Aplicar TODOS los cambios del inventario de branding (Seccion 3)
- Crear favicon/logo para JorchBot
- Elegir paleta de colores (sugerencia: indigo `#6366f1` en vez de rojo `#ff5c5c`)
- Cambiar custom element `<openclaw-app>` → `<jorchbot-app>`
- Actualizar localStorage keys

**Dependencias**: 6A completada
**Esfuerzo**: 4-6 horas

### 7.3 Sub-fase 6C: WebSocket Server Minimo

**Objetivo**: Implementar WS server en `jorchbot-start.ts` compatible con el protocolo de la UI.

**Tareas**:

- Crear `src/gateway/jorchbot-ws.ts` con WebSocket server
- Implementar protocolo request/response (mismo formato que OpenClaw)
- Implementar `connect` handler con hello-ok
- Implementar event broadcasting (para push de estados)
- Implementar metodos basicos: `health`, `status`, `config.get`, `config.set`, `logs.tail`

**Dependencias**: 6A completada
**Esfuerzo**: 8-10 horas

### 7.4 Sub-fase 6D: Ocultar Tabs Innecesarios

**Objetivo**: Mostrar solo tabs relevantes para JorchBot.

**Tareas**:

- Implementar mecanismo de ocultamiento configurable en `navigation.ts`
- Ocultar: chat, instances, usage, cron, agents, skills
- NO eliminar codigo — solo filtrar en la vista
- Verificar que las rutas ocultas no causan errores si se acceden directamente

**Dependencias**: 6A, 6B completadas
**Esfuerzo**: 2-3 horas

### 7.5 Sub-fase 6E: Adaptar Tabs Existentes

**Objetivo**: Conectar overview, sessions, channels, config, logs, debug a datos de JorchBot.

**Tareas**:

- **Overview**: Mostrar sesiones JorchBot, contexto %, tunnels activos, uptime
- **Sessions**: Conectar a `sessions` table de JorchBot DB + datos de ClaudeRunner
- **Channels**: Mostrar estado de Kapso (conectado/error), webhook URL
- **Config**: Cargar `jorchbot.json` (ambas capas: gateway + JorchBot)
- **Logs**: Conectar a logs del gateway JorchBot
- **Debug**: Adaptar para mostrar health/status de JorchBot

**Dependencias**: 6C completada (WebSocket con metodos RPC)
**Esfuerzo**: 10-14 horas

### 7.6 Sub-fase 6F: Tab Workspaces (nuevo)

**Objetivo**: Implementar el tab completo descrito en Seccion 5.

**Tareas**:

- Crear componente Lit `jb-workspaces` con CRUD de workspaces
- Implementar RPC handlers: `jb.workspaces.*`
- Barra de contexto visual (gauge verde/amarillo/rojo)
- Focus indicator visual
- Acciones rapidas: switch focus, compact, stop, restart
- CRUD de comandos personalizados por workspace

**Dependencias**: 6E completada + Phase 2 (multi-session)
**Esfuerzo**: 12-16 horas

### 7.7 Sub-fase 6G: Tab Tunnels (Phase 4+)

**Objetivo**: Panel de gestion de tunnels Tailscale.

**Tareas**:

- Crear componente Lit `jb-tunnels`
- Implementar RPC handlers: `jb.tunnels.*`
- Lista de tunnels activos con URLs clickeables
- Crear/detener tunnels desde la GUI
- Indicador privado (Serve) vs publico (Funnel)

**Dependencias**: Phase 4 completada (tunnel manager)
**Esfuerzo**: 6-8 horas

### 7.8 Sub-fase 6H: Tailscale Serve para la GUI

**Objetivo**: Auto-exponer la GUI via Tailscale Serve al iniciar JorchBot.

**Tareas**:

- Al iniciar gateway, ejecutar `tailscale serve --bg https+insecure://localhost:18789`
- Mostrar URL de Tailscale en terminal al iniciar
- Implementar comando `/gui` en WhatsApp para enviar la URL
- Verificar acceso desde dispositivo movil en el tailnet

**Dependencias**: Phase 4 completada + 6A-6F completadas
**Esfuerzo**: 4-6 horas

---

## 8. Relacion con Otras Fases

| Fase        | Relacion con GUI (Fase 6)                                           | Sub-fase afectada  |
| ----------- | ------------------------------------------------------------------- | ------------------ |
| **Phase 1** | Gateway basico + ClaudeRunner — prerequisito para montar UI         | 6A                 |
| **Phase 2** | SessionManager, FocusModel — datos para tab Workspaces              | 6F                 |
| **Phase 3** | Jorchfile engine — datos para tab Jorchfile (futuro 6I)             | Post-6H            |
| **Phase 4** | **Prerequisito directo** — tunnels para acceso remoto + tab tunnels | 6G, 6H             |
| **Phase 5** | Modos avanzados, approval queue — mejoras UX en Workspaces          | 6F (refinamiento)  |
| **Phase 7** | Telegram — aparece en tab Channels                                  | 6E (actualizacion) |
| **Phase 8** | TOTP 2FA — integrar en UI para config de seguridad                  | Post-6H            |

---

## 9. Estimacion de Esfuerzo

| Sub-fase  | Descripcion              | Horas estimadas |
| --------- | ------------------------ | :-------------: |
| 6A        | Montar UI en gateway     |       4-6       |
| 6B        | Re-branding              |       4-6       |
| 6C        | WebSocket server minimo  |      8-10       |
| 6D        | Ocultar tabs             |       2-3       |
| 6E        | Adaptar tabs existentes  |      10-14      |
| 6F        | Tab Workspaces (nuevo)   |      12-16      |
| 6G        | Tab Tunnels (nuevo)      |       6-8       |
| 6H        | Tailscale Serve para GUI |       4-6       |
| **Total** |                          | **50-69 horas** |

---

## 10. Anti-patterns — Que NO Hacer

1. **No reconstruir la UI en React/Vue/Svelte** — Lit ya funciona. El costo de migracion no justifica el beneficio. Lit es mas ligero y la UI ya tiene ~12 tabs funcionando.

2. **No crear una app separada en otro puerto** — La UI DEBE servirse del mismo puerto del gateway (18789). Un solo punto de entrada simplifica Tailscale Serve y evita CORS.

3. **No eliminar codigo de OpenClaw** — Los tabs y metodos RPC que no se usan se OCULTAN via config, no se eliminan. Esto preserva la capacidad de cherry-pick con upstream.

4. **No usar el gateway completo de OpenClaw** — Tiene demasiadas dependencias. JorchBot necesita un WS server propio que implemente solo los metodos necesarios.

5. **No bloquear otras fases esperando la GUI** — WhatsApp es el canal principal. La GUI es complementaria para monitoreo y configuracion. Las fases 1-5 son mas prioritarias.

6. **No implementar auth propia** — Tailscale Serve maneja el acceso a nivel de red. Solo dispositivos en el tailnet pueden acceder. Evaluar device auth de OpenClaw para acceso sin Tailscale en desarrollo local.

7. **No hardcodear "JorchBot" en strings** — Usar i18n y bootstrap config (`assistantName`) para que el nombre sea configurable.

8. **No mezclar datos de OpenClaw y JorchBot** — Los metodos RPC de JorchBot usan el namespace `jb.*` para evitar colisiones con metodos existentes.

---

## 11. Archivos Clave de Referencia

| Archivo                              | Rol en el sistema                                      |
| ------------------------------------ | ------------------------------------------------------ |
| `src/gateway/control-ui.ts`          | Handler HTTP standalone que sirve la SPA               |
| `src/gateway/control-ui-contract.ts` | Path del bootstrap config (`/__openclaw/...`)          |
| `src/gateway/server-http.ts:588-606` | Donde se monta la UI en el gateway de OpenClaw         |
| `src/infra/control-ui-assets.ts`     | Resolucion de assets (`dist/control-ui/`)              |
| `ui/src/ui/navigation.ts`            | Definicion de tabs y grupos                            |
| `ui/src/ui/app.ts`                   | Root component `<openclaw-app>`                        |
| `ui/src/ui/app-render.ts`            | Render principal con branding                          |
| `ui/src/ui/app-gateway.ts`           | Conexion WebSocket + manejo de eventos                 |
| `ui/src/ui/gateway.ts`               | Cliente WebSocket del browser (`GatewayBrowserClient`) |
| `ui/src/ui/storage.ts`               | localStorage keys para settings                        |
| `ui/src/ui/device-auth.ts`           | localStorage keys para device auth                     |
| `ui/src/styles/base.css`             | CSS variables (colores, tipografia)                    |
| `ui/src/i18n/lib/translate.ts`       | i18n manager con localStorage key                      |
| `ui/index.html`                      | HTML entry point con titulo y custom element           |
| `src/gateway/jorchbot-start.ts`      | Gateway actual de JorchBot (a extender)                |
