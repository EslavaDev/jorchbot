import { describe, expect, it, vi, beforeEach } from "vitest";
import { kapsoPlugin } from "./channel.js";

// Mock the runtime module
vi.mock("./runtime.js", () => ({
  getKapsoRuntime: vi.fn(() => ({
    channel: {
      text: {
        chunkText: vi.fn((text: string, limit: number) => {
          const chunks: string[] = [];
          for (let i = 0; i < text.length; i += limit) {
            chunks.push(text.slice(i, i + limit));
          }
          return chunks;
        }),
      },
    },
    config: {
      loadConfig: vi.fn(() => ({
        channels: {
          kapso: {
            apiKey: "test-key",
            phoneNumberId: "12345",
            webhookVerifyToken: "verify-token",
          },
        },
      })),
    },
  })),
}));

describe("kapsoPlugin", () => {
  describe("config", () => {
    it("listAccountIds returns default account when no accounts configured", () => {
      const result = kapsoPlugin.config.listAccountIds({} as never);
      expect(result).toEqual(["default"]);
    });

    it("resolveAccount returns correct fields", () => {
      const cfg = {
        channels: {
          kapso: {
            apiKey: "key-123",
            phoneNumberId: "phone-456",
            webhookVerifyToken: "token-789",
            dmPolicy: "open",
          },
        },
      } as never;
      const account = kapsoPlugin.config.resolveAccount(cfg, "default");
      expect(account.accountId).toBe("default");
      expect(account.apiKey).toBe("key-123");
      expect(account.phoneNumberId).toBe("phone-456");
      expect(account.webhookVerifyToken).toBe("token-789");
      expect(account.dmPolicy).toBe("open");
    });

    it("isEnabled returns false without apiKey", () => {
      const cfg = {} as never;
      const account = kapsoPlugin.config.resolveAccount(cfg, "default");
      expect(kapsoPlugin.config.isEnabled!(account, cfg)).toBe(false);
    });

    it("isEnabled returns true with apiKey", () => {
      const cfg = {
        channels: {
          kapso: {
            apiKey: "key-123",
            enabled: true,
          },
        },
      } as never;
      const account = kapsoPlugin.config.resolveAccount(cfg, "default");
      expect(kapsoPlugin.config.isEnabled!(account, cfg)).toBe(true);
    });
  });

  describe("security", () => {
    it("resolveDmPolicy returns pairing by default", () => {
      const account = kapsoPlugin.config.resolveAccount({} as never, "default");
      const result = kapsoPlugin.security!.resolveDmPolicy!({ account } as never);
      expect(result!.policy).toBe("pairing");
    });
  });

  describe("outbound", () => {
    it("textChunkLimit is 4096", () => {
      expect(kapsoPlugin.outbound!.textChunkLimit).toBe(4096);
    });
  });

  describe("capabilities", () => {
    it("has direct chatType only", () => {
      expect(kapsoPlugin.capabilities.chatTypes).toEqual(["direct"]);
    });

    it("does not support polls or reactions", () => {
      expect(kapsoPlugin.capabilities.polls).toBe(false);
      expect(kapsoPlugin.capabilities.reactions).toBe(false);
    });
  });

  describe("meta", () => {
    it("has correct id", () => {
      expect(kapsoPlugin.id).toBe("kapso");
      expect(kapsoPlugin.meta.id).toBe("kapso");
    });
  });

  describe("status", () => {
    it("defaultRuntime is not running", () => {
      expect(kapsoPlugin.status!.defaultRuntime!.running).toBe(false);
      expect(kapsoPlugin.status!.defaultRuntime!.connected).toBe(false);
    });
  });
});
