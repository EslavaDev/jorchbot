# Fase 8 - Seguridad

> **Estado**: Pendiente
> **Dependencia**: Fase 6
> **Entregable**: TOTP 2FA, encryption de keys at-rest, keychain del OS, audit logging
> **Al terminar**: JorchBot pide TOTP cada 30 min, API keys encriptadas en disco, master key en keychain del OS, y audit log de acciones de seguridad
>
> **Nota**: La parte de Multi-LLM (AgentRunner interface, CodexRunner, GeminiRunner,
> RunnerRegistry) se movio a [Fase 10 — AgentRunner Abstraction](./phase-10-agent-runner.md).
> Fase 8 se enfoca exclusivamente en seguridad.

---

## Nota Arquitectural (rev. 2 — DeepWiki)

> OpenClaw ya tiene un sistema de seguridad robusto que JorchBot hereda:
>
> **Capa 1 (reusar)**:
>
> - Tool Policy Cascade de 6 niveles (deny siempre gana)
> - DM Pairing (codigo 6 digitos + allowlist)
> - Exec tool security (`deny` / `allowlist` / `full`)
> - BashProcessRegistry (timeouts, signal handling)
> - Auth profiles per-agent
> - Multi-key failover con error classification
>
> **Capa 2 (construir)**:
>
> - TOTP 2FA como capa adicional sobre DM pairing
> - Encryption at-rest para keys y tokens (AES-256-GCM)
> - Integracion con keychain del OS (macOS Keychain, Linux Secret Service)
> - LLM abstraction layer para multi-LLM
> - Codex runner y Gemini runner
> - Audit logging (quien hizo que, cuando)
>
> **Gaps de seguridad conocidos en OpenClaw** (que JorchBot resuelve):
>
> - Keys almacenadas en texto plano (issue #7916)
> - API keys se filtran al contexto del LLM (issue #11829)
> - Sin integracion con keychain del OS
> - Sin encriptacion at-rest

---

## Objetivo

Agregar capas de seguridad adicionales sobre lo que OpenClaw ya provee:
TOTP 2FA, encryption at-rest, integracion con keychain del OS, y audit logging.

---

## Entregables

1. TOTP 2FA (cada 30 minutos, sobre DM pairing)
2. Encryption at-rest para keys y tokens (AES-256-GCM)
3. Integracion con keychain del OS
4. Audit logging
5. GUI: pagina de seguridad
6. GUI: pagina de API keys management (keys encriptadas)

---

## Tareas — Seguridad

### 8.1 TOTP 2FA

Agrega autenticacion TOTP (Time-based One-Time Password) como capa adicional
sobre el DM pairing existente.

**Flujo**:

```
-- Primera vez (setup) --
User: /security setup-2fa
Bot:  Escanea este QR con tu app de autenticacion:
      [QR code como imagen]
      O ingresa manualmente: JBOS 7742 ... (base32 secret)

      Ingresa el codigo de 6 digitos para confirmar:

User: 847293
Bot:  2FA activado. Se te pedira un codigo cada 30 minutos.

-- Cada 30 minutos de actividad --
Bot:  Verificacion de seguridad.
      Ingresa tu codigo 2FA:

User: 193847
Bot:  Verificado. Puedes continuar.
```

- [ ] Implementar generacion de secret TOTP (RFC 6238)
- [ ] Generar QR code como imagen (libreria `qrcode`)
- [ ] Almacenar secret encriptado en DB (tabla `settings`)
- [ ] Verificar TOTP con ventana de +-1 (30 segundos tolerancia)
- [ ] Timer de 30 minutos desde ultima verificacion
- [ ] Si no verifica en 5 minutos: pausar todas las sesiones
- [ ] `/security setup-2fa`: Configurar 2FA
- [ ] `/security disable-2fa`: Deshabilitar 2FA (requiere codigo actual)
- [ ] `/security status`: Mostrar estado de 2FA

**Configuracion**:

```json
{
  "security": {
    "totp": {
      "enabled": false,
      "intervalMinutes": 30,
      "timeoutMinutes": 5
    }
  }
}
```

**Criterio de aceptacion**: 2FA pide codigo cada 30 min. Si no responde en 5 min, sesiones pausadas.

### 8.2 Encryption At-Rest

Encriptar keys, tokens, y datos sensibles almacenados en disco.

**Que se encripta**:

> **Nota**: Todo vive en `~/.jorchbot/`. El archivo `jorchbot.json` consolida
> la config de Layer 1 (OpenClaw, top-level) y Layer 2 (JorchBot, bajo la key `jorchbot`).
> No existe un `config.json` separado.

| Dato                   | Ubicacion                                                        | Estado actual |
| ---------------------- | ---------------------------------------------------------------- | ------------- |
| API keys de LLMs       | `jorchbot.json` → `models.providers[name].apiKey` (Layer 1)      | Texto plano   |
| Kapso API key          | `jorchbot.json` → `jorchbot.channels.kapso.apiKey`               | Texto plano   |
| Kapso webhook secret   | `jorchbot.json` → `jorchbot.channels.kapso.webhookSecret`        | Texto plano   |
| Telegram bot token     | `jorchbot.json` → `jorchbot.channels.telegram.botToken`          | Texto plano   |
| Gateway auth token/pwd | `jorchbot.json` → `gateway.auth.token` / `gateway.auth.password` | Texto plano   |
| OAuth tokens           | `~/.jorchbot/credentials/oauth.json`                             | Texto plano   |
| TOTP secret (futuro)   | `~/.jorchbot/jorchbot.db` → tabla `settings`                     | N/A (Fase 8)  |
| Mensajes de sesiones   | `~/.jorchbot/jorchbot.db` → tabla `messages`                     | Texto plano   |
| Memory embeddings      | `~/.jorchbot/memory/` (per-agent SQLite)                         | Texto plano   |

**Implementacion**:

- [ ] Implementar `SecureStore` en `src/security/secure-store.ts`
- [ ] Algoritmo: AES-256-GCM (nonce + ciphertext + auth tag)
- [ ] Master key derivada de password con PBKDF2 (100K iteraciones)
- [ ] Password configurado en primera ejecucion o via env var `JORCHBOT_MASTER_KEY`
- [ ] Opcion de usar keychain del OS (8.3) como master key store

```typescript
interface SecureStore {
  encrypt(data: string): EncryptedData;
  decrypt(data: EncryptedData): string;
  setMasterKey(password: string): void;
  isUnlocked(): boolean;
}

interface EncryptedData {
  version: 1;
  algorithm: "aes-256-gcm";
  nonce: string; // base64
  data: string; // base64
  tag: string; // base64
}
```

- [ ] Migrar keys existentes de texto plano a encriptado
- [ ] Formato en jorchbot.json: `{ "$encrypted": "..." }` para valores encriptados
- [ ] Al iniciar Gateway: pedir master key o leer de keychain
- [ ] Si master key no disponible: modo degradado (solo features sin keys)

**Criterio de aceptacion**: API keys en disco estan encriptadas. Sin master key no se pueden leer.

### 8.3 Integracion con Keychain del OS

Usar el keychain nativo del OS para almacenar la master key de forma segura.

| OS      | Keychain                                | Libreria                   |
| ------- | --------------------------------------- | -------------------------- |
| macOS   | Keychain Access                         | `keytar` o `node-keychain` |
| Linux   | Secret Service (GNOME Keyring, KWallet) | `keytar`                   |
| Windows | Credential Manager                      | `keytar`                   |

- [ ] Instalar `keytar` (binding nativo para keychains de OS)
- [ ] Almacenar master key en keychain con service name `jorchbot`
- [ ] Fallback: si keychain no disponible, pedir password por CLI
- [ ] `/security unlock`: Desbloquear manualmente si keychain fallo

**Criterio de aceptacion**: En macOS, la master key se almacena en Keychain Access. Al reiniciar, se recupera sin pedir password.

### 8.4 Audit Logging

Registrar todas las acciones de seguridad para auditoria.

| Evento                 | Datos registrados                           |
| ---------------------- | ------------------------------------------- |
| Login (DM pairing)     | timestamp, user_id, channel, success/fail   |
| 2FA verification       | timestamp, user_id, success/fail            |
| 2FA timeout            | timestamp, sessions_paused                  |
| Key access             | timestamp, key_name, action (read/write)    |
| Session create/destroy | timestamp, project, user_id                 |
| Tool approval          | timestamp, session, tool, approved/rejected |
| Config change          | timestamp, key, old_value, new_value        |

- [ ] Crear tabla `audit_log` en SQLite
- [ ] Implementar `AuditLogger` en `src/security/audit-logger.ts`
- [ ] Retener audit logs 90 dias (configurable)
- [ ] Exportar via `/security audit-export`
- [ ] Visible en GUI (Fase 6 extension)

**Criterio de aceptacion**: Todas las acciones de seguridad se registran. `/security audit-export` genera archivo.

---

## Tareas — GUI de Seguridad y API Keys

### 8.5 GUI: Seguridad y API Keys

Extender la GUI (Fase 6) con paginas de seguridad y API keys.

**Pagina de Seguridad**:

- Estado de 2FA (activo/inactivo, ultimo verificado)
- Audit log viewer (filtrable por tipo de evento)
- Boton para setup/disable 2FA
- Estado de encryption (unlocked/locked)

**Pagina de API Keys**:

- Lista de API keys configuradas (name, provider, status, last_used)
- Agregar/editar/eliminar keys (formulario)
- Test de conectividad por key
- Keys se almacenan encriptadas (8.2)
- Nunca mostrar key completa (solo ultimos 4 chars)

- [ ] Implementar pagina `/security` en la GUI
- [ ] Implementar pagina `/api-keys` en la GUI
- [ ] Endpoint REST: `GET/POST/DELETE /api/jorchbot/api-keys`
- [ ] Las keys se envian encriptadas al backend y se almacenan encriptadas
- [ ] Test button: verifica que la key funciona con el provider

**Criterio de aceptacion**: Desde la GUI puedes agregar una API key, verificar que funciona, y almacenarla encriptada.

---

## Tareas movidas a Fase 10

> Las siguientes tareas se movieron a [Fase 10 — AgentRunner Abstraction](./phase-10-agent-runner.md):
>
> - ~~8.5 LLM Abstraction Layer~~ → 10.1 Interfaz AgentRunner
> - ~~8.6 Codex Runner~~ → 10.4 CodexRunner
> - ~~8.7 Gemini Runner~~ → 10.5 GeminiRunner
> - ~~8.8 Seleccion de LLM por Proyecto~~ → 10.9 SessionManager Evolution
>
> Fase 10 expande estas tareas con tool approval abstraction, output normalization,
> runner lifecycle management, y RunnerRegistry. Ver el documento completo para detalles.

---

## NO se construye en esta fase

- Hardware security keys (FIDO2/WebAuthn) — demasiado complejo para CLI
- OAuth flows para nuevos providers (OpenClaw ya tiene OAuth para Anthropic; nuevos providers solo API keys directas)
- Key rotation automatica
- Encryption de mensajes en DB (solo keys y tokens en jorchbot.json)
- Zero-knowledge architecture
- IP allowlisting (Tailscale ya maneja acceso de red)

---

## Definicion de "Terminado"

- [ ] TOTP 2FA funciona: setup via QR, verificacion cada 30 min, pausa en timeout
- [ ] Keys encriptadas en disco con AES-256-GCM
- [ ] Master key en keychain del OS (macOS al menos)
- [ ] Audit log registra todos los eventos de seguridad
- [ ] GUI tiene pagina de seguridad
- [ ] GUI tiene pagina de API keys (encriptadas)
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- TOTP usa RFC 6238 con SHA-1 y periodo de 30 segundos. Compatible con Google Authenticator, Authy, 1Password.
- AES-256-GCM es el estandar NIST recomendado para encryption at-rest. No usar CBC.
- `keytar` es un binding nativo que requiere compilacion. Alternativa: `@aspect-build/secrets` o `node-keychain`.
- La master key nunca se almacena en la DB. Solo en keychain del OS o en memoria durante la sesion.
- OpenClaw ya tiene multi-key failover con error classification. JorchBot puede reusar esa logica para los API keys de nuevos providers.
