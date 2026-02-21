import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputBuffer } from "./output-buffer.js";

describe("OutputBuffer", () => {
  let buffer: OutputBuffer;
  let flushed: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    flushed = [];
    buffer = new OutputBuffer((text) => flushed.push(text), 3000);
  });

  afterEach(() => {
    buffer.dispose();
    vi.useRealTimers();
  });

  describe("timer flush", () => {
    it("does not flush immediately on append", () => {
      buffer.append("hello");
      expect(flushed).toHaveLength(0);
    });

    it("flushes after the interval", () => {
      buffer.append("hello");
      vi.advanceTimersByTime(3000);

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toBe("hello");
    });

    it("batches multiple appends into one flush", () => {
      buffer.append("one ");
      buffer.append("two ");
      buffer.append("three");
      vi.advanceTimersByTime(3000);

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toBe("one two three");
    });

    it("resets timer after flush", () => {
      buffer.append("first");
      vi.advanceTimersByTime(3000);
      expect(flushed).toHaveLength(1);

      buffer.append("second");
      vi.advanceTimersByTime(3000);
      expect(flushed).toHaveLength(2);
      expect(flushed[1]).toBe("second");
    });
  });

  describe("force flush", () => {
    it("flushes immediately on forceFlush", () => {
      buffer.append("urgent");
      buffer.forceFlush();

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toBe("urgent");
    });

    it("does nothing on forceFlush with empty buffer", () => {
      buffer.forceFlush();
      expect(flushed).toHaveLength(0);
    });

    it("clears the timer on forceFlush", () => {
      buffer.append("text");
      buffer.forceFlush();

      // Timer should be cleared — no second flush after interval
      vi.advanceTimersByTime(3000);
      expect(flushed).toHaveLength(1);
    });
  });

  describe("overflow flush", () => {
    it("flushes immediately when buffer exceeds WhatsApp limit", () => {
      const longText = "A".repeat(4096);
      buffer.append(longText);

      // Should flush immediately without waiting for timer
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toBe(longText);
    });

    it("accumulates and flushes when combined text exceeds limit", () => {
      buffer.append("A".repeat(2000));
      expect(flushed).toHaveLength(0);

      buffer.append("B".repeat(2100));
      // Combined exceeds 4096, should flush immediately
      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toBe("A".repeat(2000) + "B".repeat(2100));
    });
  });

  describe("empty buffer", () => {
    it("does not call onFlush when disposing an empty buffer", () => {
      buffer.dispose();
      expect(flushed).toHaveLength(0);
    });

    it("does not call onFlush on timer with no appends", () => {
      vi.advanceTimersByTime(3000);
      expect(flushed).toHaveLength(0);
    });
  });

  describe("dispose", () => {
    it("flushes remaining content on dispose", () => {
      buffer.append("remaining");
      buffer.dispose();

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toBe("remaining");
    });

    it("clears timer on dispose", () => {
      buffer.append("data");
      buffer.dispose();

      // Timer should be cleared — no additional flush
      vi.advanceTimersByTime(3000);
      expect(flushed).toHaveLength(1);
    });
  });
});
