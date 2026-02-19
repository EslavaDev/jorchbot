# Fase 6 - GUI de Configuracion

> **Estado**: Pendiente
> **Dependencia**: Fase 4 (necesita tunnels para acceder remotamente)
> **Entregable**: Dashboard web accesible via Tailscale Serve
> **Al terminar**: Configurar JorchBot, ver sesiones, logs, y tunnels desde el navegador

---

## Objetivo

Crear un dashboard web que complemente la experiencia de WhatsApp. Para tareas
que son mas comodas en una GUI (editar Jorchfile, ver logs, monitorear sesiones)
en vez de hacerlo todo por mensajes de texto.

---

## Entregables

1. Dashboard principal (estado general)
2. Session monitor (sesiones en tiempo real)
3. Jorchfile editor (visual)
4. Log viewer (con busqueda y filtros)
5. Tunnel status panel
6. Settings page
7. Accesible via Tailscale Serve (privado, tailnet only)

---

## Tareas

### 6.1 Stack tecnico de la GUI

**Decision**: Reutilizar la infraestructura de WebChat UI que ya tiene OpenClaw.

- [ ] Evaluar que tech usa OpenClaw para su WebChat/Control UI
- [ ] Si es utilizable, extenderlo. Si no, crear SPA minima.

**Opcion A** (preferida): Si OpenClaw usa React/Vue/Svelte para su WebChat:

- Extender con nuevas paginas/componentes
- Reutilizar el WebSocket del Gateway para real-time data

**Opcion B** (fallback): SPA minima con:

- Framework: Preact o vanilla TS (minimo bundle)
- Comunicacion: WebSocket al Gateway + REST endpoints
- Styling: Tailwind CSS o CSS minimal

**El Gateway sirve la GUI** en el mismo puerto (18789):

- `https://device.ts.net:18789/` → GUI dashboard
- `https://device.ts.net:18789/ws` → WebSocket
- `https://device.ts.net:18789/api/` → REST API
- `https://device.ts.net:18789/webhook/kapso` → Kapso webhooks

**Criterio de aceptacion**: Abrir la URL del Gateway muestra el dashboard.

### 6.2 Dashboard principal

- [ ] Estado del Gateway (uptime, version)
- [ ] Sesiones activas (cards con nombre, %, modo, estado)
- [ ] Tunnels activos (URLs clickeables)
- [ ] Ultimo activity por sesion
- [ ] Quick actions: crear sesion, abrir tunnel

```
┌─────────────────────────────────────────┐
│  JorchBot Dashboard              v0.1.0 │
│  Gateway: running (2h 34m)              │
├─────────────────────────────────────────┤
│                                         │
│  Sessions                               │
│  ┌─────────────┐  ┌─────────────┐      │
│  │ ● frontend  │  │ ○ backend   │      │
│  │ Context: 18%│  │ Context: 8% │      │
│  │ confirm+    │  │ confirm+    │      │
│  │ verbose     │  │ verbose     │      │
│  │ Last: 2m ago│  │ Last: 15m   │      │
│  └─────────────┘  └─────────────┘      │
│                                         │
│  Tunnels                                │
│  frontend → mi-pc.ts.net:3000 (Serve)  │
│  backend  → mi-pc.ts.net:3001 (Serve)  │
│  gui      → mi-pc.ts.net:18789(Serve)  │
│                                         │
│  WhatsApp: connected (Kapso)            │
│  Telegram: disabled                     │
└─────────────────────────────────────────┘
```

**Criterio de aceptacion**: Dashboard muestra estado real en tiempo real.

### 6.3 Session monitor

- [ ] Vista detallada por sesion
- [ ] Output de Claude Code en tiempo real (streaming via WebSocket)
- [ ] Context window bar visual
- [ ] Boton para cambiar modo
- [ ] Boton para compact
- [ ] Boton para stop
- [ ] Historial de acciones (timeline)

**Criterio de aceptacion**: Ver output de Claude Code en la GUI mientras se trabaja por WP.

### 6.4 Jorchfile editor

- [ ] Editor de texto con syntax highlighting
- [ ] Validacion en tiempo real (errores en rojo)
- [ ] Guardar → hot-reload automatico
- [ ] Preview de la config parseada (proyectos, comandos)
- [ ] Templates/snippets para projects comunes (Next.js, Django, etc.)

**Criterio de aceptacion**: Editar Jorchfile en la GUI y ver cambios reflejados inmediatamente.

### 6.5 Log viewer

- [ ] Logs por sesion con filtros (tipo, fecha, busqueda)
- [ ] Scroll infinito
- [ ] Syntax highlighting para codigo en los logs
- [ ] Export a TXT/JSON
- [ ] Busqueda full-text

**Criterio de aceptacion**: Buscar "error" en logs de backend muestra todos los errores.

### 6.6 Tunnel status panel

- [ ] Lista de tunnels activos con URLs clickeables
- [ ] Crear/detener tunnels desde la GUI
- [ ] Configurar reverse proxy routes (para Funnel)
- [ ] Indicador de privado vs publico

**Criterio de aceptacion**: Crear un tunnel desde la GUI y ver la URL.

### 6.7 Settings page

- [ ] Kapso API key (con mascara)
- [ ] Telegram bot token (con mascara)
- [ ] Tailscale status
- [ ] Log retention settings
- [ ] Default modes (approve, output)
- [ ] Approval timeouts
- [ ] Gateway port/host

**Criterio de aceptacion**: Cambiar settings desde la GUI y que apliquen sin reiniciar.

### 6.8 Tailscale Serve para la GUI

- [ ] Al iniciar JorchBot, auto-exponer GUI via Tailscale Serve
- [ ] URL: `https://<device>.<tailnet>.ts.net:18789`
- [ ] Solo accesible desde dispositivos del tailnet
- [ ] Mostrar URL en terminal al iniciar y via `/gui` en WP

**Criterio de aceptacion**: Acceder a la GUI desde el celular via Tailscale.

---

## Definicion de "Terminado"

- [ ] Dashboard muestra estado real de sesiones, tunnels, Gateway
- [ ] Session monitor muestra output en tiempo real
- [ ] Jorchfile editor con validacion y hot-reload
- [ ] Log viewer con busqueda y filtros
- [ ] Tunnel panel con create/stop
- [ ] Settings editables desde GUI
- [ ] Accesible via Tailscale Serve
- [ ] `/gui` en WP envia la URL
- [ ] Tests pasan, CI en verde
