import type { ClaudeRunner } from "../sessions/jorchbot/claude-runner.js";
import { PLAN_MODE_PROMPT } from "./system-prompts.js";

export interface IncomingMessage {
  text: string;
  senderId: string;
  channel: string;
  messageId: string;
}

type RouteResult =
  | { type: "command"; command: string; args: string[] }
  | { type: "prompt"; text: string }
  | { type: "error"; message: string };

export interface CommandRouterDeps {
  claudeRunner: ClaudeRunner | null;
  sendReply: (text: string) => Promise<void>;
  sendButtons: (text: string, buttons: Array<{ id: string; title: string }>) => Promise<void>;
  getGatewayStatus: () => GatewayStatus;
  skipPermissions?: boolean;
}

export interface GatewayStatus {
  uptime: number;
  activeSession: { project: string; contextPercent: number } | null;
  channelConnected: boolean;
}

export class CommandRouter {
  private deps: CommandRouterDeps;

  constructor(deps: CommandRouterDeps) {
    this.deps = deps;
  }

  async route(message: IncomingMessage): Promise<void> {
    const parsed = this.parse(message.text);

    switch (parsed.type) {
      case "command": {
        await this.handleCommand(parsed.command, parsed.args);
        break;
      }

      case "prompt": {
        await this.handlePrompt(parsed.text);
        break;
      }

      case "error": {
        await this.deps.sendReply(parsed.message);
        break;
      }
    }
  }

  private parse(text: string): RouteResult {
    const trimmed = text.trim();

    if (trimmed.startsWith("/")) {
      const parts = trimmed.slice(1).split(/\s+/);
      const command = parts[0]?.toLowerCase() ?? "";
      const args = parts.slice(1);
      return { type: "command", command, args };
    }

    if (!this.deps.claudeRunner) {
      return {
        type: "error",
        message: "No active session. Use /help to see available commands.",
      };
    }

    return { type: "prompt", text: trimmed };
  }

  private async handleCommand(command: string, _args: string[]): Promise<void> {
    switch (command) {
      case "help": {
        await this.handleHelp();
        break;
      }

      case "status": {
        await this.handleStatus();
        break;
      }

      default: {
        await this.deps.sendReply(
          `Unknown command: /${command}\nUse /help to see available commands.`,
        );
      }
    }
  }

  private async handleHelp(): Promise<void> {
    const help = [
      "*Available commands:*",
      "",
      "/help — Show this help",
      "/status — Gateway and active session status",
      "",
      "Send any text to talk to Claude Code.",
    ].join("\n");

    await this.deps.sendReply(help);
  }

  private async handleStatus(): Promise<void> {
    const status = this.deps.getGatewayStatus();

    const lines = [
      "*JorchBot Status*",
      "",
      `Gateway: active (${Math.floor(status.uptime / 60)} min)`,
      `Channel: ${status.channelConnected ? "connected" : "disconnected"}`,
    ];

    if (status.activeSession) {
      lines.push(
        "",
        `*Active session:* ${status.activeSession.project}`,
        `Context: ${status.activeSession.contextPercent}%`,
      );
    } else {
      lines.push("", "No active session.");
    }

    await this.deps.sendReply(lines.join("\n"));
  }

  private async handlePrompt(text: string): Promise<void> {
    const runner = this.deps.claudeRunner;
    if (!runner) {
      await this.deps.sendReply(
        "No active session. Send any message to start a session with Claude Code.",
      );
      return;
    }

    try {
      if (runner.getSessionId()) {
        await runner.resume({ prompt: text, cwd: process.cwd() });
      } else {
        await runner.start({
          prompt: text,
          cwd: process.cwd(),
          skipPermissions: this.deps.skipPermissions,
          systemPrompt: PLAN_MODE_PROMPT,
        });
      }
    } catch (err: unknown) {
      await this.deps.sendReply(
        `Claude Code error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
