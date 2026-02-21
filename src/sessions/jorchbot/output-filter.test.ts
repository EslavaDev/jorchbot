import { describe, expect, it } from "vitest";
import { shouldSendToChat } from "./output-filter.js";

describe("shouldSendToChat", () => {
  describe("verbose mode", () => {
    it("sends text events", () => {
      expect(shouldSendToChat("text", "verbose")).toBe(true);
    });

    it("sends result events", () => {
      expect(shouldSendToChat("result", "verbose")).toBe(true);
    });

    it("sends error events", () => {
      expect(shouldSendToChat("error", "verbose")).toBe(true);
    });

    it("sends toolUse events", () => {
      expect(shouldSendToChat("toolUse", "verbose")).toBe(true);
    });
  });

  describe("summary mode", () => {
    it("does not send text events", () => {
      expect(shouldSendToChat("text", "summary")).toBe(false);
    });

    it("does not send toolUse events", () => {
      expect(shouldSendToChat("toolUse", "summary")).toBe(false);
    });

    it("sends result events", () => {
      expect(shouldSendToChat("result", "summary")).toBe(true);
    });

    it("sends error events", () => {
      expect(shouldSendToChat("error", "summary")).toBe(true);
    });
  });

  describe("silent mode", () => {
    it("does not send text events", () => {
      expect(shouldSendToChat("text", "silent")).toBe(false);
    });

    it("does not send toolUse events", () => {
      expect(shouldSendToChat("toolUse", "silent")).toBe(false);
    });

    it("sends result events", () => {
      expect(shouldSendToChat("result", "silent")).toBe(true);
    });

    it("sends error events", () => {
      expect(shouldSendToChat("error", "silent")).toBe(true);
    });
  });
});
