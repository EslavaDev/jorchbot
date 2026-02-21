import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalTimer } from "./approval-timer.js";

describe("ApprovalTimer", () => {
  let timer: ApprovalTimer;
  let reminders: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    reminders = [];
    timer = new ApprovalTimer({
      reminderDelayMs: 10 * 60 * 1000, // 10 minutes
      onReminder: (id) => reminders.push(id),
    });
  });

  afterEach(() => {
    timer.dispose();
    vi.useRealTimers();
  });

  describe("reminder fires", () => {
    it("calls onReminder after the delay", () => {
      timer.start("approval-1");
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toBe("approval-1");
    });

    it("does not fire before the delay", () => {
      timer.start("approval-1");
      vi.advanceTimersByTime(9 * 60 * 1000);

      expect(reminders).toHaveLength(0);
    });

    it("fires independently for multiple approvals", () => {
      timer.start("approval-1");
      timer.start("approval-2");
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(reminders).toHaveLength(2);
      expect(reminders).toContain("approval-1");
      expect(reminders).toContain("approval-2");
    });
  });

  describe("clear prevents reminder", () => {
    it("does not fire after clear", () => {
      timer.start("approval-1");
      timer.clear("approval-1");
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(reminders).toHaveLength(0);
    });

    it("clearing one does not affect others", () => {
      timer.start("approval-1");
      timer.start("approval-2");
      timer.clear("approval-1");
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toBe("approval-2");
    });

    it("clearing unknown ID does not throw", () => {
      expect(() => timer.clear("nonexistent")).not.toThrow();
    });
  });

  describe("dispose clears all", () => {
    it("prevents all reminders from firing", () => {
      timer.start("approval-1");
      timer.start("approval-2");
      timer.start("approval-3");
      timer.dispose();
      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(reminders).toHaveLength(0);
    });
  });

  describe("restart behavior", () => {
    it("resets the timer when start is called again for same ID", () => {
      timer.start("approval-1");
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 min in

      timer.start("approval-1"); // Restart
      vi.advanceTimersByTime(5 * 60 * 1000); // 5 more min (10 total, 5 since restart)

      expect(reminders).toHaveLength(0);

      vi.advanceTimersByTime(5 * 60 * 1000); // 10 min since restart
      expect(reminders).toHaveLength(1);
      expect(reminders[0]).toBe("approval-1");
    });
  });
});
