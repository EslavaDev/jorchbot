# Fase 6 - GUI de Configuracion

> **Estado**: Pendiente
> **Dependencia**: Fase 4 (necesita tunnels para acceder remotamente)
> **Entregable**: Dashboard web accesible via Tailscale Serve
> **Al terminar**: Configurar JorchBot, ver sesiones, logs, y tunnels desde el navegador

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> **Decision: Extender Control UI existente de OpenClaw (puerto 18789)**
>
> OpenClaw ya tiene una Control UI servida como assets estaticos desde el mismo
> puerto del Gateway (18789). La GUI de JorchBot debe **extender esta UI existente**,
> NO crear una GUI nueva desde cero.
>
> El code base de la UI esta en `ui/` (Lit 3.x web components, build con Vite 7.x).
> Ver `docs/gui-jorchbot.md` para hallazgos tecnicos detallados.

## Objetivo

Extender la Control UI existente de OpenClaw para agregar funcionalidades de JorchBot.
Para tareas que son mas comodas en una GUI (editar Jorchfile, ver logs, monitorear
sesiones) en vez de hacerlo todo por mensajes de texto.

---

## Entregables

1. Dashboard principal (estado general) — extendiendo Control UI existente
2. Session monitor (sesiones en tiempo real)
3. Jorchfile editor (visual)
4. Log viewer (con busqueda y filtros)
5. Tunnel status panel
6. Settings page
7. Accesible via Tailscale Serve (privado, tailnet only)

---

## Tareas

### 6.1 Stack tecnico de la GUI

**Decision (rev. 2)**: Extender la **Control UI existente** de OpenClaw. NO crear GUI nueva.

- [ ] Montar la Control UI existente de `ui/` en el gateway de JorchBot
- [ ] Agregar paginas/componentes JorchBot a la UI existente (Lit web components)
- [ ] Implementar WebSocket server minimo para comunicacion real-time

**La Control UI de OpenClaw**:

- Servida en el **mismo puerto del gateway (18789)** — NO basePort+2
- Assets estaticos en `dist/control-ui/` (build con `pnpm ui:build`)
- Basada en Lit 3.x web components (`ui/`)
- WebSocket para comunicacion real-time (HTTP upgrade en el mismo puerto)

**Endpoints (puerto 18789 — Gateway)**:

- `https://device.ts.net:18789/` → GUI dashboard (Control UI extendida)
- `ws://device.ts.net:18789` → WebSocket (HTTP upgrade, mismo puerto)
- `https://device.ts.net:18789/webhooks/kapso` → Kapso webhooks

**Criterio de aceptacion**: Abrir la URL del gateway (puerto 18789) muestra el dashboard de JorchBot.

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

- [ ] Al iniciar JorchBot, auto-exponer Control UI via Tailscale Serve
- [ ] URL: `https://<device>.<tailnet>.ts.net:18789` (mismo puerto del gateway)
- [ ] Solo accesible desde dispositivos del tailnet
- [ ] Mostrar URL en terminal al iniciar y via `/gui` en WP

**Criterio de aceptacion**: Acceder a la GUI desde el celular via Tailscale en puerto 18789.

---

## Definicion de "Terminado"

- [ ] Dashboard muestra estado real de sesiones, tunnels, Gateway
- [ ] Session monitor muestra output en tiempo real
- [ ] Jorchfile editor con validacion y hot-reload
- [ ] Log viewer con busqueda y filtros
- [ ] Tunnel panel con create/stop
- [ ] Settings editables desde GUI
- [ ] Extiende Control UI existente de OpenClaw (no GUI nueva)
- [ ] Accesible via Tailscale Serve en puerto 18789 (mismo puerto del gateway)
- [ ] `/gui` en WP envia la URL
- [ ] Tests pasan, CI en verde
