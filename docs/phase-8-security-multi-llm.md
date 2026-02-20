# Fase 8 - Seguridad + Multi-LLM

> **Estado**: Pendiente
> **Dependencia**: Fase 6
> **Entregable**: TOTP 2FA, encryption de keys at-rest, keychain del OS, soporte multi-LLM (Codex, Gemini)
> **Al terminar**: JorchBot pide TOTP cada 30 min, API keys encriptadas en disco, y puedes usar Codex o Gemini ademas de Claude Code

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

Agregar capas de seguridad adicionales sobre lo que OpenClaw ya provee
(TOTP 2FA, encryption, keychain) y abrir JorchBot a multiples LLMs
para que el usuario pueda elegir entre Claude Code, Codex, y Gemini.

---

## Entregables

### Seguridad

1. TOTP 2FA (cada 30 minutos, sobre DM pairing)
2. Encryption at-rest para keys y tokens (AES-256-GCM)
3. Integracion con keychain del OS
4. Audit logging
5. GUI: pagina de seguridad

### Multi-LLM

6. LLM abstraction layer (LLMRunner interface)
7. Codex Runner (OpenAI Codex headless)
8. Gemini Runner (Google Gemini Code Assist)
9. Seleccion de LLM por proyecto en Jorchfile
10. GUI: pagina de API keys management

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

| Dato                | Ubicacion                   | Estado actual |
| ------------------- | --------------------------- | ------------- |
| API keys de LLMs    | `~/.jorchbot/config.json`   | Texto plano   |
| Kapso API key       | `~/.jorchbot/config.json`   | Texto plano   |
| Telegram bot token  | `~/.jorchbot/jorchbot.json` | Texto plano   |
| TOTP secret         | `~/.jorchbot/jorchbot.db`   | Texto plano   |
| Session transcripts | `~/.jorchbot/sessions/`     | Texto plano   |

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
- [ ] Formato en config: `{ "$encrypted": "..." }` para valores encriptados
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

## Tareas — Multi-LLM

### 8.5 LLM Abstraction Layer

Crear una interfaz abstracta que permita usar diferentes LLMs como backend.

```typescript
// src/runners/llm-runner.ts
interface LLMRunner {
  readonly name: string; // "claude", "codex", "gemini"
  readonly displayName: string; // "Claude Code", "OpenAI Codex", "Gemini Code Assist"

  start(config: LLMSessionConfig): Promise<LLMSession>;
  resume(sessionId: string, message: string): Promise<void>;
  stop(sessionId: string): Promise<void>;

  onOutput(callback: (event: LLMOutputEvent) => void): void;
  onApproval(callback: (event: LLMApprovalEvent) => void): void;
  onError(callback: (event: LLMErrorEvent) => void): void;
}

interface LLMSessionConfig {
  project: string;
  workingDir: string;
  instructions?: string;
  allowedTools?: string[];
  approvalMode: ApprovalMode;
}

interface LLMOutputEvent {
  sessionId: string;
  type: "text" | "tool_use" | "tool_result" | "completion";
  content: string;
  metadata?: Record<string, unknown>;
}

interface LLMApprovalEvent {
  sessionId: string;
  actionId: string;
  tool: string;
  description: string;
  details: string;
}
```

- [ ] Definir interfaz `LLMRunner` en `src/runners/llm-runner.ts`
- [ ] Refactorizar `ClaudeRunner` para implementar `LLMRunner`
- [ ] Crear `LLMRunnerRegistry` para registrar runners disponibles
- [ ] SessionManager selecciona runner segun config del proyecto

**Criterio de aceptacion**: ClaudeRunner implementa LLMRunner. Nuevos runners se registran sin modificar SessionManager.

### 8.6 Codex Runner

Runner para OpenAI Codex (CLI headless).

> **NOTA**: OpenAI Codex CLI es similar a Claude Code pero usa modelos de OpenAI.
> El CLI se llama `codex` y tiene flags similares.

- [ ] Investigar Codex CLI: flags, output format, session management
- [ ] Implementar `CodexRunner` que implementa `LLMRunner`
- [ ] Mapear output de Codex al formato unificado de `LLMOutputEvent`
- [ ] Mapear aprobaciones de Codex a `LLMApprovalEvent`
- [ ] Requiere API key de OpenAI (almacenada encriptada, 8.2)

**Criterio de aceptacion**: `/new frontend --llm codex` crea sesion con Codex. Output se muestra igual que Claude.

### 8.7 Gemini Runner

Runner para Google Gemini Code Assist.

> **NOTA**: La integracion con Gemini depende del estado de su CLI/SDK al
> momento de implementacion. Puede ser via API directa o via CLI wrapper.

- [ ] Investigar Gemini Code Assist: CLI disponible, API, SDK
- [ ] Implementar `GeminiRunner` que implementa `LLMRunner`
- [ ] Mapear output y aprobaciones al formato unificado
- [ ] Requiere API key de Google (almacenada encriptada, 8.2)

**Criterio de aceptacion**: `/new frontend --llm gemini` crea sesion con Gemini.

### 8.8 Seleccion de LLM por Proyecto

El usuario puede elegir que LLM usar por proyecto en el Jorchfile o al crear sesion.

```makefile
# ~/.jorchbot/Jorchfile
PROJECT frontend
  path = ~/projects/my-app/frontend
  llm = claude                    # default
  instructions = Experto en React

PROJECT backend
  path = ~/projects/my-app/backend
  llm = codex                     # usa Codex para este proyecto
  instructions = Python backend

PROJECT scripts
  path = ~/projects/automation
  llm = gemini                    # usa Gemini
```

- [ ] Agregar campo `llm` al Jorchfile parser (Fase 3 extension)
- [ ] `/new frontend` usa el LLM del Jorchfile
- [ ] `/new frontend --llm codex` override del Jorchfile
- [ ] `/list` muestra que LLM usa cada sesion
- [ ] Default global configurable en config.json: `"defaultLLM": "claude"`

```
User: /list
Bot:  Sesiones activas:
      * frontend (Claude Code) - Context: 23% - confirm+verbose
      o backend (Codex) - Context: 12% - auto+summary
      o scripts (Gemini) - Context: 5% - auto+silent
```

**Criterio de aceptacion**: Diferentes sesiones pueden usar diferentes LLMs.

### 8.9 GUI: Seguridad y API Keys

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

**Criterio de aceptacion**: Desde la GUI puedes agregar una API key de OpenAI, verificar que funciona, y usarla con Codex.

---

## NO se construye en esta fase

- Hardware security keys (FIDO2/WebAuthn) — demasiado complejo para CLI
- OAuth flows para providers (solo API keys directas)
- Key rotation automatica
- Encryption de session transcripts (solo keys y tokens)
- Zero-knowledge architecture
- IP allowlisting (Tailscale ya maneja acceso de red)

---

## Definicion de "Terminado"

### Seguridad

- [ ] TOTP 2FA funciona: setup via QR, verificacion cada 30 min, pausa en timeout
- [ ] Keys encriptadas en disco con AES-256-GCM
- [ ] Master key en keychain del OS (macOS al menos)
- [ ] Audit log registra todos los eventos de seguridad
- [ ] GUI tiene pagina de seguridad

### Multi-LLM

- [ ] LLMRunner interface definida y ClaudeRunner refactorizado
- [ ] Al menos un runner adicional funcional (Codex o Gemini)
- [ ] Seleccion de LLM por proyecto en Jorchfile
- [ ] GUI tiene pagina de API keys
- [ ] Todos los tests pasan
- [ ] `pnpm check` pasa sin errores

---

## Notas Tecnicas

- TOTP usa RFC 6238 con SHA-1 y periodo de 30 segundos. Compatible con Google Authenticator, Authy, 1Password.
- AES-256-GCM es el estandar NIST recomendado para encryption at-rest. No usar CBC.
- `keytar` es un binding nativo que requiere compilacion. Alternativa: `@aspect-build/secrets` o `node-keychain`.
- La master key nunca se almacena en la DB. Solo en keychain del OS o en memoria durante la sesion.
- Para multi-LLM, cada runner es un child_process independiente. No comparten estado.
- Codex y Gemini pueden no tener CLIs headless equivalentes a Claude Code. En ese caso, usar sus APIs directamente con un wrapper que simula el mismo flujo.
- OpenClaw ya tiene multi-key failover con error classification. JorchBot puede reusar esa logica para los API keys de nuevos providers.
