# Fase 9 - App Movil

> **Estado**: Pendiente (largo plazo)
> **Dependencia**: Fase 8
> **Entregable**: App nativa iOS/Android propia
> **Al terminar**: Experiencia completa sin depender de WhatsApp ni Telegram

---

## Objetivo

Crear una app movil propia que reemplace WhatsApp/Telegram como canal principal.
Esto elimina las restricciones de plataformas de terceros (ban de Meta, limite de
4096 chars, maximo 3 botones, etc.) y permite una UX optimizada para desarrollo.

---

## Entregables

1. App nativa iOS (Swift) y Android (Kotlin)
2. Comunicacion directa con Gateway via WebSocket (sobre Tailscale)
3. UI optimizada para codigo (syntax highlighting, monospace)
4. Sesiones como tabs (resuelve el problema de single-threaded)
5. Terminal integrada
6. Notificaciones push
7. Offline queue (encolar comandos sin conexion)

---

## Tareas

### 9.1 Definir stack movil

**Opciones**:

- **React Native / Expo**: Cross-platform, JavaScript, una codebase
- **Flutter**: Cross-platform, Dart, buen rendimiento
- **Nativo (Swift + Kotlin)**: Mejor rendimiento, dos codebases
- **OpenClaw ya tiene**: Swift (macOS/iOS) + Kotlin (Android) - posible reusar

**Decision**: Evaluar en el momento. React Native/Expo es el mas rapido para MVP.
OpenClaw ya tiene apps nativas que podrian servir de base.

### 9.2 Ventajas sobre WhatsApp/Telegram

| Feature           | WP/Telegram       | App propia            |
| ----------------- | ----------------- | --------------------- |
| Mensajes          | 4096 chars max    | Sin limite            |
| Botones           | 3 max (WP)        | Ilimitados            |
| Code highlighting | Basico (Telegram) | Completo (syntax)     |
| Sesiones          | Single-threaded   | Tabs/panels           |
| Terminal          | No                | Integrada             |
| Aprobaciones      | Botones/listas    | UI rica (diff viewer) |
| Archivos          | Limitados         | Streaming directo     |
| Offline           | No                | Queue de comandos     |
| Customizacion     | Ninguna           | Total                 |
| Riesgo de ban     | Si (WP)           | No                    |

### 9.3 Features principales

**Sesiones como tabs**:

- Cada sesion es un tab en la app
- Output de Claude Code en tiempo real por tab
- No hay "sesion activa" ni "background" - todo es visible
- Switch instantaneo entre tabs

**Terminal integrada**:

- Shell completa en la app (no solo prefijo `$`)
- Monospace font, colores ANSI
- History, autocomplete
- Conectada al workspace del tab activo

**Diff viewer**:

- Cuando Claude propone edits, mostrar diff visual
- Side-by-side o unified
- Aprobar/rechazar por chunk (no solo por archivo)

**Notificaciones push**:

- Aprobacion necesaria → push notification
- Error → push notification
- Context 90% → push notification
- Tarea completada → push notification

**Offline queue**:

- Si no hay conexion, encolar comandos
- Al reconectar, ejecutar en orden
- Indicador visual de "offline / syncing"

### 9.4 Comunicacion con Gateway

- [ ] WebSocket directo al Gateway via Tailscale (privado)
- [ ] Protocolo: mismo WebSocket que ya usa el Gateway de OpenClaw
- [ ] Auth: TOTP o biometrico (Face ID / fingerprint)
- [ ] Reconexion automatica

### 9.5 Design system

- [ ] Definir design system (colores, tipografia, componentes)
- [ ] Dark mode por defecto (developers prefieren dark)
- [ ] Monospace font para codigo
- [ ] Colores de status consistentes con los prefijos de WP

---

## Definicion de "Terminado"

- [ ] App funcional en iOS y Android
- [ ] Sesiones como tabs
- [ ] Terminal integrada
- [ ] Diff viewer para aprobaciones
- [ ] Push notifications
- [ ] Offline queue
- [ ] Auth biometrico + TOTP
- [ ] Publicada en App Store / Play Store (o TestFlight/beta)

---

## Notas

Esta fase es la mas compleja y larga. Se puede subdividir en:

- 9a: App basica (chat + sesiones como tabs)
- 9b: Terminal integrada
- 9c: Diff viewer + UX avanzada
- 9d: Offline + push + publicacion

La decision de stack (React Native vs nativo) debe tomarse cuando se inicie esta fase,
evaluando el estado del arte en ese momento.
