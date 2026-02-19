// Phase 2: Shell runner
// NOTE (DeepWiki rev.2): OpenClaw has its own exec tool with security policies
// (ask: "off"|"on-miss"|"always", security: "deny"|"allowlist"|"full") and
// BashProcessRegistry. ShellRunner is JorchBot-specific for direct $ commands
// from WhatsApp, bypassing the LLM. Consider aligning with OpenClaw's tool
// policy cascade for consistency.
export type ShellRunnerPlaceholder = Record<string, never>;
