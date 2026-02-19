# Fase 8 - Seguridad + Multi-LLM

> **Estado**: Pendiente
> **Dependencia**: Fase 6
> **Entregable**: TOTP 2FA, encryption at-rest, keychain, soporte Codex/Gemini
> **Al terminar**: JorchBot es seguro para uso serio y soporta multiples LLMs

---

## Objetivo

Hardening de seguridad (2FA, encryption, keychain) y expansion a multiples
LLM providers (OpenAI Codex, Google Gemini) para que el usuario elija.

---

## Entregables

### Seguridad

1. TOTP 2FA (Google Authenticator / Authy) cada 30 minutos
2. Encryption at-rest para API keys y credenciales
3. Integracion con OS keychain (macOS Keychain, Linux libsecret)
4. Audit log de acciones sensibles
5. Session lockout despues de intentos fallidos

### Multi-LLM

6. Arquitectura de LLM Provider abstracta
7. OpenAI Codex CLI integration
8. Google Gemini CLI integration (si existe)
9. Seleccion de LLM por proyecto en Jorchfile
10. Seleccion de LLM por sesion via comando

---

## Tareas de Seguridad

### 8.1 TOTP 2FA

- [ ] Instalar dependencia TOTP (ej: `otpauth` o `speakeasy`)
- [ ] Generar QR code de setup en onboarding
- [ ] Almacenar TOTP secret encriptado en DB
- [ ] Flujo de verificacion cada 30 minutos:

```
Bot: 🔒 Verificacion de seguridad requerida.
     Ingresa tu codigo TOTP:

User: 123456

Bot: ✓ Verificado. Sesion activa por 30 minutos.
```

- [ ] Configurable: intervalo de verificacion (default 30 min)
- [ ] Bypass para sesiones activas (no pedir TOTP en medio de una ejecucion)
- [ ] Lockout despues de 3 intentos fallidos (5 minutos)
- [ ] Setup: `jorchbot setup 2fa` (genera QR, escanea con app)

**Criterio de aceptacion**: Sin TOTP valido, JorchBot no ejecuta comandos.

### 8.2 Encryption at-rest

Resolver issue #7916 de OpenClaw (keys en texto plano):

- [ ] Encriptar `config.json` secciones sensibles (API keys, tokens)
- [ ] Usar `age` encryption o `libsodium` (secretbox)
- [ ] Master key derivada de password del usuario (PBKDF2 / Argon2)
- [ ] Decrypt automatico al iniciar con password
- [ ] Opcion: desbloquear con TOTP en vez de password separado

```bash
jorchbot start
Enter master password: ****
✓ Config decrypted. Gateway starting...
```

**Criterio de aceptacion**: API keys no son legibles en disco sin master password.

### 8.3 OS Keychain integration

- [ ] macOS: Keychain Access via `keychain-access` o `keytar`
- [ ] Linux: libsecret via `keytar`
- [ ] Windows: Windows Credential Manager via `keytar`
- [ ] Almacenar master key en keychain (no pedir password cada vez)
- [ ] Fallback a password manual si keychain no esta disponible

**Criterio de aceptacion**: En macOS, JorchBot desbloquea config sin pedir password (usa Keychain).

### 8.4 Audit log

- [ ] Tabla `audit_log` en DB
- [ ] Registrar: acciones de shell, aprobaciones, cambios de config, login/2FA
- [ ] No purgar (o retencion larga: 365 dias)
- [ ] Visible en GUI (seccion de seguridad)

**Criterio de aceptacion**: Audit log muestra quien hizo que y cuando.

### 8.5 Session lockout

- [ ] 3 TOTP fallidos → lockout 5 minutos
- [ ] 5 TOTP fallidos → lockout 30 minutos
- [ ] Notificar por el otro canal si hay intentos sospechosos
- [ ] Comando de emergencia: `jorchbot unlock` (desde terminal de la PC madre)

**Criterio de aceptacion**: Lockout funciona y se puede desbloquear desde terminal.

---

## Tareas Multi-LLM

### 8.6 LLM Provider abstraction

- [ ] Crear `src/providers/base.ts` con interfaz abstracta

```typescript
// src/providers/base.ts
export interface LLMProvider {
  name: string;
  // Ejecutar prompt y obtener respuesta
  execute(options: {
    prompt: string;
    cwd: string;
    systemPrompt?: string;
    sessionId?: string;
    outputFormat: "json" | "stream-json";
  }): AsyncIterable<LLMEvent>;

  // Responder a aprobacion
  respondToApproval(approved: boolean, feedback?: string): Promise<void>;

  // Obtener context %
  getContextPercent(): number;

  // Detener
  stop(): Promise<void>;
}

type LLMEvent =
  | { type: "text"; content: string }
  | { type: "tool_use_request"; tool: string; input: string; requestId: string }
  | { type: "tool_result"; tool: string; output: string }
  | { type: "complete"; contextPercent: number }
  | { type: "error"; message: string };
```

- [ ] Refactorizar `ClaudeRunner` para implementar `LLMProvider`
- [ ] Factory function para instanciar provider por nombre

**Criterio de aceptacion**: ClaudeRunner funciona a traves de la interfaz abstracta.

### 8.7 OpenAI Codex CLI integration

- [ ] Investigar Codex CLI headless capabilities
- [ ] Implementar `CodexProvider` que implemente `LLMProvider`
- [ ] Mapear eventos de Codex al formato comun de `LLMEvent`
- [ ] Soportar: API key y OAuth (subscription)
- [ ] Tests

**Criterio de aceptacion**: Sesion con Codex funciona igual que con Claude Code.

### 8.8 Google Gemini integration

- [ ] Investigar Gemini CLI o API para coding
- [ ] Implementar `GeminiProvider` si existe CLI headless
- [ ] Si no existe CLI: usar API directa con tool use
- [ ] Tests

**Criterio de aceptacion**: Sesion con Gemini funciona (basico).

### 8.9 Seleccion de LLM por proyecto

- [ ] Agregar campo `llm` al Jorchfile:

```makefile
PROJECT frontend
  path = ~/projects/my-app/frontend
  llm = claude
  instructions = Experto en React/Next.js

PROJECT backend
  path = ~/projects/my-app/backend
  llm = codex
  instructions = Backend Django
```

- [ ] Valores: `claude` (default), `codex`, `gemini`
- [ ] Session Manager instancia el provider correcto al crear sesion

**Criterio de aceptacion**: Dos sesiones con LLMs diferentes corriendo en paralelo.

### 8.10 Cambiar LLM por sesion

```
/llm codex              → Cambia sesion activa a Codex
/llm claude frontend    → Cambia frontend a Claude
/llm                    → Muestra LLM actual de cada sesion
```

- [ ] Cambiar LLM detiene la sesion actual y crea una nueva con el nuevo provider
- [ ] ADVERTENCIA: cambiar LLM pierde el contexto de la sesion anterior

**Criterio de aceptacion**: `/llm codex` cambia el provider de la sesion activa.

---

## Definicion de "Terminado"

### Seguridad

- [ ] TOTP 2FA funciona con Google Authenticator
- [ ] API keys encriptadas at-rest
- [ ] OS keychain funciona en macOS
- [ ] Audit log registra acciones sensibles
- [ ] Lockout funciona

### Multi-LLM

- [ ] ClaudeRunner refactorizado a LLMProvider
- [ ] Codex funciona como provider alternativo
- [ ] Seleccion por Jorchfile y por comando
- [ ] Tests pasan, CI en verde
