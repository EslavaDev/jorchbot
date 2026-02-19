import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * We can't test the module side-effect directly (it runs once at import time
 * in entry.ts). Instead we replicate the aliasing logic here and verify the
 * expected behavior. The real integration is validated by checking that
 * `src/config/paths.ts` resolves to ~/.jorchbot after entry.ts loads.
 */

const ENV_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["JORCHBOT_HOME", "OPENCLAW_HOME"],
  ["JORCHBOT_STATE_DIR", "OPENCLAW_STATE_DIR"],
  ["JORCHBOT_CONFIG_PATH", "OPENCLAW_CONFIG_PATH"],
  ["JORCHBOT_OAUTH_DIR", "OPENCLAW_OAUTH_DIR"],
  ["JORCHBOT_GATEWAY_PORT", "OPENCLAW_GATEWAY_PORT"],
  ["JORCHBOT_GATEWAY_TOKEN", "OPENCLAW_GATEWAY_TOKEN"],
  ["JORCHBOT_GATEWAY_PASSWORD", "OPENCLAW_GATEWAY_PASSWORD"],
  ["JORCHBOT_NO_RESPAWN", "OPENCLAW_NO_RESPAWN"],
];

function applyAliases(env: Record<string, string | undefined>): void {
  for (const [jb, oc] of ENV_ALIASES) {
    const jbValue = env[jb]?.trim();
    if (jbValue) {
      env[oc] = jbValue;
    }
  }
  if (!env.OPENCLAW_STATE_DIR) {
    env.OPENCLAW_STATE_DIR = path.join(os.homedir(), ".jorchbot");
  }
}

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

  it("defaults OPENCLAW_STATE_DIR to ~/.jorchbot when neither is set", () => {
    const env: Record<string, string | undefined> = {};
    applyAliases(env);
    expect(env.OPENCLAW_STATE_DIR).toBe(path.join(os.homedir(), ".jorchbot"));
  });

  it("does not override OPENCLAW_STATE_DIR default when JORCHBOT_STATE_DIR is empty", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_STATE_DIR: "   ",
    };
    applyAliases(env);
    // Empty/whitespace JORCHBOT_STATE_DIR is ignored, default kicks in
    expect(env.OPENCLAW_STATE_DIR).toBe(path.join(os.homedir(), ".jorchbot"));
  });

  it("trims whitespace from JORCHBOT_* values", () => {
    const env: Record<string, string | undefined> = {
      JORCHBOT_CONFIG_PATH: "  /my/config.json  ",
    };
    applyAliases(env);
    expect(env.OPENCLAW_CONFIG_PATH).toBe("/my/config.json");
  });

  it("maps all alias pairs", () => {
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
