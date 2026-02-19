/**
 * @module sessions/jorchbot/focus-model
 * @phase 2
 * @description Focus Model — tracks which session is "focused" in single-threaded chat
 * @status placeholder
 */

// Phase 2: Focus Model
// NOTE (DeepWiki rev.2): This is 100% JorchBot-specific (Layer 2).
// OpenClaw has NO concept of a "focused session" — each channel has its own
// conversation. Since WhatsApp is single-threaded, JorchBot needs a Focus Model
// to route free-text messages to the correct session.
//
// Only ONE session can be focused at a time. Background sessions buffer output
// and only send critical notifications (approvals, errors, completions).
//
// State tracked in JorchBot DB (sessions table, focused column).
// See: docs/phase-2-multi-session.md (section 2.2)
export type FocusModelPlaceholder = Record<string, never>;
