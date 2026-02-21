import { describe, expect, it } from "vitest";
import { TunnelMode, TunnelStatus, TunnelProvider, TunnelStartInputSchema } from "./types.js";

describe("TunnelMode", () => {
  it("accepts 'serve'", () => {
    expect(TunnelMode.parse("serve")).toBe("serve");
  });

  it("accepts 'funnel'", () => {
    expect(TunnelMode.parse("funnel")).toBe("funnel");
  });

  it("rejects invalid mode", () => {
    expect(() => TunnelMode.parse("invalid")).toThrow();
  });
});

describe("TunnelStatus", () => {
  it.each(["starting", "active", "stopped", "error"] as const)("accepts '%s'", (status) => {
    expect(TunnelStatus.parse(status)).toBe(status);
  });

  it("rejects invalid status", () => {
    expect(() => TunnelStatus.parse("unknown")).toThrow();
  });
});

describe("TunnelProvider", () => {
  it.each(["tailscale-serve", "tailscale-funnel"] as const)("accepts '%s'", (provider) => {
    expect(TunnelProvider.parse(provider)).toBe(provider);
  });

  it("rejects invalid provider", () => {
    expect(() => TunnelProvider.parse("cloudflare")).toThrow();
  });
});

describe("TunnelStartInputSchema", () => {
  it("parses valid input with all fields", () => {
    const input = TunnelStartInputSchema.parse({
      project: "frontend",
      sessionId: "session-1",
      localPort: 3000,
      mode: "serve",
      funnelPath: "/frontend",
    });

    expect(input.project).toBe("frontend");
    expect(input.sessionId).toBe("session-1");
    expect(input.localPort).toBe(3000);
    expect(input.mode).toBe("serve");
    expect(input.funnelPath).toBe("/frontend");
  });

  it("defaults mode to 'serve' when omitted", () => {
    const input = TunnelStartInputSchema.parse({
      project: "backend",
      sessionId: "session-2",
      localPort: 8000,
    });

    expect(input.mode).toBe("serve");
  });

  it("allows funnelPath to be omitted", () => {
    const input = TunnelStartInputSchema.parse({
      project: "api",
      sessionId: "session-3",
      localPort: 4000,
      mode: "funnel",
    });

    expect(input.funnelPath).toBeUndefined();
  });

  it("rejects empty project", () => {
    expect(() =>
      TunnelStartInputSchema.parse({
        project: "",
        sessionId: "session-1",
        localPort: 3000,
      }),
    ).toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() =>
      TunnelStartInputSchema.parse({
        project: "frontend",
        sessionId: "",
        localPort: 3000,
      }),
    ).toThrow();
  });

  it("rejects port below 1", () => {
    expect(() =>
      TunnelStartInputSchema.parse({
        project: "frontend",
        sessionId: "session-1",
        localPort: 0,
      }),
    ).toThrow();
  });

  it("rejects port above 65535", () => {
    expect(() =>
      TunnelStartInputSchema.parse({
        project: "frontend",
        sessionId: "session-1",
        localPort: 70000,
      }),
    ).toThrow();
  });

  it("rejects non-integer port", () => {
    expect(() =>
      TunnelStartInputSchema.parse({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000.5,
      }),
    ).toThrow();
  });

  it("rejects invalid mode", () => {
    expect(() =>
      TunnelStartInputSchema.parse({
        project: "frontend",
        sessionId: "session-1",
        localPort: 3000,
        mode: "invalid",
      }),
    ).toThrow();
  });
});
