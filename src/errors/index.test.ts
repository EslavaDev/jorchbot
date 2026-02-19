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
    ];

    for (const Cls of subclasses) {
      const err = new Cls("test");
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
