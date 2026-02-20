# Fase 6 - GUI de Configuracion

> **Estado**: Pendiente
> **Dependencia**: Fase 4
> **Entregable**: Dashboard web accesible via Tailscale Serve
> **Al terminar**: Abres `https://<device>.tailnet.ts.net:18791` desde tu celular y ves sesiones activas, logs en tiempo real, tunnels, y puedes editar el Jorchfile visualmente

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> OpenClaw ya tiene una **Control UI** servida como assets estaticos desde el Gateway
> en el puerto `basePort + 2` (18791 en loopback). JorchBot extiende esta UI
> en vez de crear una nueva desde cero.
>
> **Capa 1 (reusar)**: Control UI framework, static asset serving desde Gateway,
> WebSocket real-time desde el Gateway, health endpoint.
>
> **Capa 2 (construir)**: Dashboard de sesiones JorchBot, logs viewer,
> tunnel status, Jorchfile editor, settings page.
>
> **Accesibilidad**: La GUI es accesible via Tailscale Serve (privado dentro
> del tailnet). El comando `/gui` envia la URL al chat.

---

## Objetivo

Extender la Control UI existente de OpenClaw para incluir un dashboard completo
de JorchBot: estado de sesiones, logs en tiempo real, gestion de tunnels,
editor visual del Jorchfile, y configuracion del sistema.

---

## Entregables

1. Dashboard principal (sesiones, context %, modos)
2. Logs viewer en tiempo real (por sesion)
3. Tunnel status (activos, URLs, health)
4. Jorchfile editor visual
5. Settings page (config.json + jorchbot.json)
6. API endpoints para la GUI (REST + WebSocket)
7. Comando /gui (envia URL al chat)
8. Mobile-responsive (usable desde celular)

---

## Tareas

### 6.1 Evaluar y Extender Control UI de OpenClaw

OpenClaw sirve la Control UI como assets estaticos en `src/gateway/control-ui.ts`.

- [ ] Auditar Control UI actual: tech stack, estructura, build pipeline
- [ ] Determinar si extender in-place o crear seccion separada `/jorchbot/`
- [ ] Evaluar framework UI (OpenClaw puede usar vanilla JS, React, o Svelte)
- [ ] Definir estrategia de build: assets se compilan y sirven desde Gateway
- [ ] Asegurar que la GUI funciona en mobile browsers (Safari, Chrome)

**Criterio de aceptacion**: GUI extendida compila y se sirve desde el Gateway en puerto 18791.

### 6.2 API Endpoints para la GUI

La GUI necesita endpoints REST y WebSocket para obtener datos en tiempo real.

**REST endpoints** (`/api/jorchbot/`):

| Endpoint                          | Metodo | Descripcion                                 |
| --------------------------------- | ------ | ------------------------------------------- |
| `/api/jorchbot/sessions`          | GET    | Lista sesiones con estado, context %, modos |
| `/api/jorchbot/sessions/:id`      | GET    | Detalle de una sesion                       |
| `/api/jorchbot/sessions/:id/logs` | GET    | Logs de una sesion (paginados)              |
| `/api/jorchbot/tunnels`           | GET    | Tunnels activos con URLs y health           |
| `/api/jorchbot/jorchfile`         | GET    | Contenido del Jorchfile parseado            |
| `/api/jorchbot/jorchfile`         | PUT    | Actualizar Jorchfile                        |
| `/api/jorchbot/config`            | GET    | Configuracion actual                        |
| `/api/jorchbot/config`            | PATCH  | Actualizar configuracion                    |
| `/api/jorchbot/status`            | GET    | Estado general del sistema                  |

**WebSocket events** (via WebSocket del Gateway):

| Evento              | Payload        | Descripcion                              |
| ------------------- | -------------- | ---------------------------------------- |
| `session:updated`   | `SessionInfo`  | Sesion cambio de estado, context %, modo |
| `session:message`   | `MessageInfo`  | Nuevo mensaje en una sesion (para logs)  |
| `tunnel:updated`    | `TunnelInfo`   | Tunnel cambio de estado                  |
| `approval:pending`  | `ApprovalInfo` | Nueva aprobacion pendiente               |
| `approval:resolved` | `ApprovalInfo` | Aprobacion resuelta                      |

- [ ] Implementar endpoints REST en `src/gateway/api/jorchbot-api.ts`
- [ ] Registrar endpoints en el server Express del Gateway
- [ ] Implementar eventos WebSocket para real-time updates
- [ ] Autenticacion: misma auth que Control UI (localhost o Tailscale)
- [ ] Paginacion para logs (query params: `?page=1&limit=50`)
- [ ] Validacion de input con Zod

**Criterio de aceptacion**: `GET /api/jorchbot/sessions` retorna JSON con sesiones. WebSocket emite eventos en tiempo real.

### 6.3 Dashboard Principal

Vista principal que muestra el estado de todas las sesiones de JorchBot.

**Contenido del dashboard**:

```
+---------------------------------------------------+
|  JorchBot Dashboard                    [Settings]  |
+---------------------------------------------------+
|                                                     |
|  Sesiones Activas                                  |
|  +-----------------------------------------------+  |
|  | * frontend (enfocada)                         |  |
|  |   Context: 23% [===========               ]   |  |
|  |   Mode: confirm + verbose                     |  |
|  |   Tunnel: https://mi-pc.ts.net:3000 (Serve)   |  |
|  |   [Logs] [Switch] [Stop] [Compact]            |  |
|  +-----------------------------------------------+  |
|  | o backend (background)                        |  |
|  |   Context: 45% [======================    ]   |  |
|  |   Mode: auto + silent                         |  |
|  |   Tunnel: none                                |  |
|  |   APROBACION PENDIENTE (5 min)                |  |
|  |   [Logs] [Focus] [Approve] [Stop]             |  |
|  +-----------------------------------------------+  |
|                                                     |
|  Tunnels Activos                                   |
|  +-----------------------------------------------+  |
|  | Serve: frontend → :3000 (healthy)             |  |
|  | Serve: gui → :18789 (healthy)                 |  |
|  +-----------------------------------------------+  |
|                                                     |
|  Sistema                                           |
|  Uptime: 3h 24m | DB: 2.1 MB | Gateway: healthy   |
+---------------------------------------------------+
```

- [ ] Componente de lista de sesiones con estado en tiempo real
- [ ] Barra de progreso de context window por sesion
- [ ] Indicador de aprobaciones pendientes
- [ ] Botones de accion rapida (focus, stop, compact, approve)
- [ ] Seccion de tunnels activos con health status
- [ ] Seccion de sistema (uptime, DB size, gateway health)
- [ ] Auto-refresh via WebSocket (no polling)

**Criterio de aceptacion**: Dashboard muestra sesiones con context % actualizado en tiempo real.

### 6.4 Logs Viewer

Vista de logs por sesion con scroll infinito y busqueda.

- [ ] Lista de mensajes por sesion (cronologico)
- [ ] Color coding por tipo: text (blanco), command (azul), error (rojo), approval (amarillo)
- [ ] Busqueda de texto en logs
- [ ] Filtro por tipo de mensaje
- [ ] Auto-scroll para nuevos mensajes (con opcion de pausar)
- [ ] Exportar logs como TXT o JSON
- [ ] Click en una sesion del dashboard → abre logs

**Criterio de aceptacion**: Logs viewer muestra mensajes en tiempo real con busqueda funcional.

### 6.5 Jorchfile Editor

Editor visual del Jorchfile con validacion.

- [ ] Parsear Jorchfile y mostrar como formulario estructurado
- [ ] Cada PROJECT como seccion expandible
- [ ] Campos editables: path, dev, build, test, tunnel, port, instructions, approve, output
- [ ] Agregar/eliminar proyectos
- [ ] Agregar/eliminar comandos custom
- [ ] Validacion en tiempo real (path existe, puerto valido, etc.)
- [ ] Boton "Save" que escribe el Jorchfile en disco
- [ ] Boton "Reload" que re-lee el Jorchfile del disco
- [ ] Alternativa: editor de texto plano con syntax highlighting

**Criterio de aceptacion**: Editar un proyecto en la GUI y guardar actualiza el Jorchfile en disco. Hot-reload lo detecta (Fase 3).

### 6.6 Settings Page

Configuracion del sistema JorchBot.

- [ ] Editor para `~/.jorchbot/config.json` (JorchBot config)
- [ ] Secciones: General, Database, Logging, Channels, Tunnels
- [ ] Cada campo con descripcion y valor default
- [ ] Validacion con Zod schema
- [ ] Guardar y recargar config sin reiniciar Gateway
- [ ] Mostrar info del sistema: version, Node.js, pnpm, Tailscale status

**Criterio de aceptacion**: Cambiar un setting en la GUI lo persiste en config.json y aplica sin reiniciar.

### 6.7 Comando /gui

- [ ] `/gui` envia al chat la URL de la GUI
- [ ] Detecta automaticamente si hay Tailscale Serve activo en el puerto de la GUI
- [ ] Si no hay tunnel, ofrece levantarlo

```
User: /gui
Bot:  GUI de JorchBot:
      https://mi-pc.tailnet.ts.net:18791

      Accesible desde cualquier dispositivo en tu tailnet.
      Abre desde tu celular para gestionar sesiones.
```

**Criterio de aceptacion**: `/gui` envia URL funcional al chat.

### 6.8 Mobile Responsive

- [ ] Toda la GUI funciona en pantallas de celular (320px - 428px width)
- [ ] Touch-friendly: botones grandes, no hover-dependent
- [ ] Dashboard compacto para mobile
- [ ] Logs viewer con scroll touch
- [ ] Jorchfile editor usable en mobile (formulario, no texto plano)

**Criterio de aceptacion**: La GUI es usable desde Safari/Chrome en iPhone/Android.

---

## NO se construye en esta fase

- API Keys management (Fase 8)
- Analytics y metricas de uso
- Temas (dark mode, etc.) — solo default
- Notificaciones push desde la GUI
- Chat interface en la GUI (se usa WhatsApp/Telegram para eso)

---

## Definicion de "Terminado"

- [ ] Dashboard muestra sesiones, context %, modos, tunnels en tiempo real
- [ ] Logs viewer funciona con scroll infinito, busqueda, y auto-scroll
- [ ] Jorchfile editor puede crear, editar, y eliminar proyectos
- [ ] Settings page puede modificar config sin reiniciar
- [ ] API endpoints REST y WebSocket funcionan con autenticacion
- [ ] `/gui` envia URL al chat
- [ ] GUI es mobile-responsive y usable desde celular
- [ ] Assets se sirven desde el Gateway en puerto 18791
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- La Control UI de OpenClaw ya usa el puerto `basePort + 2` (18791). JorchBot extiende esta UI.
- La autenticacion de la GUI es por red: si estas en el tailnet, tienes acceso. No hay login adicional en esta fase (se agrega en Fase 8).
- Los endpoints REST son internos (no expuestos a internet). Solo accesibles via tailnet.
- El WebSocket del Gateway ya existe. Los eventos de JorchBot se agregan al mismo canal.
- Para el editor de Jorchfile, el backend valida con el mismo parser que usa el Jorchfile Engine (Fase 3).
- El tech stack de la GUI debe ser consistente con lo que OpenClaw ya usa. Auditar antes de decidir.
