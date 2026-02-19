import { describe, expect, it } from "vitest";
import { calculateContextUsage, formatContextUsage } from "./context-tracker.js";

describe("context-tracker", () => {
  describe("calculateContextUsage", () => {
    it("returns 0% when no tokens used", () => {
      const usage = calculateContextUsage(0, 0);
      expect(usage.percent).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });

    it("calculates correct percentage for known values", () => {
      const usage = calculateContextUsage(100_000, 50_000);
      expect(usage.percent).toBe(75);
      expect(usage.totalTokens).toBe(150_000);
      expect(usage.limit).toBe(200_000);
    });

    it("caps at 100% when exceeding limit", () => {
      const usage = calculateContextUsage(150_000, 100_000);
      expect(usage.percent).toBe(100);
    });

    it("uses default limit for unknown model", () => {
      const usage = calculateContextUsage(50_000, 50_000, "unknown-model");
      expect(usage.limit).toBe(200_000);
      expect(usage.percent).toBe(50);
    });
  });

  describe("formatContextUsage", () => {
    it("produces correct string format", () => {
      const usage = calculateContextUsage(30_000, 20_000);
      const formatted = formatContextUsage(usage);
      expect(formatted).toBe("Context: 25% (50K/200K tokens)");
    });

    it("formats 0% usage", () => {
      const usage = calculateContextUsage(0, 0);
      const formatted = formatContextUsage(usage);
      expect(formatted).toBe("Context: 0% (0K/200K tokens)");
    });
  });
});
