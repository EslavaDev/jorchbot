import { defineConfig } from "tsdown";

const env = {
  NODE_ENV: "production",
};

export default defineConfig([
  // Core entries — KEEP
  {
    entry: "src/index.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/entry.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    // Ensure this module is bundled as an entry so legacy CLI shims can resolve its exports.
    entry: "src/cli/daemon-cli.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/infra/warning-filter.ts",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/plugin-sdk/index.ts",
    outDir: "dist/plugin-sdk",
    env,
    fixedExtension: false,
    platform: "node",
  },
  {
    entry: "src/plugin-sdk/account-id.ts",
    outDir: "dist/plugin-sdk",
    env,
    fixedExtension: false,
    platform: "node",
  },
  // JorchBot hook scripts — standalone processes invoked by Claude Code PreToolUse/PostToolUse
  {
    entry: ["src/hooks/jorchbot/tool-approval.ts", "src/hooks/jorchbot/tool-result.ts"],
    outDir: "dist/hooks/jorchbot",
    env,
    fixedExtension: false,
    platform: "node",
  },
  // JorchBot: disabled entries (re-enable as needed)
  // Extension API — disabled: extensions workspace excluded
  // {
  //   entry: "src/extensionAPI.ts",
  //   env,
  //   fixedExtension: false,
  //   platform: "node",
  // },
  // OpenClaw bundled hooks — disabled: not needed in Phase 0
  // {
  //   entry: ["src/hooks/bundled/*/handler.ts", "src/hooks/llm-slug-generator.ts"],
  //   env,
  //   fixedExtension: false,
  //   platform: "node",
  // },
]);
