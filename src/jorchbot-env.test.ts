import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ENV_ALIASES } from "./jorchbot-env.js";

describe("jorchbot-env aliasing", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const [jb, oc] of ENV_ALIASES) {
      savedEnv[jb] = process.env[jb];
      savedEnv[oc] = process.env[oc];
      delete process.env[jb];
      delete process.env[oc];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  /**
   * The side-effect in jorchbot-env.ts runs once at import time.
   * We can't re-trigger it per test, so we replicate the aliasing logic
   * to verify the mapping behavior. The real integration is validated
   * by the entry.ts import order.
   */
  function applyAliases(env: Record<string, string | undefined>): void {
    for (const [jb, oc] of ENV_ALIASES) {
      const jbValue = env[jb]?.trim();
      if (jbValue) {
        env[oc] = jbValue;
      }
    }
  }

  it("exports the expected alias pairs", () => {
    expect(ENV_ALIASES).toHaveLength(8);
    expect(ENV_ALIASES[0]).toEqual(["JORCHBOT_HOME", "OPENCLAW_HOME"]);
    expect(ENV_ALIASES[1]).toEqual(["JORCHBOT_STATE_DIR", "OPENCLAW_STATE_DIR"]);
  });

  it("maps JORCHBOT_STATE_DIR to OPENCLAW_STATE_DIR", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_STATE_DIR: "/custom/jorchbot",
    };
    applyAliases(env);
    expect(env.OPENCLAW_STATE_DIR).toBe("/custom/jorchbot");
  });

  it("maps JORCHBOT_GATEWAY_PORT to OPENCLAW_GATEWAY_PORT", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_GATEWAY_PORT: "9999",
    };
    applyAliases(env);
    expect(env.OPENCLAW_GATEWAY_PORT).toBe("9999");
  });

  it("JORCHBOT_* overwrites OPENCLAW_* when both are set", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_STATE_DIR: "/jorchbot/wins",
      OPENCLAW_STATE_DIR: "/openclaw/loses",
    };
    applyAliases(env);
    expect(env.OPENCLAW_STATE_DIR).toBe("/jorchbot/wins");
  });

  it("preserves OPENCLAW_* when JORCHBOT_* is not set", () => {
    const env: Record<string, string | undefined> = {
      OPENCLAW_STATE_DIR: "/existing/openclaw",
    };
    applyAliases(env);
    expect(env.OPENCLAW_STATE_DIR).toBe("/existing/openclaw");
  });

  it("does not set OPENCLAW_STATE_DIR when neither is provided", () => {
    const env: Record<string, string | undefined> = {};
    applyAliases(env);
    expect(env.OPENCLAW_STATE_DIR).toBeUndefined();
  });

  it("ignores empty/whitespace JORCHBOT_* values", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_STATE_DIR: "   ",
    };
    applyAliases(env);
    expect(env.OPENCLAW_STATE_DIR).toBeUndefined();
  });

  it("trims whitespace from JORCHBOT_* values", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_CONFIG_PATH: "  /my/config.json  ",
    };
    applyAliases(env);
    expect(env.OPENCLAW_CONFIG_PATH).toBe("/my/config.json");
  });

  it("maps all alias pairs correctly", () => {
    const env: Record<string, string | undefined> = {};
    for (const [jb] of ENV_ALIASES) {
      env[jb] = `value-for-${jb}`;
    }
    applyAliases(env);
    for (const [jb, oc] of ENV_ALIASES) {
      expect(env[oc]).toBe(`value-for-${jb}`);
    }
  });
});
