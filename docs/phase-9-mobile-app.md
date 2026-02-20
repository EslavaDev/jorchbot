# Fase 9 - App Movil

> **Estado**: Pendiente
> **Dependencia**: Fase 8
> **Entregable**: App nativa iOS/Android con conexion directa al Gateway
> **Al terminar**: App propia en tu celular con UI rica para sesiones, aprobaciones, logs, y configuracion — sin depender de WhatsApp ni Telegram

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> OpenClaw ya tiene el concepto de **Device Nodes**: apps nativas (macOS, iOS, Android)
> que se conectan al Gateway como "nodes" via WebSocket. JorchBot puede reusar
> este sistema para la app movil.
>
> **Capa 1 (reusar)**: Device node protocol, WebSocket connection al Gateway,
> device authentication (`device-auth.ts`), node RPC (`node.list`, `node.describe`,
> `node.invoke`, `node.pair.*`).
>
> **Capa 2 (construir)**: App UI nativa, push notifications, offline queue,
> rich approval UI, session dashboard, log viewer, tunnel status, settings.
>
> **Ventaja sobre WhatsApp/Telegram**: Sin limites de mensajeria, UI rica
> con componentes nativos, push notifications reales, offline support,
> sin riesgo de ban de plataforma.

---

## Objetivo

Crear una app movil nativa (iOS y Android) que se conecta directamente al
Gateway de JorchBot via WebSocket, ofreciendo una experiencia de usuario
rica sin las limitaciones de WhatsApp o Telegram.

---

## Decisiones Tecnicas

| Aspecto        | Decision                           | Razon                                           |
| -------------- | ---------------------------------- | ----------------------------------------------- |
| Framework      | React Native (Expo)                | Cross-platform, ecosystem maduro, TypeScript    |
| Conexion       | WebSocket al Gateway               | Real-time, bidireccional, ya existe en OpenClaw |
| Auth           | Device pairing (como Device Nodes) | Reusar protocolo existente                      |
| Notificaciones | Push (APNs + FCM)                  | Notificaciones reales incluso con app cerrada   |
| Offline        | Queue local (SQLite)               | Enviar comandos cuando reconecte                |

---

## Entregables

1. App React Native (Expo) para iOS y Android
2. Gateway URL setup (onboarding obligatorio con QR y manual)
3. Conexion WebSocket al Gateway (via Tailscale)
4. Device pairing (auth)
5. Session dashboard (sesiones, context %, modos)
6. Chat view por sesion (mensajes + aprobaciones)
7. Rich approval UI (botones, diff viewer, feedback input)
8. Push notifications (APNs + FCM)
9. Offline queue
10. Settings y configuracion
11. Jorchfile viewer/editor

---

## Tareas

### 9.1 Setup del Proyecto

- [ ] Crear proyecto Expo con TypeScript: `npx create-expo-app jorchbot-app`
- [ ] Configurar estructura de carpetas (screens, components, services, hooks)
- [ ] Configurar navigation (React Navigation)
- [ ] Configurar tema visual (consistente con GUI web)
- [ ] Configurar build para iOS y Android
- [ ] Publicar en TestFlight (iOS) y Play Store internal testing (Android)

**Criterio de aceptacion**: App compila y corre en simulador iOS y emulador Android.

### 9.2 Gateway URL Setup (Onboarding obligatorio)

Sin la URL del Gateway, la app no puede hacer absolutamente nada. Esta es la
primera pantalla que ve el usuario y es **bloqueante**: no se puede acceder a
ninguna otra funcionalidad hasta que la conexion al Gateway este establecida.

**Pantalla de onboarding**:

```
+-------------------------------------------+
|                                             |
|           JorchBot                         |
|           Conecta tu Gateway               |
|                                             |
|  Para usar JorchBot necesitas conectar     |
|  tu app al Gateway que corre en tu PC.     |
|                                             |
|  +---------------------------------------+  |
|  | URL del Gateway:                      |  |
|  | [https://mi-pc.tailnet.ts.net:18789]  |  |
|  +---------------------------------------+  |
|                                             |
|  --- o ---                                 |
|                                             |
|  [Escanear QR]                             |
|                                             |
|  El Gateway debe estar corriendo.          |
|  Ejecuta: jorchbot start                   |
|                                             |
|  [Conectar]                                |
|                                             |
+-------------------------------------------+
```

**3 formas de ingresar la URL**:

| Metodo    | Descripcion                                        | Cuando usarlo             |
| --------- | -------------------------------------------------- | ------------------------- |
| Manual    | Escribir `https://<device>.tailnet.ts.net:18789`   | Setup inicial             |
| QR code   | Escanear QR que muestra `jorchbot status` o la GUI | Forma mas facil           |
| Historial | Seleccionar de conexiones previas                  | Reconexion a otro Gateway |

**Flujo completo**:

```
1. Usuario abre la app por primera vez
2. Ve pantalla de "Conectar tu Gateway"
3. Opcion A: ingresa URL manualmente
   Opcion B: escanea QR (jorchbot status --qr o GUI muestra QR)
4. App intenta conectar via HTTPS al health endpoint:
   GET https://<url>/__openclaw__/health → {"ok": true}
5. Si falla:
   - "No se puede conectar. Verifica que:
     - El Gateway esta corriendo (jorchbot start)
     - Tu celular esta en el tailnet (app Tailscale activa)
     - La URL es correcta"
6. Si conecta: pasa a pantalla de Device Pairing (9.4)
7. URL se almacena en AsyncStorage para reconexion automatica
```

**QR code desde el Gateway**:

El Gateway debe generar un QR code con la URL de conexion para facilitar el onboarding.

```bash
# En la terminal
$ jorchbot status --qr
Gateway: running (pid 12345)
URL: https://mi-pc.tailnet.ts.net:18789

[QR code ASCII art con la URL]

# Tambien disponible en la GUI web (Fase 6)
```

- [ ] Pantalla de onboarding como primera pantalla (bloqueante)
- [ ] Input de URL con validacion de formato (https, puerto)
- [ ] Escaner QR con `expo-camera` o `expo-barcode-scanner`
- [ ] Health check al endpoint `/__openclaw__/health` antes de continuar
- [ ] Mensajes de error claros segun el tipo de fallo:
  - Network error → "Verifica que estas en el tailnet"
  - 404 / connection refused → "Gateway no encontrado en esa URL"
  - Timeout → "El Gateway no responde. Esta corriendo?"
- [ ] Almacenar URL en AsyncStorage (persistente entre reinicios de app)
- [ ] Soporte de multiples Gateways guardados (para usuarios con varias maquinas)
- [ ] Pantalla de "Gateways guardados" para seleccionar entre conexiones previas
- [ ] Agregar `jorchbot status --qr` al CLI (genera QR con URL)
- [ ] Agregar QR a la GUI web (Fase 6 extension)

```typescript
// services/gateway-store.ts
interface SavedGateway {
  url: string;
  name: string; // hostname o alias
  lastConnected: Date;
  authToken?: string; // si ya esta pareado
}

interface GatewayStore {
  save(gateway: SavedGateway): Promise<void>;
  list(): Promise<SavedGateway[]>;
  getDefault(): Promise<SavedGateway | null>;
  remove(url: string): Promise<void>;
}
```

**Criterio de aceptacion**: Al abrir la app sin configurar, la unica opcion es ingresar la URL del Gateway. Sin URL valida no se puede hacer nada mas. QR code funciona como alternativa rapida.

### 9.3 Conexion WebSocket al Gateway

Una vez que la URL esta configurada (9.2), la app mantiene una conexion
WebSocket persistente al Gateway.

- [ ] Implementar `GatewayConnection` service con reconnect automatico
- [ ] URL del Gateway desde `GatewayStore` (configurado en 9.2)
- [ ] Protocolo: `wss://<url>/` (WebSocket sobre TLS via Tailscale)
- [ ] Manejar reconexion con backoff exponencial (1s, 2s, 4s, 8s, max 30s)
- [ ] Indicador de estado de conexion en la UI (connected/reconnecting/offline)
- [ ] Heartbeat cada 30 segundos para detectar desconexiones
- [ ] Si la URL deja de funcionar: mostrar boton "Cambiar Gateway"

```typescript
// services/gateway-connection.ts
interface GatewayConnection {
  connect(url: string, authToken: string): Promise<void>;
  disconnect(): void;
  send(method: string, params: unknown): Promise<unknown>;
  onEvent(event: string, callback: (data: unknown) => void): void;
  status: "connected" | "reconnecting" | "offline";
}
```

**Criterio de aceptacion**: App se conecta al Gateway, mantiene conexion, y reconecta automaticamente.

### 9.4 Device Pairing

Usar el protocolo de Device Nodes de OpenClaw para autenticar la app.
Esto ocurre automaticamente despues de conectar al Gateway (9.2 + 9.3).

**Flujo**:

```
1. App conecta al Gateway (URL ya configurada en 9.2)
2. Si no tiene auth token guardado:
   a. App solicita pairing al Gateway
   b. Gateway genera codigo de 6 digitos
   c. App muestra: "Codigo de pairing: 847293"
   d. En la terminal: jorchbot pairing approve 847293
   e. App recibe token de autenticacion
   f. Token almacenado en Keychain del dispositivo
3. Si tiene auth token guardado: reconexion automatica
```

- [ ] Detectar si hay token guardado para esta URL (de `GatewayStore`)
- [ ] Si no: solicitar pairing via WebSocket (`node.pair.request`)
- [ ] Mostrar codigo de 6 digitos al usuario con instrucciones claras
- [ ] Recibir y almacenar auth token en Keychain nativo (`expo-secure-store`)
- [ ] Actualizar `GatewayStore` con el token
- [ ] Auto-reconectar con token guardado al reabrir app

**Criterio de aceptacion**: App se parea con Gateway. Al cerrar y reabrir, reconecta sin pedir pairing.

### 9.5 Session Dashboard

Pantalla principal con lista de sesiones y su estado.

```
+-------------------------------------------+
|  JorchBot                    [Settings] ⚙️  |
+-------------------------------------------+
|                                             |
|  Sesiones                                  |
|                                             |
|  +---------------------------------------+  |
|  | * frontend              23% [====  ]  |  |
|  |   confirm + verbose                   |  |
|  |   Claude Code                         |  |
|  +---------------------------------------+  |
|                                             |
|  +---------------------------------------+  |
|  | o backend               45% [======]  |  |
|  |   auto + silent                       |  |
|  |   Codex                               |  |
|  |   ! Aprobacion pendiente              |  |
|  +---------------------------------------+  |
|                                             |
|  [+ Nueva sesion]                          |
|                                             |
|  Tunnels                                   |
|  frontend → :3000 (Serve, healthy)         |
|  backend  → :8000 (Serve, healthy)         |
|                                             |
+-------------------------------------------+
|  [Dashboard] [Logs] [Tunnels] [Settings]   |
+-------------------------------------------+
```

- [ ] Lista de sesiones con swipe actions (stop, compact)
- [ ] Barra de progreso de context window
- [ ] Badge de aprobaciones pendientes
- [ ] Pull-to-refresh
- [ ] Tap en sesion → abre chat view
- [ ] Boton de nueva sesion (seleccionar proyecto del Jorchfile)

**Criterio de aceptacion**: Dashboard muestra sesiones con estado actualizado en tiempo real.

### 9.6 Chat View por Sesion

Vista de chat similar a WhatsApp/Telegram pero optimizada para JorchBot.

- [ ] Lista de mensajes cronologica con auto-scroll
- [ ] Burbujas de chat diferenciadas: user (derecha), bot (izquierda), system (centro)
- [ ] Syntax highlighting para bloques de codigo (react-native-syntax-highlighter)
- [ ] Diff viewer inline para cambios de archivos
- [ ] Input de texto con envio
- [ ] Shortcuts rapidos: `/mode`, `/stop`, `/compact`
- [ ] Prefijo de shell `$` reconocido

**Criterio de aceptacion**: Chat view muestra conversacion con Claude Code con codigo formateado.

### 9.7 Rich Approval UI

Aprobaciones con UI nativa rica (mucho mejor que botones de WhatsApp).

```
+-------------------------------------------+
|  [frontend] Aprobacion                     |
+-------------------------------------------+
|                                             |
|  Claude quiere ejecutar:                   |
|                                             |
|  1. Edit: src/Login.tsx                    |
|     +12 lineas, -3 lineas                  |
|     [Ver diff]                             |
|                                             |
|  2. Bash: npm install zod                  |
|     [Ver detalles]                         |
|                                             |
|  Razonamiento:                             |
|  "Agregando validacion con Zod porque..."  |
|                                             |
|  +---------------------------------------+  |
|  | Feedback (opcional):                  |  |
|  | [usa yup en vez de zod             ]  |  |
|  +---------------------------------------+  |
|                                             |
|  [Aprobar todo]  [Rechazar todo]           |
|  [Aprobar 1]     [Aprobar 2]              |
+-------------------------------------------+
```

- [ ] Pantalla modal de aprobacion
- [ ] Lista de acciones con expand/collapse
- [ ] Diff viewer para ediciones de archivos
- [ ] Campo de feedback opcional (siempre visible, no requiere boton separado)
- [ ] Botones de accion granular (aprobar/rechazar individual)
- [ ] Animacion de "ejecutando..." al aprobar

**Criterio de aceptacion**: Aprobacion con diff viewer y feedback en una sola pantalla.

### 9.8 Push Notifications

Notificaciones reales cuando JorchBot necesita atencion.

| Evento                        | Notificacion                             |
| ----------------------------- | ---------------------------------------- |
| Aprobacion pendiente          | "[frontend] Claude necesita aprobacion"  |
| Tarea completada (background) | "[backend] Tarea completada"             |
| Error                         | "[frontend] Error en build"              |
| Context 70%                   | "[frontend] Context al 70%"              |
| Context 90%                   | "[frontend] Context al 90% - Compactar?" |
| 2FA requerido                 | "Verificacion de seguridad requerida"    |

- [ ] Configurar APNs (Apple Push Notification service) para iOS
- [ ] Configurar FCM (Firebase Cloud Messaging) para Android
- [ ] Gateway envia push via servicio de notificaciones
- [ ] Deep links: tocar notificacion → abre la pantalla relevante
- [ ] Configuracion de notificaciones (silenciar por sesion, horarios)

**Criterio de aceptacion**: Al pedir aprobacion, llega push notification. Al tocarla, abre la pantalla de aprobacion.

### 9.9 Offline Queue

Soporte basico para cuando la conexion se pierde.

- [ ] SQLite local en la app para queue de comandos
- [ ] Si esta offline, encolar comando localmente
- [ ] Indicador visual de "offline - 2 comandos en cola"
- [ ] Al reconectar, enviar comandos encolados en orden
- [ ] No encolar aprobaciones (pueden haber expirado)
- [ ] Limite de queue: 20 comandos

**Criterio de aceptacion**: Perder conexion, escribir comando, reconectar → comando se ejecuta.

### 9.10 Settings y Configuracion

- [ ] Pantalla de URL del Gateway (editar conexion)
- [ ] Estado de la conexion y device pairing
- [ ] Configuracion de notificaciones
- [ ] Tema (light/dark, seguir sistema)
- [ ] Log de audit local (que se envio, cuando)
- [ ] Boton de "Desconectar" (eliminar token de pairing)
- [ ] Version de la app y del Gateway

**Criterio de aceptacion**: Settings funcional con todas las opciones.

### 9.11 Jorchfile Viewer/Editor

- [ ] Vista del Jorchfile parseado (proyectos y comandos)
- [ ] Edicion basica (cambiar path, instrucciones, modo)
- [ ] Guardar cambios → se envian al Gateway → se escribe en disco
- [ ] Validacion antes de guardar

**Criterio de aceptacion**: Editar instrucciones de un proyecto desde la app y guardar.

---

## NO se construye en esta fase

- Widget de iOS/Android (resumen en home screen)
- Apple Watch / Wear OS companion
- Siri / Google Assistant integration
- Biometric auth (Face ID / fingerprint) — se puede agregar despues
- File browsing del proyecto (ver archivos desde la app)
- Inline editor de codigo en la app
- Video/screen sharing
- Publicacion en App Store / Play Store publico (solo TestFlight / internal testing)

---

## Definicion de "Terminado"

- [ ] App compila y corre en iOS (TestFlight) y Android (internal testing)
- [ ] Onboarding de Gateway URL funciona (manual + QR)
- [ ] Sin URL configurada, la app no permite acceder a ninguna funcionalidad
- [ ] `jorchbot status --qr` genera QR con URL del Gateway
- [ ] Device pairing funciona via WebSocket
- [ ] Dashboard muestra sesiones con estado en tiempo real
- [ ] Chat view con syntax highlighting y diff viewer
- [ ] Aprobaciones con UI rica (diff, feedback, granular)
- [ ] Push notifications para aprobaciones, errores, alertas
- [ ] Offline queue funcional
- [ ] Settings completo
- [ ] Jorchfile viewer/editor funcional
- [ ] App es responsive en diferentes tamanos de pantalla
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores (monorepo)

---

## Notas Tecnicas

- Expo simplifica la compilacion y distribucion. No necesitar ejectar (bare workflow) si es posible.
- La conexion WebSocket va via Tailscale. El dispositivo debe estar en el tailnet (app de Tailscale instalada).
- Para push notifications, el Gateway necesita un servicio de entrega (Firebase Admin SDK para FCM, `@parse/node-apn` para APNs). Alternativa: usar servicio de push como OneSignal o Expo Notifications.
- Device Nodes de OpenClaw ya manejan el protocolo de pairing y autenticacion. Reusar.
- SQLite local en React Native via `expo-sqlite`.
- El proyecto de la app puede vivir en `apps/mobile/` dentro del monorepo o como repo separado.
- React Navigation para navegacion. No usar Expo Router si agrega complejidad innecesaria.
- Para syntax highlighting en React Native: `react-native-syntax-highlighter` con `highlight.js`.
