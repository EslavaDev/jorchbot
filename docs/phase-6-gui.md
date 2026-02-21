# Fase 6 - GUI de Configuracion

> **Estado**: Pendiente
> **Dependencia**: Fase 4
> **Entregable**: Dashboard web accesible via tailnet (VPN mesh) + Funnel opcional
> **Al terminar**: Abres `http://<device>.tailnet.ts.net:18789` desde tu celular (tailnet) y ves workspaces activos, logs en tiempo real, tunnels, y puedes editar el Jorchfile visualmente. Con `gui.funnel=true` tambien accesible desde internet con device auth.
> **Referencia tecnica**: [gui-jorchbot.md](./gui-jorchbot.md) — hallazgos completos de auditoria

---

## Nota Arquitectural (rev. 3 — Post-auditoria Control UI)

> La Control UI de OpenClaw es una **SPA madura en Lit 3.x** servida como assets
> estaticos desde el **mismo puerto del gateway (18789)** — NO basePort+2.
>
> **Framework**: Lit 3.3.2 (web components nativos). NO React/Vue/Svelte.
> **Build**: Vite 7.x → `dist/control-ui/` → gateway sirve assets.
> **Comunicacion**: WebSocket RPC (JSON frames: `req` → `res`, server-push `event`).
> **Tabs existentes**: 12 tabs en 4 grupos. JorchBot oculta 6, adapta 6, agrega 3.
>
> **Capa 1 (reusar)**: Control UI framework (Lit + Vite), asset serving desde gateway,
> WebSocket RPC protocol, device auth (ECDSA P-256), i18n, CSS system.
>
> **Capa 2 (construir)**: WebSocket server minimo en `jorchbot-start.ts`,
> re-branding OpenClaw → JorchBot, tabs nuevos (workspaces, tunnels, jorchfile),
> adaptacion de tabs existentes, RPC handlers para datos de JorchBot.
>
> **Seguridad (`gui.funnel`)**: La GUI siempre es accesible via **VPN mesh**
> de Tailscale (MagicDNS, sin Serve). La exposicion via **Funnel (internet)**
> es configurable con `gui.funnel` en `config.json` (default: `false`):
>
> - `gui.funnel = false`: middleware bloquea IPs fuera del rango CGNAT
>   (100.64.0.0/10). Solo dispositivos en el tailnet acceden a GUI/WS.
> - `gui.funnel = true`: GUI publica via Funnel. Device auth (ECDSA P-256,
>   ya existe en OpenClaw) protege GUI y WebSocket.
> - En ambos modos: `/webhooks/*` y `/health` siempre pasan sin restriccion
>   (Kapso necesita webhooks publicos).
>
> **FunnelProxy**: El proxy de dev services vive en un servidor separado
> (puerto 8443) con todas las rutas bajo prefijo `/proxy/**`
> (ej: `/proxy/frontend`). Esto evita colision con las rutas de la SPA
> en el gateway. Ver Fase 4 para detalles.

---

## Objetivo

Extender la Control UI existente de OpenClaw (Lit 3.x) para incluir un dashboard
completo de JorchBot: gestion de workspaces, logs en tiempo real, tunnels,
editor de Jorchfile, y configuracion del sistema. Todo se comunica via
WebSocket RPC — sin endpoints REST adicionales.

---

## Entregables

1. Control UI montada y servida desde el gateway JorchBot (puerto 18789)
2. Re-branding completo OpenClaw → JorchBot (40+ cambios)
3. WebSocket server minimo con protocolo compatible
4. **Device auth activado** (gateway publico via Funnel → requiere auth)
5. Tabs ocultos (6 tabs irrelevantes filtrados, no eliminados)
6. Tabs adaptados (overview, sessions, channels, config, debug, logs)
7. Tab **Workspaces** (nuevo — gestion interactiva de proyectos)
8. Tab **Tunnels** (expandido — Serve/Funnel + FunnelProxy routes + `/proxy/` prefix)
9. Tab **Devices** (extiende nodes — blacklist, acceso, detalle extendido)
10. Tab **Jorchfile** (nuevo — editor de configuracion interna)
11. Comando `/gui` (envia URL al chat)
12. Mobile-responsive (usable desde celular)

---

## Estrategia de Tabs

La Control UI tiene 12 tabs en 4 grupos. JorchBot los maneja asi:

| Tab original   | Decision                | Detalle                                                   |
| -------------- | ----------------------- | --------------------------------------------------------- |
| **overview**   | MANTENER (adaptado)     | Dashboard con workspaces JorchBot, contexto %, tunnels    |
| **sessions**   | MANTENER (adaptado)     | Lista de sesiones JorchBot con focus model                |
| **channels**   | MANTENER (adaptado)     | Estado de Kapso/Telegram                                  |
| **config**     | MANTENER                | Editor visual de config (`jorchbot.json` + `config.json`) |
| **debug**      | MANTENER                | Diagnosticos internos del gateway                         |
| **logs**       | MANTENER                | Log viewer en tiempo real                                 |
| **nodes**      | RENOMBRAR → **devices** | Extiende nodes con blacklist, detalle, gestion de acceso  |
| **chat**       | OCULTAR                 | JorchBot usa WhatsApp, no chat web                        |
| **instances**  | OCULTAR                 | Presencia de instancias OpenClaw, no aplica               |
| **usage**      | OCULTAR                 | Simplificado en overview                                  |
| **cron**       | OCULTAR                 | No relevante                                              |
| **agents**     | OCULTAR                 | Multi-agente OpenClaw, no aplica directamente             |
| **skills**     | OCULTAR                 | Skills OpenClaw, no aplica directamente                   |
| **workspaces** | AGREGAR                 | **Nuevo** — gestion completa de proyectos                 |
| **tunnels**    | AGREGAR                 | **Nuevo** — Serve + Funnel + FunnelProxy route mgmt       |
| **jorchfile**  | AGREGAR (Phase 3+)      | **Nuevo** — editor de Jorchfile                           |

**Implementacion del ocultamiento** — via config, NO eliminando codigo:

```typescript
// ui/src/ui/navigation.ts
const HIDDEN_TABS: Set<Tab> = new Set(["chat", "instances", "usage", "cron", "agents", "skills"]);
// "nodes" tab is NOT hidden — it's renamed to "devices" and extended with blacklist, etc.

export const VISIBLE_TAB_GROUPS = TAB_GROUPS.map((group) => ({
  ...group,
  tabs: group.tabs.filter((tab) => !HIDDEN_TABS.has(tab)),
})).filter((group) => group.tabs.length > 0);
```

---

## Comunicacion: WebSocket RPC (NO REST)

Toda la comunicacion GUI ↔ backend es via **WebSocket RPC**, consistente con
la Control UI existente de OpenClaw. NO se crean endpoints REST adicionales.

### Protocolo

```
Browser → ws://<host>:18789 → jorchbot-start.ts (HTTP upgrade)
       → WebSocket handshake
       → Client: { type: "req", id: 1, method: "connect", params: {...} }
       → Server: { type: "res", id: 1, ok: true, payload: hello-ok }
       → Bidireccional: requests + server-push events
```

### RPC Methods — Clasificacion

**REUSAR (21 metodos)** — OpenClaw los maneja sin cambios:
`connect`, `health`, `status`, `config.get`, `config.set`, `config.apply`,
`config.schema`, `logs.tail`, `device.pair.*`, `exec.approval.*`, etc.

**ADAPTAR (11 metodos)** — existen en OpenClaw, JorchBot necesita wrapper:
`sessions.list`, `sessions.patch`, `sessions.delete`, `sessions.compact`,
`sessions.usage`, `channels.status`, `channels.logout`, `config.patch`, etc.

**NUEVOS (~20 metodos)** — JorchBot-especificos con namespace `jb.*`:

| Metodo                          | Funcion                                    |
| ------------------------------- | ------------------------------------------ |
| `jb.status`                     | Estado global (uptime, sesiones, contexto) |
| `jb.session.focus`              | Cambiar sesion focused                     |
| `jb.session.compact`            | Trigger compaction                         |
| `jb.session.stop`               | Detener sesion                             |
| `jb.session.restart`            | Reiniciar sesion                           |
| `jb.workspaces.list`            | Listar workspaces                          |
| `jb.workspaces.get`             | Detalle de un workspace                    |
| `jb.workspaces.create`          | Crear workspace                            |
| `jb.workspaces.update`          | Modificar workspace                        |
| `jb.workspaces.delete`          | Eliminar workspace                         |
| `jb.workspaces.enable`          | Habilitar/deshabilitar                     |
| `jb.workspaces.commands.list`   | Listar comandos custom                     |
| `jb.workspaces.commands.create` | Crear comando custom                       |
| `jb.workspaces.commands.delete` | Eliminar comando custom                    |
| `jb.tunnels.list`               | Listar tunnels activos (Serve + Funnel)    |
| `jb.tunnels.create`             | Crear tunnel (Serve/Funnel)                |
| `jb.tunnels.delete`             | Cerrar tunnel                              |
| `jb.proxy.routes.list`          | Listar rutas del FunnelProxy               |
| `jb.proxy.routes.add`           | Agregar ruta al FunnelProxy (/proxy/\*)    |
| `jb.proxy.routes.remove`        | Eliminar ruta del FunnelProxy              |
| `jb.proxy.status`               | Estado del FunnelProxy (running, port)     |
| `jb.devices.block`              | Agregar dispositivo a blacklist (nuevo)    |
| `jb.devices.unblock`            | Quitar dispositivo de blacklist (nuevo)    |
| `jb.jorchfile.get`              | Obtener Jorchfile parseado                 |
| `jb.jorchfile.set`              | Guardar Jorchfile                          |
| `jb.jorchfile.commands`         | Listar comandos disponibles                |

**Eventos nuevos** (server-push):

| Evento              | Funcion                                        |
| ------------------- | ---------------------------------------------- |
| `jb.session.output` | Streaming de output de ClaudeRunner            |
| `jb.session.state`  | Cambio de estado (contexto%, modo, focused)    |
| `jb.tunnel.state`   | Cambio de estado de tunnel                     |
| `jb.proxy.state`    | Cambio en rutas del FunnelProxy                |
| `jb.device.paired`  | Nuevo dispositivo aprobado/rechazado/bloqueado |
| `jb.approval`       | Aprobacion pendiente de JorchBot               |

**OMITIR (~60 metodos)** — No relevantes para JorchBot (agents, skills,
cron, nodes, tts, chat, web login, wizard). No se implementan handlers,
pero el codigo de OpenClaw no se elimina.

> Ver [gui-jorchbot.md](./gui-jorchbot.md) seccion 2 para el inventario
> completo de los 104 metodos RPC del gateway.

---

## Sub-fases de Implementacion

### 6A — Montar la Control UI en el Gateway

**Objetivo**: Servir la SPA desde `jorchbot-start.ts`.

- [ ] Importar `handleControlUiHttpRequest` de `src/gateway/control-ui.ts`
- [ ] Montar como middleware en Express (despues de `/webhooks` y `/health`)
- [ ] Adaptar bootstrap config: `assistantName: "JorchBot"`
- [ ] Cambiar `CONTROL_UI_BOOTSTRAP_CONFIG_PATH` a `/__jorchbot/control-ui-config.json`
- [ ] Verificar que `http://localhost:18789/` carga la UI

**Dependencias**: Phase 1 completada (gateway basico funcionando)
**Esfuerzo**: 4-6 horas
**Criterio de aceptacion**: La SPA carga en `http://localhost:18789/` servida desde el gateway JorchBot.

---

### 6B — Re-branding OpenClaw → JorchBot

**Objetivo**: Cambiar toda referencia visual y funcional de "OpenClaw" a "JorchBot".

- [ ] HTML: titulo, custom element `<openclaw-app>` → `<jorchbot-app>`
- [ ] Root component: clase `OpenClawApp` → `JorchBotApp`
- [ ] Render/branding: logo alt text, brand title, subtitle, docs link
- [ ] CSS: accent color `#ff5c5c` → `#6366f1` (indigo), primary, light mode
- [ ] CSS: selector `openclaw-app` → `jorchbot-app`
- [ ] LocalStorage keys: `openclaw.*` → `jorchbot.*` (3 archivos)
- [ ] i18n: locale key `openclaw.i18n.locale` → `jorchbot.i18n.locale`
- [ ] i18n: referencias a `~/.openclaw/openclaw.json` → `~/.jorchbot/config.json`
- [ ] Gateway client name: `openclaw-control-ui` → `jorchbot-control-ui`
- [ ] Server-side: `/__openclaw/...` → `/__jorchbot/...`
- [ ] Views: referencias a CLI/docs de OpenClaw → equivalentes JorchBot
- [ ] Export filenames: `openclaw-usage-*.csv` → `jorchbot-usage-*`
- [ ] Favicon/assets: reemplazar con logo JorchBot
- [ ] Tests: actualizar `window.__OPENCLAW_*` → `window.__JORCHBOT_*`

> Ver [gui-jorchbot.md](./gui-jorchbot.md) seccion 3 para el inventario
> exacto de 40+ cambios con archivo, linea, y valor actual/nuevo.

**Dependencias**: 6A completada
**Esfuerzo**: 4-6 horas
**Criterio de aceptacion**: La UI muestra "JorchBot" en titulo, branding, colores, y no queda referencia visible a "OpenClaw".

---

### 6C — WebSocket Server Minimo

**Objetivo**: Implementar WS server en `jorchbot-start.ts` compatible con el protocolo de la UI.

**Decision**: NO usar el gateway completo de OpenClaw (`server-http.ts` + `server-ws.ts`)
ya que tiene dependencias pesadas (multi-agente, canvas, a2ui). JorchBot necesita
un WS server propio que implemente solo los ~40 metodos necesarios.

- [ ] Crear `src/gateway/jorchbot-ws.ts` con WebSocket server (`ws` library)
- [ ] Implementar protocolo request/response (formato: `{type:"req", id, method, params}` → `{type:"res", id, ok, payload}`)
- [ ] Implementar `connect` handler con challenge-response y hello-ok
- [ ] Implementar event broadcasting (server-push para estados en tiempo real)
- [ ] Implementar metodos basicos: `health`, `status`, `config.get`, `config.set`, `config.apply`, `config.schema`, `logs.tail`
- [ ] Auto-reconnect handling (la UI ya tiene reconnect con backoff exponencial)

**Dependencias**: 6A completada
**Esfuerzo**: 8-10 horas
**Criterio de aceptacion**: La UI se conecta via WebSocket, completa handshake, y puede ejecutar `config.get`.

---

### 6D — Device Auth (gateway publico)

**Objetivo**: Proteger la GUI y WebSocket del acceso no autorizado. El gateway
(18789) esta expuesto via Tailscale Funnel porque los webhooks de Kapso y el
WebSocket lo requieren. Sin auth, cualquier persona en internet podria acceder
a la GUI y controlar sesiones de Claude Code.

**Arquitectura de auth**:

```
Gateway (18789) — publico via Funnel:
  /webhooks/*           → SIN auth (Kapso verifica con su token)
  /health               → SIN auth
  /__jorchbot/*         → SIN auth (bootstrap config para la SPA)
  WebSocket connect     → CON auth (ECDSA challenge-response en handshake)
  /* (GUI assets + SPA) → CON auth (device auth cookie/token)
```

**Nota sobre FunnelProxy**: El proxy de dev services (FunnelProxy) vive en un
servidor separado en puerto 8443 con rutas bajo `/proxy/**`. No comparte puerto
con el gateway, asi que no hay colision con la SPA. Ver Fase 4.

**Config — `gui.funnel`**:

```jsonc
// ~/.jorchbot/config.json
{
  "gui": {
    "funnel": false, // default: solo accesible via tailnet
  },
}
```

- `gui.funnel = false` (default): GUI y WebSocket solo accesibles desde IPs del tailnet
  (rango CGNAT 100.64.0.0/10). Webhooks y health siempre pasan. Mas seguro — no requiere
  device auth para uso normal desde el celular en el tailnet.
- `gui.funnel = true`: GUI y WebSocket accesibles desde internet via Funnel. Device auth
  (ECDSA P-256) obligatorio para todas las rutas excepto webhooks/health.

**Middleware de acceso (un solo puerto, 18789)**:

```
Request llega a 18789:
  1. /webhooks/*, /health → SIEMPRE pasa (Kapso necesita webhooks publicos)
  2. /__jorchbot/*        → SIEMPRE pasa (bootstrap config para la SPA)
  3. gui.funnel = true    → Permite todo con device auth (ECDSA challenge)
  4. gui.funnel = false   → Verifica IP:
                             - IP en 100.64.0.0/10 (tailnet) → permite
                             - IP fuera de rango → 403 Forbidden
```

**Deteccion de IP tailnet**:

```typescript
// src/gateway/tailnet-ip.ts
const TAILSCALE_CGNAT = { prefix: 0x64400000, mask: 0xffc00000 }; // 100.64.0.0/10

export function isTailnetIp(ip: string): boolean {
  // IPv4-mapped IPv6 (::ffff:100.x.x.x) → extract v4 part
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  const parts = v4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;
  const num = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  return (num & TAILSCALE_CGNAT.mask) === TAILSCALE_CGNAT.prefix;
}
```

**Tareas**:

- [ ] Agregar campo `gui.funnel` al schema Zod de config (`src/config/jorchbot-config.ts`)
- [ ] Crear `src/gateway/tailnet-ip.ts` con `isTailnetIp()` helper
- [ ] Implementar middleware Express que:
  - Permite `/webhooks/*`, `/health`, `/__jorchbot/*` sin auth (siempre)
  - Si `gui.funnel = false`: permite solo IPs en 100.64.0.0/10, rechaza el resto con 403
  - Si `gui.funnel = true`: requiere device auth para todas las demas rutas HTTP
- [ ] Activar device auth de OpenClaw (`src/gateway/device-auth.ts`) en el gateway JorchBot
- [ ] Implementar challenge-response en el `connect` handler del WebSocket (6C)
- [ ] Aplicar misma logica de IP/auth en el upgrade handler del WebSocket
- [ ] Flujo de pairing: primer acceso desde browser muestra codigo de 6 digitos,
      el owner aprueba desde CLI (`jorchbot device approve <codigo>`)
- [ ] Persistir dispositivos aprobados en DB o config
- [ ] Verificar que la UI de OpenClaw maneja el flujo de device auth correctamente
      (ya tiene `ui/src/ui/device-auth.ts` y `ui/src/ui/device-identity.ts`)
- [ ] Test: verificar que con `gui.funnel=false`, IP no-tailnet recibe 403
- [ ] Test: verificar que con `gui.funnel=true`, IP no-tailnet pasa con device auth
- [ ] Test: verificar que `/webhooks/*` siempre pasa independientemente de config

**Dependencias**: 6C completada (WebSocket server)
**Esfuerzo**: 8-10 horas
**Criterio de aceptacion**: Con `gui.funnel=false`, solo IPs del tailnet acceden a la GUI. Con `gui.funnel=true`, browser nuevo pide pairing, browser aprobado accede. Webhooks siempre funcionan sin auth. Cambiar `gui.funnel` via config no requiere reinicio (hot-reload via `config.apply`).

---

### 6E — Ocultar Tabs Innecesarios

**Objetivo**: Mostrar solo tabs relevantes para JorchBot.

- [ ] Implementar `HIDDEN_TABS` set en `navigation.ts`
- [ ] Ocultar: chat, instances, usage, cron, agents, skills
- [ ] NO eliminar codigo — solo filtrar en la vista (preservar upstream merge-ability)
- [ ] Verificar que rutas ocultas no causan errores si se acceden directamente (URL manual)
- [ ] Actualizar TAB_GROUPS para incluir nuevos tabs de JorchBot

**Dependencias**: 6A, 6B completadas
**Esfuerzo**: 2-3 horas
**Criterio de aceptacion**: Solo se ven tabs relevantes. Acceso directo a tabs ocultos no causa crash.

---

### 6F — Adaptar Tabs Existentes

**Objetivo**: Conectar overview, sessions, channels, config, logs, debug a datos de JorchBot.

- [ ] **Overview**: Mostrar workspaces JorchBot, contexto %, tunnels activos, uptime
- [ ] **Sessions**: Conectar a tabla `sessions` de JorchBot DB + datos de ClaudeRunner
- [ ] **Channels**: Mostrar estado de Kapso (conectado/error), webhook URL
- [ ] **Config**: Cargar dos capas: `jorchbot.json` (gateway) + `config.json` (JorchBot)
- [ ] **Logs**: Conectar a logs del gateway JorchBot
- [ ] **Debug**: Adaptar health/status para JorchBot

Para cada tab, implementar los RPC handlers correspondientes (seccion "ADAPTAR" de los metodos).

**Dependencias**: 6C, 6D completadas (WebSocket + auth)
**Esfuerzo**: 10-14 horas
**Criterio de aceptacion**: Tab overview muestra workspaces con context % en tiempo real. Tab config puede editar y guardar configuracion.

---

### 6G — Tab Workspaces (nuevo)

**Objetivo**: Panel completo para gestionar los workspaces/proyectos de JorchBot.

**Funcionalidades**:

| Funcion                    | Descripcion                                          |
| -------------------------- | ---------------------------------------------------- |
| **Crear**                  | Nombre, path, system prompt, allowed tools           |
| **Modificar**              | Cambiar path, prompt, modo, tools                    |
| **Renombrar**              | Cambiar nombre del workspace                         |
| **Habilitar/Deshabilitar** | Pausar sin destruir (conserva config y sesion)       |
| **Eliminar**               | Eliminar workspace completo                          |
| **Comandos**               | Crear/eliminar comandos personalizados por workspace |
| **Estado en tiempo real**  | Contexto %, modo, focused/background, ultimo mensaje |
| **Acciones rapidas**       | Switch focus, compact, stop, restart                 |

**Layout visual**:

```
+----------------------------------------------------------------+
|  Workspaces                                        [+ Create]   |
+----------------------------------------------------------------+
|                                                                  |
|  +------------------------------------------+  +---------------+|
|  | * frontend                    [focused]  |  | o backend     ||
|  | /home/dev/my-app/frontend                |  | /home/d...    ||
|  | Context: ============------ 45%          |  | Context: 8%   ||
|  | Mode: confirm+verbose                    |  | Mode: auto    ||
|  | Last: "Fixed CSS issue" (2m ago)         |  | Last: 15m     ||
|  |                                          |  |               ||
|  | [Switch Focus] [Compact] [Stop] [gear]   |  | [Focus] [gear]||
|  +------------------------------------------+  +---------------+|
|                                                                  |
|  +------------------------------------------+                    |
|  | . api-service              [disabled]    |                    |
|  | /home/dev/api-service                    |                    |
|  | Paused -- [Enable] [Delete]              |                    |
|  +------------------------------------------+                    |
|                                                                  |
|  -- Commands (frontend) --                                       |
|  /deploy     -> pnpm build && vercel deploy                      |
|  /test       -> pnpm test:fast                                   |
|  /lint       -> pnpm check                                       |
|  [+ Add Command]                                                 |
+----------------------------------------------------------------+
```

**Tipo Workspace**:

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

**Tareas**:

- [ ] Crear componente Lit `jb-workspaces`
- [ ] Implementar RPC handlers: `jb.workspaces.*` (9 metodos)
- [ ] Barra de contexto visual (gauge verde/amarillo/rojo)
- [ ] Focus indicator visual (enfocada vs background)
- [ ] Acciones rapidas: switch focus, compact, stop, restart
- [ ] CRUD de comandos personalizados por workspace
- [ ] Auto-refresh via WebSocket events (`jb.session.state`)

**Dependencias**: 6F completada + Phase 2 (multi-session)
**Esfuerzo**: 12-16 horas
**Criterio de aceptacion**: Crear un workspace desde la GUI, verlo en la lista, cambiar focus, ver context % actualizado en tiempo real.

---

### 6H — Tab Tunnels + FunnelProxy Management

**Objetivo**: Panel completo de gestion de tunnels Y rutas del FunnelProxy.

El tab tiene dos secciones:

**Seccion 1 — Tailscale Tunnels (Serve/Funnel)**:

- [ ] Crear componente Lit `jb-tunnels`
- [ ] Implementar RPC handlers: `jb.tunnels.*` (3 metodos)
- [ ] Lista de tunnels activos con URLs clickeables
- [ ] Indicador privado (Serve) vs publico (Funnel)
- [ ] Crear/detener tunnels desde la GUI
- [ ] Health status en tiempo real via `jb.tunnel.state` events

**Seccion 2 — FunnelProxy Routes (reverse proxy)**:

- [ ] Implementar RPC handlers: `jb.proxy.*` (4 metodos)
- [ ] Lista de rutas registradas en el FunnelProxy con target y health
- [ ] Agregar ruta desde la GUI (path, target port, proyecto)
- [ ] Eliminar ruta desde la GUI
- [ ] Estado del FunnelProxy (running/stopped, puerto, numero de rutas)
- [ ] Health check visual por ruta (upstream responding?)
- [ ] Real-time via `jb.proxy.state` events

**Migración `/proxy/` prefix** (Phase 4 ya está implementada, el cambio va aquí):

- [ ] Modificar `FunnelProxy.addRoute()` en `src/tunnels/funnel-proxy.ts` para
      auto-prefijar todas las rutas con `/proxy/` si no lo tienen
- [ ] Modificar `FunnelProxy.normalizePath()` para forzar el prefijo
- [ ] Actualizar `TunnelManager` para pasar rutas con `/proxy/` prefix
- [ ] Actualizar tests de `funnel-proxy.test.ts` para el nuevo comportamiento
- [ ] Migrar rutas existentes en DB (si hay tunnels con `funnelPath` sin `/proxy/`)

**Layout visual**:

```
+----------------------------------------------------------------+
|  Tunnels & Proxy                                                |
+----------------------------------------------------------------+
|                                                                  |
|  TAILSCALE TUNNELS                                              |
|  +------------------------------------------------------------+|
|  | Serve: frontend → :3000        [healthy]  [Stop]           ||
|  | Serve: backend  → :3001        [healthy]  [Stop]           ||
|  | Funnel: gateway → :18789       [healthy]  (auto, always-on)||
|  +------------------------------------------------------------+|
|  [+ Create Tunnel]                                              |
|                                                                  |
|  FUNNEL PROXY (puerto 8443)                     [Running]       |
|  +------------------------------------------------------------+|
|  | /proxy/frontend → localhost:3000  [healthy]  [Remove]      ||
|  | /proxy/demo     → localhost:5000  [timeout]  [Remove]      ||
|  +------------------------------------------------------------+|
|  [+ Add Proxy Route]                                            |
|                                                                  |
+----------------------------------------------------------------+
```

**Dependencias**: Phase 4 completada (tunnel manager + FunnelProxy)
**Esfuerzo**: 10-14 horas
**Criterio de aceptacion**: Ver tunnels + proxy routes, crear/eliminar desde GUI, health status real-time. Todas las rutas del FunnelProxy tienen prefijo `/proxy/`.

---

### 6I — Tab Devices (extiende nodes)

**Objetivo**: Renombrar y extender el tab "nodes" de OpenClaw con gestion completa
de acceso para JorchBot.

**Base heredada de nodes** (ya implementado en OpenClaw, se reutiliza):

| RPC existente            | Funcion                                 |
| ------------------------ | --------------------------------------- |
| `device.pair.list`       | Listar dispositivos pareados/pendientes |
| `device.pair.approve`    | Aprobar solicitud de pairing            |
| `device.pair.reject`     | Rechazar solicitud de pairing           |
| `device.token.rotate`    | Rotar token de dispositivo              |
| `device.token.revoke`    | Revocar token de dispositivo            |
| `exec.approval.resolve`  | Resolver aprobacion de ejecucion        |
| `exec.approvals.get/set` | Config de exec approvals                |

**Funcionalidad nueva de JorchBot** (se agrega encima):

| Funcion               | Descripcion                                                         |
| --------------------- | ------------------------------------------------------------------- |
| **Blacklist**         | Bloquear permanentemente un dispositivo (nuevo)                     |
| **Unblock**           | Quitar dispositivo de la blacklist (nuevo)                          |
| **Detalle extendido** | Nombre, ultimo acceso, IP, user-agent, historial (nuevo)            |
| **Badge pendientes**  | Notificacion visual en el tab cuando hay devices pendientes (nuevo) |
| **Gestion desde GUI** | Aprobar/rechazar sin CLI (la UI de nodes ya lo soporta, se adapta)  |

**Layout visual**:

```
+----------------------------------------------------------------+
|  Devices                                                        |
+----------------------------------------------------------------+
|                                                                  |
|  APROBADOS (3)                                                  |
|  +------------------------------------------------------------+|
|  | MacBook Pro         Last: hace 2m    IP: 100.x.x.x        ||
|  |                     [Revoke] [Block]                        ||
|  +------------------------------------------------------------+|
|  | iPhone 15           Last: hace 1h    IP: 100.x.x.x        ||
|  |                     [Revoke] [Block]                        ||
|  +------------------------------------------------------------+|
|  | Chrome Linux        Last: hace 3d    IP: 198.x.x.x        ||
|  |                     [Revoke] [Block]                        ||
|  +------------------------------------------------------------+|
|                                                                  |
|  PENDIENTES (1)                                                 |
|  +------------------------------------------------------------+|
|  | Firefox Windows     Code: 847293     IP: 203.x.x.x        ||
|  |                     [Approve] [Reject] [Block]              ||
|  +------------------------------------------------------------+|
|                                                                  |
|  BLOQUEADOS (1)                                                 |
|  +------------------------------------------------------------+|
|  | Unknown device      Blocked: hace 2d  IP: 45.x.x.x        ||
|  |                     [Unblock]                               ||
|  +------------------------------------------------------------+|
|                                                                  |
+----------------------------------------------------------------+
```

**Tareas**:

- [ ] Renombrar tab "nodes" → "devices" en `navigation.ts` (label + route)
- [ ] Adaptar componente existente de nodes para conectar con RPC de OpenClaw (`device.pair.*`, `device.token.*`)
- [ ] Implementar RPC handlers nuevos: `jb.devices.block`, `jb.devices.unblock` (2 metodos nuevos)
- [ ] Agregar seccion de blacklist al componente (dispositivos bloqueados)
- [ ] Detalle extendido por dispositivo: nombre, ultimo acceso, IP, user-agent
- [ ] Notificacion en tiempo real cuando llega nuevo device pendiente (`jb.device.paired`)
- [ ] Badge en el tab cuando hay dispositivos pendientes de aprobacion
- [ ] Persistir blacklist en DB (tabla `device_blacklist` o campo en config)
- [ ] Mantener seccion de exec approvals del tab nodes original

**Dependencias**: 6D completada (device auth activo)
**Esfuerzo**: 8-10 horas
**Criterio de aceptacion**: Ver dispositivos, aprobar desde la GUI (sin CLI), bloquear/desbloquear, revocar acceso. Badge visible cuando hay pendientes. Exec approvals siguen funcionando.

---

### 6J — Tab Jorchfile (Phase 3+)

**Objetivo**: Editor visual del Jorchfile para configuracion interna de JorchBot.

El Jorchfile define los proyectos, comandos predefinidos, y configuracion por
workspace. Este tab permite editarlo visualmente sin tocar el archivo de texto.

- [ ] Crear componente Lit `jb-jorchfile`
- [ ] Implementar RPC handlers: `jb.jorchfile.get`, `jb.jorchfile.set`, `jb.jorchfile.commands`
- [ ] Parsear Jorchfile y mostrar como formulario estructurado
- [ ] Cada PROJECT como seccion expandible
- [ ] Campos editables: path, dev, build, test, tunnel, port, instructions, approve, output
- [ ] Agregar/eliminar proyectos
- [ ] Agregar/eliminar comandos custom por proyecto
- [ ] Validacion en tiempo real (path existe, puerto valido, etc.)
- [ ] Boton "Save" que escribe el Jorchfile en disco
- [ ] Boton "Reload" que re-lee del disco
- [ ] Alternativa: toggle entre vista formulario y editor de texto plano
- [ ] El backend valida con el mismo parser que usa el Jorchfile Engine (Fase 3)

**Dependencias**: Phase 3 completada (Jorchfile engine)
**Esfuerzo**: 8-10 horas
**Criterio de aceptacion**: Editar un proyecto en la GUI y guardar actualiza el Jorchfile en disco. Hot-reload de Fase 3 lo detecta.

---

### 6K — Comando /gui + Funnel Toggle

**Objetivo**: Enviar URL de la GUI al chat y permitir togglear exposicion publica.

La GUI siempre es accesible via **VPN mesh** de Tailscale (MagicDNS resuelve
`mi-pc.tailnet.ts.net` → 100.64.x.x dentro del tailnet). No se necesita
Tailscale Serve — el gateway escucha directamente en `:18789` y cualquier
dispositivo en el tailnet puede acceder via `http://mi-pc.tailnet.ts.net:18789`.

Para exposicion publica (internet), se usa **Tailscale Funnel** controlado por
`gui.funnel` (ver 6D).

- [ ] Implementar comando `/gui` en WhatsApp para enviar la URL del gateway
- [ ] Detectar hostname MagicDNS via `tailscale status --json` (campo `Self.DNSName`)
- [ ] Mostrar URL en terminal al iniciar gateway
- [ ] Implementar `/gui funnel on|off` con **confirmacion obligatoria**:
  - El bot genera un codigo aleatorio de 4 digitos y lo envia al chat
  - El usuario debe responder con el codigo exacto para confirmar
  - Timeout de 60 segundos — si no responde, la operacion se cancela
  - Esto previene activacion accidental o por acceso no autorizado al chat
- [ ] `/gui funnel on` (confirmado): actualiza config, activa Funnel via `tailscale funnel`, activa device auth
- [ ] `/gui funnel off` (confirmado): actualiza config, desactiva Funnel, restringe a tailnet
- [ ] Respuesta muestra estado actual y URL apropiada (tailnet vs funnel)
- [ ] Verificar acceso desde dispositivo movil en el tailnet

```
User: /gui
Bot:  GUI de JorchBot:
      http://mi-pc.tailnet.ts.net:18789

      Modo: tailnet only (gui.funnel = false)
      Accesible desde cualquier dispositivo en tu tailnet.

User: /gui funnel on
Bot:  Vas a exponer la GUI a internet via Funnel.
      Esto permite acceso desde fuera del tailnet (con device auth).

      Para confirmar, responde con el codigo: 7291
      (expira en 60 segundos)

User: 7291
Bot:  GUI ahora es publica via Funnel.
      https://mi-pc.tailnet.ts.net:18789

      Device auth activado. Nuevos browsers necesitan pairing.

User: /gui funnel off
Bot:  Vas a restringir la GUI solo al tailnet.
      Se desactivara Funnel y solo IPs del tailnet podran acceder.

      Para confirmar, responde con el codigo: 4053
      (expira en 60 segundos)

User: 4053
Bot:  GUI restringida a tailnet.
      http://mi-pc.tailnet.ts.net:18789

      Solo accesible desde dispositivos en tu tailnet.
```

**Nota de seguridad**: La confirmacion con codigo previene dos escenarios:

1. Alguien con acceso temporal al chat (telefono desbloqueado) no puede
   exponer la GUI al internet con un solo mensaje.
2. Un error de dedo o comando accidental no cambia la infraestructura.

**Dependencias**: Phase 4 completada + 6A-6J completadas
**Esfuerzo**: 5-7 horas
**Criterio de aceptacion**: `/gui` envia URL funcional. `/gui funnel on|off` requiere confirmacion con codigo. La GUI es accesible desde un celular en el tailnet.

---

### 6L — Mobile Responsive

**Objetivo**: Toda la GUI funciona en pantallas de celular.

- [ ] Responsive para 320px - 428px width
- [ ] Touch-friendly: botones grandes, no hover-dependent
- [ ] Dashboard compacto para mobile
- [ ] Logs viewer con scroll touch
- [ ] Workspaces usable en mobile (cards apiladas)
- [ ] Devices y tunnels usable en mobile
- [ ] Jorchfile editor usable en mobile (formulario, no texto plano)

**Dependencias**: 6G-6J completadas
**Esfuerzo**: 4-6 horas
**Criterio de aceptacion**: La GUI es usable desde Safari/Chrome en iPhone/Android.

---

## Estimacion de Esfuerzo

| Sub-fase  | Descripcion                    | Horas estimadas  |
| --------- | ------------------------------ | :--------------: |
| 6A        | Montar UI en gateway           |       4-6        |
| 6B        | Re-branding                    |       4-6        |
| 6C        | WebSocket server minimo        |       8-10       |
| 6D        | Device auth + gui.funnel       |       8-10       |
| 6E        | Ocultar tabs                   |       2-3        |
| 6F        | Adaptar tabs existentes        |      10-14       |
| 6G        | Tab Workspaces (nuevo)         |      12-16       |
| 6H        | Tab Tunnels + FunnelProxy mgmt |      10-14       |
| 6I        | Tab Devices (extiende nodes)   |       8-10       |
| 6J        | Tab Jorchfile (nuevo)          |       8-10       |
| 6K        | Comando /gui + funnel toggle   |       5-7        |
| 6L        | Mobile responsive              |       4-6        |
| **Total** |                                | **83-112 horas** |

---

## NO se construye en esta fase

- API Keys management (Fase 8)
- TOTP 2FA (Fase 8 — device auth de esta fase es suficiente para acceso basico)
- Analytics y metricas de uso
- Temas (dark mode, etc.) — solo el theme default de la Control UI
- Notificaciones push desde la GUI
- Chat interface en la GUI (se usa WhatsApp/Telegram para eso)

---

## Anti-patterns — Que NO Hacer

1. **No reconstruir la UI en React/Vue/Svelte** — Lit 3.x ya funciona con 12 tabs.
   El costo de migracion no justifica el beneficio. Lit es mas ligero y la UI ya
   esta madura.

2. **No crear una app separada en otro puerto** — La UI DEBE servirse del mismo
   puerto del gateway (18789). Un solo punto de entrada simplifica Tailscale Serve
   y evita CORS.

3. **No eliminar codigo de OpenClaw** — Los tabs y metodos RPC que no se usan se
   OCULTAN via config, no se eliminan. Preserva cherry-pick con upstream.

4. **No usar el gateway completo de OpenClaw** — `server-http.ts` + `server-ws.ts`
   tienen demasiadas dependencias. JorchBot necesita un WS server propio y liviano.

5. **No crear endpoints REST** — La Control UI usa WebSocket RPC exclusivamente.
   Agregar REST duplicaria la superficie de API sin beneficio. Solo se mantiene
   `GET /health` que ya existe.

6. **No dejar la GUI sin auth** — El gateway esta expuesto via Funnel (publico).
   Device auth (ECDSA P-256, ya existe en OpenClaw) se activa en sub-fase 6D.
   Solo `/webhooks/*` y `/health` quedan sin auth.

7. **No hardcodear "JorchBot" en strings** — Usar i18n y bootstrap config
   (`assistantName`) para que el nombre sea configurable.

8. **No mezclar namespaces** — Los metodos RPC de JorchBot usan el namespace `jb.*`
   para evitar colisiones con metodos existentes de OpenClaw.

---

## Definicion de "Terminado"

- [ ] Control UI carga desde `http://localhost:18789/` (mismo puerto gateway)
- [ ] Branding completamente cambiado a JorchBot (titulo, colores, logo, localStorage keys)
- [ ] WebSocket server funciona con protocolo compatible (connect, req/res, events)
- [ ] Device auth activo: browser nuevo pide pairing, browser aprobado accede sin friccion
- [ ] `gui.funnel=false`: solo IPs del tailnet (100.64.0.0/10) acceden a GUI/WebSocket
- [ ] `gui.funnel=true`: device auth protege GUI/WebSocket, browsers nuevos piden pairing
- [ ] Webhooks (`/webhooks/*`) y health (`/health`) funcionan sin auth en ambos modos
- [ ] `/gui funnel on|off` togglea el modo con confirmacion por codigo (4 digitos, 60s timeout)
- [ ] Tabs irrelevantes ocultos (6 tabs) sin eliminar codigo
- [ ] Tab overview muestra workspaces con context % en tiempo real
- [ ] Tab workspaces permite CRUD de proyectos con focus model
- [ ] Tab tunnels muestra tunnels + FunnelProxy routes con health. Rutas bajo `/proxy/`
- [ ] Tab devices permite aprobar/revocar/bloquear dispositivos desde la GUI
- [ ] Tab jorchfile permite editar y guardar el Jorchfile
- [ ] Tab config puede modificar configuracion sin reiniciar
- [ ] Logs viewer funciona con scroll infinito, busqueda, y auto-scroll
- [ ] `/gui` envia URL funcional al chat
- [ ] GUI es mobile-responsive y usable desde celular
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- La Control UI se sirve desde el **mismo puerto del gateway (18789)**, no basePort+2.
  El handler HTTP en `src/gateway/control-ui.ts` maneja assets estaticos + SPA fallback.
- La GUI siempre es accesible via **VPN mesh de Tailscale** (MagicDNS). No se usa Serve.
  La exposicion via **Funnel (internet)** es configurable con `gui.funnel` (default: false).
  Cuando `gui.funnel=true`, device auth (ECDSA P-256) protege GUI y WebSocket.
  Cuando `gui.funnel=false`, solo IPs del tailnet (100.64.0.0/10) acceden. Solo
  `/webhooks/*` y `/health` quedan sin restriccion en ambos modos.
- El FunnelProxy de dev services (Fase 4) es un **servidor separado en puerto 8443** con
  todas las rutas bajo `/proxy/**`. No comparte puerto con el gateway, asi que no hay
  colision con las rutas de la SPA.
- El WebSocket server minimo se crea en `src/gateway/jorchbot-ws.ts` y se adjunta
  al HTTP server de Express via upgrade.
- Para el Jorchfile editor, el backend valida con el mismo parser que usa el Jorchfile
  Engine (Fase 3).
- Los eventos WebSocket proveen real-time sin polling. La UI ya tiene auto-reconnect
  con backoff exponencial (800ms → 15s).
- Build pipeline: `pnpm ui:build` compila Lit → `dist/control-ui/` → gateway sirve.

---

## Relacion con Otras Fases

| Fase        | Relacion con GUI (Fase 6)                                         | Sub-fase afectada  |
| ----------- | ----------------------------------------------------------------- | ------------------ |
| **Phase 1** | Gateway basico + ClaudeRunner — prerequisito para montar UI       | 6A                 |
| **Phase 2** | SessionManager, FocusModel — datos para tab Workspaces            | 6G                 |
| **Phase 3** | Jorchfile engine — datos para tab Jorchfile                       | 6J                 |
| **Phase 4** | **Prerequisito directo** — tunnels + FunnelProxy para tab tunnels | 6H, 6K             |
| **Phase 5** | Modos avanzados, approval queue — mejoras UX en Workspaces        | 6G (refinamiento)  |
| **Phase 7** | Telegram — aparece en tab Channels                                | 6F (actualizacion) |
| **Phase 8** | TOTP 2FA — capa extra encima de device auth de 6D/6I              | Post-6L            |

---

## Archivos Clave de Referencia

| Archivo                              | Rol en el sistema                              |
| ------------------------------------ | ---------------------------------------------- |
| `src/gateway/control-ui.ts`          | Handler HTTP que sirve la SPA                  |
| `src/gateway/control-ui-contract.ts` | Path del bootstrap config (`/__openclaw/...`)  |
| `src/gateway/server-http.ts:588-606` | Donde se monta la UI en el gateway de OpenClaw |
| `src/infra/control-ui-assets.ts`     | Resolucion de assets (`dist/control-ui/`)      |
| `ui/src/ui/navigation.ts`            | Definicion de tabs y grupos                    |
| `ui/src/ui/app.ts`                   | Root component `<openclaw-app>`                |
| `ui/src/ui/app-render.ts`            | Render principal con branding                  |
| `ui/src/ui/app-gateway.ts`           | Conexion WebSocket + manejo de eventos         |
| `ui/src/ui/gateway.ts`               | Cliente WebSocket (`GatewayBrowserClient`)     |
| `ui/src/ui/storage.ts`               | localStorage keys para settings                |
| `ui/src/ui/device-auth.ts`           | localStorage keys para device auth             |
| `ui/src/styles/base.css`             | CSS variables (colores, tipografia)            |
| `ui/src/i18n/lib/translate.ts`       | i18n manager con localStorage key              |
| `ui/index.html`                      | HTML entry point con titulo y custom element   |
| `src/gateway/jorchbot-start.ts`      | Gateway actual de JorchBot (a extender)        |
| [gui-jorchbot.md](./gui-jorchbot.md) | Hallazgos tecnicos completos de la auditoria   |
