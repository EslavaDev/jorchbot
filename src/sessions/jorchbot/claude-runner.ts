// Phase 1: Claude Code runner
// NOTE (DeepWiki rev.2): This is 100% JorchBot-specific code (Layer 2).
// OpenClaw does NOT run Claude Code as a subprocess — it has its own agent system.
// ClaudeRunner spawns `claude -p <prompt> --output-format stream-json` as a
// child process, parses NDJSON streaming, and handles tool approval requests.
export type ClaudeRunnerPlaceholder = Record<string, never>;
