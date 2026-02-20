/**
 * Focus Model — tracks which session is "focused" per phone number.
 *
 * 100% JorchBot-specific (Layer 2). OpenClaw has NO concept of a focused
 * session because each channel has its own independent conversation.
 *
 * WhatsApp is single-threaded per phone: all sessions share one chat.
 * The Focus Model determines which session receives free-text messages
 * and $ commands for each phone number.
 *
 * State is kept in-memory (source of truth) and mirrored to DB (persistence)
 * by SessionManager.
 */
export class FocusModel {
  private focused = new Map<string, string>(); // phone → project

  /** Get the currently focused project for a phone, or null if none. */
  getFocused(phone: string): string | null {
    return this.focused.get(phone) ?? null;
  }

  /** Set the focused project for a phone. */
  setFocused(phone: string, project: string): void {
    this.focused.set(phone, project);
  }

  /** Clear focus for a phone (no session focused). */
  clearFocus(phone: string): void {
    this.focused.delete(phone);
  }

  /** Check if a specific project is focused by a phone. */
  isFocused(phone: string, project: string): boolean {
    return this.focused.get(phone) === project;
  }

  /** Clear focus for a project across all phones (used on session destroy). */
  clearProject(project: string): void {
    for (const [phone, proj] of this.focused) {
      if (proj === project) {
        this.focused.delete(phone);
      }
    }
  }
}
