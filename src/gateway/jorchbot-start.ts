import express from "express";
import { KapsoClient } from "../../extensions/kapso/src/client.js";
import type { ApprovalButtonPayload } from "../../extensions/kapso/src/types.js";
import { createWebhookHandlers } from "../../extensions/kapso/src/webhook.js";
import { CommandRouter } from "../commands/router.js";
import { loadConfig } from "../config/jorchbot-config-loader.js";
import { closeDb, getDb } from "../db/index.js";
import { JorchBotError } from "../errors/index.js";
import { ApprovalManager } from "../sessions/jorchbot/approval-manager.js";
import { ClaudeRunner } from "../sessions/jorchbot/claude-runner.js";
import { formatContextUsage, calculateContextUsage } from "../sessions/jorchbot/context-tracker.js";

interface StartOptions {
  port?: string;
  host?: string;
}

export async function startGateway(opts: StartOptions): Promise<void> {
  try {
    const config = loadConfig();
    const port = opts.port ? Number.parseInt(opts.port, 10) : config.gateway.port;
    const host = opts.host ?? config.gateway.host;

    getDb();

    const kapsoConfig = config.channels.kapso;
    const kapsoClient = new KapsoClient({
      apiKey: kapsoConfig.apiKey,
      phoneNumberId: kapsoConfig.phoneNumberId,
    });

    const claudeRunner = new ClaudeRunner();
    const startTime = Date.now();
    let currentSenderPhone: string | null = null;

    const approvalManager = new ApprovalManager({
      claudeRunner,
      sessionId: "default",
      sendButtons: async (text, buttons) => {
        if (!currentSenderPhone) {
          return;
        }
        await kapsoClient.sendButtons({ to: currentSenderPhone, body: text, buttons });
      },
    });

    const router = new CommandRouter({
      claudeRunner,
      sendReply: async (text) => {
        if (!currentSenderPhone) {
          return;
        }
        await kapsoClient.sendText({ to: currentSenderPhone, body: text });
      },
      sendButtons: async (text, buttons) => {
        if (!currentSenderPhone) {
          return;
        }
        await kapsoClient.sendButtons({ to: currentSenderPhone, body: text, buttons });
      },
      getGatewayStatus: () => ({
        uptime: Math.floor((Date.now() - startTime) / 1000),
        activeSession: claudeRunner.getSessionId()
          ? { project: process.cwd(), contextPercent: claudeRunner.getContextPercent() }
          : null,
        channelConnected: true,
      }),
    });

    claudeRunner.on("text", (text) => {
      if (!currentSenderPhone) {
        return;
      }
      kapsoClient.sendText({ to: currentSenderPhone, body: text }).catch((err: unknown) => {
        console.error("[jorchbot] Failed to send text:", err);
      });
    });

    claudeRunner.on("toolUse", (request) => {
      approvalManager.requestApproval(request).catch((err: unknown) => {
        console.error("[jorchbot] Failed to request approval:", err);
      });
    });

    claudeRunner.on("result", (result) => {
      if (!currentSenderPhone) {
        return;
      }
      const usage = calculateContextUsage(result.inputTokens, result.outputTokens);
      const contextLine = formatContextUsage(usage);
      const sessionTag = result.sessionId ? ` [session: ${result.sessionId}]` : "";
      kapsoClient
        .sendText({ to: currentSenderPhone, body: `Session complete.${sessionTag} ${contextLine}` })
        .catch((err: unknown) => {
          console.error("[jorchbot] Failed to send result:", err);
        });
    });

    claudeRunner.on("error", (error) => {
      if (!currentSenderPhone) {
        return;
      }
      kapsoClient
        .sendText({ to: currentSenderPhone, body: `Error: ${error.message}` })
        .catch((err: unknown) => {
          console.error("[jorchbot] Failed to send error:", err);
        });
    });

    const webhookHandlers = createWebhookHandlers({
      verifyToken: kapsoConfig.webhookVerifyToken,
      webhookSecret: kapsoConfig.webhookSecret,
      onMessage: async (message, senderPhone) => {
        console.log("[jorchbot] message received from:", senderPhone, "text:", message.text?.body);
        currentSenderPhone = senderPhone;
        await router.route({
          text: message.text?.body ?? "",
          senderId: senderPhone,
          channel: "kapso",
          messageId: message.id,
        });
      },
      onButtonReply: async (buttonId, senderPhone) => {
        currentSenderPhone = senderPhone;
        try {
          const payload = JSON.parse(buttonId) as ApprovalButtonPayload;
          await approvalManager.resolveApproval(payload.approvalId, payload.action === "approve");
        } catch (err: unknown) {
          console.error("[jorchbot] Failed to parse button payload:", err);
        }
      },
    });

    const app = express();
    app.use(express.json());

    app.get("/webhooks/kapso", (req, res) => {
      try {
        webhookHandlers.verify(req, res);
      } catch (err: unknown) {
        console.error("[jorchbot] Webhook verification failed:", err);
        res.sendStatus(403);
      }
    });

    app.post("/webhooks/kapso", (req, res) => {
      webhookHandlers.receive(req, res).catch((err: unknown) => {
        console.error("[jorchbot] Webhook receive error:", err);
      });
    });

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) });
    });

    const shutdown = async () => {
      console.log("[jorchbot] shutting down...");
      await claudeRunner.stop();
      closeDb();
      process.exit(0);
    };
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    app.listen(port, host, () => {
      console.log(`[jorchbot] gateway ready on ${host}:${port}`);
      console.log("[jorchbot] database initialized");
      console.log(`[jorchbot] webhook URL: http://${host}:${port}/webhooks/kapso`);
      console.log("[jorchbot] press Ctrl+C to stop");
    });
  } catch (err: unknown) {
    if (err instanceof JorchBotError) {
      console.error(`[jorchbot] ${err.name}: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
