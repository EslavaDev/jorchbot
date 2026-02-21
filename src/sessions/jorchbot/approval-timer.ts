interface ApprovalTimerDeps {
  reminderDelayMs: number;
  onReminder: (approvalId: string) => void;
}

/**
 * Manages per-approval reminder timers.
 *
 * When an approval is created, a timer is started. If the approval isn't
 * resolved before the timer fires, the reminder callback is called.
 */
export class ApprovalTimer {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private deps: ApprovalTimerDeps;

  constructor(deps: ApprovalTimerDeps) {
    this.deps = deps;
  }

  /**
   * Start a reminder timer for an approval.
   */
  start(approvalId: string): void {
    this.clear(approvalId);
    const timer = setTimeout(() => {
      this.timers.delete(approvalId);
      this.deps.onReminder(approvalId);
    }, this.deps.reminderDelayMs);
    this.timers.set(approvalId, timer);
  }

  /**
   * Clear the timer for an approval (called when resolved).
   */
  clear(approvalId: string): void {
    const timer = this.timers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(approvalId);
    }
  }

  /**
   * Clear all timers (called on shutdown).
   */
  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
