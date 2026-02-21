import { describe, expect, it } from "vitest";
import {
  JorchBotConfigNotFoundError,
  JorchBotConfigParseError,
  JorchBotConfigValidationError,
  JorchBotDbInitError,
  JorchBotDbMigrationError,
  JorchBotDbQueryError,
  JorchBotError,
  JorchBotGatewayNotRunningError,
  JorchBotGatewayStartError,
  ClaudeRunnerSpawnError,
  ClaudeRunnerParseError,
  ClaudeRunnerTimeoutError,
  ClaudeRunnerProcessError,
  TailscaleNotInstalledError,
  TailscaleNotAuthenticatedError,
  TunnelStartError,
  TunnelStopError,
  TunnelNotFoundError,
  FunnelNotEnabledError,
  TunnelHealthCheckError,
  FunnelProxyStartError,
  FunnelProxyRouteConflictError,
} from "./index.js";

describe("JorchBotError hierarchy", () => {
  it("sets .name to the constructor name for each error class", () => {
    const cases = [
      new JorchBotError("base"),
      new JorchBotConfigNotFoundError("not found"),
      new JorchBotConfigParseError("parse"),
      new JorchBotConfigValidationError("validation"),
      new JorchBotDbInitError("init"),
      new JorchBotDbMigrationError("migration"),
      new JorchBotDbQueryError("query"),
      new JorchBotGatewayStartError("start"),
      new JorchBotGatewayNotRunningError("not running"),
      new ClaudeRunnerSpawnError("spawn"),
      new ClaudeRunnerParseError("parse"),
      new ClaudeRunnerTimeoutError("timeout"),
      new ClaudeRunnerProcessError("process"),
      new TailscaleNotInstalledError(),
      new TailscaleNotAuthenticatedError(),
      new TunnelStartError("frontend", 3000, "serve"),
      new TunnelStopError("tunnel-123"),
      new TunnelNotFoundError("tunnel-456"),
      new FunnelNotEnabledError(),
      new TunnelHealthCheckError("tunnel-789", 3),
      new FunnelProxyStartError(8443),
      new FunnelProxyRouteConflictError("/frontend"),
    ];

    for (const err of cases) {
      expect(err.name).toBe(err.constructor.name);
      expect(err.message).toBeTruthy();
    }
  });

  it("all subclasses are instanceof JorchBotError and Error", () => {
    const subclasses = [
      JorchBotConfigNotFoundError,
      JorchBotConfigParseError,
      JorchBotConfigValidationError,
      JorchBotDbInitError,
      JorchBotDbMigrationError,
      JorchBotDbQueryError,
      JorchBotGatewayStartError,
      JorchBotGatewayNotRunningError,
      ClaudeRunnerSpawnError,
      ClaudeRunnerParseError,
      ClaudeRunnerTimeoutError,
      ClaudeRunnerProcessError,
    ];

    for (const Cls of subclasses) {
      const err = new Cls("test");
      expect(err).toBeInstanceOf(JorchBotError);
      expect(err).toBeInstanceOf(Error);
    }

    // Tunnel errors with custom constructors
    const tunnelErrors: JorchBotError[] = [
      new TailscaleNotInstalledError(),
      new TailscaleNotAuthenticatedError(),
      new TunnelStartError("p", 3000, "serve"),
      new TunnelStopError("t-1"),
      new TunnelNotFoundError("t-2"),
      new FunnelNotEnabledError(),
      new TunnelHealthCheckError("t-3", 3),
      new FunnelProxyStartError(8443),
      new FunnelProxyRouteConflictError("/p"),
    ];

    for (const err of tunnelErrors) {
      expect(err).toBeInstanceOf(JorchBotError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("supports cause chaining via ErrorOptions", () => {
    const original = new TypeError("bad type");
    const wrapped = new JorchBotDbQueryError("query failed", { cause: original });

    expect(wrapped.cause).toBe(original);
    expect(wrapped.message).toBe("query failed");
    expect(wrapped.name).toBe("JorchBotDbQueryError");
  });
});
