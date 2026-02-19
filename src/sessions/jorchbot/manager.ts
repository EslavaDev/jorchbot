// Phase 2: Session manager
// NOTE (DeepWiki rev.2): OpenClaw has native multi-agent system with RPC
// (agents.list/create/update/delete). SessionManager should wrap OpenClaw's
// agent management (Layer 1) and add ClaudeRunner + Focus Model (Layer 2).
// Do NOT reimplement agent lifecycle — use OpenClaw's existing infrastructure.
export type SessionManagerPlaceholder = Record<string, never>;
