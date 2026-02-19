# Fase 4 - Tunnel Manager

> **Estado**: Pendiente
> **Dependencia**: Fase 2
> **Entregable**: Tunnels automaticos via Tailscale Serve + port auto-discovery + URL al chat
> **Al terminar**: `/dev frontend` levanta el server, crea tunnel, y envia la URL al WP

---

## Objetivo

Automatizar el flujo completo de: levantar dev server → detectar puerto →
crear tunnel Tailscale → enviar URL al chat. Todo privado por defecto (tailnet only).

---

## Entregables

1. Port Manager (auto-discovery, deteccion de conflictos)
2. Tailscale Serve integration (privado, dentro del tailnet)
3. Tailscale Funnel integration (publico, opcional)
4. Reverse proxy para Funnel multi-proyecto
5. Cloudflare Quick Tunnel como fallback
6. Auto-URL al chat al levantar tunnel
7. Comando `/tunnels` para ver estado
8. Auto-tunnel para el webhook de Kapso

---

## Tareas

### 4.1 Port Manager

- [ ] Crear `src/tunnels/port-manager.ts`
- [ ] Verificar si un puerto esta libre antes de usarlo
- [ ] Auto-increment si el puerto esta ocupado (3000 → 3001 → 3002...)
- [ ] Inyectar `PORT=<port>` como variable de entorno al ejecutar comandos
- [ ] Parsear comandos para reemplazar puertos hardcodeados
- [ ] Registrar puertos en uso en DB (tabla tunnels)
- [ ] Liberar puertos al detener sesion

```typescript
// src/tunnels/port-manager.ts
export class PortManager {
  // Verifica si el puerto esta libre
  async isPortFree(port: number): Promise<boolean>;

  // Encuentra el siguiente puerto libre a partir de desired
  async findFreePort(desired: number): Promise<number>;

  // Registra un puerto como en uso
  async reserve(port: number, sessionId: string): Promise<void>;

  // Libera un puerto
  async release(port: number): Promise<void>;

  // Lista puertos en uso
  async listReserved(): Promise<PortReservation[]>;

  // Genera env vars para el proceso
  getEnvOverrides(desiredPort: number, assignedPort: number): Record<string, string>;
}
```

**Logica de env var injection**:

```typescript
// Frameworks comunes y sus env vars de puerto
const PORT_ENV_MAP = {
  default: "PORT",
  next: "PORT",
  vite: "PORT", // o --port flag
  django: "PORT", // o en el comando runserver 0.0.0.0:PORT
  flask: "FLASK_RUN_PORT",
  rails: "PORT",
  express: "PORT",
};
```

Si el comando tiene un puerto hardcodeado (ej: `runserver 0.0.0.0:3000`),
el Port Manager lo detecta con regex y lo reemplaza.

**Criterio de aceptacion**: Dos proyectos pidiendo port 3000, el segundo obtiene 3001 automaticamente.

### 4.2 Tailscale Serve (Privado - DEFAULT)

- [ ] Crear `src/tunnels/tailscale.ts`
- [ ] Verificar que Tailscale esta instalado y corriendo
- [ ] Ejecutar `tailscale serve --bg <port>` para exponer un servicio
- [ ] Capturar la URL resultante (`https://<device>.<tailnet>.ts.net:<port>`)
- [ ] Detener con `tailscale serve --bg <port> off`
- [ ] Manejar errores (Tailscale no instalado, no logueado, etc.)

```typescript
// src/tunnels/tailscale.ts
export class TailscaleManager {
  // Verifica que Tailscale esta disponible
  async isAvailable(): Promise<boolean>;

  // Obtiene el hostname del device en el tailnet
  async getHostname(): Promise<string>;

  // Expone un puerto via Serve (privado)
  async serve(port: number): Promise<TunnelInfo>;

  // Expone un puerto via Funnel (publico)
  async funnel(port: number): Promise<TunnelInfo>;

  // Detiene un tunnel
  async stop(port: number, mode: "serve" | "funnel"): Promise<void>;

  // Lista tunnels activos
  async listActive(): Promise<TunnelInfo[]>;
}

interface TunnelInfo {
  url: string;
  port: number;
  mode: "serve" | "funnel";
  status: "active" | "error";
}
```

**Criterio de aceptacion**: `tailscale serve --bg 3000` se ejecuta, URL se captura y se envia al chat.

### 4.3 Tailscale Funnel (Publico - Opcional)

- [ ] Solo se activa si el Jorchfile dice `tunnel = funnel`
- [ ] O si el usuario ejecuta `/tunnel funnel <project>`
- [ ] Pedir confirmacion antes de exponer a internet
- [ ] Puertos permitidos: 443, 8443, 10000
- [ ] Si los 3 estan ocupados, ofrecer Cloudflare como fallback

```
User: /tunnel funnel frontend
Bot:  ⚠️ Esto expondra frontend a INTERNET PUBLICO.
      Cualquier persona con la URL podra acceder.
      [Confirmar] [Cancelar]

User: *toca Confirmar*
Bot:  [frontend] ✓ Tunnel publico activo:
      https://mi-pc.tailnet.ts.net:443
      (Tailscale Funnel → localhost:3000)
```

**Criterio de aceptacion**: Funnel requiere confirmacion y funciona.

### 4.4 Reverse Proxy para Funnel multi-proyecto

- [ ] Crear `src/tunnels/reverse-proxy.ts`
- [ ] Si multiples proyectos quieren Funnel, usar 1 puerto + path routing
- [ ] Implementar con `http-proxy` (Node.js)
- [ ] Routing basado en path: `/frontend` → localhost:3000, `/backend` → localhost:3001
- [ ] Configurable desde Jorchfile: `funnel_path = /frontend`

```typescript
// src/tunnels/reverse-proxy.ts
export class ReverseProxy {
  // Agrega una ruta
  addRoute(path: string, target: string): void;

  // Elimina una ruta
  removeRoute(path: string): void;

  // Lista rutas activas
  listRoutes(): ProxyRoute[];

  // Inicia el proxy server
  start(port: number): Promise<void>;

  // Detiene el proxy server
  stop(): Promise<void>;
}
```

**Criterio de aceptacion**: `https://device.ts.net/frontend` proxea a localhost:3000.

### 4.5 Cloudflare Quick Tunnel (Fallback)

- [ ] Crear `src/tunnels/cloudflare.ts`
- [ ] Verificar que `cloudflared` esta instalado
- [ ] Ejecutar `cloudflared tunnel --url http://localhost:<port>`
- [ ] Capturar URL random de stdout
- [ ] Detener proceso al cerrar tunnel

```
[docs] ✓ Tunnel activo (Cloudflare):
        https://random-adjective-noun.trycloudflare.com
        (Cloudflare Quick Tunnel → localhost:4000)
```

**Criterio de aceptacion**: Si Tailscale no esta disponible, Cloudflare funciona como fallback.

### 4.6 Tunnel Manager (orquestador)

- [ ] Crear `src/tunnels/manager.ts`
- [ ] Coordina Port Manager + Tailscale + Cloudflare + Reverse Proxy
- [ ] Flujo automatico en `/dev <project>`:
  1. Lee port del Jorchfile
  2. Verifica si esta libre → auto-assign si no
  3. Ejecuta comando dev con PORT override
  4. Espera a que el server este listo (polling localhost:port)
  5. Crea tunnel (Serve por default)
  6. Envia URL al chat
- [ ] Persistir tunnels activos en DB
- [ ] Cleanup de tunnels al detener sesion o reiniciar Gateway

**Deteccion de server listo**:

```typescript
// Polling hasta que el puerto responda
async function waitForServer(port: number, timeout: number = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await fetch(`http://localhost:${port}`);
      return true;
    } catch {
      await sleep(500);
    }
  }
  return false;
}
```

**Criterio de aceptacion**: `/dev frontend` hace todo el flujo automatico y envia URL al chat.

### 4.7 Comando /tunnels

```
User: /tunnels
Bot:  Tunnels activos:
      PRIVADOS (tailnet only):
      1. frontend → https://mi-pc.ts.net:3000  (Serve, localhost:3000)
      2. backend  → https://mi-pc.ts.net:3001  (Serve, localhost:3001 auto)
      3. gui      → https://mi-pc.ts.net:18789 (Serve)

      PUBLICOS (internet):
      (ninguno)

      Puertos locales: 3000 ✓ frontend | 3001 ✓ backend | 18789 ✓ gui
```

- [ ] Implementar `/tunnels` — lista todos los tunnels
- [ ] Implementar `/tunnel serve <project>` — crea tunnel privado
- [ ] Implementar `/tunnel funnel <project>` — crea tunnel publico (con confirm)
- [ ] Implementar `/tunnel stop <project>` — detiene tunnel

**Criterio de aceptacion**: `/tunnels` muestra estado completo.

### 4.8 Auto-tunnel para webhook de Kapso

En fase 1, el webhook de Kapso requiere setup manual. Ahora lo automatizamos:

- [ ] Al iniciar JorchBot, crear tunnel para el Gateway (puerto 18789)
- [ ] Generar URL de webhook: `https://<device>.ts.net:18789/webhook/kapso`
- [ ] Mostrar URL al usuario para que la configure en Kapso
- [ ] (Futuro: configurar Kapso automaticamente via API)

**Criterio de aceptacion**: JorchBot arranca y muestra la URL del webhook.

---

## Definicion de "Terminado"

- [ ] `/dev frontend` levanta server + tunnel + envia URL
- [ ] Dos proyectos con port 3000: el segundo obtiene 3001 automaticamente
- [ ] Tailscale Serve funciona (privado, tailnet only)
- [ ] Tailscale Funnel funciona (publico, con confirmacion)
- [ ] Cloudflare funciona como fallback
- [ ] `/tunnels` muestra estado completo
- [ ] Tunnels se limpian al detener sesion
- [ ] Webhook de Kapso tiene tunnel automatico
- [ ] Tunnels persisten en DB y se restauran al reiniciar
- [ ] Tests pasan, CI en verde
