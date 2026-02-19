# Addendum: DM Pairing Access Control

> **Related TODO item**: 1H.4 "DM pairing works (unauthorized number receives code)"

## Problem

Phase 1 implemented the full single-session flow (ClaudeRunner, Kapso webhook, command router) but left the gateway **open** — any WhatsApp number could send messages and interact with Claude without authorization.

The OpenClaw pairing store infrastructure (`src/pairing/pairing-store.ts`) was fully available, and the Kapso channel plugin declared `security.resolveDmPolicy` with default `"pairing"`, but no access check was wired into `jorchbot-start.ts`.

## Solution

### New config fields

Added to `KapsoSchema` in `src/config/jorchbot-config.ts`:

| Field       | Type                                               | Default     | Description                                 |
| ----------- | -------------------------------------------------- | ----------- | ------------------------------------------- |
| `dmPolicy`  | `"pairing" \| "allowlist" \| "open" \| "disabled"` | `"pairing"` | Controls who can DM the bot                 |
| `allowFrom` | `string[]`                                         | `[]`        | Statically configured allowed phone numbers |

### Access control module

**File**: `src/gateway/kapso-access-control.ts`

Exports `checkKapsoAccess(senderPhone, config, env?)` which:

1. If policy is `"open"` — allow immediately
2. If policy is `"disabled"` — deny immediately (no message)
3. Merge config `allowFrom` + store `allowFrom` (from `~/.jorchbot/credentials/kapso-allowFrom.json`)
4. If `"*"` in combined list — allow
5. Normalize sender phone with `normalizeE164()` and check against list
6. If `"pairing"` — generate pairing code via `upsertChannelPairingRequest()`, return deny + message
7. If `"allowlist"` — return deny (silent drop)

### Gateway wiring

In `src/gateway/jorchbot-start.ts`, the `onMessage` handler now calls `checkKapsoAccess()` before routing. If access is denied and a pairing message is provided, it's sent back to the sender.

## Pairing flow (end-to-end)

1. Unauthorized number sends a WhatsApp message to the bot
2. Bot responds with:

   ```
   JorchBot: access not configured.

   Your WhatsApp number: +1234567890

   Pairing code: ABC2XYZ9

   Ask the bot owner to approve with:
   jorchbot pairing approve kapso ABC2XYZ9
   ```

3. Bot owner runs `jorchbot pairing approve kapso ABC2XYZ9`
4. The phone number is added to `~/.jorchbot/credentials/kapso-allowFrom.json`
5. Subsequent messages from that number are allowed through

## Config reference

```json
{
  "channels": {
    "kapso": {
      "enabled": true,
      "apiKey": "...",
      "phoneNumberId": "...",
      "webhookVerifyToken": "...",
      "webhookSecret": "...",
      "dmPolicy": "pairing",
      "allowFrom": ["+15550001111"]
    }
  }
}
```

### `dmPolicy` values

- **`"pairing"`** (default): Unknown senders receive a pairing code. Owner approves via CLI.
- **`"allowlist"`**: Only numbers in `allowFrom` (config + store) can message. Others are silently dropped.
- **`"open"`**: Anyone can message the bot. No access control.
- **`"disabled"`**: All DMs are blocked. No response sent.
