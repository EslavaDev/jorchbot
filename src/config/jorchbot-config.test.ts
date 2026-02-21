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
    expect(config.channels.kapso.dmPolicy).toBe("pairing");
    expect(config.channels.kapso.allowFrom).toEqual([]);
    expect(config.channels.telegram.enabled).toBe(false);
    expect(config.tunnels.defaultMode).toBe("serve");
    expect(config.tunnels.tailscale.enabled).toBe(true);
    expect(config.tunnels.funnelProxy.port).toBe(9999);
    expect(config.tunnels.funnelProxy.tailscalePort).toBe(8443);
    expect(config.tunnels.health.intervalMs).toBe(30_000);
    expect(config.tunnels.health.failureThreshold).toBe(3);
    expect(config.tunnels.health.maxRestartAttempts).toBe(3);
    expect(config.approvals.timeoutMinutes).toBe(10);
    expect(config.approvals.pauseTimeoutMinutes).toBe(60);
    expect(config.approvals.skipPermissions).toBe(true);
    expect(config.sessions.maxConcurrent).toBe(5);
    expect(config.sessions.shellTimeout).toBe(30_000);
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
      sessions: { maxConcurrent: 10, shellTimeout: 60_000 },
    });

    expect(config.gateway.port).toBe(9999);
    expect(config.gateway.host).toBe("0.0.0.0");
    expect(config.db.logRetentionDays).toBe(14);
    expect(config.channels.kapso.enabled).toBe(true);
    expect(config.channels.kapso.apiKey).toBe("sk-test");
    expect(config.channels.kapso.phoneNumberId).toBe("12345");
    expect(config.channels.kapso.webhookVerifyToken).toBe("verify-me");
    expect(config.sessions.maxConcurrent).toBe(10);
    expect(config.sessions.shellTimeout).toBe(60_000);
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

  it("rejects maxConcurrent above 20", () => {
    expect(() => JorchBotConfigSchema.parse({ sessions: { maxConcurrent: 25 } })).toThrow();
  });

  it("rejects shellTimeout below 1000", () => {
    expect(() => JorchBotConfigSchema.parse({ sessions: { shellTimeout: 500 } })).toThrow();
  });

  it("provides session defaults when sessions key is missing", () => {
    const config = JorchBotConfigSchema.parse({});
    expect(config.sessions.maxConcurrent).toBe(5);
    expect(config.sessions.shellTimeout).toBe(30_000);
  });

  it("rejects funnelProxy.tailscalePort outside allowed values", () => {
    expect(() =>
      JorchBotConfigSchema.parse({ tunnels: { funnelProxy: { tailscalePort: 9999 } } }),
    ).toThrow();
  });

  it("accepts valid funnelProxy.tailscalePort values", () => {
    for (const port of [443, 8443, 10000]) {
      const config = JorchBotConfigSchema.parse({
        tunnels: { funnelProxy: { tailscalePort: port } },
      });
      expect(config.tunnels.funnelProxy.tailscalePort).toBe(port);
    }
  });

  it("rejects health.intervalMs below 5000", () => {
    expect(() =>
      JorchBotConfigSchema.parse({
        tunnels: { health: { intervalMs: 1000 } },
      }),
    ).toThrow();
  });

  it("rejects health.failureThreshold below 1", () => {
    expect(() =>
      JorchBotConfigSchema.parse({
        tunnels: { health: { failureThreshold: 0 } },
      }),
    ).toThrow();
  });

  it("accepts valid health overrides", () => {
    const config = JorchBotConfigSchema.parse({
      tunnels: {
        health: { intervalMs: 60_000, failureThreshold: 5, maxRestartAttempts: 5 },
      },
    });
    expect(config.tunnels.health.intervalMs).toBe(60_000);
    expect(config.tunnels.health.failureThreshold).toBe(5);
    expect(config.tunnels.health.maxRestartAttempts).toBe(5);
  });
});
