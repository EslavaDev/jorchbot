import { describe, expect, it } from "vitest";
import { chunkForSession } from "./session-chunker.js";

describe("chunkForSession", () => {
  describe("single chunk (short messages)", () => {
    it("returns a single chunk with project prefix for short content", () => {
      const result = chunkForSession("Hello world", "my-project");
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toBe("[my-project] Hello world");
      expect(result.document).toBeUndefined();
    });

    it("does not add numbering for single chunk", () => {
      const result = chunkForSession("Short text", "proj");
      expect(result.chunks[0]).toBe("[proj] Short text");
      expect(result.chunks[0]).not.toContain("(1/1)");
    });
  });

  describe("multi chunk (long messages within threshold)", () => {
    it("adds numbered prefix when multiple chunks are needed", () => {
      // Create content that's too long for a single chunk but under document threshold
      const content = "A".repeat(5000);
      const result = chunkForSession(content, "proj", { documentThreshold: 20_000 });

      expect(result.chunks.length).toBeGreaterThan(1);
      expect(result.chunks[0]).toMatch(/^\[proj\] \(1\/\d+\)/);
      expect(result.chunks[1]).toMatch(/^\[proj\] \(2\/\d+\)/);
      expect(result.document).toBeUndefined();
    });

    it("limits to maxChunks messages", () => {
      // Create very long content that would produce many chunks
      const content = "B".repeat(15_000);
      const result = chunkForSession(content, "proj", {
        maxChunks: 2,
        documentThreshold: 20_000,
      });

      expect(result.chunks).toHaveLength(2);
      expect(result.document).toBeUndefined();
    });

    it("defaults to 3 max chunks", () => {
      const content = "C".repeat(15_000);
      const result = chunkForSession(content, "proj", { documentThreshold: 20_000 });

      expect(result.chunks.length).toBeLessThanOrEqual(3);
    });
  });

  describe("document fallback (very long messages)", () => {
    it("produces document when content exceeds threshold", () => {
      const content = "D".repeat(13_000);
      const result = chunkForSession(content, "proj", { documentThreshold: 12_000 });

      expect(result.document).toBeDefined();
      expect(result.document!.content).toBe(content);
      expect(result.document!.filename).toMatch(
        /^proj-output-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt$/,
      );
    });

    it("includes summary chunks + notification when document is attached", () => {
      const content = "E".repeat(13_000);
      const result = chunkForSession(content, "proj", { documentThreshold: 12_000 });

      // Should have summary chunks + document notification
      const lastChunk = result.chunks[result.chunks.length - 1];
      expect(lastChunk).toContain("Output too long");
      expect(lastChunk).toContain("attached as document");
      expect(lastChunk).toContain("[proj]");
    });

    it("includes content size in KB in notification", () => {
      const content = "F".repeat(13_000);
      const result = chunkForSession(content, "proj", { documentThreshold: 12_000 });

      const lastChunk = result.chunks[result.chunks.length - 1];
      expect(lastChunk).toContain(`${Math.round(13_000 / 1024)}KB`);
    });

    it("uses default threshold of 12000 chars", () => {
      const content = "G".repeat(12_001);
      const result = chunkForSession(content, "proj");

      expect(result.document).toBeDefined();
    });

    it("does not produce document at exactly threshold", () => {
      // Content just under threshold after accounting for prefix overhead
      const content = "H".repeat(11_000);
      const result = chunkForSession(content, "proj");

      expect(result.document).toBeUndefined();
    });
  });
});
