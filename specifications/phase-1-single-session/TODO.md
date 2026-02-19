# Phase 1 — TODO

> **Spec**: [SPEC.md](./SPEC.md)
> **Total tasks**: 52
> **Sub-phases**: 1A-1H

---

## Dependency diagram

```
1A (Errors + Config)
  │
  ├─► 1B (Context Tracker)
  │
  ├─► 1C (KapsoClient + Webhook)
  │     │
  │     └─► 1D (Kapso Channel Plugin)
  │           │
  │           └──────────────┐
  │                          │
  ├─► 1E (ClaudeRunner)      │
  │     │                    │
  │     └─► 1F (Approval Manager)
  │           │              │
  │           └──────┐       │
  │                  ▼       ▼
  │              1G (Command Router + Gateway Integration)
  │                  │
  │                  ▼
  └──────────► 1H (Onboarding + Final Verification)
```

**1A and 1B/1C/1E can run in parallel** after 1A.
**1D depends on 1C**, **1F depends on 1E**, **1G depends on 1D+1F**.

---

## 1A — Errors + Config (prerequisites)

- [x] **1A.1** Add `ClaudeRunnerSpawnError` to `src/errors/index.ts`
- [x] **1A.2** Add `ClaudeRunnerParseError` to `src/errors/index.ts`
- [x] **1A.3** Add `ClaudeRunnerTimeoutError` to `src/errors/index.ts`
- [x] **1A.4** Add `ClaudeRunnerProcessError` to `src/errors/index.ts`
- [x] **1A.5** Update `KapsoSchema` in `src/config/jorchbot-config.ts`: add `phoneNumberId: z.string().default("")`
- [x] **1A.6** Update `KapsoSchema` in `src/config/jorchbot-config.ts`: add `webhookVerifyToken: z.string().default("")`
- [x] **1A.7** Update existing config test if any, to cover new fields
- [x] **1A.8** Verify that `pnpm check` passes

**Dependencies**: None (starting point)

---

## 1B — Context Tracker

- [x] **1B.1** Create `src/sessions/jorchbot/context-tracker.ts` with `calculateContextUsage()` and `formatContextUsage()`
- [x] **1B.2** Create `src/sessions/jorchbot/context-tracker.test.ts`
  - Test: returns 0% when no tokens used
  - Test: calculates correct percentage for known values (100K+50K = 75%)
  - Test: caps at 100% when exceeding limit
  - Test: formatContextUsage produces correct string format
- [x] **1B.3** Verify tests pass: `pnpm test:fast -- src/sessions/jorchbot/context-tracker.test.ts`

**Dependencies**: 1A (errors defined, although this module doesn't use them directly)

---

## 1C — KapsoClient + Webhook Handler

- [x] **1C.1** Create `extensions/kapso/src/types.ts` with:
  - `KapsoClientError` (extends `JorchBotError`)
  - `KapsoWebhookVerificationError` (extends `JorchBotError`)
  - Webhook payload interfaces: `KapsoWebhookPayload`, `KapsoWebhookEntry`, `KapsoWebhookChange`, `KapsoWebhookValue`, `KapsoIncomingMessage`, `KapsoMessageStatus`
  - `ResolvedKapsoAccount` interface
  - `ApprovalButtonPayload` interface
- [x] **1C.2** Create `extensions/kapso/src/client.ts` with `KapsoClient`:
  - Constructor with `apiKey`, `phoneNumberId`, `baseUrl`
  - `sendText()` — send plain text
  - `sendButtons()` — send interactive message with buttons (max 3)
  - `sendDocument()` — send document (for long outputs)
  - Private `post()` method with error handling (network + API)
- [x] **1C.3** Create `extensions/kapso/src/client.test.ts`:
  - Test: sendText sends correct payload
  - Test: sendText throws KapsoClientError on API error (401)
  - Test: sendText throws KapsoClientError on network error
  - Test: sendButtons sends correct interactive message
  - Test: sendButtons throws if > 3 buttons
  - Test: sendDocument sends correct document
- [x] **1C.4** Create `extensions/kapso/src/webhook.ts` with `createWebhookHandlers()`:
  - `verify()` — GET handler for Kapso challenge
  - `receive()` — POST handler for incoming messages
  - Parse text messages and button replies
- [x] **1C.5** Create `extensions/kapso/src/webhook.test.ts`:
  - Test: verify responds 200 with challenge on valid token
  - Test: verify throws KapsoWebhookVerificationError on invalid token
  - Test: receive calls onMessage for text messages
  - Test: receive calls onButtonReply for button replies
- [x] **1C.6** Verify all tests: `pnpm test:fast -- extensions/kapso/`

**Dependencies**: 1A (base errors defined)

---

## 1D — Kapso Channel Plugin

- [x] **1D.1** Create `extensions/kapso/src/runtime.ts` with `setKapsoRuntime()` and `getKapsoRuntime()`
- [x] **1D.2** Create `extensions/kapso/src/channel.ts` with `kapsoPlugin: ChannelPlugin<ResolvedKapsoAccount>`:
  - `id`, `meta` — channel metadata
  - `capabilities` — chatTypes: ["direct"], no polls/reactions/media in Phase 1
  - `pairing` — idLabel "whatsappSenderId", normalizeAllowEntry with normalizeE164
  - `config` — listAccountIds, resolveAccount, defaultAccountId, isEnabled, isConfigured, describeAccount
  - `security` — resolveDmPolicy (inherits pattern from WP plugin)
  - `outbound` — deliveryMode "direct", textChunkLimit 4096, sendText, sendMedia (documents only)
  - `gateway` — startAccount, stopAccount
  - `status` — defaultRuntime, buildAccountSnapshot
- [x] **1D.3** Create `extensions/kapso/src/channel.test.ts`:
  - Test: config.listAccountIds returns default account
  - Test: config.resolveAccount returns correct fields
  - Test: config.isEnabled returns false without apiKey
  - Test: security.resolveDmPolicy returns pairing by default
  - Test: outbound.textChunkLimit is 4096
  - Test: capabilities has direct chatType only
- [x] **1D.4** Activate `extensions/kapso/index.ts` — uncomment plugin definition, import channel + runtime
- [x] **1D.5** Verify `openclaw.plugin.json` has the correct channel id
- [x] **1D.6** Verify tests pass: `pnpm test:fast -- extensions/kapso/`
- [x] **1D.7** Verify that `pnpm check` passes (no type errors in the plugin)

**Dependencies**: 1C (client + webhook ready)

---

## 1E — ClaudeRunner

- [x] **1E.1** Replace placeholder in `src/sessions/jorchbot/claude-runner.ts` with full implementation:
  - `ClaudeRunner` class extending `EventEmitter`
  - `start()` — spawn `claude -p <prompt> --output-format stream-json`
  - `resume()` — spawn with `--resume <session_id>`
  - `respondToApproval()` — write "yes\n" or "no\n" to stdin
  - `stop()` — SIGTERM → SIGKILL fallback
  - `getSessionId()`, `getStatus()`, `getContextPercent()`
  - NDJSON parsing with readline (ignore non-JSON lines)
  - Events: `text`, `toolUse`, `result`, `error`
  - Configurable timeout (default 5 min)
- [x] **1E.2** Create `src/sessions/jorchbot/claude-runner.test.ts`:
  - Test: spawns claude with correct args
  - Test: parses session_id from init event
  - Test: emits text events from assistant messages
  - Test: emits toolUse events and sets status to waiting_approval
  - Test: calculates context percent from result usage
  - Test: throws ClaudeRunnerSpawnError when binary not found
  - Test: throws ClaudeRunnerTimeoutError after timeout
  - Test: resume throws ClaudeRunnerProcessError if no session
  - Test: respondToApproval writes "yes\n" to stdin on approve
  - Test: respondToApproval throws if not waiting for approval
- [x] **1E.3** Verify tests pass: `pnpm test:fast -- src/sessions/jorchbot/claude-runner.test.ts`
- [x] **1E.4** Verify that `pnpm check` passes

**Dependencies**: 1A (ClaudeRunner errors defined)

---

## 1F — Approval Manager

- [x] **1F.1** Create `src/sessions/jorchbot/approval-manager.ts` with `ApprovalManager`:
  - `requestApproval()` — create DB record, send WP buttons
  - `resolveApproval()` — resolve approval, notify ClaudeRunner
  - `hasPending()` — check if there are pending approvals
  - Private `summarizeInput()` method to format the action
- [x] **1F.2** Create `src/sessions/jorchbot/approval-manager.test.ts`:
  - Test: requestApproval inserts DB record with status "pending"
  - Test: requestApproval calls sendButtons with correct format
  - Test: resolveApproval(id, true) updates DB to "approved"
  - Test: resolveApproval(id, false) updates DB to "rejected"
  - Test: resolveApproval returns false for nonexistent ID
- [x] **1F.3** Verify tests: `pnpm test:fast -- src/sessions/jorchbot/approval-manager.test.ts`

**Dependencies**: 1E (ClaudeRunner ready to receive approvals)

---

## 1G — Command Router + Gateway Integration

- [x] **1G.1** Create `src/commands/router.ts` with `CommandRouter`:
  - `route()` — entry point, parse incoming message
  - `parse()` — detect /command vs free text
  - `handleCommand()` — command dispatch
  - `handleHelp()` — show help
  - `handleStatus()` — show status
  - `handlePrompt()` — send text to ClaudeRunner
- [x] **1G.2** Create `src/commands/router.test.ts`:
  - Test: /help sends command list
  - Test: /status shows gateway status
  - Test: free text without active session shows error
  - Test: unknown command shows error
  - Test: /status with active session shows context %
- [x] **1G.3** Verify tests: `pnpm test:fast -- src/commands/router.test.ts`
- [x] **1G.4** Update `src/gateway/jorchbot-start.ts`:
  - Import ClaudeRunner, CommandRouter, ApprovalManager
  - Initialize ClaudeRunner as singleton
  - Create CommandRouter with injected deps
  - Connect with the OpenClaw gateway (inbound message handler)
  - Connect ApprovalManager with ClaudeRunner events
  - Wire ClaudeRunner `text` events → KapsoClient.sendText()
  - Wire ClaudeRunner `toolUse` events → ApprovalManager.requestApproval()
  - Wire ClaudeRunner `result` events → formatContextUsage + send
  - Graceful shutdown: stop ClaudeRunner, close DB
- [x] **1G.5** Register webhook routes on the gateway:
  - GET `/webhooks/kapso` → webhook verify handler
  - POST `/webhooks/kapso` → webhook receive handler
  - Connect onMessage → CommandRouter.route()
  - Connect onButtonReply → ApprovalManager.resolveApproval()
- [x] **1G.6** Verify that `pnpm check` passes
- [ ] **1G.7** Manual test: verify that the gateway starts and accepts webhooks

**Dependencies**: 1D (Kapso plugin ready), 1F (ApprovalManager ready)

---

## 1H — Onboarding + Final Verification

- [x] **1H.1** Create or update the `jorchbot setup` CLI command:
  - Interactive prompt for Kapso API key
  - Prompt for phone number ID
  - Generate webhook verify token automatically (or ask the user)
  - Show webhook URL to configure in Kapso dashboard
  - Save to `~/.jorchbot/config.json` (updated KapsoSchema)
  - Write `channels.kapso` section in `~/.openclaw/openclaw.json`
  - Verify connection by sending a test message via KapsoClient
- [x] **1H.2** Document manual setup in README or docs:
  - How to get a Kapso API key
  - How to configure the webhook URL in Kapso dashboard
  - How to expose the webhook with Tailscale Funnel (manual setup in Phase 1)
  - Example of complete config.json
- [x] **1H.3** Final end-to-end verification:
  - [x] `pnpm check` passes (format + types + lint)
  - [x] `pnpm test:fast` passes (all tests)
  - [x] No `any` in new code
  - [x] All imports use `.js` suffix
  - [x] All type-only imports use `import type`
  - [x] New files < 700 LOC
  - [x] Errors chain `{ cause: err }` correctly
- [ ] **1H.4** Manual test of the full flow (requires a real Kapso API key):
  - [ ] Send "Hello" via WP → receive response
  - [ ] DM pairing works (unauthorized number receives code)
  - [ ] /help shows commands
  - [ ] /status shows status
  - [ ] Free text starts a Claude Code session
  - [ ] Claude requests approval → buttons appear → Yes works
  - [ ] Context % is shown in the response
  - [ ] Resume works (second message continues the session)
  - [ ] Graceful shutdown (Ctrl+C) cleans up everything

**Dependencies**: 1G (everything integrated)

---

## Summary by sub-phase

| Sub-phase | Tasks  | Description                  | Parallelizable with  |
| --------- | ------ | ---------------------------- | -------------------- |
| **1A**    | 8      | Errors + config updates      | — (starting point)   |
| **1B**    | 3      | Context tracker              | 1C, 1E               |
| **1C**    | 6      | KapsoClient + webhook        | 1B, 1E               |
| **1D**    | 7      | Kapso channel plugin         | 1E, 1F (partial)     |
| **1E**    | 4      | ClaudeRunner                 | 1B, 1C               |
| **1F**    | 3      | Approval manager             | 1D (partial)         |
| **1G**    | 7      | Router + gateway integration | — (requires 1D + 1F) |
| **1H**    | 4      | Onboarding + verification    | — (requires 1G)      |
| **Total** | **42** |                              |                      |

### Critical path

```
1A → 1E → 1F → 1G → 1H
1A → 1C → 1D → 1G → 1H
```

Both paths converge at 1G. **1B is independent** and can be done at any point after 1A.
