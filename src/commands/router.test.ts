import { describe, expect, it, vi, beforeEach } from "vitest";
import { CommandRouter } from "./router.js";
import type { CommandRouterDeps } from "./router.js";

describe("CommandRouter", () => {
  let router: CommandRouter;
  let sendReply: ReturnType<typeof vi.fn<CommandRouterDeps["sendReply"]>>;
  let sendButtons: ReturnType<typeof vi.fn<CommandRouterDeps["sendButtons"]>>;

  beforeEach(() => {
    sendReply = vi.fn<CommandRouterDeps["sendReply"]>().mockResolvedValue(undefined);
    sendButtons = vi.fn<CommandRouterDeps["sendButtons"]>().mockResolvedValue(undefined);

    router = new CommandRouter({
      claudeRunner: null,
      sendReply,
      sendButtons,
      getGatewayStatus: () => ({
        uptime: 3600,
        activeSession: null,
        channelConnected: true,
      }),
    });
  });

  describe("/help", () => {
    it("sends help text with available commands", async () => {
      await router.route({
        text: "/help",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_1",
      });

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("/help");
      expect(reply).toContain("/status");
    });
  });

  describe("/status", () => {
    it("shows gateway status without active session", async () => {
      await router.route({
        text: "/status",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_2",
      });

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("active");
      expect(reply).toContain("No active session");
    });

    it("shows context % with active session", async () => {
      const routerWithSession = new CommandRouter({
        claudeRunner: null,
        sendReply,
        sendButtons,
        getGatewayStatus: () => ({
          uptime: 7200,
          activeSession: { project: "my-project", contextPercent: 42 },
          channelConnected: true,
        }),
      });

      await routerWithSession.route({
        text: "/status",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_3",
      });

      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("my-project");
      expect(reply).toContain("42%");
    });
  });

  describe("free text without active session", () => {
    it("sends error message when no ClaudeRunner", async () => {
      await router.route({
        text: "fix the login",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_4",
      });

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("No active session");
    });
  });

  describe("unknown command", () => {
    it("sends error for unknown commands", async () => {
      await router.route({
        text: "/unknown",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_5",
      });

      expect(sendReply).toHaveBeenCalledTimes(1);
      const reply = sendReply.mock.calls[0][0];
      expect(reply).toContain("Unknown command");
      expect(reply).toContain("/unknown");
    });
  });

  describe("free text with active ClaudeRunner", () => {
    it("calls runner.start for first message", async () => {
      const mockRunner = {
        getSessionId: vi.fn(() => null),
        start: vi.fn().mockResolvedValue({
          sessionId: "s1",
          textContent: "ok",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          durationMs: 0,
        }),
        resume: vi.fn(),
        getStatus: vi.fn(() => "idle"),
      };

      const routerWithRunner = new CommandRouter({
        claudeRunner: mockRunner as never,
        sendReply,
        sendButtons,
        getGatewayStatus: () => ({ uptime: 100, activeSession: null, channelConnected: true }),
      });

      await routerWithRunner.route({
        text: "hello claude",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_6",
      });

      // oxlint-disable-next-line typescript/unbound-method -- vi.fn() mock
      expect(mockRunner.start).toHaveBeenCalledTimes(1);
    });

    it("calls runner.resume when session exists", async () => {
      const mockRunner = {
        getSessionId: vi.fn(() => "sess_abc"),
        start: vi.fn(),
        resume: vi.fn().mockResolvedValue({
          sessionId: "sess_abc",
          textContent: "ok",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          durationMs: 0,
        }),
        getStatus: vi.fn(() => "idle"),
      };

      const routerWithRunner = new CommandRouter({
        claudeRunner: mockRunner as never,
        sendReply,
        sendButtons,
        getGatewayStatus: () => ({ uptime: 100, activeSession: null, channelConnected: true }),
      });

      await routerWithRunner.route({
        text: "continue work",
        senderId: "+521234567890",
        channel: "kapso",
        messageId: "msg_7",
      });

      // oxlint-disable-next-line typescript/unbound-method -- vi.fn() mock
      expect(mockRunner.resume).toHaveBeenCalledTimes(1);
    });
  });
});
