import { randomUUID } from "node:crypto";
import * as p from "@clack/prompts";
import { KapsoClient } from "../../extensions/kapso/src/client.js";
import { loadConfig, saveConfig } from "../config/jorchbot-config-loader.js";

export async function runSetup(): Promise<void> {
  p.intro("JorchBot Setup");

  const config = loadConfig();

  const apiKey = await p.text({
    message: "Enter your Kapso API key:",
    placeholder: "kaps_...",
    initialValue: config.channels.kapso.apiKey || undefined,
    validate: (value) => {
      if (!value?.trim()) {
        return "API key is required";
      }
      return undefined;
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const phoneNumberId = await p.text({
    message: "Enter your Kapso phone number ID:",
    placeholder: "123456789",
    initialValue: config.channels.kapso.phoneNumberId || undefined,
    validate: (value) => {
      if (!value?.trim()) {
        return "Phone number ID is required";
      }
      return undefined;
    },
  });

  if (p.isCancel(phoneNumberId)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  const generateToken = await p.confirm({
    message: "Auto-generate webhook verify token?",
    initialValue: true,
  });

  if (p.isCancel(generateToken)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  let webhookVerifyToken: string;
  if (generateToken) {
    webhookVerifyToken = randomUUID();
    p.note(`Generated token: ${webhookVerifyToken}`, "Webhook Verify Token");
  } else {
    const customToken = await p.text({
      message: "Enter your webhook verify token:",
      validate: (value) => {
        if (!value?.trim()) {
          return "Token is required";
        }
        return undefined;
      },
    });

    if (p.isCancel(customToken)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    webhookVerifyToken = customToken;
  }

  const updatedConfig = {
    ...config,
    channels: {
      ...config.channels,
      kapso: {
        ...config.channels.kapso,
        enabled: true,
        apiKey,
        phoneNumberId,
        webhookVerifyToken,
      },
    },
  };

  saveConfig(updatedConfig);

  p.note(
    [
      `Webhook URL: http://<your-host>:${config.gateway.port}/webhooks/kapso`,
      `Verify Token: ${webhookVerifyToken}`,
      "",
      "Configure this URL in your Kapso dashboard.",
      "For public access, use Tailscale Funnel (Phase 4).",
    ].join("\n"),
    "Webhook Configuration",
  );

  const testConnection = await p.confirm({
    message: "Send a test message to verify the connection?",
    initialValue: false,
  });

  if (p.isCancel(testConnection)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (testConnection) {
    const testPhone = await p.text({
      message: "Enter a phone number to send a test message to (E.164 format):",
      placeholder: "+521234567890",
      validate: (value) => {
        if (!value?.trim()) {
          return "Phone number is required";
        }
        return undefined;
      },
    });

    if (p.isCancel(testPhone)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    const spinner = p.spinner();
    spinner.start("Sending test message...");

    try {
      const client = new KapsoClient({
        apiKey,
        phoneNumberId,
      });
      await client.sendText({
        to: testPhone,
        body: "JorchBot test message — setup successful!",
      });
      spinner.stop("Test message sent successfully!");
    } catch (err: unknown) {
      spinner.stop("Test message failed.");
      p.log.error(
        `Failed to send test message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  p.outro("Setup complete! Run `jorchbot jb start` to start the gateway.");
}
