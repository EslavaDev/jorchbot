# JorchBot - Roadmap de Fases

> **Proyecto**: JorchBot
> **Ultima actualizacion**: 2026-02-18
> **Research base**: [research.md](./research.md)

---

## Revision Arquitectural (rev. 2 — DeepWiki)

> Tras el analisis completo de OpenClaw via DeepWiki, se establecio una
> **arquitectura de dos capas**:
>
> - **Capa 1 (reusar)**: Gateway, WebSocket, multi-agente, auto-compaction,
>   tool policies, memory system, Plugin SDK, DM pairing, Control UI.
> - **Capa 2 (construir)**: ClaudeRunner, Kapso channel plugin, Focus Model,
>   ShellRunner, Jorchfile, context % tracking.
>
> **Cambios clave**:
>
> - Cloudflare eliminado — solo Tailscale (Serve/Funnel)
> - Kapso debe ser plugin (`extensions/kapso/`) usando Plugin SDK
> - SessionManager usa agentes nativos de OpenClaw, no reimplementa
> - DM pairing (codigo 6 digitos) se reutiliza para auth de WP
> - Config de OpenClaw es JSON5 (no YAML)
>
> Ver `docs/research.md` seccion 17 para el analisis completo.

## Vision General

Cada fase es un **entregable funcional e independiente**. Al terminar cada fase,
JorchBot tiene valor de uso real. No se necesita completar todas las fases para
tener un producto usable.

---

## Fases

| Fase  | Nombre                                                       | Entregable                                           | Dependencia |
| ----- | ------------------------------------------------------------ | ---------------------------------------------------- | ----------- |
| **0** | [Fundacion](./phase-0-foundation.md)                         | Fork limpio de OpenClaw + DB + estructura            | Ninguna     |
| **1** | [Canal WhatsApp + Sesion Unica](./phase-1-single-session.md) | Hablar con 1 instancia de Claude Code via WP         | Fase 0      |
| **2** | [Workspaces Multi-Sesion](./phase-2-multi-session.md)        | Multiples sesiones Claude Code + shell + focus model | Fase 1      |
| **3** | [Jorchfile Engine](./phase-3-jorchfile.md)                   | Comandos predefinidos por proyecto + Makefile        | Fase 2      |
| **4** | [Tunnel Manager](./phase-4-tunnels.md)                       | Tailscale Serve/Funnel + auto-port + URL al chat     | Fase 2      |
| **5** | [UX Avanzado](./phase-5-advanced-ux.md)                      | Modos, listas Kapso, chunking, Yes+feedback          | Fase 2      |
| **6** | [GUI de Configuracion](./phase-6-gui.md)                     | Dashboard web via Tailscale Serve                    | Fase 4      |
| **7** | [Telegram](./phase-7-telegram.md)                            | Canal secundario completo con inline keyboards       | Fase 2      |
| **8** | [Seguridad + Multi-LLM](./phase-8-security-multi-llm.md)     | TOTP 2FA, encryption, Codex/Gemini                   | Fase 6      |
| **9** | [App Movil](./phase-9-mobile-app.md)                         | App propia iOS/Android                               | Fase 8      |

---

## Diagrama de Dependencias

```
Fase 0 (Fundacion)
  │
  ▼
Fase 1 (WP + Sesion Unica)
  │
  ▼
Fase 2 (Multi-Sesion + Shell)
  │
  ├──────────┬──────────┬──────────┐
  ▼          ▼          ▼          ▼
Fase 3    Fase 4     Fase 5     Fase 7
(Jorchfile)(Tunnels) (UX Avanz) (Telegram)
             │
             ▼
           Fase 6 (GUI)
             │
             ▼
           Fase 8 (Seguridad + Multi-LLM)
             │
             ▼
           Fase 9 (App Movil)
```

**Fases 3, 4, 5 y 7 pueden desarrollarse en paralelo** despues de completar Fase 2.

---

## MVP Minimo

Para tener un JorchBot usable necesitas: **Fase 0 + Fase 1 + Fase 2 + Fase 3 + Fase 4**

Esto te da:

- WhatsApp via Kapso
- Multiples sesiones de Claude Code
- Comandos shell directos
- Jorchfile con proyectos predefinidos
- Tunnels automaticos via Tailscale
- Aprobaciones via botones

Todo lo demas es mejora incremental.
