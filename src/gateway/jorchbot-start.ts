import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { KapsoClient } from "../../extensions/kapso/src/client.js";
import type {
  ApprovalButtonPayload,
  QuestionAnswerPayload,
} from "../../extensions/kapso/src/types.js";
import { createWebhookHandlers } from "../../extensions/kapso/src/webhook.js";
import { CommandRouter } from "../commands/router.js";
import { loadConfig } from "../config/jorchbot-config-loader.js";
import { closeDb, getDb } from "../db/index.js";
import { JorchBotError } from "../errors/index.js";
import { chunkTextForOutbound } from "../plugin-sdk/text-chunking.js";
import { SessionManager } from "../sessions/jorchbot/manager.js";
import { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import { createApprovalRouter } from "./approval-api.js";
import { checkKapsoAccess } from "./kapso-access-control.js";

const WHATSAPP_TEXT_LIMIT = 4096;

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

    let currentSenderPhone: string | null = null;

    const sendReply = async (text: string) => {
      if (!currentSenderPhone) {
        return;
      }
      const chunks = chunkTextForOutbound(text, WHATSAPP_TEXT_LIMIT);
      for (const chunk of chunks) {
        await kapsoClient.sendText({ to: currentSenderPhone, body: chunk });
      }
    };

    const sendButtons = async (text: string, buttons: Array<{ id: string; title: string }>) => {
      if (!currentSenderPhone) {
        return;
      }
      await kapsoClient.sendButtons({ to: currentSenderPhone, body: text, buttons });
    };

    const sendList = async (
      text: string,
      buttonText: string,
      options: Array<{ id: string; title: string; description?: string }>,
    ) => {
      if (!currentSenderPhone) {
        return;
      }
      await kapsoClient.sendList({
        to: currentSenderPhone,
        body: text,
        buttonText,
        sections: [{ title: "Options", rows: options }],
      });
    };

    // Resolve hook script directory (built hooks in dist/hooks/jorchbot/).
    // tsdown outputs flat into dist/, so import.meta.url points to dist/<chunk>.js.
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const hookScriptDir = path.resolve(currentDir, "hooks/jorchbot");

    const sessionManager = new SessionManager({
      maxSessions: config.sessions.maxConcurrent,
      gatewayPort: port,
      hookScriptDir,
      contextGuard: {
        warnPercent: config.sessions.contextGuard.warnPercent,
        criticalPercent: config.sessions.contextGuard.criticalPercent,
        blockPercent: config.sessions.contextGuard.blockPercent,
        contextLimit: config.sessions.contextGuard.contextLimit,
      },
      sendReply,
      sendButtons,
      sendList,
    });

    const shellRunner = new ShellRunner();

    const router = new CommandRouter({
      sessionManager,
      shellRunner,
      sendReply,
      sendButtons,
    });

    // Restore sessions from DB (gateway restart)
    const restored = await sessionManager.restore();
    if (restored > 0) {
      console.log(`[jorchbot] restored ${restored} active session(s)`);
    }

    const webhookHandlers = createWebhookHandlers({
      verifyToken: kapsoConfig.webhookVerifyToken,
      webhookSecret: kapsoConfig.webhookSecret,
      onMessage: async (message, senderPhone) => {
        console.log("[jorchbot] message received from:", senderPhone, "text:", message.text?.body);
        currentSenderPhone = senderPhone;

        const access = await checkKapsoAccess(senderPhone, kapsoConfig);
        if (!access.allowed) {
          if (access.pairingMessage) {
            await kapsoClient.sendText({ to: senderPhone, body: access.pairingMessage });
          }
          return;
        }

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
          const payload = JSON.parse(buttonId) as Record<string, unknown>;

          if (payload.type === "question_answer") {
            const { project, answer } = payload as unknown as QuestionAnswerPayload;
            await sessionManager.answerQuestion(project, answer);
          } else if (payload.type === "shell_approve" || payload.type === "shell_reject") {
            // TODO: Phase 2 shell approval
          } else if (payload.approvalId) {
            // Backward compat: ApprovalButtonPayload (no type field)
            const approval = payload as unknown as ApprovalButtonPayload;
            await sessionManager.resolveApproval(
              approval.approvalId,
              approval.action === "approve",
            );
          }
        } catch (err: unknown) {
          console.error("[jorchbot] Failed to parse button payload:", err);
        }
      },
    });

    const app = express();
    app.use(express.json());

    // Tool approval API endpoints (for Claude Code hooks)
    const approvalRouter = createApprovalRouter({ sessionManager, sendReply });
    app.use(approvalRouter);

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

    const startTime = Date.now();

    const shutdown = async () => {
      console.log("[jorchbot] shutting down...");
      // Stop all active sessions gracefully
      for (const session of sessionManager.listActive()) {
        const active = sessionManager.getByProject(session.project);
        if (active) {
          await active.runner.stop();
        }
      }
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
