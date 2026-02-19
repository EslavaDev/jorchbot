import { describe, expect, it } from "vitest";
import { JorchBotConfigSchema } from "./jorchbot-config.js";

describe("JorchBotConfigSchema", () => {
  it("provides all defaults when given an empty object", () => {
    const config = JorchBotConfigSchema.parse({});

    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.host).toBe("127.0.0.1");
    expect(config.db.path).toBe("~/.jorchbot/jorchbot.db");
    expect(config.db.logRetentionDays).toBe(7);
    expect(config.channels.kapso.enabled).toBe(false);
    expect(config.channels.kapso.phoneNumberId).toBe("");
    expect(config.channels.kapso.webhookVerifyToken).toBe("");
    expect(config.channels.kapso.webhookSecret).toBe("");
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.tunnels.defaultMode).toBe("serve");
    expect(config.tunnels.tailscale.enabled).toBe(true);
    expect(config.approvals.timeoutMinutes).toBe(10);
    expect(config.approvals.pauseTimeoutMinutes).toBe(60);
  });

  it("accepts valid overrides", () => {
    const config = JorchBotConfigSchema.parse({
      gateway: { port: 9999, host: "0.0.0.0" },
      db: { logRetentionDays: 14 },
      channels: {
        kapso: {
          enabled: true,
          apiKey: "sk-test",
          phoneNumberId: "12345",
          webhookVerifyToken: "verify-me",
        },
      },
    });

    expect(config.gateway.port).toBe(9999);
    expect(config.gateway.host).toBe("0.0.0.0");
    expect(config.db.logRetentionDays).toBe(14);
    expect(config.channels.kapso.enabled).toBe(true);
    expect(config.channels.kapso.apiKey).toBe("sk-test");
    expect(config.channels.kapso.phoneNumberId).toBe("12345");
    expect(config.channels.kapso.webhookVerifyToken).toBe("verify-me");
    // Unset fields still get defaults
    expect(config.tunnels.defaultMode).toBe("serve");
  });

  it("rejects port below 1", () => {
    expect(() => JorchBotConfigSchema.parse({ gateway: { port: 0 } })).toThrow();
  });

  it("rejects port above 65535", () => {
    expect(() => JorchBotConfigSchema.parse({ gateway: { port: 70000 } })).toThrow();
  });

  it("rejects invalid tunnel mode", () => {
    expect(() => JorchBotConfigSchema.parse({ tunnels: { defaultMode: "invalid" } })).toThrow();
  });

  it("rejects non-integer retention days", () => {
    expect(() => JorchBotConfigSchema.parse({ db: { logRetentionDays: 3.5 } })).toThrow();
  });
});
