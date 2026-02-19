# JorchBot Setup Guide

## Prerequisites

1. **Kapso.ai account** — Sign up at [kapso.ai](https://kapso.ai)
2. **Kapso API key** — Generate one from your Kapso dashboard
3. **Kapso phone number** — Get your WhatsApp Business phone number ID
4. **Node.js >= 22.12.0** — Required for JorchBot
5. **Claude Code CLI** — Install from [claude.ai/code](https://claude.ai/code)

## Quick Setup

Run the interactive setup wizard:

```bash
jorchbot jb setup
```

This will:

1. Ask for your Kapso API key
2. Ask for your phone number ID
3. Generate a webhook verify token
4. Save configuration to `~/.jorchbot/config.json`
5. Optionally send a test message

## Manual Setup

### 1. Configure JorchBot

Edit `~/.jorchbot/config.json`:

```json
{
  "gateway": {
    "port": 18789,
    "host": "0.0.0.0"
  },
  "channels": {
    "kapso": {
      "enabled": true,
      "apiKey": "kaps_your_api_key_here",
      "phoneNumberId": "your_phone_number_id",
      "webhookVerifyToken": "your_verify_token"
    }
  }
}
```

### 2. Configure Kapso Webhook

In your Kapso dashboard:

1. Go to **Webhooks** settings
2. Set the webhook URL to: `https://your-domain:18789/webhooks/kapso`
3. Set the verify token to match your `webhookVerifyToken`
4. Subscribe to **messages** events

### 3. Expose Your Webhook

For Phase 1, you need to manually expose the webhook URL:

#### Using Tailscale Funnel (recommended)

```bash
tailscale funnel 18789
```

This gives you a public HTTPS URL like `https://your-machine.ts.net:18789`.

#### Using ngrok (alternative)

```bash
ngrok http 18789
```

### 4. Start JorchBot

```bash
jorchbot jb start
```

## Verify

1. Send "Hello" via WhatsApp to your Kapso number
2. You should receive a response from Claude Code
3. Try `/help` to see available commands
4. Try `/status` to check gateway status

## Troubleshooting

- **No response**: Check that the webhook URL is accessible and the verify token matches
- **API errors**: Verify your Kapso API key is valid
- **Claude Code errors**: Make sure `claude` CLI is installed and in PATH
