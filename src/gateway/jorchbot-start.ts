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
import { TunnelManager } from "../jorchfile/tunnel.js";
import { JorchfileWatcher } from "../jorchfile/watcher.js";
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
      onSessionDestroy: (project: string) => {
        taskManagerRef?.stopAll(project);
        void tunnelManagerRef?.stopAll(project);
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
    const tunnelManager = new TunnelManager({ sendReply, sendButtons });

    // Wire Phase 3 refs for onSessionDestroy callback
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
          await tunnelManager.stopAll(projectName);
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
      getJorchfileExecutor: () => jorchfileExecutor,
      taskManager,
      readMakefileTargets,
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
          } else if (payload.type === "tunnel_approve") {
            const { project, port: tunnelPort } = payload as { project: string; port: number };
            await tunnelManager.startServe({ project, port: tunnelPort, mode: "funnel" });
          } else if (payload.type === "tunnel_reject") {
            const { project } = payload as { project: string };
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
    const approvalRouter = createApprovalRouter({ sessionManager, sendReplyTo });
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
      // Phase 3: Stop watcher, background tasks, and tunnels
      watcher.stop();
      for (const task of taskManager.listAll()) {
        taskManager.stopAll(task.project);
      }
      try {
        for (const tunnel of tunnelManager.listAll()) {
          await tunnelManager.stop(tunnel.project, tunnel.port);
        }
      } catch {
        // best-effort tunnel cleanup
      }
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
