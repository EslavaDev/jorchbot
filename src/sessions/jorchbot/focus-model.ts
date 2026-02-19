/**
 * Focus Model — tracks which session is "focused" in single-threaded chat.
 *
 * 100% JorchBot-specific (Layer 2). OpenClaw has NO concept of a focused
 * session because each channel has its own independent conversation.
 *
 * WhatsApp is single-threaded: all sessions share one chat. The Focus Model
 * determines which session receives free-text messages and $ commands.
 *
 * State is kept in-memory (source of truth) and mirrored to DB (persistence)
 * by SessionManager.
 */
export class FocusModel {
  private focusedProject: string | null = null;

  /** Get the currently focused project name, or null if none. */
  getFocused(): string | null {
    return this.focusedProject;
  }

  /** Set the focused project. */
  setFocused(project: string): void {
    this.focusedProject = project;
  }

  /** Clear focus (no session focused). */
  clearFocus(): void {
    this.focusedProject = null;
  }

  /** Check if a specific project is focused. */
  isFocused(project: string): boolean {
    return this.focusedProject === project;
  }
}
