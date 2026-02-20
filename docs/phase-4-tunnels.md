# Fase 4 - Tunnel Manager

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Tailscale Serve/Funnel completo + reverse proxy + URL al chat
> **Al terminar**: `/tunnel frontend` levanta un tunnel privado y envia la URL al chat, `/tunnels` muestra todos los tunnels activos, Funnel con reverse proxy para acceso publico

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> OpenClaw ya tiene `gateway.bind: "tailnet"` y deteccion basica de Tailscale
> en `src/gateway/server-tailscale.ts`. JorchBot reutiliza esa deteccion y
> construye encima un Tunnel Manager completo.
>
> **Capa 1 (reusar)**: Deteccion de Tailscale, binding mode tailnet del Gateway.
>
> **Capa 2 (construir)**: TunnelManager (orquestador), reverse proxy para Funnel,
> lifecycle management, /tunnel y /tunnels commands, URL delivery al chat.
>
> **Nota sobre Fase 3**: La Fase 3 incluye tunnel basico como parte del
> Jorchfile executor (`/dev` auto-levanta tunnel). Fase 4 construye el
> Tunnel Manager completo como componente standalone que la Fase 3 consume.
> Si Fase 4 se implementa antes de Fase 3, el Jorchfile usa el TunnelManager;
> si Fase 3 va primero, refactoriza su tunnel basico al TunnelManager de Fase 4.

---

## Objetivo

Implementar un gestor de tunnels completo basado exclusivamente en Tailscale
(Serve para acceso privado, Funnel para acceso publico) con soporte para
multiples proyectos, reverse proxy, y entrega de URLs al chat.

---

## Decision: Solo Tailscale

| Aspecto        | Decision         | Razon                                            |
| -------------- | ---------------- | ------------------------------------------------ |
| Provider unico | Tailscale        | Simplifica, ya integrado en OpenClaw             |
| Default        | Serve (privado)  | Solo tailnet, sin limite de puertos, seguro      |
| Publico        | Funnel (opt-in)  | Requiere confirmacion explicita del usuario      |
| ~~Cloudflare~~ | **Eliminado**    | Complejidad innecesaria, Tailscale cubre todo    |
| Reverse proxy  | Solo para Funnel | Funnel tiene limite de 3 puertos, proxy resuelve |

---

## Entregables

1. TunnelManager (orquestador principal)
2. TailscaleServe adapter (tunnels privados)
3. TailscaleFunnel adapter (tunnels publicos)
4. Reverse proxy HTTP para Funnel (path-based routing)
5. Tunnel lifecycle management (auto-start/stop con sesiones)
6. Health monitoring y auto-restart
7. Comandos /tunnel, /tunnels, /tunnel-stop
8. URL delivery al chat
9. Confirmacion de usuario para Funnel (publico)
10. Integracion con DB (tabla `tunnels`)

---

## Tareas

### 4.1 TunnelManager (orquestador)

Componente central que gestiona todos los tunnels activos.

```typescript
// src/tunnels/tunnel-manager.ts
interface TunnelConfig {
  sessionId: string;
  project: string;
  localPort: number;
  mode: "serve" | "funnel";
  funnelPath?: string; // para reverse proxy
}

interface TunnelInfo {
  id: string;
  sessionId: string;
  project: string;
  localPort: number;
  assignedPort: number;
  url: string;
  mode: "serve" | "funnel";
  status: "starting" | "active" | "stopped" | "error";
  startedAt: Date;
}

interface TunnelManager {
  start(config: TunnelConfig): Promise<TunnelInfo>;
  stop(tunnelId: string): Promise<void>;
  stopBySession(sessionId: string): Promise<void>;
  list(): TunnelInfo[];
  get(tunnelId: string): TunnelInfo | undefined;
  getBySession(sessionId: string): TunnelInfo[];
  health(): Promise<TunnelHealthReport>;
}
```

- [ ] Implementar `TunnelManager` como singleton
- [ ] Registro en memoria de tunnels activos (Map)
- [ ] Persistir estado en tabla `tunnels` de SQLite
- [ ] Sincronizar estado al reiniciar (limpiar tunnels huerfanos)
- [ ] Emitir eventos: `tunnel:started`, `tunnel:stopped`, `tunnel:error`

**Criterio de aceptacion**: TunnelManager puede crear, listar, detener tunnels y persiste estado en DB.

### 4.2 Tailscale Serve (tunnels privados)

Tailscale Serve expone un puerto local a todos los dispositivos dentro del tailnet.
**Sin limite de puertos.** Es el default.

```bash
# Internamente JorchBot ejecuta:
tailscale serve --bg <localPort>

# Resultado: https://<device>.<tailnet>.ts.net:<localPort>
```

- [ ] Implementar `TailscaleServeAdapter` en `src/tunnels/adapters/tailscale-serve.ts`
- [ ] Detectar hostname del tailnet (reusar `src/gateway/server-tailscale.ts`)
- [ ] Ejecutar `tailscale serve --bg <port>` via child_process
- [ ] Parsear output para obtener URL resultante
- [ ] Verificar que el tunnel esta activo (health check HTTP)
- [ ] Implementar `stop()` via `tailscale serve --bg <port> off`
- [ ] Manejar errores: Tailscale no instalado, no autenticado, puerto ocupado

**Criterio de aceptacion**: `TailscaleServeAdapter.start(3000)` levanta un tunnel y retorna la URL del tailnet.

### 4.3 Tailscale Funnel (tunnels publicos)

Tailscale Funnel expone un servicio a internet. Requiere confirmacion del usuario
porque hace el servicio accesible publicamente.

**Limitaciones de Funnel**:

- Solo puertos 443, 8443, 10000
- HTTPS/TLS solamente
- Sin custom domains (solo `*.ts.net`)
- Requiere doble opt-in (admin console + device)

```bash
# Internamente JorchBot ejecuta:
tailscale funnel --bg <assignedPort>

# Para multiples proyectos, usa reverse proxy en un solo puerto Funnel
```

- [ ] Implementar `TailscaleFunnelAdapter` en `src/tunnels/adapters/tailscale-funnel.ts`
- [ ] Validar que el puerto es 443, 8443 o 10000
- [ ] Ejecutar `tailscale funnel --bg <port>` via child_process
- [ ] Parsear output para obtener URL publica
- [ ] Manejar errores: Funnel no habilitado, puerto no permitido, admin consent pendiente
- [ ] Implementar `stop()` via `tailscale funnel --bg <port> off`

**Criterio de aceptacion**: `TailscaleFunnelAdapter.start(443)` levanta un tunnel publico y retorna la URL.

### 4.4 Reverse Proxy (path-based routing para Funnel)

Cuando hay multiples proyectos y el usuario quiere exponerlos publicamente,
se usa un solo puerto Funnel con un reverse proxy que rutea por path.

```
Tailscale Funnel (puerto 443) --> JorchBot Reverse Proxy
  /frontend  --> localhost:3000
  /backend   --> localhost:8000
  /gui       --> localhost:18789
```

- [ ] Implementar `FunnelProxy` en `src/tunnels/funnel-proxy.ts`
- [ ] Usar `http-proxy` o `node:http` nativo para proxy reverso
- [ ] Configuracion dinamica de rutas (agregar/quitar sin reiniciar)
- [ ] Soporte de WebSocket pass-through (para HMR de dev servers)
- [ ] Health check por ruta (si backend upstream muere, retornar 502)
- [ ] Logging de requests (almacenar en tabla `messages` con type `tunnel`)

```typescript
interface FunnelProxyRoute {
  path: string; // "/frontend"
  target: string; // "http://localhost:3000"
  project: string; // "frontend"
  stripPath: boolean; // true → /frontend/api → /api
}

interface FunnelProxy {
  addRoute(route: FunnelProxyRoute): void;
  removeRoute(path: string): void;
  listRoutes(): FunnelProxyRoute[];
  start(port: number): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] Auto-iniciar proxy cuando el primer proyecto pide Funnel
- [ ] Auto-detener proxy cuando el ultimo proyecto se desconecta

**Criterio de aceptacion**: Proxy rutea requests por path a los puertos locales correctos. WebSocket pass-through funciona.

### 4.5 Tunnel Lifecycle Management

Los tunnels deben gestionarse automaticamente con el ciclo de vida de las sesiones.

| Evento                    | Accion del TunnelManager                |
| ------------------------- | --------------------------------------- |
| `/dev <project>` (Fase 3) | Auto-start tunnel segun Jorchfile       |
| `/tunnel <project>`       | Start tunnel manualmente                |
| `/stop <project>`         | Stop tunnel de esa sesion               |
| Session destroyed         | Stop todos los tunnels de esa sesion    |
| Gateway shutdown          | Stop todos los tunnels activos          |
| Tunnel error              | Intentar restart (max 3 veces, backoff) |

- [ ] Hook en SessionManager: `session:destroyed` → `TunnelManager.stopBySession()`
- [ ] Hook en Gateway shutdown: stop all tunnels
- [ ] Auto-restart con backoff exponencial (1s, 5s, 30s)
- [ ] Maximo 3 reintentos antes de marcar como `error`
- [ ] Notificar al chat cuando un tunnel cae y cuando se recupera

**Criterio de aceptacion**: Al hacer `/stop frontend`, el tunnel asociado se detiene automaticamente. Al reiniciar el Gateway, tunnels huerfanos se limpian.

### 4.6 Health Monitoring

- [ ] Health check periodico de tunnels activos (cada 30 segundos)
- [ ] Verificar via HTTP GET a la URL del tunnel
- [ ] Si falla 3 checks consecutivos: marcar como `error`, notificar al chat
- [ ] Endpoint `TunnelManager.health()` para diagnostico

**Criterio de aceptacion**: Si se mata Tailscale manualmente, JorchBot detecta la caida en <60s y notifica.

### 4.7 Comandos de Tunnel

| Comando                      | Accion                                            |
| ---------------------------- | ------------------------------------------------- |
| `/tunnel <project>`          | Levanta tunnel Serve (privado) para el proyecto   |
| `/tunnel <project> --public` | Levanta tunnel Funnel (publico) con confirmacion  |
| `/tunnel-stop <project>`     | Detiene tunnel del proyecto                       |
| `/tunnels`                   | Lista todos los tunnels activos con URLs y estado |

**Flujo de `/tunnel frontend`**:

```
User: /tunnel frontend
Bot:  [frontend] Levantando tunnel (privado, tailnet only)...
      [frontend] Tunnel activo:
      https://mi-pc.tailnet.ts.net:3000
      Solo accesible desde dispositivos en tu tailnet.
```

**Flujo de `/tunnel frontend --public`** (con confirmacion):

```
User: /tunnel frontend --public
Bot:  [frontend] Esto hara tu servicio accesible desde INTERNET.
      URL publica: https://mi-pc.tailnet.ts.net/frontend
      Cualquier persona con el link podra acceder.

      [Confirmar] [Cancelar]

User: *toca Confirmar*
Bot:  [frontend] Tunnel publico activo:
      https://mi-pc.tailnet.ts.net/frontend
```

**Flujo de `/tunnels`**:

```
User: /tunnels
Bot:  Tunnels activos:

      PRIVADOS (tailnet only):
      1. frontend → https://mi-pc.tailnet.ts.net:3000  (Serve)
      2. backend  → https://mi-pc.tailnet.ts.net:8000  (Serve)
      3. gui      → https://mi-pc.tailnet.ts.net:18789 (Serve)

      PUBLICOS (internet):
      4. frontend → https://mi-pc.tailnet.ts.net/frontend (Funnel + proxy)
```

- [ ] Registrar comandos en CommandRouter
- [ ] URL delivery al chat inmediato al levantar tunnel
- [ ] Confirmacion obligatoria para Funnel (boton de Kapso)
- [ ] Formatear output con estado y tipo de tunnel

**Criterio de aceptacion**: `/tunnel frontend` levanta tunnel y envia URL. `/tunnels` muestra estado completo.

### 4.8 Deteccion de Tailscale

- [ ] Verificar que `tailscale` CLI esta instalado (`which tailscale`)
- [ ] Verificar que Tailscale esta autenticado (`tailscale status`)
- [ ] Obtener hostname del tailnet (`tailscale status --json`)
- [ ] Cache del hostname (no cambiar durante la sesion)
- [ ] Error claro si Tailscale no esta disponible

```
User: /tunnel frontend
Bot:  Error: Tailscale no esta instalado o no esta autenticado.
      Instala Tailscale: https://tailscale.com/download
      Luego ejecuta: tailscale up
```

**Criterio de aceptacion**: Si Tailscale no esta disponible, error claro con instrucciones.

---

## NO se construye en esta fase

- Port auto-management (ya cubierto en Fase 3, task 3.4)
- Integracion con Jorchfile (Fase 3 consume TunnelManager)
- GUI de tunnels (Fase 6)
- Custom domains
- TCP/UDP tunneling (Tailscale no lo soporta via Funnel)

---

## Definicion de "Terminado"

- [ ] TunnelManager crea y gestiona tunnels Serve y Funnel
- [ ] Reverse proxy rutea multiples proyectos por path
- [ ] WebSocket pass-through funciona (HMR de dev servers)
- [ ] `/tunnel`, `/tunnel-stop`, `/tunnels` funcionan desde WhatsApp
- [ ] Confirmacion de usuario para Funnel (publico)
- [ ] URL se envia al chat al levantar tunnel
- [ ] Tunnels se detienen automaticamente al cerrar sesion
- [ ] Health monitoring detecta caidas en <60s
- [ ] Error claro si Tailscale no esta instalado
- [ ] Tabla `tunnels` en SQLite persistida correctamente
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- Tailscale Serve NO tiene limite de puertos. Cada proyecto usa su puerto local directamente.
- Tailscale Funnel SI tiene limite: solo 443, 8443, 10000. Por eso el reverse proxy.
- El reverse proxy solo se levanta cuando hay al menos un proyecto usando Funnel.
- OpenClaw ya detecta Tailscale en `src/gateway/server-tailscale.ts`. Reusar esa logica.
- Los tunnels sobreviven al reinicio del Gateway (Tailscale los mantiene con `--bg`). Al reiniciar, sincronizar estado de DB con realidad.
- `tailscale serve` y `tailscale funnel` usan `--bg` para ejecutar en background sin bloquear.
