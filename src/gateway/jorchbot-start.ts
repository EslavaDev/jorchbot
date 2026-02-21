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
import { JorchfileExecutor } from "../jorchfile/executor.js";
import { loadJorchfile } from "../jorchfile/loader.js";
import { readMakefileTargets } from "../jorchfile/makefile-reader.js";
import { PortManager } from "../jorchfile/port-manager.js";
import { BackgroundTaskManager } from "../jorchfile/task-manager.js";
import { JorchfileWatcher } from "../jorchfile/watcher.js";
import { chunkTextForOutbound } from "../plugin-sdk/text-chunking.js";
import { SessionManager } from "../sessions/jorchbot/manager.js";
import { ShellRunner } from "../sessions/jorchbot/shell-runner.js";
import { TailscaleFunnelAdapter } from "../tunnels/adapters/tailscale-funnel.js";
import { TailscaleServeAdapter } from "../tunnels/adapters/tailscale-serve.js";
import { FunnelProxy } from "../tunnels/funnel-proxy.js";
import { HealthMonitor } from "../tunnels/health.js";
import { TunnelManager } from "../tunnels/manager.js";
import { TunnelDb } from "../tunnels/tunnel-db.js";
import type { TunnelEvent } from "../tunnels/types.js";
import { createApprovalRouter } from "./approval-api.js";
import { createDocumentRouter } from "./document-api.js";
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

    // Targeted send functions — deliver messages to a specific phone number.
    // Used by SessionManager for async runner events (text, result, error, approval).
    const sendReplyTo = async (phone: string, text: string) => {
      const chunks = chunkTextForOutbound(text, WHATSAPP_TEXT_LIMIT);
      for (const chunk of chunks) {
        await kapsoClient.sendText({ to: phone, body: chunk });
      }
    };

    const sendButtonsTo = async (
      phone: string,
      text: string,
      buttons: Array<{ id: string; title: string }>,
    ) => {
      await kapsoClient.sendButtons({ to: phone, body: text, buttons });
    };

    const sendListTo = async (
      phone: string,
      text: string,
      buttonText: string,
      options: Array<{ id: string; title: string; description?: string }>,
    ) => {
      await kapsoClient.sendList({
        to: phone,
        body: text,
        buttonText,
        sections: [{ title: "Options", rows: options }],
      });
    };

    // Document storage for long output attachments
    const documentRouter = createDocumentRouter();

    const sendDocumentTo = async (phone: string, content: string, filename: string) => {
      const docId = documentRouter.storeDocument(content, filename);
      const docUrl = `http://localhost:${port}/api/documents/${docId}`;
      try {
        await kapsoClient.sendDocument({
          to: phone,
          documentUrl: docUrl,
          filename,
          caption: `Full output (${Math.round(content.length / 1024)}KB)`,
        });
      } catch {
        // Document URL not reachable (localhost without Tailscale) — send as chunked text
        const chunks = chunkTextForOutbound(content, WHATSAPP_TEXT_LIMIT);
        await sendReplyTo(
          phone,
          `[Document unavailable — sending as text (${chunks.length} chunks)]`,
        );
        for (const chunk of chunks.slice(0, 5)) {
          await kapsoClient.sendText({ to: phone, body: chunk });
        }
        if (chunks.length > 5) {
          await kapsoClient.sendText({
            to: phone,
            body: `...(${chunks.length - 5} more chunks truncated)`,
          });
        }
      }
    };

    // Per-request send functions — deliver messages to the current sender.
    // Used by CommandRouter for synchronous command responses.
    let currentSenderPhone: string | null = null;

    const sendReply = async (text: string) => {
      if (!currentSenderPhone) {
        return;
      }
      await sendReplyTo(currentSenderPhone, text);
    };

    const sendButtons = async (text: string, buttons: Array<{ id: string; title: string }>) => {
      if (!currentSenderPhone) {
        return;
      }
      await sendButtonsTo(currentSenderPhone, text, buttons);
    };

    const sendList = async (
      text: string,
      buttonText: string,
      options: Array<{ id: string; title: string; description?: string }>,
    ) => {
      if (!currentSenderPhone) {
        return;
      }
      await sendListTo(currentSenderPhone, text, buttonText, options);
    };

    // Resolve hook script directory (built hooks in dist/hooks/jorchbot/).
    // tsdown outputs flat into dist/, so import.meta.url points to dist/<chunk>.js.
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const hookScriptDir = path.resolve(currentDir, "hooks/jorchbot");

    // Declare Phase 3 managers here so onSessionDestroy can reference them.
    // They are initialized after SessionManager but before CommandRouter.
    let taskManagerRef: BackgroundTaskManager | null = null;
    let tunnelManagerRef: TunnelManager | null = null;

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
      sendReplyTo,
      sendButtonsTo,
      sendListTo,
      sendDocumentTo,
      approvalReminderDelayMs: config.approvals.timeoutMinutes * 60 * 1000,
      onSessionDestroy: (project: string) => {
        taskManagerRef?.stopAll(project);
        void tunnelManagerRef?.stopByProject(project);
      },
    });

    const shellRunner = new ShellRunner();

    // --- Phase 3: Jorchfile Engine ---
    let jorchfile = null as ReturnType<typeof loadJorchfile>;
    try {
      jorchfile = loadJorchfile();
    } catch (err: unknown) {
      console.warn(
        `[jorchbot] Jorchfile parse error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Apply SETTINGS overrides to config (in-memory only)
    if (jorchfile?.settings) {
      // Settings overrides are reserved for future use (retention days, etc.)
    }

    const taskManager = new BackgroundTaskManager({ sendReply });
    const portManager = new PortManager();

    // --- Phase 4: Tunnel Manager ---
    const serveAdapter = new TailscaleServeAdapter();
    const funnelAdapter = new TailscaleFunnelAdapter();
    const funnelProxy = new FunnelProxy(config.tunnels.funnelProxy.port);
    const tunnelDb = new TunnelDb();

    // Shared tunnel event handler (used by both TunnelManager callbacks and HealthMonitor)
    const handleTunnelEvent = (event: TunnelEvent) => {
      if (event.type === "tunnel:started") {
        void sendReply(
          `[${event.tunnel.project}] Tunnel active: ${event.tunnel.url} (${event.tunnel.mode}, port ${event.tunnel.localPort})`,
        );
      } else if (event.type === "tunnel:stopped") {
        void sendReply(`[${event.project}] Tunnel stopped.`);
      } else if (event.type === "tunnel:error") {
        void sendReply(`[${event.project}] Tunnel error: ${event.error}`);
      } else if (event.type === "tunnel:health_restored") {
        void sendReply(`[${event.project}] Tunnel health restored.`);
      } else if (event.type === "tunnel:restart_failed") {
        void sendReply(
          `[${event.project}] Tunnel restart failed after ${event.attempts} attempts. Marked as error.`,
        );
      }
    };

    const healthMonitor = new HealthMonitor(
      {
        intervalMs: config.tunnels.health.intervalMs,
        failureThreshold: config.tunnels.health.failureThreshold,
        maxRestartAttempts: config.tunnels.health.maxRestartAttempts,
      },
      {
        isServeActive: (p) => serveAdapter.isActive(p),
        isFunnelProxyRunning: () => funnelProxy.isRunning(),
        updateDbStatus: (id, status) => tunnelDb.updateStatus(id, status),
        onNotify: handleTunnelEvent,
      },
    );

    const tunnelManager = new TunnelManager({
      serveAdapter,
      funnelAdapter,
      funnelProxy,
      funnelPublicPort: config.tunnels.funnelProxy.tailscalePort,
      healthMonitor,
      db: tunnelDb,
      callbacks: {
        onNotify: handleTunnelEvent,
        onConfirmFunnel: (tunnelId, project, tunnelPort) => {
          void sendButtons(
            `[${project}] Funnel exposes port ${tunnelPort} to the public internet. Continue?`,
            [
              {
                id: JSON.stringify({ type: "tunnel_approve", tunnelId }),
                title: "Yes, expose",
              },
              {
                id: JSON.stringify({ type: "tunnel_reject", tunnelId, project }),
                title: "Cancel",
              },
            ],
          );
        },
      },
    });

    // Wire Phase 3/4 refs for onSessionDestroy callback
    taskManagerRef = taskManager;
    tunnelManagerRef = tunnelManager;

    let jorchfileExecutor: JorchfileExecutor | null = null;
    if (jorchfile) {
      jorchfileExecutor = new JorchfileExecutor({
        jorchfile,
        sessionManager,
        shellRunner,
        taskManager,
        portManager,
        tunnelManager,
        sendReply,
        sendButtons,
      });
      console.log(`[jorchbot] Jorchfile loaded: ${jorchfile.projects.length} project(s)`);
    }

    // Hot-reload watcher
    const watcher = new JorchfileWatcher({
      onReload: async (newJorchfile, changes) => {
        jorchfile = newJorchfile;
        if (newJorchfile && jorchfileExecutor) {
          jorchfileExecutor.updateJorchfile(newJorchfile);
        } else if (newJorchfile && !jorchfileExecutor) {
          jorchfileExecutor = new JorchfileExecutor({
            jorchfile: newJorchfile,
            sessionManager,
            shellRunner,
            taskManager,
            portManager,
            tunnelManager,
            sendReply,
            sendButtons,
          });
        } else {
          jorchfileExecutor = null;
        }

        // Clean up removed/modified projects
        for (const projectName of [...changes.removed, ...changes.modified]) {
          taskManager.stopAll(projectName);
          await tunnelManager.stopByProject(projectName);
        }

        if (changes.added.length > 0 || changes.removed.length > 0 || changes.modified.length > 0) {
          const parts: string[] = [];
          if (changes.added.length > 0) {
            parts.push(`added: ${changes.added.join(", ")}`);
          }
          if (changes.removed.length > 0) {
            parts.push(`removed: ${changes.removed.join(", ")}`);
          }
          if (changes.modified.length > 0) {
            parts.push(`modified: ${changes.modified.join(", ")}`);
          }
          await sendReply(`[jorchbot] Jorchfile reloaded (${parts.join("; ")})`);
        }
      },
      onError: (err) => {
        console.error("[jorchbot] Jorchfile watcher error:", err);
      },
    });
    watcher.start(jorchfile);

    const router = new CommandRouter({
      sessionManager,
      shellRunner,
      sendReply,
      sendButtons,
      sendList,
      getJorchfileExecutor: () => jorchfileExecutor,
      taskManager,
      tunnelManager,
      readMakefileTargets,
    });

    // Restore sessions from DB (gateway restart)
    const restored = await sessionManager.restore();
    if (restored > 0) {
      console.log(`[jorchbot] restored ${restored} active session(s)`);
    }

    // Restore tunnel state from DB (reconnect alive tunnels, mark dead ones)
    const restoredTunnels = await tunnelManager.restore();
    if (restoredTunnels > 0) {
      console.log(`[jorchbot] restored ${restoredTunnels} active tunnel(s)`);
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

        // Check if a focused session has an approval awaiting feedback text.
        // If so, capture this message as feedback instead of routing to CommandRouter.
        const messageText = message.text?.body ?? "";
        const focusedProject = sessionManager.getFocusedProject(senderPhone);
        if (focusedProject && messageText && !messageText.startsWith("/")) {
          const feedbackApprovalId = sessionManager.getAwaitingFeedbackId(focusedProject);
          if (feedbackApprovalId) {
            await sessionManager.resolveApproval(feedbackApprovalId, true, messageText);
            await sendReplyTo(
              senderPhone,
              `[${focusedProject}] Approved with feedback.\nClaude received: "${messageText}"`,
            );
            return;
          }
        }

        await router.route({
          text: messageText,
          senderId: senderPhone,
          channel: "kapso",
          messageId: message.id,
        });
      },
      onButtonReply: async (buttonId, senderPhone) => {
        currentSenderPhone = senderPhone;
        try {
          const payload = JSON.parse(buttonId) as Record<string, unknown>;

          if (payload.type === "help_category") {
            const { category } = payload as { category: string };
            await router.sendHelpCategory(category);
          } else if (payload.type === "question_answer") {
            const { project, answer } = payload as unknown as QuestionAnswerPayload;
            await sessionManager.answerQuestion(project, answer);
          } else if (payload.type === "shell_approve" || payload.type === "shell_reject") {
            // TODO: Phase 2 shell approval
          } else if (payload.type === "tunnel_approve") {
            const { tunnelId } = payload as { tunnelId: string };
            try {
              await tunnelManager.confirmFunnel(tunnelId);
            } catch (err: unknown) {
              await sendReplyTo(
                senderPhone,
                `Funnel failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          } else if (payload.type === "tunnel_reject") {
            const { tunnelId, project } = payload as { tunnelId: string; project: string };
            tunnelManager.cancelFunnel(tunnelId);
            await sendReplyTo(senderPhone, `[${project}] Tunnel cancelled.`);
          } else if (payload.type === "task_restart") {
            const { project, command } = payload as { project: string; command: string };
            try {
              taskManager.stop(project, command);
            } catch {
              // task may have already exited
            }
            if (jorchfileExecutor) {
              await jorchfileExecutor.execute(command, project, true, senderPhone);
            }
          } else if (payload.type === "task_duplicate") {
            const { project, command } = payload as { project: string; command: string };
            if (jorchfileExecutor) {
              const jorchProject = jorchfileExecutor.getProject(project);
              if (jorchProject) {
                const shellCommand = jorchProject.commands[command];
                if (shellCommand) {
                  const task = await taskManager.start({
                    project,
                    commandName: command,
                    shellCommand,
                    cwd: jorchProject.path,
                  });
                  await sendReplyTo(
                    senderPhone,
                    `[${project}] "${command}" started (bg, PID ${task.pid})`,
                  );
                }
              }
            }
          } else if (payload.approvalId) {
            // ApprovalButtonPayload (no type field)
            const approval = payload as unknown as ApprovalButtonPayload;

            if (approval.action === "feedback") {
              // "Yes + feedback" button — mark as awaiting feedback text
              const project = sessionManager.setAwaitingFeedback(approval.approvalId);
              if (project) {
                await sendReplyTo(senderPhone, `[${project}] Write your feedback for Claude:`);
              }
            } else {
              await sessionManager.resolveApproval(
                approval.approvalId,
                approval.action === "approve",
              );
            }
          }
        } catch (err: unknown) {
          console.error("[jorchbot] Failed to parse button payload:", err);
        }
      },
    });

    const app = express();
    app.use(express.json());

    // Tool approval API endpoints (for Claude Code hooks)
    const approvalRouter = createApprovalRouter({ sessionManager, sendReplyTo });
    app.use(approvalRouter);

    // Document attachment endpoints (for long output)
    app.use(documentRouter.router);

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
      // Stop watcher, background tasks, and tunnels
      watcher.stop();
      for (const task of taskManager.listAll()) {
        taskManager.stopAll(task.project);
      }
      await tunnelManager.stopAll();
      // Stop all active sessions gracefully
      for (const session of sessionManager.listActive()) {
        const active = sessionManager.getByProject(session.project);
        if (active) {
          await active.runner.stop();
        }
      }
      documentRouter.dispose();
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
